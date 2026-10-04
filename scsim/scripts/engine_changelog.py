# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""The engine's change record: its gate and its generated views.

PLAN.md §25 (Phase 15) · WP 15.4 · §4 D295 · gate ``engine-ledger``.

``scsim/CHANGELOG.yaml`` is the ONE place an engine version's meaning is
authored. This script holds it to the rules its header states, and renders the
two views of it that are committed (a gate that compares against an uncommitted
artifact can never fail):

    scsim/docs/changelog.md                                     the engine reference
    src/components/docs/generated/engineChangelog.generated.ts  the /docs page (WP 15.6)

Usage (from ``scsim/``)::

    python scripts/engine_changelog.py check                 # rules 1, 4 + the entry schema
    python scripts/engine_changelog.py check --base auto     # … and rules 2, 3, 6, 7 against the base
    python scripts/engine_changelog.py generate              # (re)write the two views
    python scripts/engine_changelog.py generate --check      # CI: fail on drift
    python scripts/engine_changelog.py tags                  # `engine-v<version> <sha>`, for CI's tags (WP 15.3)

``--base auto`` compares against the first parent on ``main`` and against the
merge base with ``origin/main`` anywhere else; it needs history, so CI checks
out with ``fetch-depth: 0``. On a shallow clone the history rules say SKIPPED
rather than passing silently.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

SCSIM = Path(__file__).resolve().parents[1]
ROOT = SCSIM.parent
CHANGELOG = SCSIM / "CHANGELOG.yaml"
INIT = SCSIM / "scsim" / "__init__.py"
PIPELINE_SCHEMA = SCSIM / "scsim" / "pipeline_schema.json"
GOLDEN_ENGINE = SCSIM / "tests" / "data" / "golden_digests.json"
GOLDEN_WORKER = ROOT / "sim-worker" / "tests" / "data" / "golden_runs.json"
ADR_DIR = SCSIM / "docs" / "adr"
BLUEPRINT = ROOT / "docs" / "design" / "next-gen-platform-design.md"
OUT_MD = SCSIM / "docs" / "changelog.md"
OUT_TS = ROOT / "src" / "components" / "docs" / "generated" / "engineChangelog.generated.ts"

# The engine's source, for rule 6. The generated build stamp is not source.
ENGINE_SRC = "scsim/scsim"
ENGINE_SRC_IGNORED = ("scsim/scsim/_build.py",)

TIERS = (1, 2, 3)
COMPARABLE = ("identical", "changed-for", "not-comparable")
REQUIRED = ("version", "date", "commit", "tier", "adr", "summary", "technical", "policies",
            "kpis", "goldens_moved", "comparable", "comparability", "refs", "amendments")
OPTIONAL = ("backfilled", "unrecorded_changes")
AMENDMENT_KEYS = ("date", "commit", "tier", "summary")
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
POLICY_RE = re.compile(r"^P-[SPTCFXW]\.\d+$")


# ── reading ──────────────────────────────────────────────────────────────────

def engine_version_of(init_text: str) -> str:
    m = re.search(r'^ENGINE_VERSION\s*=\s*"([^"]+)"', init_text, re.M)
    if not m:
        raise ValueError("no ENGINE_VERSION assignment found")
    return m.group(1)


def parse_version(v: str) -> tuple[int, int, int]:
    m = VERSION_RE.match(str(v))
    if not m:
        raise ValueError(f"not a semantic version: {v!r}")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def load_entries(text: str) -> list[dict[str, Any]]:
    data = yaml.safe_load(text)
    if not isinstance(data, list):
        raise ValueError("CHANGELOG.yaml must be a list of entries")
    return data


def known_policy_ids() -> set[str]:
    """Catalog IDs the registry exports, plus every ID the blueprint's catalog names."""
    from scsim.io.registry_export import build_registry

    ids = {p["catalog_ref"] for p in build_registry()["policies"] if p.get("catalog_ref")}
    if BLUEPRINT.exists():
        ids |= set(re.findall(r"P-[SPTCFXW]\.\d+", BLUEPRINT.read_text()))
    return ids


def known_kpis() -> set[str]:
    from scsim.io.registry_export import build_registry

    return {k["name"] for k in build_registry()["kpis"]}


def golden_names() -> set[str]:
    names = {f"engine:{k}" for k in json.loads(GOLDEN_ENGINE.read_text())}
    if GOLDEN_WORKER.exists():
        names |= {f"worker:{k}" for k in json.loads(GOLDEN_WORKER.read_text())}
    return names


