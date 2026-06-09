"""Shared command/event payloads. Mirrors the Zod schema in
`supabase/functions/sim-command/index.ts`."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


CommandKind = Literal[
    "scenario.changed",
    "scenario.reset",
    "simulation.snapshot",
    "simulation.fork",
    "policy.changed",
    "experiment.run",
    "experiment.cancel",
    "experiment.add_reps",
]


class Command(BaseModel):
    project_id: str
    scenario_id: Optional[str] = None
    kind: CommandKind
    payload: dict[str, Any] = Field(default_factory=dict)
    user_id: Optional[str] = None
    client_ts: Optional[int] = None
    server_ts: Optional[int] = None


class KpiVector(BaseModel):
    fill_rate: Optional[float] = None
    otif: Optional[float] = None
    revenue: Optional[float] = None
    lead_time_days: Optional[float] = None
    co2_kg: Optional[float] = None
    source: str = "worker"

    def diff(self, other: "KpiVector") -> dict[str, Any]:
        """Return only the fields that changed vs ``other``."""
        out: dict[str, Any] = {}
        for k, v in self.model_dump().items():
            if getattr(other, k, None) != v:
                out[k] = v
        return out


class KpiDelta(BaseModel):
    kpis: dict[str, Any]
    ts: int
    source: str = "worker"
