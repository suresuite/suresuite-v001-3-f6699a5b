# Python library plan — free `scsim`, paid `suresuite`, one engine

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

> Do WP 17.n of `docs/design/python-library-plan.md`. Read §0–§3 of that plan and the WP 17.n
> section only, then the files the WP lists under *Read first*. Do not read the whole of
> `docs/PLAN.md`; open only the sections the WP names. Work on a new branch, end with the
> WP's exit checks green, a §16 drift-log entry, and this plan's status table updated.

**The session budget, in practice.** A session runs out of context, not time. To stay at 80 %:

| Rule | Why |
|---|---|
| Read only the WP's *Read first* list in full; open other files by section (`grep -n`, then a range) | `PLAN.md` alone is 27 000 lines and `project_map.py` 3 600 — reading either whole costs a large share of a session |
| At most ~25 hand-written files changed (generated files excluded) | Above this, review and CI repair no longer fit |
| Check progress at the WP's **checkpoint**. If the checkpoint is not reached by about half of the session, stop at the named **split point**, push, and write the hand-off note | A half-finished WP that is pushed and described is recoverable; one that runs out of context is not |
| Delegate wide searches to a sub-agent and keep only its conclusion | Keeps file dumps out of the main context |
| Run the fast checks locally before every push; one validated push beats three speculative ones | Each red CI round costs ~5–10 % of a session |

