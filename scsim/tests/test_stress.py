"""Stress Test module (Part VI): ST-1/ST-2 batteries, RI, snapshot reuse."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import DisruptionEvent, Scenario
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import RunMode
from scsim.io.snapshots import SnapshotStore, family_digest
from scsim.kpi.compute import resilience_index
from scsim.stress import run_st1, run_st2

from .conftest import dual_source_network, make_settings, single_chain_network


def test_st1_scorecard_shape():
    sc = Scenario(name="st1", network=dual_source_network(),
                  settings=make_settings(model_seeds=2))
    report = run_st1(sc, durations=(5, 10), debug=True)
    assert len(report.cells) == 2 * 2  # 2 suppliers × 2 durations
    for cell in report.cells:
        assert cell.test == "ST-1" and cell.effect == "lead_time_extension"
        assert 0.0 <= cell.ri.ri <= 100.0
        assert "fill_rate" in cell.kpis and "service_loss_area" in cell.kpis
    # ρ_s overlay present (manuscript Figs. 4–5 analogue)
    assert {c.rho_s for c in report.cells} == {100.0}


def test_st1_longer_outage_scores_worse():
    sc = Scenario(name="st1", network=single_chain_network(),
                  settings=make_settings(model_seeds=2))
    report = run_st1(sc, durations=(5, 14), debug=True)
    by_dur = {c.duration_weeks: c for c in report.cells}
    assert by_dur[14].ri.ri <= by_dur[5].ri.ri


def test_st1_vulnerability_ranking():
    sc = Scenario(name="st1", network=dual_source_network(),
                  settings=make_settings(model_seeds=2))
    report = run_st1(sc, durations=(14,), debug=True)
    ranking = report.vulnerability_ranking()
    assert ranking[0]["worst_ri"] <= ranking[-1]["worst_ri"]
    # s1 is the primary (cheaper) source → its outage hurts at least as much.
    assert ranking[0]["supplier_id"] == "s1"


def test_st2_skips_infinite_capacity_suppliers():
    sc = Scenario(name="st2", network=single_chain_network(),
                  settings=make_settings(model_seeds=1))
    report = run_st2(sc, capacity_factors=(0.5,), durations=(4,), debug=True)
    assert not report.cells
    assert report.skipped and "finite supplier capacity" in report.skipped[0]["reason"]


def test_st2_capacity_cells_run():
    sc = Scenario(name="st2",
                  network=single_chain_network(supplier_capacity=120.0),
                  settings=make_settings(model_seeds=1))
    report = run_st2(sc, capacity_factors=(0.5, 0.0), durations=(4,), debug=True)
    assert len(report.cells) == 2
    phi_half, phi_zero = {c.capacity_factor: c for c in report.cells}.values()


def test_fast_scan_badges_cells():
    sc = Scenario(name="st1", network=single_chain_network(),
                  settings=make_settings(model_seeds=2, run_mode=RunMode.FAST_SCAN))
    report = run_st1(sc, durations=(5,), debug=True)
    assert all(c.wide_ci_badge for c in report.cells)


# ----------------------------------------------------------------- snapshots

def test_snapshot_restore_bit_identical():
    """Restoring the warm state must reproduce the full-run trajectory exactly."""
    sc = Scenario(name="snap", network=single_chain_network(),
                  settings=make_settings(model_seeds=1),
                  events=[DisruptionEvent(target_id="s1", start=20, duration=14)])
    compiled = compile_scenario(sc)
    from scsim.disruption.injector import resolve_events
    events = resolve_events(compiled.model, 10, 0)

    plain = run_replication(compiled, 0, 0, events)

    store = SnapshotStore()
    digest = family_digest(sc)
    warm = run_replication(compile_scenario(sc), 0, 0, events,
                           snapshot_store=store, snapshot_digest=digest, warmup_week=10)
    assert len(store) == 1
    resumed = run_replication(compile_scenario(sc), 0, 0, events,
                              snapshot_store=store, snapshot_digest=digest, warmup_week=10)
    assert np.array_equal(plain.trace.fill_rate, resumed.trace.fill_rate)
    assert np.array_equal(plain.trace.demand_value, resumed.trace.demand_value)
    assert np.array_equal(plain.on_hand, resumed.on_hand)


def test_family_digest_ignores_events_and_name():
    sc = Scenario(name="a", network=single_chain_network(), settings=make_settings())
    sc2 = sc.model_copy(update={
        "name": "b",
        "events": [DisruptionEvent(target_id="s1", start=20, duration=5)],
    }, deep=True)
    assert family_digest(sc) == family_digest(sc2)
    sc3 = sc.with_policies({"expedited_shipments": {}})
    assert family_digest(sc) != family_digest(sc3)


# ------------------------------------------------------------------------ RI

def test_resilience_index_bounds_and_monotonicity():
    perfect = resilience_index(0.0, 0.0, 52.0, 0.0, 52, clean_revenue=1e6)
    assert perfect.ri == pytest.approx(100.0)
    worse_sla = resilience_index(10.0, 0.0, 52.0, 0.0, 52, clean_revenue=1e6)
    assert worse_sla.ri < perfect.ri
    assert worse_sla.sla_norm == pytest.approx(10.0 / 52.0)


def test_resilience_index_weights_must_sum_to_one():
    with pytest.raises(ValueError, match="sum to 1"):
        resilience_index(0, 0, 0, 0, 52, 1.0, weights=(0.5, 0.5, 0.5, 0.5))
