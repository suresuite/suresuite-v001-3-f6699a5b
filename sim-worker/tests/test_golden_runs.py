"""Frozen run digests through the worker's whole path — PLAN.md §24 (Phase 14).

`scsim/tests/test_golden_digests.py` pins the ENGINE on hand-built networks.
This pins the path a real project takes: dataset snapshot → `datamap` →
`project_map` → engine, for the two committed datasets (the Example project and
Project TRON). Phase 14 changes the mapper as well as the engine, and its rule
is that a project which sets none of the new fields runs identically — so the
mapper needs a frozen reference too, not only the engine.

Per-replication KPIs and weekly series are rounded to 9 decimals and hashed;
mapping warnings are compared as text. A DELIBERATE change regenerates::

    SIMWORKER_WRITE_GOLDEN=1 python -m pytest tests/test_golden_runs.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pytest

from sim_worker.local import run_from_snapshots

ROOT = Path(__file__).resolve().parents[2]
DIGESTS = Path(__file__).parent / "data" / "golden_runs.json"


def _tables(path: str) -> dict:
    ds = json.loads((ROOT / path).read_text())
    return {k: ds[k] for k in ("suppliers", "materials", "products", "bom", "inbound", "outbound")}


EXAMPLE = _tables("scripts/example_project/dataset.json")
TRON = _tables("scripts/tron_ver2/dataset.json")

CASES = {
    "example_outage": (
        EXAMPLE,
        {"schema_version": 2, "defaults": {"inventory": {"safety_stock_method": "fixed_days",
                                                         "safety_stock_days": 14}},
         "overrides": []},
        {"horizon_days": 364, "replications": 3, "seed": 11, "crn": True, "warmup_mode": "auto",
         "disruption_schedule": [{"target": "S2", "start_day": 140, "duration_days": 42,
                                  "magnitude_pct": 100}]},
    ),
    "example_backorder": (
        EXAMPLE,
        {"schema_version": 2, "defaults": {"fulfillment": {"backorder_allowed": True,
                                                           "max_backorder_days": 14,
                                                           "allocation": "priority"}},
         "overrides": []},
        {"horizon_days": 364, "replications": 2, "seed": 5, "crn": True, "warmup_mode": "auto",
         "disruption_schedule": [{"target": "S1", "start_day": 120, "duration_days": 56,
                                  "magnitude_pct": 100}]},
    ),
    "tron_supplier_965": (
        TRON,
        {"schema_version": 2, "defaults": {"inventory": {"type": "min_max",
                                                         "safety_stock_method": "fixed_days",
                                                         "safety_stock_days": 0}},
         "overrides": []},
        {"horizon_days": 546, "replications": 2, "seed": 42, "crn": True, "warmup_mode": "auto",
         "disruption_schedule": [{"target": "node:965", "start_week": 12, "duration_weeks": 8,
                                  "magnitude_pct": 100}]},
    ),
}


def _r(v) -> bytes:
    a = np.asarray(v, dtype=float)
    return (np.round(a, 9) + 0.0).tobytes()


def digest(case: str) -> dict:
    tables, policy, scenario = CASES[case]
    out = run_from_snapshots({"schema_version": 3, "inputs": tables}, policy, scenario)
    h = hashlib.sha256()
    for rep in out["replications"]:
        for k in sorted(rep["kpis"]):
            v = rep["kpis"][k]
            if isinstance(v, (int, float)) and v is not None:
                h.update(k.encode()); h.update(_r([v]))
        for k in sorted(rep.get("time_series") or {}):
            h.update(k.encode()); h.update(_r(rep["time_series"][k]))
    warnings = sorted(json.dumps(w, sort_keys=True, ensure_ascii=False)
                      for w in out["kpis"].get("mapping_warnings") or [])
    return {"sha256": h.hexdigest(), "mapping_warnings": warnings}


def test_digest_file_lists_every_case():
    if os.environ.get("SIMWORKER_WRITE_GOLDEN"):
        DIGESTS.parent.mkdir(parents=True, exist_ok=True)
        DIGESTS.write_text(json.dumps({c: digest(c) for c in sorted(CASES)}, indent=2) + "\n")
    assert sorted(json.loads(DIGESTS.read_text())) == sorted(CASES)


@pytest.mark.parametrize("case", sorted(CASES))
def test_golden_run_unchanged(case):
    frozen = json.loads(DIGESTS.read_text())[case]
    got = digest(case)
    assert got["mapping_warnings"] == frozen["mapping_warnings"]
    assert got["sha256"] == frozen["sha256"], (
        f"{case}: a committed dataset's run moved. If deliberate, bump ENGINE_VERSION, "
        f"record it in ADR 0002 and PLAN.md §16, and regenerate with SIMWORKER_WRITE_GOLDEN=1."
    )
