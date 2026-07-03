"""Generalized event injector — Part III §3.7.

Compile-time: validates targets/effects against the network (capacity_reduction
on a supplier needs a finite supplier capacity; a node:plant target throttles
or halts the plant's own production).

Replication-time: draws stochastic fields from the hazard streams keyed by
(event_rep, event_index) and resolves targets to supplier indices.
edge:lane targets resolve to the lane's supplier while edges are
behavior-neutral (v1) — golden trace #5 asserts the equivalence.

Invariants: under ``queue`` overflow units are delayed, never destroyed;
same-target events compose by per-week max severity (min capacity factor,
max deferral end) — implemented in the engine's week_start mechanic.
"""
from __future__ import annotations

import numpy as np

from scsim.core.context import CompiledModel, ResolvedEvent
from scsim.entities.disruption import DisruptionEvent, DurationRange
from scsim.entities.enums import EffectType, TargetType
from scsim.stats.seeds import HAZARD_DURATION, HAZARD_START, hazard_rng


class DisruptionCompileError(ValueError):
    pass


def validate_events(model: CompiledModel) -> None:
    for i, ev in enumerate(model.scenario.events):
        if ev.target_type == TargetType.NODE_PLANT:
            # The plant's production capacity is always finite (products carry a
            # production_capacity), so capacity_reduction is always meaningful —
            # no supplier resolution or finiteness check needed.
            continue
        sup_idx = _resolve_supplier(model, ev, i)
        if ev.effect_type == EffectType.CAPACITY_REDUCTION and not np.isfinite(
            model.sup_capacity[sup_idx]
        ):
            raise DisruptionCompileError(
                f"event[{i}]: capacity_reduction on supplier "
                f"{model.sup_ids[sup_idx]!r} requires a finite supplier capacity_per_week "
                f"(§3.5 — ∞ has no flow to throttle)"
            )


def _resolve_supplier(model: CompiledModel, ev: DisruptionEvent, i: int) -> int:
    if ev.target_type == TargetType.NODE_SUPPLIER:
        if ev.target_id not in model.sup_index:
            raise DisruptionCompileError(f"event[{i}]: unknown supplier {ev.target_id!r}")
        return model.sup_index[ev.target_id]
    if ev.target_type == TargetType.EDGE_LANE:
        if ev.target_id not in model.lane_supplier:
            raise DisruptionCompileError(f"event[{i}]: unknown lane {ev.target_id!r}")
        return model.lane_supplier[ev.target_id]
    raise DisruptionCompileError(f"event[{i}]: unsupported target_type {ev.target_type}")


def any_stochastic(events: list[DisruptionEvent]) -> bool:
    return any(e.is_stochastic for e in events)


def resolve_events(
    model: CompiledModel,
    warmup_end: int,
    event_rep: int,
) -> list[ResolvedEvent]:
    """Draw start/duration per event and bind targets for one replication."""
    resolved: list[ResolvedEvent] = []
    seed = model.settings.project_seed
    for i, ev in enumerate(model.scenario.events):
        is_plant = ev.target_type == TargetType.NODE_PLANT
        sup_idx = -1 if is_plant else _resolve_supplier(model, ev, i)
        if ev.start is not None:
            start = ev.start
        else:
            # Steady state: U{t_w .. t_w+2} (§3.7 — manuscript U{85..87}).
            rng = hazard_rng(seed, event_rep, i, HAZARD_START)
            start = int(rng.integers(warmup_end, warmup_end + 3))
        if isinstance(ev.duration, DurationRange):
            rng = hazard_rng(seed, event_rep, i, HAZARD_DURATION)
            duration = int(rng.integers(ev.duration.min, ev.duration.max + 1))
        else:
            duration = int(ev.duration)
        resolved.append(
            ResolvedEvent(
                supplier_idx=sup_idx,
                effect=ev.effect_type,
                start=start,
                end=start + duration,
                capacity_factor=ev.capacity_factor,
                overflow_rule=ev.overflow_rule,
                onset_profile=ev.onset_profile,
                recovery_profile=ev.recovery_profile,
                ramp_weeks=ev.ramp_weeks,
                is_plant=is_plant,
            )
        )
    return resolved
