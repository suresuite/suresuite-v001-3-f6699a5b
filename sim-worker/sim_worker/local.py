"""Run a simulation from frozen inputs, anywhere — Phase 12 · WP 12.1.

ONE entry point for every place a run is computed outside the Fly worker:

* the browser engine (Run & Validate, Pyodide — `src/lib/sim/engine.worker.ts`),
* a user's own machine through the `suresuite` Python package,
* the notebooks' demo recorder (`notebooks/tools/record_demo.py`).

It is the worker's pipeline, not a copy of it:

    snapshot_to_policies → build_project_data → compute_run_from_project
      → run_shape.build_run_update, series_store.long_columns

so a run computed here from a dataset version and a policy version is the run
the worker computes from the same versions. Before WP 12.1 the browser carried
its own copy of this pipeline as a string, and its result shaping had already
drifted from the worker's (§4 D273).

Inputs are what the platform freezes:

* ``dataset`` — a ``dataset_versions.snapshot`` (``schema_version`` 2: tables
  under ``inputs``; v1: at the top level), or the same tables as a plain dict;
* ``policy_snapshot`` — a ``policy_versions`` snapshot (v1 or v2);
* ``scenario`` — the scenario fields the engine reads (horizon_days,
  replications, seed, crn, warmup_mode, disruption_schedule, …);
* ``recovery`` — the scenario's resolved recovery playbook, merged over the
  policy version's default recovery family (what the dispatcher sends as
  ``recovery``; the worker used to merge it itself).

No network, no database, no clock: everything it needs is passed in.

SINCE PLAN.md §23 WP 13.2 THE FLY WORKER CALLS THIS TOO (§4 D280). Before it,
the worker built its engine input from the project's LIVE tables at the moment
it started, so a run stamped with a dataset version could be computed from data
edited after dispatch. It now fetches the run's `dataset_versions.snapshot` and
its policy version and computes here — one pipeline, three callers.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from .datamap import build_project_data
from .policy_snapshot import snapshot_to_policies
from .run_shape import build_run_update
from .scsim_bridge import compute_run_from_project
from .series_store import long_columns

# The tables a simulation reads — the snapshot's `inputs` domain (WP 11.2 pins
# it to the worker's read set, `simulationScopeParity.test.ts`).
INPUT_TABLES = ("suppliers", "materials", "products", "customers", "inbound", "outbound",
                "bom", "bom_multi_level", "demand_forecasts")


def dataset_inputs(dataset: dict[str, Any]) -> dict[str, list[dict]]:
    """The simulation's input tables from a dataset snapshot (v1 or v2) or a
    plain dict of tables. Missing tables are empty, never invented."""
    tables = dataset.get("inputs") if isinstance(dataset.get("inputs"), dict) else dataset
    return {t: list(tables.get(t) or []) for t in INPUT_TABLES}


def apply_recovery(policies: dict[str, Any], recovery: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Merge a scenario's resolved recovery playbook over the version's default
    recovery family — exactly the merge the worker performed inline before WP
    13.2, moved here so every caller applies it the same way. A null value in the
    playbook is no value (the dispatcher's `resolveRecovery` skips it too)."""
    recovery = {k: v for k, v in (recovery or {}).items() if v is not None}
    if recovery:
        policies.setdefault("default", {})["recovery"] = {
            **(policies.get("default", {}).get("recovery") or {}),
            **recovery,
        }
    return policies


def project_data_from_snapshots(
    dataset: dict[str, Any],
    policy_snapshot: dict[str, Any],
    scenario: dict[str, Any],
    project_model: Optional[str] = None,
    recovery: Optional[dict[str, Any]] = None,
):
    """The engine input a run computes from — frozen inputs only.

    `recovery` is the dispatcher's resolved playbook when the caller has one (the
    worker's envelope); otherwise the scenario's own `recovery_overrides` — so
    the browser and the package apply a scenario's playbook as the worker does
    (§4 D282: before WP 13.2 only the worker applied it)."""
    if recovery is None:
        recovery = (scenario or {}).get("recovery_overrides") or None
    t = dataset_inputs(dataset)
    return build_project_data(
        suppliers=t["suppliers"], materials=t["materials"], products=t["products"],
        inbound=t["inbound"], outbound=t["outbound"], customers=t["customers"],
        demand_forecasts=t["demand_forecasts"],
        # The worker's rule: multi-level BOM rows win when there are any.
        bom=t["bom_multi_level"] or t["bom"],
        policies=apply_recovery(snapshot_to_policies(policy_snapshot or {}), recovery),
        scenario=scenario or {},
        project_model=project_model,
    )


def run_from_snapshots(
    dataset: dict[str, Any],
    policy_snapshot: dict[str, Any],
    scenario: dict[str, Any],
    project_model: Optional[str] = None,
    on_replication: Optional[Callable[[dict, int, int], None]] = None,
    recovery: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Compute one run. Returns::

        {"engine_version", "run_update", "replications", "item_series", "series", "kpis"}

    ``run_update`` is the simulation_runs row the worker writes (minus the ids
    and timestamps a database assigns); ``replications`` are run_replications
    rows; ``series`` is the long-form weekly table the API serves as Parquet;
    ``kpis`` is the engine's own output, which the Fly worker persists through
    its warm tier and streamed writes (WP 13.2).
    """
    data = project_data_from_snapshots(dataset, policy_snapshot, scenario, project_model, recovery)
    out = compute_run_from_project(data, on_replication=on_replication)
    run_update = build_run_update(out, int((scenario or {}).get("replications") or 0))
    run_update.pop("ended_at", None)
    replications = [{**r, "status": "done"} for r in (out.get("replications") or [])]
    return {
        "engine_version": out.get("engine_version"),
        "run_update": run_update,
        "replications": replications,
        "item_series": out.get("item_series") or [],
        "series": long_columns(replications),
        "kpis": out,
    }
