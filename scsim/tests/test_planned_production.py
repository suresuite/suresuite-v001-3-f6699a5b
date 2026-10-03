# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Planned production and FG policies — PLAN.md §24 WP 14.4, ADR 0002 decisions 1, 3, 6.

The design doc's §2 worked example (two rows, capacity 180, fair share) and
each FG policy's §3.2 example, reproduced exactly; days of cover moving with
the forecast; FG opening stock; P-P.4 never added on top of a typed level; and
the honesty rule extended to the plan — the projection reads the centres the
world draws around, never a realized future draw.
"""
from __future__ import annotations

import numpy as np
import pytest

import scsim.core.engine as engine
from scsim import (
    BomLine,
    Customer,
    CustomerLink,
    Material,
    Network,
    Product,
    Scenario,
    Supplier,
    SupplierLink,
)
from scsim.core.engine import compile_scenario, run_replication, run_scenario
from scsim.core.planning import fg_gap, fg_target_for
from scsim.core.planning import plan_ahead as REAL_PLAN_AHEAD
from scsim.entities.enums import DemandModel, FgPolicy, FulfillmentMode, TraceVerbosity

from .conftest import make_settings

C1_FORECAST = [60.0, 60.0, 80.0, 160.0, 100.0] + [100.0] * 80


def _example(**product) -> Network:
    """§2: C1 forecasts 60, 60, 80, 160, 100 …; C2 runs a model with mean 40;
    P1 has capacity 180/wk and needs 2 × M1."""
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0, initial_on_hand=100_000.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=140.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=180.0,
                          **product)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=2.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
        customers=[Customer(id="c1"), Customer(id="c2")],
        customer_links=[
            CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                         demand_model="deterministic", forecast=C1_FORECAST),
            CustomerLink(product_id="p1", customer_id="c2", share=1.0,
                         demand_model="deterministic", demand_mean=40.0),
        ],
    )


def _plans(net: Network, policies: dict, H: int, monkeypatch, weeks=(0,), settings=None):
    """Run one replication with a planning horizon of H weeks and capture the
    plan PH-40 made in each of ``weeks`` (``ctx.planned_production``)."""
    sc = Scenario(name="plan", network=net, policies=policies,
                  settings=settings or make_settings(model_seeds=1))
    compiled = compile_scenario(sc)
    compiled.model.plan_horizon = H
    seen: dict[int, dict] = {}
    real = REAL_PLAN_AHEAD

    def spy(model, ctx, want0, plan0):
        real(model, ctx, want0, plan0)
        if ctx.week in weeks:
            seen[ctx.week] = {"planned": ctx.planned_production.copy(),
                              "req": ctx.plan_requirement.copy(),
                              "projected": ctx.plan_projected_demand.copy(),
                              "fg_target": ctx.fg_target.copy(),
                              "fg_start": (ctx.fg_on_hand + ctx.fg_served_backlog
                                           + ctx.fg_served_new).copy()}

    monkeypatch.setattr(engine, "plan_ahead", spy)
    run_replication(compiled, 0, 0, [], debug=True)
    return seen


# ── §2's worked example ────────────────────────────────────────────────────

BACKORDER = {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 2},
             "customer_allocation": {"rule": "fair_share"}}


def test_the_worked_example_plans_160_in_week_5_when_both_rows_backorder(monkeypatch):
    p = _plans(_example(), BACKORDER, H=6, monkeypatch=monkeypatch)[0]
    assert p["projected"][0].tolist() == [100, 100, 120, 200, 140, 140]
    # Week 4 is capped at 180; its 20 short split 16 / 4 by fair share and both
    # carry, so week 5 plans 140 + 20.
    assert p["planned"][0].tolist() == pytest.approx([100, 100, 120, 180, 160, 140])


def test_and_144_when_c1_is_lost_sales(monkeypatch):
    pol = {"unmet_demand_handling": {**BACKORDER["unmet_demand_handling"],
                                     "row_overrides": {"c1::p1": {"backorder_allowed": False}}},
           "customer_allocation": {"rule": "fair_share"}}
    p = _plans(_example(), pol, H=6, monkeypatch=monkeypatch)[0]
    assert p["planned"][0].tolist() == pytest.approx([100, 100, 120, 180, 144, 140])


def test_the_requirement_is_uncapped_and_the_plan_is_min_of_requirement_and_capacity(monkeypatch):
    p = _plans(_example(), BACKORDER, H=6, monkeypatch=monkeypatch)[0]
    assert p["req"][0, 3] == pytest.approx(200.0)
    assert np.allclose(p["planned"], np.minimum(p["req"], 180.0))


def test_with_h_1_the_plan_is_this_weeks_production_plan():
    sc = Scenario(name="h1", network=_example(), policies=BACKORDER,
                  settings=make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG))
    ctx = run_replication(compile_scenario(sc), 0, 0, [], debug=True)
    assert ctx.planned_production.shape == (1, 1)
    assert np.allclose(ctx.trace.PLAN, np.minimum(ctx.trace.REQ, 180.0))
    # …and the realized run carries the week-4 shortfall into week 5 the same way.
    assert ctx.trace.PLAN[0, 4] == pytest.approx(160.0)


# ── honesty: the plan never reads a realized future draw ───────────────────

def test_the_plan_does_not_read_future_draws(monkeypatch):
    net = _example()
    links = [cl.model_copy(update={"demand_model": "normal", "demand_variation": 0.3})
             for cl in net.customer_links]
    net = net.model_copy(update={"customer_links": links})
    sc = Scenario(name="honest", network=net, policies=BACKORDER,
                  settings=make_settings(model_seeds=1))
    compiled = compile_scenario(sc)
    compiled.model.plan_horizon = 6
    real = REAL_PLAN_AHEAD
    checked = []

    def spy(model, ctx, want0, plan0):
        real(model, ctx, want0, plan0)
        if ctx.week == 12:
            before = ctx.planned_production.copy()
            # Scramble every draw after this week, and plan again.
            rng = np.random.default_rng(1)
            ctx.demand_schedule_rows[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule_rows[:, 13:].shape)
            ctx.demand_schedule[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule[:, 13:].shape)
            real(model, ctx, want0, plan0)
            checked.append(np.array_equal(before, ctx.planned_production))

    monkeypatch.setattr(engine, "plan_ahead", spy)
    run_replication(compiled, 0, 0, [], debug=True)
    assert checked == [True]


# ── FG policies: the §3.2 examples, exactly ────────────────────────────────

def _mts(**kw) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0, initial_on_hand=100_000.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=1000.0,
                          fulfillment_mode=FulfillmentMode.MTS, **kw)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
    )


def _model(**kw):
    return compile_scenario(Scenario(name="fg", network=_mts(**kw),
                                     settings=make_settings(model_seeds=1))).model


def test_base_stock_s300_demand_100_start_250_produces_150():
    m = _model(fg_base_stock=300.0)
    target = fg_target_for(m, np.array([100.0]), np.array([100.0]))
    assert fg_gap(m, target, np.array([250.0 - 100.0])).tolist() == [150.0]


def test_min_max_s100_S400_demand_100_start_180_produces_320_and_250_produces_nothing():
    m = _model(fg_policy=FgPolicy.MIN_MAX, fg_reorder_point=100.0, fg_base_stock=400.0)
    target = fg_target_for(m, np.array([100.0]), np.array([100.0]))
    assert fg_gap(m, target, np.array([180.0 - 100.0])).tolist() == [320.0]
    assert fg_gap(m, target, np.array([250.0 - 100.0])).tolist() == [0.0]


def test_days_of_cover_d14_targets_two_weeks_of_the_forecast():
    m = _model(fg_policy=FgPolicy.DAYS_OF_COVER, fg_cover_days=14.0)
    assert fg_target_for(m, np.array([0.0]), np.array([70.0])).tolist() == [140.0]
    assert fg_target_for(m, np.array([0.0]), np.array([140.0])).tolist() == [280.0]


def test_days_of_cover_moves_with_the_forecast_in_a_run(monkeypatch):
    net = _mts(fg_policy=FgPolicy.DAYS_OF_COVER, fg_cover_days=14.0)
    net = net.model_copy(update={
        "customers": [Customer(id="c1")],
        "customer_links": [CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                                        demand_model="deterministic",
                                        forecast=[70.0] * 20 + [140.0] * 80)],
    })
    seen = _plans(net, {}, H=1, monkeypatch=monkeypatch, weeks=(10, 30))
    assert seen[10]["fg_target"].tolist() == pytest.approx([140.0])
    assert seen[30]["fg_target"].tolist() == pytest.approx([280.0])


def test_min_max_runs_and_builds_only_below_s(monkeypatch):
    net = _mts(fg_policy=FgPolicy.MIN_MAX, fg_reorder_point=150.0, fg_base_stock=400.0)
    sc = Scenario(name="mm", network=net, settings=make_settings(
        model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG))
    ctx = run_replication(compile_scenario(sc), 0, 0, [], debug=True)
    built = ctx.trace.Q[0]
    # Demand 100/wk from S = 400: build 0, 0 while ≥ s, then up to S — lumps, not a trickle.
    assert set(np.round(built[built > 0])) <= {250.0, 300.0}
    assert (built == 0).sum() > len(built) // 3


def test_fg_opening_stock_is_where_mts_starts(monkeypatch):
    seen = _plans(_mts(fg_initial_on_hand=500.0), {}, H=1, monkeypatch=monkeypatch, weeks=(0,))
    assert seen[0]["fg_start"].tolist() == pytest.approx([500.0])


def test_a_typed_s_is_the_target_and_p_p4_adds_nothing_on_top(monkeypatch):
    pol = {"fg_safety_stock": {"sizing": "fixed_days", "fixed_days_cover": 7.0}}
    typed = _plans(_mts(fg_base_stock=300.0), pol, H=1, monkeypatch=monkeypatch, weeks=(10,))
    derived = _plans(_mts(), pol, H=1, monkeypatch=monkeypatch, weeks=(10,))
    assert typed[10]["fg_target"].tolist() == pytest.approx([300.0])
    # Untyped: today's derivation, the forecast plus P-P.4's buffer.
    assert derived[10]["fg_target"].tolist() == pytest.approx([200.0])


def test_min_max_needs_both_levels_and_s_below_S():
    with pytest.raises(ValueError, match="min_max needs"):
        _mts(fg_policy=FgPolicy.MIN_MAX, fg_base_stock=400.0)
    with pytest.raises(ValueError, match="s < S"):
        _mts(fg_policy=FgPolicy.MIN_MAX, fg_reorder_point=400.0, fg_base_stock=400.0)
    with pytest.raises(ValueError, match="days_of_cover needs"):
        _mts(fg_policy=FgPolicy.DAYS_OF_COVER)


def test_the_plan_reaches_the_inspection_series():
    sc = Scenario(name="insp", network=_example(), policies=BACKORDER,
                  settings=make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG))
    res = run_scenario(sc, debug=True)
    assert res.item_series is not None
    for k in ("product.projected_demand", "product.requirement", "product.planned",
              "product.production"):
        assert k in res.item_series
