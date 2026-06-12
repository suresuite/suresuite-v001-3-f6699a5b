"""The weekly cycle is data, not code — Part IX §9.1.

Every simulated week executes the named, versioned phase sequence below.
Each phase owns a write-contract over *transient* state keys (recomputed
every week); *persistent* keys (prefix ``state.``) carry across weeks and
declare which phases may write them.

Load-time validation (hard errors, Part IX §9.2):
  * hook on an unknown phase;
  * read of a transient key not yet written at that point in the week;
  * write of a transient key outside its owning phase;
  * write of a persistent key from a non-authorized phase;
  * two hooks writing the same key in the same phase without an explicit
    ordering (distinct priorities) AND a declared ``resolution`` rule on the
    later writer.

The pipeline definition itself is schema-snapshotted (pipeline_schema.json,
test_pipeline_snapshot) — accidental reordering fails the build (Risk R8).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class PhaseId(str, Enum):
    PH00 = "PH-00"  # week_start
    PH10 = "PH-10"  # demand_realization
    PH20 = "PH-20"  # detection
    PH30 = "PH-30"  # fulfill_from_stock (MTS; no-op MTO)
    PH40 = "PH-40"  # production_planning
    PH50 = "PH-50"  # production_execute
    PH60 = "PH-60"  # fulfillment
    PH70 = "PH-70"  # material_planning
    PH80 = "PH-80"  # procurement
    PH90 = "PH-90"  # logistics
    PH99 = "PH-99"  # accounting


# --------------------------------------------------------------------------
# State keys
# --------------------------------------------------------------------------

# Transient keys — owned by exactly one phase, recomputed weekly.
DISRUPTION_STATE = "disruption_state"
DEMAND = "demand"
FIRM_KNOWLEDGE = "firm_knowledge"
FG_FULFILLMENT = "fg_fulfillment"
PRODUCTION_PLAN = "production_plan"
OVERTIME_CAPACITY = "overtime_capacity"
SUBSTITUTIONS = "substitutions"
PRODUCTION_OUTPUT = "production_output"
FULFILLMENT = "fulfillment"
MATERIAL_DEMAND = "material_demand"
INVENTORY_LEVELS = "inventory_levels"
PURCHASE_ORDERS = "purchase_orders"
ARRIVALS = "arrivals"
KPI_ROWS = "kpi_rows"

# Persistent keys — carry week to week; readable by every hook.
ST_ON_HAND = "state.on_hand"
ST_BACKLOG = "state.backlog"
ST_LOST_SALES = "state.lost_sales"
ST_PIPELINE = "state.pipeline"
ST_QUEUE = "state.queue"
ST_FG_ON_HAND = "state.fg_on_hand"
ST_COST_LEDGER = "state.cost_ledger"


@dataclass(frozen=True)
class PhaseSpec:
    id: PhaseId
    name: str
    owns: tuple[str, ...]
    description: str


PIPELINE: tuple[PhaseSpec, ...] = (
    PhaseSpec(PhaseId.PH00, "week_start", (DISRUPTION_STATE,),
              "Onset/recovery profiles → physical disruption state for the week."),
    PhaseSpec(PhaseId.PH10, "demand_realization", (DEMAND,),
              "Draw D_p[t] from the world demand stream."),
    PhaseSpec(PhaseId.PH20, "detection", (FIRM_KNOWLEDGE,),
              "Firm-visible events (t ≥ start + detection_lag). P-S.4 / P-X.1 evaluate here."),
    PhaseSpec(PhaseId.PH30, "fulfill_from_stock", (FG_FULFILLMENT,),
              "MTS serves D_p from I^FG; no-op for MTO products."),
    PhaseSpec(PhaseId.PH40, "production_planning", (PRODUCTION_PLAN, OVERTIME_CAPACITY, SUBSTITUTIONS),
              "Plan production: default greedy plan; P-P.5/P-P.9 et al. adjust here."),
    PhaseSpec(PhaseId.PH50, "production_execute", (PRODUCTION_OUTPUT,),
              "Pure mechanics (Eqs. 8/9): produce Q_p, consume materials."),
    PhaseSpec(PhaseId.PH60, "fulfillment", (FULFILLMENT,),
              "F_p, B_p, L_p — P-C.1/P-C.2/P-C.3 resident."),
    PhaseSpec(PhaseId.PH70, "material_planning", (MATERIAL_DEMAND, INVENTORY_LEVELS),
              "D_m projection (Eq. 1); s_m/S_m levels (Eqs. 2–3) + safety stock."),
    PhaseSpec(PhaseId.PH80, "procurement", (PURCHASE_ORDERS,),
              "Order release (Eqs. 4–6) and sourcing decisions; orders enter the supplier queue."),
    PhaseSpec(PhaseId.PH90, "logistics", (ARRIVALS,),
              "Ship queue under capacity gating, defer in-window arrivals (Eqs. 11–12), "
              "expedite (Eqs. 18–19), land arrivals."),
    PhaseSpec(PhaseId.PH99, "accounting", (KPI_ROWS,),
              "Read-only KPI rows, cost rollup, trace."),
)

PHASE_ORDER: dict[PhaseId, int] = {spec.id: i for i, spec in enumerate(PIPELINE)}
TRANSIENT_OWNER: dict[str, PhaseId] = {
    key: spec.id for spec in PIPELINE for key in spec.owns
}

# Persistent-state write authorization (phase → may write).
PERSISTENT_WRITERS: dict[str, tuple[PhaseId, ...]] = {
    ST_ON_HAND: (PhaseId.PH50, PhaseId.PH90),
    ST_BACKLOG: (PhaseId.PH60,),
    ST_LOST_SALES: (PhaseId.PH60,),
    ST_PIPELINE: (PhaseId.PH80, PhaseId.PH90),
    ST_QUEUE: (PhaseId.PH80, PhaseId.PH90),
    ST_FG_ON_HAND: (PhaseId.PH30, PhaseId.PH50),
    # The cost ledger is an append-only sink: any phase may add a contribution.
    ST_COST_LEDGER: tuple(PhaseId),
}

ALL_KEYS = set(TRANSIENT_OWNER) | set(PERSISTENT_WRITERS)


class Hook(BaseModel):
    """A policy's declared residency in one phase — Part IX §9.2 (binding)."""

    phase: PhaseId
    priority: int = Field(50, ge=0, le=100, description="Lower runs first within the phase.")
    reads: set[str] = Field(default_factory=set)
    writes: set[str] = Field(default_factory=set)
    resolution: Optional[str] = Field(
        None,
        description=(
            "Required when this hook writes a key another hook in the same phase also "
            "writes: a one-line statement of how the overlap is resolved."
        ),
    )


