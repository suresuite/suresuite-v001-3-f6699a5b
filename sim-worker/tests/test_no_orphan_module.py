"""Every `sim_worker` module is reachable from the worker's entry point (audit
2026-09-22, F-37).

`warmup.py` (Welch + MSER-5) was imported by nothing — not the worker, not the
frozen legacy engine — and its `detect_warmup` returned an index into the
SMOOTHED series, `window // 2` steps early. A module that claims a named
statistical method and that nothing runs is a claim nobody checks. The gate
walks the import graph from `__main__` (what `python -m sim_worker` runs) and
fails on any module it cannot reach, including imports made inside functions.
"""
from __future__ import annotations

import ast
from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "sim_worker"


def _imports(path: Path) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            if node.level == 1 and node.module:
                out.add(node.module.split(".")[0])
            elif node.level == 1:
                out.update(a.name for a in node.names)
            elif node.module and node.module.startswith("sim_worker."):
                out.add(node.module.split(".")[1])
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.name.startswith("sim_worker."):
                    out.add(a.name.split(".")[1])
    return out


def reachable(entry: str = "__main__") -> set[str]:
    seen, todo = set(), [entry]
    while todo:
        mod = todo.pop()
        if mod in seen or not (PKG / f"{mod}.py").exists():
            continue
        seen.add(mod)
        todo.extend(_imports(PKG / f"{mod}.py"))
    return seen


# Unreachable as CODE and kept on purpose, each with the reason. The list may only
# shrink; a name here whose module is gone or reachable fails below.
KEPT_UNREACHABLE = {
    # Hand-written policy models no code imports. It is still READ AS SOURCE by the
    # policy-break classifier (`scripts/data-contract/chains.mjs`, §4 D91), where
    # `reorder_point`'s "overridden" class cites its line 41. Deleting it
    # reclassifies that break and moves the ratchet — a change of its own.
    "policies",
}


def test_every_module_is_reachable_from_the_entry_point():
    modules = {p.stem for p in PKG.glob("*.py")} - {"__init__"}
    orphans = sorted(modules - reachable() - KEPT_UNREACHABLE)
    assert orphans == [], (
        f"sim_worker modules nothing imports: {orphans}. Delete them, or import "
        "them from the path that runs them."
    )


def test_the_exceptions_are_not_stale():
    for mod in KEPT_UNREACHABLE:
        assert (PKG / f"{mod}.py").exists(), f"{mod}.py is gone — drop it from KEPT_UNREACHABLE"
        assert mod not in reachable(), f"{mod} is imported now — drop it from KEPT_UNREACHABLE"


def test_the_walk_is_not_vacuous():
    r = reachable()
    # The live path and the frozen legacy engine's dependencies are both in it.
    assert {"worker", "scsim_bridge", "engine", "kpi", "stopping"} <= r
