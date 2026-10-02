# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""The shared allocation helper — PLAN.md §24 WP 14.0, ADR 0002.

Every rule under scarcity, zero supply, surplus and ties; SLA floors that
cannot all be met; oldest-backlog-first inside a row; conservation over random
inputs; and P-C.2's split, which now delegates to the helper, against the
inline implementation it replaced (kept below as the oracle).
"""
from __future__ import annotations

import numpy as np
import pytest

from scsim.core.allocation import RULES, allocate, allocate_batched


def _a(*x):
    return np.array(x, dtype=float)


NO_BACKLOG = np.zeros((3, 0))


# ------------------------------------------------------------------ priority

def test_priority_fills_highest_first():
    _, s = allocate(70.0, NO_BACKLOG, _a(50, 30, 20), "priority", priority=_a(1, 3, 2))
    assert s.tolist() == [20.0, 30.0, 20.0]


def test_priority_ties_break_by_row_order():
    _, s = allocate(60.0, NO_BACKLOG, _a(50, 50, 50), "priority", priority=_a(1, 1, 1))
    assert s.tolist() == [50.0, 10.0, 0.0]


# ---------------------------------------------------------------- fair_share

def test_fair_share_equal_fill_rate_under_scarcity():
    _, s = allocate(50.0, NO_BACKLOG, _a(60, 30, 10), "fair_share")
    np.testing.assert_allclose(s, [30.0, 15.0, 5.0])


def test_fair_share_design_example_week4():
    """Design doc §2: 200 wanted, 180 capacity → 20 short, split 16 / 4."""
    _, s = allocate(180.0, np.zeros((2, 0)), _a(160, 40), "fair_share")
    np.testing.assert_allclose(_a(160, 40) - s, [16.0, 4.0])


# -------------------------------------------------------------- proportional

def test_proportional_default_weight_is_fair_share():
    _, a = allocate(50.0, NO_BACKLOG, _a(60, 30, 10), "proportional")
    _, b = allocate(50.0, NO_BACKLOG, _a(60, 30, 10), "fair_share")
    np.testing.assert_allclose(a, b)


def test_proportional_water_fills_capped_rows():
    # Weights 1:1:2 on 100 → 25/25/50, but row 0 wants only 10: its excess
    # 15 re-spreads 1:2 over rows 1 and 2.
    _, s = allocate(100.0, NO_BACKLOG, _a(10, 100, 100), "proportional", weight=_a(1, 1, 2))
    np.testing.assert_allclose(s, [10.0, 30.0, 60.0])


def test_proportional_zero_weight_rows_take_the_leftover():
    _, s = allocate(100.0, NO_BACKLOG, _a(20, 20, 40), "proportional", weight=_a(1, 1, 0))
    np.testing.assert_allclose(s, [20.0, 20.0, 40.0])
    _, s = allocate(30.0, NO_BACKLOG, _a(20, 20, 40), "proportional", weight=_a(1, 1, 0))
    np.testing.assert_allclose(s, [15.0, 15.0, 0.0])


# --------------------------------------------------------------- revenue_max

def test_revenue_max_serves_by_price():
    _, s = allocate(50.0, NO_BACKLOG, _a(30, 30, 30), "revenue_max", price=_a(5, 9, 7))
    assert s.tolist() == [0.0, 30.0, 20.0]


# ------------------------------------------------------------------ sla_tier

def test_sla_tier_floors_then_priority():
    # Floors 50% of 40 and 50% of 40 = 20 + 20; remaining 30 by priority.
    _, s = allocate(70.0, np.zeros((2, 0)), _a(40, 40), "sla_tier",
                    priority=_a(1, 2), floor_pct=_a(50, 50))
    np.testing.assert_allclose(s, [30.0, 40.0])


def test_sla_tier_floors_scaled_when_supply_cannot_meet_them():
    # Floors 80% of 50 + 80% of 50 = 80 > 40 supply → scaled to 20 / 20,
    # nothing left for the priority pass.
    _, s = allocate(40.0, np.zeros((2, 0)), _a(50, 50), "sla_tier",
                    priority=_a(5, 1), floor_pct=_a(80, 80))
    np.testing.assert_allclose(s, [20.0, 20.0])


# --------------------------------------------------- zero supply / surplus

@pytest.mark.parametrize("rule", RULES)
def test_zero_supply_serves_nothing(rule):
    b, s = allocate(0.0, np.ones((3, 2)), _a(5, 6, 7), rule,
                    priority=_a(1, 2, 3), price=_a(3, 2, 1), floor_pct=_a(50, 50, 50))
    assert s.sum() == 0.0 and b.sum() == 0.0


@pytest.mark.parametrize("rule", RULES)
def test_surplus_serves_every_want(rule):
    backlog = _a(1, 2, 3, 4, 5, 6).reshape(3, 2)
    b, s = allocate(1e6, backlog, _a(5, 6, 7), rule,
                    priority=_a(1, 2, 3), price=_a(3, 2, 1), floor_pct=_a(50, 50, 50))
    np.testing.assert_allclose(b, backlog)
    np.testing.assert_allclose(s, [5, 6, 7])


# ------------------------------------------------------------ within a row

def test_oldest_backlog_first_then_new():
    # One row: 3 units aged 0, 4 aged 1, 5 aged 2, plus 10 new; 8 supply.
    b, s = allocate(8.0, _a(3, 4, 5).reshape(1, 3), _a(10), "fair_share")
    assert b.tolist() == [[0.0, 3.0, 5.0]] and s.tolist() == [0.0]
    b, s = allocate(15.0, _a(3, 4, 5).reshape(1, 3), _a(10), "fair_share")
    assert b.tolist() == [[3.0, 4.0, 5.0]] and s.tolist() == [3.0]


# ------------------------------------------------------------- batched form

def test_batched_equals_per_product_calls():
    rng = np.random.default_rng(1)
    counts = [3, 0, 1, 4]
    ptr = np.concatenate([[0], np.cumsum(counts)])
    R = ptr[-1]
    back = rng.uniform(0, 10, (R, 3))
    new = rng.uniform(0, 30, R)
    pri, price, floor = rng.integers(0, 3, R).astype(float), rng.uniform(1, 9, R), rng.uniform(0, 100, R)
    supply = _a(40, 10, 5, 70)
    for rule in RULES:
        bb, sb = allocate_batched(supply, back, new, ptr, rule,
                                  priority=pri, price=price, floor_pct=floor)
        for p in range(len(counts)):
            sl = slice(ptr[p], ptr[p + 1])
            b1, s1 = allocate(supply[p], back[sl], new[sl], rule,
                              priority=pri[sl], price=price[sl], floor_pct=floor[sl])
            np.testing.assert_allclose(bb[sl], b1, atol=1e-12)
            np.testing.assert_allclose(sb[sl], s1, atol=1e-12)


def test_unknown_rule_and_missing_inputs_raise():
    with pytest.raises(ValueError, match="unknown allocation rule"):
        allocate(1.0, NO_BACKLOG, _a(1, 1, 1), "cheapest_first")
    with pytest.raises(ValueError, match="priority"):
        allocate(1.0, NO_BACKLOG, _a(1, 1, 1), "priority")


# ------------------------------------------------- conservation (property)

@pytest.mark.parametrize("rule", RULES)
def test_conservation_over_random_inputs(rule):
    rng = np.random.default_rng(20261002)
    for _ in range(300):
        P = int(rng.integers(1, 6))
        counts = rng.integers(0, 6, P)
        ptr = np.concatenate([[0], np.cumsum(counts)])
        R, A = int(ptr[-1]), int(rng.integers(0, 4))
        back = rng.uniform(0, 20, (R, A)) * (rng.random((R, A)) < 0.7)
        new = rng.uniform(0, 50, R) * (rng.random(R) < 0.9)
        pri = rng.integers(0, 4, R).astype(float)
        price = rng.integers(1, 5, R).astype(float)
        floor = rng.uniform(0, 100, R)
        weight = rng.uniform(0, 3, R) * (rng.random(R) < 0.8)
        supply = rng.uniform(0, 150, P) * (rng.random(P) < 0.9)
        b, s = allocate_batched(supply, back, new, ptr, rule, priority=pri, price=price,
                                floor_pct=floor, weight=weight)
        # Never above a cell's want, never negative.
        assert (b >= 0).all() and (s >= 0).all()
        assert (b <= back + 1e-12).all() and (s <= new + 1e-12).all()
        prod = np.repeat(np.arange(P), counts)
        served = np.bincount(prod, weights=b.sum(axis=1) + s, minlength=P)
        want = np.bincount(prod, weights=back.sum(axis=1) + new, minlength=P)
        np.testing.assert_allclose(served, np.minimum(supply, want), rtol=1e-9, atol=1e-9)
        # A row's backlog is served before its new demand, oldest first.
        row_served = b.sum(axis=1) + s
        full_back = np.isclose(b, back).all(axis=1)
        assert ((s <= 1e-12) | full_back).all()
        assert (row_served >= -1e-12).all()


# ----------------------------------- P-C.2 delegates: identical to the inline split

def _legacy_pc2_split(rule, d_pc, avail, demand, served_new, order, floors):
    """P-C.2's inline split as it was before WP 14.0 — the oracle."""
    def fill_in_order(d, av, o):
        d_sorted = d[:, o]
        before = np.cumsum(d_sorted, axis=1) - d_sorted
        s_sorted = np.clip(av[:, None] - before, 0.0, d_sorted)
        out = np.empty_like(d)
        out[:, o] = s_sorted
        return out

    if rule in ("fcfs", "proportional", "fair_share"):
        with np.errstate(invalid="ignore", divide="ignore"):
            fill = np.where(demand > 0, served_new / demand, 1.0)
        return d_pc * fill[:, None]
    if rule == "priority":
        return fill_in_order(d_pc, avail, order)
    g_pc = d_pc * floors[None, :]
    g_tot = g_pc.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        scale = np.where(g_tot > 0, np.minimum(1.0, avail / g_tot), 0.0)
    g_pc = g_pc * scale[:, None]
    return g_pc + fill_in_order(d_pc - g_pc, avail - g_pc.sum(axis=1), order)


