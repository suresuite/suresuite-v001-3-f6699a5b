# Python library plan — free SuReSuite Sim, paid SuReSuite, one engine

> **Status: AUTHORED — the authority for Phase 17.** Owner: Phu Nguyen. Written 2026-10-08.
> This document says what the two Python packages become and the session-sized work packages
> that get them there. The legal and boundary background is
> [`open-access-release-plan.md`](open-access-release-plan.md); data-layer evidence stays in
> [`../PLAN.md`](../PLAN.md) §4 and is cited here by D-number only.

---

## 0. How to use this plan (read this first in every session)

**One work package = one session = one pull request.** Each WP below is sized to finish,
gates included, in about **80 % of one session**. The remaining 20 % is for CI fixes, review
comments and the drift-log entry. Do not start a second WP in the same session.

**Start a session with this prompt** (replace `17.n`):

> Do WP 17.n of `docs/design/python-library-plan.md`. Read §0–§4 of that plan and the WP 17.n
> section only, then the files the WP lists under *Read first*. Do not read the whole of
> `docs/PLAN.md`; open only the sections the WP names. Work on a new branch, end with the
> WP's exit checks green, a §16 drift-log entry, and this plan's status table updated.

**Names in this plan.** The engine is called `scsim` today and becomes **SuReSuite Sim** in
WP 17.1. WP 17.0 and 17.1 use today's paths (`scsim/`, `scsim/scsim/`). From WP 17.2 on, paths
use the new ones (`suresuite-sim/`, `suresuite-sim/suresuite_sim/`); WP 17.1's table maps them.

**The session budget, in practice.** A session runs out of context, not time. To stay at 80 %:

| Rule | Why |
|---|---|
| Read only the WP's *Read first* list in full; open other files by section (`grep -n`, then a range) | `PLAN.md` alone is 27 000 lines and `project_map.py` 3 600 — reading either whole costs a large share of a session |
| At most ~25 hand-written files changed (generated files and mechanical renames excluded) | Above this, review and CI repair no longer fit |
| Check progress at the WP's **checkpoint**. If the checkpoint is not reached by about half of the session, stop at the named **split point**, push, and write the hand-off note | A half-finished WP that is pushed and described is recoverable; one that runs out of context is not |
| Delegate wide searches to a sub-agent and keep only its conclusion | Keeps file dumps out of the main context |
| Run the fast checks locally before every push; one validated push beats three speculative ones | Each red CI round costs ~5–10 % of a session |

