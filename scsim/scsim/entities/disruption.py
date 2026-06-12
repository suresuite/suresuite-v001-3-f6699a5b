"""Generalized disruption event model — Part III §3.7.

Event = (target, effect, magnitude, start, duration).

Semantics (engine-binding, see docs/architecture.md#disruption-semantics):

* ``lead_time_extension`` (✅ Eqs. 11–12): the target ships nothing during the
  window. In-transit quantities scheduled to arrive inside [t*, t*+Δt) are
  deferred to the first week after the window; orders placed during the
  window are quoted arrival = max(t + T_s, t_end). Units are delayed, never
  destroyed (conservation invariant).
* ``capacity_reduction``: the target's weekly outbound flow is throttled to
  φ × capacity. Overflow follows ``overflow_rule``: ``queue`` (supplier
  backlog, shipped FIFO when capacity allows) or ``reject`` (logged as
  lost_inbound_units). Requires a finite supplier capacity.

Same-target events compose by per-week max severity (min capacity factor,
max deferral). Stochastic fields (start=None, duration ranges) are drawn
per replication from the hazard streams.
"""
from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from scsim.entities.enums import EffectType, OverflowRule, RampProfile, TargetType


def _meta(unit: str, scope: str = "event", notes: str = "") -> dict:
    return {"unit": unit, "scope": scope, "notes": notes}


class DurationRange(BaseModel):
    """Uniform integer draw U{min..max} from the hazard_duration stream."""

    min: int = Field(..., ge=1, le=52)
    max: int = Field(..., ge=1, le=52)

    @model_validator(mode="after")
    def _check(self) -> "DurationRange":
        if self.max < self.min:
            raise ValueError("duration range max < min")
        return self


class DisruptionEvent(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    target_type: TargetType = Field(
        TargetType.NODE_SUPPLIER,
        json_schema_extra=_meta("enum", notes="node:supplier ✅; node:plant 🧩 M7; edge:lane 🧩."),
    )
    target_id: str = Field(..., min_length=1, json_schema_extra=_meta("id"))
    effect_type: EffectType = Field(
        EffectType.LEAD_TIME_EXTENSION,
        json_schema_extra=_meta("enum", notes="LT extension ✅ (Eqs. 11–12) vs capacity throttle."),
    )
    capacity_factor: float = Field(
        0.0, ge=0.0, lt=1.0,
        json_schema_extra=_meta("-", notes="φ — 0 = full outage. capacity_reduction only."),
    )
    overflow_rule: OverflowRule = Field(
        OverflowRule.QUEUE,
        json_schema_extra=_meta("enum", notes="reject logs lost_inbound_units."),
    )
    onset_profile: RampProfile = Field(
        RampProfile.STEP,
        json_schema_extra=_meta("enum", notes="ramp_linear applies to capacity_reduction only."),
    )
    recovery_profile: RampProfile = Field(
        RampProfile.STEP,
        json_schema_extra=_meta("enum", notes="ramp_linear applies to capacity_reduction only."),
    )
    ramp_weeks: int = Field(
        0, ge=0, le=8, json_schema_extra=_meta("weeks"),
    )
    start: Optional[int] = Field(
        None, ge=1,
        json_schema_extra=_meta(
            "week",
            notes="t*. None → auto: U{t_w .. t_w+2} (steady state) from the hazard_start stream.",
        ),
    )
    duration: Union[int, DurationRange] = Field(
        default_factory=lambda: DurationRange(min=5, max=10),
        json_schema_extra=_meta(
            "weeks",
            notes="Δt. int = fixed; range = U{min..max} from the hazard_duration stream.",
        ),
    )

    @model_validator(mode="after")
    def _check(self) -> "DisruptionEvent":
        if isinstance(self.duration, int) and not (1 <= self.duration <= 52):
            raise ValueError("duration must be in [1, 52] weeks")
        if self.effect_type == EffectType.LEAD_TIME_EXTENSION:
            if self.onset_profile != RampProfile.STEP or self.recovery_profile != RampProfile.STEP:
                raise ValueError(
                    "ramp profiles apply to capacity_reduction only; "
                    "lead_time_extension is a step effect (Eqs. 11–12)"
                )
        if self.ramp_weeks > 0 and (
            self.onset_profile == RampProfile.STEP and self.recovery_profile == RampProfile.STEP
        ):
            raise ValueError("ramp_weeks > 0 requires a ramp_linear onset or recovery profile")
        return self

    @property
    def is_stochastic(self) -> bool:
        return self.start is None or isinstance(self.duration, DurationRange)
