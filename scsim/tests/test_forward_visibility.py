"""P-C.6 forward_visibility + P-P.1 forward_visible basis (§II.4 / §III-D.6).

Golden #6: the WSC-2026 MTO coverage formula. Min-max levels must equal the
BoM-exploded forward order book summed INCLUSIVELY over the coverage window,
trajectory-exactly, every week:

    s_m[t] = Σ_{τ=t}^{t+T_s}   D̂_m[τ]        (T_s + 1 terms)
    S_m[t] = Σ_{τ=t}^{t+T_s+κ} D̂_m[τ]

Stationary demand collapses to D̄·(T_s+1) / D̄·(T_s+κ+1) — exactly one
boundary term above the Days-of-supply basis (§II.4).
"""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from scsim import DisruptionEvent, Lane, Network, Scenario
from scsim.core.engine import CompileError, compile_scenario, run_replication, run_scenario
from scsim.core.phases import BoundHook, Hook, PhaseId
from scsim.entities.enums import TransportMode
from scsim.io.snapshots import SnapshotStore, family_digest
from scsim.io.traces import trace_frame
from scsim.policies.builtin.p_p1_inventory_control import (
    InventoryControlParams,
    _primary_link_lts,
)

from .conftest import (
    bom_blocked_network,
    dual_source_network,
    make_settings,
    single_chain_network,
)

KAPPA_NOMINAL = 8  # P-P.1 default strip 8/10/12

FWD_POLICIES = {
    "forward_visibility": {},
    "inventory_control": {"basis": "forward_visible"},
}


def scenario(net: Network, events=None, policies=None, **settings_kw) -> Scenario:
    return Scenario(
        name="fwd", network=net, settings=make_settings(**settings_kw),
        events=events or [], policies=policies or {},
    )


def _probe_levels(compiled) -> list[tuple[int, np.ndarray, np.ndarray]]:
    """Append a read-only PH-70 probe recording (week, s, S) after all residents."""
    recorded: list[tuple[int, np.ndarray, np.ndarray]] = []
    bh = BoundHook(
        owner="test_probe",
        hook=Hook(phase=PhaseId.PH70, priority=99),
        is_mechanic=True,
    )
    compiled.dispatch[PhaseId.PH70].append(
        (99, bh, lambda ctx: recorded.append(
            (ctx.week, ctx.level_s.copy(), ctx.level_S.copy())))
    )
    return recorded


def _levels_by_week(recorded) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    # week 0 appears twice (warm-start PH-70 chain + the loop); last wins.
    return {t: (s, S) for t, s, S in recorded}


# --------------------------------------- golden #6: trajectory-exact coverage

def test_golden6_levels_equal_forward_window_sums():
    """Stochastic (triangular) demand: s/S track the realized forward book
    inclusively over T_s / T_s+κ — the §II.4 formula, week by week."""
    sc = scenario(single_chain_network(deterministic=False), policies=FWD_POLICIES)
    compiled = compile_scenario(sc)
    recorded = _probe_levels(compiled)
    ctx = run_replication(compiled, 0, 0, [])

    m = compiled.model
    lt = int(m.link_lt[m.primary_link][0])
    fwd_mat = np.asarray(m.bom.T @ ctx.demand_schedule)
    by_week = _levels_by_week(recorded)
    horizon = m.settings.horizon
    assert set(by_week) == set(range(horizon))
    for t in range(horizon):
        s, S = by_week[t]
        np.testing.assert_allclose(
            s, fwd_mat[:, t:t + lt + 1].sum(axis=1), atol=1e-9,
            err_msg=f"s_m[{t}] is not the inclusive T_s-window forward sum")
        np.testing.assert_allclose(
            S, fwd_mat[:, t:t + lt + KAPPA_NOMINAL + 1].sum(axis=1), atol=1e-9,
            err_msg=f"S_m[{t}] is not the inclusive (T_s+κ)-window forward sum")
    # Non-stationary book ⇒ the levels genuinely move week to week.
    s_series = np.array([by_week[t][0][0] for t in range(horizon)])
    assert s_series.std() > 0.0


def test_golden6_stationary_collapse_is_one_boundary_term():
    """Deterministic demand: forward levels are constant at D̄·(T_s+1) /
    D̄·(T_s+κ+1) — exactly one D̄ above the Days-of-supply basis (§II.4)."""
    net = single_chain_network()  # deterministic, D̄ = 100, lt = 2
    fwd = compile_scenario(scenario(net, policies=FWD_POLICIES))
    rec_fwd = _probe_levels(fwd)
    run_replication(fwd, 0, 0, [])

    dos = compile_scenario(scenario(net))  # built-in default basis
    rec_dos = _probe_levels(dos)
    run_replication(dos, 0, 0, [])

    m = fwd.model
    lt = int(m.link_lt[m.primary_link][0])
    d_bar = float(m.exp_demand_m[0])
    for t, (s, S) in _levels_by_week(rec_fwd).items():
        assert s[0] == pytest.approx(d_bar * (lt + 1)), t
        assert S[0] == pytest.approx(d_bar * (lt + KAPPA_NOMINAL + 1)), t
    for t, (s, S) in _levels_by_week(rec_dos).items():
        assert s[0] == pytest.approx(d_bar * lt), t
        assert S[0] == pytest.approx(d_bar * (lt + KAPPA_NOMINAL)), t


# ------------------------------------------------- determinism & world physics

def test_forward_run_byte_identical_across_runs():
    sc = scenario(single_chain_network(deterministic=False), policies=FWD_POLICIES)
    t1 = trace_frame(run_replication(compile_scenario(sc), 0, 0, []))
    t2 = trace_frame(run_replication(compile_scenario(sc), 0, 0, []))
    for key in t1:
        assert t1[key].tobytes() == t2[key].tobytes(), f"column {key} not byte-identical"


