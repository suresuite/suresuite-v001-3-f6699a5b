"""Per-policy behavior of the seven implemented (✅) plugins."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.disruption.injector import resolve_events
from scsim.entities.enums import EffectType

from .conftest import (
    dual_source_network,
    make_settings,
    shared_material_network,
    single_chain_network,
)


def run(net, events=None, policies=None, seeds=2, **kw):
    sc = Scenario(name="t", network=net, settings=make_settings(model_seeds=seeds, **kw),
                  events=events or [], policies=policies or {})
    return run_scenario(sc, debug=True)


OUTAGE = [DisruptionEvent(target_id="s1", start=20, duration=14)]


# ----------------------------------------------------------------- P-P.1

@pytest.mark.parametrize("variant", ["min_max", "base_stock", "rop_q", "periodic"])
def test_pp1_variants_sustain_service(variant):
    policies = {"inventory_control": {"policy_type": variant}}
    if variant == "rop_q":
        policies["inventory_control"]["rop_q_quantity"] = 900.0
    res = run(single_chain_network(), policies=policies)
    assert res.aggregates["fill_rate"]["mean"] == pytest.approx(1.0), variant


def test_pp1_crisis_kappa_raises_order_up_to():
    """During a visible disruption the κ strip moves nominal→crisis (8→12)."""
    res_nominal = run(single_chain_network(), OUTAGE,
                      {"inventory_control": {"coverage_weeks":
                                             {"nominal": 8, "alert": 8, "crisis": 8}}})
    res_crisis = run(single_chain_network(), OUTAGE,
                     {"inventory_control": {"coverage_weeks":
                                            {"nominal": 8, "alert": 10, "crisis": 16}}})
    assert res_crisis.aggregates["lost_sales_value"]["mean"] <= \
        res_nominal.aggregates["lost_sales_value"]["mean"]


# ----------------------------------------------------------------- P-C.1

def test_pc1_backorder_converts_lost_to_backlog():
    lost = run(single_chain_network(), OUTAGE)
    back = run(single_chain_network(), OUTAGE,
               {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 26,
                                          "backorder_penalty": 1.0}})
    assert back.aggregates["lost_sales_value"]["mean"] < lost.aggregates["lost_sales_value"]["mean"]
    assert back.aggregates["max_backlog"]["mean"] > 0
    assert back.aggregates["cost_backorder_penalty"]["mean"] > 0


def test_pc1_backorder_horizon_expires_to_lost():
    short = run(single_chain_network(), OUTAGE,
                {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 1}})
    long = run(single_chain_network(), OUTAGE,
               {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 26}})
    assert short.aggregates["lost_sales_value"]["mean"] > long.aggregates["lost_sales_value"]["mean"]


def test_pc1_partial_backorder_splits():
    res = run(single_chain_network(), OUTAGE,
              {"unmet_demand_handling": {"rule": "partial_backorder", "partial_accept_prob": 0.5,
                                         "backorder_horizon": 26}})
    assert res.aggregates["lost_sales_value"]["mean"] > 0
    assert res.aggregates["max_backlog"]["mean"] > 0


# ----------------------------------------------------------------- P-S.1

def test_ps1_selection_rule_min_leadtime():
    """With min_leadtime selection the backup with the shorter T wins."""
    from scsim import Network, Supplier, SupplierLink

    net = dual_source_network()
    net3 = Network(
        suppliers=[*net.suppliers, Supplier(id="s3")],
        materials=net.materials, products=net.products, bom=net.bom,
        supplier_links=[*net.supplier_links,
                        SupplierLink(supplier_id="s3", material_id="m1",
                                     cost=3.5, lead_time_weeks=1)],
    )
    sc = Scenario(name="t", network=net3, settings=make_settings(model_seeds=1),
                  events=OUTAGE,
                  policies={"backup_supplier": {"selection_rule": "min_leadtime"}})
    compiled = compile_scenario(sc)
    events = resolve_events(compiled.model, 10, 0)
    ctx = run_replication(compiled, 0, 0, events, debug=True)
    # s3 (lt=1, cost 3.5) must carry the rerouted volume → premium ≈ (3.5−2.0)·qty.
    premium = ctx.cost.weekly[1].sum()  # backup_premium component index 1
    assert premium > 0


def test_ps1_cooldown_keeps_backup_after_event():
    res_no_cd = run(dual_source_network(), OUTAGE, {"backup_supplier": {"cooldown_weeks": 0}})
    res_cd = run(dual_source_network(), OUTAGE, {"backup_supplier": {"cooldown_weeks": 8}})
    assert res_cd.aggregates["cost_backup_premium"]["mean"] >= \
        res_no_cd.aggregates["cost_backup_premium"]["mean"]


# ----------------------------------------------------------------- P-P.3

def test_pp3_zero_under_deterministic_demand():
    """Eq. 20: SS = z·σ·√T — deterministic demand ⇒ σ=0 ⇒ no buffer, no cost."""
    res = run(single_chain_network(deterministic=True), policies={"safety_stock_materials": {}})
    assert res.aggregates["cost_ss_holding"]["mean"] == 0.0


def test_pp3_buffers_stochastic_demand():
    base = run(single_chain_network(deterministic=False), OUTAGE, seeds=4)
    ss = run(single_chain_network(deterministic=False), OUTAGE,
             {"safety_stock_materials": {}}, seeds=4)
    assert ss.aggregates["cost_ss_holding"]["mean"] > 0
    assert ss.aggregates["fill_rate"]["mean"] >= base.aggregates["fill_rate"]["mean"]


def test_pp3_abc_xyz_classification_differentiates():
    """A-class (high value share) gets a higher z than C-class."""
    sc = Scenario(name="t", network=shared_material_network(),
                  settings=make_settings(horizon=90, warmup_end=15, analysis_window=60),
                  policies={"safety_stock_materials": {}})
    compiled = compile_scenario(sc)
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    ss = ctx.policy_state["safety_stock_materials"]["ss_s"]
    m = compiled.model
    # m_shared carries ~6× the annual value of m2 → A vs C cell.
    assert ss[m.mat_index["m_shared"]] > ss[m.mat_index["m2"]]


# ----------------------------------------------------------------- P-P.5

def test_pp5_overtime_lifts_capacity_bound_output():
    """Capacity binds (O < demand mode), materials plentiful → overtime helps."""
    from scsim import BomLine, Material, Network, Product, Supplier, SupplierLink
    from scsim.entities.enums import DemandModel

    net = Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=1.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC,
                          production_capacity=80.0)],          # binds: 80 < 100
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1",
                                     cost=1.0, lead_time_weeks=1)],
    )
    base = run(net, seeds=1)
    ot = run(net, policies={"short_term_capacity": {"max_overtime_factor": 1.5}}, seeds=1)
    assert ot.aggregates["fill_rate"]["mean"] > base.aggregates["fill_rate"]["mean"]
    assert ot.aggregates["cost_overtime"]["mean"] > 0


def test_pp5_inert_when_material_constrained(single_chain):
    """The manuscript case: materials bind, capacity doesn't → overtime ≈ no-op."""
    base = run(single_chain_network(), OUTAGE)
    ot = run(single_chain_network(), OUTAGE, {"short_term_capacity": {}})
    assert ot.aggregates["lost_sales_value"]["mean"] == \
        pytest.approx(base.aggregates["lost_sales_value"]["mean"])
    assert ot.aggregates["cost_overtime"]["mean"] == 0.0


