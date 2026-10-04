# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""The release quality report: this build against the previous version, measured.

PLAN.md §25 · WP 15.5 · gate `engine-ledger` rule 8 · T3, T4.

A change record says what a version changed; this measures it. For the current
ENGINE_VERSION it runs the REFERENCE SET — the worker's frozen reference runs
(`sim-worker/tests/test_golden_runs.py` CASES: the Example project under an
outage and under backorder, Project TRON under a supplier outage), each at
REPLICATIONS replications — twice, on the same seeds (common random numbers):

    previous  the previous version's ARCHIVED build: its wheels, taken from git at
              the commit that set it (WP 15.3), installed into a clean virtualenv
    current   this checkout's engine

and writes, per case and KPI, both means, the paired difference and its 95 %
t-interval, and a verdict: `identical` (every replication equal, bit for bit),
`moved` (the interval excludes 0) or `within noise`.

    scsim/docs/releases/<version>.md     for people (the /docs page links it)
    scsim/docs/releases/<version>.json   for the gate and the page

`engine_changelog.py check` then refuses a change record that understates its own
effect: an entry that calls itself `identical` while a KPI moved, or a
`changed-for` entry whose `kpis` omits a KPI the report shows moving.

Usage (from ``sim-worker/``, where the worker's tests and cases live)::

    python ../scsim/scripts/release_report.py            # (re)write the report
    python ../scsim/scripts/release_report.py --check    # CI: fail if it would change

Needs git history (the previous build's wheels are read from it) and network for
numpy/scipy/pydantic in the throwaway environment, which is cached by commit.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SCSIM = Path(__file__).resolve().parents[1]
ROOT = SCSIM.parent
WORKER = ROOT / "sim-worker"
OUT = SCSIM / "docs" / "releases"
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "scsim-release-report"

REPLICATIONS = 20
# The KPIs a report compares: the registry's per-replication KPIs, plus the money
# and stock a planner reads first. Fixed, so a report cannot quietly drop one.
KPIS = (
    "fill_rate", "lost_sales_value", "cost_of_resilience", "max_backlog", "lost_inbound_units",
    "ttr_weeks", "tts_weeks", "revenue", "avg_on_hand_value", "avg_fg_value",
)
# Two-sided 95 % Student-t quantiles by degrees of freedom — tabulated rather than
# imported, so the report needs no scipy in the parent process.
_T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
         10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110,
         18: 2.101, 19: 2.093, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980}

RUNNER = r"""
import json, math, sys
from sim_worker.local import run_from_snapshots
cases = json.load(sys.stdin)
out = {}
for name, c in cases.items():
    r = run_from_snapshots(c["dataset"], c["policy"], c["scenario"])
    rows = sorted(r["replications"], key=lambda x: x["rep_index"])
    out[name] = {
        "code_version": r["run_update"].get("code_version"),
        "reps": [{k: (v if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)) else None)
                  for k, v in row["kpis"].items()} for row in rows],
    }
print(json.dumps(out))
"""


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _changelog():
    return _load("engine_changelog", SCSIM / "scripts" / "engine_changelog.py")


def reference_cases() -> dict[str, dict]:
    g = _load("golden_runs", WORKER / "tests" / "test_golden_runs.py")
    return {name: {"dataset": ds, "policy": pol, "scenario": {**sc, "replications": REPLICATIONS}}
            for name, (ds, pol, sc) in sorted(g.CASES.items())}


def _git(*args: str, binary: bool = False):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)}: {r.stderr.decode().strip()}")
    return r.stdout if binary else r.stdout.decode()


def previous_build() -> tuple[dict[str, Any], str, list[Path]]:
    """The previous version's change-record entry, its commit, and its archived wheels."""
    ec = _changelog()
    entries = ec.load_entries(ec.CHANGELOG.read_text())
    version = ec.engine_version_of(ec.INIT.read_text())
    idx = next(i for i, e in enumerate(entries) if e["version"] == version)
    if idx + 1 >= len(entries):
        raise SystemExit("no previous version to compare with")
    prev = entries[idx + 1]
    sha = ec.version_commit(prev)
    if not sha:
        raise SystemExit(f"no commit found for {prev['version']} — a release report needs full history")
    names = [n for n in _git("ls-tree", "--name-only", sha, "public/engine/").split()
             if n.endswith(".whl")]
    root = CACHE / sha
    root.mkdir(parents=True, exist_ok=True)
    wheels = []
    for n in names:
        p = root / Path(n).name
        if not p.exists():
            p.write_bytes(_git("show", f"{sha}:{n}", binary=True))
        wheels.append(p)
    return prev, sha, wheels


def _venv(sha: str, wheels: list[Path]) -> Path:
    env = CACHE / sha / "venv"
    py = env / "bin" / "python"
    stamp = env / ".installed"
    if not stamp.exists():
        subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
        subprocess.run([str(py), "-m", "pip", "install", "-q", "numpy", "scipy", "pydantic"], check=True)
        subprocess.run([str(py), "-m", "pip", "install", "-q", *map(str, wheels)], check=True)
        stamp.write_text("ok")
    return py


