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


def plan_ahead(model, ctx, want0: np.ndarray, plan0: np.ndarray) -> None:
    """Fill ``ctx.planned_production`` / ``plan_requirement`` /
    ``plan_projected_demand`` (``[products × H]``) — column 0 is this week."""
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
    # Start from the ACTUAL per-row backlog (its ages are unknown off the
    # per-row path, so it enters as age 0 — conservative: it can only expire later).
    buckets = np.zeros((R, rf["max_horizon"] + 1))
    buckets[:, 0] = ctx.backlog_rows

    def carry(supply, d_rows):
        nonlocal buckets
        buckets = step_rows(supply, buckets, d_rows, model.row_ptr, alloc,
                            rf["accept"], rf["horizon"]).buckets

    # Week t, as it will happen: MTO ships this week's plan; MTS shipped from
    # stock at PH-30 and this week's build goes to stock.
    carry(np.where(mts, ctx.fg_served_backlog + ctx.fg_served_new, plan0), ctx.demand_rows)
    stock = ctx.fg_on_hand + np.where(mts, plan0, 0.0)
    cap = model.capacity
    fg_target_now = ctx.fg_target
    for k in range(1, H):
        tau = t + k
        d_rows = ctx.projected_demand_rows(tau, 1)[:, 0]
        d = np.asarray(model.row_to_prod @ d_rows).ravel()
        B = np.asarray(model.row_to_prod @ buckets.sum(axis=1)).ravel()
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
