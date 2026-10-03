# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""One week of a per-row backlog — PLAN.md §24 WP 14.3/14.4, ADR 0002 decisions 5–6.

Two callers run exactly this step:

* **fulfillment** (P-C.1 at PH-60, WP 14.3): the week that happens;
* **the plan** (PH-40, WP 14.4): the weeks the plan projects, so that only the
  shortfall of rows that allow backorder carries forward, within their window,
  split by the project's allocation rule.

Writing it once is what makes decision 6 — "the plan and fulfillment use the
same rule" — true by construction. Pure: no context, no RNG.

``buckets`` is ``[rows × (H + 1)]``: column ``k`` holds units that have waited
``k`` weeks. Each row expires at ITS horizon ``horizon[r]``; ``accept[r]`` is the
share of the row's unmet new demand that waits (1 backorder, 0 lost sales,
``p`` partial).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from scsim.core.allocation import allocate_batched


@dataclass
class RowWeek:
    buckets: np.ndarray        # the row backlog after the week, by age
    served_backlog: np.ndarray  # [rows × ages] served from backlog
    served_new: np.ndarray     # [rows] served from this week's demand
    lost: np.ndarray           # [rows] unmet new demand that does not wait + expired
    waiting: np.ndarray        # [rows] unmet new demand that waits


def step_rows(
    supply: np.ndarray,
    buckets: np.ndarray,
    demand_rows: np.ndarray,
    row_ptr: np.ndarray,
    alloc: dict,
    accept: np.ndarray,
    horizon: np.ndarray,
) -> RowWeek:
    """Serve each product's ``supply`` across its rows with the project's rule
    (``alloc``: rule + per-row priority / price / floor), oldest backlog first
    within a row; then age the backlog one week. ``buckets`` is not modified."""
    b = np.array(buckets, dtype=float, copy=True)
    d_rows = np.maximum(demand_rows, 0.0)
    sb_age, s_new = allocate_batched(
        supply, b, d_rows, row_ptr, alloc["rule"],
        priority=alloc["priority"], price=alloc["price"], floor_pct=alloc["floor_pct"])
    b -= sb_age
    np.maximum(b, 0.0, out=b)
    unmet_new = np.maximum(d_rows - s_new, 0.0)
    waiting = unmet_new * accept
    lost = unmet_new - waiting
    # Each row expires at ITS horizon: the bucket of age h_r goes to lost sales,
    # then everything ages one week and the new waiting enters age 0.
    R, A = b.shape
    expire = b[np.arange(R), np.minimum(horizon, A - 1)]
    lost = lost + expire
    b[np.arange(A)[None, :] >= horizon[:, None]] = 0.0
    if A > 1:
        b[:, 1:] = b[:, :-1].copy()
    b[:, 0] = waiting
    return RowWeek(buckets=b, served_backlog=sb_age, served_new=s_new, lost=lost, waiting=waiting)