def test_visibility_never_moves_the_world_demand():
    """The forward policies are an information lever: realized demand is the
    same trajectory with or without them (G-RNG invariance, §9.4)."""
    net = single_chain_network(deterministic=False)
    base = run_replication(compile_scenario(scenario(net)), 0, 0, [])
    fwd = run_replication(compile_scenario(scenario(net, policies=FWD_POLICIES)), 0, 0, [])
    assert base.trace.demand_value.tobytes() == fwd.trace.demand_value.tobytes()
    assert base.demand_schedule.tobytes() == fwd.demand_schedule.tobytes()


def test_forward_window_well_defined_at_horizon_end():
    """The τ* lookahead tail keeps full inclusive windows available at t=H−1."""
    sc = scenario(single_chain_network(deterministic=False), policies=FWD_POLICIES)
    compiled = compile_scenario(sc)
    ctx = run_replication(compiled, 0, 0, [])
    m = compiled.model
    H = m.settings.horizon
    lt = int(m.link_lt[m.primary_link][0])
    fwd_mat = np.asarray(m.bom.T @ ctx.demand_schedule)
    want = fwd_mat[:, H - 1:H + lt + KAPPA_NOMINAL].sum(axis=1)
    np.testing.assert_allclose(
        ctx.forward_material_demand(H - 1, lt + KAPPA_NOMINAL), want, atol=1e-9)
    # Defensive clamp: a window past the drawn schedule truncates, not raises.
    partial = ctx.forward_material_demand(H - 1, 10_000)
    np.testing.assert_allclose(partial, fwd_mat[:, H - 1:].sum(axis=1), atol=1e-9)


def test_snapshot_restore_bit_identical_under_forward_basis():
    sc = Scenario(name="fwd-snap", network=single_chain_network(deterministic=False),
                  settings=make_settings(model_seeds=1),
                  events=[DisruptionEvent(target_id="s1", start=20, duration=14)],
                  policies=FWD_POLICIES)
    compiled = compile_scenario(sc)
    from scsim.disruption.injector import resolve_events
    events = resolve_events(compiled.model, 10, 0)

    plain = run_replication(compiled, 0, 0, events)
    store = SnapshotStore()
    digest = family_digest(sc)
    run_replication(compile_scenario(sc), 0, 0, events,
                    snapshot_store=store, snapshot_digest=digest, warmup_week=10)
    resumed = run_replication(compile_scenario(sc), 0, 0, events,
                              snapshot_store=store, snapshot_digest=digest, warmup_week=10)
    assert np.array_equal(plain.trace.fill_rate, resumed.trace.fill_rate)
    assert np.array_equal(plain.on_hand, resumed.on_hand)


# --------------------------------------------------------------- feasibility

def test_forward_basis_requires_visibility_policy():
    sc = scenario(single_chain_network(),
                  policies={"inventory_control": {"basis": "forward_visible"}})
    with pytest.raises(CompileError, match="forward_visibility"):
        compile_scenario(sc)


def test_forward_basis_rejects_mts_products():
    from scsim.entities.enums import FulfillmentMode
    net = single_chain_network()
    prod = net.products[0].model_copy(update={"fulfillment_mode": FulfillmentMode.MTS})
    net = net.model_copy(update={"products": [prod]})
    with pytest.raises(CompileError, match="MTO-only"):
        compile_scenario(scenario(net, policies=FWD_POLICIES))


def test_forward_windows_must_fit_visibility():
    """T_s + κ_crisis > τ* is a hard error (§II.4 selectability rule)."""
    sc = scenario(single_chain_network(), policies={
        "forward_visibility": {"visibility_horizon": 5},   # lt=2, κ_crisis=12 → 14 > 5
        "inventory_control": {"basis": "forward_visible"},
    })
    with pytest.raises(CompileError, match="T_s"):
        compile_scenario(sc)


def test_visibility_cannot_exceed_drawn_schedule():
    sc = scenario(single_chain_network(), policies={
        "forward_visibility": {"visibility_horizon": 60},  # settings default τ* = 52
        "inventory_control": {"basis": "forward_visible"},
    })
    with pytest.raises(CompileError, match="exceeds the drawn forward"):
        compile_scenario(sc)


def test_forward_basis_needs_integral_coverage():
    with pytest.raises(ValidationError, match="integral"):
        InventoryControlParams(basis="forward_visible",
                               coverage_weeks={"nominal": 8.5, "alert": 10, "crisis": 12})


def test_visibility_warns_when_nothing_reads_the_book():
    """No forward consumer → compile succeeds with the inert-investment warning."""
    sc = scenario(single_chain_network(),
                  policies={"forward_visibility": {}, "inventory_control": {}})
    compiled = compile_scenario(sc)
    assert any(i.code == "no_forward_consumer" for i in compiled.feasibility_warnings)


# ------------------------------------------------------------ helper lockstep

def test_primary_link_lt_helper_matches_compiled_model():
    """The feasibility helper must mirror CompiledModel's primary selection
    (cost, lt, supplier sort) and lane lead-time folding exactly."""
    laned = single_chain_network()
    laned = laned.model_copy(update={"lanes": [
        Lane(id="sea", supplier_id="s1", mode=TransportMode.DEFAULT, lead_time_weeks=3),
    ]})
    for net in (single_chain_network(), dual_source_network(),
                bom_blocked_network(), laned):
        m = compile_scenario(scenario(net)).model
        helper = _primary_link_lts(net)
        for mat_id, i in m.mat_index.items():
            assert helper[mat_id] == int(m.link_lt[m.primary_link[i]]), (net, mat_id)
