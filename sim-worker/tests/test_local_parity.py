"""One run, three places, one answer — Phase 12 · WP 12.1 (§4 D273).

A run is computed by the Fly worker, by the browser engine (Pyodide), and — from
Phase 12 — on a user's own machine. All three must produce the SAME run row from
the same frozen inputs, or "simulate locally" means "simulate something else".

This runs the Example project three ways and requires identical results:

  worker   build_project_data → compute_run_from_project → worker.build_run_update
  local    sim_worker.local.run_from_snapshots (a dataset_versions snapshot, v2)
  browser  the Python driver string inside src/lib/sim/engine.worker.ts, executed
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from sim_worker.datamap import build_project_data
from sim_worker.local import dataset_inputs, run_from_snapshots
from sim_worker.policy_snapshot import snapshot_to_policies
from sim_worker.scsim_bridge import compute_run_from_project
from sim_worker.worker import build_run_update

ROOT = Path(__file__).resolve().parents[2]
DS = json.loads((ROOT / "scripts" / "example_project" / "dataset.json").read_text())
TABLES = {k: DS[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}
POLICY = {"schema_version": 2, "defaults": {
    "inventory": {"safety_stock_method": "fixed_days", "safety_stock_days": 14}}, "overrides": []}
SCENARIO = {"horizon_days": 364, "replications": 3, "seed": 7, "crn": True, "warmup_mode": "auto",
            "disruption_schedule": [{"target": "S2", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}]}


def _worker():
    data = build_project_data(
        suppliers=TABLES["suppliers"], materials=TABLES["materials"], products=TABLES["products"],
        inbound=TABLES["inbound"], bom=TABLES["bom"], outbound=TABLES["outbound"], customers=[],
        policies=snapshot_to_policies(POLICY), scenario=SCENARIO, project_model="Make-To-Order")
    out = compute_run_from_project(data)
    row = build_run_update(out, SCENARIO["replications"])
    row.pop("ended_at")
    return row, out["replications"]


def _browser_driver():
    src = (ROOT / "src" / "lib" / "sim" / "engine.worker.ts").read_text()
    driver = re.search(r"const PY_DRIVER = `(.*?)`;", src, re.S).group(1)
    ns: dict = {}
    exec(driver, ns)  # the exact Python the browser runs
    return json.loads(ns["_run"](json.dumps({
        "dataset": TABLES, "snapshot": POLICY, "scenario": SCENARIO,
        "project_model": "Make-To-Order", "run_id": "r", "project_id": "p"})))


@pytest.fixture(scope="module")
def three():
    worker_row, worker_reps = _worker()
    local = run_from_snapshots({"schema_version": 2, "inputs": TABLES}, POLICY, SCENARIO, "Make-To-Order")
    return worker_row, worker_reps, local, _browser_driver()


def test_local_equals_worker(three):
    worker_row, worker_reps, local, _ = three
    assert local["run_update"] == worker_row
    assert [r["kpis"] for r in local["replications"]] == [r["kpis"] for r in worker_reps]


def test_browser_equals_worker(three):
    worker_row, worker_reps, _, browser = three
    assert browser["run_update"] == worker_row
    assert "_range" in browser["run_update"]["aggregate_kpis"]  # the field the old copy dropped
    assert [r["kpis"] for r in browser["replications"]] == [r["kpis"] for r in worker_reps]


def test_the_disruption_reached_the_engine(three):
    _, _, local, _ = three
    assert all("recovery_measurable" in r["kpis"] for r in local["replications"])


def test_series_is_the_api_long_form(three):
    _, _, local, _ = three
    s = local["series"]
    assert list(s)[:4] == ["rep_index", "model_rep", "event_rep", "week"]
    assert len(s["week"]) == SCENARIO["replications"] * 52 and "fill_rate" in s


def test_v1_and_v2_snapshots_read_the_same():
    assert dataset_inputs({"schema_version": 2, "inputs": TABLES}) == dataset_inputs(TABLES)


def test_multi_level_bom_wins_like_the_worker():
    t = dataset_inputs({"inputs": {**TABLES, "bom_multi_level": [{"material_id": "M1"}]}})
    assert t["bom_multi_level"] and t["bom"]  # both kept; run_from_snapshots picks multi-level
