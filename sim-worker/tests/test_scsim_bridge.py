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
