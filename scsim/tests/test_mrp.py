# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""MRP for materials — PLAN.md §24 WP 14.5, design doc §3.4, ADR 0002 decision 1.

Golden #7 is the design doc's §2 worked example, week by week. The other tests
pin the textbook MRP record, coexistence with reorder-point materials, the
demand-step probe, the plan's honesty reaching gross requirements, and late
receipts.
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
from scsim.core.engine import compile_scenario, run_replication
from scsim.core.planning import plan_ahead as REAL_PLAN_AHEAD
from scsim.entities.enums import DemandModel, TraceVerbosity

from .conftest import make_settings

REAL_INIT = engine._initialize_state


def _start(monkeypatch, on_hand: dict[str, float], pipeline: dict[tuple[str, int], float]):
    """Replace the warm start's opening stock and in-transit priming with an
    exact state: ``on_hand`` per material, ``pipeline[(material, slot)]`` on the
    primary link (slot w is usable from week w)."""
    def init(compiled, ctx):
        REAL_INIT(compiled, ctx)
        m = compiled.model
        ctx.pipeline[:] = 0.0
        for mid, q in on_hand.items():
            ctx.on_hand[m.mat_index[mid]] = q
        for (mid, slot), q in pipeline.items():
            ctx.pipeline[m.primary_link[m.mat_index[mid]], slot % m.ring_width] = q
    monkeypatch.setattr(engine, "_initialize_state", init)


def _settings(**kw):
    return make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG, **kw)


# ── Golden #7: the design doc's §2 worked example, exact ───────────────────

def _worked_example(moq=250.0) -> Network:
    return Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=140.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=180.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=2.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2, moq=moq)],
        customers=[Customer(id="c1"), Customer(id="c2")],
        customer_links=[
            CustomerLink(product_id="p1", customer_id="c1", share=1.0, demand_model="deterministic",
                         forecast=[60.0, 60.0, 80.0, 160.0, 100.0] + [100.0] * 80),
            CustomerLink(product_id="p1", customer_id="c2", share=1.0,
                         demand_model="deterministic", demand_mean=40.0),
        ],
    )


MRP = {"inventory_control": {"policy_type": "mrp"},
       "unmet_demand_handling": {"rule": "backorder", "backorder_horizon": 2},
       "customer_allocation": {"rule": "fair_share"}}


def test_golden_7_the_worked_example_week_by_week(monkeypatch):
    """§2: M1 has lead time 2 and MOQ 250; 400 on hand, 200 more usable from
    week 2. Weeks 1–3 order 250 each, arriving weeks 3 / 4 / 5."""
    _start(monkeypatch, {"m1": 400.0}, {("m1", 1): 200.0})
    sc = Scenario(name="g7", network=_worked_example(), policies=MRP, settings=_settings())
    compiled = compile_scenario(sc)
    assert compiled.model.plan_horizon == 3          # longest MRP lead time + 1
    tr = run_replication(compiled, 0, 0, [], debug=True).trace
    weeks = slice(0, 3)                               # the doc's weeks 1–3
    assert tr.PLAN[0, :6].tolist() == pytest.approx([100, 100, 120, 180, 160, 140])
    assert tr.MRP_ON_HAND[0, weeks].tolist() == pytest.approx([200, 200, 210])
    assert tr.MRP_ON_WAY[0, weeks].tolist() == pytest.approx([200, 250, 250])
    assert tr.MRP_NEED[0, weeks].tolist() == pytest.approx([440, 600, 680])
    assert tr.MRP_NET[0, weeks].tolist() == pytest.approx([40, 150, 220])
    assert tr.O_mat[0, weeks].tolist() == pytest.approx([250, 250, 250])
    # Arriving weeks 3 / 4 / 5: on hand after production is 210 in week 3 only
    # because the week-1 order is there, and 100 / 30 in weeks 4 / 5 because the
    # week-2 and week-3 orders are.
    assert tr.MRP_ON_HAND[0, 3:5].tolist() == pytest.approx([100, 30])
    assert tr.Q[0, :6].tolist() == pytest.approx([100, 100, 120, 180, 160, 140])


# ── the textbook record ────────────────────────────────────────────────────

def test_a_lot_for_lot_mrp_record(monkeypatch):
    """The time-phased MRP record (Orlicky, *Material Requirements Planning*,
    1975; the record layout of Vollmann et al., *Manufacturing Planning and
    Control*): lot-for-lot, lead time 1, no safety stock, 25 on hand.
    Computed by hand:

        week                 1   2   3   4   5   6   7   8
        gross requirements  20  40   0  30  50  10   0  20
        projected on hand    5   0   0   0   0   0   0   0
        net requirements     –  35   0  30  50  10   0  20
        planned releases    35   0  30  50  10   0  20   …

    Each release is the next week's net requirement, one lead time earlier."""
    gr = [20.0, 40.0, 0.0, 30.0, 50.0, 10.0, 0.0, 20.0] + [20.0] * 80
    net = Network(
        suppliers=[Supplier(id="s1")], materials=[Material(id="m1", cost=1.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=20.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=1000.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=1.0,
                                     lead_time_weeks=1)],
        customers=[Customer(id="c1")],
        customer_links=[CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                                     demand_model="deterministic", forecast=gr)],
    )
    _start(monkeypatch, {"m1": 25.0}, {})
    sc = Scenario(name="record", network=net, settings=_settings(),
                  policies={"inventory_control": {"policy_type": "mrp"}})
    tr = run_replication(compile_scenario(sc), 0, 0, [], debug=True).trace
    assert tr.Q[0, :8].tolist() == pytest.approx(gr[:8])          # never short
    assert tr.O_mat[0, :7].tolist() == pytest.approx([35, 0, 30, 50, 10, 0, 20])


