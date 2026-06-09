"""KPI vector for the simulation lab — utilization-first, no CO₂."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Mapping, Sequence


@dataclass
class ReplicationKpis:
    fill_rate: float = 0.0
    fill_rate_beta: float = 0.0
    otif: float = 0.0
    lead_time_days: float = 0.0
    lead_time_p95: float = 0.0
    revenue: float = 0.0
    cost: float = 0.0
    profit: float = 0.0
    utilization: float = 0.0  # mean across all resources, time-weighted
    utilization_by_class: dict[str, float] = field(default_factory=dict)
    inventory_turns: float = 0.0
    backorder_days: float = 0.0
    lost_sales_units: float = 0.0
    ttr_days: float = 0.0
    resilience_index: float = 0.0

    def as_dict(self) -> dict[str, float | dict[str, float]]:
        return {
            "fill_rate": self.fill_rate,
            "fill_rate_beta": self.fill_rate_beta,
            "otif": self.otif,
            "lead_time_days": self.lead_time_days,
            "lead_time_p95": self.lead_time_p95,
            "revenue": self.revenue,
            "cost": self.cost,
            "profit": self.profit,
            "utilization": self.utilization,
            "utilization_by_class": self.utilization_by_class,
            "inventory_turns": self.inventory_turns,
            "backorder_days": self.backorder_days,
            "lost_sales_units": self.lost_sales_units,
            "ttr_days": self.ttr_days,
            "resilience_index": self.resilience_index,
        }


def aggregate(
    reps: Sequence[Mapping[str, float]],
    keys: Sequence[str],
) -> dict[str, dict[str, float]]:
    """Compute mean / std / 95% CI / n for each key across replications."""
    from .stopping import half_width_95

    out: dict[str, dict[str, float]] = {}
    for k in keys:
        xs = [float(r.get(k, 0.0)) for r in reps if k in r]
        if not xs:
            continue
        n = len(xs)
        m = sum(xs) / n
        v = sum((x - m) ** 2 for x in xs) / max(1, n - 1)
        s = math.sqrt(v)
        out[k] = {
            "mean": m,
            "std": s,
            "ci95": half_width_95(xs) if n > 1 else 0.0,
            "n": float(n),
            "min": min(xs),
            "max": max(xs),
        }
    return out
