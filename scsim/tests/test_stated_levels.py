# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""A replenishment value the planner types on a /policies row is the value the
run uses — nothing hidden adds to it, raises it or replaces it.

Before this file:
  * P-P.3 added its safety stock ON TOP of an absolute s and S, so a typed
    s = 400 ran as 400 + SS;
  * a formula s above a typed S raised S to it;
  * the periodic type's T was read nowhere — every periodic material was
    reviewed every 4 weeks whatever the row said;
  * an (R,Q) material with a lot still sized S from κ (its opening stock), so κ
    moved a run whose page does not need it;
  * a value stored under an earlier type (an S left on a row switched to (R,Q))
    reached the engine although the page no longer shows it;
  * Eq. 21 read the project κ, not the row's.
"""
from __future__ import annotations

import numpy as np
import pytest

from scsim import Scenario
from scsim.core.engine import compile_scenario, run_replication
from scsim.entities.enums import TraceVerbosity
from scsim.io.project_map import (
    MaterialRow, ProductRow, ProjectData, ScenarioSettings, SupplierRow, SupplyArc, BomArc,
    OutboundArc, from_project_data,
)

from .conftest import make_settings, single_chain_network

SS14 = {"safety_stock_materials": {"classification": "fixed_days", "fixed_days_cover": 14.0}}


def _ctx(policies, **kw):
    sc = Scenario(name="t", network=single_chain_network(),
                  settings=make_settings(model_seeds=1, trace_verbosity=TraceVerbosity.FULL_DEBUG,
                                         **kw),
                  events=[], policies=policies)
    return run_replication(compile_scenario(sc), 0, 0, [])


def _levels(policies):
    ctx = _ctx(policies)
    return float(ctx.level_s[0]), float(ctx.level_S[0])


# E[D] = 100/wk, T_s = 2 wk: formula s = 200, S = 200 + 100·κ; 14 days SS = 200.

def test_stated_s_and_S_are_the_levels_with_safety_stock_on():
    s, S = _levels({"inventory_control": {"material_overrides": {
        "m1": {"reorder_point": 400.0, "order_up_to": 2000.0}}}, **SS14})
    assert (s, S) == (400.0, 2000.0)


def test_formula_levels_still_carry_the_safety_stock():
    s, S = _levels({"inventory_control": {}, **SS14})
    assert s == pytest.approx(200.0 + 200.0)
    assert S == pytest.approx(200.0 + 800.0 + 200.0)


def test_a_stated_S_is_never_raised_by_a_buffered_formula_s():
    # formula s = 200 + 200 SS = 400 > the typed S of 300: S stays 300.
    s, S = _levels({"inventory_control": {"policy_type": "base_stock", "material_overrides": {
        "m1": {"order_up_to": 300.0}}}, **SS14})
    assert S == 300.0
    assert s <= S


def test_stated_s_alone_keeps_the_formula_S_buffer():
    s, S = _levels({"inventory_control": {"material_overrides": {
        "m1": {"reorder_point": 250.0}}}, **SS14})
    assert s == 250.0
    assert S == pytest.approx(200.0 + 800.0 + 200.0)


def test_rop_with_a_lot_has_S_equal_R_plus_Q_and_reads_no_kappa():
    for kappa in (2.0, 20.0):
        s, S = _levels({"inventory_control": {"material_overrides": {
            "m1": {"policy_type": "rop_q", "rop_q_quantity": 900.0, "reorder_point": 300.0,
                   "coverage_weeks": kappa}}}, **SS14})
        assert (s, S) == (300.0, 1200.0), kappa
    # Formula R: S follows it, buffer included, κ still unread.
    a = _levels({"inventory_control": {"policy_type": "rop_q", "rop_q_quantity": 900.0,
                                       "coverage_weeks": {"nominal": 2, "alert": 2, "crisis": 2}},
                 **SS14})
    b = _levels({"inventory_control": {"policy_type": "rop_q", "rop_q_quantity": 900.0,
                                       "coverage_weeks": {"nominal": 20, "alert": 20, "crisis": 20}},
                 **SS14})
    assert a == b == (400.0, 1300.0)


def test_eq21_reads_the_rows_kappa():
    """The S buffer z·σ·√(T_s+κ) uses the row's κ — it used the project's."""
    sl = {"safety_stock_materials": {"classification": "uniform", "uniform_service_level": 95.0}}
    buffers = []
    for k in (2.0, 20.0):
        sc = Scenario(name="t", network=single_chain_network(deterministic=False),
                      settings=make_settings(model_seeds=1), events=[],
                      policies={"inventory_control": {"material_overrides": {
                          "m1": {"coverage_weeks": k}}}, **sl})
        compiled = compile_scenario(sc)
        ctx = run_replication(compiled, 0, 0, [])
        exp_d = float(compiled.model.exp_demand_m[0])
        buffers.append(float(ctx.level_S[0]) - exp_d * (2.0 + k))
    assert buffers[0] > 0
    assert buffers[1] == pytest.approx(buffers[0] * np.sqrt(22.0 / 4.0))


@pytest.mark.parametrize("weeks", [1, 3])
def test_periodic_review_follows_the_rows_T(weeks):
    ctx = _ctx({"inventory_control": {"policy_type": "periodic", "material_overrides": {
        "m1": {"periodic_review_weeks": weeks}}}})
    order_weeks = np.flatnonzero(ctx.trace.O_mat[0] > 0)
    assert len(order_weeks) > 0
    assert all(w % weeks == 0 for w in order_weeks), order_weeks
    if weeks == 1:
        assert any(w % 4 != 0 for w in order_weeks)


# ── the mapper: what the page shows is what reaches the engine ─────────────

def _project(policies):
    d = ProjectData(
        suppliers=[SupplierRow("S1")],
        materials=[MaterialRow("M1", cost=10.0)],
        products=[ProductRow("P1", sell_price=100.0, demand_mean=50.0)],
        supply_arcs=[SupplyArc("S1", "M1", unit_price=10, lead_time=2, lead_time_unit="week",
                               volume=60, time_unit="week")],
        bom=[BomArc("P1", "M1", 1.0)],
        outbound=[OutboundArc("P1", "C1", unit_price=100, volume=50, time_unit="week")],
        scenario=ScenarioSettings(horizon_days=364),
    )
    d.policies = policies
    res = from_project_data(d)
    return res.scenario.policies["inventory_control"], res.warnings


def test_review_period_days_reaches_the_engine_in_weeks():
    ic, _w = _project({"default": {"inventory": {"type": "periodic_review",
                                                  "review_period_days": 14}},
                       "node:S1::M1": {"inventory": {"review_period_days": 21}}})
    assert ic["periodic_review_weeks"] == 2
    assert ic["material_overrides"]["M1"]["periodic_review_weeks"] == 3


def test_a_review_period_that_is_not_whole_weeks_is_stated():
    ic, w = _project({"default": {"inventory": {"type": "periodic_review",
                                                 "review_period_days": 1}}})
    assert ic["periodic_review_weeks"] == 1
    assert any(x.field == "review_period_days" and "1 wk" in x.reason for x in w)


def test_a_value_the_rows_type_does_not_show_is_not_applied():
    # The row was min_max with an S, then switched to (R,Q): the page shows Q, R
    # and κ only, so the stored S must not move the run.
    ic, w = _project({"default": {"inventory": {"type": "min_max"}},
                      "node:S1::M1": {"inventory": {"type": "rop", "rop_q_quantity": 500,
                                                    "reorder_point": 100, "order_up_to": 900}}})
    ov = ic["material_overrides"]["M1"]
    assert "order_up_to" not in ov
    assert ov["rop_q_quantity"] == 500 and ov["reorder_point"] == 100
    assert any(x.entity == "material:M1" and "order_up_to" in x.reason for x in w)


def test_an_mrp_row_carries_no_level():
    ic, _w = _project({"node:S1::M1": {"inventory": {"type": "mrp", "reorder_point": 100,
                                                     "coverage_weeks": 4}}})
    assert ic["material_overrides"]["M1"] == {"policy_type": "mrp"}


def test_the_project_q_reaches_an_rop_row_whatever_the_project_type():
    # The project is min-max with Q = 500; the row is (R,Q) and shows that Q.
    ic, _w = _project({"default": {"inventory": {"type": "min_max", "rop_q_quantity": 500}},
                       "node:S1::M1": {"inventory": {"type": "rop"}}})
    assert ic["rop_q_quantity"] == 500
    assert ic["material_overrides"]["M1"] == {"policy_type": "rop_q"}


def test_an_rop_row_reads_no_kappa_and_says_when_it_has_no_q():
    ic, w = _project({"node:S1::M1": {"inventory": {"type": "rop", "reorder_point": 100,
                                                    "coverage_weeks": 4}}})
    assert ic["material_overrides"]["M1"] == {"policy_type": "rop_q", "reorder_point": 100.0}
    assert any(x.entity == "material:M1" and x.field == "rop_q_quantity" and x.level == "warn"
               for x in w)
    assert any(x.entity == "material:M1" and "coverage_weeks" in x.reason for x in w)
