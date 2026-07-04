"""Policy plugin interface — Part IX §9.2 (binding contract).

A policy is a class with declared metadata, hooks, and a Pydantic Params
model. Policies interact with the world ONLY through the SimContext typed
accessors and draw randomness ONLY from ``ctx.rng(self.id)`` (§9.4).

Adding a Tier-1 policy = one plugin file + a registry entry + a docs row
(CI-enforced) + one validation experiment. No engine edits.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, ClassVar, Optional

from pydantic import BaseModel, ConfigDict

from scsim.core.phases import Hook, PhaseId
from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass

if TYPE_CHECKING:  # pragma: no cover
    from scsim.core.context import SimContext
    from scsim.entities.scenario import Scenario


class PolicyParams(BaseModel):
    """Base for all policy parameter models. ``extra='forbid'`` so a typo in a
    param name is a validation error, not silence."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ModeStrip(BaseModel):
    """nominal/alert/crisis parameter strip (Part IV header). v1 engines use
    nominal normally and crisis while any event is firm-visible; alert engages
    once P-S.4 early warning lands (M7)."""

    model_config = ConfigDict(extra="forbid")

    nominal: float
    alert: float
    crisis: float


@dataclass(frozen=True)
class FeasibilityIssue:
    severity: str  # "error" | "warning"
    code: str
    message: str


@dataclass(frozen=True)
class FeasibilityResult:
    feasible: bool
    issues: tuple[FeasibilityIssue, ...] = ()

    @staticmethod
    def ok() -> "FeasibilityResult":
        return FeasibilityResult(True, ())


@dataclass
class CostBreakdown:
    """Per-week cost contributions, keyed by C^res component (Part V)."""

    components: dict[str, float] = field(default_factory=dict)

    def add(self, component: str, amount: float) -> None:
        self.components[component] = self.components.get(component, 0.0) + amount


class PolicyPlugin(ABC):
    """Subclass, declare ClassVar metadata, implement the lifecycle methods."""

    id: ClassVar[str]                          # registry key, snake_case
    stage: ClassVar[Stage]
    strategy_class: ClassVar[StrategyClass]
    constraint_targeted: ClassVar[Optional[ConstraintTag]]
    requires_predeployment: ClassVar[bool]
    status: ClassVar[PolicyStatus]
    catalog_ref: ClassVar[str]                 # e.g. "P-P.1"
    summary: ClassVar[str]                     # one-paragraph context (docs)
    Params: ClassVar[type[PolicyParams]]

    def __init__(self, params: PolicyParams):
        self.params = params

    # ------------------------------------------------------------------ hooks

    @property
    @abstractmethod
    def hooks(self) -> list[Hook]:
        """Declared phase residencies. Validated at load time (§9.2)."""

    # -------------------------------------------------------------- lifecycle

    def setup(self, ctx: "SimContext") -> None:
        """Called once per replication before week 1."""

    @abstractmethod
    def on_phase(self, phase: PhaseId, ctx: "SimContext") -> None:
        """Called for each phase the policy declared a hook on."""

    def cost_contribution(self, ctx: "SimContext") -> CostBreakdown:
        """Standing costs assessed at PH-99 (activation costs are charged
        in-phase through ``ctx.cost.add``)."""
        return CostBreakdown()

    def kpi_contribution(self, ctx: "SimContext", t_w: int, window_end: int) -> dict[str, float]:
        """Policy-owned KPI rows (facet 7 — outputs), merged into the
        replication row after the engine KPIs. Computed over the analysis
        window ``[t_w, window_end)``; keys must not collide with engine KPIs."""
        return {}

    def feasibility(self, scenario: "Scenario") -> FeasibilityResult:
        """Engine-enforced composition rules (Part IV §4.6)."""
        return FeasibilityResult.ok()
