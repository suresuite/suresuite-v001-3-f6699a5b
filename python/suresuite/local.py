"""Simulate on your own machine — Phase 12 · WP 12.5.

Pull the frozen inputs a platform run reads, then run the SAME engine function
the platform's browser engine and the Fly worker use
(`sim_worker.local.run_from_snapshots`), on your own CPU:

    import suresuite as ss
    api = ss.connect()                                  # key from SURESUITE_API_KEY
    ss.install_engine(api)                              # once per environment
    data = ss.dataset(api, project_id)                  # the latest frozen dataset version
    policy = ss.policy(api, project_id)                 # the latest policy version
    run = ss.simulate(data, policy, replications=50, seed=42,
                      disruptions=[ss.outage("S2", start_day=140, duration_days=42)])
    ss.kpi_table(run["run"])

`simulate` returns the shapes the API returns — a run row, replication rows and
a long-form weekly series — so every helper (kpi_table, paired_compare,
plot_series, …) works on a local run exactly as on a platform run.
"""
from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests

# The Simulation Lab's defaults: 52 weeks (the engine's minimum), 10 replications,
# seed 42, common random numbers on, warm-up detected by the engine.
DEFAULT_FRAME = {"horizon_days": 364, "replications": 10, "seed": 42, "crn": True, "warmup_mode": "auto"}


# ── the engine ──────────────────────────────────────────────────────────────
def engine_available() -> bool:
    """Is the simulation engine importable in this environment?"""
    return importlib.util.find_spec("scsim") is not None and importlib.util.find_spec("sim_worker") is not None


def install_engine(api, quiet: bool = True, version: Optional[str] = None) -> str:
    """Download the engine through the API (a key with read:data), check every
    wheel's sha256, and pip-install it. Returns the engine version.

    ``version`` installs an EARLIER engine — ``"0.4.0"`` (the newest build of that
    version) or the exact build a run recorded, ``run["code_version"]``
    (``"scsim-0.4.0+<digest>"``) — so a stored result can be re-run on the engine
    that produced it. Omit it for the engine the platform runs now."""
    info = api.engine(version=version) if version else api.engine()
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for w in info["wheels"]:
            body = requests.get(w["url"], timeout=120).content  # a signed URL: no API key sent
            digest = hashlib.sha256(body).hexdigest()
            if digest != w["sha256"]:
                raise RuntimeError(f"{w['file']}: sha256 {digest[:12]}… is not the published {w['sha256'][:12]}… — "
                                   "not installing it")
            path = Path(tmp) / w["file"]
            path.write_bytes(body)
            paths.append(str(path))
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", *(["-q"] if quiet else []), *paths]
        subprocess.check_call(cmd)
    importlib.invalidate_caches()
    build = info.get("engine_build") or "build not named"
    print(f"engine {info['engine_version']} ({build}) installed ({len(paths)} wheels, sha256 checked)")
    return info["engine_version"]


def _require_engine():
    if not engine_available():
        raise ImportError("the simulation engine is not installed here — run suresuite.install_engine(api) "
                          "(it needs an API key with read:data)")


# ── the frozen inputs ───────────────────────────────────────────────────────
@dataclass
class Dataset:
    """A frozen dataset version: its identity and its input tables."""
    id: str
    graph_hash: Optional[str]
    snapshot: dict
    label: Optional[str] = None
    version_no: Optional[int] = None
    meta: dict = field(default_factory=dict)

    @property
    def tables(self) -> dict[str, pd.DataFrame]:
        """The simulation's input tables, one DataFrame each."""
        inputs = self.snapshot.get("inputs") if isinstance(self.snapshot.get("inputs"), dict) else self.snapshot
        return {name: pd.DataFrame(rows) for name, rows in inputs.items() if isinstance(rows, list)}

    def __repr__(self) -> str:
        sizes = ", ".join(f"{k} {len(v)}" for k, v in self.tables.items() if len(v))
        return f"Dataset(v{self.version_no} {self.label!r}, graph_hash {str(self.graph_hash)[:12]}…: {sizes})"


@dataclass
class Policy:
    """A frozen policy version: its identity and its snapshot."""
    id: str
    policy_hash: Optional[str]
    snapshot: dict
    label: Optional[str] = None


def dataset(api, project_id: str, version: str = "latest") -> Dataset:
    """Pull a frozen dataset version (id or "latest") with its rows."""
    d = api.dataset_version(project_id, version)
    return Dataset(id=d["id"], graph_hash=d.get("graph_hash"), snapshot=d["snapshot"], label=d.get("label"),
                   version_no=d.get("version_no"), meta={k: v for k, v in d.items() if k != "snapshot"})


def policy(api, project_id: str, version: str = "latest") -> Policy:
    """Pull a frozen policy version (id or "latest")."""
    p = api.policy_version(project_id, version)
    return Policy(id=p["id"], policy_hash=p.get("policy_hash"), snapshot=p["snapshot"], label=p.get("label"))


def with_tables(data: Dataset, **tables: pd.DataFrame | list) -> Dataset:
    """A copy of `data` with some input tables replaced — a what-if on your own
    machine (more capacity, a second supplier, …). The platform's data is untouched."""
    snap = dict(data.snapshot)
    inputs = dict(snap.get("inputs") or {})
    for name, rows in tables.items():
        inputs[name] = rows.to_dict("records") if isinstance(rows, pd.DataFrame) else list(rows)
    snap["inputs"] = inputs
    return Dataset(id=f"{data.id} (edited locally)", graph_hash=None, snapshot=snap, label=f"{data.label} + local edits",
                   version_no=data.version_no, meta=dict(data.meta))


# ── the run ─────────────────────────────────────────────────────────────────
def simulate(data: Dataset | dict, policy_version: Policy | dict, scenario: Optional[dict] = None,
             disruptions: Optional[list] = None, project_model: Optional[str] = None,
             progress: bool = False, **frame: Any) -> dict:
    """Run the platform's engine on this machine. `scenario` is a scenario row (from
    `api.scenarios(...)`) or None; keyword arguments override its frame
    (horizon_days, replications, seed, crn, warmup_mode, …). Returns
    {"run", "replications", "series", "inputs"} in the API's shapes."""
    _require_engine()
    from sim_worker.local import run_from_snapshots

    snap = data.snapshot if isinstance(data, Dataset) else data
    pol = policy_version.snapshot if isinstance(policy_version, Policy) else policy_version
    sc = {**DEFAULT_FRAME, **{k: v for k, v in (scenario or {}).items()
                             if k in ("horizon_days", "warmup_days", "warmup_mode", "replications", "seed", "crn",
                                      "disruption_schedule", "stopping_rule", "demand_model", "recovery_overrides")},
          **frame}
    if disruptions is not None:
        sc["disruption_schedule"] = disruptions

    def _tick(_row, done, total):
        print(f"  replication {done}/{total}   ", end="\r")

    out = run_from_snapshots(snap, pol, sc, project_model=project_model, on_replication=_tick if progress else None)
    run = {**out["run_update"], "status": "done", "computed_by": "client", "engine_version": out["engine_version"],
           "graph_hash": getattr(data, "graph_hash", None), "policy_hash": getattr(policy_version, "policy_hash", None),
           "dataset_version_id": getattr(data, "id", None), "policy_version_id": getattr(policy_version, "id", None),
           "rep_count_target": sc["replications"]}
    if progress:
        print()
    return {"run": run, "replications": out["replications"], "series": pd.DataFrame(out["series"]),
            "inputs": {"scenario": sc}}
