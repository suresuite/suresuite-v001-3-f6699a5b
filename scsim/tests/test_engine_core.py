"""Engine semantics: golden traces #1–#5, determinism, conservation, G-RNG.

Golden values are derived analytically from the documented mechanics
(docs/architecture.md): min-max saw-tooth, deferral-to-window-end (Eqs.
11–12), capacity throttling with FIFO queue.
"""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Lane, Network, Scenario
from scsim.core.engine import CompileError, compile_scenario, run_replication, run_scenario
from scsim.disruption.injector import DisruptionCompileError
from scsim.entities.enums import EffectType, OverflowRule, TargetType
from scsim.io.traces import trace_frame

from .conftest import (
    bom_blocked_network,
    dual_source_network,
    make_settings,
    single_chain_network,
)


def scenario(net: Network, events=None, policies=None, **settings_kw) -> Scenario:
    return Scenario(
        name="t", network=net, settings=make_settings(**settings_kw),
        events=events or [], policies=policies or {},
    )


# ------------------------------------------------------- golden #1: steady state

def test_golden1_single_chain_steady_state():
    """Deterministic single chain fills 100% every week, no lost sales."""
    res = run_scenario(scenario(single_chain_network()), debug=True)
    assert np.allclose(res.fr_series, 1.0)
    assert res.aggregates["lost_sales_value"]["mean"] == 0.0
    assert res.aggregates["cost_of_resilience"]["mean"] == 0.0


def test_extra_weekly_series_shapes_match_fr_series():
    """backlog/on-hand/revenue weekly series are exposed per replication,
    same shape as fr_series, finite (persisted by the worker for V&V)."""
    res = run_scenario(scenario(single_chain_network()), debug=True)
    for key in ("backlog_units", "on_hand_value", "revenue_value"):
        assert key in res.extra_series
        assert res.extra_series[key].shape == res.fr_series.shape
        assert np.isfinite(res.extra_series[key]).all()
    # steady 100%-fill chain: no backlog anywhere
    assert np.allclose(res.extra_series["backlog_units"], 0.0)


def test_golden1_trace_byte_identical_across_runs():
    sc = scenario(single_chain_network())
    c1 = compile_scenario(sc)
    c2 = compile_scenario(sc)
    t1 = trace_frame(run_replication(c1, 0, 0, []))
    t2 = trace_frame(run_replication(c2, 0, 0, []))
    for key in t1:
        assert t1[key].tobytes() == t2[key].tobytes(), f"column {key} not byte-identical"


def test_golden1_outage_loss_is_exact():
    """14-week outage on κ=8 cover: exactly 6 stockout weeks × 100 u × €10."""
    ev = DisruptionEvent(target_id="s1", start=20, duration=14)
    res = run_scenario(scenario(single_chain_network(), [ev]), debug=True)
    assert res.aggregates["lost_sales_value"]["mean"] == pytest.approx(6000.0)
    assert res.aggregates["tts_weeks"]["mean"] > 0


# ------------------------------------------------- golden #2: two-supplier failover

def test_golden2_backup_supplier_failover():
    ev = DisruptionEvent(target_id="s1", start=20, duration=14)
    base = run_scenario(scenario(dual_source_network(), [ev]), debug=True)
    with_backup = run_scenario(
        scenario(dual_source_network(), [ev], {"backup_supplier": {}}), debug=True
    )
    assert with_backup.aggregates["lost_sales_value"]["mean"] < \
        base.aggregates["lost_sales_value"]["mean"]
    assert with_backup.aggregates["cost_backup_premium"]["mean"] > 0


def test_golden2_backup_infeasible_when_single_sourced():
    ev = DisruptionEvent(target_id="s1", start=20, duration=8)
    sc = scenario(single_chain_network(), [ev], {"backup_supplier": {}})
    with pytest.raises(CompileError, match="single-sourced"):
        compile_scenario(sc)


# --------------------------------------------------- golden #3: BoM-blocked production

def test_golden3_bom_hard_constraint():
    """Outage on m2's supplier blocks production even though m1 is plentiful —
    ALL BoM materials are required (Eq. 8)."""
    ev = DisruptionEvent(target_id="s2", start=20, duration=14)
    res = run_scenario(scenario(bom_blocked_network(), [ev]), debug=True)
    fr = res.fr_series[0]
    assert fr.min() == 0.0, "production must stall on the missing BoM peer"
    # m1 on-hand keeps accumulating value while m2 blocks (no destruction).
    assert res.aggregates["lost_sales_value"]["mean"] > 0


def test_golden3_backup_on_wrong_material_useless():
    """Backup sourcing exists for m1 only; m2's outage still blocks p1 —
    the manuscript's single-sourced-BoM-peer lesson."""
    ev = DisruptionEvent(target_id="s2", start=20, duration=14)
    base = run_scenario(scenario(bom_blocked_network(), [ev]), debug=True)
    sc = scenario(bom_blocked_network(), [ev],
                  {"backup_supplier": {"enabled_materials": "all_multi_sourced"}})
    res = run_scenario(sc, debug=True)
    assert res.aggregates["lost_sales_value"]["mean"] == \
        pytest.approx(base.aggregates["lost_sales_value"]["mean"])


# --------------------------------------------------- golden #4: capacity φ=0.5 drain

