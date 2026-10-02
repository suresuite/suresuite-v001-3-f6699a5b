"""The worker reads the frozen versions — PLAN.md §23 WP 13.2, §4 D280.

A run is bound to a dataset version and a policy version at dispatch. Until WP
13.2 the Fly worker ignored the first: it built the engine input from the
project's LIVE tables when it started, so a master edited after dispatch — on
the Item Master editor, by a CSV, by ERP sync — flowed into a run stamped with a
version that did not contain it. These tests drive the worker's own
`experiment.run` handler against a mocked PostgREST whose live `materials` table
says something the frozen version does not:

  * the frozen run reads no live table and its result is the one the package and
    the browser compute from the same two versions and seed;
  * a run with no dataset version is not computed, and says why;
  * an envelope from before the binding keeps the live path, and says so.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path

import httpx
import networkx as nx
import pytest

from sim_worker import series_store
from sim_worker import worker as worker_mod
from sim_worker.local import run_from_snapshots
from sim_worker.worker import SimWorker, dataset_binding

ROOT = Path(__file__).resolve().parents[2]
DS = json.loads((ROOT / "scripts" / "example_project" / "dataset.json").read_text())
TABLES = {k: DS[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}
DATASET = {"schema_version": 3, "inputs": TABLES}
POLICY = {"schema_version": 2, "defaults": {
    "inventory": {"safety_stock_method": "fixed_days", "safety_stock_days": 14}}, "overrides": []}
SCENARIO = {"horizon_days": 364, "replications": 3, "seed": 11, "crn": True, "warmup_mode": "auto",
            "disruption_schedule": [{"target": "S2", "start_day": 140, "duration_days": 42,
                                     "magnitude_pct": 100}]}
PROJECT = "11111111-1111-4111-8111-111111111111"
RUN = "22222222-2222-4222-8222-222222222222"
DV = "33333333-3333-4333-8333-333333333333"

# The master as it stands in the LIVE project after dispatch: every material
# now costs 50x, which would move every cost KPI.
LIVE_MATERIALS = [{**m, "cost": float(m["cost"]) * 50} for m in DS["materials"]]
LIVE_TABLES = {"materials": LIVE_MATERIALS, "suppliers": DS["suppliers"], "products": DS["products"],
               "inbound_logistics": DS["inbound"], "outbound_logistics": DS["outbound"],
               "bom_single_level": DS["bom"], "bom_multi_level": [], "customers": []}


class _Redis:
    async def xack(self, *a, **k):
        return 1


class _Graph:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.graph = nx.DiGraph()
        self.last_kpis: dict = {}


class _Cache:
    def __init__(self) -> None:
        self.cg = _Graph()

    async def get(self, project_id):
        return self.cg

    async def get_effective_policies(self, project_id):
        return {"default": {}}


_CAPTURED: list[tuple[list, list]] = []


def _run(envelope: dict, dataset_row: dict | None = None):
    """Drive SimWorker._handle_inner for one envelope; return (requests, patches)."""
    seen: list[httpx.Request] = []
    patches: list[dict] = []
    _CAPTURED.append((seen, patches))

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        path = req.url.path.replace("/rest/v1/", "")
        if req.method == "PATCH" and path == "simulation_runs":
            patches.append(json.loads(req.content))
            return httpx.Response(200, json=[{"id": RUN}])
        if req.method == "GET" and path == "dataset_versions":
            row = dataset_row if dataset_row is not None else {"project_id": PROJECT, "snapshot": DATASET}
            return httpx.Response(200, json=[row] if row else [])
        if req.method == "GET" and path == "projects":
            return httpx.Response(200, json=[{"supply_chain_model": "Make-To-Order"}])
        if req.method == "GET" and path in LIVE_TABLES:
            return httpx.Response(200, json=LIVE_TABLES[path])
        return httpx.Response(200, json=[])

    w = SimWorker(redis_url="redis://localhost:6379",
                  supabase_url="https://example.supabase.co", service_role_key="k")
    w._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    w._redis = _Redis()
    w._cache = _Cache()
    base = {"kind": "experiment.run", "project_id": PROJECT, "scenario_id": "s1", "payload": {},
            "run_id": RUN, "scenario": SCENARIO, "recovery": {},
            "policy_version_id": "pv1", "policy_snapshot": POLICY}
    asyncio.run(w._handle_inner("sim.cmd.p", "1-0", {"data": json.dumps({**base, **envelope})}))
    return seen, patches


@pytest.fixture(autouse=True)
def _scsim_on(monkeypatch):
    monkeypatch.setenv("SCSIM_ENGINE", "1")
    monkeypatch.setattr(series_store, "available", lambda: False)


def _live_reads(seen: list[httpx.Request]) -> list[str]:
    return sorted({r.url.path.replace("/rest/v1/", "") for r in seen
                   if r.method == "GET" and r.url.path.replace("/rest/v1/", "") in LIVE_TABLES}
                  | {r.url.path for r in seen if "ensure_item_masters" in r.url.path})


def _done(patches: list[dict]) -> dict:
    return next(p for p in patches if p.get("status") == "done")


def _browser(tables: dict) -> dict:
    src = (ROOT / "src" / "lib" / "sim" / "engine.worker.ts").read_text()
    driver = re.search(r"const PY_DRIVER = `(.*?)`;", src, re.S).group(1)
    ns: dict = {}
    exec(driver, ns)  # the exact Python the browser runs
    return json.loads(ns["_run"](json.dumps({
        "dataset": tables, "snapshot": POLICY, "scenario": SCENARIO,
        "project_model": "Make-To-Order", "run_id": RUN, "project_id": PROJECT})))


def test_the_binding_rule():
    assert dataset_binding({"dataset_version_id": DV}) == ("frozen", DV)
    assert dataset_binding({"dataset_version_id": None})[0] == "refuse"
    assert dataset_binding({})[0] == "legacy"


def test_a_master_edited_after_dispatch_is_not_in_the_run():
    seen, patches = _run({"dataset_version_id": DV})
    assert _live_reads(seen) == [], "the frozen run read the live project"
    done = _done(patches)
    # The worker's result is the one computed from the FROZEN tables …
    frozen = run_from_snapshots(DATASET, POLICY, SCENARIO, "Make-To-Order")
    assert done["aggregate_kpis"] == frozen["run_update"]["aggregate_kpis"]
    # … and the edit would have moved it: computed from the live master, it differs.
    live = run_from_snapshots({"inputs": {**TABLES, "materials": LIVE_MATERIALS}}, POLICY, SCENARIO,
                              "Make-To-Order")
    assert live["run_update"]["aggregate_kpis"] != frozen["run_update"]["aggregate_kpis"]
    # The run log names what it was computed from.
    line = next(w for w in done["mapping_warnings"] if w["entity"] == "run" and w["field"] == "inputs")
    assert DV in line["reason"] and "frozen at dispatch" in line["reason"]


def test_worker_browser_and_package_agree_on_the_same_versions_and_seed():
    _, patches = _run({"dataset_version_id": DV})
    worker_kpis = _done(patches)["aggregate_kpis"]
    package_kpis = run_from_snapshots(DATASET, POLICY, SCENARIO, "Make-To-Order")["run_update"]["aggregate_kpis"]
    browser_kpis = _browser(TABLES)["run_update"]["aggregate_kpis"]
    assert worker_kpis == package_kpis == browser_kpis


def test_a_run_with_no_dataset_version_is_not_computed_and_says_why():
    seen, patches = _run({"dataset_version_id": None})
    assert _live_reads(seen) == []
    assert [p["status"] for p in patches] == ["failed"]
    assert "no dataset version" in patches[0]["error_message"]


def test_an_unreadable_or_foreign_dataset_version_fails_the_run_rather_than_reading_live():
    # The handler marks the run failed and re-raises for the consume loop to log.
    with pytest.raises(worker_mod.DatasetVersionError):
        _run({"dataset_version_id": DV}, dataset_row={"project_id": "other", "snapshot": DATASET})
    seen, patches = _CAPTURED[-1]
    assert _live_reads(seen) == []
    failed = [p for p in patches if p.get("status") == "failed"]
    assert failed and "another project" in failed[0]["error_message"]
    assert not any(p.get("status") == "done" for p in patches)


def test_a_legacy_envelope_keeps_the_live_path_and_says_so():
    seen, patches = _run({})  # a dispatcher from before WP 13.2: no key
    assert "materials" in _live_reads(seen)
    done = _done(patches)
    line = next(w for w in done["mapping_warnings"] if w["entity"] == "run" and w["field"] == "inputs")
    assert line["level"] == "warn" and line["reason"].startswith("legacy run")


def test_a_scenario_recovery_playbook_is_applied_the_same_everywhere():
    """§4 D282 — only the worker applied a scenario's recovery overrides."""
    pol = copy.deepcopy(POLICY)
    sc = {**SCENARIO, "recovery_overrides": {"response": ["dual_source_activate"]}}
    via_scenario = run_from_snapshots(DATASET, pol, sc, "Make-To-Order")
    via_recovery = run_from_snapshots(DATASET, pol, SCENARIO, "Make-To-Order",
                                      recovery={"response": ["dual_source_activate"]})
    plain = run_from_snapshots(DATASET, pol, SCENARIO, "Make-To-Order")
    assert via_scenario["run_update"]["aggregate_kpis"] == via_recovery["run_update"]["aggregate_kpis"]
    assert via_scenario["run_update"]["mapping_warnings"] != plain["run_update"]["mapping_warnings"] or \
        via_scenario["run_update"]["aggregate_kpis"] != plain["run_update"]["aggregate_kpis"]
