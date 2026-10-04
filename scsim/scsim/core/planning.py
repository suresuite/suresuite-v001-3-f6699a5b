# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Planned production over a horizon — PLAN.md §24 WP 14.4, design doc §3.2–§3.3.

ADR 0002 decisions 1, 3 and 6:

* **planned production = min(requirement, capacity)** — the requirement is the
  projected demand plus the projected backlog (MTO), or what the product's FG
  policy needs plus the projected backlog (MTS);
* **FG policies** — base-stock (S), min-max (s, S), days of cover (D);
* **only backorder rows carry a shortfall**, within their window, split by the
  project's allocation rule — through ``core/rowbacklog.step_rows``, the very
  step fulfillment runs, so the plan and fulfillment cannot disagree.

Week t (column 0) is the week the plant builds: its ``production_plan`` is
computed exactly as before (the execution contract is unchanged). The later
columns exist so MRP can see them (WP 14.5). They read the demand the plan is
ALLOWED to read — ``SimContext.projected_demand_rows``, the centres the world
draws around — and never a realized future draw (gate ``plan-from-demand``).
Week t starts from the ACTUAL per-row backlog.
"""
from __future__ import annotations

import numpy as np

from scsim.core.rowbacklog import step_rows

FG_BASE, FG_MIN_MAX, FG_COVER = 0, 1, 2


def fg_gap(model, target: np.ndarray, post: np.ndarray) -> np.ndarray:
    """What the FG policy asks the plant to build, given the stock left after
    this week's demand (``post``). base-stock and days-of-cover fill to the
    target; min-max fills to S only when the stock fell below s."""
    gap = np.maximum(target - post, 0.0)
    if (model.fg_policy_code == FG_MIN_MAX).any():
        mm = model.fg_policy_code == FG_MIN_MAX
        s = np.where(mm, model.fg_reorder_point, 0.0)
        gap = np.where(mm, np.where(post < s, gap, 0.0), gap)
    return gap


def fg_target_for(model, forecast: np.ndarray, projected: np.ndarray) -> np.ndarray:
    """S^FG per product: a typed S (base-stock, min-max); D/7 × the projected
    weekly demand (days of cover — it moves with the forecast); else this week's
    forecast (today's derivation, which P-P.4 may raise)."""
    base = np.where(model.fg_base_stock_override >= 0, model.fg_base_stock_override, forecast)
    if (model.fg_policy_code == FG_COVER).any():
        cover = np.nan_to_num(model.fg_cover_days) / 7.0 * projected
        base = np.where(model.fg_policy_code == FG_COVER, cover, base)
    return base


def production_lead_time_offset(model, ctx, want_mto: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """P-P.13 (PLAN.md §26 WP 16.4): this week's requirement for a product whose
    START completes at t + L, L its PLANNING (expected) production lead time.

    The work in progress (``ctx.prod_pipeline``, every unit started and not yet
    completed) covers the demand of weeks t .. t+L−1: this week's realized demand
    (already known — it is the current week) and the projected centres of the
    next L−1 (``ctx.projected_demand``, never a draw). So:

    * MTO — the start covers the projected demand AT t + L, plus the backlog the
      WIP's surplus over that window does not clear;
    * MTS — the stock the FG policy is asked about is the stock left after this
      week's demand PLUS the WIP MINUS the projected demand of t+1 .. t+L, i.e.
      the end-of-week stock at the week this start completes.

    Returns ``(want_mto, stock)``: for a product with L = 0 both are exactly what
    ``_mech_default_plan`` used before (D + B, and the FG stock now). Only the
    SUM of the WIP is read, not when each unit completes — a drawn completion
    week is not information the plan may use (gate ``plan-from-demand``).
    """
    t = ctx.week
    L = model.prod_lt
    Lmax = int(L.max(initial=0))
    wip = ctx.prod_pipeline.sum(axis=1)
    want = want_mto.copy()
    stock = ctx.fg_on_hand.copy()
    if Lmax <= 0:
        return want, stock
    # Projected demand for weeks t+1 .. t+Lmax, [products × Lmax].
    proj = ctx.projected_demand(t + 1, Lmax)
    cum = np.concatenate([np.zeros((model.n_prods, 1)), np.cumsum(proj, axis=1)], axis=1)
    for j in np.flatnonzero(L > 0):
        lj = int(L[j])
        # MTO: the window t .. t+L−1 is this week's demand plus the next L−1.
        covered = ctx.demand[j] + cum[j, lj - 1]
        surplus = max(wip[j] - covered, 0.0)
        want[j] = proj[j, lj - 1] + max(ctx.backlog[j] - surplus, 0.0)
        # MTS: the stock at the end of the completion week, before this start.
        stock[j] = ctx.fg_on_hand[j] + wip[j] - cum[j, lj]
    return want, stock


def plan_ahead(model, ctx, want0: np.ndarray, plan0: np.ndarray) -> None:
    """Fill ``ctx.planned_production`` / ``plan_requirement`` /
    ``plan_projected_demand`` (``[products × H]``) — column 0 is this week."""
    _plan_ahead(model, ctx, want0, plan0)
    if getattr(model, "has_prod_lt", False) and model.plan_horizon > 1:
        _offset_later_columns(model, ctx, plan0)


def _offset_later_columns(model, ctx, plan0: np.ndarray) -> None:
    """P-P.13 — a product with a production lead time plans its later START
    columns against the projected demand of the week each start COMPLETES
    (t + k + L), from the stock position column 0 used. Its projected backlog in
    those columns is the one column 0 already netted, so no shortfall is carried
    forward for it (a declared limit, §16 · WP 16.4); a product with L = 0 keeps
    the columns ``_plan_ahead`` gave it."""
    t = ctx.week
    H = model.plan_horizon
    L = model.prod_lt
    lt_prods = np.flatnonzero(L > 0)
    if lt_prods.size == 0:
        return
    Lmax = int(L.max())
    proj = ctx.projected_demand(t + 1, H - 1 + Lmax)
    cap = model.capacity
    _, stock0 = production_lead_time_offset(model, ctx, ctx.demand + ctx.backlog)
    mts = model.mts_mask
    for j in lt_prods:
        lj = int(L[j])
        stock = stock0[j] + (plan0[j] if mts[j] else 0.0)
        for k in range(1, H):
            d = float(proj[j, k - 1 + lj])
            if mts[j]:
                served = min(d, max(stock, 0.0))
                post = stock - served
                if model.fg_base_stock_override[j] >= 0:
                    target = float(model.fg_base_stock_override[j])
                elif model.fg_policy_code[j] == FG_COVER:
                    target = float(np.nan_to_num(model.fg_cover_days[j])) / 7.0 * d
                else:
                    target = float(ctx.fg_target[j])
                req = float(fg_gap(_One(model, j), np.array([target]), np.array([post]))[0])
            else:
                req = d
            plan = min(req, float(cap[j]))
            ctx.planned_production[j, k] = plan
            ctx.plan_requirement[j, k] = req
            ctx.plan_projected_demand[j, k] = d
            if mts[j]:
                stock = post + plan


class _One:
    """One product's FG policy fields, shaped for ``fg_gap``."""

    def __init__(self, model, j: int):
        self.fg_policy_code = model.fg_policy_code[j:j + 1]
        self.fg_reorder_point = model.fg_reorder_point[j:j + 1]


def _plan_ahead(model, ctx, want0: np.ndarray, plan0: np.ndarray) -> None:
    t = ctx.week
    H = model.plan_horizon
    ctx.planned_production[:, 0] = plan0
    ctx.plan_requirement[:, 0] = want0
    ctx.plan_projected_demand[:, 0] = ctx.projected_demand(t, 1)[:, 0]
    if H <= 1:
        return

    mts = model.mts_mask
    R = model.n_rows
    rf = ctx.row_fulfillment or {
        "accept": np.zeros(R), "horizon": np.zeros(R, dtype=int), "max_horizon": 0}
    alloc = ctx.row_allocation or {
        "rule": "fair_share", "priority": model.row_cust_priority,
        "price": model.row_price, "floor_pct": np.zeros(R)}
    cap = model.capacity
    # Every projected week's demand in one read: [rows × (H − 1)] and per product.
    d_rows_all = ctx.projected_demand_rows(t + 1, H - 1)
    d_all = np.asarray(model.row_to_prod @ d_rows_all)
    # Nothing can carry when no row backorders and nothing waits now: the
    # projected backlog is 0 in every later week, so the row step is skipped —
    # and an all-MTO network plans the whole horizon in one vector operation.
    carries = bool(np.any(rf["accept"] > 0)) or bool(np.any(ctx.backlog_rows > 0))
    if not carries and not mts.any():
        ctx.plan_projected_demand[:, 1:] = d_all
        ctx.plan_requirement[:, 1:] = d_all
        ctx.planned_production[:, 1:] = np.minimum(d_all, cap[:, None])
        return

    # Start from the ACTUAL per-row backlog (its ages are unknown off the
    # per-row path, so it enters as age 0 — conservative: it can only expire later).
    buckets = np.zeros((R, rf["max_horizon"] + 1))
    buckets[:, 0] = ctx.backlog_rows

    def carry(supply, d_rows):
        nonlocal buckets
        if carries:
            buckets = step_rows(supply, buckets, d_rows, model.row_ptr, alloc,
                                rf["accept"], rf["horizon"]).buckets

    # Week t, as it will happen: MTO ships this week's plan; MTS shipped from
    # stock at PH-30 and this week's build goes to stock.
    carry(np.where(mts, ctx.fg_served_backlog + ctx.fg_served_new, plan0), ctx.demand_rows)
    stock = ctx.fg_on_hand + np.where(mts, plan0, 0.0)
    fg_target_now = ctx.fg_target
    for k in range(1, H):
        d_rows = d_rows_all[:, k - 1]
        d = d_all[:, k - 1]
        B = (np.asarray(model.row_to_prod @ buckets.sum(axis=1)).ravel()
             if carries else np.zeros(model.n_prods))
        req_mto = d + B
        # MTS: the start-of-week stock serves backlog first, then demand; the
        # policy then asks for the gap from what is left.
        served = np.minimum(d + B, stock)
        post = stock - served
        unserved_b = B - np.minimum(B, stock)
        target = np.where(model.fg_base_stock_override >= 0, model.fg_base_stock_override,
                          fg_target_now)
        if (model.fg_policy_code == FG_COVER).any():
            target = np.where(model.fg_policy_code == FG_COVER,
                              np.nan_to_num(model.fg_cover_days) / 7.0 * d, target)
        req_mts = fg_gap(model, target, post) + unserved_b
        req = np.where(mts, req_mts, req_mto)
        plan = np.minimum(req, cap)
        ctx.planned_production[:, k] = plan
        ctx.plan_requirement[:, k] = req
        ctx.plan_projected_demand[:, k] = d
        carry(np.where(mts, served, plan), d_rows)
        stock = np.where(mts, post + plan, 0.0)