# ── the static rules: the file, alone ────────────────────────────────────────

def check_entries(
    entries: list[dict[str, Any]],
    engine_version: str,
    *,
    policy_ids: set[str] | None = None,
    kpis: set[str] | None = None,
    goldens: set[str] | None = None,
    adr_numbers: set[str] | None = None,
) -> list[str]:
    """Rules 1 and 4 and the entry schema. Returns failures (empty = holds)."""
    errs: list[str] = []
    seen: list[tuple[int, int, int]] = []
    prev_date: _dt.date | None = None

    for i, e in enumerate(entries):
        where = f"entry {i} ({e.get('version', '?')})" if isinstance(e, dict) else f"entry {i}"
        if not isinstance(e, dict):
            errs.append(f"{where}: not a mapping")
            continue
        missing = [k for k in REQUIRED if k not in e]
        unknown = [k for k in e if k not in REQUIRED + OPTIONAL]
        if missing:
            errs.append(f"{where}: missing {', '.join(missing)}")
            continue
        if unknown:
            errs.append(f"{where}: unknown field(s) {', '.join(unknown)}")
        backfilled = bool(e.get("backfilled"))

        try:
            v = parse_version(e["version"])
        except ValueError as exc:
            errs.append(f"{where}: {exc}")
            continue
        if v in seen:
            errs.append(f"{where}: version {e['version']} appears twice")
        if seen and v >= seen[-1]:
            errs.append(f"{where}: versions must strictly DESCEND (newest first); "
                        f"{e['version']} follows {'.'.join(map(str, seen[-1]))}")
        seen.append(v)

        d = e["date"]
        if not isinstance(d, _dt.date):
            errs.append(f"{where}: date must be YYYY-MM-DD")
        else:
            if prev_date and d > prev_date:
                errs.append(f"{where}: dated {d}, after the newer entry above it ({prev_date})")
            prev_date = d

        if e["commit"] is not None and not (isinstance(e["commit"], str) and COMMIT_RE.match(e["commit"])):
            errs.append(f"{where}: commit must be null or a hex sha (quote it: an all-digit sha is a number in YAML)")
        if e["tier"] not in TIERS:
            errs.append(f"{where}: tier must be 1, 2 or 3")
        if e["tier"] == 3 and not backfilled and not e["adr"]:
            errs.append(f"{where}: a Tier 3 change names its ADR (Part IX §9.5)")
        if e["adr"] is not None and adr_numbers is not None and str(e["adr"]) not in adr_numbers:
            errs.append(f"{where}: ADR {e['adr']} is not in scsim/docs/adr/")
        for k in ("summary", "technical", "comparability"):
            if not isinstance(e[k], str) or not e[k].strip():
                errs.append(f"{where}: {k} must be non-empty text")
        if e["comparable"] not in COMPARABLE:
            errs.append(f"{where}: comparable must be one of {', '.join(COMPARABLE)}")

        for k in ("policies", "kpis", "refs", "amendments"):
            if not isinstance(e[k], list):
                errs.append(f"{where}: {k} must be a list")
        for p in e["policies"] if isinstance(e["policies"], list) else []:
            if not POLICY_RE.match(str(p)):
                errs.append(f"{where}: {p!r} is not a catalog ID")
            elif policy_ids is not None and p not in policy_ids:
                errs.append(f"{where}: {p} is in neither the registry nor the blueprint's catalog")
        for k in e["kpis"] if isinstance(e["kpis"], list) else []:
            if kpis is not None and k not in kpis:
                errs.append(f"{where}: KPI {k!r} is not a registry KPI")

        gm = e["goldens_moved"]
        if gm is None:
            if not backfilled:
                errs.append(f"{where}: goldens_moved may be null only on a backfilled entry "
                            "(the frozen digests exist since WP 14.0)")
        elif not isinstance(gm, list):
            errs.append(f"{where}: goldens_moved must be a list")
        else:
            for g in gm:
                if not re.match(r"^(engine|worker):\S+$", str(g)):
                    errs.append(f"{where}: {g!r} is not engine:<name> or worker:<case>")
                elif goldens is not None and i == 0 and g not in goldens:
                    errs.append(f"{where}: {g} is not a frozen reference run")
            # RULE 4 — an entry cannot call itself identical while a reference run moved.
            if gm and e["comparable"] == "identical":
                errs.append(f"{where}: comparable is 'identical' but {len(gm)} frozen reference "
                            "run(s) moved (rule 4)")
        if e["comparable"] == "changed-for" and not (e["policies"] or e["kpis"]):
            errs.append(f"{where}: 'changed-for' names the policies or KPIs it changes for")

        for j, a in enumerate(e["amendments"] if isinstance(e["amendments"], list) else []):
            aw = f"{where} amendment {j}"
            if not isinstance(a, dict) or sorted(a) != sorted(AMENDMENT_KEYS):
                errs.append(f"{aw}: needs exactly {', '.join(AMENDMENT_KEYS)}")
                continue
            if a["commit"] is not None and not (isinstance(a["commit"], str) and COMMIT_RE.match(a["commit"])):
                errs.append(f"{aw}: commit must be null or a quoted hex sha")
            if a["tier"] not in TIERS:
                errs.append(f"{aw}: tier must be 1, 2 or 3")
            if a["tier"] == 3:
                errs.append(f"{aw}: a Tier 3 change cannot be an amendment — it is a new "
                            "minor or major version with an ADR")
            if not isinstance(a["summary"], str) or not a["summary"].strip():
                errs.append(f"{aw}: summary must be non-empty text")

        if backfilled:
            uc = e.get("unrecorded_changes")
            if not isinstance(uc, int) or uc < 0:
                errs.append(f"{where}: a backfilled entry states unrecorded_changes (a count ≥ 0)")
        elif "unrecorded_changes" in e:
            errs.append(f"{where}: unrecorded_changes belongs to backfilled entries only — a new "
                        "change is recorded, not counted")

    # Tier ↔ version step, for entries the gate governs (not the backfill).
    for newer, older in zip(entries, entries[1:]):
        if not isinstance(newer, dict) or newer.get("backfilled") or "version" not in newer:
            continue
        try:
            a, b = parse_version(newer["version"]), parse_version(older["version"])
        except (ValueError, KeyError, TypeError):
            continue
        if newer.get("tier") == 3 and a[:2] == b[:2]:
            errs.append(f"entry {newer['version']}: Tier 3 is a minor or major bump "
                        f"(from {older['version']}), not a patch")

    # RULE 1 — the running version is described, and it is the newest entry.
    versions = [e.get("version") for e in entries if isinstance(e, dict)]
    n = versions.count(engine_version)
    if n == 0:
        errs.append(f"ENGINE_VERSION {engine_version} has no entry in CHANGELOG.yaml (rule 1)")
    elif versions and versions[0] != engine_version:
        errs.append(f"ENGINE_VERSION {engine_version} is not the newest entry "
                    f"({versions[0]} is) (rule 1)")
    return errs


