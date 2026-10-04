"""The engine's version and build identity — PLAN.md §25 · WP 15.1 · §4 D292, D293."""
from __future__ import annotations

from importlib.metadata import version as dist_version

import scsim
from scsim import ENGINE_VERSION
from scsim.build import compose, digest_files, engine_build, source_digest, version_of


def test_one_version_number():
    # §4 D293 — the package version was 0.2.0 through eleven engine versions.
    assert scsim.__version__ == ENGINE_VERSION
    assert dist_version("scsim") == ENGINE_VERSION


def test_the_digest_is_order_free_and_content_sensitive():
    a = [("scsim/a.py", b"x = 1\n"), ("scsim/b.py", b"y = 2\n")]
    assert digest_files(a) == digest_files(list(reversed(a)))
    assert digest_files(a) != digest_files([("scsim/a.py", b"x = 2\n"), ("scsim/b.py", b"y = 2\n")])
    # A renamed file is a different build even with the same bytes.
    assert digest_files(a) != digest_files([("scsim/c.py", b"x = 1\n"), ("scsim/b.py", b"y = 2\n")])


def test_the_build_names_the_version_and_is_stable():
    b = engine_build()
    assert b.startswith(f"scsim-{ENGINE_VERSION}+") and len(b.split("+")[1]) == 12
    assert b == engine_build() and len(source_digest()) == 64
    assert compose("1.0.0", {"scsim": "a", "sim_worker": "b"}) == compose("1.0.0", {"sim_worker": "b", "scsim": "a"})
    assert version_of(b) == ENGINE_VERSION
