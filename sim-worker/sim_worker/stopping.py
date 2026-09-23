"""Student-t 95% half-width for the frozen legacy engine's `kpi.aggregate`.

The module used to carry `StoppingRule`, a Law–Kelton sequential rule nothing
called; it was deleted with `warmup.py` (audit 2026-09-22, F-37). The product's
stopping rule is scsim's (`scsim.stats`), and `test_no_orphan_module.py` fails if
an unreachable module comes back.
"""

from __future__ import annotations

import math
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
