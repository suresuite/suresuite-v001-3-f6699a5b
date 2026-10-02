#!/usr/bin/env python3
"""Record the notebooks' offline demo from the REAL engine.

The SuReSuite notebooks run in two modes: LIVE (the hosted /v1 API, with a key)
and DEMO (no key). Demo mode replays the responses this script writes to
``notebooks/demo/example_project.json``. Every number in that file is engine
output, produced the way the platform produces it:

    scripts/example_project/dataset.json          (the Example — 1P/2M/3S project)
      -> sim_worker.datamap.build_project_data    (the worker's own mapping input)
      -> sim_worker.scsim_bridge.compute_run_from_project   (map + run_scenario)
      -> sim_worker.worker.build_run_update       (the simulation_runs row the API reads)

so a demo run row has the same keys a live ``GET /runs/{id}`` returns —
``aggregate_kpis`` with its ``_range`` and ``_meta`` entries included.

The RECORDINGS below are the closed set of experiments the notebooks perform in
demo mode. A demo request outside the set is refused by the notebook client with
"no recording", never answered with a made-up number.

Usage (from the repository root; the engine and worker must be importable):

    pip install -e ./scsim -e ./sim-worker -r sim-worker/requirements.txt
    python notebooks/tools/record_demo.py           # (re)write the fixture
    python notebooks/tools/record_demo.py --check   # fail if it would change

Run it from OUTSIDE the repository root or with the packages installed — the
repo's ``scsim/`` folder shadows the installed package when the working
directory is the root, which is why this script resolves paths itself.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "scripts" / "example_project" / "dataset.json"
REGISTRY = ROOT / "supabase" / "functions" / "_shared" / "registry.generated.json"
OUT = ROOT / "notebooks" / "demo" / "example_project.json"

# The repo root's `scsim/` directory is a namespace-package shadow of the real
# package; make sure the installed one wins whatever the working directory is.
if str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
if "" in sys.path:
    sys.path.remove("")

FIXED_TS = "2026-10-01T00:00:00+00:00"
NAMESPACE = uuid.UUID("6f1c2d6e-7c1a-4f0e-9a43-5d0c9b7e2a11")

# The scenario frame every recording uses. Matches the Simulation Lab's default
# horizon (364 days = 52 weeks, the engine floor) and its default seed and
# replication count, with common random numbers on so runs pair replication by
# replication.
FRAME = {"horizon_days": 364, "warmup_days": 14, "replications": 10, "seed": 42, "crn": True}

# Weekly series kept in the demo (the live Parquet object carries all eleven).
DEMO_SERIES = ["fill_rate", "backlog_units", "on_hand_units", "on_hand_value", "revenue_value"]

SS = lambda days: {"inventory": {"safety_stock_method": "fixed_days", "safety_stock_days": days}}  # noqa: E731
OUTAGE_S2 = [{"target": "S2", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}]
OUTAGE_S1 = [{"target": "S1", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}]
CUT_S2 = [{"target": "S2", "start_day": 140, "duration_days": 42, "magnitude_pct": 60}]
PLANT = [{"target": "plant", "start_day": 140, "duration_days": 28, "magnitude_pct": 100}]

# (label, policy families, disruption schedule). The notebook client keys a demo
# dispatch on exactly these two things plus FRAME.
RECORDINGS = [
    ("baseline", {}, []),
    ("safety_stock_28d", SS(28), []),
    ("s2_outage", {}, OUTAGE_S2),
    ("s2_outage_safety_stock_7d", SS(7), OUTAGE_S2),
    ("s2_outage_safety_stock_14d", SS(14), OUTAGE_S2),
    ("s2_outage_safety_stock_28d", SS(28), OUTAGE_S2),
    ("s2_outage_safety_stock_42d", SS(42), OUTAGE_S2),
    ("s2_capacity_cut_60", {}, CUT_S2),
    ("s1_outage", {}, OUTAGE_S1),
    ("plant_shutdown", {}, PLANT),
]


def canon(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


def sha(v) -> str:
    return hashlib.sha256(canon(v).encode()).hexdigest()


def demo_key(policies: dict, schedule: list, frame: dict) -> str:
    """The identity a demo dispatch is looked up by. MUST match
    ``_demo_key`` in python/suresuite/client.py (pinned by the tests)."""
    pol = {f: v for f, v in sorted(policies.items()) if v}
    sched = sorted(
        ({"target": str(e["target"]), "start_day": int(e["start_day"]),
          "duration_days": int(e["duration_days"]),
          "magnitude_pct": float(e.get("magnitude_pct", 100))} for e in schedule),
        key=canon,
    )
    fr = {k: frame[k] for k in ("horizon_days", "replications", "seed", "crn")}
    return sha({"policies": pol, "schedule": sched, "frame": fr})


def record() -> dict:
    from scsim import ENGINE_VERSION
    from sim_worker.local import run_from_snapshots

    ds = json.loads(DATASET.read_text())
    registry = json.loads(REGISTRY.read_text())
    tables = {k: ds[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}
    graph_hash = sha(tables)

    recordings = []
    for label, policies, schedule in RECORDINGS:
        # The one local-run entry point (Phase 12 · WP 12.1) — the same function
        # the browser engine and the `suresuite` package call.
        out = run_from_snapshots(
            {"schema_version": 2, "inputs": tables},
            {"schema_version": 2, "defaults": policies, "overrides": []},
            {**FRAME, "warmup_mode": "auto", "disruption_schedule": schedule},
            project_model="Make-To-Order",
        )
        update = out["run_update"]
        update.pop("mapping_warnings", None)  # GET /runs does not return them

        reps = [{
            "rep_index": r["rep_index"], "seed_used": r["seed_used"], "status": "done",
            "kpis": r["kpis"], "warmup_at": r["warmup_at"],
            "started_at": FIXED_TS, "ended_at": FIXED_TS,
        } for r in out["replications"]]
        series_cols = {c: out["series"][c] for c in ["rep_index", "model_rep", "event_rep", "week", *DEMO_SERIES]}

        recordings.append({
            "label": label,
            "key": demo_key(policies, schedule, FRAME),
            "policies": policies,
            "disruption_schedule": schedule,
            "run": {
                **update,
                "rep_count_target": FRAME["replications"],
                "graph_hash": graph_hash,
            },
            "replications": reps,
            "series": series_cols,
        })

    project_id = str(uuid.uuid5(NAMESPACE, "project"))
    return {
        "_provenance": {
            "what": "Recorded engine output replayed by the SuReSuite notebooks' offline demo mode.",
            "dataset": "Example — 1P/2M/3S (scripts/example_project/dataset.json)",
            "engine_version": ENGINE_VERSION,
            "frame": FRAME,
            "recorded_by": "python notebooks/tools/record_demo.py",
            "note": "Weekly series keep five of the engine's eleven published series; a live run's "
                    "Parquet object carries all of them.",
        },
        "project": {
            "id": project_id, "name": "Example — 1P/2M/3S (demo)", "plant_name": "Example Plant",
            "supply_chain_model": "Make-To-Order", "organization": "Demo organization",
            "organization_id": str(uuid.uuid5(NAMESPACE, "org")),
            "created_at": FIXED_TS, "updated_at": FIXED_TS,
        },
        "dataset": {k: ds[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")},
        "graph_hash": graph_hash,
        "catalog": {k: registry[k] for k in ("engine_version", "policies", "kpis", "base_data_requirements")},
        "recordings": recordings,
    }


def same(a, b, rel=1e-6, abs_=1e-4) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k], rel, abs_) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y, rel, abs_) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))
    return a == b


def render(doc: dict) -> str:
    """Compact JSON with one top-level key — and one recording — per line, so a
    re-recording's diff names the recordings that moved."""
    dump = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    lines = []
    for k, v in doc.items():
        if k == "recordings":
            inner = ",\n".join("  " + dump(r) for r in v)
            lines.append(f' {dump(k)}:[\n{inner}\n ]')
        else:
            lines.append(f" {dump(k)}:{dump(v)}")
    return "{\n" + ",\n".join(lines) + "\n}\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="fail if the fixture would change")
    args = ap.parse_args()
    text = render(record())
    if args.check:
        current = OUT.read_text() if OUT.exists() else ""
        # Same structure, same strings, numbers equal to the engine's rounding:
        # nothing pins numpy, and a last-digit float difference between builds is
        # not a changed demo. A changed RESULT is.
        if current != text and not same(json.loads(current or "null"), json.loads(text)):
            print(f"{OUT.relative_to(ROOT)} is stale — run python notebooks/tools/record_demo.py",
                  file=sys.stderr)
            return 1
        print(f"{OUT.relative_to(ROOT)} is current ({len(RECORDINGS)} recordings)")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(RECORDINGS)} recordings, {len(text):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