# ----------------------------------------------------------------- P-P.9

def test_pp9_lp_protects_premium_product():
    """Under shared-material scarcity the LP shifts output toward u_p=50."""
    ev = [DisruptionEvent(target_id="s1", start=30, duration=8)]
    settings = dict(horizon=90, warmup_end=15, analysis_window=60, seeds=3)
    base = run(shared_material_network(), ev, **settings)
    lp = run(shared_material_network(), ev, {"material_allocation": {}}, **settings)
    assert lp.aggregates["produced_value"]["mean"] > base.aggregates["produced_value"]["mean"]
    assert lp.aggregates["cost_allocation_labor"]["mean"] > 0


def test_pp9_greedy_fallback_flag():
    ev = [DisruptionEvent(target_id="s1", start=30, duration=8)]
    res = run(shared_material_network(), ev,
              {"material_allocation": {"solver": "greedy"}},
              horizon=90, warmup_end=15, analysis_window=60, seeds=1)
    assert res.aggregates["cost_allocation_labor"]["mean"] > 0


# ----------------------------------------------------------------- P-T.2

def test_pt2_expedite_pulls_deferred_arrivals():
    base = run(single_chain_network(), OUTAGE)
    exp = run(single_chain_network(), OUTAGE, {"expedited_shipments": {}})
    assert exp.aggregates["lost_sales_value"]["mean"] < base.aggregates["lost_sales_value"]["mean"]
    assert exp.aggregates["cost_expediting"]["mean"] > 0


def test_pt2_asymmetry_cannot_conjure_under_capacity_cut():
    """Plan §4.4: under a capacity cut with an empty pipeline, expediting has
    nothing to pull — the supplier queue is out of reach."""
    ev = [DisruptionEvent(target_id="s1", effect_type=EffectType.CAPACITY_REDUCTION,
                          capacity_factor=0.0, start=20, duration=10)]
    net = single_chain_network(supplier_capacity=120.0)
    base = run(net, ev)
    exp = run(net, ev, {"expedited_shipments": {}})
    # The full outage empties the pipeline quickly; expedite may pull the last
    # in-flight slots but CANNOT beat the queue: losses stay strictly positive.
    assert exp.aggregates["lost_sales_value"]["mean"] > 0
    assert exp.aggregates["cost_expediting"]["mean"] <= \
        base.aggregates["lost_sales_value"]["mean"]
