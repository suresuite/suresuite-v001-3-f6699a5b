"""Generate the frontend's committed copy of the scsim registry (§6.2).

The engine is the single source of truth for the policy catalog and every
policy's parameter schema (units / ranges / defaults / enums). The frontend
cannot run Python at request time, so it reads a committed snapshot of the
registry instead of re-typing those facts by hand. This script writes that
snapshot; ``--check`` (the CI gate) fails when the committed file drifts from
the engine — the same guarantee gen_docs.py gives the reference docs.

    python scripts/gen_frontend_registry.py          # (re)write the snapshot
    python scripts/gen_frontend_registry.py --check   # CI gate (exit 1 on drift)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scsim.io.registry_export import registry_json

# scripts/ -> scsim/ -> repo root -> src/lib/policies/registry.generated.json
_ROOT = Path(__file__).resolve().parents[2]
TARGET = _ROOT / "src" / "lib" / "policies" / "registry.generated.json"
# The sim-command edge function reads the same snapshot for its pre-dispatch
# validation gate (§8.2); Supabase bundles only supabase/functions/**, so the
# payload is mirrored there rather than imported across the repo boundary.
EDGE_TARGET = (
    _ROOT / "supabase" / "functions" / "_shared" / "registry.generated.json"
)


def _content() -> str:
    # Deterministic (sorted keys, stable indent) so the drift check is exact.
    return registry_json(indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail (exit 1) if the committed snapshot drifts from the registry")
    args = ap.parse_args()

    content = _content()
    if args.check:
        for target in (TARGET, EDGE_TARGET):
            if not target.exists() or target.read_text() != content:
                print(
                    f"REGISTRY DRIFT: {target.relative_to(_ROOT)} is out of "
                    "sync with the engine — run `python scsim/scripts/gen_frontend_registry.py` "
                    "and commit the result.",
                    file=sys.stderr,
                )
                return 1
        print("frontend + edge registry snapshots are in sync with the engine")
        return 0

    for target in (TARGET, EDGE_TARGET):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
