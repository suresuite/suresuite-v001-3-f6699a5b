"""Percentile bootstrap — Part VIII §6.

Two-sided percentile CIs on replication-level statistics. For Δ and synergy
metrics the inputs are CRN-paired per-replication values, so resampling
replication indices preserves the pairing.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class BootstrapResult:
    point: float
    ci_low: float
    ci_high: float
    p_value: float          # two-sided sign test under the bootstrap distribution
    significant: bool       # 0 outside the CI
    stars: str              # '' / '*' / '**' / '***' at p<.05/.01/.001
    resamples: int
    ci_level: float

    def as_dict(self) -> dict:
        return {
            "point": self.point,
            "ci_low": self.ci_low,
            "ci_high": self.ci_high,
            "p_value": self.p_value,
            "significant": self.significant,
            "stars": self.stars,
            "resamples": self.resamples,
            "ci_level": self.ci_level,
        }


def _stars(p: float) -> str:
    if p < 0.001:
        return "***"
    if p < 0.01:
        return "**"
    if p < 0.05:
        return "*"
    return ""


def bootstrap_mean(
    values: np.ndarray,
    resamples: int = 10_000,
    ci_level: float = 95.0,
    seed: int = 0,
) -> BootstrapResult:
    """Percentile bootstrap CI for the mean of per-replication values.

    The bootstrap RNG is seeded deterministically and is NOT part of the
    simulation seed tree (analysis-time randomness, not world randomness).
    """
    x = np.asarray(values, dtype=float)
    if x.size == 0:
        raise ValueError("bootstrap_mean: empty sample")
    rng = np.random.default_rng(np.random.SeedSequence(entropy=seed, spawn_key=(0xB007,)))
    n = x.size
    idx = rng.integers(0, n, size=(resamples, n))
    means = x[idx].mean(axis=1)
    alpha = (100.0 - ci_level) / 2.0
    lo, hi = np.percentile(means, [alpha, 100.0 - alpha])
    point = float(x.mean())
    frac_le = float(np.mean(means <= 0.0))
    frac_ge = float(np.mean(means >= 0.0))
    p = max(min(1.0, 2.0 * min(frac_le, frac_ge)), 1.0 / resamples)
    return BootstrapResult(
        point=point,
        ci_low=float(lo),
        ci_high=float(hi),
        p_value=p,
        significant=not (lo <= 0.0 <= hi),
        stars=_stars(p),
        resamples=resamples,
        ci_level=ci_level,
    )


def t_halfwidth(values: np.ndarray, ci_level: float = 95.0) -> float:
    """Student-t CI half-width for plain KPI means (sequential stopping input)."""
    from scipy import stats as sps

    x = np.asarray(values, dtype=float)
    n = x.size
    if n < 2:
        return float("inf")
    se = float(x.std(ddof=1)) / np.sqrt(n)
    t = float(sps.t.ppf(0.5 + ci_level / 200.0, df=n - 1))
    return t * se


def aggregate_mean_ci(values: np.ndarray, ci_level: float = 95.0) -> dict:
    """Mean/CI over the replications that MEASURED the KPI.

    NaN is the engine's "not measured" (a window with no demand has no fill
    rate; an unlimited supplier has no utilization). It is excluded, ``n`` says
    how many replications remain, and a KPI no replication measured aggregates
    to NaN — not 0.0, which would read as a measured zero (audit F-08).
    """
    x = np.asarray(values, dtype=float)
    x = x[np.isfinite(x)]
    return {
        "mean": float(x.mean()) if x.size else float("nan"),
        "std": float(x.std(ddof=1)) if x.size > 1 else 0.0,
        "ci_halfwidth": t_halfwidth(x, ci_level) if x.size > 1 else 0.0,
        "n": int(x.size),
        "min": float(x.min()) if x.size else float("nan"),
        "max": float(x.max()) if x.size else float("nan"),
    }
