"""Serverless simulation engine — runs scsim on Vercel, no Fly/Redis worker.

The original architecture routed experiment.run through an Upstash Redis
stream to an always-on Fly.io worker. That worker requires a Fly account +
token this deployment does not have (the deploy has failed every time), so
every run sat "queued" forever. This function replaces it: the browser POSTs
the project dataset + saved policy snapshot + scenario here, we run the SAME
canonical pipeline the worker would (snapshot → ProjectData → scsim) and
return the persisted-row-shaped result, which the browser writes to Supabase.
No new infrastructure, no secrets — it runs inside the Vercel deployment the
app already ships.

Route: POST /api/run_simulation
Body:  { run_id, project_id, snapshot, scenario, project_model, dataset:
         { suppliers, materials, products, inbound, bom, outbound } }
Reply: { ok, run_update, replications, engine_version, mapping_warnings }
"""
from __future__ import annotations

import json
import time
import traceback
from http.server import BaseHTTPRequestHandler
from typing import Any

# Pure ingestion + compute path (no redis — see sim_worker/__init__.py).
from sim_worker.datamap import build_project_data
from sim_worker.policy_snapshot import snapshot_to_policies
from sim_worker.scsim_bridge import compute_run_from_project

_NON_ROW_KEYS = {
    "replications", "mapping_warnings", "feasibility_warnings", "scsim_notes",
    "n_reps", "warmup_detected_at", "below_replication_floor",
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _build_run_update(kpis: dict[str, Any], n_reps: int) -> dict[str, Any]:
    """Engine KPI dict → simulation_runs row patch. Mirrors
    sim_worker.worker.build_run_update (kept in step; reimplemented here to
    avoid importing worker.py, which needs redis)."""
    aggregate = {k[len("mean_"):]: v for k, v in kpis.items() if k.startswith("mean_")}
    aggregate["_meta"] = {
        "engine": kpis.get("source", "vercel"),
        **({"scsim_notes": kpis["scsim_notes"]} if kpis.get("scsim_notes") else {}),
    }
    if kpis.get("source") == "scsim":
        code_version = f"scsim-{kpis.get('engine_version', 'unknown')}"
    else:
        code_version = "worker-legacy"
    patch: dict[str, Any] = {
        "status": "done",
        "ended_at": _now(),
        "aggregate_kpis": aggregate,
        "ci_half_widths": {k[len("ci_"):]: v for k, v in kpis.items() if k.startswith("ci_")},
        "code_version": code_version,
        "rep_count_done": n_reps,
    }
    if kpis.get("mapping_warnings") is not None:
        patch["mapping_warnings"] = kpis["mapping_warnings"]
    if kpis.get("warmup_detected_at") is not None:
        patch["warmup_detected_at"] = kpis["warmup_detected_at"]
    return patch


def run_simulation(body: dict[str, Any]) -> dict[str, Any]:
    run_id = body.get("run_id")
    project_id = body.get("project_id")
    snapshot = body.get("snapshot") or {}
    scenario = body.get("scenario") or {}
    project_model = body.get("project_model")
    ds = body.get("dataset") or {}

    policies = snapshot_to_policies(snapshot)
    data = build_project_data(
        suppliers=ds.get("suppliers") or [],
        materials=ds.get("materials") or [],
        products=ds.get("products") or [],
        inbound=ds.get("inbound") or [],
        bom=ds.get("bom") or [],
        outbound=ds.get("outbound") or [],
        policies=policies,
        scenario=scenario,
        project_model=project_model,
    )
    kpis = compute_run_from_project(data)

    n_reps = int(kpis.get("n_reps", scenario.get("replications", 1)) or 1)
    run_update = _build_run_update(kpis, n_reps)

    # Persisted per-replication rows, ready for the browser to upsert into
    # run_replications (bound to this run + project).
    replications = [
        {
            "run_id": run_id,
            "project_id": project_id,
            "rep_index": r["rep_index"],
            "seed_used": r["seed_used"],
            "status": "done",
            "kpis": r.get("kpis", {}),
            "time_series": r.get("time_series", {}),
            "warmup_at": r.get("warmup_at"),
            "ended_at": _now(),
        }
        for r in (kpis.get("replications") or [])
    ]

    return {
        "ok": True,
        "run_id": run_id,
        "engine_version": kpis.get("engine_version"),
        "run_update": run_update,
        "replications": replications,
        "mapping_warnings": kpis.get("mapping_warnings") or [],
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict[str, Any]) -> None:
        blob = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()
        self.wfile.write(blob)

    def do_OPTIONS(self) -> None:  # noqa: N802 — CORS preflight
        self._send(200, {"ok": True})

    def do_POST(self) -> None:  # noqa: N802
        try:
            length = int(self.headers.get("content-length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw or b"{}")
        except Exception as exc:  # malformed request
            self._send(400, {"ok": False, "error": f"bad request: {exc}"})
            return
        try:
            self._send(200, run_simulation(body))
        except Exception as exc:
            # Surface the real failure — the browser toasts server errors now.
            self._send(500, {
                "ok": False,
                "error": str(exc)[:500],
                "trace": traceback.format_exc()[-1500:],
            })