# ── the history rules: this tree against its base ────────────────────────────

def moved_goldens(base: dict[str, Any], head: dict[str, Any], prefix: str) -> list[str]:
    """Reference runs present on both sides whose digest differs.

    A run that was added or removed did not MOVE — a new reference scenario is a
    new test, not a behaviour change. A worker run's mapping-warning text is not
    its digest: a reworded warning moves no result.
    """
    out = []
    for k in sorted(set(base) & set(head)):
        b, h = base[k], head[k]
        if isinstance(b, dict):
            b, h = b.get("sha256"), (h or {}).get("sha256")
        if b != h:
            out.append(f"{prefix}:{k}")
    return out


def _schema_without_version(text: str | None) -> Any:
    if text is None:
        return None
    d = json.loads(text)
    d.pop("engine_version", None)
    return d


def check_history(
    *,
    head_version: str,
    head_entries: list[dict[str, Any]],
    base_version: str,
    base_entries: list[dict[str, Any]] | None,
    base_golden_engine: dict[str, Any],
    head_golden_engine: dict[str, Any],
    base_golden_worker: dict[str, Any],
    head_golden_worker: dict[str, Any],
    base_schema: str | None,
    head_schema: str | None,
    engine_src_changed: bool,
) -> list[str]:
    """Rules 2, 3, 6 and 7. Returns failures (empty = holds)."""
    errs: list[str] = []
    bumped = head_version != base_version
    by_version = {e.get("version"): e for e in head_entries if isinstance(e, dict)}
    entry = by_version.get(head_version)
    moved = (moved_goldens(base_golden_engine, head_golden_engine, "engine")
             + moved_goldens(base_golden_worker, head_golden_worker, "worker"))

    # RULE 2 — moved means bumped, and the new entry names exactly what moved.
    if moved and not bumped:
        errs.append(f"{len(moved)} frozen reference run(s) moved ({', '.join(moved)}) and "
                    f"ENGINE_VERSION is still {base_version}: bump it and add an entry (rule 2)")
    if bumped and entry is not None:
        listed = sorted(entry.get("goldens_moved") or [])
        if listed != sorted(moved):
            errs.append(f"entry {head_version}: goldens_moved lists {listed or '[]'} but "
                        f"{sorted(moved) or '[]'} moved against the base (rule 2)")

    # RULE 3 — a pipeline contract change is Tier 3, with its ADR.
    if _schema_without_version(base_schema) != _schema_without_version(head_schema):
        if not bumped:
            errs.append("pipeline_schema.json changed with no ENGINE_VERSION bump (rule 3)")
        elif entry is not None and (entry.get("tier") != 3 or not entry.get("adr")):
            errs.append(f"entry {head_version}: the pipeline contract changed, so the entry is "
                        "Tier 3 and names its ADR (rule 3)")

    base_by_version = {e.get("version"): e for e in (base_entries or []) if isinstance(e, dict)}

    # RULE 6 — engine source changed under the same version ⇒ an amendment says what.
    if engine_src_changed and not bumped:
        if base_entries is None:
            pass  # the base predates the change record: nothing to append to there
        else:
            before = len((base_by_version.get(head_version) or {}).get("amendments") or [])
            after = len((entry or {}).get("amendments") or [])
            if after <= before:
                errs.append(f"the engine source changed and ENGINE_VERSION is still {head_version}: "
                            "append an amendment to its entry (date, commit: null, tier, summary) "
                            "or bump the version (rule 6)")

    # RULE 7 — append-only: a published entry is never rewritten.
    for v, old in base_by_version.items():
        new = by_version.get(v)
        if new is None:
            errs.append(f"entry {v} was removed — the change record is append-only (rule 7)")
            continue
        for k in set(old) | set(new):
            if k == "amendments":
                oa, na = old.get(k) or [], new.get(k) or []
                if na[: len(oa)] != oa:
                    errs.append(f"entry {v}: an existing amendment was edited or removed — "
                                "amendments are appended only (rule 7)")
            elif k == "commit" and old.get(k) is None and new.get(k) is not None:
                continue  # completing a commit the entry could not know when it was written
            elif old.get(k) != new.get(k):
                errs.append(f"entry {v}: field {k!r} changed — a published entry is never "
                            "rewritten; append an amendment instead (rule 7)")
    return errs


