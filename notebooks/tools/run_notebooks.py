#!/usr/bin/env python3
"""Execute every built notebook top to bottom in DEMO mode — no key, no network.

    python notebooks/tools/run_notebooks.py [public/notebooks/suresuite_00_quickstart.ipynb …]
    python notebooks/tools/run_notebooks.py --keep-outputs DIR   # also save the executed copies

A notebook whose any cell raises fails the run, with the cell and the error.
This is the proof that a user without an API key can run the whole series.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("notebooks", nargs="*", type=Path)
    ap.add_argument("--keep-outputs", type=Path, default=None)
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args()
    paths = args.notebooks or sorted((ROOT / "public" / "notebooks").glob("suresuite_*.ipynb"))

    os.environ.pop("SURESUITE_API_KEY", None)  # demo mode, whatever the shell holds
    failed = 0
    with tempfile.TemporaryDirectory() as work:
        for path in paths:
            nb = nbformat.read(path, as_version=4)
            nbformat.validate(nb)
            client = NotebookClient(nb, timeout=args.timeout, kernel_name="python3",
                                    resources={"metadata": {"path": work}})
            try:
                client.execute()
                print(f"ok    {path.name} ({len(nb.cells)} cells)")
            except CellExecutionError as e:
                failed += 1
                print(f"FAIL  {path.name}\n{str(e)[-3000:]}", file=sys.stderr)
            if args.keep_outputs:
                args.keep_outputs.mkdir(parents=True, exist_ok=True)
                nbformat.write(nb, args.keep_outputs / path.name)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
