#!/usr/bin/env python3
"""Name an engine build without installing it — PLAN.md §25 · WP 15.1 · §4 D292.

    python scripts/engine_build_id.py --source                         # this checkout
    python scripts/engine_build_id.py <scsim.whl> <sim_worker.whl>     # two wheels
    python scripts/engine_build_id.py --json …                         # with its parts

Prints the same `scsim-<ENGINE_VERSION>+<digest>` a run computed by that code
records as `code_version` (`sim_worker.build.code_version`). The algorithm and
the module list are LOADED from the source tree by path rather than restated
here, so this script cannot disagree with the runtime about what a build is.

Used by `build_engine_wheels.sh` (the manifest's `engine_build`, and `--check`
comparing it with the committed one) and by CI's deploy check (the worker it
reaches must report the build of the commit it deployed).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BUILD = _load("_scsim_build", ROOT / "scsim" / "scsim" / "build.py")
WORKER_BUILD = _load("_sim_worker_build", ROOT / "sim-worker" / "sim_worker" / "build.py")


def _version_from(init_text: str) -> str:
    m = re.search(r'^ENGINE_VERSION\s*=\s*"([^"]+)"', init_text, re.M)
    if not m:
        raise SystemExit("no ENGINE_VERSION in scsim/__init__.py")
    return m.group(1)


def from_source() -> dict[str, str]:
    scsim_dir = ROOT / "scsim" / "scsim"
    worker_dir = ROOT / "sim-worker" / "sim_worker"
    version = _version_from((scsim_dir / "__init__.py").read_text())
    s = BUILD.digest_files(BUILD.package_sources(scsim_dir))
    w = BUILD.digest_files(BUILD.package_sources(worker_dir, WORKER_BUILD.COMPUTE_MODULES))
    return _result(version, s, w)


def _wheel_sources(path: Path, package: str, modules=None, lenient: bool = False) -> list[tuple[str, bytes]]:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith(f"{package}/") and n.endswith(".py")]
        if modules is not None:
            wanted = {f"{package}/{m.replace('.', '/')}.py" for m in modules}
            missing = wanted - set(names)
            if missing and not lenient:
                raise SystemExit(f"{path.name} lacks {', '.join(sorted(missing))}")
            names = sorted(wanted & set(names))
        return [(n, z.read(n)) for n in names]


def from_wheels(scsim_whl: Path, worker_whl: Path, lenient: bool = False) -> dict[str, str]:
    """A build's name from its two wheels.

    ``lenient`` names a HISTORIC wheel set (WP 15.3's backfill): one built before
    some of today's compute-path modules existed is named by the ones it has. The
    name is then an identity for the archive, not something any run recorded —
    `publish_engine_wheels.mjs` marks such an entry `named_retroactively`.
    """
    s_items = _wheel_sources(scsim_whl, "scsim")
    init = dict(s_items)["scsim/__init__.py"].decode()
    s = BUILD.digest_files(s_items)
    w = BUILD.digest_files(_wheel_sources(worker_whl, "sim_worker", WORKER_BUILD.COMPUTE_MODULES, lenient))
    return _result(_version_from(init), s, w)


def _result(version: str, s: str, w: str) -> dict[str, str]:
    return {
        "version": version,
        "code_version": BUILD.compose(version, {"scsim": s, "sim_worker": w}),
        "scsim_digest": s,
        "sim_worker_digest": w,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wheels", nargs="*", type=Path)
    ap.add_argument("--source", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--lenient", action="store_true", help="name a historic wheel set by the compute modules it has")
    a = ap.parse_args(argv)
    if a.source:
        r = from_source()
    elif len(a.wheels) == 2:
        r = from_wheels(*a.wheels, lenient=a.lenient)
    else:
        ap.error("give --source, or the scsim and sim_worker wheels")
    print(json.dumps(r, indent=2) if a.json else r["code_version"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