def _run(python: str, cases: dict, cwd: Path) -> dict:
    r = subprocess.run([python, "-c", RUNNER], input=json.dumps(cases), cwd=cwd,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"reference run failed ({python}):\n{r.stderr[-2000:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def _t975(df: int) -> float:
    if df in _T975:
        return _T975[df]
    keys = sorted(_T975)
    return next((_T975[k] for k in keys if k >= df), 1.960)


def compare(prev: list[dict], cur: list[dict], kpi: str) -> dict[str, Any]:
    pairs = [(a.get(kpi), b.get(kpi)) for a, b in zip(prev, cur)]
    pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
    n = len(pairs)
    if n == 0:
        return {"n": 0, "verdict": "not measured"}
    d = [b - a for a, b in pairs]
    mean_a = sum(a for a, _ in pairs) / n
    mean_b = sum(b for _, b in pairs) / n
    md = sum(d) / n
    if all(x == 0 for x in d):
        return {"n": n, "previous": mean_a, "current": mean_b, "delta": 0.0, "ci95": [0.0, 0.0],
                "verdict": "identical"}
    sd = math.sqrt(sum((x - md) ** 2 for x in d) / (n - 1)) if n > 1 else float("inf")
    h = _t975(n - 1) * sd / math.sqrt(n) if n > 1 else float("inf")
    lo, hi = md - h, md + h
    verdict = "moved" if (lo > 0 or hi < 0) else "within noise"
    return {"n": n, "previous": mean_a, "current": mean_b, "delta": md, "ci95": [lo, hi], "verdict": verdict}


def _r(x: float, nd: int = 6) -> float:
    return float(f"{x:.{nd}g}") if isinstance(x, float) and math.isfinite(x) else x


def build_report() -> dict[str, Any]:
    ec = _changelog()
    version = ec.engine_version_of(ec.INIT.read_text())
    prev, sha, wheels = previous_build()
    cases = reference_cases()
    old = _run(str(_venv(sha, wheels)), cases, cwd=Path(tempfile.gettempdir()))
    new = _run(sys.executable, cases, cwd=WORKER)
    out_cases = {}
    for name in cases:
        rows = {}
        for k in KPIS:
            c = compare(old[name]["reps"], new[name]["reps"], k)
            rows[k] = {kk: ([_r(v) for v in vv] if isinstance(vv, list) else _r(vv)) for kk, vv in c.items()}
        out_cases[name] = {"previous_build": old[name]["code_version"], "kpis": rows}
    current_build = next(iter(new.values()))["code_version"]
    moved = sorted({k for c in out_cases.values() for k, r in c["kpis"].items() if r["verdict"] == "moved"})
    changed = sorted({k for c in out_cases.values() for k, r in c["kpis"].items()
                      if r["verdict"] in ("moved", "within noise")})
    return {
        "version": version,
        "current_build": current_build,
        "previous_version": prev["version"],
        "previous_commit": sha,
        "previous_build": next(iter(out_cases.values()))["previous_build"],
        "replications": REPLICATIONS,
        "kpis_compared": list(KPIS),
        "cases": out_cases,
        "moved": moved,
        "changed": changed,
    }


def _fmt(x) -> str:
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.4g}"
    return str(x)


def render_markdown(rep: dict[str, Any]) -> str:
    lines = [
        "<!-- GENERATED by scsim/scripts/release_report.py. Do not edit by hand: "
        "`release_report.py --check` fails on drift. -->",
        "",
        f"# Release report — engine {rep['version']}",
        "",
        f"This build (`{rep['current_build']}`) against the previous version, **{rep['previous_version']}** "
        f"(its archived build `{rep['previous_build']}`, commit `{rep['previous_commit'][:8]}`), on the "
        f"reference set: {len(rep['cases'])} frozen reference runs, {rep['replications']} replications each, "
        "the same seeds on both sides (common random numbers). Each row is the paired difference "
        "current − previous with its 95 % t-interval. *identical* = every replication equal bit for bit; "
        "*moved* = the interval excludes 0; *within noise* = it does not.",
        "",
        "**Summary:** " + (
            "no KPI changed on the reference set." if not rep["changed"] else
            f"changed — {', '.join(rep['changed'])}; moved beyond noise — {', '.join(rep['moved']) or 'none'}."),
        "",
        "The reference set is what this report can see. A change that only acts on fields these runs "
        "do not set (a typed replenishment level, MRP, row demand) shows as *identical* here; the change "
        "record says who it affects.",
        "",
    ]
    for name, c in rep["cases"].items():
        lines += [f"## {name}", "", "| KPI | previous | current | Δ (current − previous) | 95 % CI | verdict |",
                  "|---|---|---|---|---|---|"]
        for k, r in c["kpis"].items():
            if r.get("n", 0) == 0:
                lines.append(f"| `{k}` | — | — | — | — | not measured |")
                continue
            lo, hi = r["ci95"]
            lines.append(f"| `{k}` | {_fmt(r['previous'])} | {_fmt(r['current'])} | {_fmt(r['delta'])} | "
                         f"[{_fmt(lo)}, {_fmt(hi)}] | {r['verdict']} |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    rep = build_report()
    want = {OUT / f"{rep['version']}.json": json.dumps(rep, indent=1, sort_keys=False) + "\n",
            OUT / f"{rep['version']}.md": render_markdown(rep)}
    stale = []
    for path, text in want.items():
        have = path.read_text() if path.exists() else None
        if have != text:
            if a.check:
                stale.append(path.relative_to(ROOT).as_posix())
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
                print(f"wrote {path.relative_to(ROOT).as_posix()}")
    if stale:
        print("✗ the release report is stale for this build — run "
              "`python ../scsim/scripts/release_report.py` from sim-worker/: " + ", ".join(stale))
        return 1
    if a.check:
        print(f"✓ release report for {rep['version']} is current ({rep['current_build']} vs {rep['previous_build']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
