# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""The engine BUILD: what actually ran, identified by its content.

PLAN.md §25 · WP 15.1 · §4 D293, D294 · gate ``engine-ledger`` rule 5.

``ENGINE_VERSION`` is a number a person sets. Two builds with different code
and the same number were one engine to the RunKey, to reuse and to
comparability (D293), and `main` shipped exactly that: the browser ran a
different 0.6.1 from the worker for a day (§16 · WP 15.4). A build is
therefore named by a DIGEST OF ITS SOURCE:

    scsim-0.6.1+3f9a1c0b7e2d

Why a source digest and not the git commit the plan first named: the browser
wheels are committed in the same commit they would have to name, so a stamped
commit cannot exist for them; and a stamp needs a build step that a source
checkout, a wheel and a Pyodide install would each have to run identically.
The digest needs none — the same ``.py`` files give the same name in the
worker, in the browser and on a user's machine, which is rule 5. The commit is
recorded BESIDE the build where one is known (the worker's image), never as
its identity.

This module is stdlib-only on purpose: ``scripts/engine_build_id.py`` loads it
by path to name a wheel without installing it.
"""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Iterable

DIGEST_LEN = 12


def digest_files(items: Iterable[tuple[str, bytes]]) -> str:
    """sha256 over (posix path, sha256(content)) pairs in path order.

    Paths are relative to the directory that CONTAINS the package
    (``scsim/core/engine.py``), so a source tree, an installed wheel and a
    zip member list name the same file the same way.
    """
    h = hashlib.sha256()
    for rel, data in sorted(items, key=lambda x: x[0]):
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(hashlib.sha256(data).digest())
        h.update(b"\n")
    return h.hexdigest()


def package_sources(pkg_dir: Path, modules: Iterable[str] | None = None) -> list[tuple[str, bytes]]:
    """The ``.py`` files of a package directory, or only the named modules.

    ``modules`` are dotted names relative to the package (``"local"``,
    ``"core.engine"``); ``None`` takes every ``.py`` file below it.
    """
    pkg_dir = Path(pkg_dir)
    base = pkg_dir.parent
    if modules is None:
        files = [p for p in pkg_dir.rglob("*.py") if "__pycache__" not in p.parts]
    else:
        files = [pkg_dir.joinpath(*m.split(".")).with_suffix(".py") for m in modules]
    return [(p.relative_to(base).as_posix(), p.read_bytes()) for p in files]


@lru_cache(maxsize=1)
def source_digest() -> str:
    """The digest of this installed scsim's source."""
    return digest_files(package_sources(Path(__file__).resolve().parent))


def compose(version: str, digests: dict[str, str]) -> str:
    """``scsim-<version>+<12 hex>`` over the named component digests."""
    h = hashlib.sha256("\n".join(f"{k}:{digests[k]}" for k in sorted(digests)).encode()).hexdigest()
    return f"scsim-{version}+{h[:DIGEST_LEN]}"


def engine_build() -> str:
    """This scsim alone. A platform run names scsim AND the worker's compute
    path — ``sim_worker.build.code_version()`` — because both decide its numbers."""
    from scsim import ENGINE_VERSION

    return compose(ENGINE_VERSION, {"scsim": source_digest()})


def version_of(code_version: str | None) -> str | None:
    """``"scsim-0.6.1+abc"`` → ``"0.6.1"``; a pre-WP 15.1 ``"scsim-0.6.1"`` → ``"0.6.1"``."""
    if not code_version or not code_version.startswith("scsim-"):
        return None
    return code_version[len("scsim-"):].split("+", 1)[0]
