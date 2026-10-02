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
  replications, seed, crn, warmup_mode, disruption_schedule, …).

No network, no database, no clock: everything it needs is passed in.
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
                "bom", "bom_multi_level")


def dataset_inputs(dataset: dict[str, Any]) -> dict[str, list[dict]]:
    """The simulation's input tables from a dataset snapshot (v1 or v2) or a
    plain dict of tables. Missing tables are empty, never invented."""
    tables = dataset.get("inputs") if isinstance(dataset.get("inputs"), dict) else dataset
    return {t: list(tables.get(t) or []) for t in INPUT_TABLES}


def run_from_snapshots(
    dataset: dict[str, Any],
    policy_snapshot: dict[str, Any],
    scenario: dict[str, Any],
    project_model: Optional[str] = None,
    on_replication: Optional[Callable[[dict, int, int], None]] = None,
) -> dict[str, Any]:
    """Compute one run. Returns::

        {"engine_version", "run_update", "replications", "item_series", "series"}

    ``run_update`` is the simulation_runs row the worker writes (minus the ids
    and timestamps a database assigns); ``replications`` are run_replications
    rows; ``series`` is the long-form weekly table the API serves as Parquet.
    """
    t = dataset_inputs(dataset)
    data = build_project_data(
        suppliers=t["suppliers"], materials=t["materials"], products=t["products"],
        inbound=t["inbound"], outbound=t["outbound"], customers=t["customers"],
        # The worker's rule: multi-level BOM rows win when there are any.
        bom=t["bom_multi_level"] or t["bom"],
        policies=snapshot_to_policies(policy_snapshot or {}),
        scenario=scenario or {},
        project_model=project_model,
    )
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
    }
