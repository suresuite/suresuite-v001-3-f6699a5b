"""The suresuite package — Phase 12 · WP 12.5.

The exit test: pull a dataset version and a policy version through the client,
simulate on this machine, and get the numbers the platform recorded for the same
inputs. The demo transport serves the Example project's frozen inputs and the
engine's recorded output (notebooks/demo/example_project.json, recorded through
`sim_worker.local`), so equality here means the pull → simulate path rebuilds
the inputs exactly.
"""
import json
import os
from pathlib import Path

import pytest

import suresuite as ss

# In CI the tests run from a copy outside the repo (against the installed wheels),
# so the repo is named by SURESUITE_REPO; in the repo they find it themselves.
ROOT = Path(os.environ.get("SURESUITE_REPO") or Path(__file__).resolve().parents[2])
DEMO = json.loads((ROOT / "notebooks" / "demo" / "example_project.json").read_text())
FRAME = DEMO["_provenance"]["frame"]


@pytest.fixture()
def api():
    return ss.connect(demo_data=DEMO)


def _recording(label):
    return next(r for r in DEMO["recordings"] if r["label"] == label)


def test_connect_needs_a_key_or_the_demo(monkeypatch):
    monkeypatch.delenv("SURESUITE_API_KEY", raising=False)
    with pytest.raises(ValueError):
        ss.connect()


def test_pulls_the_frozen_inputs(api):
    pid = ss.pick_project(api)["id"]
    data = ss.dataset(api, pid)
    assert data.graph_hash == DEMO["graph_hash"]
    assert len(data.tables["suppliers"]) == 3 and "inbound" in data.tables
    with pytest.raises(ss.SuReSuiteError):
        api.dataset_version(pid, "00000000-0000-0000-0000-000000000000")


@pytest.mark.skipif(not ss.engine_available(), reason="the engine is not installed in this environment")
@pytest.mark.parametrize("label,policies,schedule", [
    ("baseline", {}, []),
    ("s2_outage_safety_stock_28d", {"inventory": {"safety_stock_method": "fixed_days", "safety_stock_days": 28}},
     [{"target": "S2", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}]),
])
def test_local_run_reproduces_the_platform_run(api, label, policies, schedule):
    pid = ss.pick_project(api)["id"]
    for family, fields in policies.items():
        api.set_policy(pid, family, **fields)
    pol = ss.policy(api, pid, api.snapshot_policies(pid, label)["id"])
    run = ss.simulate(ss.dataset(api, pid), pol, disruptions=schedule, **FRAME)
    recorded = _recording(label)["run"]
    assert run["run"]["aggregate_kpis"] == recorded["aggregate_kpis"]
    assert run["run"]["ci_half_widths"] == recorded["ci_half_widths"]
    assert run["run"]["computed_by"] == "client"
    assert ss.kpi_table(run["run"]).loc["fill_rate", "value"] == recorded["aggregate_kpis"]["fill_rate"]


@pytest.mark.skipif(not ss.engine_available(), reason="the engine is not installed in this environment")
def test_a_local_what_if_leaves_the_pulled_data_alone(api):
    pid = ss.pick_project(api)["id"]
    data = ss.dataset(api, pid)
    sup = data.tables["suppliers"].copy()
    sup.loc[sup.supplier_id == "S2", "capacity_per_week"] = 1
    edited = ss.with_tables(data, suppliers=sup)
    assert data.tables["suppliers"].loc[1, "capacity_per_week"] == 2000
    assert edited.graph_hash is None  # an edited copy is not a platform dataset version
    run = ss.simulate(edited, ss.policy(api, pid, api.snapshot_policies(pid, "x")["id"]), replications=2,
                      disruptions=[ss.outage("S2", magnitude_pct=60)])
    assert run["run"]["aggregate_kpis"]["fill_rate"] < 1.0  # 1 unit/week cannot feed the plant


def test_install_engine_refuses_a_wheel_whose_hash_differs(monkeypatch):
    class FakeApi:
        def engine(self):
            return {"engine_version": "x", "wheels": [{"file": "scsim-0.2.0-py3-none-any.whl", "sha256": "0" * 64,
                                                       "bytes": 3, "url": "https://example.invalid/w"}]}

    class Resp:
        content = b"not the wheel"

    monkeypatch.setattr(ss.local.requests, "get", lambda *a, **k: Resp())
    with pytest.raises(RuntimeError, match="not installing it"):
        ss.install_engine(FakeApi())


def test_the_demo_does_not_hand_out_the_engine(api):
    with pytest.raises(ss.SuReSuiteError) as e:
        api.engine()
    assert e.value.code == "demo_no_engine"
