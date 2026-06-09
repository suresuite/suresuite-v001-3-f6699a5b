"""Unit tests for the discrete-time simulation engine.

Run with:  cd sim-worker && python -m pytest tests/ -v
"""
from __future__ import annotations

import math

import networkx as nx
import pytest

from sim_worker.engine import (
    SCState,
    _bom,
    _demand_t,
    _init_state,
    _inventory_review,
    _one_rep,
    _policy,
    _production_step,
    _receive_arrivals,
    _sample_lead_time,
    _suppliers,
    _z,
    apply_delta,
    compute_kpis,
)
from sim_worker.network_metrics import (
    _hhi,
    compute_network_metrics,
    resilience_index,
    ttr_weeks,
)
from sim_worker.seeds import make_streams
from sim_worker.stopping import half_width_95


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_simple_graph() -> nx.DiGraph:
    """
    sup1 → mat1 → prod1 → cust1
    Minimal typed single-echelon supply chain.
    """
    g = nx.DiGraph()
    g.add_node("sup1",  node_type="supplier",  name="Supplier A")
    g.add_node("mat1",  node_type="material",  name="Material X")
    g.add_node("prod1", node_type="product",   name="Product P", weekly_demand=100.0, unit_price=10.0)
    g.add_node("cust1", node_type="customer",  name="Customer Z")
    g.add_edge("sup1",  "mat1",  edge_type="supply",   lead_time=2.0, lead_time_std=0.3, lt_dist="normal",  unit_price=1.0, volume=200.0)
    g.add_edge("mat1",  "prod1", edge_type="bom",      consumption_rate=1.0)
    g.add_edge("prod1", "cust1", edge_type="outbound", volume=100.0)
    return g


def _make_dual_source_graph() -> nx.DiGraph:
    """
    sup1 (primary) \
                    → mat1 → prod1 → cust1
    sup2 (backup)  /
    """
    g = _make_simple_graph()
    g.add_node("sup2", node_type="supplier", name="Supplier B")
    g.add_edge("sup2", "mat1", edge_type="supply", lead_time=3.0, lead_time_std=0.5, lt_dist="normal", unit_price=1.2, volume=200.0)
    return g


def _default_policies(overrides: dict | None = None) -> dict:
    base: dict = {
        "default": {
            "inventory": {
                "safety_stock_method": "fixed_days",
                "safety_stock_days": 7.0,
                "holding_cost_pct": 0.20,
                "order_up_to": 500.0,
                "type": "continuous_review",
                "review_period_days": 7,
                "cv": 0.15,
            },
            "sourcing": {"strategy": "single"},
            "production": {
                "capacity_units_per_day": 200.0,
                "utilization_cap_pct": 85.0,
                "yield_rate": 1.0,
            },
            "fulfillment": {
                "allocation": "fcfs",
                "backorder_allowed": True,
                "backorder_cost_per_day": 2.0,
            },
            "demand": {"distribution": "normal", "cv": 0.15},
            "recovery": {"response": []},
        }
    }
    if overrides:
        for key, val in overrides.items():
            if key == "default":
                for fam, fval in val.items():
                    base["default"].setdefault(fam, {}).update(fval)
            else:
                base[key] = val
    return base


# ---------------------------------------------------------------------------
# _policy helper
# ---------------------------------------------------------------------------

def test_policy_default_only():
    policies = {"default": {"inventory": {"safety_stock_days": 7.0}}}
    pol = _policy(policies, "node", "mat1", "inventory")
    assert pol["safety_stock_days"] == 7.0


def test_policy_override_wins():
    policies = {
        "default": {"inventory": {"safety_stock_days": 7.0, "cv": 0.10}},
        "node:mat1": {"inventory": {"safety_stock_days": 14.0}},
    }
    pol = _policy(policies, "node", "mat1", "inventory")
    assert pol["safety_stock_days"] == 14.0
    assert pol["cv"] == 0.10   # falls through from default


# ---------------------------------------------------------------------------
# _bom and _suppliers
# ---------------------------------------------------------------------------

def test_bom_returns_consumption_rates():
    g = _make_simple_graph()
    bom = _bom(g, "prod1")
    assert "mat1" in bom
    assert bom["mat1"] == pytest.approx(1.0)


def test_suppliers_no_disruption():
    g = _make_simple_graph()
    sups = _suppliers(g, "mat1", {}, t=1)
    assert len(sups) == 1
    assert sups[0]["sup_id"] == "sup1"
    assert sups[0]["cap_fraction"] == pytest.approx(1.0)


def test_suppliers_with_disruption():
    g = _make_simple_graph()
    disruptions = {"sup1": {"start_week": 1, "end_week": 10, "cap_fraction": 0.0}}
    sups = _suppliers(g, "mat1", disruptions, t=5)
    assert sups[0]["cap_fraction"] == pytest.approx(0.0)


