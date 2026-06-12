"""Scenario — the unit of execution: network + settings + events + portfolio.

``policies`` maps policy_id → raw parameter dict, validated against each
plugin's Params model at compile time. The built-in buffers (P-P.1, P-C.1)
are always active: when absent from ``policies`` they run with catalog
defaults, which is exactly the manuscript baseline S0.

Portfolio composition rules (Part IV §4.6) are enforced at compile time by
:func:`scsim.policies.registry.check_portfolio` — feasibility violations are
hard errors, path-dependency/submodularity issues are structured warnings.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from scsim.entities.config import SimulationSettings
from scsim.entities.disruption import DisruptionEvent
from scsim.entities.network import Network

BUILT_IN_POLICY_IDS = ("inventory_control", "unmet_demand_handling")


class Scenario(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    name: str = Field("scenario", min_length=1)
    network: Network
    settings: SimulationSettings
    events: list[DisruptionEvent] = Field(
        default_factory=list, max_length=5,
        json_schema_extra={"notes": "event_list — compound events compose by max severity."},
    )
    policies: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        json_schema_extra={"notes": "policy_id → params; validated against the registry."},
    )

    @property
    def portfolio(self) -> list[str]:
        """Strategy policies beyond the built-in buffers (breadth indicator input)."""
        return [pid for pid in self.policies if pid not in BUILT_IN_POLICY_IDS]

    def with_policies(self, policies: dict[str, dict[str, Any]], name: str | None = None) -> "Scenario":
        """CRN-safe variant: same world, different portfolio."""
        return self.model_copy(
            update={"policies": policies, "name": name or self.name}, deep=True
        )

    def without_events(self, name: str | None = None) -> "Scenario":
        """Clean baseline used for SLA/TTR reference series."""
        return self.model_copy(update={"events": [], "name": name or f"{self.name}__clean"}, deep=True)
