"""sim-worker ↔ scsim bridge: legacy graph in, broadcast-shaped KPIs out.

Run with:  cd sim-worker && python -m pytest tests/ -v
Requires the scsim package (pip install -e ../scsim).
"""
from __future__ import annotations

import networkx as nx
import pytest

pytest.importorskip("scsim")

from sim_worker.scsim_bridge import compute_kpis_scsim, scsim_enabled  # noqa: E402


def _typed_graph() -> nx.DiGraph:
    g = nx.DiGraph()
    g.add_node("sup1", node_type="supplier", name="Supplier A")
    g.add_node("sup2", node_type="supplier", name="Supplier B")
    g.add_node("mat1", node_type="material", name="Material X")
    g.add_node("prod1", node_type="product", name="Product P",
               weekly_demand=100.0, unit_price=10.0)
    g.add_node("cust1", node_type="customer", name="Customer Z")
    g.add_edge("sup1", "mat1", edge_type="supply", lead_time=2.0, unit_price=1.0)
    g.add_edge("sup2", "mat1", edge_type="supply", lead_time=3.0, unit_price=1.3)
    g.add_edge("mat1", "prod1", edge_type="bom", consumption_rate=1.0)
    g.add_edge("prod1", "cust1", edge_type="outbound", volume=100.0)
    return g


def _policies() -> dict:
    return {"default": {
        "inventory": {"type": "min_max", "safety_stock_method": "fixed_days",
                      "safety_stock_days": 7.0},
        "fulfillment": {"backorder_allowed": False},
        "sourcing": {"strategy": "primary_backup"},
        "recovery": {"response": ["expedite_freight"]},
    }}


def test_bridge_returns_broadcast_shape():
    out = compute_kpis_scsim(_typed_graph(), _policies(), n_weeks=60, seed=7, n_reps=2)
    assert out["source"] == "scsim"
    assert out["engine_version"]
    assert "mean_fill_rate" in out and "ci_fill_rate" in out
    assert 0.0 <= out["mean_fill_rate"] <= 1.0
    # Back-compat aliases for the existing realtime handler.
    assert out["fill_rate"] == out["mean_fill_rate"]
    assert "otif" in out and "revenue" in out


def test_bridge_runs_disruption_schedule():
    schedule = [{"target": "sup1", "target_type": "supplier",
                 "start_day": 140, "duration_days": 70, "magnitude_pct": 100}]
    base = compute_kpis_scsim(_typed_graph(), _policies(), n_weeks=60, seed=7,
                              n_reps=2)
    hit = compute_kpis_scsim(_typed_graph(), _policies(), n_weeks=60, seed=7,
                             n_reps=2, disruption_schedule=schedule)
    assert hit["mean_fill_rate"] <= base["mean_fill_rate"]
    assert isinstance(hit["scsim_notes"], list)


def test_flag_off_by_default(monkeypatch):
    monkeypatch.delenv("SCSIM_ENGINE", raising=False)
    assert scsim_enabled() is False
    monkeypatch.setenv("SCSIM_ENGINE", "1")
    assert scsim_enabled() is True


def _project_data(replications: int = 3):
    from sim_worker.datamap import build_project_data

    return build_project_data(
        suppliers=[{"supplier_id": "S1", "name": "S1"}],
        materials=[{"material_id": "M1", "cost": 4.0, "initial_on_hand": 200}],
        products=[{"product_id": "P1", "sell_price": 25.0, "production_capacity": 900,
                   "demand_mean": 300, "demand_cv": 0.2}],
        inbound=[{"supplier_id": "S1", "material_id": "M1", "unit_price": 4.0, "lead_time": 2}],
        bom=[{"product_id": "P1", "material_id": "M1", "consumption_rate": 1.0}],
        outbound=[{"product_id": "P1", "customer_id": "C1", "unit_price": 25.0,
                   "volume": 300, "time_unit": "week"}],
        policies={"default": {"inventory": {"type": "min_max"}}},
        scenario={"horizon_days": 365, "seed": 1, "replications": replications, "crn": True},
        project_model="make_to_stock",
    )


def test_run_from_project_streams_each_replication():
    """on_replication receives every rep live, in the exact persistence shape
    the final `replications` list carries (streamed upserts stay idempotent)."""
    from sim_worker.scsim_bridge import compute_run_from_project

    streamed: list[tuple[dict, int, int]] = []
    out = compute_run_from_project(
        _project_data(replications=3),
        on_replication=lambda rep, done, total: streamed.append((rep, done, total)),
    )

    assert [d for _, d, _ in streamed] == [1, 2, 3]
    assert all(t == 3 for _, _, t in streamed)
    assert len(out["replications"]) == 3

    for (rep, done, _), final in zip(streamed, out["replications"]):
        assert rep["rep_index"] == done - 1 == final["rep_index"]
        assert rep["seed_used"] == final["seed_used"]
        assert set(rep["kpis"]) == set(final["kpis"])
        for k, v in rep["kpis"].items():  # engine NaN sentinels arrive as None
            assert v == final["kpis"][k]
        assert rep["time_series"]["fill_rate"] == final["time_series"]["fill_rate"]
        # warmup is only known at run end — the final upsert fills it in.
        assert rep["warmup_at"] is None


def test_replication_payloads_are_strict_json():
    """The engine reports unmeasured KPIs as NaN (e.g. capacity_utilization
    without full-debug matrices); json.dumps would emit a literal NaN token —
    invalid JSON that PostgREST rejects, silently dropping every
    run_replications upsert. The bridge must map non-finite floats to None so
    every persisted payload is strict-JSON round-trippable."""
    import json
    import math

    from sim_worker.scsim_bridge import compute_run_from_project

    streamed: list[dict] = []
    out = compute_run_from_project(
        _project_data(replications=2),
        on_replication=lambda rep, done, total: streamed.append(rep),
    )

    def assert_strict(payload):
        s = json.dumps(payload, allow_nan=False)  # raises on NaN/inf
        json.loads(s)

    for rep in streamed + out["replications"]:
        assert_strict(rep["kpis"])
        assert_strict(rep["time_series"])
    # sentinel KPIs survive as None, not NaN
    for rep in out["replications"]:
        for v in rep["kpis"].values():
            assert v is None or math.isfinite(v)
    # the aggregate broadcast shape is strict-JSON too
    assert_strict({k: v for k, v in out.items() if k != "replications"})


def test_run_from_project_observer_errors_do_not_break_the_run():
    from sim_worker.scsim_bridge import compute_run_from_project

    def boom(rep, done, total):
        raise RuntimeError("observer bug")

    out = compute_run_from_project(_project_data(replications=2), on_replication=boom)
    assert out["source"] == "scsim"
    assert len(out["replications"]) == 2
