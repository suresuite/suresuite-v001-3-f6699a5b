"""Global simulation & statistics settings — Part III §3.0.

Every field carries unit / range / scope metadata via ``json_schema_extra``;
the registry export and the generated variable dictionary read it from here,
so this module is the single source of truth (Pydantic-canonical chain).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from scsim.entities.enums import (
    ReplicationStopping,
    RunMode,
    TraceVerbosity,
    WarmupMethod,
)


def _meta(unit: str, scope: str, notes: str = "") -> dict:
    return {"unit": unit, "scope": scope, "notes": notes}


class SimulationSettings(BaseModel):
    """Global clock, horizon, seeds and statistical controls (scope G)."""

    model_config = ConfigDict(validate_assignment=True)

    time_step: int = Field(
        1, frozen=True, json_schema_extra=_meta("week", "G", "Weekly clock; fixed."),
    )
    horizon: int = Field(
        156, ge=52, le=520,
        json_schema_extra=_meta("weeks", "G", "T_sim. Manuscript: 156."),
    )
    warmup_method: WarmupMethod = Field(
        WarmupMethod.MOST_CONSERVATIVE,
        json_schema_extra=_meta("enum", "G", "Runs Conway and MSER-5, adopts the later week."),
    )
    warmup_end: Optional[int] = Field(
        None, ge=0,
        json_schema_extra=_meta(
            "week", "G",
            "t_w. Required when warmup_method=manual; auto-detected otherwise. Manuscript: 85.",
        ),
    )
    analysis_window: int = Field(
        52, ge=13, le=156,
        json_schema_extra=_meta("weeks", "G", "KPI window starting at warmup_end."),
    )
    project_seed: int = Field(
        ..., ge=0, lt=2**64,
        json_schema_extra=_meta("-", "G", "Root of the SeedSequence tree (Part VIII)."),
    )
    model_seeds: int = Field(
        30, ge=1, le=200,
        json_schema_extra=_meta(
            "count", "G",
            "Replications over world streams. Study-grade floor is 30 (Part VIII); "
            "results below 10 carry a below_replication_floor badge.",
        ),
    )
    disruption_event_seeds: int = Field(
        18, ge=1, le=100,
        json_schema_extra=_meta(
            "count", "G",
            "(start, duration, magnitude) draws. Collapses to 1 when all events are fixed.",
        ),
    )
    crn_enabled: bool = Field(
        True,
        json_schema_extra=_meta("-", "G", "Common random numbers; required for synergy math."),
    )
    bootstrap_resamples: int = Field(
        10_000, ge=1_000, le=100_000,
        json_schema_extra=_meta("count", "G", "Percentile bootstrap on Δ and synergy metrics."),
    )
    ci_level: int = Field(
        95,
        json_schema_extra=_meta("%", "G", "One of {90, 95, 99}."),
    )
    replication_stopping: ReplicationStopping = Field(
        ReplicationStopping.FIXED,
        json_schema_extra=_meta("enum", "G", "sequential_ci stops when FR CI half-width ≤ ε."),
    )
    ci_halfwidth_target: float = Field(
        0.05, ge=0.01, le=0.10,
        json_schema_extra=_meta("-", "G", "ε for sequential stopping."),
    )
    run_mode: RunMode = Field(
        RunMode.FULL,
        json_schema_extra=_meta(
            "enum", "G",
            "fast_scan: 10×6 seeds, kpi_only traces, wide-CI badge (Part X). "
            "Never silently mixed with full-mode results.",
        ),
    )
    detection_lag_weeks: int = Field(
        0, ge=0, le=4,
        json_schema_extra=_meta(
            "weeks", "G/S",
            "Delay between physical disruption start and firm knowledge (PH-20). "
            "Manuscript core uses 0; P-S.4 early_warning_failover governs this lever.",
        ),
    )
    demand_floor_factor: float = Field(
        0.30, ge=0.0, le=1.0,
        json_schema_extra=_meta(
            "-", "G/P",
            "ν — partial-observability correction: a_p = max{0,(1−ν)·b_p}.",
        ),
    )
    visibility_horizon: int = Field(
        52, ge=4, le=104,
        json_schema_extra=_meta("weeks", "G/P", "τ* — MTO order schedule length."),
    )
    trace_verbosity: TraceVerbosity = Field(
        TraceVerbosity.WEEKLY,
        json_schema_extra=_meta("enum", "G", "Stress tests default to kpi_only (≈100× less IO)."),
    )

    @model_validator(mode="after")
    def _check(self) -> "SimulationSettings":
        if self.ci_level not in (90, 95, 99):
            raise ValueError("ci_level must be one of {90, 95, 99}")
        if self.warmup_method == WarmupMethod.MANUAL and self.warmup_end is None:
            raise ValueError("warmup_end is required when warmup_method='manual'")
        if self.warmup_end is not None and self.warmup_end > self.horizon // 2:
            raise ValueError("warmup_end must be ≤ horizon/2")
        if self.run_mode == RunMode.FAST_SCAN:
            # fast_scan budget (Part X §10.2.7); enforced, badged downstream.
            object.__setattr__(self, "model_seeds", min(self.model_seeds, 10))
            object.__setattr__(self, "disruption_event_seeds", min(self.disruption_event_seeds, 6))
            object.__setattr__(self, "trace_verbosity", TraceVerbosity.KPI_ONLY)
        return self

    @property
    def below_replication_floor(self) -> bool:
        return self.model_seeds < 10


class WarmupReport(BaseModel):
    """Both detectors are always computed and reported (Part VIII §1)."""

    conway_week: int
    mser5_week: int
    # The pre-0.2.7 statistic, one factor of (n_b − d) too many (audit F-25),
    # reported for one release beside the adopted `mser5_week` so a stored run's
    # warm-up can be compared. −1 where no detector ran (manual warm-up).
    mser5_legacy_week: int = -1
    adopted_week: int
    method: WarmupMethod
    series_used: str = "fill_rate"


class StatisticsReport(BaseModel):
    """Run-level statistical metadata attached to every result set."""

    engine_version: str
    project_seed: int
    model_seeds: int
    disruption_event_seeds: int
    n_replications: int
    crn_enabled: bool
    run_mode: RunMode
    warmup: Optional[WarmupReport] = None
    below_replication_floor: bool = False
    wide_ci_badge: bool = False  # set for fast_scan results (Risk R4)
    # Which rule decided the replication count (audit F-13). "sequential_ci"
    # means `_extend_until_ci` stopped at the first batch whose half-width met ε,
    # so a plain t-interval over the same sample is biased narrow by that peeking
    # and the display must say so. "fixed" otherwise — including a sequential
    # rule on a scenario with no events, which the engine does not extend (F-32).
    stopping_rule: str = "fixed"