# ── coexistence ────────────────────────────────────────────────────────────

def test_mrp_and_min_max_materials_coexist_in_one_run():
    net = Network(
        suppliers=[Supplier(id="s1")],
        materials=[Material(id="m1", cost=1.0), Material(id="m2", cost=1.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=1000.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0),
             BomLine(product_id="p1", material_id="m2", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id=m, cost=1.0, lead_time_weeks=2)
                        for m in ("m1", "m2")],
    )
    pol = {"inventory_control": {"policy_type": "min_max",
                                 "material_overrides": {"m1": {"policy_type": "mrp"}}}}
    compiled = compile_scenario(Scenario(name="mix", network=net, policies=pol,
                                         settings=_settings(horizon=60)))
    assert compiled.model.mrp_mask.tolist() == [True, False]
    tr = run_replication(compiled, 0, 0, [], debug=True).trace
    late = slice(10, 50)
    # MRP orders a steady 100 every week; min-max orders in lumps.
    assert tr.O_mat[0, late].tolist() == pytest.approx([100.0] * 40)
    assert (tr.O_mat[1, late] == 0).sum() > 20
    assert tr.L.sum() == 0


# ── the demand-step probe (design doc appendix, probe 2) ───────────────────

def _step_chain() -> Network:
    return Network(
        suppliers=[Supplier(id="s1")], materials=[Material(id="m1", cost=2.0)],
        products=[Product(id="p1", unit_price=10.0, demand_mode=100.0,
                          demand_model=DemandModel.DETERMINISTIC, production_capacity=200.0)],
        bom=[BomLine(product_id="p1", material_id="m1", rate=1.0)],
        supplier_links=[SupplierLink(supplier_id="s1", material_id="m1", cost=2.0,
                                     lead_time_weeks=2)],
        customers=[Customer(id="c1")],
        # The step is in the customer table's forecast — the plan's input in
        # Phase 14 (it never reads realized future demand).
        customer_links=[CustomerLink(product_id="p1", customer_id="c1", share=1.0,
                                     demand_model="deterministic",
                                     forecast=[100.0] * 25 + [150.0] * 80)],
    )


def _lost(policy_type: str) -> float:
    pol = {"inventory_control": {"policy_type": policy_type,
                                 "coverage_weeks": {"nominal": 2, "alert": 2, "crisis": 2}},
           "unmet_demand_handling": {"rule": "lost_sales"}}
    sc = Scenario(name="step", network=_step_chain(), policies=pol, settings=_settings(horizon=80))
    tr = run_replication(compile_scenario(sc), 0, 0, [], debug=True).trace
    return float(tr.L[:, 10:80].sum())


def test_the_demand_step_loses_nothing_under_mrp_and_units_under_min_max():
    assert _lost("mrp") == 0.0
    assert _lost("min_max") > 0.0


# ── honesty: gross requirements never read a realized future draw ──────────

def test_gross_requirements_and_orders_do_not_read_future_draws(monkeypatch):
    net = _worked_example(moq=0.0)
    links = [cl.model_copy(update={"demand_model": "normal", "demand_variation": 0.3})
             for cl in net.customer_links]
    net = net.model_copy(update={"customer_links": links})

    def run(scramble: bool):
        def spy(model, ctx, want0, plan0):
            if scramble and ctx.week == 12:
                rng = np.random.default_rng(3)
                ctx.demand_schedule_rows[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule_rows[:, 13:].shape)
                ctx.demand_schedule[:, 13:] = rng.uniform(0, 1e4, ctx.demand_schedule[:, 13:].shape)
            REAL_PLAN_AHEAD(model, ctx, want0, plan0)
        monkeypatch.setattr(engine, "plan_ahead", spy)
        sc = Scenario(name="honest", network=net, policies=MRP, settings=_settings())
        return run_replication(compile_scenario(sc), 0, 0, [], debug=True).trace

    a, b = run(False), run(True)
    assert np.array_equal(a.MRP_NEED[:, :13], b.MRP_NEED[:, :13])
    assert np.array_equal(a.O_mat[:, :13], b.O_mat[:, :13])


# ── late receipts and material shortage ────────────────────────────────────

def test_late_receipts_count_orders_the_supplier_cannot_ship_on_time():
    from scsim.core.engine import run_scenario

    def kpis(cap):
        net = _step_chain()
        net = net.model_copy(update={"suppliers": [Supplier(id="s1", capacity_per_week=cap)]})
        sc = Scenario(name="late", network=net,
                      policies={"inventory_control": {"policy_type": "mrp"}},
                      settings=make_settings(model_seeds=1, horizon=80))
        return {k: v["mean"] for k, v in run_scenario(sc).aggregates.items()}

    free, tight = kpis(None), kpis(110.0)
    assert free["mrp_late_receipt_weeks"] == 0.0
    assert tight["mrp_late_receipt_weeks"] > 0.0
    assert tight["material_shortage_weeks"] > 0.0


def test_a_run_without_mrp_reports_no_mrp_kpis():
    from scsim.core.engine import run_scenario
    sc = Scenario(name="none", network=_step_chain(), settings=make_settings(model_seeds=1))
    agg = run_scenario(sc).aggregates
    assert "mrp_late_receipt_weeks" not in agg and "material_shortage_weeks" not in agg
