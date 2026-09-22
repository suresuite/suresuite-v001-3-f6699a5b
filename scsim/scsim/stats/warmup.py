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
    """MSER-5 truncation point in weeks — AS THE ENGINE HAS ALWAYS COMPUTED IT.

    Minimizes ``np.var(batch_means[d:]) / (n_b − d)²``. ``np.var`` is already
    divided by (n_b − d), so this is Σ(b − b̄)² / (n_b − d)³ — one factor more
    than White's (1997) definition, which biases the argmin toward d = 0 (less
    truncation). Audit 2026-09-22, F-25. ``mser5_published`` is the definition.

    NOT FIXED IN PLACE, deliberately: on the engine's own scenarios the correct
    statistic moves the adopted warm-up in 17 of 144 cases, by up to 70 weeks
    (PLAN.md §16 · audit WP 2), and the warm-up sets the analysis window, which
    moves every KPI on every run. Both are reported on ``WarmupReport``; which
    one is ADOPTED is a named decision, not a patch. The search is restricted to
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


def mser5_published(series: np.ndarray, batch: int = 5) -> int:
    """MSER-5 by White's (1997) definition — z(d) = Σ(b − b̄)² / (n_b − d)².

    Reported beside ``mser5`` and adopted by nothing yet (see ``mser5``).
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
    # detectors return 0, so it belongs to the same named decision as
    # `mser5_published` — the comment now says what the code does.
    adopted = max(adopted, 0)
    return WarmupReport(
        conway_week=c, mser5_week=m, mser5_published_week=mser5_published(series),
        adopted_week=adopted, method=method, series_used=series_name
    )
