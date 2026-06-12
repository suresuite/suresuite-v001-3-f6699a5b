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
    """MSER-5 truncation point in weeks.

    Batches the series into means of width ``batch`` and returns the
    truncation d* (in original time units) minimizing the MSER statistic
    z(d) = Var(batch_means[d:]) / (n_b - d)². The search is restricted to
    the first half of the batches (standard guard against degenerate tails).
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
    # A warm-up of 0 on a stochastic series almost always means the detectors
    # saw a flat start; never adopt less than one MSER batch.
    adopted = max(adopted, 0)
    return WarmupReport(
        conway_week=c, mser5_week=m, adopted_week=adopted, method=method, series_used=series_name
    )
