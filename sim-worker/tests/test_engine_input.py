"""The policy version's Export is the run's input — PLAN.md §4 D289.

`engine_input_from_snapshots` is what the Export is built from. These tests hold
it to the claim the file makes on its Read me sheet: "exactly what the engine
receives when it runs this policy version on this dataset version".

* the scenario it returns is the one `run_scenario` is handed by a real run of the
  same frozen inputs (captured, not re-derived), in the worker's pipeline AND in
  the browser's Pyodide driver;
* every value it attaches a source to is the value the mapper resolved;
* every policy the run applies is described, with every parameter the mapping set;
* every field of every row has a unit-and-meaning entry.

`scripts/example_project/engine_input.json` is this function's output for the
`page-equals-run` fixture project; `engineInputWorkbook.test.ts` builds the
workbook from it. `REGEN=1` rewrites it after a deliberate change.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

import scsim.core.engine as engine_mod
from scsim.io.project_map import from_project_data

from sim_worker.local import engine_input_from_snapshots, project_data_from_snapshots, run_from_snapshots

ROOT = Path(__file__).resolve().parents[2]
FX = json.loads((ROOT / "scripts" / "example_project" / "page_equals_run.json").read_text())
OUT = ROOT / "scripts" / "example_project" / "engine_input.json"
DATASET = {"schema_version": 2, "inputs": FX["tables"]}
SCENARIO = {**FX["scenario"], "replications": 1}
MODEL = "Make-To-Order"


class _Captured(Exception):
    pass


def _scenario_a_run_simulates(monkeypatch) -> dict:
    """Run the fixture through `run_from_snapshots` and capture the Scenario it
    hands the engine — the moment before simulation."""
    seen: dict = {}

    def fake(scenario, **_kw):
        seen["scenario"] = scenario.model_dump(mode="json")
        raise _Captured

    monkeypatch.setattr(engine_mod, "run_scenario", fake)
    with pytest.raises(_Captured):
        run_from_snapshots(DATASET, FX["policy"], SCENARIO, MODEL)
    return seen["scenario"]


def _export() -> dict:
    return engine_input_from_snapshots(DATASET, FX["policy"], SCENARIO, MODEL)


def test_the_export_is_the_scenario_a_run_hands_the_engine(monkeypatch):
    assert _export()["scenario"] == _scenario_a_run_simulates(monkeypatch)


def test_the_browser_driver_returns_the_same_input():
    src = (ROOT / "src" / "lib" / "sim" / "engine.worker.ts").read_text()
    driver = re.search(r"const PY_DRIVER = `(.*?)`;", src, re.S).group(1)
    ns: dict = {}
    exec(driver, ns)  # the exact Python the browser runs
    out = json.loads(ns["_inputs"](json.dumps({
        "dataset": DATASET, "snapshot": FX["policy"], "scenario": SCENARIO, "project_model": MODEL})))
    assert out == json.loads(json.dumps(_export()))


def test_every_source_is_the_value_the_mapper_resolved():
    out = _export()
    resolved = from_project_data(project_data_from_snapshots(DATASET, FX["policy"], SCENARIO, MODEL)).resolved
    flat = {(s["master"], s["entity"]): (s["source"], s["value"]) for s in out["sources"]}
    expected = {(m, e): (r["source"], r["value"]) for m, by in resolved.items() for e, r in by.items()}
    assert flat == expected
    placed = 0
    for lst, rows in out["row_sources"].items():
        for i, fields in rows.items():
            for field, rec in fields.items():
                assert (rec["source"], rec["value"]) == expected[(rec["master"], _key(lst, out, int(i)))]
                placed += 1
    # Every entity-field target lands on its row: materials, links, suppliers,
    # products and customer rows all carry sources in the fixture.
    assert {"materials", "supplier_links", "suppliers", "products", "customer_links"} <= set(out["row_sources"])
    assert placed >= 40


def _key(lst: str, out: dict, i: int) -> str:
    r = out["scenario"]["network"][lst][i]
    if lst == "supplier_links":
        return r["material_id"]
    if lst == "customer_links":
        return f"{r['customer_id']}::{r['product_id']}"
    return r["id"]


def test_a_source_that_differs_from_the_simulated_value_is_explained():
    """An MTO product's FG levels are resolved and NOT simulated; the file says
    'not applied' beside them, and the mapper's note is what it points at."""
    out = _export()
    notes = {(w["entity"], w["field"]) for w in out["warnings"]}
    for lst, rows in out["row_sources"].items():
        for i, fields in rows.items():
            row = out["scenario"]["network"][lst][int(i)]
            for field, rec in fields.items():
                same = row.get(field) == rec["value"] or (
                    isinstance(row.get(field), (int, float)) and isinstance(rec["value"], (int, float))
                    and abs(row[field] - rec["value"]) < 1e-9)
                if not same:
                    entity = f"{lst[:-1] if lst.endswith('s') else lst}:{row.get('id')}"
                    assert any(e == entity for e, _f in notes), (lst, row.get("id"), field, rec)


def test_every_applied_policy_and_every_parameter_the_mapping_set_is_described():
    out = _export()
    described = {p["id"]: p for p in out["policies"]}
    for pid, raw in out["scenario"]["policies"].items():
        assert described[pid]["in_mapping"] is True
        set_paths = {tuple(r["path"]) for r in described[pid]["params"] if r["set_by_mapping"]}

        def leaves(v, path=()):
            if isinstance(v, dict) and v:
                for k, sub in v.items():
                    yield from leaves(sub, path + (k,))
            else:
                yield path

        for leaf in leaves(raw):
            assert any(leaf[: len(p)] == p for p in set_paths), (pid, leaf)
    # The built-in buffers always run, so they are always described.
    assert {"inventory_control", "unmet_demand_handling"} <= set(described)


def test_every_field_of_every_row_has_a_unit_and_meaning_entry():
    out = _export()
    for lst, rows in out["scenario"]["network"].items():
        if not isinstance(rows, list):
            assert lst in out["fields"]["network"], lst
            continue
        for row in rows:
            missing = set(row) - set(out["fields"][lst])
            assert not missing, (lst, missing)
    assert set(out["scenario"]["settings"]) <= set(out["fields"]["settings"])


def test_the_fixture_the_workbook_test_reads_is_current():
    out = json.loads(json.dumps(_export(), ensure_ascii=False))
    if os.environ.get("REGEN") == "1":
        OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    assert json.loads(OUT.read_text()) == out, (
        "engine_input.json is stale — rerun with REGEN=1 and let engineInputWorkbook.test.ts judge the workbook")
