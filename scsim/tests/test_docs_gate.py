"""Docs CI gate (Part IX §9.6): generated reference pages must match the
registry — an undocumented parameter fails the build."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_reference_docs_in_sync_with_registry():
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "gen_docs.py"), "--check"],
        capture_output=True, text=True, cwd=ROOT,
    )
    assert proc.returncode == 0, (
        f"docs drift detected:\n{proc.stderr}\nRun `python scripts/gen_docs.py` "
        f"in scsim/ and commit the reference pages."
    )
