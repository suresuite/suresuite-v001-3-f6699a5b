# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""P-P.13 production lead time — PLAN.md §25 WP 15.4, ADR 0003.

Output started in week t completes in week t + L. Materials are consumed at the
start, MTS completions replenish FG stock, MTO completions ship against demand
and backlog, work in progress is traced (and charged nothing). The plan offsets
by the EXPECTED L only — gate ``plan-from-demand``: perturbing the realized
future (demand draws AND production lead-time draws) changes no plan value.
L = 0, the default, is today's same-week completion, byte-identical (the frozen
golden digests prove it for every reference scenario).
"""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

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
from scsim.entities.enums import DemandModel, FulfillmentMode, LeadTimeDist, TraceVerbosity

from .conftest import make_settings

BACKORDER = {"unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 8}}
STEP = [100.0] * 20 + [150.0] * 80   # the forecast steps up in week 20


def _net(mode=FulfillmentMode.MTO, forecast=None, **product) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0, initial_on_hand=1_000_000.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=1000.0,
                          fulfillment_mode=mode, **product)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
        customers=[Customer(id="c1")],
        customer_links=[CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                                     demand_model="deterministic",
                                     **({"forecast": forecast} if forecast else {"demand_mean": 100.0}))],
    )


def _run(net, policies=BACKORDER):
    sc = Scenario(name="plt", network=net, policies=policies,
                  settings=make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG))
    return run_replication(compile_scenario(sc), 0, 0, [], debug=True)


def _trace_bytes(ctx) -> bytes:
    return b"".join(v.tobytes() for k, v in sorted(vars(ctx.trace).items())
                    if isinstance(v, np.ndarray))


# ── validation ───────────────────────────────────────────────────────────────

def test_a_bounded_production_lead_time_validates_its_bounds():
    Product(id="p", unit_price=1, demand_mode=1, production_capacity=1,
            production_lead_time_weeks=2, production_lead_time_dist="uniform",
            production_lead_time_min_weeks=1, production_lead_time_max_weeks=3)
    with pytest.raises(ValidationError, match="min ≤ max"):
        Product(id="p", unit_price=1, demand_mode=1, production_capacity=1,
                production_lead_time_weeks=2, production_lead_time_dist="uniform",
                production_lead_time_min_weeks=3, production_lead_time_max_weeks=1)
    with pytest.raises(ValidationError, match="reserved"):
        Product(id="p", unit_price=1, demand_mode=1, production_capacity=1,
                production_lead_time_dist="empirical")


def test_zero_lead_time_is_the_same_week_completion_byte_identical():
    a = _run(_net())
    b = _run(_net(production_lead_time_weeks=0, production_lead_time_dist="deterministic"))
    assert _trace_bytes(a) == _trace_bytes(b)
    assert not compile_scenario(Scenario(name="x", network=_net(),
                                         settings=make_settings())).model.has_prod_lt


# ── the worked example: L = 2, deterministic demand ─────────────────────────

def test_worked_example_mto_l2_starts_two_weeks_ahead_and_fg_ships_on_time():
    ctx = _run(_net(forecast=STEP, production_lead_time_weeks=2))
    tr = ctx.trace
    started, demand, served = tr.Q[0], tr.D[0], tr.F[0]
    # Weeks 0–1 have nothing completing (the pipeline starts empty); from then
    # on, with deterministic demand, every week's completion is that week's demand.
    assert started[5:18].tolist() == pytest.approx([100.0] * 13)
    # The forecast steps to 150 in week 20 — the starts step in week 18, two weeks
    # earlier, so the completions meet the step exactly when it arrives.
    assert started[18:30].tolist() == pytest.approx([150.0] * 12)
    assert served[8:40].tolist() == pytest.approx(demand[8:40].tolist())
    assert tr.B[0, 8:40].tolist() == pytest.approx([0.0] * 32)
    # Work in progress is two weeks of starts.
    assert tr.WIP[0, 10] == pytest.approx(200.0)
    assert tr.WIP[0, 25] == pytest.approx(300.0)
    assert tr.wip_units[25] == pytest.approx(300.0)
    assert tr.wip_value[25] == pytest.approx(600.0)  # 300 × the 2.0 material cost


def test_without_the_offset_the_step_would_be_two_weeks_late():
    ctx = _run(_net(forecast=STEP))
    assert ctx.trace.Q[0, 18:20].tolist() == pytest.approx([100.0, 100.0])
    assert ctx.trace.Q[0, 20] == pytest.approx(150.0)


def test_materials_are_consumed_at_the_start():
    late = _run(_net(production_lead_time_weeks=3)).trace
    now = _run(_net()).trace
    # Week 0 starts 100 under both and the material stock is the same: the start
    # consumed it, though nothing completed (and nothing shipped) under L = 3.
    assert late.Q[0, 0] == now.Q[0, 0] == pytest.approx(100.0)
    assert late.I_mat[0, 0] == pytest.approx(now.I_mat[0, 0])
    assert now.F[0, 0] == pytest.approx(100.0) and late.F[0, 0] == pytest.approx(0.0)


def test_conservation_started_equals_completed_plus_wip():
    ctx = _run(_net(production_lead_time_weeks=2, production_lead_time_dist="uniform",
                    production_lead_time_min_weeks=1, production_lead_time_max_weeks=3))
    tr = ctx.trace
    started = tr.Q[0].cumsum()
    # Completed through week t = started through week t − WIP at the end of week t.
    completed = started - tr.WIP[0]
    assert np.all(np.diff(completed) >= -1e-9)
    assert completed[-1] <= started[-1] + 1e-9


def test_mts_completions_replenish_fg_two_weeks_later():
    net = _net(mode=FulfillmentMode.MTS, production_lead_time_weeks=2, fg_base_stock=300.0)
    ctx = _run(net)
    tr = ctx.trace
    # In steady state the plant starts one week of demand and FG holds S at the
    # end of each week — the WIP covers the two weeks in between.
    assert tr.Q[0, 15:30].tolist() == pytest.approx([100.0] * 15)
    assert tr.F[0, 15:30].tolist() == pytest.approx(tr.D[0, 15:30].tolist())
    assert tr.WIP[0, 20] == pytest.approx(200.0)


def test_wip_carries_no_holding_cost():
    a = run_scenario(Scenario(name="a", network=_net(), policies=BACKORDER,
                              settings=make_settings(model_seeds=1)))
    b = run_scenario(Scenario(name="b", network=_net(production_lead_time_weeks=2),
                              policies=BACKORDER, settings=make_settings(model_seeds=1)))
    assert b.work_in_progress is not None and b.work_in_progress["mean_units"] == pytest.approx(200.0)
    assert a.work_in_progress is None
    hold = [k for k in a.aggregates if "holding" in k]
    for k in hold:
        assert b.aggregates[k]["mean"] == pytest.approx(a.aggregates[k]["mean"]), k


# ── CRN: the production-time draws are world streams, per product ───────────

def test_two_policy_sets_see_the_same_production_lead_time_draws():
    net = _net(production_lead_time_weeks=2, production_lead_time_dist="normal",
               production_lead_time_cv=0.5)
    base = Scenario(name="a", network=net, policies=BACKORDER, settings=make_settings())
    other = base.with_policies({"inventory_control": {"policy_type": "periodic"}})
    a = run_replication(compile_scenario(base), 0, 0, [])
    b = run_replication(compile_scenario(other), 0, 0, [])
    assert a.prod_lt_variates.any()
    assert np.array_equal(a.prod_lt_variates, b.prod_lt_variates)
    # …and the supplier lead-time stream is untouched by them.
    assert a.streams.leadtime.bit_generator.state == b.streams.leadtime.bit_generator.state


# ── honesty: the plan never reads a realized future draw ───────────────────

def test_production_lead_time_never_reads_future_draws():
    """gate `plan-from-demand`, extended to P-P.13: the start a week plans, and
    every later plan column, are unchanged when the realized future — demand draws
    AND drawn production lead times beyond this week — is scrambled."""
    net = _net(forecast=STEP, production_lead_time_weeks=2,
               production_lead_time_dist="triangular", production_lead_time_min_weeks=1,
               production_lead_time_mode_weeks=2, production_lead_time_max_weeks=3)
    links = [cl.model_copy(update={"demand_model": "normal", "demand_variation": 0.3})
             for cl in net.customer_links]
    net = net.model_copy(update={"customer_links": links})
    sc = Scenario(name="honest", network=net, policies=BACKORDER,
                  settings=make_settings(model_seeds=1))
    real = engine._mech_default_plan
    checked = []

    def spy(model, ctx):
        real(model, ctx)
        if ctx.week == 12:
            before = (ctx.production_plan.copy(), ctx.planned_production.copy())
            rng = np.random.default_rng(7)
            ctx.demand_schedule_rows[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule_rows[:, 13:].shape)
            ctx.demand_schedule[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule[:, 13:].shape)
            ctx.prod_lt_variates[:, 13:] = rng.uniform(0, 1, ctx.prod_lt_variates[:, 13:].shape)
            real(model, ctx)
            checked.append(np.array_equal(before[0], ctx.production_plan)
                           and np.array_equal(before[1], ctx.planned_production))

    hooks = engine._MECHANIC_HOOKS
    i = next(k for k, h in enumerate(hooks) if h[0] == "mech.default_plan")
    orig = hooks[i]
    hooks[i] = (orig[0], orig[1], spy)
    try:
        # Compiled AFTER the patch: mechanics are bound at compile.
        compiled = compile_scenario(sc)
        compiled.model.plan_horizon = 6
        run_replication(compiled, 0, 0, [], debug=True)
    finally:
        hooks[i] = orig
    assert checked == [True]


def test_the_later_plan_columns_are_offset_too():
    sc = Scenario(name="h", network=_net(forecast=STEP, production_lead_time_weeks=2),
                  policies=BACKORDER, settings=make_settings(model_seeds=1))
    compiled = compile_scenario(sc)
    compiled.model.plan_horizon = 6
    seen = {}
    real = engine.plan_ahead

    def spy(model, ctx, want0, plan0):
        real(model, ctx, want0, plan0)
        if ctx.week == 15:
            seen["p"] = ctx.planned_production.copy()

    import pytest as _pt
    mp = _pt.MonkeyPatch()
    mp.setattr(engine, "plan_ahead", spy)
    try:
        run_replication(compiled, 0, 0, [], debug=True)
    finally:
        mp.undo()
    # Week 15 + k starts complete at 17 + k: the step (week 20) is planned at k = 3.
    assert seen["p"][0].tolist() == pytest.approx([100, 100, 100, 150, 150, 150])
