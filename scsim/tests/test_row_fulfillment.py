# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Per-row fulfillment — PLAN.md §24 WP 14.3, ADR 0002 decisions 4 and 5.

A customer × product row may carry its own backorder setting, horizon and
cost, and the project's ONE allocation rule reads per-row priority, price and
service target. P-C.1 then keeps the backlog per row and splits each
product's supply with ``core/allocation.py``; without any of it, the product
path runs exactly as before (the golden digests pin that).
"""
from __future__ import annotations

import hashlib

import numpy as np
import pytest

from scsim import (
    BomLine,
    Customer,
    CustomerLink,
    DisruptionEvent,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.entities.enums import DemandModel, EffectType, TargetType, TraceVerbosity
from scsim.io.traces import trace_frame

from .conftest import make_settings


def _net(demand=150.0, capacity=100.0, links=(("c1", 1.0, None), ("c2", 1.0, None)),
         customers=None) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=demand,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=capacity)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
        customers=customers or [Customer(id=c) for c, _, _ in links],
        customer_links=[CustomerLink(product_id="p1", customer_id=c, share=s, unit_price=pr)
                        for c, s, pr in links],
    )


def _run(net: Network, policies: dict, **settings):
    sc = Scenario(name="rows", network=net, settings=make_settings(model_seeds=1, **settings),
                  policies=policies)
    ctx = run_replication(compile_scenario(sc), 0, 0, [], debug=True)
    agg = {k: v["mean"] for k, v in run_scenario(sc).aggregates.items()}
    return ctx, agg


# ── two rows of one product: one backorders, one loses ─────────────────────

def test_two_rows_one_backorders_one_loses_with_their_own_backlog_cost_and_fill():
    pol = {"unmet_demand_handling": {"rule": "lost_sales", "row_overrides": {
        "c1::p1": {"backorder_allowed": True, "backorder_horizon": 2, "backorder_penalty": 1.0}}}}
    ctx, agg = _run(_net(), pol)
    c1, c2 = ctx.model.row_ids.index("c1::p1"), ctx.model.row_ids.index("c2::p1")
    # The lost-sales row never waits; the backorder row does, within its window.
    assert ctx.backlog_rows[c2] == 0.0
    assert 0.0 < ctx.backlog_rows[c1] <= 2 * 75.0 + 1e-6
    assert ctx.backlog[0] == pytest.approx(ctx.backlog_rows.sum())
    # Lost units and cost are the row's own.
    assert agg["lost_units_row_c2::p1"] > 0.0
    assert agg["backorder_cost_row_c2::p1"] == 0.0
    assert agg["backorder_cost_row_c1::p1"] > 0.0
    assert {"fill_rate_row_c1::p1", "fill_rate_row_c2::p1",
            "fill_rate_customer_c1", "fill_rate_customer_c2"} <= set(agg)


def test_per_row_weeks_conserve_units_and_sum_to_the_product():
    pol = {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 3,
                                     "row_overrides": {"c2::p1": {"backorder_allowed": False}}}}
    sc = Scenario(name="rows", network=_net(), policies=pol,
                  settings=make_settings(model_seeds=1,
                                         trace_verbosity=TraceVerbosity.FULL_DEBUG))
    compiled = compile_scenario(sc)
    ctx = run_replication(compiled, 0, 0, [], debug=True)
    st = ctx.policy_state["unmet_demand_handling.rows"]
    assert st["active"]
    T = ctx.model.settings.horizon
    # Per row over the run: demand = served new + still waiting from it + lost
    # new + expired; summed over rows this is the product's balance.
    d = st["demand"].sum()
    served_new = st["served_new"].sum()
    lost = st["lost"].sum()
    assert d == pytest.approx(T * 150.0)
    # Every unit of demand is served (new or from backlog), lost, or waiting.
    assert ctx.trace.F is not None
    assert served_new <= d
    assert lost > 0
    assert ctx.trace.F.sum() + lost + ctx.backlog.sum() == pytest.approx(d, rel=1e-9)
    # …and the lost-sales row never carries a backlog, the backorder row may.
    c2 = ctx.model.row_ids.index("c2::p1")
    assert ctx.backlog_rows[c2] == 0.0


# ── the rules, under scarcity ──────────────────────────────────────────────

def _fill(agg, row):
    return agg[f"fill_rate_row_{row}::p1"]


def test_revenue_max_serves_the_higher_priced_row_first():
    net = _net(links=(("c1", 1.0, 8.0), ("c2", 1.0, 20.0)))
    ctx, agg = _run(net, {"customer_allocation": {"rule": "revenue_max"}})
    assert ctx.row_allocation["row_level"] and ctx.row_allocation["rule"] == "revenue_max"
    assert _fill(agg, "c2") == pytest.approx(1.0, abs=0.02)
    assert _fill(agg, "c1") < 0.5


def test_a_row_price_override_beats_the_rows_own_price():
    net = _net(links=(("c1", 1.0, 8.0), ("c2", 1.0, 20.0)))
    _, agg = _run(net, {"customer_allocation": {"rule": "revenue_max",
                                                "row_price": {"c1::p1": 50.0}}})
    assert _fill(agg, "c1") == pytest.approx(1.0, abs=0.02)
    assert _fill(agg, "c2") < 0.5


def test_priority_by_row_serves_the_higher_row_priority_first():
    _, agg = _run(_net(), {"customer_allocation": {"rule": "priority",
                                                   "row_priority": {"c2::p1": 5.0}}})
    assert _fill(agg, "c2") == pytest.approx(1.0, abs=0.02)
    assert _fill(agg, "c1") < 0.5


def test_sla_tier_honours_a_row_floor_then_priority():
    # c1 has the higher customer priority; c2's row floor guarantees it 80 %.
    custs = [Customer(id="c1", priority_weight=10.0), Customer(id="c2")]
    _, agg = _run(_net(customers=custs),
                  {"customer_allocation": {"rule": "sla_tier", "row_floor_pct": {"c2::p1": 80.0}}})
    assert _fill(agg, "c2") >= 0.78
    assert _fill(agg, "c2") < 0.95


def test_sla_tier_takes_the_customers_contracted_floor_as_the_row_default():
    custs = [Customer(id="c1", priority_weight=10.0), Customer(id="c2", sla_fill_floor_pct=80.0)]
    ctx, agg = _run(_net(customers=custs), {"customer_allocation": {"rule": "sla_tier"}})
    assert ctx.row_allocation["row_level"]
    assert ctx.row_allocation["floor_pct"][ctx.model.row_ids.index("c2::p1")] == 80.0
    assert _fill(agg, "c2") >= 0.78


def test_fair_share_without_p_c2_splits_by_fill_rate_when_rows_are_active():
    # A row override alone makes the run per-row; with no P-C.2 the rule is
    # P-C.2's own default (fcfs = the equal-fill-rate split).
    pol = {"unmet_demand_handling": {"rule": "lost_sales",
                                     "row_overrides": {"c1::p1": {"backorder_allowed": False}}}}
    _, agg = _run(_net(), pol)
    assert _fill(agg, "c1") == pytest.approx(_fill(agg, "c2"), rel=1e-6)


def test_segment_kpis_are_sums_of_the_rows_when_fulfillment_runs_per_row():
    custs = [Customer(id="c1", segment="key"), Customer(id="c2", segment="spot")]
    net = _net(links=(("c1", 1.0, 8.0), ("c2", 1.0, 20.0)), customers=custs)
    _, agg = _run(net, {"customer_allocation": {"rule": "revenue_max"}})
    assert agg["fill_rate_segment_spot"] == pytest.approx(agg["fill_rate_customer_c2"])
    assert agg["fill_rate_segment_key"] == pytest.approx(agg["fill_rate_customer_c1"])


# ── neutrality ─────────────────────────────────────────────────────────────

def _digest(ctx) -> str:
    h = hashlib.sha256()
    for k, v in trace_frame(ctx).items():
        a = np.asarray(v)
        a = np.round(a, 9) + 0.0 if a.dtype.kind == "f" else a
        h.update(k.encode()); h.update(a.tobytes())
    for k in ("D", "Q", "F", "B", "L"):
        h.update(np.round(getattr(ctx.trace, k), 9).tobytes())
    return h.hexdigest()


@pytest.mark.parametrize("rule", [
    {"rule": "lost_sales"},
    {"rule": "backorder", "backorder_horizon": 3, "backorder_penalty": 0.5},
])
def test_one_row_per_product_per_row_is_byte_identical_to_the_product_path(rule):
    """The exit criterion: forced onto the per-row path (an override that
    restates the project's settings), a network with one row per product runs
    exactly as the product path does — trace and per-item matrices."""
    net = _net(links=(("c1", 1.0, None),))
    throttle = DisruptionEvent(target_type=TargetType.NODE_PLANT, target_id="plant",
                               effect_type=EffectType.CAPACITY_REDUCTION,
                               capacity_factor=0.4, start=20, duration=14)
    settings = make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG)

    def digest(pol):
        sc = Scenario(name="one", network=net, settings=settings, policies=pol,
                      events=[throttle])
        from scsim.disruption.injector import resolve_events
        compiled = compile_scenario(sc)
        events = resolve_events(compiled.model, 10, 0, {})
        return _digest(run_replication(compiled, 0, 0, events, debug=True))

    legacy = digest({"unmet_demand_handling": dict(rule)})
    forced = digest({"unmet_demand_handling": {**rule, "row_overrides": {"c1::p1": {}}}})
    assert legacy == forced


def test_project_wide_settings_stay_on_the_product_path():
    ctx, agg = _run(_net(), {"customer_allocation": {"rule": "priority"},
                             "unmet_demand_handling": {"rule": "backorder"}})
    assert not ctx.policy_state["unmet_demand_handling.rows"]["active"]
    assert ctx.served_new_rows is None
    assert not any(k.startswith(("fill_rate_row_", "fill_rate_customer_")) for k in agg)
    # The rows are still visible: the product backlog split by share.
    assert ctx.backlog_rows.sum() == pytest.approx(ctx.backlog.sum())
