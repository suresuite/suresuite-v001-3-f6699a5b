"""Warm-up detection — Welch's method + MSER-5 fallback."""

from __future__ import annotations

from typing import Sequence


def welch_moving_average(series: Sequence[float], window: int) -> list[float]:
    half = window // 2
    out: list[float] = []
    for i in range(half, len(series) - half):
        s = sum(series[i - half : i + half + 1])
        out.append(s / window)
    return out


def mser5(series: Sequence[float]) -> int:
    """Return truncation index d that minimizes var/(n-d)^2."""
    n = len(series)
    if n < 20:
        return 0
    best_d, best_val = 0, float("inf")
    for d in range(0, n - 10, 5):
        tail = series[d:]
        m = sum(tail) / len(tail)
        v = sum((x - m) ** 2 for x in tail) / len(tail)
        denom = (n - d) ** 2
        score = v / denom if denom else float("inf")
        if score < best_val:
            best_val = score
            best_d = d
    return best_d


def detect_warmup(series: Sequence[float], welch_window: int = 5) -> int:
    """Return the recommended warm-up cutoff (in steps)."""
    if len(series) < 30:
        return 0
    smooth = welch_moving_average(series, welch_window)
    return mser5(smooth)
