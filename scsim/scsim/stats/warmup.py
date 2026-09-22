"""Warm-up detection — Part VIII §1.

Both detectors are always computed; ``most_conservative`` adopts the later
week and both are reported (WarmupReport). Detection runs on the cross-
replication mean of a weekly series (fill rate by default) from clean
(no-disruption) replications.
"""
from __future__ import annotations

import numpy as np

from scsim.entities.config import WarmupReport
from scsim.entities.enums import WarmupMethod


def mser5(series: np.ndarray, batch: int = 5) -> int:
    """MSER-5 truncation point in weeks — White's (1997) definition, ADOPTED.

    Batches the series into means of width ``batch`` and returns the truncation
    d* (in original time units) minimizing z(d) = Σ(b − b̄)² / (n_b − d)² over the
    batch means after d. The search is restricted to the first half of the
    batches (standard guard against degenerate tails).

    Switched by the user's decision of 2026-09-22 (audit F-25, PLAN.md §16 ·
    audit WP 6 and the switch's own entry). The statistic the engine used before
    carried one factor of (n_b − d) too many and survives one release as
    ``mser5_legacy``, reported on ``WarmupReport`` and adopted by nothing.
    """
    x = np.asarray(series, dtype=float)
    n_b = len(x) // batch
    if n_b < 4:
        return 0
    means = x[: n_b * batch].reshape(n_b, batch).mean(axis=1)
    best_d, best_z = 0, np.inf
    for d in range(0, n_b // 2 + 1):
        tail = means[d:]
        if len(tail) < 2:
            break
        z = float(np.var(tail)) / len(tail)  # = Σ(·)² / (n_b − d)²
        if z < best_z:
            best_z, best_d = z, d
    return best_d * batch


def mser5_legacy(series: np.ndarray, batch: int = 5) -> int:
    """The statistic the engine adopted until 0.2.7: ``np.var / (n_b − d)²``,
    i.e. Σ(·)² / (n_b − d)³ — one factor more than the definition, biasing the
    argmin toward d = 0. Reported for comparison for one release; remove after.
    """
    x = np.asarray(series, dtype=float)
    n_b = len(x) // batch
    if n_b < 4:
        return 0
    means = x[: n_b * batch].reshape(n_b, batch).mean(axis=1)
    best_d, best_z = 0, np.inf
    for d in range(0, n_b // 2 + 1):
        tail = means[d:]
        if len(tail) < 2:
            break
        z = float(np.var(tail)) / (len(tail) ** 2)
        if z < best_z:
            best_z, best_d = z, d
    return best_d * batch


def conway(series: np.ndarray) -> int:
    """Conway's rule: first index that is neither the minimum nor the maximum
    of the remaining observations."""
    x = np.asarray(series, dtype=float)
    n = len(x)
    for k in range(n - 1):
        rest = x[k:]
        if x[k] != rest.max() and x[k] != rest.min():
            return k
    return 0


def detect_warmup(
    series: np.ndarray,
    method: WarmupMethod,
    manual_week: int | None = None,
    series_name: str = "fill_rate",
) -> WarmupReport:
    c = conway(series)
    m = mser5(series)
    if method == WarmupMethod.CONWAY:
        adopted = c
    elif method == WarmupMethod.MSER5:
        adopted = m
    elif method == WarmupMethod.MANUAL:
        if manual_week is None:
            raise ValueError("manual warmup requires warmup_end")
        adopted = manual_week
    else:  # most_conservative
        adopted = max(c, m)
    # There is NO floor here. The comment that stood above this line said
    # "never adopt less than one MSER batch" over `max(adopted, 0)`, which is a
    # no-op (audit F-25 / D-8): an adopted warm-up of 0 IS possible and always
    # was. Adding the floor would move the analysis window of every run whose
    # detectors return 0; the 2026-09-22 decision switched the statistic and
    # did not ask for a floor, so there is none — and this says so.
    adopted = max(adopted, 0)
    return WarmupReport(
        conway_week=c, mser5_week=m, mser5_legacy_week=mser5_legacy(series),
        adopted_week=adopted, method=method, series_used=series_name
    )
