"""Sequential stopping rules for replication count (Law–Kelton)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence


# Two-sided Student-t for 95% CI; df 1..30, then z=1.96.
_T95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
    8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
    15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08,
    22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048,
    29: 2.045, 30: 2.042,
}


def t_critical_95(df: int) -> float:
    if df <= 0:
        return 0.0
    return _T95.get(df, 1.96)


def half_width_95(xs: Sequence[float]) -> float:
    n = len(xs)
    if n < 2:
        return float("inf")
    m = sum(xs) / n
    v = sum((x - m) ** 2 for x in xs) / (n - 1)
    s = math.sqrt(v)
    return t_critical_95(n - 1) * s / math.sqrt(n)


@dataclass
class StoppingRule:
    kind: str  # 'fixed_horizon' | 'ci_halfwidth'
    epsilon: float = 0.01
    max_wall_seconds: float = 600
    max_reps: int = 200
    min_reps: int = 3

    def should_stop(
        self,
        kpi_series: Sequence[float],
        elapsed_wall: float,
        target_reps: int,
    ) -> bool:
        if elapsed_wall >= self.max_wall_seconds:
            return True
        if self.kind == "fixed_horizon":
            return len(kpi_series) >= target_reps
        if self.kind == "ci_halfwidth":
            if len(kpi_series) < self.min_reps:
                return False
            if len(kpi_series) >= self.max_reps:
                return True
            return half_width_95(kpi_series) <= self.epsilon
        return len(kpi_series) >= target_reps