# ── git plumbing for --base ──────────────────────────────────────────────────

def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def resolve_base(spec: str) -> str | None:
    if spec != "auto":
        return spec
    if _git("rev-parse", "--is-shallow-repository").stdout.strip() == "true":
        return None
    on_main = os.environ.get("GITHUB_REF") == "refs/heads/main" or \
        _git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == "main"
    if on_main:
        r = _git("rev-parse", "HEAD^1")
        return r.stdout.strip() if r.returncode == 0 else None
    for ref in ("origin/main", "main"):
        r = _git("merge-base", "HEAD", ref)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return None


def _show(base: str, path: Path) -> str | None:
    r = _git("show", f"{base}:{path.relative_to(ROOT).as_posix()}")
    return r.stdout if r.returncode == 0 else None


def engine_source_changed(base: str) -> bool:
    r = _git("diff", "--name-only", base, "--", ENGINE_SRC)
    files = [f for f in r.stdout.split() if f and f not in ENGINE_SRC_IGNORED]
    return bool(files)


# ── generation ───────────────────────────────────────────────────────────────

COMPARABLE_WORDS = {
    "identical": "Comparable — results unchanged",
    "changed-for": "Changed for some projects",
    "not-comparable": "Not comparable",
}


def _md_entry(e: dict[str, Any]) -> list[str]:
    head = f"## {e['version']} · {e['date']} · Tier {e['tier']}"
    lines = [head, ""]
    lines.append(f"**{COMPARABLE_WORDS[e['comparable']]}.** {e['comparability'].strip()}")
    lines += ["", e["summary"].strip(), "", f"*Technical.* {e['technical'].strip()}", ""]
    facts = []
    facts.append(f"commit `{e['commit']}`" if e["commit"] else "commit: not yet recorded")
    if e["adr"]:
        facts.append(f"ADR {e['adr']}")
    if e["policies"]:
        facts.append("policies " + ", ".join(e["policies"]))
    if e["kpis"]:
        facts.append("KPIs " + ", ".join(f"`{k}`" for k in e["kpis"]))
    if e["goldens_moved"] is None:
        facts.append("frozen reference runs: predates them")
    else:
        facts.append("frozen reference runs moved: " + (", ".join(f"`{g}`" for g in e["goldens_moved"]) or "none"))
    if e["refs"]:
        facts.append("refs " + ", ".join(str(r) for r in e["refs"]))
    lines += ["- " + f for f in facts]
    if e["amendments"]:
        lines += ["", "**Changed under this version without a bump:**", ""]
        for a in e["amendments"]:
            c = f" (`{a['commit']}`)" if a["commit"] else ""
            lines.append(f"- {a['date']} · Tier {a['tier']}{c} — {a['summary'].strip()}")
    if e.get("backfilled"):
        uc = e.get("unrecorded_changes", 0)
        note = ("Written from git history by WP 15.4."
                + (f" {uc} further engine-source commit(s) under this version are described by no "
                   "record." if uc else ""))
        lines += ["", f"*{note}*"]
    lines.append("")
    return lines


