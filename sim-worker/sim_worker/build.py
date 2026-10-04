"""The build a platform run names — PLAN.md §25 · WP 15.1 · §4 D293 · gate `engine-ledger` rule 5.

A platform run's numbers are decided by TWO packages: scsim, and the part of
sim_worker that turns frozen inputs into the engine's input and its result into
rows. Both go into the build's name, so a change to either is a new build:

    scsim-<ENGINE_VERSION>+<12 hex over scsim's source and COMPUTE_MODULES>

The worker (Fly), the browser (Pyodide) and a user's machine (the `suresuite`
package) all compute through `sim_worker.local`, so the same code names itself
the same way in all three — `test_engine_build.py` holds that, and that the list
below is exactly what a run loads.

Only the compute path is hashed. `worker.py` (the Redis consumer), the network
metrics and the legacy engine change often and decide no number of an scsim
run; hashing them would re-key every run on every infrastructure change.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

# The sim_worker modules a run loads (`run_from_snapshots` end to end). A module
# a run imports and this list lacks fails `test_engine_build.py`.
COMPUTE_MODULES: tuple[str, ...] = (
    "__init__",
    "build",
    "datamap",
    "engine_input",
    "local",
    "policy_snapshot",
    "run_shape",
    "scsim_bridge",
    "series_store",
)


@lru_cache(maxsize=1)
def worker_digest() -> str:
    from scsim.build import digest_files, package_sources

    return digest_files(package_sources(Path(__file__).resolve().parent, COMPUTE_MODULES))


@lru_cache(maxsize=1)
def code_version() -> str:
    """``scsim-<ENGINE_VERSION>+<digest>`` — what a run row and the registry record."""
    from scsim import ENGINE_VERSION
    from scsim.build import compose, source_digest

    return compose(ENGINE_VERSION, {"scsim": source_digest(), "sim_worker": worker_digest()})


def engine_build() -> dict[str, str]:
    """The build and its parts, for the registry report and the ledger (WP 15.2)."""
    from scsim import ENGINE_VERSION
    from scsim.build import source_digest

    return {
        "version": ENGINE_VERSION,
        "code_version": code_version(),
        "scsim_digest": source_digest(),
        "sim_worker_digest": worker_digest(),
    }
