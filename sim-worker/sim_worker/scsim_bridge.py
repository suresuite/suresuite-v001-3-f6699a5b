"""Opt-in bridge from the sim-worker to the scsim phase-pipeline engine.

The legacy engine (``sim_worker.engine``) stays the default. Set
``SCSIM_ENGINE=1`` (or pass ``use_scsim=True``) to route ``experiment.run``
workloads through scsim: the project graph + effective policies convert via
``scsim.io.legacy_graph.from_legacy_graph`` (structural mapping — every
approximation is surfaced in ``scsim_notes``), and the result comes back in
the worker's ``mean_*/ci_*`` broadcast shape with the engine version and
statistical badges attached.

scsim is imported lazily so the worker keeps running where the package
isn't installed (install with: ``pip install -e ../scsim``).
"""
from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # networkx is only needed by the legacy graph path
    import networkx as nx  # noqa: F401  (compute_kpis_scsim imports it lazily)

log = logging.getLogger(__name__)

# KPI keys mirrored into the legacy mean_/ci_ broadcast shape.
_BRIDGE_KEYS = (
    "fill_rate", "revenue", "lost_sales_value", "cost_of_resilience",
    "max_backlog", "lost_inbound_units", "ttr_weeks", "tts_weeks",
    # Inventory window averages (G19). `avg_on_hand_value` was computed by
    # `compute_replication_kpis` and offered as a focal KPI by the /policies
    # grid, but was never aggregated here — so it reached a user per
    # replication and never as a run figure. The other three arrive with the
    # material/finished-goods split.
    "avg_on_hand_value", "avg_fg_value", "avg_on_hand_units", "avg_fg_units",
    # Capacity (WP 9.3 / §4 D165). `capacity_utilization` was computed by
    # `compute_replication_kpis` and never aggregated here, so it reached a user
    # per replication and never as a run figure — the same omission this list
    # had for `avg_on_hand_value` one line above. It was also NaN on every run
    # that was not a full-debug inspection, which is why nobody noticed.
    "capacity_utilization", "supplier_capacity_utilization",
    "products_capacity_bound", "suppliers_capacity_bound",
)


def _finite(v: Any, ndigits: int) -> Any:
    """Round a numeric value, mapping non-finite floats (NaN/±inf) to None.

    The engine uses NaN as a deliberate "not measured" sentinel (e.g.
    capacity_utilization without full-debug matrices), but json.dumps emits a
    literal ``NaN`` token for it — invalid JSON that PostgREST rejects, which
    once silently dropped EVERY run_replications upsert of an otherwise green
    run. None serializes to null and survives the trip."""
    import math
    f = float(v)
    if not math.isfinite(f):
        return None
    return round(f, ndigits)


def scsim_enabled() -> bool:
    return os.getenv("SCSIM_ENGINE", "").lower() in ("1", "true", "yes")


def compute_kpis_scsim(
    graph: nx.DiGraph,
    policies: dict | None = None,
    n_weeks: int = 52,
    seed: int = 42,
    n_reps: int = 30,
    disruption_schedule: list[dict] | None = None,
) -> dict[str, Any]:
    """Drop-in sibling of ``engine.compute_kpis`` running on scsim."""
    import networkx as nx  # noqa: F401  (legacy-graph path only; kept out of
    #                        the serverless bundle, which never calls this)
    from scsim import ENGINE_VERSION
    from scsim.core.engine import run_scenario
    from scsim.io.legacy_graph import from_legacy_graph

    conversion = from_legacy_graph(
        graph,
        policies or {},
        horizon_weeks=max(52, n_weeks),
        seed=seed,
        model_seeds=n_reps,
        disruption_schedule=disruption_schedule or [],
    )
    result = run_scenario(conversion.scenario)

    out: dict[str, Any] = {
        "source": "scsim",
        "engine_version": ENGINE_VERSION,
        "n_reps": result.stats.n_replications,
        "below_replication_floor": result.stats.below_replication_floor,
        "scsim_notes": conversion.notes,
        "feasibility_warnings": [
            {"code": w.code, "message": w.message} for w in result.feasibility_warnings
        ],
    }
    for key in _BRIDGE_KEYS:
        agg = result.aggregates.get(key)
        if agg is None:
            continue
        out[f"mean_{key}"] = _finite(agg["mean"], 4)
        out[f"ci_{key}"] = _finite(agg["ci_halfwidth"], 4)
        out[f"min_{key}"] = _finite(agg["min"], 4)
        out[f"max_{key}"] = _finite(agg["max"], 4)

    # Back-compat aliases consumed by the existing broadcast handler.
    out["fill_rate"] = out.get("mean_fill_rate", 0.0)
    out["otif"] = out.get("mean_fill_rate", 0.0)
    out["revenue"] = out.get("mean_revenue", 0.0)
    return out


