# Project TRON - ver2 — implementation record

> The first **real-project onboarding** on the platform: the make-to-order supply
> chain from the WSC 2026 paper (*Detailed Simulation Model: Supplementary Material
> for WSC 2026*, Nguyen & Ivanov), built from the company workbook
> `SC_data__MOR.xlsx` and validated against the paper's reference snapshot
> (`seed0.npz`). This document records what was implemented, every assumption made,
> and what the process taught us. The **generalized, reusable workflow** distilled
> from it lives in `docs/project-onboarding-guide.md`; the AI-assisted modeling
> workflow it seeds lives in `docs/ai-modeling-workflow.md`.

## 1. The model

| Dimension | Value | Source |
|---|---|---|
| Products | 17 (MTO) | ProductDT ∩ reference snapshot |
| Materials | 560 | BOM of the 17 products, sentinel-LT materials removed |
| Suppliers | 60 | suppliers referenced by the selected sourcing arcs |
| BOM arcs | 596 | BOMDT, zero-rate rows dropped |
| Sourcing | single source per material (MOR-flagged arc, else lowest cost) | sourcingDT |
| Inventory control | min-max (s, S): s = lead-time demand, S = s + κ·weekly demand, κ = 8 wks | PDF Eqs. 2–4 = the engine's coverage-based min_max |
| Safety stock | none beyond lead-time cover (`fixed_days`, 0 days) | PDF Eqs. 2–3 |
| Unmet demand | lost sales | PDF Fig. 3 reports lost sales (EUR) |
| Demand | Triangular(a, b, c) per product/week: b = median of non-zero weekly history, c = historical max, a = max{0, 0.7·b} | PDF Table 1 note, ν = 0.30 |
| Horizon / reps | 156 weeks × 30 replications, CRN | PDF Table 2 |
| Warm-up | auto (MSER-5 + Conway, most conservative) | PDF §1 uses exactly this procedure |
| Holding cost | 20 % of material cost / yr | PDF Table 2 |