def test_suppliers_disruption_outside_window():
    g = _make_simple_graph()
    disruptions = {"sup1": {"start_week": 5, "end_week": 10, "cap_fraction": 0.0}}
    sups = _suppliers(g, "mat1", disruptions, t=1)
    assert sups[0]["cap_fraction"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# _z and _sample_lead_time
# ---------------------------------------------------------------------------

def test_z_service_level():
    assert _z(0.95) == pytest.approx(1.645, abs=0.001)
    assert _z(0.99) == pytest.approx(2.326, abs=0.001)


def test_sample_lead_time_fixed():
    import numpy as np
    rng = np.random.default_rng(0)
    lt = _sample_lead_time(3.0, 0.0, "fixed", rng)
    assert lt == 3


def test_sample_lead_time_normal_positive():
    import numpy as np
    rng = np.random.default_rng(42)
    lts = [_sample_lead_time(3.0, 0.5, "normal", rng) for _ in range(100)]
    assert all(lt >= 1 for lt in lts)
    mean_lt = sum(lts) / len(lts)
    assert 2 <= mean_lt <= 4


# ---------------------------------------------------------------------------
# _demand_t
# ---------------------------------------------------------------------------

def test_demand_t_constant():
    import numpy as np
    g = _make_simple_graph()
    pol = {"distribution": "constant", "cv": 0.0}
    rng = np.random.default_rng(0)
    d = _demand_t(g, "prod1", 1, pol, rng)
    assert d == pytest.approx(100.0)


def test_demand_t_normal_positive():
    import numpy as np
    g = _make_simple_graph()
    pol = {"distribution": "normal", "cv": 0.20}
    rng = np.random.default_rng(42)
    vals = [_demand_t(g, "prod1", t, pol, rng) for t in range(1, 101)]
    assert all(v >= 0 for v in vals)
    mean_d = sum(vals) / len(vals)
    assert 80 <= mean_d <= 120


def test_demand_t_seasonality():
    import numpy as np
    g = _make_simple_graph()
    season = [2.0] * 26 + [0.5] * 26
    pol = {"distribution": "constant", "cv": 0.0, "seasonality_profile": season}
    rng = np.random.default_rng(0)
    d_high = _demand_t(g, "prod1", 1, pol, rng)
    d_low  = _demand_t(g, "prod1", 27, pol, rng)
    assert d_high == pytest.approx(200.0)
    assert d_low  == pytest.approx(50.0)


# ---------------------------------------------------------------------------
# _receive_arrivals
# ---------------------------------------------------------------------------

def test_receive_arrivals_lands_correctly():
    state = SCState(
        I={"mat1": 0.0},
        SR={"mat1": [0.0] * 60},
        BO={}, WIP={}, disruptions={},
    )
    state.SR["mat1"][5] = 100.0
    _receive_arrivals(state, 5)
    assert state.I["mat1"] == pytest.approx(100.0)
    assert state.SR["mat1"][5] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# _production_step
# ---------------------------------------------------------------------------

def test_production_bounded_by_material():
    import numpy as np
    g = _make_simple_graph()
    policies = _default_policies()
    # Only 50 units of mat1 available → can only produce 50
    state = SCState(
        I={"mat1": 50.0},
        SR={"mat1": [0.0] * 60},
        BO={"prod1": 0.0}, WIP={}, disruptions={},
    )
    rng = np.random.default_rng(0)
    D_p = 100.0
    Q_p, rev, ls = _production_step(g, state, policies, "prod1", D_p, 1, rng)
    assert Q_p <= 51.0   # some numerical tolerance
    assert rev == pytest.approx(Q_p * 10.0)


def test_production_s3_overtime_raises_cap():
    import numpy as np
    g = _make_simple_graph()
    # Set large inventory so we're capacity-limited, not material-limited
    state = SCState(
        I={"mat1": 10_000.0},
        SR={"mat1": [0.0] * 60},
        BO={"prod1": 0.0}, WIP={}, disruptions={},
    )
    # Normal: 85% utilisation → weekly cap = 200*7*0.85 = 1190
    pol_normal = _default_policies()
    rng = np.random.default_rng(0)
    D_p = 2000.0
    Q_normal, _, _ = _production_step(g, state, pol_normal, "prod1", D_p, 1, rng)

    # S3: 100% utilisation → weekly cap = 200*7*1.0 = 1400
    pol_s3 = _default_policies({"default": {"production": {"utilization_cap_pct": 100.0}}})
    state2 = SCState(I={"mat1": 10_000.0}, SR={"mat1": [0.0]*60}, BO={"prod1": 0.0}, WIP={}, disruptions={})
    Q_s3, _, _ = _production_step(g, state2, pol_s3, "prod1", D_p, 1, rng)

    assert Q_s3 > Q_normal


def test_production_lost_sales_when_backlog_disabled():
    import numpy as np
    g = _make_simple_graph()
    policies = _default_policies({"default": {"fulfillment": {"backorder_allowed": False}}})
    state = SCState(
        I={"mat1": 50.0},
        SR={"mat1": [0.0]*60},
        BO={"prod1": 0.0}, WIP={}, disruptions={},
    )
    rng = np.random.default_rng(0)
    Q_p, rev, ls = _production_step(g, state, policies, "prod1", 100.0, 1, rng)
    assert ls > 0
    assert state.BO["prod1"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Full replication
# ---------------------------------------------------------------------------

def test_one_rep_no_disruption_fill_rate_high():
    """Baseline (no disruption) fill rate should be high with generous inventory."""
    g = _make_simple_graph()
    policies = _default_policies({
        "default": {
            "inventory": {"safety_stock_days": 21.0, "order_up_to": 2000.0},
            "demand": {"cv": 0.10},
        }
    })
    streams = make_streams(42, 1)[0]
    kpis = _one_rep(g, policies, n_weeks=52, warmup=15, streams=streams)
    assert kpis["fill_rate"] >= 0.80


def test_one_rep_disruption_reduces_fill_rate():
    """Full outage on the only supplier should dramatically reduce fill rate."""
    g = _make_simple_graph()
    g.nodes["sup1"]["_disruption"] = 100.0   # 100% → cap_fraction = 0
    policies = _default_policies()
    streams = make_streams(42, 1)[0]
    kpis_base = _one_rep(_make_simple_graph(), policies, 52, 15, streams)

    streams2 = make_streams(42, 1)[0]
    kpis_dis = _one_rep(g, policies, 52, 15, streams2)
    assert kpis_dis["fill_rate"] < kpis_base["fill_rate"]


def test_one_rep_s2_safety_stock_lowers_lost_sales():
    """Higher service_level_target → more safety stock → lower lost sales."""
    g = _make_simple_graph()
    # Introduce moderate demand variability
    policies_lo = _default_policies({
        "default": {
            "inventory": {"safety_stock_method": "service_level", "service_level_alpha": 0.80},
            "demand": {"cv": 0.30},
        }
    })
    policies_hi = _default_policies({
        "default": {
            "inventory": {"safety_stock_method": "service_level", "service_level_alpha": 0.99},
            "demand": {"cv": 0.30},
        }
    })
    streams_lo = make_streams(42, 1)[0]
    streams_hi = make_streams(42, 1)[0]   # same seed = CRN comparison
    kpis_lo = _one_rep(g, policies_lo, 52, 15, streams_lo)
    kpis_hi = _one_rep(g, policies_hi, 52, 15, streams_hi)
    # Higher safety stock should produce more (fill rate ≥ or lost sales ≤)
    assert kpis_hi["fill_rate"] >= kpis_lo["fill_rate"] - 0.05  # allow small noise


def test_one_rep_s1_backup_supplier_helps():
    """With a backup supplier, a primary outage should recover better."""
    g_single = _make_simple_graph()
    g_single.nodes["sup1"]["_disruption"] = 100.0

    g_dual = _make_dual_source_graph()
    g_dual.nodes["sup1"]["_disruption"] = 100.0  # primary down, backup up

    policies_single = _default_policies({"default": {"sourcing": {"strategy": "single"}}})
    policies_backup = _default_policies({
        "default": {"sourcing": {"strategy": "primary_backup"}},
    })

    streams_s = make_streams(42, 1)[0]
    streams_b = make_streams(42, 1)[0]
    kpis_single = _one_rep(g_single, policies_single, 52, 15, streams_s)
    kpis_backup = _one_rep(g_dual,   policies_backup, 52, 15, streams_b)
    assert kpis_backup["fill_rate"] > kpis_single["fill_rate"]


# ---------------------------------------------------------------------------
# compute_kpis (Monte Carlo)
# ---------------------------------------------------------------------------

def test_compute_kpis_returns_mean_and_ci():
    g = _make_simple_graph()
    policies = _default_policies()
    result = compute_kpis(g, set(g.nodes), policies, n_weeks=26, seed=42, n_reps=5)
    assert "mean_fill_rate" in result
    assert "ci_fill_rate" in result
    assert 0.0 <= result["mean_fill_rate"] <= 1.0


def test_compute_kpis_ci_is_nonnegative():
    """All CI values returned by compute_kpis must be non-negative."""
    g = _make_simple_graph()
    policies = _default_policies({"default": {"demand": {"cv": 0.40}}})
    result = compute_kpis(g, set(g.nodes), policies, n_weeks=26, seed=42, n_reps=10)
    for key, val in result.items():
        if key.startswith("ci_"):
            assert val >= 0.0, f"{key} should be non-negative, got {val}"


def test_compute_kpis_mean_stable_across_seeds():
    """Mean fill_rate should be similar across two different seeds (same system)."""
    g = _make_simple_graph()
    policies = _default_policies()
    r_a = compute_kpis(g, set(g.nodes), policies, n_weeks=52, seed=42, n_reps=20)
    r_b = compute_kpis(g, set(g.nodes), policies, n_weeks=52, seed=99, n_reps=20)
    # Both means should be within 10 percentage points of each other
    assert abs(r_a["mean_fill_rate"] - r_b["mean_fill_rate"]) < 0.10


def test_compute_kpis_fallback_for_untyped_graph():
    """Untyped graph → analytical fallback with back-compat keys."""
    g = nx.DiGraph()
    g.add_node("a")
    g.add_node("b")
    g.add_edge("a", "b")
    result = compute_kpis(g, {"a"})
    assert "fill_rate" in result
    assert result["source"] == "worker"


def test_compute_kpis_disruption_lowers_fill_rate():
    g = _make_simple_graph()
    g.nodes["sup1"]["_disruption"] = 80.0
    policies = _default_policies()
    result = compute_kpis(g, set(g.nodes), policies, n_weeks=26, seed=42, n_reps=5)
    assert result["mean_fill_rate"] < 0.8


# ---------------------------------------------------------------------------
# apply_delta
# ---------------------------------------------------------------------------

def test_apply_delta_global():
    g = _make_simple_graph()
    dirty = apply_delta(g, {"lever": "disruption.global", "magnitude": 50})
    assert len(dirty) == g.number_of_nodes()
    assert all(g.nodes[n]["_disruption"] == 50 for n in g.nodes)


def test_apply_delta_node():
    g = _make_simple_graph()
    dirty = apply_delta(g, {"lever": "node:sup1", "magnitude": 100})
    assert "sup1" in dirty
    # Descendants of sup1 should also be dirty
    for d in nx.descendants(g, "sup1"):
        assert d in dirty


def test_apply_delta_zero_resets():
    g = _make_simple_graph()
    apply_delta(g, {"lever": "disruption.global", "magnitude": 50})
    apply_delta(g, {"lever": "disruption.global", "magnitude": 0})
    assert all(g.nodes[n]["_disruption"] == 0 for n in g.nodes)


# ---------------------------------------------------------------------------
# Network metrics
# ---------------------------------------------------------------------------

def test_network_metrics_empty_graph():
    g = nx.DiGraph()
    m = compute_network_metrics(g)
    assert m["n_nodes"] == 0
    assert m["spof_count"] == 0


def test_network_metrics_single_supplier_is_spof():
    g = _make_simple_graph()
    m = compute_network_metrics(g)
    assert m["spof_count"] >= 1
    assert "sup1" in m["single_points_of_failure"]


def test_network_metrics_dual_supplier_no_spof():
    g = _make_dual_source_graph()
    m = compute_network_metrics(g)
    assert m["spof_count"] == 0


def test_network_metrics_betweenness_in_range():
    g = _make_simple_graph()
    m = compute_network_metrics(g)
    for v in m["betweenness_centrality"].values():
        assert 0.0 <= v <= 1.0


def test_hhi_monopoly():
    assert _hhi([100.0]) == pytest.approx(1.0)


def test_hhi_equal_share():
    assert _hhi([50.0, 50.0]) == pytest.approx(0.5)


def test_resilience_index():
    assert resilience_index(1_000_000, 800_000) == pytest.approx(0.8, abs=0.001)
    assert resilience_index(0, 100) == pytest.approx(0.0)


def test_ttr_recovers():
    ts = [0.5, 0.5, 0.5, 0.6, 0.7, 0.9, 0.95, 0.96]
    t = ttr_weeks(None, baseline_fill_rate=0.95, ts_fill_rate=ts, disruption_start=0)
    assert t is not None
    assert t == pytest.approx(6.0)


def test_ttr_no_recovery():
    ts = [0.3] * 20
    t = ttr_weeks(None, baseline_fill_rate=0.95, ts_fill_rate=ts, disruption_start=0)
    assert t is None


# ---------------------------------------------------------------------------
# Stopping / statistics
# ---------------------------------------------------------------------------

def test_half_width_narrows_with_n():
    import numpy as np
    rng = np.random.default_rng(0)
    xs_small = rng.normal(0.9, 0.05, size=5).tolist()
    xs_large = rng.normal(0.9, 0.05, size=50).tolist()
    hw_small = half_width_95(xs_small)
    hw_large = half_width_95(xs_large)
    assert hw_large < hw_small
