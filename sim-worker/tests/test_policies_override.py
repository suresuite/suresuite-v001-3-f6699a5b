"""PLAN.md §23 WP 13.1 — /policies writes overrides, never the item masters.

The exit test's engine half. The grid half (`masterOverrides.test.ts`) proves a
cost edited on /policies is saved as the override rows in
`scripts/example_project/policies_edit_cost.json` and writes no master; this
proves the engine, given the policy version those rows produce, uses the
override while the master row it was given still says what was uploaded.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from scsim.io.project_map import from_project_data

from sim_worker.datamap import build_project_data
from sim_worker.policy_snapshot import snapshot_to_policies

ROOT = Path(__file__).resolve().parents[2]
DS = json.loads((ROOT / "scripts" / "example_project" / "dataset.json").read_text())
FX = json.loads((ROOT / "scripts" / "example_project" / "policies_edit_cost.json").read_text())


def _version_after_save() -> dict:
    """The policy snapshot a version freezes after the save: every saved row,
    with the save's upserts replacing their (target, family) rows."""
    rows = {(r["target_key"], r["family"]): r for r in FX["saved_before"]}
    for r in FX["upserts_after_save"]:
        rows[(r["target_key"], r["family"])] = r
    return {"schema_version": 2, "defaults": {}, "overrides": list(rows.values())}


def _map(snapshot: dict, materials: list[dict]):
    return from_project_data(build_project_data(
        suppliers=DS["suppliers"], materials=materials, products=DS["products"],
        inbound=DS["inbound"], bom=DS["bom"], outbound=DS["outbound"], customers=[],
        policies=snapshot_to_policies(snapshot),
        scenario={"horizon_days": 364, "replications": 1, "seed": 1},
        project_model="Make-To-Order"))


def test_a_cost_edited_on_policies_is_the_cost_the_engine_uses():
    want = FX["engine_reads"]
    materials = copy.deepcopy(DS["materials"])
    res = _map(_version_after_save(), materials)
    m = next(m for m in res.scenario.network.materials if m.id == want["material"])
    assert m.cost == want["cost"]
    # The master row the run was given is the uploaded one, unchanged.
    assert materials == DS["materials"]
    assert next(r for r in materials if r["material_id"] == want["material"])["cost"] == want["master_cost"]
    # The run log names the source.
    src = next(w.reason for w in res.warnings if w.entity == "source" and w.field == "materials.cost")
    assert "override 1" in src and "master 1" in src
    # The primary kept on S3::M1 still decides where M1 is bought.
    primary = [l for l in res.scenario.network.supplier_links if l.material_id == "M1" and l.primary]
    assert [l.supplier_id for l in primary] == ["S3"]


def test_without_the_override_the_master_decides_again():
    res = _map({"schema_version": 2, "defaults": {}, "overrides": []}, DS["materials"])
    m = next(m for m in res.scenario.network.materials if m.id == FX["engine_reads"]["material"])
    assert m.cost == FX["engine_reads"]["master_cost"]