Scenarios seeded: **TRON baseline (WSC 2026)** and **TRON supplier 965
disruption** (8-week inbound delay at the paper's top-impact supplier).

## 2. Where everything lives

| Artifact | Path |
|---|---|
| Dataset generator (workbook → JSON, rules R1–R10) | `scripts/tron_ver2/build_dataset.py` |
| Committed dataset | `scripts/tron_ver2/dataset.json` |
| App-lifecycle seeder | `scripts/seed_project_tron_ver2.mjs` |
| Git-native seed + verify workflow | `.github/workflows/seed-project.yml` + `.github/seed-request` |
| Engine extension (demand bounds) | migration `20260712000001_product_demand_bounds.sql`, `scsim/scsim/io/project_map.py`, `sim-worker/sim_worker/datamap.py` |
| Contract updates | `docs/data-simulation-mapping.md` §4/§5 |

## 3. Implementation process (what actually happened)

1. **Read the governing docs first** — `docs/design/next-gen-platform-design.md`
   (§2.3 gaps, §8 data contract), `docs/data-simulation-mapping.md`,
   `docs/simulation-data-lifecycle.md`, and the prior seed
   `scripts/seed_example_project.mjs`. The example seeder *is* the onboarding
   template: it drives the exact RPC lifecycle the app's DataManager uses.
2. **Profiled the workbook against the reference snapshot** before writing any
   code: sheet inventory, per-product demand statistics, BOM coverage,
   sourcing-arc hygiene. The snapshot (17 products × 560 materials ×
   1200-week demand sample) is the ground truth the derivation rules were
   reverse-engineered against — e.g. the triangular mean
   (a + b + c)/3 of each product reproduces the snapshot's sampled mean.
3. **Mapped the methodology onto the engine.** scsim implements the paper's
   equations phase-by-phase (Eqs. 1–12 are cited in
   `scsim/scsim/core/phases.py`), so fidelity reduced to data + policy
   configuration — with one true gap (demand bounds, §5 below).
4. **Built a reproducible dataset generator** with explicit, audited rules
   (R1–R10 in the generator docstring) and a built-in cross-check against the
   snapshot. The committed `dataset.json` is the only input the seeder reads.
5. **Ran the model locally through the canonical worker path**
   (`build_project_data` → `from_project_data` → `compute_run_from_project`)
   *before* touching the deployed system: 30 reps × 156 weeks in ~4 s,
   steady-state fill rate 0.981, **zero warn-level mapping entries**; the
   supplier-965 stress test dropped fill rate to 0.961 (+125 k€ lost sales,
   TTR 8.5 wks) — the same magnitude as the paper's Fig. 3.
6. **Seeded through the app's own lifecycle** (RPCs, not SQL) via the
   git-native workflow, then verified end-to-end on the deployed pipeline
   (sim-command gate → Upstash → Fly worker → realtime → policy-hash and
   mapping-warning fidelity checks) with `scripts/verify_sim_e2e.mjs`.

## 4. Assumptions (each traceable to a rule in the generator)

| # | Assumption | Basis |
|---|---|---|
| R1 | Products `597-1557LC001-TEST` and `XPF0003892` excluded | test article; excluded from the reference snapshot (its demand history is extremely lumpy) |
| R2 | Demand mode = median of **non-zero** weekly history | reproduces the snapshot's sampled means exactly |
| R3 | Single sourcing: MOR-flagged arc wins, else lowest cost | the workbook *is* the "MOR" model; PDF supplier-selection rule = engine primary-source rule (min cost) |
| R4 | Arcs with LT ≥ 100 wks dropped (workbook's 143-wk placeholder); their 6 materials removed from BOM+masters | matches the reference snapshot's material set exactly |
| R4b | One lead time clamped 63 → 51 wks (`DA008634487`) | engine max lead time (52-wk visibility horizon) |
| R5 | Three zero-cost arcs floored at 0.0001 €/unit | engine rejects non-positive costs (would default to 1.0 with a warning) |
| R6 | Three zero-rate BOM rows dropped; their materials stay in the masters | engine requires rate > 0; keeps the 560-material world of the snapshot |
| R7 | `materials.moq` = selected arc's MOQ | MOQ is per-arc in the workbook, per-material in the master; only the selected arc is ordered from under single sourcing |
| R8 | `production_capacity` = historical demand max per product | the PDF's fill-rate losses come from material availability; capacity must not bind below the demand peak |
| R9 | One aggregate customer (`CUST-TRON`) per product | workbook has no customer dimension; engine's P-C.2 allocation is inert below 2 customers |
| R10 | Supplier capacity unlimited, reliability 1.0 | the PDF models supplier disruption as lead-time delay, not capacity |
| — | `initial_on_hand` left NULL → engine warm-starts at S_m | snapshot's t=0 inventories are all non-zero (warm start); the engine's warm start is its deterministic equivalent |
| — | Disruption start = week 12 (t_w + 2), not the paper's week 86 | this engine warm-starts, so steady state begins ≈ wk 10 (auto-detected) vs wk 85 in the paper's cold-start implementation; the paper's design is "1–3 weeks after steady-state onset", which is what week 12 expresses. KPIs are measured over [t_w, t_w + 52] — an event at wk 86 would fall outside the analysis window entirely |

## 5. Application fixes discovered during implementation

1. **Explicit triangular demand bounds (the real fidelity gap).** The engine's
   `Product` entity always supported `demand_min`/`demand_max` (a_p, c_p), but
   the data path (products master → `ProjectRow` → `from_project_data`) could
   only express the symmetric triangularAV form — the empirical right tail
   (c = historical max ≫ 1.3·b) was unreachable. Closed end-to-end per the
   mapping contract's §9 extension recipe: migration + upsert RPC + ProjectRow +
   mapper (+ clamp-and-warn for inconsistent bounds) + item-master editor
   columns + data-map rows + docs + 3 engine tests + wheel rebuild
   (ENGINE_VERSION 0.2.1 → 0.2.2).
2. **SimulationLab was hard-broken at runtime.** The Adopt-step rewrite of
   `useModelValidation` (ctx-based `resolve`) never updated SimulationLab, which
   still called the previous API (`resolveRun`, `applyIfValidated`, 3-arg
   `resolve`) — a TypeError on /simulation-lab that `tsc` had been flagging.
   Restored the convenience API additively on top of the new core.
3. **`AlertTriangle` icon rendered without an import** in RunValidateStage's
   self-check list (crash on the failure branch), plus one type-cast fix in
   `usePolicies` — `tsc --noEmit` is now clean (was 8 errors).
4. **`verify_sim_e2e.mjs` gains `EXPECTED_CODE_VERSION`** — pins the worker to
   the engine version at the verified ref, so a stale worker fails the check
   loudly instead of silently ignoring newly added mapping fields.
5. **NaN-safe replication persistence (latent data-loss bug).** The first
   fully-green server run exposed it: the engine reports unmeasured KPIs as
   NaN (`capacity_utilization` without full-debug matrices), `json.dumps`
   emits a literal `NaN` token — invalid JSON — and PostgREST silently
   rejected **every** `run_replications` upsert; the run reported done with
   `rep_count_done=30` and zero evidence rows. Fixed in the bridge (`_finite`:
   non-finite → JSON null, covering the worker and browser paths), made the
   worker's final replication write load-bearing (failure → run `failed`,
   never green-with-no-evidence), and pinned with a strict-JSON regression
   test.
6. **Seed-workflow concurrency.** Two seed runs from back-to-back pushes
   interleaved on the same project (the loser hit a statement timeout
   mid-restore and left the dataset half-seeded) — the workflow now runs in a
   serial concurrency group and the seeder retries transient RPC faults
   (safe: each RPC is one transaction).
7. **Per-row completion triggers amplified every bulk arc write** (migration
   `20260712100000`): the completion-status trigger fired FOR EACH ROW on all
   five dataset tables — 4 EXISTS probes + a projects-row UPDATE per row, so
   a 1,156-row `delete_project_dataset` fired 1,156 full recomputes. Rewritten
   as statement-level triggers with transition tables + `project_id` indexes.
   This also speeds up the app's own UploadWizard CSV path.
8. **A cartesian-join staleness check killed every completion flip**
   (migration `20260712110000`): `should_recalculate_network_metrics` — which
   runs inside the projects AFTER-UPDATE trigger whenever `completed` flips
   true — cross-joined `supply_chain_data × bom × inbound × outbound`
   (≈ 6.8 × 10⁹ intermediate rows for TRON's graph) and probed
   `supply_chain_data` with an un-indexable OR. It was only ever fast for
   projects with an empty `supply_chain_data`, i.e. before their FIRST
   combine — any re-uploaded project hit a guaranteed statement timeout.
   Rewritten with index-served EXISTS probes and independent per-table MAXes.

## 8. Final end-to-end verification (deployed pipeline, 2026-07-12)

Run `f3e2b1ff…` on project `0a7040e1…` (org DMRG), dispatched through
sim-command with saved policy version `0af48ec6…`:

- queued → running → **done in 22 s** (30 reps × 156 weeks, server-side)
- `code_version scsim-0.2.2` — exact match with this ref (stale-worker pin)
- 30/30 `run_replications` rows persisted; 60 realtime replication events +
  33 run events streamed to the UI channels
- engine mapping report: **1 info entry, zero warn/error** — the real dataset
  transferred with no silent defaulting
- `policy_hash` round-trip: run == saved version (policy fidelity)
- §8.1 gate graded the dispatch (`gate_skipped=false`)

Full log: `seed-results` branch, `results/latest.log`.

## 6. Validation & debugging playbook used

- **Dataset ↔ reference**: generator asserts the exact product/material sets and
  per-product triangular means against `seed0.npz` on every rebuild.
- **Local engine run before deployment**: the canonical worker path runs
  offline; a byte-level red flag was caught this way (the disruption scenario
  initially produced *identical* KPIs to baseline — the event was outside the
  KPI analysis window; see the last assumption above).
- **Mapping warnings as the fidelity meter**: warn-level = data did not
  transfer; the seeded project produces info-level only.
- **Gate hard blocks mirrored client-side**: the seeder's `--dry-run` validates
  enums, referential integrity, unsourced-BOM, non-positive rates/costs before
  any write.
- **Deployed-path proof**: `seed-project.yml` seeds and then runs the full
  e2e verification (30 reps × 1092 days) with the policy-hash round-trip,
  realtime streaming, and mapping-report assertions; result log on the
  `seed-results` branch.

## 7. Known deviations / limitations

- Per-arc MOQ collapses to per-material MOQ (R7) — harmless under single
  sourcing; becomes visible if multi-sourcing (P-S.2) is enabled later.
- One lead time clamped at the engine's 51-week maximum (R4b).
- The paper's stochastic disruption design (t* ~ U{86..88}, Δt ~ U{5..10}) is
  represented by its mean single scenario (start t_w+2, 8 weeks); the
  experimentation layer's stochastic event seeds can generalize this later.
- The paper's Table 1 lists 15 products; the reference snapshot (and this
  project) carries 17 — the snapshot is authoritative.
