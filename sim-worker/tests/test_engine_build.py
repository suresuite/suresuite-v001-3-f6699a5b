"""The build a run names — PLAN.md §25 · WP 15.1 · §4 D292 · gate `engine-ledger` rule 5.

A run records the BUILD that computed it, by content: `scsim-<version>+<digest>`
over scsim's source and the worker's compute path. These tests hold the three
properties that make that name worth recording:

* the same code names itself the same way everywhere — the runtime, the source
  tree (what CI's deploy check expects) and the committed browser wheels agree;
* a one-line change to either package is a different build, and the same
  source twice is the same build;
* the list of hashed worker modules is exactly what a run loads, so a module
  that starts deciding numbers cannot stay outside the name.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

from scsim import ENGINE_VERSION
from scsim.build import compose, digest_files, package_sources, source_digest, version_of

from sim_worker.build import COMPUTE_MODULES, code_version, engine_build, worker_digest
from sim_worker.local import run_from_snapshots
from sim_worker.run_shape import build_run_update

ROOT = Path(__file__).resolve().parents[2]
WORKER_PKG = Path(__file__).resolve().parents[1] / "sim_worker"

_spec = importlib.util.spec_from_file_location("engine_build_id", ROOT / "scripts" / "engine_build_id.py")
engine_build_id = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(engine_build_id)


def test_the_build_is_the_version_and_a_digest():
    cv = code_version()
    assert cv.startswith(f"scsim-{ENGINE_VERSION}+")
    assert len(cv.split("+", 1)[1]) == 12
    assert version_of(cv) == ENGINE_VERSION
    assert version_of(f"scsim-{ENGINE_VERSION}") == ENGINE_VERSION  # a pre-WP 15.1 label
    assert version_of("worker-legacy") is None


def test_the_runtime_and_the_source_tree_name_the_same_build():
    # The deploy check (seed-project.yml) expects the source's name; the worker
    # reports the runtime's. Rule 5: they are one name for one code.
    src = engine_build_id.from_source()
    assert src["code_version"] == code_version()
    assert src["scsim_digest"] == source_digest()
    assert src["sim_worker_digest"] == worker_digest()
    assert engine_build()["code_version"] == code_version()


def test_the_committed_browser_wheels_name_their_manifest_build():
    manifest = json.loads((ROOT / "public" / "engine" / "manifest.json").read_text())
    scsim_whl, worker_whl = (ROOT / "public" / "engine" / w for w in manifest["wheels"])
    assert engine_build_id.from_wheels(scsim_whl, worker_whl)["code_version"] == manifest["engine_build"]
    # One version number (§4 D293): the wheel is named after the engine inside it.
    assert scsim_whl.name.startswith(f"scsim-{manifest['engine_version']}-")


def test_one_changed_line_is_another_build_and_the_same_source_is_the_same(tmp_path):
    copy = tmp_path / "sim_worker"
    shutil.copytree(WORKER_PKG, copy, ignore=shutil.ignore_patterns("__pycache__"))
    same = digest_files(package_sources(copy, COMPUTE_MODULES))
    assert same == worker_digest()
    target = copy / "run_shape.py"
    target.write_text(target.read_text() + "\n# one line\n")
    changed = digest_files(package_sources(copy, COMPUTE_MODULES))
    assert changed != same
    v = ENGINE_VERSION
    assert compose(v, {"scsim": source_digest(), "sim_worker": changed}) != code_version()


def test_a_module_outside_the_compute_path_changes_no_build(tmp_path):
    # worker.py (the Redis consumer) decides no number of an scsim run; hashing it
    # would re-key every run on every infrastructure change.
    assert "worker" not in COMPUTE_MODULES
    copy = tmp_path / "sim_worker"
    shutil.copytree(WORKER_PKG, copy, ignore=shutil.ignore_patterns("__pycache__"))
    (copy / "worker.py").write_text((copy / "worker.py").read_text() + "\n# infra\n")
    assert digest_files(package_sources(copy, COMPUTE_MODULES)) == worker_digest()


def test_every_module_a_run_loads_is_inside_the_build():
    # In a fresh interpreter, so modules this test session imported do not count.
    probe = (
        "import json, sys\n"
        "sys.path.insert(0, 'tests')\n"
        "import test_golden_runs as g\n"
        "from sim_worker.local import run_from_snapshots\n"
        "ds, pol, sc = g.CASES[sorted(g.CASES)[0]]\n"
        "run_from_snapshots(ds, pol, sc)\n"
        "print(json.dumps(sorted(m.split('.', 1)[1] for m in sys.modules if m.startswith('sim_worker.'))))\n"
    )
    out = subprocess.run([sys.executable, "-c", probe], cwd=WORKER_PKG.parent, capture_output=True,
                         text=True, check=True)
    loaded = set(json.loads(out.stdout.strip().splitlines()[-1]))
    assert loaded - set(COMPUTE_MODULES) == set(), (
        f"a run loads {sorted(loaded - set(COMPUTE_MODULES))}, which the build does not hash — "
        "add it to sim_worker/build.py COMPUTE_MODULES")


def test_a_run_records_the_build_that_computed_it():
    spec = importlib.util.spec_from_file_location("_golden_runs", Path(__file__).parent / "test_golden_runs.py")
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)

    ds, pol, sc = g.CASES[sorted(g.CASES)[0]]
    out = run_from_snapshots(ds, pol, sc)
    assert out["run_update"]["code_version"] == code_version()
    assert out["kpis"]["engine_build"] == code_version()


def test_a_payload_from_an_older_wheel_still_names_its_version():
    # A browser that cached a pre-WP 15.1 wheel sends no engine_build: the row
    # says the version, and engineBuild.ts reads that as "build not recorded".
    assert build_run_update({"source": "scsim", "engine_version": "0.6.0"}, 1)["code_version"] == "scsim-0.6.0"
