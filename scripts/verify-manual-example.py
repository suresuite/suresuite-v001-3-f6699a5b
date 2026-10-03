"""Run the manual's shipped CSVs through the worker's frozen-input entry point.

No database or network. From the repo: python scripts/verify-manual-example.py
The CSV validation gate is separately exercised by manualExample.test.ts.
"""
import copy
import csv
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scsim"), str(ROOT / "sim-worker")]
from sim_worker.local import run_from_snapshots

DATA = ROOT / "public/examples/control-unit"


def rows(name):
    result = []
    for row in csv.DictReader((DATA / f"{name}.csv").open()):
        out = {}
        for key, value in row.items():
            try:
                out[key] = float(value)
            except ValueError:
                out[key] = value
        result.append(out)
    return result


def verify():
    p = json.loads((DATA / "protocol.json").read_text())
    dataset = {key: rows(file) for key, file in {
        "materials": "materials", "products": "products", "suppliers": "suppliers",
        "customers": "customers", "bom": "bom_single_level", "inbound": "inbound_logistics",
        "outbound": "outbound_logistics",
    }.items()}
    outputs = {}
    for name in ("baseline", "disruption", "safety-stock"):
        scenario = copy.deepcopy(p["scenario"])
        policy = copy.deepcopy(p["policy_snapshot"])
        if name != "baseline":
            scenario["disruption_schedule"] = [p["event"]]
        if name == "safety-stock":
            response = p["response"]
            policy["defaults"][response["family"]][response["field"]] = response["value"]
        out = run_from_snapshots(dataset, policy, scenario, p["project_model"])
        reps = out["replications"]
        assert len(reps) == scenario["replications"], (name, len(reps))
        assert all(r["status"] == "done" for r in reps)
        outputs[name] = {
            "engine_version": out["engine_version"], "replications": len(reps),
            "run_update": out["run_update"],
            "replication_kpis": [r["kpis"] for r in reps],
        }
    fr = lambda name: sum(r["fill_rate"] for r in outputs[name]["replication_kpis"]) / len(outputs[name]["replication_kpis"])
    assert fr("disruption") < fr("baseline"), "The tutorial disruption must affect service"
    assert fr("safety-stock") > fr("disruption"), "The tutorial response must affect service"
    return outputs


if __name__ == "__main__":
    result = verify()
    target = ROOT / "public/examples/control-unit/verification.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    for name, run in result.items():
        k = run["replication_kpis"][0]
        print(name, run["engine_version"], run["replications"], {key: k.get(key) for key in
              ["fill_rate", "lost_sales_value", "cost_of_resilience"]})