def render_markdown(entries: list[dict[str, Any]]) -> str:
    out = [
        "<!-- GENERATED by scripts/engine_changelog.py from scsim/CHANGELOG.yaml. Do not edit by "
        "hand: `engine_changelog.py generate --check` fails on drift. -->",
        "",
        "# Engine changelog",
        "",
        "Every engine version, what it changed, and whether results stay comparable across it. "
        "Authored once in `scsim/CHANGELOG.yaml` and gated in CI (PLAN.md §25, gate "
        "`engine-ledger`). *Comparable* answers the user's question; *Tier* is the engineering "
        "classification (Part IX §9.5) — a patch can still change results for some projects.",
        "",
    ]
    for e in entries:
        out += _md_entry(e)
    return "\n".join(out).rstrip() + "\n"


def _ts_entry(e: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": e["version"],
        "date": e["date"].isoformat(),
        "commit": e["commit"],
        "tier": e["tier"],
        "adr": e["adr"],
        "summary": " ".join(e["summary"].split()),
        "technical": " ".join(e["technical"].split()),
        "policies": e["policies"],
        "kpis": e["kpis"],
        "goldensMoved": e["goldens_moved"],
        "comparable": e["comparable"],
        "comparability": " ".join(e["comparability"].split()),
        "refs": [str(r) for r in e["refs"]],
        "amendments": [
            {"date": a["date"].isoformat() if isinstance(a["date"], _dt.date) else str(a["date"]),
             "commit": a["commit"], "tier": a["tier"], "summary": " ".join(a["summary"].split())}
            for a in e["amendments"]
        ],
        "backfilled": bool(e.get("backfilled")),
        "unrecordedChanges": e.get("unrecorded_changes"),
    }


def render_ts(entries: list[dict[str, Any]]) -> str:
    body = json.dumps([_ts_entry(e) for e in entries], indent=2, ensure_ascii=False)
    return (
        "// GENERATED by scsim/scripts/engine_changelog.py from scsim/CHANGELOG.yaml.\n"
        "// Do not edit by hand: `engine_changelog.py generate --check` fails on drift.\n"
        "//\n"
        "// PLAN.md §25 · WP 15.4 / 15.6 — the engine's change record, as the /docs page and\n"
        "// every surface that names an engine version read it.\n\n"
        "export type EngineComparable = \"identical\" | \"changed-for\" | \"not-comparable\";\n\n"
        "export type EngineAmendment = {\n"
        "  date: string;\n  commit: string | null;\n  tier: 1 | 2 | 3;\n  summary: string;\n};\n\n"
        "export type EngineChange = {\n"
        "  version: string;\n  date: string;\n  commit: string | null;\n  tier: 1 | 2 | 3;\n"
        "  adr: string | null;\n  summary: string;\n  technical: string;\n  policies: string[];\n"
        "  kpis: string[];\n  /** null = the version predates the frozen reference runs (WP 14.0). */\n"
        "  goldensMoved: string[] | null;\n  comparable: EngineComparable;\n  comparability: string;\n"
        "  refs: string[];\n  amendments: EngineAmendment[];\n  backfilled: boolean;\n"
        "  unrecordedChanges: number | null | undefined;\n};\n\n"
        "/** Newest first. */\n"
        f"export const ENGINE_CHANGES: EngineChange[] = {body};\n"
    )


# ── CLI ──────────────────────────────────────────────────────────────────────