def compute_run_from_project(data: Any, on_replication: Any = None) -> dict[str, Any]:
    """Canonical experiment path: map a ProjectData (item masters + logistics +
    policies + scenario) into an scsim Scenario, run it, and return both the
    aggregate broadcast shape AND per-replication rows + mapping warnings, ready
    for the worker to persist as the sole writer.

    ``on_replication(rep_row, done, total)`` — optional live observer, invoked
    from the engine thread after EACH replication completes with a row already
    in the run_replications persistence shape (rep_index / seed_used / kpis /
    time_series). The final return value still carries the complete
    ``replications`` list, so streamed upserts are safely idempotent."""
    from scsim import ENGINE_VERSION
    from scsim.core.engine import run_scenario
    from scsim.io import from_project_data

    mapping = from_project_data(data)
    project_seed = int(mapping.scenario.settings.project_seed)

    progress = None
    if on_replication is not None:
        def progress(done: int, total: int, row: dict, series: dict) -> None:
            on_replication({
                "rep_index": done - 1,
                "seed_used": project_seed * 1000 + int(row.get("model_rep", done - 1)),
                "kpis": {k: _finite(v, 6) for k, v in row.items()},
                "time_series": {
                    k: [_finite(x, 5) for x in v.tolist()] for k, v in series.items()
                },
                "warmup_at": None,  # known only at run end; final upsert fills it
            }, done, total)

    result = run_scenario(mapping.scenario, progress=progress)

    out: dict[str, Any] = {
        "source": "scsim",
        "engine_version": ENGINE_VERSION,
        "n_reps": result.stats.n_replications,
        "below_replication_floor": result.stats.below_replication_floor,
        "mapping_warnings": mapping.warning_dicts,
        "warmup_detected_at": (result.warmup.adopted_week if result.warmup else None),
        "feasibility_warnings": [
            {"code": w.code, "message": w.message} for w in result.feasibility_warnings
        ],
    }
    for key in _BRIDGE_KEYS:
        agg = result.aggregates.get(key)
        if agg is None:
            continue
        out[f"mean_{key}"] = _finite(agg["mean"], 4)
        out[f"ci_{key}"] = _finite(agg["ci_halfwidth"], 4)
        out[f"min_{key}"] = _finite(agg["min"], 4)
        out[f"max_{key}"] = _finite(agg["max"], 4)
    out["fill_rate"] = out.get("mean_fill_rate", 0.0)
    out["otif"] = out.get("mean_fill_rate", 0.0)
    out["revenue"] = out.get("mean_revenue", 0.0)

    seed = project_seed
    cells = result.rep_cells or [(i, 0) for i in range(len(result.kpis))]
    # Weekly per-rep series: fill_rate plus whatever else the engine publishes
    # (scsim's `WEEKLY_SERIES`, the `published` subset). Iterated generically
    # rather than by name, so a series added to the engine's declaration
    # arrives here without a change — which is why this loop was already right
    # when `fg_value` was added and the two hand-kept lists around it were not.
    # getattr-guarded so an older engine wheel without extra_series keeps working.
    extra = getattr(result, "extra_series", None) or {}

    def _series_for(i: int) -> dict:
        if i >= len(result.fr_series):
            return {}
        ts = {"fill_rate": [_finite(x, 5) for x in result.fr_series[i].tolist()]}
        for key, rows in extra.items():
            if i < len(rows):
                ts[key] = [_finite(x, 5) for x in rows[i].tolist()]
        return ts

    out["replications"] = [
        {
            "rep_index": i,
            "seed_used": seed * 1000 + int(cells[i][0]) if i < len(cells) else seed,
            "kpis": {k: _finite(v, 6) for k, v in row.items()},
            "time_series": _series_for(i),
            "warmup_at": out["warmup_detected_at"],
        }
        for i, row in enumerate(result.kpis)
    ]

    # Single-run inspection surface (G17/§9.5.1): per-item weekly series rows,
    # ready for the run_item_series persistence shape. Present ONLY when the
    # engine produced them (trace full_debug + exactly 1 replication).
    # getattr-guarded so an older engine wheel keeps working.
    # WHICH products/suppliers capacity bound (WP 9.3). A run-level fact, not a
    # per-replication one, so it travels beside the aggregates rather than on
    # every replication row. getattr-guarded like its neighbours so an older
    # engine wheel keeps working — an absent key reads as "this run predates the
    # measurement", which the surface says rather than drawing an empty table.
    capacity_binding = getattr(result, "capacity_binding", None)
    if capacity_binding:
        out["capacity_binding"] = capacity_binding

    item_series = getattr(result, "item_series", None)
    item_ids = getattr(result, "item_ids", None)
    if item_series and item_ids:
        rows_by_item: dict[tuple[str, str], dict[str, list]] = {}
        for series_key, matrix in item_series.items():
            kind, _, name = series_key.partition(".")
            ids = item_ids.get(kind) or []
            for idx, item_id in enumerate(ids):
                if idx >= len(matrix):
                    continue
                bucket = rows_by_item.setdefault((kind, str(item_id)), {})
                bucket[name] = [_finite(x, 5) for x in matrix[idx].tolist()]
        out["item_series"] = [
            {"kind": kind, "item_id": item_id, "series": series}
            for (kind, item_id), series in sorted(rows_by_item.items())
        ]
    return out
