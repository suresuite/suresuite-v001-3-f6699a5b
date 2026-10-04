"""The simulation_runs row a finished run writes — shaped ONCE (Phase 12 · WP 12.1).

Moved out of `worker.py` so that every place a run is computed shapes its result
the same way: the Fly worker, the browser engine (Pyodide cannot import
`worker.py`, which needs httpx and redis) and a user's own machine through
`sim_worker.local`. Before the move the browser carried a hand copy that dropped
`_range` and `capacity_binding` (§4 D273).

Pure: no I/O, no clock — the caller passes `ended_at`.
"""
from __future__ import annotations

from typing import Any


def build_run_update(kpis: dict[str, Any], n_reps: int, ended_at: Any = None) -> dict[str, Any]:
    """Translate an engine KPI dict (mean_*/ci_* shape) into the
    simulation_runs row update persisted after an experiment.run."""
    aggregate = {k[len("mean_"):]: v for k, v in kpis.items() if k.startswith("mean_")}
    # The range across replications the bridge computes and this used to drop
    # (WP 10.6 · §4 D246). Under an underscore key, like `_meta`, so a reader
    # that iterates KPIs is not handed `min_fill_rate` as a KPI of its own.
    rng = {
        k[len("min_"):]: {"min": v, "max": kpis.get("max_" + k[len("min_"):])}
        for k, v in kpis.items() if k.startswith("min_")
    }
    if rng:
        aggregate["_range"] = rng
    aggregate["_meta"] = {
        "engine": kpis.get("source", "worker"),
        **({"scsim_notes": kpis["scsim_notes"]} if kpis.get("scsim_notes") else {}),
        # WHICH products/suppliers capacity bound, and for how many weeks of the
        # analysis window (WP 9.3 / §4 D167). A run-level fact about the run, so
        # it rides `_meta` beside the conversion notes rather than becoming a
        # scalar KPI — `products_capacity_bound` is the scalar, and it cannot
        # name a product.
        **({"capacity_binding": kpis["capacity_binding"]}
           if kpis.get("capacity_binding") else {}),
        # Which rule decided the replication count (audit F-13): the KPI table
        # labels a sequentially stopped run's intervals.
        **({"stopping_rule": kpis["stopping_rule"]} if kpis.get("stopping_rule") else {}),
    }
    if kpis.get("source") == "scsim":
        # WP 15.1 · §4 D292 — the BUILD that ran (`scsim-0.6.1+<digest>`), named by
        # its content; a payload from an older wheel carries only the version.
        code_version = kpis.get("engine_build") or f"scsim-{kpis.get('engine_version', 'unknown')}"
    else:
        code_version = "worker-legacy"
    patch: dict[str, Any] = {
        "status": "done",
        "ended_at": ended_at,
        "aggregate_kpis": aggregate,
        "ci_half_widths": {k[len("ci_"):]: v for k, v in kpis.items() if k.startswith("ci_")},
        "code_version": code_version,
        # The replications that EXIST, not the ones asked for (audit F-18). The
        # legacy engine writes no `run_replications` rows, so it claims none;
        # it used to claim the requested count over an empty table.
        "rep_count_done": len(kpis.get("replications") or []),
    }
    if kpis.get("mapping_warnings") is not None:
        patch["mapping_warnings"] = kpis["mapping_warnings"]
    if kpis.get("warmup_detected_at") is not None:
        patch["warmup_detected_at"] = kpis["warmup_detected_at"]
    return patch
