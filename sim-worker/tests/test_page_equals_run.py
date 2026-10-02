"""Gate `page-equals-run`, engine half — PLAN.md §23 WP 13.4.

`scripts/example_project/page_equals_run.json` carries a fixture project and,
under `engine`, what scsim's mapper gives every master-backed entity field, with
its source. This test recomputes that from the fixture's own tables and policy
version — through the pipeline every run uses (`project_data_from_snapshots`) —
and fails when it no longer matches, so the grid half
(`src/lib/policies/__tests__/pageEqualsRun.test.ts`) can never be compared with
stale engine answers. `REGEN=1` rewrites the block after a deliberate change.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from scsim.io.project_map import POLICY_BUNDLE_KEYS, from_project_data

from sim_worker.local import project_data_from_snapshots

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "scripts" / "example_project" / "page_equals_run.json"


def _engine_view(fx: dict) -> dict:
    data = project_data_from_snapshots({"inputs": fx["tables"]}, fx["policy"], fx["scenario"], "Make-To-Order")
    resolved = from_project_data(data).resolved
    masters = {k["master"] for k in POLICY_BUNDLE_KEYS if k.get("master")}
    return {f: {e: resolved[f][e] for e in sorted(resolved[f])} for f in sorted(resolved) if f in masters}


def test_the_engine_half_of_the_fixture_is_current():
    fx = json.loads(FIXTURE.read_text())
    view = _engine_view(fx)
    if os.environ.get("REGEN") == "1":
        fx["engine"] = view
        FIXTURE.write_text(json.dumps(fx, indent=1, ensure_ascii=False) + "\n")
    assert fx["engine"] == view, (
        "the mapper no longer gives the fixture's entities what `engine` records — if the "
        "change is deliberate, rerun with REGEN=1 and let pageEqualsRun.test.ts judge the grid")


def test_every_master_backed_field_and_every_source_is_exercised():
    fx = json.loads(FIXTURE.read_text())
    view = _engine_view(fx)
    masters = {k["master"] for k in POLICY_BUNDLE_KEYS if k.get("master")}
    assert set(view) == masters
    sources = {v["source"] for f in view.values() for v in f.values()}
    assert {"override", "master", "lanes", "derived", "default"} <= sources, sources


def test_a_declared_empty_default_is_the_engines():
    """`empty_default` is what the grid shows for an empty cell; it must be the
    number the mapper used for every entity that fell all the way through."""
    fx = json.loads(FIXTURE.read_text())
    view = _engine_view(fx)
    for k in POLICY_BUNDLE_KEYS:
        if not k.get("master") or k.get("empty_default") is None:
            continue
        for ent, v in view[k["master"]].items():
            if v["source"] == "default":
                assert v["value"] == k["empty_default"], (k["key"], ent, v)