**Fixed costs every session pays** (already counted in each WP's size):

- **The engine-ledger ritual** (CLAUDE.md, gate `engine-ledger`): any change to the engine's
  source or the worker's compute path needs a CHANGELOG amendment or version bump, rebuilt
  engine wheels (`scripts/build_engine_wheels.sh`), and a regenerated release report.
  Budget ~10 % of a session for it.
- **After a base merge**: `npm run contract:check` and `npm test` before anything else.
- **Closing the WP**: a `PLAN.md` §16 drift-log entry, the status table in §3 below, and the
  commit convention `Phase 17 / WP 17.n / <blueprint ref>: <title>`.

**Owner steps (👤)** are things a session cannot do — accounts, secrets, legal checks, merges.
They are listed per WP. A WP whose owner step is not done stops at that step and says so.

---

## 1. What we are building

| | **SuReSuite Sim** — free, open source | **SuReSuite** — for subscribers |
|---|---|---|
| Install | `pip install suresuite-sim` → `import suresuite_sim` | `pip install suresuite` → `import suresuite` |
| Who | Anyone. No account, no key, works offline | Paying customers with a SuReSuite subscription |
| Like | SimPy: install, run on your machine, save results anywhere | A thin client to a hosted service |
| Contains | The engine, all policies, disruptions, stress presets, KPIs, statistics, the project file format, a CLI, examples. Later the network-analysis and surrogate **methods** | Pull and push platform projects, cloud runs, platform helpers. Depends on SuReSuite Sim; contains no engine code |
| Licence | Apache-2.0 | Proprietary; the API key gates the service, not the code |
| Where | PyPI, a public read-only GitHub mirror, Zenodo DOI per release | PyPI |

The two are **separate top-level packages**, not one namespace, so `import suresuite as ss`
keeps working in every existing notebook. **The model is still SCSIM**: papers and the thesis
cite "SuReSuite Sim, which implements the SCSIM model", so earlier citations stay valid.

The first line of SuReSuite Sim's README says it is free and needs no account — the family
name must not make users think it does.

**The paid value is the service**: hosted and versioned data, collaboration and roles, the audit
trail, review screens, cloud scale, the web UI, ERP connectors, AI agents, and models trained on
customer data. The methods stay free (Horizon Europe open science, `open-access-release-plan.md` §1).

### What a free user does

```python
pip install suresuite-sim

import suresuite_sim as sim
proj  = sim.load("my_chain/")                  # a folder, a .suresuite file, or an .xlsx workbook
res   = sim.run(proj, replications=30)
shock = sim.stress(proj, "supplier_outage", target="S2", duration_days=42)
sim.compare(res, shock).to_excel("anywhere/report.xlsx")
proj.save("anywhere/my_chain.suresuite")       # later: upload this same file to SuReSuite
```

Three levels, like SimPy: **files in, results out** (or
`suresuite-sim run my_chain/ --stress supplier_outage`); **build in code** (`Network`,
`Supplier`, `Product`, `Scenario`); **extend** (your own policy through the plugin registry,
your own KPIs).

---

## 2. The rules that keep one source of truth

1. **One direction of dependency.** `suresuite` depends on `suresuite_sim`. `suresuite_sim`
   never imports `suresuite`, `sim_worker`, or anything platform-side, and never opens a network
   connection. Gated in WP 17.8.
2. **One engine.** The public package *is* the engine the platform runs. The public repository
   is a mirror cut from the engine folder in this repository and never edited on its own;
   outside contributions are merged here first.
3. **One version.** `ENGINE_VERSION` is the package version (already true). `suresuite`'s
   version is one dynamic attribute (WP 17.11).
4. **One project format, defined by the engine.** The platform exports and imports it; it does
   not define a second one. The format is the frozen snapshot the platform already serves
   (a dataset version plus a policy version), formalized and versioned.
5. **Build once, publish the same bytes everywhere.** One tag builds one wheel; PyPI, the engine
   archive, the browser engine and Zenodo all receive those bytes, so the archived sha256 is the
   PyPI sha256.
6. **Generated, never copied.** Every fact the app or the client needs from the engine is
   generated from the engine:

| Fact | Authored once in | Generated into |
|---|---|---|
| Engine version and changes | `ENGINE_VERSION`, the engine's `CHANGELOG.yaml` | PyPI page, GitHub release, /docs, Zenodo |
| Project file format | the engine's Pydantic models (WP 17.3) | JSON Schema, templates, platform import and export |
| Policy schemas | the engine's `io/registry_export.py` | engine docs, the app's TypeScript registry |
| Stress presets | `suresuite_sim.stress.presets` (WP 17.5) | the app's stress-test list |
| KPI definitions | `suresuite_sim.kpi` (WP 17.4) | `suresuite` display helpers, notebook labels |
| Public API surface | `suresuite_sim.__all__` (WP 17.4) | API snapshot gate (WP 17.8), reference docs |

---

## 3. Status and sequence

| WP | Title | Size | Depends on | Owner step | Status |
|---|---|---|---|---|---|
| 17.0 | Wire the plan in, record the decisions | S | — | — | ⬜ |
| 17.1 | Rename the engine: `scsim` → SuReSuite Sim | L | 17.0 | 👤 trademark search (§4 N6) | ⬜ |
| 17.2 | Move the run-from-snapshot adapter into the engine | L | 17.1 | — | ⬜ |
| 17.3 | Project file format v1 and the bundled example | M | 17.2 | — | ⬜ |
| 17.4 | The front door: `load` · `run` · `stress` · `compare` · `reproduce` | L | 17.3 | — | ⬜ |
| 17.5 | Stress presets authored once in the engine | M | 17.2 | product call on D112 targets (N4) | ⬜ |
| 17.6 | CLI, Excel import, errors that name the cell | M | 17.4 | — | ⬜ |
| 17.7 | Documentation site and keyless tutorials | M | 17.4 | — | ⬜ |
| 17.8 | Release readiness: boundary, hygiene, licence, gates | M | 17.4 | — | ⬜ |
| 17.9 | Publishing pipeline, dry run to TestPyPI | M | 17.8 | 👤 PyPI, GitHub, Zenodo | ⬜ |
| 17.10 | First public release; the platform pins it | S | 17.9 | 👤 approve release | ⬜ |
| 17.11 | `suresuite` 1.0 — read-only, on SuReSuite Sim | M | 17.10 | 👤 PyPI project | ⬜ |
| 17.12 | `suresuite` 1.1 — `push` through the upload path, named actor | L | 17.11 | — | ⬜ |

**Critical path**: 17.0 → 17.1 → 17.2 → 17.3 → 17.4 → 17.8 → 17.9 → 17.10 → 17.11 → 17.12
(ten sessions). **Can run in parallel** on separate branches once their dependency has merged:
17.5 (after 17.2); 17.6 and 17.7 (after 17.4). Merge `main` before pushing each — they touch
neighbouring files.

Sizes: **S** ≈ 30–40 % of a session, **M** ≈ 50–65 %, **L** ≈ 70–80 % with a named split point.

---

## 4. Decisions

| # | Decision | State |
|---|---|---|
| L1 | Code licence | **Apache-2.0** — decided 2026-10-08. Documentation and synthetic benchmark data CC BY 4.0. Contributions by DCO sign-off; no CLA needed because the licence is permissive. Apache §6 grants no trademark rights, so forks may not use the SuReSuite name |
| L2 / L3 | Rights holder; consortium clearance | **Phu Nguyen holds the rights** — owner statement 2026-10-08. The Horizon Europe open-science clauses (`open-access-release-plan.md` §7) still decide what must be open; this plan keeps every method open, so it satisfies them either way |
| L4 / N1 | Public name | **SuReSuite Sim** — `pip install suresuite-sim`, `import suresuite_sim` — decided 2026-10-08. Why not the alternatives: `scsim` is taken on PyPI (a single-cell DNA sequencing simulator, 1.0.0, 2025-11-22); SuReSim is a localization-microscopy simulator; ResilSIM is an urban flood-resilience tool. `suresuite-sim` and `suresuite` were both unregistered on PyPI on 2026-10-08 |
| N2 | `suresuite.push` waits for the named actor | **Yes** — decided 2026-10-08. 1.0 is read-only; `push` ships in 1.1 (WP 17.12) |
| N3 | The engine is public | Follows from L1. Reverses Phase 12's "engine gated by API key" and settles §4 D274 — recorded in WP 17.0, closed in WP 17.11 |
| N4 | Stress preset targets (D112) | **Open — needed by WP 17.5.** Recommended: presets name a target *type* (a supplier, the plant) and resolve to the project's real ids when the preset is applied, refusing a type the mapper cannot reach rather than dropping it |
| N5 | First public version number | Recommended **1.0.0** at WP 17.10: it promises the public API frozen in 17.4/17.8. A bump with no moved golden digest is allowed by the engine ledger as "identical" |
| N6 | Trademark and handle clearance | **👤 Before WP 17.1 merges.** Search "SuReSuite" in the WIPO Global Brand Database and EUIPO eSearch, Nice classes 9 and 42; confirm the GitHub organization and repository name. A web screen on 2026-10-08 found no other software called SuReSuite — that is a screen, not a clearance |
| N7 | Project file extension | Recommended **`.suresuite`** (a zip of the folder form) — it says the file also opens in the platform. Settled in WP 17.3 |

**Before charging money** (not owned by this plan): §4 D28 — the database's permissive policies
and the `anon` key's write grants. A paid audit trail is only as strong as that model.

---

## 5. Work packages

### WP 17.0 — Wire the plan in, record the decisions · S

**Goal.** The repository's existing plans agree with this one, and the decisions above are on record.

**Read first.** This plan; `open-access-release-plan.md`; `PLAN.md` §17 (sequencing) and the
last two §16 entries for the format; the §4 rows D112 and D274 (by `grep -n`).

**Do.**
1. `open-access-release-plan.md`: mark L1–L4 decided as in §4 here; replace its §5 *Steps* with a
   pointer to this plan (one source for the steps); replace its own name references with the
   decided public name.
2. `PLAN.md`: add a short §27 "Phase 17 — the Python libraries" that points here, a row in §17's
   sequencing table, and a §16 entry. Note on D274 that WP 17.11 closes it by making the engine
   public (N3). Note on D112 that WP 17.5 owns the preset half.
3. `scsim/NOTICE.md`: rights holder, intended licence and the public name as decided (the
   `LICENSE` file itself lands in WP 17.8).

**Don't.** Change any code.

**Exit.** `npm run check:docs` · `npm run contract:check` (R7, R8, R10 read these sections).

---

### WP 17.1 — Rename the engine: `scsim` → SuReSuite Sim · L

**Goal.** The engine carries its public name before any new code is written against the old one.
Behaviour does not change: every golden digest stays put.

**Needs, 👤.** N6 (trademark and handle check) done before this WP merges.

**Read first.** CLAUDE.md's `engine-ledger` row; `scsim/pyproject.toml`; `scsim/scsim/__init__.py`;
`sim-worker/sim_worker/build.py`; `scripts/build_engine_wheels.sh`;
`supabase/functions/_shared/engineIndex.ts` (the exact-build lookup); then
`grep -rln scsim .github/workflows scripts src supabase/functions` for the list to change.

**The rename table** (the authority for every later WP's paths):

| What | Today | After |
|---|---|---|
| Distribution (PyPI) | `scsim` | `suresuite-sim` |
| Import | `scsim` | `suresuite_sim` |
| Engine folder | `scsim/` | `suresuite-sim/` |
| Package source | `scsim/scsim/` | `suresuite-sim/suresuite_sim/` |
| Wheel | `scsim-<v>-py3-none-any.whl` | `suresuite_sim-<v>-py3-none-any.whl` |
| Build identity (`code_version`) | `scsim-<v>+<hex>` | `suresuite-sim-<v>+<hex>` |
| CLI (WP 17.6) | — | `suresuite-sim` |
| Model / method name in papers | SCSIM | SCSIM — unchanged |

**Do.**
1. **(a) The Python rename.** `git mv` the folder and the package; rewrite the imports by script
   (measured 2026-10-08: 96 files in the engine, 17 in the worker, 1 notebook); `pyproject.toml`
   name and dynamic-version attribute; the workflows' path filters and steps **in the same
   commit**, or CI stops running the engine tests and the rename looks green while untested.
2. **(b) Everything else that names it** (~150 non-Python files measured): shell scripts, the
   browser engine loader and `public/engine/manifest.json`, TypeScript, the notebooks build,
   CLAUDE.md's current-tense references (orientation table, standing laws, gate rows) and the
   blueprint's orientation row (the blueprint moves with the code).
3. **Build identity.** New builds name themselves `suresuite-sim-…`. Every reader of the prefix
   accepts both forms: the engine index's exact-build lookup, `install_engine(version=…)`, the
   archive and release-report scripts. **History is never rewritten**: run rows, the build
   ledger, the archive's `versions.json`, `PLAN.md` §16 and the CHANGELOG keep `scsim-…`. An
   archived old build still installs as `scsim`; the docs say so.
4. **No `scsim` compatibility module in the wheel** — that name belongs to another PyPI
   project, and shipping a module called `scsim` would overwrite theirs.
5. Engine-ledger ritual: a CHANGELOG amendment "renamed, behaviour identical"; golden digests
   must not move (only the build hash does); rebuild the wheels; regenerate the release report.
6. `NOTICE.md` and the README: "SuReSuite Sim implements the SCSIM model".

**Checkpoint.** (a) pushed with engine and worker tests green in CI.
**Split point**: (b) and item 6 become 17.1b; until it lands, the browser engine keeps the old
wheel name through the manifest, which (a) must not break.

**Exit.** engine tests · `sim-worker` tests · golden digests unchanged ·
`build_engine_wheels.sh --check` · `engine_changelog.py check --base auto` ·
`release_report.py --check` · `npm test` · `npm run lint` · `npm run contract:check` ·
notebooks job · `grep -rnE "^\s*(from|import) scsim\b"` finds nothing outside history.

---

### WP 17.2 — Move the run-from-snapshot adapter into the engine · L

**Goal.** A user can run a simulation from a frozen snapshot with SuReSuite Sim alone. Today
that path runs through the platform's worker package, so a local run needs `sim_worker` installed.

**Read first.** `sim-worker/sim_worker/local.py` (153 lines) and the modules it imports:
`datamap.py`, `policy_snapshot.py`, `engine_input.py`, `scsim_bridge.py`, `run_shape.py`,
`series_store.py`; `sim_worker/build.py` (`COMPUTE_MODULES`); `python/suresuite/local.py`;
`scripts/build_engine_wheels.sh`.

**Do.**
1. **The rule for what moves: what decides a number moves; what shapes a platform database row
   stays.** Expect `datamap`, `policy_snapshot`, `engine_input` and the compute half of
   `scsim_bridge` to move into the engine (e.g. `suresuite_sim/io/snapshot.py` plus a
   `suresuite_sim.run_snapshot` entry point). Expect `run_shape` and `series_store` to stay in
   `sim_worker`. Record the final split in the drift entry.
2. `sim_worker.local` keeps its public function signatures and calls the moved code, so the
   worker, the browser engine and `suresuite` keep working unchanged this WP.
3. Update the build identity: the hashed source set (`COMPUTE_MODULES` plus the engine's own
   source) must still be exactly what a run loads (`test_engine_build.py`).
4. Engine-ledger ritual: no behaviour change, so the golden digests must not move.

**Checkpoint.** Moved modules import from the engine and the worker's own tests pass.
**Split point**: push the move with `sim_worker` shims; leave the build-identity update for
17.2b (CI will say which rule fails — name it in the hand-off).

**Exit.** engine tests · `sim-worker` tests (worker == local == browser) · golden digests
unchanged · `build_engine_wheels.sh --check` · `engine_changelog.py check --base auto` ·
`release_report.py --check` · `notebooks.yml`'s package job.

---

### WP 17.3 — Project file format v1 and the bundled example · M

**Goal.** A project is a file a user can keep anywhere, and the same file the platform exports.

**Read first.** The moved snapshot module from 17.2; `scripts/example_project/dataset.json` (by
its keys, not in full); `suresuite_sim/entities/scenario.py`; the policy-version shape in
`python/suresuite/local.py`.

**Do.**
1. `suresuite_sim.Project` (Pydantic): `tables` (the dataset snapshot), `policies`, `scenarios`,
   and a manifest — `format_version`, the engine version that wrote it, a content hash.
2. Two on-disk forms with one reader: a folder (`project.json`, `tables/*.csv`, `policies.json`,
   `scenarios.json` — friendly to Git and Excel) and a single zip of the same layout with the
   extension settled by N7. Parquet tables when `pyarrow` is installed, CSV otherwise.
3. Generate the JSON Schema from the models (`gen_project_schema.py`, with `--check` in CI).
4. `suresuite_sim.examples.load("example")`: the Example project, shipped in the wheel.
   **Confirm it is synthetic first** (no company data) and say so in the drift entry.
5. Round-trip test: example snapshot → `Project` → folder → zip → `Project`, byte-equal tables,
   and the same simulation digest as the platform's recorded run of the same inputs.

**Don't.** Build the friendly API (17.4) or the platform's import and export (17.11).

**Exit.** engine tests including the round trip · schema `--check` · engine-ledger ritual.

---

### WP 17.4 — The front door: `load` · `run` · `stress` · `compare` · `reproduce` · L

**Goal.** The five-line example in §1 works, and the public API is declared.

**Read first.** `suresuite_sim/__init__.py`; `suresuite_sim/core/engine.py` (entry points only);
`suresuite_sim/kpi/` (module list); `python/suresuite/client.py` (`kpi_table`, `paired_compare` —
the helpers users already know); `python/suresuite/kpi_display.py` and its generator in
`scripts/notebooks/build-notebooks.mjs`.

**Do.**
1. `sim.load(path)` (folder or project zip; `.xlsx` arrives in 17.6) and `Project.save(path)`.
2. `sim.run(project, scenario=None, replications=…, seed=…)` → `Result`.
3. `sim.stress(project, preset_or_events, **target)` — accepts explicit `DisruptionEvent`s now;
   named presets plug in when 17.5 lands.
4. `Result`: `.kpis` (DataFrame when pandas is installed, dict otherwise), `.replications`,
   `.series`, `.to_excel()`, `.to_csv()`, `.save()`; every saved result embeds its
   reproducibility record (engine build, seed, project content hash, scenario).
5. `sim.compare(a, b)` — the paired comparison the notebooks use; `sim.reproduce(result_file)`.
6. KPI definitions (names, labels, units, direction) authored in `suresuite_sim.kpi`;
   `suresuite`'s `kpi_display` generated from them.
7. Declare `__all__`; add `py.typed`; anything not in `__all__` is private.

**Checkpoint.** Items 1–4 with tests. **Split point**: items 5–7 become 17.4b.

**Exit.** engine tests (a test runs §1's example verbatim against the bundled example) ·
notebooks still build (`build-notebooks.mjs --check`) · `python-package` job · engine-ledger ritual.

---

### WP 17.5 — Stress presets authored once in the engine · M

**Goal.** "Stress test" means one thing. Today the library's battery and the app's seven presets
are two different definitions, and six of the seven presets reach no real target (§4 D111, D112).

**Needs.** Decision N4.

**Read first.** `suresuite_sim/stress/battery.py`; `src/components/sim/StressTestCard.tsx`
(`STRESS_TESTS`) and its two importers; §4 D112 (by `grep -n`); how the engine's frontend
registry generator writes the app's policy registry (the pattern to copy).

**Do.**
1. `suresuite_sim.stress.presets`: the seven presets as data — id, label, target *type*, start,
   duration, magnitude — plus `resolve(preset, project)` that returns events against the
   project's real ids, and raises when the target type cannot reach the engine (N4).
2. Generate the app's preset list from it (`--check` in CI, like the registry); the stress card
   reads the generated list and resolves targets from the open project.
3. `sim.stress(project, "supplier_outage", target="S2")` uses the same presets.
4. The battery (ST-1…ST-7) stays as the research API; document how presets and battery relate.

**Exit.** engine tests · the generator's `--check` · `npm test` and `npm run lint` (UI files
changed — includes `audit:ui`) · D112's preset half closed in `PLAN.md` §4 · engine-ledger ritual.

---

### WP 17.6 — CLI, Excel import, errors that name the cell · M

**Goal.** People who do not write Python can use SuReSuite Sim too.

**Read first.** The `Project` model (17.3); the data contract's table and column names
(`docs/data/tables/*.md`, headers only), so the workbook uses the names users already know.

**Do.**
1. `sim.load("model.xlsx")`: one sheet per table, a `policies` sheet, a `scenarios` sheet.
   `suresuite-sim template model.xlsx` writes an empty workbook generated from the format
   (never hand-made).
2. Validation errors that name the file, sheet, column and row, and say what was expected.
3. CLI (`suresuite-sim` console script): `run`, `stress`, `compare`, `template`, `validate`,
   `info` (prints the engine build). Output to the terminal and to any path given.
4. `openpyxl` as the `excel` extra; the core install stays numpy, scipy, pydantic.

**Exit.** engine tests (CLI tested through `subprocess`) · a workbook round trip · engine-ledger ritual.

---

### WP 17.7 — Documentation site and keyless tutorials · M

**Read first.** The engine's `mkdocs.yml`; `docs/index.md` and `docs/extending.md` in the
engine folder; `scripts/gen_docs.py` there; `notebooks/README.md`.

**Do.**
1. Restructure the engine docs for a newcomer: Install → Quickstart (§1's example) → Tutorials →
   How-to (Excel, CLI, write a policy, reproduce a result) → Reference (generated) → Changelog
   (generated from `CHANGELOG.yaml`). Say on the first page: free, no account, and how it
   relates to the SuReSuite platform and to the SCSIM model.
2. Tutorials are notebooks that use only SuReSuite Sim and the bundled example — no key, no
   platform — executed in CI so they cannot go stale.
3. Remove references to internal platform documents that would dangle in a public repository.
4. Build the site in CI (`mkdocs build --strict`).

**Exit.** `gen_docs.py --check` · `mkdocs build --strict` · tutorials execute in CI.

---

### WP 17.8 — Release readiness: boundary, hygiene, licence, gates · M

**Read first.** `open-access-release-plan.md` §3 (the boundary table) and §5 step 3 (hygiene);
the engine's `pyproject.toml` and `NOTICE.md`.

**Do.**
1. Boundary: move `io/legacy_graph.py` and `scripts/gen_frontend_registry.py` out of the engine
   folder (to `sim-worker/` and the root `scripts/`), keeping the platform working.
   `io/project_map.py` stays as the documented SuReSuite adapter.
2. Hygiene: scan the engine folder's tree and history for secrets, internal URLs, e-mail
   addresses and company data in fixtures; record the result.
3. Licence: `LICENSE` (Apache-2.0); one scripted change replacing the "all rights reserved"
   header line with `SPDX-License-Identifier: Apache-2.0` in every file; `NOTICE`; `CITATION.cff`;
   `CONTRIBUTING.md` (DCO sign-off); complete `pyproject.toml` (licence, authors, URLs, classifiers).
4. Gates in the engine's CI: **import boundary** (no import of `suresuite`, `sim_worker`,
   `supabase`, or a network library); **API surface** (a committed snapshot of the public API;
   a change without a version bump fails); a **clean-venv install** from the built wheel running
   the quickstart.

**Exit.** All three new gates green and each mutation-tested once (break it, see red, restore) ·
engine tests · engine-ledger ritual.

---

### WP 17.9 — Publishing pipeline, dry run to TestPyPI · M

**Needs, 👤 before the session.** PyPI and TestPyPI projects `suresuite-sim`, each with a
*trusted publisher* pointing at this repository's release workflow (no token stored); an empty
public GitHub repository for the mirror and a deploy key for it; the Zenodo GitHub integration
switched on for the mirror.

**Read first.** `.github/workflows/engine-distribution.yml` and `scsim-tests.yml` (renamed in
17.1); `scripts/build_engine_wheels.sh`.

**Do.**
1. A release workflow on a tag `suresuite-sim-v<ENGINE_VERSION>`: run the engine tests and every
   `--check`; build the wheel and sdist **once**; upload those artifacts to the engine archive,
   `public/engine/`, and (TestPyPI | PyPI by input) through trusted publishing.
2. Mirror job: `git subtree split --prefix=suresuite-sim` pushed to the public repository; tag
   there, which lets Zenodo mint the DOI.
3. A check that the PyPI file's sha256 equals the archived build's.
4. Dry run: tag a pre-release (`<version>rc1`) to TestPyPI only; install it in a clean
   environment and run the quickstart.

**Exit.** The dry run green end to end; the hand-off names the exact tag and the TestPyPI URL.

---

### WP 17.10 — First public release; the platform pins it · S

**Needs, 👤.** Approve the release and the version number (N5).

**Do.**
1. Bump to the release version with its CHANGELOG entry; tag; the pipeline publishes to PyPI,
   the mirror and Zenodo.
2. The worker installs the released version and asserts it equals the in-tree source (so a
   platform run names the public version); the reproducibility record carries the DOI.
3. Add the DOI to `CITATION.cff` and the README badge.

**Exit.** `pip install suresuite-sim==<version>` in a clean environment runs the quickstart ·
the worker deploy job green · the build ledger records the released build.

---

### WP 17.11 — `suresuite` 1.0: read-only, on SuReSuite Sim · M

**Needs, 👤.** A PyPI project `suresuite` with a trusted publisher. Register it early: it was
free on 2026-10-08.

**Read first.** `python/suresuite/__init__.py`, `local.py`; `python/README.md`;
`docs/api/python-library.md`; the `python-package` job in `notebooks.yml`.

**Do.**
1. `suresuite` depends on `suresuite-sim>=<release>,<next major>`; its own `Dataset` and
   `Policy` become deprecated aliases of `suresuite_sim.Project`.
2. `ss.pull(api, project, version)` returns a `suresuite_sim.Project`; the existing helpers keep
   working.
3. `install_engine` remains only for installing a past build a result recorded (including
   archived builds still named `scsim`).
4. Version single-sourced (`__version__` read by `pyproject.toml`); `requires-python` equal to
   the engine's.
5. Close §4 D274 (N3): the engine is public, so the API-key gate on it is no longer a boundary.
6. Release `suresuite` 1.0 to PyPI under its proprietary licence; update the user guide.

**Exit.** `python-package` job (clean environment, the example project equals the platform's
recorded run) · notebooks job · `npm run contract:check`.

---

### WP 17.12 — `suresuite` 1.1: `push` through the upload path, with a named actor · L

**Goal.** A subscriber uploads a project file, and the audit trail names who did it.

**Read first.** §4 D28 and D71 (by `grep -n`); the API gateway's principal resolution and its
write handlers (`supabase/functions/api/index.ts`, by section); the ingestion landing and
promotion RPCs named in CLAUDE.md's `no-tier-skip` and `audit-actor` rows; one existing
rehearsal that exercises them (`supabase/rehearsal/070_ingest_file_landing.sql`).

**Do.**
1. Only a **personal** key may write; an organization key names nobody and is refused.
2. `POST …/projects/{id}/uploads` takes a project file and **lands** it (tier 0/1) through the
   existing landing RPC with the key's owner as actor. Promotion stays on the review screen,
   by an editor — external data never skips a tier.
3. Pass the actor and the project-role gate on the API's other writes, including run dispatch
   (`ss.submit`); check how dispatch records its actor today and fix it in the same WP.
4. A rehearsal that uploads as a personal key and reads the audit row back with the actor
   GUC poisoned first; mutation-tested.
5. `ss.push(api, project, proj)` and `ss.submit(…)`; release `suresuite` 1.1.

**Checkpoint.** Items 1–2 with the rehearsal. **Split point**: items 3 and 5 become 17.12b.

**Exit.** `npm run contract:check` · `npm run contract:rehearse` (all three ways) · `npm test` ·
`python-package` job · R17 (the edge function is deployed).

---

## 6. Later — not yet sessions

- **Network-analysis methods into the library** (`open-access-release-plan.md` §3). The methods
  run inside edge functions today; moving them to Python means the platform runs them through the
  worker. Plan it as its own phase once 17.10 has shipped: it is more than one session.
- **Surrogate methods** (`open-access-release-plan.md` §6), after the library is stable.
- **Third-party policy plugins** discovered through Python entry points, once users ask for them.

## 7. Change log of this plan

| Date | Change |
|---|---|
| 2026-10-08 | Written. Decisions L1–L4, N2, N3 recorded; N1 found (`scsim` taken on PyPI) |
| 2026-10-08 | N1 decided: **SuReSuite Sim** (`suresuite-sim` / `suresuite_sim`). New WP 17.1 renames the engine; former 17.1–17.11 renumbered 17.2–17.12. Added N6 (trademark check) and N7 (file extension) |