def test_golden4_capacity_drain_and_conservation():
    ev = DisruptionEvent(
        target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
        capacity_factor=0.5, start=20, duration=10,
    )
    net = single_chain_network(supplier_capacity=120.0)
    res = run_scenario(scenario(net, [ev]), debug=True)
    fr = res.fr_series[0]
    assert 0.5 < fr[24:30].mean() < 0.8           # throttled, not dead
    assert np.allclose(fr[55:], 1.0)              # queue drains, full recovery
    assert res.aggregates["lost_inbound_units"]["mean"] == 0.0  # conservation


def test_golden4_reject_rule_logs_lost_inbound():
    ev = DisruptionEvent(
        target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
        capacity_factor=0.5, start=20, duration=10, overflow_rule=OverflowRule.REJECT,
    )
    net = single_chain_network(supplier_capacity=120.0)
    res = run_scenario(scenario(net, [ev]), debug=True)
    assert res.aggregates["lost_inbound_units"]["mean"] > 0


def test_capacity_event_requires_finite_capacity():
    ev = DisruptionEvent(target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
                         capacity_factor=0.5, start=20, duration=4)
    with pytest.raises(DisruptionCompileError, match="finite supplier capacity"):
        compile_scenario(scenario(single_chain_network(), [ev]))


# ---------------------------------------- golden #5: edge-LT ≡ supplier-LT equivalence

def test_golden5_edge_event_equals_supplier_event():
    """Behavior-neutral lanes: an LT event on the lane equals one on its supplier."""
    net = single_chain_network()
    net_with_lane = Network(
        suppliers=net.suppliers, materials=net.materials, products=net.products,
        bom=net.bom, supplier_links=net.supplier_links,
        lanes=[Lane(id="lane1", supplier_id="s1")],
    )
    ev_sup = DisruptionEvent(target_id="s1", start=20, duration=14)
    ev_lane = DisruptionEvent(target_type=TargetType.EDGE_LANE, target_id="lane1",
                              start=20, duration=14)
    r_sup = run_replication(compile_scenario(scenario(net_with_lane, [ev_sup])), 0, 0,
                            _resolve(scenario(net_with_lane, [ev_sup])))
    r_lane = run_replication(compile_scenario(scenario(net_with_lane, [ev_lane])), 0, 0,
                             _resolve(scenario(net_with_lane, [ev_lane])))
    t_s, t_l = trace_frame(r_sup), trace_frame(r_lane)
    for key in t_s:
        assert t_s[key].tobytes() == t_l[key].tobytes(), f"{key} differs"


def _resolve(sc: Scenario):
    from scsim.disruption.injector import resolve_events
    compiled = compile_scenario(sc)
    return resolve_events(compiled.model, warmup_end=10, event_rep=0)


# ------------------------------------------------------------------- G-RNG (R1)

def test_grng_world_trajectory_invariant_to_portfolio():
    """§9.4: enabling policies must not shift world draws — pre-disruption
    weekly demand values must be IDENTICAL across portfolios."""
    from .conftest import shared_material_network

    ev = DisruptionEvent(target_id="s1", start=30, duration=8)
    base = scenario(shared_material_network(), [ev], horizon=90, warmup_end=15,
                    analysis_window=60)
    loaded = base.with_policies({
        "safety_stock_materials": {},
        "short_term_capacity": {},
        "material_allocation": {},
        "expedited_shipments": {},
    })
    r0 = run_replication(compile_scenario(base), 0, 0, _resolve_n(base, 15))
    r1 = run_replication(compile_scenario(loaded), 0, 0, _resolve_n(loaded, 15))
    # Demand is a world stream: identical for ALL weeks, not just pre-disruption.
    assert np.array_equal(r0.trace.demand_value, r1.trace.demand_value)


def _resolve_n(sc: Scenario, t_w: int):
    from scsim.disruption.injector import resolve_events
    return resolve_events(compile_scenario(sc).model, warmup_end=t_w, event_rep=0)


# --------------------------------------------------------------- engine guards

def test_ato_products_rejected_as_reserved():
    from scsim.entities.enums import FulfillmentMode

    net = single_chain_network()
    net.products[0].fulfillment_mode = FulfillmentMode.ATO
    with pytest.raises(CompileError, match="reserved"):
        compile_scenario(scenario(net))


def test_planned_policy_rejected_with_milestone_pointer():
    from scsim.policies.registry import PolicyNotImplementedError

    sc = scenario(single_chain_network(),
                  policies={"capacity_reservation": {"reserved_capacity": 10,
                                                     "reservation_fee": 1.0}})
    with pytest.raises(PolicyNotImplementedError, match="M8"):
        compile_scenario(sc)


def test_write_guard_catches_undeclared_write():
    """Debug builds: a policy writing state it didn't declare is an error."""
    from scsim.core.context import WriteGuardError
    from scsim.core.phases import BoundHook, Hook, PhaseId
    from scsim.stats.seeds import world_streams
    from scsim.core.context import SimContext

    compiled = compile_scenario(scenario(single_chain_network()))
    ctx = SimContext(compiled.model, world_streams(1, 0, 0), [], False, debug=True)
    rogue = BoundHook(owner="rogue", hook=Hook(phase=PhaseId.PH40, reads=set(), writes=set()))
    ctx._active_hook = rogue
    with pytest.raises(WriteGuardError, match="not declared"):
        ctx.write_production_plan(np.zeros(compiled.model.n_prods))
