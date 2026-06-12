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
from typing import Any

import networkx as nx

log = logging.getLogger(__name__)

# KPI keys mirrored into the legacy mean_/ci_ broadcast shape.
_BRIDGE_KEYS = (
    "fill_rate", "revenue", "lost_sales_value", "cost_of_resilience",
    "max_backlog", "lost_inbound_units", "ttr_weeks", "tts_weeks",
)


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
        out[f"mean_{key}"] = round(agg["mean"], 4)
        out[f"ci_{key}"] = round(agg["ci_halfwidth"], 4)
        out[f"min_{key}"] = round(agg["min"], 4)
        out[f"max_{key}"] = round(agg["max"], 4)

    # Back-compat aliases consumed by the existing broadcast handler.
    out["fill_rate"] = out.get("mean_fill_rate", 0.0)
    out["otif"] = out.get("mean_fill_rate", 0.0)
    out["revenue"] = out.get("mean_revenue", 0.0)
    return out
