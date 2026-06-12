"""Phase pipeline contract: load-time validation + schema snapshot (Part IX)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from scsim import ENGINE_VERSION
from scsim.core.phases import (
    INVENTORY_LEVELS,
    PRODUCTION_OUTPUT,
    PURCHASE_ORDERS,
    ST_ON_HAND,
    BoundHook,
    Hook,
    PhaseId,
    PipelineValidationError,
    pipeline_schema,
    validate_hooks,
)

SNAPSHOT = Path(__file__).resolve().parents[1] / "scsim" / "pipeline_schema.json"


def test_pipeline_schema_snapshot_frozen():
    """Accidental phase reordering / contract drift fails the build (R8).
    A deliberate Tier-3 change must re-freeze the snapshot + ship an ADR."""
    current = {"engine_version": ENGINE_VERSION, **pipeline_schema()}
    frozen = json.loads(SNAPSHOT.read_text())
    assert current == frozen, (
        "pipeline schema drifted from scsim/pipeline_schema.json — if intentional "
        "(Tier-3), re-freeze the snapshot and add an ADR (docs/adr/)"
    )


def _bh(owner, **kw):
    return BoundHook(owner=owner, hook=Hook(**kw))


def test_unknown_state_key_rejected():
    with pytest.raises(PipelineValidationError, match="unknown state key"):
        validate_hooks([_bh("x", phase=PhaseId.PH40, writes={"made_up"})])


def test_write_outside_owning_phase_rejected():
    with pytest.raises(PipelineValidationError, match="owned by PH-70"):
        validate_hooks([_bh("x", phase=PhaseId.PH40, writes={INVENTORY_LEVELS})])


def test_persistent_write_authorization():
    with pytest.raises(PipelineValidationError, match="writable only from"):
        validate_hooks([_bh("x", phase=PhaseId.PH10, writes={ST_ON_HAND})])


def test_read_before_write_rejected():
    # production_output is owned by PH-50; reading it in PH-40 is a contract breach.
    with pytest.raises(PipelineValidationError, match="before its owning phase"):
        validate_hooks([_bh("x", phase=PhaseId.PH40, reads={PRODUCTION_OUTPUT})])


def test_same_phase_reader_needs_an_earlier_writer():
    writer = _bh("w", phase=PhaseId.PH80, priority=60, writes={PURCHASE_ORDERS})
    reader = _bh("r", phase=PhaseId.PH80, priority=50, reads={PURCHASE_ORDERS})
    with pytest.raises(PipelineValidationError, match="before any writer"):
        validate_hooks([writer, reader])


def test_same_phase_read_modify_write_chain_is_valid():
    """The declared-resolution pattern: release (50) → split (55) → reroute (60),
    each reading the previous version — must validate (P-P.1/P-S.2/P-S.1)."""
    a = _bh("a", phase=PhaseId.PH80, priority=50, writes={PURCHASE_ORDERS})
    b = BoundHook(owner="b", hook=Hook(
        phase=PhaseId.PH80, priority=55, reads={PURCHASE_ORDERS},
        writes={PURCHASE_ORDERS}, resolution="splits a's orders"))
    c = BoundHook(owner="c", hook=Hook(
        phase=PhaseId.PH80, priority=60, reads={PURCHASE_ORDERS},
        writes={PURCHASE_ORDERS}, resolution="reroutes b's slices"))
    validate_hooks([a, b, c])  # no raise


def test_write_conflict_needs_distinct_priorities():
    a = _bh("a", phase=PhaseId.PH80, priority=50, writes={PURCHASE_ORDERS})
    b = _bh("b", phase=PhaseId.PH80, priority=50, writes={PURCHASE_ORDERS})
    with pytest.raises(PipelineValidationError, match="share a priority"):
        validate_hooks([a, b])


def test_write_conflict_needs_resolution_rule():
    a = _bh("a", phase=PhaseId.PH80, priority=50, writes={PURCHASE_ORDERS})
    b = _bh("b", phase=PhaseId.PH80, priority=60, writes={PURCHASE_ORDERS})
    with pytest.raises(PipelineValidationError, match="without a declared resolution"):
        validate_hooks([a, b])
    ok = BoundHook(owner="b", hook=Hook(
        phase=PhaseId.PH80, priority=60, writes={PURCHASE_ORDERS},
        resolution="reroutes orders placed by a",
    ))
    validate_hooks([a, ok])  # no raise


def test_full_catalog_hooks_validate(single_chain):
    """The shipped mechanics + all 7 implemented policies must co-validate."""
    from scsim.core.engine import compile_scenario

    sc = single_chain.with_policies({
        "inventory_control": {},
        "unmet_demand_handling": {},
        "safety_stock_materials": {},
        "short_term_capacity": {},
        "material_allocation": {},
        "expedited_shipments": {},
    })
    compile_scenario(sc)  # raises on any hook-contract violation