@pytest.mark.parametrize("rule", ["fcfs", "proportional", "fair_share", "priority", "sla_tier"])
def test_pc2_split_matches_its_inline_predecessor(rule):
    from scsim.policies.improvisation.p_c2_customer_allocation import _HELPER_RULE

    rng = np.random.default_rng(7)
    for _ in range(200):
        P, C = int(rng.integers(1, 5)), int(rng.integers(2, 6))
        price = rng.uniform(1, 20, P)
        share = rng.uniform(0, 1, (P, C))
        share /= share.sum(axis=1, keepdims=True)
        demand = rng.uniform(0, 100, P) * (rng.random(P) < 0.9)
        served_new = demand * rng.uniform(0, 1, P)
        weights = rng.integers(0, 4, C).astype(float)
        floors_pct = rng.uniform(0, 100, C) * (rng.random(C) < 0.6)
        d_pc = (demand * price)[:, None] * share
        avail = served_new * price
        order = np.lexsort((np.arange(C), -weights))
        want = _legacy_pc2_split(rule, d_pc, avail, demand, served_new, order, floors_pct / 100.0)
        _, got = allocate_batched(avail, np.zeros((P * C, 0)), d_pc.ravel(),
                                  np.arange(P + 1) * C, _HELPER_RULE[rule],
                                  priority=np.tile(weights, P),
                                  floor_pct=np.tile(floors_pct, P))
        np.testing.assert_allclose(got.reshape(P, C), want, rtol=1e-12, atol=1e-9)
