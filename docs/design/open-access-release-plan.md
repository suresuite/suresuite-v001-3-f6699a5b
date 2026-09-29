# Open-access release plan — SCSIM simulation library and stress-test framework

> **Status: AUTHORED — draft, decisions open.** Companion to
> [`next-gen-platform-design.md`](next-gen-platform-design.md) (§3 one engine, §11
> stress testing and surrogates, §14 open question 6). Copyright and licensing
> statements live in [`/COPYRIGHT.md`](../../COPYRIGHT.md) and
> [`/scsim/NOTICE.md`](../../scsim/NOTICE.md); this document is the plan for getting
> the open-access part public.

## 1. What is being released, and why

Two results of the Horizon Europe project ACCURATE (GA 101138269) are to be released
publicly as open access:

1. **The supply chain simulation library** — `scsim`.
2. **The supply chain stress-test framework** — `scsim.stress` with the disruption
   injector (`scsim.disruption`) and the resilience KPIs (`scsim.kpi`).

The full SuReSuite software remains part of the PhD thesis of Phu Nguyen and is not
released. The release must satisfy the project's open-science and dissemination
obligations (to be confirmed against the Grant Agreement and the ACCURATE Consortium
Agreement — see §6).

## 2. The governing rule: one engine, published — never forked

The public library **is** the engine SuReSuite runs (blueprint §3, "scsim is the
strategic engine"). A separate public copy would drift within months, and then the
thesis, the papers and the platform would each describe a different engine. So:

- The public repository is **cut from `scsim/` in this repository** (a `git subtree
  split` of the directory, or an equivalent mirror job), never edited on its own.
  Outside contributions are merged back here first.
- A public release is a **tag on `ENGINE_VERSION`** (`scsim/scsim/__init__.py`). The
  platform's worker pins the same released version, and the reproducibility record
  (blueprint §8.4, invariant I8) already binds the engine version to every result — so a
  figure produced in SuReSuite names the public version that produced it.
- Anything the platform needs that the public library must not contain lives **outside
  `scsim/`** (in `sim-worker/` or `supabase/`), not behind a flag inside it.

## 3. The release boundary

| Area | In the public release | Note |
|---|---|---|
| `scsim/core`, `entities`, `policies`, `stats`, `synergy` | yes | the engine proper |
| `scsim/disruption`, `kpi`, `stress` | yes | the stress-test framework |
| `scsim/io/registry_export.py`, `traces.py`, `snapshots.py` | yes | generic I/O |
| `scsim/io/project_map.py` | **decide** | maps a SuReSuite project to a `Scenario`; imports nothing from the platform, but its semantics follow the platform's data contract. Either keep it as a documented "SuReSuite adapter" or move it to `sim-worker/` |
| `scsim/io/legacy_graph.py` | **decide** | adapter for the frozen legacy worker graph; likely moves out or is dropped when the legacy engine retires |
| `scsim/tests` | yes, after review | golden traces and tests must contain no company data (§5 step 3) |
| `scsim/docs`, `mkdocs.yml`, `scripts/gen_docs.py` | yes | the generated reference ships as-is |
| `scsim/scripts/gen_frontend_registry.py` | **decide** | writes into the platform frontend; probably moves out |
| Everything outside `scsim/` | no | web app, Supabase, worker, data contract, project data |

## 4. Decisions to take before anything is published

| # | Decision | Owner | Recommendation / note |
|---|---|---|---|
| L1 | **Open-access licence** | Phu Nguyen with HWR Berlin and the ACCURATE coordinator | A permissive licence with a patent grant (Apache-2.0) is the common choice for EU research software and allows reuse by consortium partners and industry; a copyleft licence (GPL-3.0 / EUPL-1.2) keeps derivatives open. Must be compatible with the Consortium Agreement's rules on results |
| L2 | **Rights holder** | HWR Berlin (legal / tech transfer) | Software written in employment can carry exploitation rights for the employer; confirm who grants the licence and whether the copyright line needs "and HWR Berlin" |
| L3 | **Consortium clearance** | ACCURATE coordinator | Confirm no partner background IP or partner data is inside `scsim/` and that dissemination of these results is notified as the Consortium Agreement requires |
| L4 | Public name and home | Phu Nguyen | e.g. `scsim` on GitHub under a lab / project organisation, PyPI package name availability |
| L5 | Boundary rows marked **decide** in §3 | Phu Nguyen | — |
| L6 | Thesis citation text | Phu Nguyen | Added to `scsim/NOTICE.md` and `CITATION.cff` on publication |

## 5. Steps

1. **Decide L1–L6.** Nothing below starts until L1–L3 are answered in writing.
2. **Settle the boundary.** Move or drop the §3 **decide** rows so that `scsim/` contains
   only what ships. The platform keeps working because it imports the moved adapters from
   their new home; engine tests stay green.
3. **Hygiene pass on `scsim/`.** Scan history and tree for secrets, internal URLs and
   e-mail addresses; confirm every test fixture and golden trace is synthetic (no
   company workbook data); remove references to internal platform documents from
   public docstrings where they would dangle.
4. **Release files.** Add `LICENSE`; replace the "all rights reserved until release"
   line in every source-file header with the SPDX identifier (one scripted change);
   add `CITATION.cff`, `CONTRIBUTING.md`, the EU funding acknowledgement and emblem in
   the README; complete `pyproject.toml` metadata (`license`, `authors`, `urls`,
   classifiers).
5. **Publishing pipeline.** A CI workflow in this repository that, on a `scsim-v*` tag,
   runs the engine tests and `gen_docs.py --check`, splits `scsim/` to the public
   repository, builds and uploads to PyPI, and archives the release on Zenodo for a
   DOI (Horizon Europe open science expects deposit in a trusted repository).
6. **Align the platform.** `sim-worker` installs the released `scsim` version instead
   of the in-tree path, or asserts they are identical; the reproducibility record
   names the public version and DOI.
7. **First public release**, announced through the ACCURATE dissemination channels and
   cited in the thesis.

## 6. Later: the surrogate model

After the library is public and stable, the adaptive simulation–surrogate framework
(blueprint §11, gap G12) is built. The same rule applies: the **method** — surrogate
training, uncertainty calibration, adaptive sampling against the stress batteries —
belongs in the library (as `scsim.surrogate` or a sibling package released under the
same licence), so the public stress-test framework and the platform share it. **Trained
models and the data they are trained on stay private** when they come from a customer
or project network; only models trained on synthetic benchmark networks may be
published with the paper they support.

## 7. Open points to verify

- The exact open-science and software-dissemination clauses of Grant Agreement
  101138269 and the ACCURATE Consortium Agreement (licence constraints, notification
  periods, acknowledgement wording).
- Whether the thesis examination regulations require a frozen version of the software;
  if so, the release tag at submission is that version.