**Fixed costs every session pays** (already counted in each WP's size):

- **The engine-ledger ritual** (CLAUDE.md, gate `engine-ledger`): any change under `scsim/scsim/`
  or the worker's compute path needs a `scsim/CHANGELOG.yaml` amendment or version bump,
  rebuilt engine wheels (`scripts/build_engine_wheels.sh`), and a regenerated release report.
  Budget ~10 % of a session for it.
- **After a base merge**: `npm run contract:check` and `npm test` before anything else.
- **Closing the WP**: a `PLAN.md` §16 drift-log entry, the status table in §3 below, and the
  commit convention `Phase 17 / WP 17.n / <blueprint ref>: <title>`.

**Owner steps (👤)** are things a session cannot do — accounts, secrets, legal text, merges.
They are listed per WP. A WP whose owner step is not done stops at that step and says so.

---

## 1. What we are building

| | **`scsim`** — free, open source | **`suresuite`** — for subscribers |
|---|---|---|
| Who | Anyone. No account, no key, works offline | Paying customers with a SuReSuite subscription |
| Like | SimPy: `pip install`, run on your machine, save results anywhere | A thin client to a hosted service |
| Contains | The engine, all policies, disruptions, stress presets, KPIs, statistics, the project file format, a CLI, examples. Later the network-analysis and surrogate **methods** | Pull and push platform projects, cloud runs, platform helpers. Depends on `scsim`; contains no engine code |
| Licence | Apache-2.0 (decided 2026-10-08) | Proprietary; the API key gates the service, not the code |
| Where | PyPI, a public read-only GitHub mirror, Zenodo DOI per release | PyPI |

**The paid value is the service**: hosted and versioned data, collaboration and roles, the audit
trail, review screens, cloud scale, the web UI, ERP connectors, AI agents, and models trained on
customer data. The methods stay free (Horizon Europe open science, `open-access-release-plan.md` §1).

### What a free user does

```python
pip install scsim            # final PyPI name: see decision N1

import scsim
proj  = scsim.load("my_chain/")                # a folder, a .scsim file, or an .xlsx workbook
res   = scsim.run(proj, replications=30)
shock = scsim.stress(proj, "supplier_outage", target="S2", duration_days=42)
scsim.compare(res, shock).to_excel("anywhere/report.xlsx")
proj.save("anywhere/my_chain.scsim")           # later: upload this same file to SuReSuite
```

Three levels, like SimPy: **files in, results out** (or `scsim run my_chain/ --stress supplier_outage`);
**build in code** (`Network`, `Supplier`, `Product`, `Scenario`); **extend** (your own policy
through the plugin registry, your own KPIs).

---

## 2. The rules that keep one source of truth

1. **One direction of dependency.** `suresuite` depends on `scsim`. `scsim` never imports
   `suresuite`, `sim_worker`, or anything platform-side, and never opens a network connection.
   Gated in WP 17.7.
2. **One engine.** The public package *is* the engine the platform runs. The public repository
   is a mirror cut from `scsim/` in this repository and never edited on its own; outside
   contributions are merged here first.
3. **One version.** `ENGINE_VERSION` is the package version (already true). `suresuite`'s
   version is one dynamic attribute (WP 17.10).
4. **One project format, defined by `scsim`.** The platform exports and imports it; it does not
   define a second one. The format is the frozen snapshot the platform already serves
   (a dataset version plus a policy version), formalized and versioned.
5. **Build once, publish the same bytes everywhere.** One tag builds one wheel; PyPI, the engine
   archive, the browser engine and Zenodo all receive those bytes, so the archived sha256 is the
   PyPI sha256.
6. **Generated, never copied.** Every fact the app or the client needs from the engine is
   generated from the engine:

| Fact | Authored once in | Generated into |
|---|---|---|
| Engine version and changes | `ENGINE_VERSION`, `scsim/CHANGELOG.yaml` | PyPI page, GitHub release, /docs, Zenodo |
| Project file format | `scsim` Pydantic models (WP 17.2) | JSON Schema, templates, platform import and export |
| Policy schemas | `scsim/io/registry_export.py` | engine docs, the app's TypeScript registry |
| Stress presets | `scsim.stress.presets` (WP 17.4) | the app's stress-test list |
| KPI definitions | `scsim.kpi` (WP 17.3) | `suresuite` display helpers, notebook labels |
| Public API surface | `scsim.__all__` (WP 17.3) | API snapshot gate (WP 17.7), reference docs |

---

## 3. Status and sequence

| WP | Title | Size | Depends on | Owner step | Status |
|---|---|---|---|---|---|
| 17.0 | Wire the plan in, record the decisions | S | — | — | ⬜ |
| 17.1 | Move the run-from-snapshot adapter into `scsim` | L | 17.0 | — | ⬜ |
| 17.2 | Project file format v1 and the bundled example | M | 17.1 | — | ⬜ |
| 17.3 | The front door: `load` · `run` · `stress` · `compare` · `reproduce` | L | 17.2 | — | ⬜ |
| 17.4 | Stress presets authored once in `scsim` | M | 17.1 | product call on D112 targets (§4) | ⬜ |
| 17.5 | CLI, Excel import, errors that name the cell | M | 17.3 | — | ⬜ |
| 17.6 | Documentation site and keyless tutorials | M | 17.3 | — | ⬜ |
| 17.7 | Release readiness: boundary, hygiene, licence, gates | M | 17.3 · N1 decided | 👤 N1 | ⬜ |
| 17.8 | Publishing pipeline, dry run to TestPyPI | M | 17.7 | 👤 PyPI, GitHub, Zenodo | ⬜ |
| 17.9 | First public release; the platform pins it | S | 17.8 | 👤 approve release | ⬜ |
| 17.10 | `suresuite` 1.0 — read-only, on `scsim` | M | 17.9 | 👤 PyPI project | ⬜ |
| 17.11 | `suresuite` 1.1 — `push` through the upload path, named actor | L | 17.10 | — | ⬜ |

**Critical path**: 17.0 → 17.1 → 17.2 → 17.3 → 17.7 → 17.8 → 17.9 → 17.10 → 17.11 (nine sessions).
**Can run in parallel** on separate branches once their dependency has merged: 17.4 (after 17.1);
17.5 and 17.6 (after 17.3). Merge `main` before pushing each — they touch neighbouring files.

Sizes: **S** ≈ 30–40 % of a session, **M** ≈ 50–65 %, **L** ≈ 70–80 % with a named split point.

---

## 4. Decisions

| # | Decision | State |
|---|---|---|
| L1 | Code licence | **Apache-2.0** — decided 2026-10-08. Documentation and synthetic benchmark data CC BY 4.0. Contributions by DCO sign-off; no CLA needed because the licence is permissive |
| L2 / L3 | Rights holder; consortium clearance | **Phu Nguyen holds the rights** — owner statement 2026-10-08. The Horizon Europe open-science clauses (`open-access-release-plan.md` §7) still decide what must be open; this plan keeps every method open, so it satisfies them either way |
| L4 | Public name | **`scsim` for now** — owner, 2026-10-08. See N1 |
| **N1** | **PyPI name** — **open, due before WP 17.6** | **`scsim` is already taken on PyPI** (a single-cell DNA sequencing simulator, release 1.0.0, uploaded 2025-11-22; checked 2026-10-08). A name can only be transferred from an abandoned project (PEP 541), and this one is not. Options: (a) a different distribution name, keeping `import scsim` — e.g. `scsim-supplychain` (free on 2026-10-08) — cheap, but anyone who has both installed gets one `scsim` overwriting the other; (b) rename the import as well to a free name — clean, but every import in the worker, browser, notebooks and docs changes, so it must happen before the first public release and is easiest in WP 17.7. **Recommendation: (b) if a good name is found, otherwise (a).** Docs written in WP 17.6 use the chosen name |
| N2 | `suresuite.push` waits for the named actor | **Yes** — decided 2026-10-08. 1.0 is read-only; `push` ships in 1.1 (WP 17.11) |
| N3 | The engine is public | Follows from L1. Reverses Phase 12's "engine gated by API key" and settles §4 D274 — recorded in WP 17.0, closed in WP 17.10 |
| N4 | Stress preset targets (D112) | **Open — needed by WP 17.4.** Recommended: presets name a target *type* (a supplier, the plant) and resolve to the project's real ids when the preset is applied, refusing a type the mapper cannot reach rather than dropping it |
| N5 | First public version number | Recommended **1.0.0** at WP 17.9: it promises the public API frozen in 17.3/17.7. A bump with no moved golden digest is allowed by the engine ledger as "identical" |

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
   pointer to this plan (one source for the steps); add N1 to its open points.
2. `PLAN.md`: add a short §27 "Phase 17 — the Python libraries" that points here, a row in §17's
   sequencing table, and a §16 entry. Note on D274 that WP 17.10 closes it by making the engine
   public (N3). Note on D112 that WP 17.4 owns the preset half.
3. `scsim/NOTICE.md`: rights holder and intended licence as decided (the `LICENSE` file itself
   lands in WP 17.7).

**Don't.** Change any code.

**Exit.** `npm run check:docs` · `npm run contract:check` (R7, R8, R10 read these sections).

---

### WP 17.1 — Move the run-from-snapshot adapter into `scsim` · L

**Goal.** A user can run a simulation from a frozen snapshot with `scsim` alone. Today that path
runs through the platform's worker package, so a local run needs `sim_worker` installed.

**Read first.** `sim-worker/sim_worker/local.py` (153 lines) and the modules it imports:
`datamap.py`, `policy_snapshot.py`, `engine_input.py`, `scsim_bridge.py`, `run_shape.py`,
`series_store.py`; `sim_worker/build.py` (`COMPUTE_MODULES`); `python/suresuite/local.py`;
`scripts/build_engine_wheels.sh`.

**Do.**
1. **The rule for what moves: what decides a number moves; what shapes a platform database row
   stays.** Expect `datamap`, `policy_snapshot`, `engine_input` and the compute half of
   `scsim_bridge` to move into `scsim` (e.g. `scsim/io/snapshot.py` plus a `scsim.run_snapshot`
   entry point). Expect `run_shape` and `series_store` to stay in `sim_worker`. Record the
   final split in the drift entry.
2. `sim_worker.local` keeps its public function signatures and calls the moved code, so the
   worker, the browser engine and `suresuite` keep working unchanged this WP.
3. Update the build identity: the hashed source set (`COMPUTE_MODULES` plus scsim's own source)
   must still be exactly what a run loads (`test_engine_build.py`).
4. Engine-ledger ritual: no behaviour change, so the golden digests must not move; append a
   CHANGELOG amendment; rebuild the wheels; regenerate the release report.

**Checkpoint.** Moved modules import from `scsim` and the worker's own tests pass.
**Split point** if over budget: push the move with `sim_worker` shims; leave the build-identity
update for a 17.1b session (CI will say which rule fails — name it in the hand-off).

**Exit.** `scsim` tests · `sim-worker` tests (worker == local == browser) · golden digests
unchanged · `build_engine_wheels.sh --check` · `engine_changelog.py check --base auto` ·
`release_report.py --check` · `notebooks.yml`'s package job.

---

### WP 17.2 — Project file format v1 and the bundled example · M

**Goal.** A project is a file a user can keep anywhere, and the same file the platform exports.

**Read first.** The moved snapshot module from 17.1; `scripts/example_project/dataset.json` (by
its keys, not in full); `scsim/scsim/entities/scenario.py`; the policy-version shape in
`python/suresuite/local.py`.

**Do.**
1. `scsim.Project` (Pydantic): `tables` (the dataset snapshot), `policies`, `scenarios`, and a
   manifest — `format_version`, the engine version that wrote it, a content hash.
2. Two on-disk forms with one reader: a folder (`project.json`, `tables/*.csv`, `policies.json`,
   `scenarios.json` — friendly to Git and Excel) and a single `.scsim` zip of the same layout.
   Parquet tables when `pyarrow` is installed, CSV otherwise.
3. Generate the JSON Schema from the models (`scsim/scripts/gen_project_schema.py`, with `--check`
   in `scsim-tests.yml`).
4. `scsim.examples.load("example")`: the Example project, shipped in the wheel. **Confirm it is
   synthetic first** (no company data) and say so in the drift entry.
5. Round-trip test: example snapshot → `Project` → folder → zip → `Project`, byte-equal tables,
   and the same simulation digest as the platform's recorded run of the same inputs.

**Don't.** Build the friendly API (17.3) or the platform's import and export (17.10).

**Exit.** `scsim` tests including the round trip · schema `--check` · engine-ledger ritual.

---

### WP 17.3 — The front door: `load` · `run` · `stress` · `compare` · `reproduce` · L

**Goal.** The five-line example in §1 works, and the public API is declared.

**Read first.** `scsim/scsim/__init__.py`; `scsim/scsim/core/engine.py` (entry points only);
`scsim/scsim/kpi/` (module list); `python/suresuite/client.py` (`kpi_table`, `paired_compare` —
the helpers users already know); `python/suresuite/kpi_display.py` and its generator in
`scripts/notebooks/build-notebooks.mjs`.

**Do.**
1. `scsim.load(path)` (folder, `.scsim`; `.xlsx` arrives in 17.5) and `Project.save(path)`.
2. `scsim.run(project, scenario=None, replications=…, seed=…)` → `Result`.
3. `scsim.stress(project, preset_or_events, **target)` — accepts explicit `DisruptionEvent`s now;
   named presets plug in when 17.4 lands.
4. `Result`: `.kpis` (DataFrame when pandas is installed, dict otherwise), `.replications`,
   `.series`, `.to_excel()`, `.to_csv()`, `.save()`; every saved result embeds its
   reproducibility record (engine build, seed, project content hash, scenario).
5. `scsim.compare(a, b)` — the paired comparison the notebooks use; `scsim.reproduce(result_file)`.
6. KPI definitions (names, labels, units, direction) authored in `scsim.kpi`; `suresuite`'s
   `kpi_display` generated from them.
7. Declare `scsim.__all__`; add `py.typed`; anything not in `__all__` is private.

**Checkpoint.** Items 1–4 with tests. **Split point**: items 5–7 become 17.3b.

**Exit.** `scsim` tests (a test runs §1's example verbatim against the bundled example) ·
notebooks still build (`build-notebooks.mjs --check`) · `python-package` job · engine-ledger ritual.

---

### WP 17.4 — Stress presets authored once in `scsim` · M

**Goal.** "Stress test" means one thing. Today the library's battery and the app's seven presets
are two different definitions, and six of the seven presets reach no real target (§4 D111, D112).

**Needs.** Decision N4.

**Read first.** `scsim/scsim/stress/battery.py`; `src/components/sim/StressTestCard.tsx`
(`STRESS_TESTS`) and its two importers; §4 D112 (by `grep -n`); how `scsim/scripts/gen_frontend_registry.py`
generates the app's policy registry (the pattern to copy).

**Do.**
1. `scsim.stress.presets`: the seven presets as data — id, label, target *type*, start, duration,
   magnitude — plus `resolve(preset, project)` that returns events against the project's real
   ids, and raises when the target type cannot reach the engine (N4).
2. Generate the app's preset list from it (`--check` in CI, like the registry); the stress card
   reads the generated list and resolves targets from the open project.
3. `scsim.stress(project, "supplier_outage", target="S2")` uses the same presets.
4. The battery (ST-1…ST-7) stays as the research API; document how presets and battery relate.

**Exit.** `scsim` tests · the generator's `--check` · `npm test` and `npm run lint` (UI files
changed — includes `audit:ui`) · D112's preset half closed in `PLAN.md` §4 · engine-ledger ritual.

---

### WP 17.5 — CLI, Excel import, errors that name the cell · M

**Goal.** People who do not write Python can use `scsim` too.

**Read first.** The `Project` model (17.2); the data contract's CSV templates — table and column
names only (`docs/data/tables/*.md` headers), so the workbook uses the names users already know.

**Do.**
1. `scsim.load("model.xlsx")`: one sheet per table, a `policies` sheet, a `scenarios` sheet.
   `scsim template model.xlsx` writes an empty workbook generated from the format (never hand-made).
2. Validation errors that name the file, sheet, column and row, and say what was expected.
3. CLI (`scsim` console script): `run`, `stress`, `compare`, `template`, `validate`, `info`
   (prints the engine build). Output to the terminal and to any path given.
4. `openpyxl` as the `excel` extra; the core install stays numpy, scipy, pydantic.

**Exit.** `scsim` tests (CLI tested through `subprocess`) · a workbook round trip · engine-ledger ritual.

---

### WP 17.6 — Documentation site and keyless tutorials · M

**Needs.** N1 decided, so the docs use the final name.

**Read first.** `scsim/mkdocs.yml`; `scsim/docs/index.md`, `extending.md`; `scsim/scripts/gen_docs.py`;
`notebooks/README.md`.

**Do.**
1. Restructure the engine docs for a newcomer: Install → Quickstart (§1's example) → Tutorials →
   How-to (Excel, CLI, write a policy, reproduce a result) → Reference (generated) → Changelog
   (generated from `CHANGELOG.yaml`).
2. Tutorials are notebooks that use only `scsim` and the bundled example — no key, no platform —
   executed in CI so they cannot go stale.
3. Remove references to internal platform documents that would dangle in a public repository.
4. Build the site in CI (`mkdocs build --strict`).

**Exit.** `gen_docs.py --check` · `mkdocs build --strict` · tutorials execute in CI.

---

### WP 17.7 — Release readiness: boundary, hygiene, licence, gates · M

**Needs.** 👤 N1 decided. If the import name changes, the rename happens here, first, as its
own commit.

**Read first.** `open-access-release-plan.md` §3 (the boundary table) and §5 step 3 (hygiene);
`scsim/pyproject.toml`; `scsim/NOTICE.md`.

**Do.**
1. Boundary: move `scsim/io/legacy_graph.py` and `scsim/scripts/gen_frontend_registry.py` out of
   `scsim/` (to `sim-worker/` and `scripts/`), keeping the platform working. `project_map.py`
   stays as the documented SuReSuite adapter.
2. Hygiene: scan `scsim/` tree and history for secrets, internal URLs, e-mail addresses and
   company data in fixtures; record the result.
3. Licence: `scsim/LICENSE` (Apache-2.0); one scripted change replacing the "all rights reserved"
   header line with `SPDX-License-Identifier: Apache-2.0` in every file; `NOTICE`; `CITATION.cff`;
   `CONTRIBUTING.md` (DCO sign-off); complete `pyproject.toml` (licence, authors, URLs, classifiers).
4. Gates in `scsim-tests.yml`: **import boundary** (no import of `suresuite`, `sim_worker`,
   `supabase`, or a network library from `scsim`); **API surface** (a committed snapshot of the
   public API; a change without a version bump fails); a **clean-venv install** from the built
   wheel running the quickstart.

**Exit.** All three new gates green and each mutation-tested once (break it, see red, restore) ·
`scsim` tests · engine-ledger ritual.

---

### WP 17.8 — Publishing pipeline, dry run to TestPyPI · M

**Needs, 👤 before the session.** A PyPI and a TestPyPI project under the N1 name, each with a
*trusted publisher* pointing at this repository's release workflow (no token stored); an empty
public GitHub repository for the mirror and a deploy key for it; the Zenodo GitHub integration
switched on for the mirror.

**Read first.** `.github/workflows/engine-distribution.yml` and `scsim-tests.yml`;
`scripts/build_engine_wheels.sh`.

**Do.**
1. `scsim-release.yml`, on a tag `scsim-v<ENGINE_VERSION>`: run the engine tests and every
   `--check`; build the wheel and sdist **once**; upload those artifacts to the engine archive,
   `public/engine/`, and (TestPyPI | PyPI by input) through trusted publishing.
2. Mirror job: `git subtree split --prefix=scsim` pushed to the public repository; tag there,
   which lets Zenodo mint the DOI.
3. A check that the PyPI file's sha256 equals the archived build's.
4. Dry run: tag a pre-release (`<version>rc1`) to TestPyPI only; install it in a clean
   environment and run the quickstart.

**Exit.** The dry run green end to end; the hand-off names the exact tag and the TestPyPI URL.

---

### WP 17.9 — First public release; the platform pins it · S

**Needs, 👤.** Approve the release and the version number (N5).

**Do.**
1. Bump to the release version with its CHANGELOG entry; tag; the pipeline publishes to PyPI,
   the mirror and Zenodo.
2. The worker installs the released version and asserts it equals the in-tree source (so a
   platform run names the public version); the reproducibility record carries the DOI.
3. Add the DOI to `CITATION.cff` and the README badge.

**Exit.** `pip install <name>==<version>` in a clean environment runs the quickstart · the worker
deploy job green · the build ledger records the released build.

---

### WP 17.10 — `suresuite` 1.0: read-only, on `scsim` · M

**Needs, 👤.** A PyPI project `suresuite` (free on 2026-10-08 — register it early) with a
trusted publisher.

**Read first.** `python/suresuite/__init__.py`, `local.py`; `python/README.md`;
`docs/api/python-library.md`; the `python-package` job in `notebooks.yml`.

**Do.**
1. `suresuite` depends on `<scsim name>>=<release>,<next major>`; its own `Dataset` and `Policy`
   become deprecated aliases of `scsim.Project`.
2. `ss.pull(api, project, version)` returns a `scsim.Project`; the existing helpers keep working.
3. `install_engine` remains only for installing a past build a result recorded.
4. Version single-sourced (`__version__` read by `pyproject.toml`); `requires-python` equal to
   `scsim`'s.
5. Close §4 D274 (N3): the engine is public, so the API-key gate on it is no longer a boundary.
6. Release `suresuite` 1.0 to PyPI under its proprietary licence; update the user guide.

**Exit.** `python-package` job (clean environment, the example project equals the platform's
recorded run) · notebooks job · `npm run contract:check`.

---

### WP 17.11 — `suresuite` 1.1: `push` through the upload path, with a named actor · L

**Goal.** A subscriber uploads a `.scsim` project, and the audit trail names who did it.

**Read first.** §4 D28 and D71 (by `grep -n`); the API gateway's principal resolution and its
write handlers (`supabase/functions/api/index.ts`, by section); the ingestion landing and
promotion RPCs named in CLAUDE.md's `no-tier-skip` and `audit-actor` rows; one existing
rehearsal that exercises them (`supabase/rehearsal/070`).

**Do.**
1. Only a **personal** key may write; an organization key names nobody and is refused.
2. `POST …/projects/{id}/uploads` takes a `.scsim` file and **lands** it (tier 0/1) through the
   existing landing RPC with the key's owner as actor. Promotion stays on the review screen,
   by an editor — external data never skips a tier.
3. Pass the actor and the project-role gate on the API's other writes, including run dispatch
   (`ss.submit`); check how dispatch records its actor today and fix it in the same WP.
4. A rehearsal that uploads as a personal key and reads the audit row back with the actor
   GUC poisoned first; mutation-tested.
5. `ss.push(api, project, proj)` and `ss.submit(…)`; release `suresuite` 1.1.

**Checkpoint.** Items 1–2 with the rehearsal. **Split point**: items 3 and 5 become 17.11b.

**Exit.** `npm run contract:check` · `npm run contract:rehearse` (all three ways) · `npm test` ·
`python-package` job · R17 (the edge function is deployed).

---

## 6. Later — not yet sessions

- **Network-analysis methods into the library** (`open-access-release-plan.md` §3). The methods
  run inside edge functions today; moving them to Python means the platform runs them through the
  worker. Plan it as its own phase once 17.9 has shipped: it is more than one session.
- **Surrogate methods** (`open-access-release-plan.md` §6), after the library is stable.
- **Third-party policy plugins** discovered through Python entry points, once users ask for them.

## 7. Change log of this plan

| Date | Change |
|---|---|
| 2026-10-08 | Written. Decisions L1–L4, N2, N3 recorded; N1 found (`scsim` taken on PyPI) |