@dataclass(frozen=True)
class BoundHook:
    """A hook bound to its owner (policy id or engine mechanic id)."""

    owner: str
    hook: Hook
    is_mechanic: bool = False


class PipelineValidationError(Exception):
    """Hard load-time error — the mechanical twin of the statistical
    constraint-overlap warning (Part IX §9.2)."""


def validate_hooks(bound: list[BoundHook]) -> None:
    """Enforce the §9.2 load-time contract over mechanics + policy hooks."""
    for bh in bound:
        if bh.hook.phase not in PHASE_ORDER:
            raise PipelineValidationError(f"{bh.owner}: unknown phase {bh.hook.phase!r}")
        for key in bh.hook.reads | bh.hook.writes:
            if key not in ALL_KEYS:
                raise PipelineValidationError(f"{bh.owner}: unknown state key {key!r}")

    # Write authorization.
    for bh in bound:
        for key in bh.hook.writes:
            if key in TRANSIENT_OWNER:
                if TRANSIENT_OWNER[key] != bh.hook.phase:
                    raise PipelineValidationError(
                        f"{bh.owner}: writes {key!r} in {bh.hook.phase.value}, but the key is "
                        f"owned by {TRANSIENT_OWNER[key].value}"
                    )
            else:
                if bh.hook.phase not in PERSISTENT_WRITERS[key]:
                    allowed = ", ".join(p.value for p in PERSISTENT_WRITERS[key])
                    raise PipelineValidationError(
                        f"{bh.owner}: persistent key {key!r} is writable only from [{allowed}], "
                        f"not {bh.hook.phase.value}"
                    )

    # Read-before-write on transient keys.
    for bh in bound:
        for key in bh.hook.reads:
            if key not in TRANSIENT_OWNER:
                continue  # persistent: last week's value is always defined
            owner_phase = TRANSIENT_OWNER[key]
            if PHASE_ORDER[owner_phase] < PHASE_ORDER[bh.hook.phase]:
                continue
            if PHASE_ORDER[owner_phase] > PHASE_ORDER[bh.hook.phase]:
                raise PipelineValidationError(
                    f"{bh.owner}: reads {key!r} in {bh.hook.phase.value} before its owning phase "
                    f"{owner_phase.value} has run"
                )
            # Same phase: every writer must be ordered strictly before this reader.
            writers = [
                o for o in bound
                if o.hook.phase == bh.hook.phase and key in o.hook.writes and o is not bh
            ]
            for w in writers:
                if w.hook.priority >= bh.hook.priority:
                    raise PipelineValidationError(
                        f"{bh.owner}: reads {key!r} in {bh.hook.phase.value} at priority "
                        f"{bh.hook.priority}, but {w.owner} writes it at priority "
                        f"{w.hook.priority} (must be strictly earlier)"
                    )

    # Same-phase same-key write conflicts: distinct priorities + declared resolution.
    by_phase_key: dict[tuple[PhaseId, str], list[BoundHook]] = {}
    for bh in bound:
        for key in bh.hook.writes:
            if key == ST_COST_LEDGER:
                continue  # append-only sink, commutative
            by_phase_key.setdefault((bh.hook.phase, key), []).append(bh)
    for (phase, key), writers in by_phase_key.items():
        if len(writers) < 2:
            continue
        prios = [w.hook.priority for w in writers]
        if len(set(prios)) != len(prios):
            names = ", ".join(w.owner for w in writers)
            raise PipelineValidationError(
                f"write conflict on {key!r} in {phase.value}: [{names}] share a priority — "
                f"declare an explicit ordering (distinct priorities)"
            )
        ordered = sorted(writers, key=lambda w: w.hook.priority)
        for later in ordered[1:]:
            if not later.is_mechanic and later.hook.resolution is None:
                raise PipelineValidationError(
                    f"{later.owner}: writes {key!r} in {phase.value} after "
                    f"{ordered[0].owner} without a declared resolution rule"
                )


def pipeline_schema() -> dict:
    """Stable description of the pipeline for snapshotting and the registry."""
    return {
        "phases": [
            {
                "id": spec.id.value,
                "name": spec.name,
                "owns": list(spec.owns),
                "description": spec.description,
            }
            for spec in PIPELINE
        ],
        "persistent_state": {
            key: [p.value for p in phases] for key, phases in PERSISTENT_WRITERS.items()
        },
    }