def _adr_numbers() -> set[str]:
    return {p.name.split("-", 1)[0] for p in ADR_DIR.glob("*.md")}


def cmd_check(base_spec: str | None) -> int:
    entries = load_entries(CHANGELOG.read_text())
    version = engine_version_of(INIT.read_text())
    errs = check_entries(entries, version, policy_ids=known_policy_ids(), kpis=known_kpis(),
                         goldens=golden_names(), adr_numbers=_adr_numbers())
    print(f"  rules 1, 4 + schema · {len(entries)} entries · ENGINE_VERSION {version}")
    if base_spec:
        base = resolve_base(base_spec)
        if base is None:
            print("  rules 2, 3, 6, 7 — SKIPPED: no base (shallow clone, or no main to compare with)")
        else:
            init_b = _show(base, INIT)
            cl_b = _show(base, CHANGELOG)
            ge_b, gw_b = _show(base, GOLDEN_ENGINE), _show(base, GOLDEN_WORKER)
            errs += check_history(
                head_version=version,
                head_entries=entries,
                base_version=engine_version_of(init_b) if init_b else version,
                base_entries=load_entries(cl_b) if cl_b else None,
                base_golden_engine=json.loads(ge_b) if ge_b else {},
                head_golden_engine=json.loads(GOLDEN_ENGINE.read_text()),
                base_golden_worker=json.loads(gw_b) if gw_b else {},
                head_golden_worker=json.loads(GOLDEN_WORKER.read_text()) if GOLDEN_WORKER.exists() else {},
                base_schema=_show(base, PIPELINE_SCHEMA),
                head_schema=PIPELINE_SCHEMA.read_text(),
                engine_src_changed=engine_source_changed(base),
            )
            print(f"  rules 2, 3, 6, 7 · against {base[:12]}"
                  + ("" if cl_b else " (the base predates the change record)"))
    if errs:
        print("✗ the engine change record does not hold:")
        for e in errs:
            print(f"  ✗ {e}")
        return 1
    print("✓ the engine change record holds")
    return 0


def cmd_generate(check: bool) -> int:
    entries = load_entries(CHANGELOG.read_text())
    want = {OUT_MD: render_markdown(entries), OUT_TS: render_ts(entries)}
    stale = []
    for path, text in want.items():
        have = path.read_text() if path.exists() else None
        if have != text:
            if check:
                stale.append(path.relative_to(ROOT).as_posix())
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
                print(f"wrote {path.relative_to(ROOT).as_posix()}")
    if stale:
        print("✗ generated from CHANGELOG.yaml and stale — run "
              "`python scripts/engine_changelog.py generate`: " + ", ".join(stale))
        return 1
    if check:
        print("✓ the change record's generated views are current")
    return 0


def version_commit(entry: dict[str, Any]) -> str | None:
    """The full sha of the commit that set this version: the entry's own, or — for an
    entry written before its commit existed — the first commit whose ENGINE_VERSION
    line reads it. None when history cannot say (a shallow clone)."""
    if entry.get("commit"):
        r = _git("rev-parse", "--verify", f"{entry['commit']}^{{commit}}")
        return r.stdout.strip() if r.returncode == 0 else None
    pattern = f'^ENGINE_VERSION = "{re.escape(entry["version"])}"'
    r = _git("log", "--reverse", "--format=%H", "-G", pattern, "--", INIT.relative_to(ROOT).as_posix())
    for sha in r.stdout.split():
        text = _git("show", f"{sha}:{INIT.relative_to(ROOT).as_posix()}").stdout
        if text and engine_version_of(text) == entry["version"]:
            return sha
    return None


def cmd_tags() -> int:
    """`engine-v<version> <sha>` per entry — what CI tags (WP 15.3), never moving one."""
    for e in load_entries(CHANGELOG.read_text()):
        sha = version_commit(e)
        if sha:
            print(f"engine-v{e['version']} {sha}")
        else:
            print(f"# engine-v{e['version']}: no commit found in this clone", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--base", help="git ref to compare with, or 'auto'")
    g = sub.add_parser("generate")
    g.add_argument("--check", action="store_true")
    sub.add_parser("tags", help="print `engine-v<version> <sha>` for every version (WP 15.3)")
    a = ap.parse_args(argv)
    if a.cmd == "tags":
        return cmd_tags()
    return cmd_check(a.base) if a.cmd == "check" else cmd_generate(a.check)


if __name__ == "__main__":
    sys.exit(main())
