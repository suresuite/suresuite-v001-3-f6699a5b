# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Customer-row allocation — the ONE function that splits a product's supply.

Phase 14 (PLAN.md §24, design ``docs/design/mrp-multi-stage-planning.md``
§3.3 and §3.5, ADR 0002). Two decisions read the same split:

* **fulfillment** (P-C.1 / P-C.2 at PH-60, WP 14.3): which customer × product
  row gets the units the plant can ship this week;
* **the plan's shortfall** (PH-40, WP 14.4): which rows carry a capacity
  shortfall into next week (decision 6 — the plan and fulfillment share one
  rule, so a lost-sales row leaves the plan the week it leaves the order book).

Writing it once is what makes "the same rule" true by construction rather than
by two implementations agreeing.

Pure and side-effect free: no context, no RNG, no state. A row is one
customer × product pair; a product's rows are contiguous and described by a
CSR pointer ``row_ptr`` (rows ``row_ptr[p]:row_ptr[p+1]`` belong to product
``p``). Every rule is vectorized over products — the hot path has no
per-product Python loop (blueprint R4).

Rules (across a product's rows):

``priority``      highest ``priority`` filled completely first.
``fair_share``    every row gets the same fill rate (pro-rata to its want).
``proportional``  pro-rata to ``weight`` (default: the row's want), each row
                  capped at its want, with the excess re-spread (water-filling).
``revenue_max``   highest ``price`` filled completely first.
``sla_tier``      each row first gets ``floor_pct`` % of its want (all floors
                  scaled down pro-rata when supply cannot meet them), then the
                  remainder by ``priority``.

Within a row: the OLDEST backlog first (highest age bucket), then younger
buckets, then this week's new demand. Ties break by row order (the lower row
index is served first), so a result is deterministic.

Conservation: for each product, ``Σ served = min(supply, Σ want)`` up to float
rounding, and no row or cell is ever served above what it wants.
"""
from __future__ import annotations

from typing import Literal, Optional

import numpy as np

AllocationRule = Literal["priority", "fair_share", "proportional", "revenue_max", "sla_tier"]
RULES: tuple[str, ...] = ("priority", "fair_share", "proportional", "revenue_max", "sla_tier")


def allocate(
    supply: float,
    backlog_by_age: np.ndarray,
    new_demand: np.ndarray,
    rule: AllocationRule,
    priority: Optional[np.ndarray] = None,
    price: Optional[np.ndarray] = None,
    floor_pct: Optional[np.ndarray] = None,
    weight: Optional[np.ndarray] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Split ONE product's ``supply`` across its rows.

    ``backlog_by_age`` is ``[rows × ages]`` (column ``k`` = units that have
    waited ``k`` weeks; zero columns is allowed), ``new_demand`` is ``[rows]``.
    Returns ``(served_backlog_by_age, served_new)`` with the input shapes.
    """
    new_demand = np.asarray(new_demand, dtype=float)
    n = new_demand.shape[0]
    return allocate_batched(
        np.array([float(supply)]),
        backlog_by_age,
        new_demand,
        np.array([0, n]),
        rule,
        priority=priority,
        price=price,
        floor_pct=floor_pct,
        weight=weight,
    )


def allocate_batched(
    supply: np.ndarray,
    backlog_by_age: np.ndarray,
    new_demand: np.ndarray,
    row_ptr: np.ndarray,
    rule: AllocationRule,
    priority: Optional[np.ndarray] = None,
    price: Optional[np.ndarray] = None,
    floor_pct: Optional[np.ndarray] = None,
    weight: Optional[np.ndarray] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Split each product's ``supply[p]`` across rows ``row_ptr[p]:row_ptr[p+1]``.

    The batched form of :func:`allocate` — one call per week for every
    product. Per-row inputs (``priority``, ``price``, ``floor_pct``,
    ``weight``) are ``[rows]``; ones a rule does not read may be ``None``.
    """
    if rule not in RULES:
        raise ValueError(f"unknown allocation rule {rule!r}; expected one of {RULES}")
    new_demand = np.asarray(new_demand, dtype=float)
    R = new_demand.shape[0]
    backlog = np.asarray(backlog_by_age, dtype=float)
    if backlog.ndim != 2 or backlog.shape[0] != R:
        backlog = backlog.reshape(R, -1) if backlog.size else np.zeros((R, 0))
    row_ptr = np.asarray(row_ptr, dtype=np.int64)
    supply = np.maximum(np.asarray(supply, dtype=float), 0.0)
    P = row_ptr.shape[0] - 1
    if supply.shape[0] != P:
        raise ValueError(f"supply has {supply.shape[0]} products, row_ptr describes {P}")
    if row_ptr[-1] != R:
        raise ValueError(f"row_ptr ends at {row_ptr[-1]}, but there are {R} rows")
    if R == 0:
        return np.zeros_like(backlog), np.zeros(0)

    counts = np.diff(row_ptr)
    prod_of_row = np.repeat(np.arange(P), counts)
    want = backlog.sum(axis=1) + new_demand if backlog.shape[1] else new_demand.copy()
    want = np.maximum(want, 0.0)

    if rule == "fair_share":
        served = _pro_rata(supply, want, prod_of_row, P)
    elif rule == "proportional":
        served = _water_fill(supply, want, _req(weight, want), prod_of_row, row_ptr, P)
    elif rule == "priority":
        served = _in_order(supply, want, _req(priority, None, "priority"), prod_of_row, row_ptr)
    elif rule == "revenue_max":
        served = _in_order(supply, want, _req(price, None, "price"), prod_of_row, row_ptr)
    else:  # sla_tier
        floors = np.clip(_req(floor_pct, None, "floor_pct"), 0.0, 100.0) / 100.0
        g = want * floors
        g_tot = np.bincount(prod_of_row, weights=g, minlength=P)
        with np.errstate(invalid="ignore", divide="ignore"):
            scale = np.where(g_tot > 0, np.minimum(1.0, supply / g_tot), 0.0)
        g = g * scale[prod_of_row]
        rest = np.maximum(supply - np.bincount(prod_of_row, weights=g, minlength=P), 0.0)
        served = g + _in_order(rest, want - g, _req(priority, None, "priority"),
                               prod_of_row, row_ptr)
        served = np.minimum(served, want)

    return _within_row(served, backlog, new_demand)


# ---------------------------------------------------------------- internals

def _req(values: Optional[np.ndarray], default: Optional[np.ndarray],
         name: str = "weight") -> np.ndarray:
    if values is None:
        if default is None:
            raise ValueError(f"this allocation rule needs per-row {name!r}")
        return default
    return np.asarray(values, dtype=float)


def _pro_rata(supply: np.ndarray, want: np.ndarray, prod_of_row: np.ndarray,
              P: int) -> np.ndarray:
    """Equal fill rate: every row gets ``min(1, supply / Σ want)`` of its want."""
    total = np.bincount(prod_of_row, weights=want, minlength=P)
    with np.errstate(invalid="ignore", divide="ignore"):
        fill = np.where(total > 0, np.minimum(1.0, supply / total), 0.0)
    served = want * fill[prod_of_row]
    return _close_remainder(served, want, supply, total, prod_of_row, P)


def _close_remainder(served: np.ndarray, want: np.ndarray, supply: np.ndarray,
                     total: np.ndarray, prod_of_row: np.ndarray, P: int) -> np.ndarray:
    """Give each scarce product's LAST wanting row exactly what the others
    left, so a pro-rata split conserves its total without float drift — and a
    product with one wanting row serves ``min(supply, want)`` exactly, the
    arithmetic the product-level path did before rows existed."""
    scarce = supply < total
    if not scarce.any():
        return served  # fill is exactly 1.0: every row got its want
    R = want.shape[0]
    idx = np.where(want > 0, np.arange(R), -1)
    last = np.full(P, -1)
    np.maximum.at(last, prod_of_row, idx)
    fix = np.flatnonzero(scarce & (last >= 0))
    rows = last[fix]
    others = np.bincount(prod_of_row, weights=served, minlength=P)[fix] - served[rows]
    served = served.copy()
    served[rows] = np.clip(supply[fix] - others, 0.0, want[rows])
    return served


def _in_order(supply: np.ndarray, want: np.ndarray, key: np.ndarray,
              prod_of_row: np.ndarray, row_ptr: np.ndarray) -> np.ndarray:
    """Serve rows in descending ``key`` within each product; each fills
    completely before the next sees a unit. Ties: lower row index first."""
    R = want.shape[0]
    order = np.lexsort((np.arange(R), -key, prod_of_row))
    w_sorted = want[order]
    cum = np.cumsum(w_sorted)
    # Cumulative want of the rows served BEFORE each row, inside its product.
    # The sort's primary key is the product, so product p's rows occupy sorted
    # positions row_ptr[p]:row_ptr[p+1] and its offset is cum[row_ptr[p] − 1].
    p_sorted = prod_of_row[order]
    seg_start = row_ptr[:-1]
    offset_by_prod = np.where(seg_start > 0, cum[np.clip(seg_start - 1, 0, R - 1)], 0.0)
    before = cum - w_sorted - offset_by_prod[p_sorted]
    s_sorted = np.clip(supply[p_sorted] - before, 0.0, w_sorted)
    out = np.empty(R)
    out[order] = s_sorted
    return out


def _water_fill(supply: np.ndarray, want: np.ndarray, weight: np.ndarray,
                prod_of_row: np.ndarray, row_ptr: np.ndarray, P: int) -> np.ndarray:
    """Pro-rata to ``weight``, each row capped at its want, the excess re-spread.

    Finds, per product, the level λ with Σ min(want_r, λ·w_r) = supply. Rows
    with zero weight take nothing until every weighted row is full; any supply
    left after that goes to them pro-rata to their want, so the product still
    serves ``min(supply, Σ want)``.
    """
    R = want.shape[0]
    weight = np.maximum(weight, 0.0)
    pos = weight > 0
    with np.errstate(invalid="ignore", divide="ignore"):
        q = np.where(pos, want / np.where(pos, weight, 1.0), np.inf)
    # Sort each product's weighted rows by saturation level q ascending.
    order = np.lexsort((np.arange(R), q, prod_of_row))
    w_s, d_s, q_s, p_s = weight[order], want[order], q[order], prod_of_row[order]
    pos_s = w_s > 0
    # Segment-local cumulative sums.
    cw = np.cumsum(np.where(pos_s, w_s, 0.0))
    cd = np.cumsum(np.where(pos_s, d_s, 0.0))
    seg_start = row_ptr[:-1]
    prev = np.clip(seg_start - 1, 0, R - 1)
    cw0 = np.where(seg_start > 0, cw[prev], 0.0)[p_s]
    cd0 = np.where(seg_start > 0, cd[prev], 0.0)[p_s]
    cw_l, cd_l = cw - cw0, cd - cd0                      # inclusive, local
    w_tot = np.bincount(prod_of_row, weights=np.where(pos, weight, 0.0), minlength=P)
    # If the level reached row k's saturation, the allocation would be
    # Σ_{j≤k} want_j + q_k · Σ_{j>k} w_j.
    q_fin = np.where(pos_s, q_s, 0.0)
    alloc_at = np.where(pos_s, cd_l + q_fin * (w_tot[p_s] - cw_l), np.inf)
    sat = alloc_at <= supply[p_s]                        # row k saturates
    # λ = (supply − Σ saturated want) / Σ unsaturated weight.
    sat_want = np.bincount(p_s, weights=np.where(sat & pos_s, d_s, 0.0), minlength=P)
    sat_w = np.bincount(p_s, weights=np.where(sat & pos_s, w_s, 0.0), minlength=P)
    free_w = w_tot - sat_w
    with np.errstate(invalid="ignore", divide="ignore"):
        lam = np.where(free_w > 1e-300, (supply - sat_want) / free_w, np.inf)
    with np.errstate(invalid="ignore"):
        level = np.where(pos, lam[prod_of_row] * np.where(pos, weight, 1.0), 0.0)
    served = np.where(pos, np.minimum(want, level), 0.0)
    # Zero-weight rows share what the weighted rows could not absorb.
    used = np.bincount(prod_of_row, weights=served, minlength=P)
    rest = np.maximum(supply - used, 0.0)
    if (~pos).any():
        zero_want = np.where(pos, 0.0, want)
        served = served + _pro_rata(rest, zero_want, prod_of_row, P)
    total = np.bincount(prod_of_row, weights=want, minlength=P)
    return _close_remainder(served, want, supply, total, prod_of_row, P)


def _within_row(served: np.ndarray, backlog: np.ndarray,
                new_demand: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Spend each row's ``served`` on its oldest backlog first, then new demand."""
    A = backlog.shape[1]
    if A == 0:
        return np.zeros_like(backlog), np.minimum(served, np.maximum(new_demand, 0.0))
    # Columns oldest → youngest, then new demand.
    cells = np.concatenate([np.maximum(backlog[:, ::-1], 0.0),
                            np.maximum(new_demand, 0.0)[:, None]], axis=1)
    before = np.cumsum(cells, axis=1) - cells
    take = np.clip(served[:, None] - before, 0.0, cells)
    return take[:, :A][:, ::-1].copy(), take[:, A]
