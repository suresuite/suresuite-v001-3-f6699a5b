# The SuReSuite Data Spine

> **Status:** AUTHORED · approved architecture, not yet started
> **Baseline:** commit `d3cfc9d`
> **Figures:** https://claude.ai/artifact/4sXUGPiyCmpXGAfRp78mu1 *(11 diagrams)*
> **Execution:** `docs/PLAN-PROMPTS.md` — one prompt per work package
> **Blueprint refs:** `docs/design/next-gen-platform-design.md` §2.3 G4–G6 · §8.1–8.4 · Phase A

**This is the single plan** — enforced, not asserted: `npm run check:docs` fails if
any data-layer fact lives outside §4. Architecture, defects, transparency standard, user
documentation and the work packages live here and nowhere else. `PROMPTS.md` is a
**derived view**: it caches §4 evidence so a cold session need not dig, and the gate
forbids it holding any fact this document lacks.

*(Supersedes `TRANSPARENCY.md` and `USER-DOCS-PLAN.md`, both folded in — they
duplicated facts stated here, which is the defect this plan exists to end.)*

---

## Contents

| § | |
|---|---|
| 1 | How to use this document |
| 2 | The architecture — the spine |
| 3 | What already exists, and is good |
| 4 | Confirmed defects · 4.1 Code map |
| 5 | The transparency standard |
| 6 | The documentation plan |
| 7 | Phase 0 — Stabilize and consolidate |
| 8 | Phase 1 — The contract and its gate |
| 9 | Phase 2 — Governance consolidation |
| 10 | Phase 3 — One ingestion contract |
| 11 | Phase 4 — Trust anchor and analysis store |
| 12 | Phase 5 — Lineage and published documentation |
| 13 | Phase 6 — Policy contract, researcher grade |
| 14 | Deferred — Phase 7+ and engine RFCs |
| 15 | Verification SQL |
| 16 | Drift log |
| 17 | Sequencing |

---

## 1. How to use this document

Work is decomposed into **work packages (WP)**, each sized to roughly **70 % of one
session at Opus 5 high effort**, leaving ~20 % headroom and ~10 % for the mandatory
gap check.

Every WP is self-contained: a fresh session can pick it up from its **Preconditions**
block without reading the ones before it.

**Each WP ends with a gap check. It is not optional.** Its job is to catch drift
between what the previous package promised and what this one found — the failure
mode that makes phase-to-phase work fall apart.

```
WP lifecycle
  1. read Preconditions → verify each one actually holds (do not assume)
  2. implement Steps
  3. run Exit checks — all must pass
  4. GAP CHECK  (~10 % of budget)
       · re-read the Handoff note of the previous WP: did reality match?
       · list anything discovered that invalidates a later WP
       · append findings to §16 Drift Log
       · update the next WP's Preconditions if they changed
  5. write this WP's own Handoff note into §16
  6. commit with `Phase N / WP N.M / <ref>: <title>`
```

**Rule:** if a gap check finds something that changes a later WP, **edit this file in
the same commit.** The plan and the code move together, as CLAUDE.md requires.

---

## 2. The architecture — the spine

Six data tiers, strictly downward, plus a governance plane crossing all of them.

| Tier | Name | Contains | Rule |
|---|---|---|---|
| 0 | Landing | raw bytes as received | write-once, never mutated |
| 1 | Staging | parsed, diffed, unpromoted | invisible to engine and pages |
| 2 | Canonical | deduped, unit-normalized truth | the only tier humans edit |
| 2-O | Observations *(Phase 7+)* | timestamped events | append-only, bitemporal |
| 3 | Derived | machine-computed | pure function of T2, hash-stamped |
| 4 | Decisions | policies, overrides, scenarios | references T2 keys, records seed hash |
| 5 | Results | simulation output | pinned to dataset+policy+engine version |
| G | Governance | identity, capability, delegation, audit | a property of every field |
| — | Reference | project-independent tables (`risk_data`) | versioned by vintage, not project |

**Three laws.** External data never lands below Tier 1. Tier 3 is always safe to
drop and rebuild. Tier 4 knows the hash it was seeded from.

### 2.1 The invariants

To be added to `CLAUDE.md` in WP 1.4. Each is a CI gate, not an aspiration —
anything unenforced drifts within two months, which is the lesson of the two
orphan tables (D3, D4).

| # | Invariant |
|---|---|
| I1 | Every data fact is authored exactly once; docs/validators/RLS generate from it |
| I2 | No tier skipping — external data never lands below T1; pages never write T3 |
| I3 | Units normalize at promotion into T2; nothing downstream converts |
| I4 | Every canonical table has a natural-key unique constraint; ingestion upserts |
| I5 | Every derived row carries the input hash it came from |
| I6 | A fallback absent from the contract may not exist in code |
| I7 | A new source implements the ingestion contract; it never touches T2 schemas |
| I8 | Every result binds dataset + policy + scenario + engine version |
| G1 | Orgs/projects/users referenced by uuid; a displayable name is never a join key |
| G2 | Every table declares read/write capability and minimum project role |
| G3 | Delegation is subtractive and expiring |
| G4 | Every tier transition writes an audit row naming the actor |
| T1–T5 | The transparency commitments — §5.3 |

### 2.2 The contract

One generated artifact, `data-contract.generated.json`, built from four sources:

| Source | Contributes | Authored? |
|---|---|---|
| `supabase/migrations/*.sql` | tables, columns, types, constraints, RLS | introspected |
| `*.contract.yaml` sidecars | meaning, unit, tier, governance, substitutions, resolution | **the only prose** |
| `registry.generated.json` | what the engine reads, fallback chains | imported |
| static analysis | which page/hook touches each field | analyzed, human-confirmed |

It generates: `docs/data/tables/*.md`, the in-app `/docs` data pages (§6), ingest
validators, the one `UNIT_DAYS`, RLS tests, the public API schema, and the CI drift
gate.

---

## 3. What already exists, and is good

The work extends these. It does not replace them.

| Asset | What it guarantees |
|---|---|
| `scsim/scsim/io/registry_export.py` + `scripts/gen_docs.py --check` | Policy catalog, KPIs and entity dictionary rendered from code, with a CI gate that fails on drift. **The pattern the data contract copies.** |
| `supabase/functions/_shared/grading.ts` | **One** grader, consumed by the browser and the pre-dispatch gate, pinned to `project_map.py` by validation-parity fixtures. |
| `src/lib/policies/verifiableExports.ts` | Three XLSX workbooks making a model version **checkable without app access** — policy snapshot stamped with `policy_hash`, the exact rows `graph_hash` covered, run results with the full provenance triple. |
| `supabase/migrations/…_erp_connector_phase1_2.sql` | Stage → diff → approve → promote, with `raw jsonb`, `diff_state`, row counts and an explicit approver. **CSV gets the same path in Phase 3.** |
| `…_dataset_versions.sql` | `graph_hash`, `snapshot_dataset`, runs pinned to a dataset version. |
| `…_unified_access_control.sql` | Capability resolver merging role → org → user, tri-state, super-admin bypass, non-deniable `/profile`, `_user_id` passed explicitly so it never depends on a pooled GUC. |
| `src/components/docs/DocsLayout.tsx` | Docs chrome — nav, breadcrumbs, pager, search, responsive. Reused as-is. |

### 3.1 The cultural precedent

`verifiableExports.ts:164`, on the dataset workbook:

> *"`bomMulti` … is included as an extra sheet: the engine reads it when present,
> but `graph_hash` v1 covers `bom_single_level` only (stated in `_meta`)."*

The export **discloses its own blind spot in its own metadata**. Elsewhere it
refuses to overclaim: a stored value equal to the schema default is reported as
`= schema default` because *"storage cannot distinguish the two, and the export
says so honestly."*

**That is the standard.** §5 makes it systematic rather than a matter of one
author's conscience.

---

## 4. Confirmed defects

Found by reading code, not docs. **§4 is the only authority for data-layer
file:line evidence** — defects here, load-bearing locations in §4.1. Everything
else cites the D-number or the §4.1 row. `npm run check:docs` enforces it.

| ID | Defect | Evidence | Closed by |
|---|---|---|---|
| D1 | Auto-seed persists `safety_stock_days = 0`, overriding the engine's 7-day default | was `useStageRows.tsx:288` + `StagePolicyTable.tsx:844,887`; `project_map.py:783` | WP 0.1 ✅ *(`isPrefillPersistable`)* |
| D2 | `combine-project` never converts `volume` by `time_unit` | was `combine-project/index.ts:60,68,268,275` + `:115,:234-235,:310,:318` — **eight** read sites, not seven | WP 0.2 ✅ |
| D3 | `product_code_map` queried but exists in no migration; error swallowed | `combine-project/index.ts:131-145` | WP 0.2 ✅ (loud); table-or-branch decision still WP 1.4 |
| D4 | `risk_data` queried by two network pages; no migration, no `project_id`, quoted column names | `ProductLevelNetwork.tsx:487`, `FirmLevelNetwork.tsx:288` | WP 0.2 ✅ (notice shown); table-or-branch decision still WP 1.4 |
| D5 | No natural-key uniqueness on any lane table → re-upload duplicates | `20250820145837_…sql` | WP 3.3 |
| D6 | CSV parse is `split(',')` — not quote-safe | `UploadWizard.tsx:477,498` | WP 3.2 |
| D7 | Required-field validation misses `null` (blank numerics pass) | `UploadWizard.tsx:369` vs `:505,508` | WP 3.2 |
| D8 | Inbound/outbound ids not trimmed or empty-checked (BOM-multi is) | `ingest-inbound-logistics/index.ts:38-39` | WP 3.2 |
| D9 | `lead_time_unit` read by engine; no column, dropped by sanitizer | `project_map.py:420`; `datamap.py:126` | WP 1.3 |
| D10 | Three competing unit tables disagree (`quarter` is 13× wrong in SQL) | `grading.ts:113`, `effectiveEconomics.ts:48`, `item_master.sql:138` | WP 1.3 |
| D11 | `_build_dataset_snapshot` hashes `bom_single_level` only | `20260703000001_dataset_versions.sql:120` | WP 4.1 |
| D12 | `should_recalculate_network_metrics` returns "up to date" for an empty project; 5-way cartesian join | `20250925164454_…sql:39-52` | WP 4.2 |
| D13 | Two org identities joined by string comparison | `super_admin_phase1.sql:41`; `get_current_user_org()` | WP 2.1 |
| D14 | No project-level delegation exists | no `project_members` table | WP 2.2 |
| D15 | Audit covers admin plane only | `admin_audit_logs` | WP 2.3 |
| D16 | Hardcoded constants render with "From project data" dot | was `StagePolicyTable.tsx:1194-1203` | WP 0.1 ✅ *(constants deleted; untracked ⇒ `default`; de-dup of the two copies remains 6.2)* |
| D17 | NULL `capacity_per_week` (= unlimited) renders as `0`, no dot | `resolveEffective.ts:135` | WP 6.2 |
| D18 | `material_price` displayed prominently; consumed nowhere in the engine | `columnSpecs.ts:133,350` | WP 6.2 |
| D19 | Analysis results smeared onto entity columns; no identity or version | `network_nodes.degree_centrality` | WP 4.2, 4.3 |
| D20 | `projectLanes` fallback truncates at 10 000 rows silently | `projectLanes.ts:30-33` | WP 3.1 |
| **D21** | **User docs name fields the user never sees.** `products.csv` says `sell_price`/`demand_mean`/`demand_distribution`; the engine says `unit_price`/`demand_mode`/`demand_model`; the legacy docs showed the engine's names | `public/template/products.csv`; `item_master.sql:28-32`; `network.py:145,151,154` | WP 5.2b |
| D22 | Legacy docs hand-copied the Pydantic models while `gen_docs.py` already renders them from the registry | archived `docBodies.tsx` `SIM_PARAM_GROUPS` | WP 0.3 *(done)* |
| **D23** | **A saved sourcing choice cannot survive a reload.** The row's own suggestion is read *before* the override bundle (`resolveEffective.ts:82`), so a persisted `primary_source`/`sourcing_firm` override is always shadowed by what `useStageRows` suggested; and `saveAll` drops an edit equal to the family default (`StagePolicyTable.tsx:694`), so un-checking a primary (`false` = the schema default) is never written at all. Found by WP 0.1's gap check | `resolveEffective.ts:82`; `StagePolicyTable.tsx:694`; `schemas.ts:81` | WP 6.2 |
| D24 | `production_lead_time_mean_days` is a median of *inbound* lead times but is flagged `__from_data`, i.e. as an uploaded production lead time. Renders nowhere today (no grid column), so no dot lies yet — it would the moment a column is added. Found by WP 0.1's gap check | `useStageRows.tsx:398-404` | WP 6.2 |
| D25 | `combine-project`'s core reads (`outbound_logistics`, `inbound_logistics`, both BOM tables) destructured only `{ data }` — the same swallow as D3 but on the ETL's own inputs, so a failed read produced a half-empty graph and reported success. Found by WP 0.2 while fixing D3 | `combine-project/index.ts:52-64,169-174,207-220` | WP 0.2 ✅ |
| D26 | **Two copies of the D1 prefill rule.** `5c7129f` merged two independent WP 0.1 implementations: `resolveEffective.ts:isPrefillPersistable` (imported and called at `StagePolicyTable.tsx:865`) and `prefillSelect.ts:prefillSourceFor` (imported at `StagePolicyTable.tsx:53` and never called). Both are unit-tested, so both stay green while only one runs — an I1 violation, and the next edit to "the rule" has even odds of landing on the dead one. Found by the WP 1.1 precondition check | `resolveEffective.ts:214`, `prefillSelect.ts:33`, `StagePolicyTable.tsx:53,865` | WP 6.2 |

### 4.1 Code map — the data layer

The defect table above records what is **wrong**. This records where the data layer
**is** — the load-bearing locations every work package needs and would otherwise
rediscover. Together they make §4 the complete authority: no data-layer fact lives
only in `PROMPTS.md` or in a session transcript.

**Ingestion**

| Location | What is there |
|---|---|
| `UploadWizard.tsx:476-477` | `content.trim().split('\n')` — the parse (D6) |
| `UploadWizard.tsx:497-523` | the row loop; blanks and garbage become `null` (D7) |
| `UploadWizard.tsx:1833` | the upload gate — `file && errors.length === 0` |
| `UploadWizard.tsx:1280-1307` | auto-invokes node prominence after deep-tier uploads |
| `ingest-inbound-logistics/index.ts:37-46` | the sanitizer allow-list; no trim (D8) |
| `ingest-bom-multi-level/index.ts:42-44` | **the correct trim/empty pattern** — copy this one |
| `combine-project/index.ts:131-149` | the `product_code_map` read — now error-checked and loud; the mapped branch at `:158-163` is still dead until WP 1.4 decides (D3) |
| `combine-project/index.ts:52-64` | the core lane reads. Error-checked since WP 0.2 — a failed read aborts instead of producing a half-empty graph (D25) |
| `_shared/laneVolumes.ts:35,41,60` | `weeklyVolume` / `weeklyVolumeTotalsBy` / `volumeShare` — the ETL's unit normalization, over `grading.ts`'s table (D2) |

**Units and the engine boundary**

| Location | What is there |
|---|---|
| `grading.ts:113-135` | `UNIT_DAYS` + `rateToWeekly` — **canonical**, mirrors `project_map.py` |
| `grading.ts:159` | `cheapestInboundCost` floors a ≤0 price to 1.0 before the min |
| `effectiveEconomics.ts:43-50` | `ratePerDay`, delegates to the shared table |
| `item_master.sql:138-141` | the third, divergent unit `CASE` in `sc_nodes` (D10) |
| `project_map.py:418-429` | lead time → weeks, `round`, `clamp(1,51)`, default 2 |
| `engine.py:294` | `if dist != DETERMINISTIC && cv > 0` — deterministic skips sampling |
| `enums.py:60` | `LeadTimeDist.EMPIRICAL`, reserved for the data-import path (M7) |

**The policy grid chain**

| Location | What is there |
|---|---|
| `useStageRows.tsx:208-354` | the supplier stage — where rows are built |
| `useStageRows.tsx:164` | `resolveField`'s `> 0` test |
| `useStageRows.tsx:120-131` | the smart-average imputation basis |
| `useStageRows.tsx:183-190` | `markFromData` — a routing decision the data's shape made (`primary_source`, `sourcing_firm`) is tracked as project-backed, so the prefill persists it |
| `useStageRows.tsx:277-306` | the supplier row loop and its row literal. Since WP 0.1 it writes ONLY an uploaded price, the routing decision, and the two provenance maps — `__from_data` / `__imputed`. No constant is stamped on a row |
| `useStageRows.tsx:305,424` | where the hardcoded row constants were (D1, D16) — deleted in WP 0.1; the comments there are the rule |
| `columnSpecs.ts:119-181` | the supplier column spec |
| `columnSpecs.ts:132-171` | `defaultWhenMissing` values — dead for any field the Zod bundle also declares (`bundleVal` wins); `safety_stock_days: 0` vs the bundle's 7 is a live divergence (WP 6.2) |
| `columnSpecs.ts:353` | `material_price` fit metadata, `keep: true` (D18) |
| `resolveEffective.ts:82` | `dataRow[field]` is checked **before** the override bundle (D23) |
| `resolveEffective.ts:103-193` | `resolveCell` — the canonical provenance logic |
| `resolveEffective.ts:200-224` | `isPrefillPersistable` — the D1 rule: persist `__from_data` or an unsaved edit, never a default. **The live rule**; `prefillSelect.ts` is its unreachable twin (D26) |
| `prefillSelect.ts:33,48` | `prefillSourceFor` / `isPrefillable` — a second, unreachable copy of the same rule (D26) |
| `StagePolicyTable.tsx:1208-1276` | a **verbatim copy** of `resolveCell` (de-dup in WP 6.2) |
| `StagePolicyTable.tsx:820-831` | `applyPrefill` — raises `applying` before the row loop, then `runPrefill` (`:833`) |
| `StagePolicyTable.tsx:900-917` | the auto-seed effect; marker is a **Set** of `${projectId}::${stageKey}` |
| `policyGridUi.tsx:15-41` | the provenance vocabulary; `default` has colour `null`, `suggested` added in WP 0.1 |
| `policyGridUi.tsx:54` | `ProvenanceLegend` — must gain any new state |

**Versioning, governance, network**

| Location | What is there |
|---|---|
| `20260703000001_dataset_versions.sql:70-138` | `_build_dataset_snapshot` (D11) |
| `20260711000002_unified_access_control.sql:169` | `capabilities_for_user` — the resolver |
| `item_master.sql:85-89` | `ensure_item_masters`; unions `bom_single_level` only |
| `ProcessLevelNetwork.tsx:1110-1111` | direct `.from()` reads, no RPC, no pagination |

---

---

## 5. The transparency standard

**Non-negotiable.** Every WP is measured against it.

### 5.1 The rule

> **Every number on screen must answer three questions in one click:
> where did it come from, when was it computed, and what would change it.**

Testable, so a cell that cannot is a defect and gets logged like one.

Two corollaries that do most of the work:

**Transparency is a property of the system, not a document.** A hand-written data
dictionary is wrong within a quarter — D21 and D22 are what that looks like. Every
artifact below is generated from the contract, or it does not count.

**Negative transparency outranks positive.** Coverage gaps, imputed values, stale
derived data, conflicts, and the known limits of our own hashes are surfaced first
and loudest. Hiding them is how trust is lost in one moment rather than earned over
many.

### 5.2 Transparency is not exposure

A real deployment has multiple organizations and commercially sensitive numbers.

> **The method is always public. The values are governed.**

| Visible to anyone with page access | Governed per field by capability |
|---|---|
| that a field exists; its meaning, unit and grain | its **value** |
| which source classes may assert it | |
| every substitution rule that could apply | |
| whether *this* value was substituted, and by which rule | |
| when it was computed, from which hash | |
| the known limits of the computation | |

A user who cannot see a supplier's price can still see that a price exists, came
from an ERP master on 12 September, and was not substituted. Enough to trust the
model without breaching the contract.

Enforceable only because the contract carries `governance.read` per field (WP 1.2)
and the resolver knows project role (WP 2.2). **Export is itself a governed action** —
the `export` capability already exists (`unified_access_control.sql:53`); a dataset
workbook contains every price on the network (WP 2.3).

### 5.3 The five commitments

→ `CLAUDE.md`, alongside the invariants.

**T1 · No number without a source.** Every displayed value resolves to data, a named
substitution rule, or an explicit default. There is no fourth option.

**T2 · Substitution is always visible** at the point of display — not in a log. A
fallback absent from the contract may not exist in code (I6).

**T3 · We publish our own blind spots.** Every report and export states the known
limits of its own computation. §3.1 is the precedent.

**T4 · Reproducible or not published.** Any figure leaving the system carries the
dataset, policy, scenario and engine versions that produced it.

**T5 · Transparency survives handover.** Generated and CI-gated, so it stays true
when the people who built it have moved on.

### 5.4 The in-product artifacts

Five, escalating. A stakeholder stops at whichever satisfies them and goes deeper
without asking anyone. **These are product features; §6 is the reference
documentation that explains them.**

| # | Artifact | Answers | State | WP |
|---|---|---|---|---|
| A1 | Provenance dot | *Is this real data?* | D16 closed (WP 0.1); D17 open | 0.1 ✅, 6.2 |
| A2 | Value-chain popover | *Where did THIS number come from?* | missing | 6.3 |
| A3 | Project Data Trust Report | *Is this model built on good data?* | grading exists, unassembled | 4.4 |
| A4 | Verifiable export | *Can I check this without your app?* | **exists, strong** | 3.3 extends it |
| A5 | Reproducibility record | *Can I reproduce this in two years?* | missing | 6.3 |

**A1 vocabulary** after the plan lands:
`data · master · contract · estimated · imputed · derived · suggested · override · edited ·
default`. Two rules the current implementation breaks: no dot may claim more than it
knows (D16 — **closed in WP 0.1**), and a missing value must not render as a real one
(D17). `suggested` was added by WP 0.1: the stage's own routing choice, ranked from
uploaded volumes, is neither uploaded data nor a bundle default, and calling it either
is exactly the over-claim D16 is about.

**A3 shape** — mostly assembly of what `grading.ts` already computes: coverage per
engine-read field, blocking findings, neutral-constant substitutions, derived values,
per-table freshness, ingest history, and a **Known limits** block. The limits block
is not optional; a trust report that does not state its own limits is marketing.

**A4's structural gap.** Today the dataset workbook starts at **Tier 2** — it proves
what the engine ran on, not where those rows came from, because ingestion has no
provenance. WP 3.3 adds `ingest_run_id` + `source_row_id`, extending it down to the
file, row, uploader and approver. **Transparency completion is a consequence of the
ingestion work, not a separate project.**

**Acceptance test for the whole standard.** Hand a stakeholder a number from the
Supplier grid and a laptop. With no help and no app access beyond the export, they
trace it to a row in a named file uploaded by a named person on a named date — or
find the named rule that produced it in the absence of data.

---

## 6. The documentation plan

### 6.1 Why the legacy site failed

`docBodies.tsx`, 2 781 lines of hand-written JSX, archived in WP 0.3 to
`docs/archive/legacy-help-site/`. Five causes, each now a rule.

**(a) It documented names the user never sees (D21).** One quantity, three names —
the user types `sell_price`, the engine calls it `unit_price`, the docs showed
`unit_price`. A planner holding `products.csv` could not find one of their own
headers. The mapping between the three had never been written down, and **that
mapping is exactly what the contract is.**
→ **Rule 1 — Document the name the reader typed.** Other names are translation, not
subject.

**(b) It was hand-copied from code, so it drifted (D22)** — while `gen_docs.py`
already renders the same facts from the registry under a CI gate.
→ **Rule 2 — Generated or not published.** Anything hand-written must be a fact that
exists nowhere else.

**(c) It was written for the manuscript** — `b_p`, `ν`, `§3.1`, `MSER-5`.
→ **Rule 3 — Plain language first, notation last**, in a collapsed block.

**(d) It was organized by engine entity.** Users touch a **file** and a **cell**.
Neither had a page.
→ **Rule 4 — Organize by what the user touches** — which is the journey their data
takes, which is the tier sequence of §2.

**(e) It was grouped by audience**, forcing readers to self-classify.
→ **Rule 5 — One page per question, filtered by role.** The capability catalog
already knows who the reader is.

### 6.2 The organizing principle

> **The documentation structure is the data structure, because the data structure
> is what actually happens to the user's data.**

| Tier | What the user experiences | Page |
|---|---|---|
| 0 → 1 | "I uploaded a file and you checked it" | P2 |
| 2 | "this is my data" | P3, P4 |
| 3 | "you worked something out from it" | P6 |
| 4 | "these are my decisions" | P5 |
| 5 | "these are my results" | *existing sim docs* |
| G | "who can see this" | P7 |
| all | "how is this put together" | **P8 — the spine** |

Because both docs and data come from one contract, the docs are **complete by
construction**: an undocumented field fails CI (WP 1.4), and a documented field that
no longer exists fails too.

### 6.3 The manual — complete site map

Modelled on [anyLogistix Help](https://anylogistix.help/tables/tables.html), which
documents ~48 tables one page each. SuReSuite has **~75 tables, 28 routes, 17 edge
functions and 9 admin screens.** Everything below is enumerated from the code, not
guessed.

Legend — **W** written once · **G** generated from the contract · **G\*** generated
from the engine registry (`gen_docs.py`, already exists)

---

#### 1 · Overview & architecture  *(7 pages · W + figures)*

**The manual opens here.** A reader arriving at `/docs` sees how the software is
designed before being asked to fill in anything. This section is the published
spine — see §6.5.

| Page | Content |
|---|---|
| What SuReSuite is | The tool in one page — what problem it solves, what it produces. Mined from the archived ACCURATE framing. |
| **How SuReSuite is designed** | **The architecture.** The six tiers as the journey your data takes, the figures, and the three laws: external data never lands below staging; computed data is always rebuildable; every decision remembers the data it was made on. |
| The data model at a glance | Every table in the system on one page, grouped by tier, each linking to its reference page. The map you keep open in another tab. **G** |
| How your data flows | Upload → we check it → it becomes your data → we compute from it → you set policies → you simulate → results are stamped. One diagram, one paragraph per hop. |
| What happens to your data | The five commitments (§5.3) in user language: we never change your numbers silently; substitutions are always marked; your data stays in your organization; export or delete any time. |
| System boundary | What runs where — browser, Supabase, simulation worker, scsim engine — and what crosses each boundary. For IT and for anyone evaluating the tool. |
| Known limits | Per T3. Steady-state engine, `graph_hash` v1 scope, no price-volatility model. Stated plainly, at the top of the manual, not buried. |

#### 2 · Getting started  *(3 pages · W)*

| Page | Content |
|---|---|
| Your first project | End-to-end: create → upload → verify → set policies → simulate → read results. |
| Projects | `projects`, `plants` — the container. BOM level, plant name, simulation window, completion. |
| Uploading data | The wizard, what is validated, what gets rejected and why. |

#### 3 · Input tables — *the data you provide*  *(12 pages · G)*

The reference section. One page per table: purpose, where to upload, template,
column-by-column reference, example, notes, related tables.

| Page | Table(s) | Columns |
|---|---|---|
| Inbound Logistics | `inbound_logistics` | supplier_id, material_id, volume, time_unit, lead_time, unit_price |
| Outbound Logistics | `outbound_logistics` | customer_id, product_id, volume, time_unit, expected_lead_time, unit_price |
| BOM — single level | `bom_single_level` | product_id, material_id, consumption_rate |
| BOM — multi level | `bom_multi_level` | material_id, level, higher_level_component_id, consumption_rate |
| Materials | `materials` | material_id, name, cost, holding_cost_pct, moq, initial_on_hand, lead_time_dist, lead_time_cv |
| Products | `products` | product_id, name, sell_price, production_capacity, fulfillment_mode, demand_distribution, demand_mean, demand_cv, demand_min, demand_max |
| Suppliers | `suppliers` | supplier_id, name, capacity_per_week, reliability_score |
| Node List | `node_list` | node_id, description, location, longitude, latitude |
| Deep-Tier Nodes | `network_nodes` | uid, depth, name, country, industry, website, employees, revenue, lat, long, is_seed |
| Deep-Tier Edges | `network_edges` | src_uid, dst_uid, relation_type, relative_revenue, depth, direction |
| Multi-Tier Suppliers | `multi_tier_supply_chain` | from_firm_id, to_firm_id, tier, relationship |

Plus **Units and time periods** (W) — the one page that settles `time_unit` vs
`lead_time`. It belongs here, beside the tables it governs.

#### 4 · Computed tables — *what we build from your data*  *(4 pages · G)*

| Page | Table(s) | Explains |
|---|---|---|
| Supply Chain Data | `supply_chain_data` | sourcing_ratio, weighted, material_consumption_rate — how shares are derived |
| Multi-Tier Data | `supply_chain_data_multi_tier` | level, path_root — how tiers are expanded |
| Network Summary | `network_summary`, `external_evidence` | cartographer output |
| Dataset Versions | `dataset_versions` | graph_hash, snapshots, why a version changes |

#### 5 · Policies  *(9 pages · G\* + W)*

The largest feature. The catalog already renders from the registry.

| Page | Source |
|---|---|
| How policies work — stages, scope, defaults vs overrides | W |
| Supplier stage — every column | G |
| Plant stage — every column | G |
| Customer stage — every column | G |
| Policy types — min/max, base stock, ROP-Q, periodic review | G\* |
| The policy catalog — all 21, P-S/P-P/P-T/P-C/P-F/P-X | G\* |
| Where a number came from — the provenance dots | W |
| When a value is missing — every substitution | G |
| Policy versions & presets — `policy_versions`, `policy_presets` | W |

#### 6 · Verification  *(3 pages · W + G)*

| Page | Covers |
|---|---|
| Verify your inputs | The grading findings: block / warn / info, and how to clear each |
| Data Trust Report | Coverage, freshness, ingest history, known limits (A3) |
| Model validation | `model_validations` |

#### 7 · Experiments & scenarios  *(7 pages)*

| Page | Table(s) |
|---|---|
| Simulation Lab — running an experiment | `simulation_runs`, `simulation_jobs` |
| Scenarios | `scenarios`, `sim_scenarios`, `scenario_templates` |
| Disruptions | `disruption_scenarios` + `_profiles` / `_settings` / `_targets` / `_effects` |
| Recovery playbooks | `recovery_playbooks` |
| Experiments & comparison | `experiments` |
| Seeds, replications & confidence | G\* from the statistics reference |
| Stress tests — ST-1…ST-7 | mined from the archive |

#### 8 · Networks  *(5 pages · W)*

| Page | Route |
|---|---|
| Product-Level Network | `/network/product-level` |
| Process-Level Network | `/network/process-level` |
| Firm-Level Network (deep tier) | `/network/firm-level` |
| Interactive Network Space | `/network/interactive-space` |
| Network science metrics | centrality, prominence, critical-node prediction — what each means and how it is computed |

#### 9 · Project Intelligence  *(4 pages · W)*

| Page | Table(s) |
|---|---|
| The AI assistant — what it can see and do | `chat_threads`, `chat_messages`, `chat_folders` |
| Plans and proposals — review before apply | `chat_plans`, `proposals` |
| Project memory | `project_memory` |
| Models, budgets and limits | `ai_models`, `ai_budgets`, `ai_usage_logs`, `user_ai_permissions` |

#### 10 · Connectors  *(3 pages · W)*

| Page | Table(s) |
|---|---|
| Connecting an ERP / MRP system | `project_erp_links` |
| Reviewing and applying a sync | `erp_sync_runs`, `erp_staged_*` |
| CSV vs connector — which to use | — |

#### 11 · Results & statistics  *(5 pages · G\*)*

| Page | Table(s) |
|---|---|
| Reading your results | `simulation_runs`, `run_replications` |
| KPIs & the Resilience Index | registry |
| Per-item time series | `run_item_series` |
| Performance & caching | `simulation_cache`, `simulation_performance_metrics` |
| Reports & files | `user_files`, `report-render` |

#### 12 · Exports & reproducibility  *(3 pages · W)*

| Page | Covers |
|---|---|
| Verifiable exports | The three workbooks (A4) |
| Reproducibility record | A5 |
| Exporting and deleting your data | — |

#### 13 · Access & administration  *(7 pages · W)*

| Page | Table(s) / route |
|---|---|
| Organizations and members | `organizations`, `organization_members` |
| Roles and capabilities | `capabilities`, `role_capabilities`, `org_capabilities`, `user_capabilities` |
| Project access | `project_members` *(after WP 2.2)* |
| Who can see your data | — |
| Audit log | `admin_audit_logs` → `audit_logs` · `/admin/audit` |
| Admin screens | `/admin/{users,roles,organizations,projects,models,usage}` |
| Account & password | `/profile` |

#### 14 · Developer API  *(4 pages · G + W)*

| Page | Table(s) |
|---|---|
| Getting an API key | `api_keys` · `/developer` |
| Endpoints & schemas | G from the contract |
| Rate limits & idempotency | `api_rate_limits`, `api_idempotency` |
| Request log | `api_request_logs` |

#### 15 · Reference  *(4 pages)*

| Page | Source |
|---|---|
| All tables — the detailed index, every column of every table | G |
| Units & conventions | G |
| Glossary | mined from the archive |
| Field index — every field, A–Z, linking to its table page | G |

---

**Total: ~78 pages**, opening with the architecture,, of which ~30 are generated from the data contract, ~12 from the
engine registry (already rendering), and ~35 hand-written narrative.

**Internal-only tables** — documented in `docs/data/tables/*.md` for the team but not
in the user manual: `simulation_job_magnitudes`, `api_idempotency`, `ai_chat_events`,
`ai_model_capabilities`, `ai_providers`,
`policy_presets` *(if unexposed)*. ~~`user_plant_access` *(vestigial)*~~ and
~~`for`/`tier`~~ are struck: WP 1.1 confirmed `user_plant_access` was **dropped**
(`20250820172632`, with `plants`) and that `for`/`tier` were parse artefacts — the
replay yields 71 tables and neither name is among them.

### 6.4 Rules for every page

**Deep-linkable.** Every field has a stable URL. Grid column headers, the upload
wizard and validation findings link into P3 at the exact field. Documentation the
user has to go and find is documentation they will not read.

**Role-filtered, not audience-grouped.** One set of pages; a modeler additionally
sees the engine-name and distribution blocks. Driven by the capability catalog, so
the filter cannot drift from the app's own roles.

**Mobile reads the same payload.** One content source rendered by `DocsLayout`. No
second content tree — that duplication is the defect this programme exists to end.

**Every generated page carries its provenance.** Footer: generated from contract
version X, engine version Y, on date Z. The docs hold themselves to §5.

### 6.5 Publishing the spine — section 1

The architecture is a selling point, not an internal secret, and it is the first
thing a reader should see. **"How SuReSuite is designed" is page 2 of the manual**,
not an appendix.

What it carries:

- the six tiers, told as the journey a user's data takes rather than as a schema
- the figures, served from the repo rather than a private artifact
- the three laws in plain language — *external data never lands below staging;
  computed data is always rebuildable; every decision remembers the data it was made
  on*
- the invariants (§2.1) restated for a reader: *"we never change your numbers
  silently"*, not *"I6: a fallback absent from the contract may not exist in code"*
- the **known limits** block (T3), on its own page in the same section

Why first: a prospective customer, a researcher and a new modeller all ask the same
opening question — *how is this thing put together, and can I trust it?* Answering
that before the reference section is what separates a manual from a data dictionary.

WP 5.2a moves the figure SVGs into the repo so the docs have no external dependency
and the diagrams version with the code they describe.

### 6.6 What survived the archive

Kept in `src/`: `DocsLayout.tsx` (chrome) and `registry.ts` (shape — `slug`, `title`,
`summary`, `keywords`, `related`; entries get rewritten, the type stays).

Worth mining from the archive — narrative existing nowhere else: the ACCURATE /
Horizon Europe framing, the planner workflow, use-cases-by-page, the glossary, the
ST-1…ST-7 stress-test descriptions.

Do **not** mine: policy catalogue, simulation parameters, KPI definitions,
distributions. All already in `registry.generated.json` and rendered by
`gen_docs.py` — which is precisely why the hand copy drifted.

---

## 7. Phase 0 — Stabilize and consolidate

### WP 0.1 — Kill the silent policy override ✅ *(D1, D16 — done `4ec6fa6`)*

**Preconditions** — branch off latest default. Verify D1 reproduces: open `/policies`
on a project with inbound data, confirm `policy_overrides` gains rows with
`patch->>'safety_stock_days' = '0'`.

**Files** — `src/hooks/useStageRows.tsx` · `src/components/policies/StagePolicyTable.tsx` ·
`src/lib/policies/resolveEffective.ts` · tests

**Steps**
1. Stop `useStageRows` writing hardcoded constants onto rows so they are
   indistinguishable from uploaded data. Preferred fix: do not write them at all —
   let the policy bundle / `columnSpecs.defaultWhenMissing` supply them.
2. In `applyPrefill`, skip any field not present in `row.__from_data`.
   **Amended in the doing.** Two things must survive that rule: an unsaved edit
   (the function's other documented job), and the routing decisions the data's
   own shape determines. `primary_source` and `sourcing_firm` are not uploaded
   columns, but they are not defaults either — and the pre-dispatch validator
   reads them from the **saved override bundle** (`verification.ts:110,144`),
   never from the row, so dropping them would block every run. They are
   therefore recorded in `__from_data` by `useStageRows::markFromData`, which
   keeps `__from_data` the single allow-list this step asks for.
3. Fix the auto-seed re-fire: arm the in-flight flag before the row loop, and hold
   the marker in a **Set** rather than one slot (a supplier → plant → supplier
   round trip overwrote it). An effect body cannot `await` and does not need to:
   `applying` is raised synchronously before the first row is read.
4. Provenance: a field neither tracked nor master resolves to `default`, not `data`
   — in **both** copies of the logic (they are duplicated; de-dup is WP 6.2).

**Exit checks** — `npm test` green · a row with no uploaded `safety_stock_days`
produces **no** override for that field · auto-seed fires at most once per
`(project, stage)` across a tab round trip · the grid shows no green dot on it

**Gap check** — grep every `col(` field in `columnSpecs.ts` against the object
literals in `useStageRows.tsx`; record further collisions in §16.

**Delivered** — `src/lib/policies/prefillSelect.ts` is the one rule for what the
prefill may persist; `src/lib/policies/__tests__/policyPrefill.test.ts` is the
regression suite. The provenance vocabulary gained `suggested` (§5.4).

### WP 0.2 — Unit conversion + orphan-table honesty ✅ *(D2, D3, D4 — done)*

**Preconditions** — WP 0.1 landed (`prefillSelect.ts` exists; `useStageRows` writes
no constants). Verify D2 with the §15 mixed-unit query.

**Files** — `combine-project/index.ts` · `_shared/grading.ts` (import only) ·
`ProductLevelNetwork.tsx` · `FirmLevelNetwork.tsx`

**Steps**
1. Import `rateToWeekly` from `_shared/grading.ts`; apply at **all seven** volume
   reads, not just the obvious four (see D2 evidence). No local copy — I3.
2. `product_code_map`: check `error`, log loudly, continue with an empty mapping.
3. Same for `risk_data` in both pages: check `error`, show a UI notice rather than
   rendering a silently unjoined graph.

**Exit checks** — unit test: two arcs, one `week` one `year`, same physical volume →
equal `sourcing_ratio` · `supply_chain_data.weighted` non-zero where keys match ·
both pages show a notice when `risk_data` is unavailable.

**Gap check** — run **every** query in §15 against one real project and record the
counts in §16. Those numbers are the baseline every later phase is measured against.

**Delivered** — `supabase/functions/_shared/laneVolumes.ts` (the ETL's unit
normalization, over `grading.ts`'s table) and
`src/lib/policies/__tests__/laneVolumes.test.ts`;
`src/components/network/RiskDataNotice.tsx`, one component used by both pages.
**The §15 baseline was NOT captured — no database access. See §16.**

### WP 0.3 — Documentation consolidation ✅ *(done — `719f59b` + WP 0.3 finish)*

Archived `docBodies.tsx` + `HelpPage.tsx` to `docs/archive/legacy-help-site/` with a
README recording D21/D22 and what is worth mining. `docs/data/` established as the
single archive.

**Finished in Phase 0.** The two top-level data docs moved under `docs/data/` with
status banners, tombstones left at both old paths (≈ two dozen code comments still
cite them), and `CLAUDE.md` gained the plan-authority rule and the §2.1 invariants.

| Now at | Status | Was |
|---|---|---|
| `docs/data/field-mapping.md` | AUTHORED | `docs/data-simulation-mapping.md` |
| `docs/data/lifecycle.md` | AUTHORED | `docs/simulation-data-lifecycle.md` |
| `docs/data/tables/*.md` | GENERATED | — *(lands in WP 1.4)* |

**Every page under `docs/data/` opens with a status banner** — GENERATED, AUTHORED, or
DEPRECATED naming its successor. A reader must not have to guess whether to edit a page
or its generator; that guess is how D22 happened.

---

## 8. Phase 1 — The contract and its gate

### WP 1.1 — Schema introspector ✅ *(done)*

**Preconditions** — Phase 0 complete. *(Did not hold on arrival: merge `5c7129f` had
dropped two §16 entries, broken `check:docs`, and left `resolveCell` referencing an
undefined binding. Repaired first — see §16's precondition entry.)*
**Files** — `scripts/data-contract/introspect.mjs` · `package.json`

**Steps** — parse `supabase/migrations/*.sql` in filename order into an effective
schema (tables, columns, types, nullability, constraints, indexes, RLS, function
signatures); emit `build/schema.introspected.json`; add `npm run contract:introspect`.

**The hard part:** `CREATE TABLE IF NOT EXISTS` appears for the *same* table with
*different* definitions — `20250820145017`/`20250820145155` use `plant_id uuid`,
`20250820145837` uses `plant_name text`. Under IF-NOT-EXISTS the **first** wins.
Model this or the whole contract is built on a wrong schema. Also handle
`ALTER COLUMN … TYPE`, `RENAME COLUMN` (`plant` → `plant_name`, `20250822025432`),
`DROP CONSTRAINT IF EXISTS` (`20250816002505`) and quoted identifiers with spaces.

**Exit checks** — all four lane tables, three masters, `supply_chain_data`,
`dataset_versions` and the governance tables present · `inbound_logistics` shows no
unique constraint beyond `id` (confirms D5) · `weighted` is `numeric(16,6)` ·
`orphans` contains exactly `product_code_map` and `risk_data`.

**Gap check** — diff against `\dt` on the live DB if reachable; a table present live
but not in migrations is a second orphan class.

**Delivered** — `scripts/data-contract/sql-lex.mjs` (statement splitter: dollar
quoting, nested block comments, quoted identifiers), `introspect.mjs` (the replay),
`verify-introspection.mjs` (these exit checks, re-runnable), `npm run
contract:introspect` / `contract:verify`. **First-wins is not the whole rule** — a
migration runs in one transaction, so the rule is *first SUCCESSFUL* wins, and three
files here aborted. The introspector resolves that from the migrations themselves
rather than by assertion; §16 has the mechanism. Seven of eight exit checks pass;
the eighth found a **third orphan**, `approved_users`.

### WP 1.2 — Sidecar schema and the first twelve tables

**Preconditions** — WP 1.1 emits the introspected schema.
**Files** — `supabase/migrations/*.contract.yaml` (~12) · `scripts/data-contract/contract.schema.json`

**Steps**
1. Define the sidecar JSON Schema. Per table: `tier`, `grain`, `natural_key_unique`,
   `owner`, `governance {read, write, min_project_role, audited}`. Per field: `type`,
   `unit`, `unit_source`, `meaning`, `grain`, `engine {consumed_by, transform,
   missing_default}`, `substitutions[]`, `ingest {csv_header, required, validate}`,
   `surfaces[]` *(Phase 5)*, `resolution` *(WP 1.3)*.
2. **`ingest.csv_header` is what closes D21** — it is the name the user typed, and
   P3 leads with it.
3. Reserve, unused: `tier: "2-O"`, the `observations` schema name, provenance states
   `estimated` and `contract`.
4. Author sidecars for the twelve simulation-path tables. Fill `engine.consumed_by`
   by grepping `scsim/`; a field you cannot trace is a finding, not a blank.

**Exit checks** — all twelve validate · every column has an entry · every field with
a CSV origin records its `csv_header` · `inbound_logistics.lead_time` records
`unit: weeks`, `unit_source: fixed`.

**Gap check** — list fields with no `engine.consumed_by` and no UI surface as
deletion candidates; do not delete.

### WP 1.3 — One unit table, `lead_time_unit`, resolution modes *(D9, D10)*

**Preconditions** — WP 1.2 sidecars exist.

**Steps**
1. **One `UNIT_DAYS`.** `grading.ts` is canonical (isomorphic, parity-pinned).
   Verify `effectiveEconomics.ts` still delegates. Replace the `sc_nodes` SQL `CASE`
   — `quarter` currently falls to `ELSE` and is 13× wrong.
2. **`lead_time_unit`** — add the column, the sanitizer allow-list entry, the CSV
   header and the sidecar. `NULL` = weeks, matching `project_map.py:420`.
3. **Resolution block** per engine-consumed field: `default_mode`, `assertable_by[]`,
   `estimable_from[]`, `hybrid {centre, spread}`, `on_conflict`, `threshold_pct`.
   The engine already supports hybrid: `SupplierLink` separates `lead_time_weeks`
   (centre) from `lead_time_dist`/`lead_time_cv` (spread), `deterministic` is a real
   runtime path (`engine.py:294`) and its default, and `LeadTimeDist.EMPIRICAL` is
   reserved for the data-import path (M7).
4. `estimable_from: []` on `consumption_rate`, `moq`, `capacity_per_week` — **the
   load-bearing line**: it stops a future estimator fitting a distribution to an
   engineering fact.
5. Price has **no** variability field anywhere in `scsim`. Record
   `resolution.hybrid: null` pointing at the engine RFC (§14).

**Exit checks** — one `UNIT_DAYS` definition plus its Python mirror and imports ·
`rateToWeekly(v,'quarter')` agrees across TS, SQL and Python · a CSV with
`lead_time_unit=day` round-trips.

**Gap check** — re-verify the TS table against `project_map.py` `_UNIT_DAYS` key for
key. Divergence is a parity break; fix before closing.

### WP 1.4 — Generator, drift gate, orphan reconciliation

**Files** — `scripts/data-contract/{generate,check}.mjs` ·
`.github/workflows/data-contract.yml` · `build/data-contract.generated.json` ·
`docs/data/tables/*.md` · `CLAUDE.md`

**Steps**
1. `generate.mjs` merges introspected + sidecars + `registry.generated.json` → the
   contract; renders `docs/data/tables/*.md` with a GENERATED header.
2. `check.mjs` fails when: a table/column has no sidecar entry; a sidecar describes
   something absent; generated markdown differs from committed; a `tier: 2` table
   lacks a natural-key index *(warn until WP 3.3)*; a code-referenced table has no
   migration.
3. **Decide the orphans here, do not defer.** `product_code_map`: add the migration or
   delete the dead branch (deletion recommended — it has never executed).
   `risk_data`: real migration with `source`, `vintage`, `licence`, `refreshed_at`,
   columns renamed.
   **`approved_users` — the third orphan, found by WP 1.1.** It is not a dead branch:
   it is the authentication table. `useAuth.tsx` and four admin pages read it, 24
   migration statements ALTER it, index it and add policies to it, and the very first
   migration in the history (`20250815225910`) opens by dropping one of its policies —
   so it predates the migration history and was created outside it. Reconstruct its
   `CREATE TABLE` from the ALTERs the history does carry and land it as a
   `CREATE TABLE IF NOT EXISTS`, so a fresh database can be built from
   `supabase/migrations/` alone. Do NOT drop or recreate it in place.
   `check.mjs` must fail on any future table in this class (§8 WP 1.4 step 2's
   "a code-referenced table has no migration" already covers it — make sure
   `approved_users` is what proves the rule fires).
4. Wire into CI. The job must run `contract:check`, `check:docs` and `npm test`
   **directly, not through `npm run lint`** — `lint` is red at baseline (342 errors),
   so a gate hidden behind it is a gate nobody reads. Merge `5c7129f` took
   `check:docs` from green to 13 orphan citations and broke `resolveCell` at runtime
   without failing anything; see §16's precondition entry.
5. Add the §2.1 invariants and the §5.3 commitments to `CLAUDE.md`.

**Exit checks** — `npm run contract:check` green · a scratch column makes it fail ·
one page per covered table · no orphans remain.

**Gap check** — open a throwaway PR to confirm the gate actually runs. A gate that is
not wired is not a gate; record the CI run URL.

---

## 9. Phase 2 — Governance consolidation

### WP 2.1 — One organization identity *(D13)*

Backfill `approved_users.organization_id`; add `projects.organization_id uuid`; add
`get_current_user_org_id()`; migrate every text comparison; dual-read during
transition; fix the `organizations` RLS which self-bridges by name/slug string match;
retire or document `user_plant_access`.

**Inventory first:** `grep -rn "get_current_user_org()" supabase/ | wc -l` — it sizes
the WP.
**Exit** — renaming an org changes nothing about access (write this test first) ·
`organization_id` non-null for 100 % of rows · no new text comparison.
**Gap check** — grep for survivors including edge functions and the public API.

### WP 2.2 — Project membership and the resolver *(D14)*

`project_members(project_id, user_id, project_role, granted_by, expires_at,
rationale)` with `owner | editor | analyst | viewer`; backfill `modeler_id` → owner.
Extend `capabilities_for_user()` to **role → org → project → user**, preserving its
explicit `_user_id` and non-deniable `/profile`. Add `delegation_grants` —
subtractive and expiring, enforced in the RPC. Split `data_editing` into
`data_edit_inputs` (T2) and `data_edit_policies` (T4).

**Exit** — a viewer on project A cannot read B · an expired grant stops granting · a
grant exceeding the grantor's level is rejected.
**Gap check** — hand-walk four cases (super-admin; org admin + project deny; user
allow over org deny; expired grant) and record the truth table.

### WP 2.3 — Data-plane audit *(D15)*

Generalize `admin_audit_logs` → `audit_logs` with `plane ∈ (admin, data, access)`,
same column shape; migrate existing rows to `admin`; org admins read their own org's
`data`/`access` rows. Emit on every tier transition: promote, ETL, override write,
dataset delete, analysis run.

**Transparency (§5.2):** make **export** a governed action — check the `export`
capability and audit it, or A4 becomes an exfiltration path.
**Exit** — every T2 write in a smoke run appears in `audit_logs` · admin history
intact.
**Gap check** — inventory every write path to T2/T3/T4 and tick whether it audits.

### WP 2.4 — Contract-generated RLS tests

Generate role × table × operation assertions from each table's `governance` block;
run against a seeded project with one user per role. **Tests must exercise the RPC
path**, not only `.from()` — the lane tables' RLS is known not to survive PostgREST
pooling under this app's custom auth (see `projectLanes.ts` header). Flip the
natural-key rule to error.

**Gap check** — this one is a security review: a real policy broader than the
contract claims is a finding to fix **in this WP**.

---

## 10. Phase 3 — One ingestion contract

### WP 3.1 — `ingest_*` generalization *(D20)*

Rename `erp_staged_*` → `ingest_staged_*` adding `source_kind ∈ (csv, orbit-mrp,
api)` and `fact_class ∈ (master, transactional)`; `erp_sync_runs` → `ingest_runs`;
add `ingest_files` for Tier 0. You are renaming and widening, not redesigning — read
the `COMMENT ON TABLE` blocks, they state the intent. Fix D20 while here
(`GradingDataset.truncated` is the pattern).

**Watch:** `delete-project/index.ts:173` enumerates table names by hand.
**Exit** — an MRP sync still stages, diffs and promotes identically (write this
regression test **before** renaming).

### WP 3.2 — Server-side parse and Tier 0/1 landing *(D6, D7, D8)*

New `ingest-file` edge function. Upload → Tier 0 + open a run → **server-side** parse
with a real CSV parser → contract-driven validation → rows land in staging with
`fact_class`. `UploadWizard` becomes an uploader + status view; **delete the
client-side parse**, no flag.

Copy the trim/empty-check pattern from `ingest-bom-multi-level/index.ts:42-44` — do
not invent a third.
**Exit** — a quoted comma round-trips intact · blank `volume` is rejected with a
row-level finding · `" MAT-1 "` and `"MAT-1"` resolve to one id · a semicolon file is
rejected clearly.
**Gap check** — re-run the full parse trace (BOM, CRLF, trailing comma, fewer/more
fields) and record the new behaviour as the regression baseline.

### WP 3.3 — Natural keys, upsert, normalization at promotion *(D5)*

Deduplicate first (report counts), then `CREATE UNIQUE INDEX` on all four lane
tables; promotion becomes an audited upsert in one transaction; **normalize units at
promotion** (I3); add `ingest_run_id` + `source_row_id` to T2 — which is what extends
A4 down to the source file; flip `check.mjs` to error.

**Dedup will change numbers.** That is D5 damage being undone — record before/after
in §16 so nobody later reads it as a regression. Dedup in its own commit.
**Exit** — uploading the same file twice is a no-op · every T2 row traces to a run.

### WP 3.4 — Diff, review, promote UI

Compute `diff_state`; review screen with counts, findings and the real diff, modelled
on the MRP mapping report (reuse `MappingWarningsCard`'s badge vocabulary); promote
requires role ≥ editor and audits; show provenance on canonical rows.

**Exit** — a user can click from a cell through to the source row · promotion by an
analyst is refused · **one** component serves both CSV and MRP runs.
**Gap check** — any branch on `source_kind` beyond labels means WP 3.1 was incomplete.

---

## 11. Phase 4 — Trust anchor and analysis store

### WP 4.1 — Complete and compose `graph_hash` *(D11)*

Add `bom_multi_level` and the network tables to `_build_dataset_snapshot`; split into
`hash_inputs` / `hash_network` plus a composite `graph_hash` (keep the name and its
place in `simulation_runs`); bump `schema_version`.

**Exit** — editing a multi-level BOM moves the hash (failing test first) · existing
runs still resolve their `dataset_version_id`.
**Gap check** — table-by-table coverage list of every T2 table against the snapshot.

### WP 4.2 — The analysis store *(D12, D19)*

```
analysis_runs(id, project_id, analysis_kind, input_hash, params_hash, code_version,
              status, started_at, finished_at, duration_ms, row_counts jsonb,
              warnings jsonb, actor_user_id,
              UNIQUE (project_id, analysis_kind, input_hash, params_hash, code_version))
analysis_results(run_id, entity_type, entity_id, metrics jsonb)
```

`analysis_kind` is an **open** enum with a params schema in the contract, so
`lead_time_fit` needs no migration later. Shared `getOrCompute(...)`: lookup by key,
return on hit, compute and persist on miss — **never update, never delete**. Audit
each run. Deprecate `should_recalculate_network_metrics` in place with a comment
naming D12.

**Exit** — repeat request on an unchanged project is a hit with zero compute · a
changed input is a miss, not a stale hit · reverting re-hits the original · two
`code_version`s coexist.
**Gap check** — test concurrency: two parallel requests on a cold key must not create
two runs.

### WP 4.3 — Migrate the four analyzers (dual-write)

`calculate-network-science-metrics`, `calculate-node-prominence`,
`predict-critical-nodes`, `project-ai-health`, plus `combine-project` as
`analysis_kind='combine_etl'`. Each writes **both** destinations and gains a
`code_version`. Add `computed_from_hash` + `computed_at` to every T3 table.

**Do not drop any entity column here** — WP 5.3 does that, after every reader has
moved. Dropping early is what makes this irreversible.
**Gap check** — field-by-field numeric comparison old vs new on a real project.

### WP 4.4 — Staleness, invalidation, and the Trust Report

Add `seeded_from_hash` to `policy_overrides`. **One** staleness rule everywhere:
stale iff `computed_from_hash <> current_graph_hash()`; delete the three ad-hoc ones.
A re-upload flags stale seeded overrides. Freshness badge: dataset version, hash
prefix, computed-at, stale flag.

**Transparency (A3):** assemble the **Project Data Trust Report** from what
`grading.ts` already computes — coverage, blocking findings, neutral-constant
substitutions, derived values, per-table freshness, ingest history, and the **Known
limits** block (§5.4).

Note: the engine reads policy overrides, not the grid — a stale override is a
simulation-correctness problem, say so in the UI copy.
**Gap check** — grep for any surviving timestamp-comparison staleness logic.

---

## 12. Phase 5 — Lineage and published documentation

### WP 5.1 — Surfaces (lineage) block
Static analysis over `useStageRows`, `useItemMasters`, `projectLanes` and the
`.rpc()`/`.from()`/`invoke()` calls in `src/pages/*.tsx` → `surfaces[]` per field;
**human-confirmed** (an unconfirmed lineage entry is worse than none — it will be
trusted). Regenerate `docs/data/tables/*.md` with lineage.
**Gap check** — every page in `src/pages/` appears in a `surfaces` entry, or is
explicitly marked as reading no project data.

### WP 5.2 — The manual (§6.3)

~77 pages. Sequenced so every sub-package ships a coherent, usable section rather
than a scattering of stubs.

| Sub | Ships | Pages | Depends on |
|---|---|---|---|
| **5.2a** | Shell + **Overview & architecture** + Getting started. Un-hide `/docs` (`App.tsx:212-214`), rewrite `registry.ts` for the 15-section tree, move the figure SVGs into the repo | ~10 | nothing |
| **5.2b** | **Input tables** — the reference section, the core of the manual. **Closes D21** | 11 + 2 | WP 1.2, 1.3 |
| **5.2c** | Policies + Verification | 12 | WP 1.2; catalog already renders |
| **5.2d** | Experiments, scenarios, results, statistics | 12 | WP 4.4 |
| **5.2e** | Networks + Project Intelligence | 9 | WP 5.1 lineage |
| **5.2f** | Computed tables + Exports & reproducibility | 7 | WP 4.1, 4.4 |
| **5.2g** | Connectors + Access & administration + Developer API | 14 | WP 2.2, 3.1 |
| **5.2h** | Reference — all-tables detail index, units, glossary, field index | 4 | WP 1.2 |

**5.2a is shippable before Phase 1 and is now the most valuable single package in
the plan.** It ships the architecture section — the answer to *how is this built and
can I trust it* — plus Getting started and the full nav tree. None of it needs the
contract. Everything after it is a drop-in.

**5.2b is the one that matters.** It is the section anyLogistix users would
recognize, and the section SuReSuite has never had.

**Exit** — no table or field list is hand-written in `src/` · mobile and desktop read
one payload · every generated page carries its provenance footer · every route in
`App.tsx` and every user-facing table in §6.3 has a page or is listed as
internal-only.
**Gap check** — diff the §6.3 inventory against the live schema and `App.tsx`; a
table or route with no page and no internal-only justification is a finding.

### WP 5.3 — Pages read `analysis_results`; drop entity columns
Migrate readers one page per commit, comparing values before switching; drop entity
columns only after confirming no reader remains, in a **separate** commit. Remove the
downstream unit conversions made dead by WP 3.3.
**If budget runs short:** migrate fewer pages fully rather than all pages partially.

---

## 13. Phase 6 — Policy contract, researcher grade

### WP 6.1 — Resolution chains, documented and pinned
For every grid field: CSV column → DB column → RPC → hook → substitution → engine
field → unit at each hop. Pin with parity fixtures in `grading.ts` style. **A chain
you cannot write down is a bug** — list those rather than inventing prose; the list
feeds WP 6.2.

### WP 6.2 — Fix the divergences *(D17, D18; D16 closed in WP 0.1)*
D17 (NULL capacity renders `0` with no dot — `liveDefault = derivedVal ?? 0`),
D18 (`material_price` consumed nowhere; mark read-only or map it to `materials.cost`),
the `cheapestInboundCost` (floors ≤0 to 1.0) vs `resolveField` (imputes an average)
divergence, and `ensure_item_masters` unioning `bom_single_level` only.
**De-duplicate `StagePolicyTable.tsx:1206-1265` against `resolveCell`** — carried in
lockstep since WP 0.1; this is where that debt is paid.

**Added by the WP 0.1 gap check** — three more divergences, all evidenced in §16:
- `columnSpecs.defaultWhenMissing` is **dead for every field the Zod bundle also
  declares** (`bundleVal` is checked first and a parsed bundle always has the key),
  so it is a second default table that only ever speaks when it disagrees by
  accident. `safety_stock_days: 0` vs the bundle's `7` is exactly that. Delete the
  redundant entries or make the bundle read from them — one table, not two.
- **Seven policy-bundle fields are stored, versioned and hashed into `policy_hash`
  but rendered by no column and read by no engine mapping**: `supplier_capacity_per_day`,
  `ordering_cost`, `moq`, `lead_time_distribution` (sourcing/inventory/transport) and
  `capacity_machine_per_day`, `capacity_labor_per_day`, `production_cost_per_unit`
  (production). Same class as D18, one step worse — D18's field is at least shown.
- The plant stage computes `production_lead_time_mean_days` with full provenance
  (real median, else imputed) and **no plant column spec declares it**, so the one
  project-backed signal the plant stage has never reaches the user or the overrides.
  Either give it a column or stop computing it.

### WP 6.3 — Provenance vocabulary, value chain, reproducibility record
Complete the A1 vocabulary. Ship **A2** the value-chain popover (source file → row →
uploader → approver → unit → engine transform → substitutions → freshness → what
would change it), the **A3** Trust Report PDF/JSON via `report-render`, and **A5** the
Reproducibility Record (dataset, policy, scenario, engine and analysis versions plus
declared limits). Deep-link grid → P3 and the legend → P5.

**Exit — the §5.4 acceptance test.**

---

## 14. Deferred — Phase 7+ and engine RFCs

Not scheduled. Additive. See figures 06–11.

- **Tier 2-O `observations`** — append-only, bitemporal (`valid_time` +
  `recorded_at`), partitioned monthly, joined to T2 by the same arc keys.
- **Estimators** as `analysis_kind` (`lead_time_fit`, `demand_fit`,
  `reliability_fit`), recording n, window and fit quality.
- **`as_of` reproducibility** — runs pin `(as_of, graph_hash)`.
- **Backtesting** — fit window → simulate hold-out → compare to actuals.
- **Conflict findings** — contract vs observed gap, with a recorded choice.

**Reservations already made** (~2 days, inside Phases 1–6): the `2-O` tier name, the
`observations` schema name, `grain` per field, open `analysis_kind`, and the
`estimated` / `contract` provenance states.

### Engine RFCs — separate `scsim` track, not this plan
1. **`cost_dist` + `cost_cv` on `SupplierLink`.** Price is a bare scalar; volatility
   cannot be modelled. Structurally identical to the proven
   `lead_time_dist`/`lead_time_cv` pair. Interim: scenario sweep over fitted quantiles.
2. **M7 — `LeadTimeDist.EMPIRICAL`.** Already in the enum; the compiler rejects it
   with *"lands with the data-import path (M7)"*. Implementable once observations exist.
3. **Non-stationarity.** The engine is steady-state — no calendar, no time-varying
   parameters. `projects.simulation_start/end` exist but never reach it. Until this
   lands, fitted parameters describe the window they were fitted on, and the UI must
   show that window beside the number.

---

## 15. Verification SQL

Run against one project before Phase 0 and after each phase; record counts in §16.

```sql
\set pid '00000000-0000-0000-0000-000000000000'

-- D8: blank / untrimmed / case-variant ids
SELECT id, '['||supplier_id||']' sup, '['||material_id||']' mat
FROM inbound_logistics WHERE project_id = :'pid'
  AND (supplier_id IS NULL OR btrim(supplier_id) = ''
    OR material_id IS NULL OR btrim(material_id) = ''
    OR supplier_id <> btrim(supplier_id) OR material_id <> btrim(material_id));

SELECT lower(btrim(material_id)) norm, count(DISTINCT material_id) variants,
       array_agg(DISTINCT material_id) spellings
FROM inbound_logistics WHERE project_id = :'pid'
GROUP BY 1 HAVING count(DISTINCT material_id) > 1;

-- D6: field-shift signature from an unquoted comma
SELECT id, supplier_id, material_id, volume, time_unit
FROM inbound_logistics WHERE project_id = :'pid'
  AND (supplier_id LIKE '%"%' OR material_id LIKE '%"%' OR time_unit LIKE '%"%');

-- D7: blank numerics that passed validation
SELECT count(*) FILTER (WHERE volume     IS NULL) null_volume,
       count(*) FILTER (WHERE lead_time  IS NULL) null_lead_time,
       count(*) FILTER (WHERE unit_price IS NULL) null_price,
       count(*) FILTER (WHERE unit_price <= 0)    nonpositive_price,
       count(*) AS total
FROM inbound_logistics WHERE project_id = :'pid';

-- D5: duplicate arcs
SELECT supplier_id, material_id, volume, unit_price, count(*) copies
FROM inbound_logistics WHERE project_id = :'pid'
GROUP BY 1,2,3,4 HAVING count(*) > 1 ORDER BY copies DESC;

-- D2/D10: mixed time_units — sourcing_ratio is meaningless where this returns rows
SELECT material_id, count(DISTINCT lower(btrim(coalesce(time_unit,'<null>')))) units,
       array_agg(DISTINCT time_unit) seen
FROM inbound_logistics WHERE project_id = :'pid'
GROUP BY 1 HAVING count(DISTINCT lower(btrim(coalesce(time_unit,'<null>')))) > 1;

-- unrecognized time_unit → silently weekly
SELECT DISTINCT time_unit FROM inbound_logistics
WHERE project_id = :'pid' AND lower(btrim(coalesce(time_unit,''))) NOT IN
 ('day','days','d','daily','week','weeks','wk','w','weekly','month','months','mo','m',
  'monthly','quarter','quarters','quarterly','year','years','yr','y','yearly',
  'annual','annually');

-- D3 / plant_name drift: arcs whose plant matches no BOM row
SELECT DISTINCT i.plant_name FROM inbound_logistics i WHERE i.project_id = :'pid'
  AND NOT EXISTS (SELECT 1 FROM bom_single_level b
                  WHERE b.project_id = i.project_id AND b.plant_name = i.plant_name)
  AND NOT EXISTS (SELECT 1 FROM bom_multi_level m
                  WHERE m.project_id = i.project_id AND m.plant_name = i.plant_name);

-- D2/D3 headline: inbound rows that reached the grid with weighted = 0
SELECT data_source, count(*) total,
       count(*) FILTER (WHERE weighted = 0 OR weighted IS NULL) zero_weighted
FROM supply_chain_data WHERE project_id = :'pid' GROUP BY 1;

-- shares that don't sum to 1 per material
SELECT to_location material_id, round(sum(sourcing_ratio),4) total_share, count(*) arcs
FROM supply_chain_data WHERE project_id = :'pid' AND data_source = 'inbound'
GROUP BY 1 HAVING abs(sum(sourcing_ratio) - 1.0) > 0.0001;

-- masters missing for multi-level BOM materials
SELECT DISTINCT m.material_id FROM bom_multi_level m WHERE m.project_id = :'pid'
  AND NOT EXISTS (SELECT 1 FROM materials mm
                  WHERE mm.project_id = m.project_id AND mm.material_id = m.material_id);

-- D17: suppliers the grid renders as capacity 0 (means unlimited)
SELECT count(*) FILTER (WHERE capacity_per_week IS NULL) shown_as_zero_but_unlimited,
       count(*) total FROM suppliers WHERE project_id = :'pid';

-- D1: auto-seeded zeros
SELECT target_key, family, patch FROM policy_overrides
WHERE family = 'inventory' AND patch ? 'safety_stock_days'
  AND (patch->>'safety_stock_days')::numeric = 0 LIMIT 50;

-- D3/D4: confirm the orphan tables are genuinely absent
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('product_code_map','risk_data');
```

---

## 16. Drift log

Append after every gap check. Newest last. Never delete an entry — a superseded
finding is struck through with a pointer to the entry that replaced it.

```
### WP <id> — <title>          <date>  <commit>

Preconditions held?      yes / no — <what differed>
Exit checks passed?      yes / no
Discovered:
  - <finding> → affects <WP id> → <plan edit made in this commit>
Baseline numbers (if run):
  - <query> → <count>
Handoff to next WP:
  - <what the next package must know that it could not learn from the code>
```

### WP 0.3 — Documentation consolidation · 2026-09-15 · `719f59b`

Preconditions held? n/a — ran ahead of WP 0.1/0.2 to unblock the documentation plan.
Exit checks passed? partial — archive done; the `docs/` file moves and the CLAUDE.md
rule remain (see §7 WP 0.3 "Remaining").

Discovered:
- **D21** — the legacy docs named engine fields, not the user's CSV headers
  (`sell_price`→`unit_price`, `demand_mean`→`demand_mode`,
  `demand_distribution`→`demand_model`). → affects **WP 1.2**: `ingest.csv_header`
  is now a required sidecar field, and **WP 5.2b** leads P3 with it. Plan edited.
- **D22** — `SIM_PARAM_GROUPS` hand-copied the Pydantic models while `gen_docs.py`
  already renders them under a CI gate. → confirms Rule 2; no further action.
- `src/components/docs/DocsLayout.tsx` imports `@/components/docs/registry`, so
  `registry.ts` must stay in `src/`. Archived it briefly and had to restore it —
  typecheck is the guard. → affects **WP 5.2a**: rewrite its entries in place.

Handoff to next WP:
- `/help` and `/help/:slug` still route to `NotFound` (`App.tsx:212-214`). WP 5.2a
  reverts that; nothing before it should.
- `docBodies.tsx` is archived, not deleted. Mine the narrative listed in §6.6; do not
  revive the generated-duplicate sections.
```

### WP 0.1 — Kill the silent policy override · 2026-09-15 · `4ec6fa6`

Preconditions held? **partly — one did not.** The three constants the brief said had
no `ColSpec` (`supplier_capacity_per_day`, `ordering_cost`, `lead_time_distribution`)
indeed have none, and `safety_stock_days` indeed has one; but the block held a
**fifth** constant the brief did not name, `moq: 0`, which also has no supplier
`ColSpec` (`material_moq` is the rendered column, and it is item-master-backed).
Deleted with the rest. The `StagePolicyTable` facts held exactly: `applyPrefill()`
un-awaited with `setApplying(true)` after the row loop, a single-slot
`${projectId}::${stageKey}` marker, and a verbatim copy of `resolveCell`'s
provenance block. D1 was verified by reading, not by running: this environment has
no Supabase project, so `policy_overrides` could not be inspected — the write path
(`applyPrefill` → every non-master `ColSpec` field → `bulkUpsertOverrides`) and the
engine default (`project_map.py:783` → `fixed_days_cover`, 7.0) were traced in code
instead.

Exit checks passed? **three of four, mechanically.**
- `npm test` green — 26 tests, 3 files (11 new in `prefillProvenance.test.ts`).
- no override for an unsupplied `safety_stock_days` — pinned by unit test on
  `isPrefillPersistable`, the extracted rule the grid now calls.
- no green dot on it — pinned by unit test on `resolveCell` (`default`, not `data`),
  including the pre-WP shape (a constant sitting on the row).
- **auto-seed fires at most once per `(project, stage)` across a tab round trip —
  verified by reading, not by test.** The repo has no DOM test tooling (no jsdom, no
  testing-library; `vitest` alone), so a component test would have meant adding
  dependencies. The two causes are both closed in code: the marker is a `Set`, and
  `applying` is raised synchronously before the first row. Stated rather than
  weakened — whoever adds DOM tooling should pin this.

Decision recorded — **drop the constants, do not tag them.** Tagging would need a
second registry of "fields that exist but are not data", which is a parallel source
of truth (I1, blueprint §6.2). Four of the five were invisible anyway: no `ColSpec`
declares them, so they never rendered, were never editable, and were never persisted
(the prefill iterates `ColSpec` cols). The fifth, `safety_stock_days`, now resolves
live through the bundle's `7` — which is the engine's own default — instead of a
frozen `0`. Deleting is also the only fix a test can enforce; the third test in the
new file greps `useStageRows.tsx` for `field: <literal>` against every `col()` field
and fails on any new constant.

Gap check — every `col(` field in `columnSpecs.ts` against the row object literals in
`useStageRows.tsx`, after the fix:

| stage | row ∩ spec | row-only | spec fields |
|---|---|---|---|
| supplier | `primary_source`, `material_price` | keys only | 19 |
| plant | **(none)** | `production_lead_time_mean_days` | 19 |
| customer | `primary_source`, `sourcing_firm` | keys only | 2 |

Discovered:
- **The plant stage has zero overlap.** Its one project-backed value,
  `production_lead_time_mean_days`, is computed through `resolveField` with full
  real/imputed provenance and then discarded — no plant `ColSpec` declares it.
  → affects **WP 6.2** → plan edited (give it a column or stop computing it).
- **Plant auto-seed now persists nothing**, and that is the correct outcome: every
  plant field the prefill used to write (`capacity_units_per_day`, `type`, `basis`,
  `reorder_point: 50`, `order_up_to: 200`, `safety_stock_days`, `holding_cost_pct`,
  `service_level_target`, `fg_*`) was a pure bundle default. It was D1 at the plant
  stage, unlisted. Consequence handled here: a fifth banner state,
  `none_applicable` — "uploaded data says nothing about these columns — bundle
  defaults" — so the stage does not sit under a permanent "uploaded data not
  applied" telling the user to press a button that does nothing.
- **The customer stage now auto-seeds, and did not before.** `hasRealProjectData`
  (`StagePolicyTable.tsx:799`) is "some row has a non-empty `__from_data`", and the
  customer builder created `prov` and never wrote to it — so the flag was always
  false there and the auto-seed effect never ran. Meanwhile `verification.ts:144`
  **blocks dispatch** when a customer×product has no primary firm in the saved
  bundle. Marking `sourcing_firm` / `primary_source` as project-backed (which step 2
  required) makes customer behave like supplier and closes that latent gap. This is
  a behavior change beyond D1/D16; it is recorded here rather than left implicit.
- **`columnSpecs.defaultWhenMissing` is dead wherever the Zod bundle also declares
  the field** — `resolveCell` checks `bundleVal` first and a parsed bundle always
  has the key. `safety_stock_days: 0` there versus the bundle's `7` is a divergence
  that only fails to bite because it never speaks. → affects **WP 6.2** → plan
  edited.
- **Seven bundle fields are stored, versioned and hashed into `policy_hash` while
  being rendered by nothing and read by no engine mapping**: `supplier_capacity_per_day`,
  `ordering_cost`, `moq`, `lead_time_distribution`, `capacity_machine_per_day`,
  `capacity_labor_per_day`, `production_cost_per_unit`. Checked directly:
  `grep` of `project_map.py` returns 0 for all but `moq`, and `moq`'s two hits read
  the **materials master row** (`:431`), not the policy bundle. → affects **WP 6.2**
  → plan edited.
- `npm run lint` is red on this repo **before** this change and equally red after —
  457 problems (342 errors, 115 warnings), identical counts with the diff stashed.
  `useStageRows.tsx` carries a file-level `@ts-nocheck`. Not this WP's to fix; noted
  so the next package does not read the red as its own. `npm run check:docs` passes.

Baseline numbers: none — no Supabase project reachable from this environment. The
§15 queries are WP 0.2's gap check; they still need a real project.

Handoff to next WP:
- **The two provenance copies are now more alike, not less.** `resolveCell`
  (`resolveEffective.ts:103-180`) and the cell renderer
  (`StagePolicyTable.tsx:1206-1265`) received the identical edit and each carries a
  comment naming the other. **They must stay in lockstep until WP 6.2 de-duplicates
  them** — a fix to one that skips the other means the mobile stage list and the
  desktop grid disagree about where a value came from. Nothing before WP 6.2 should
  de-duplicate them; nothing before WP 6.2 may edit one alone.
- `__from_data` now means "the project data said this", **including decisions its
  shape made** (`markFromData`, `useStageRows.tsx:183-190`), not only "an uploaded
  column held this". `__imputed` is unchanged. Anything reading `__from_data` —
  `hasRealProjectData`, the prefill, both provenance copies — inherits that widening.
- The prefill rule is extracted and testable: `isPrefillPersistable`
  (`resolveEffective.ts:202-214`). Do not re-inline it; WP 6.1/6.2 will want to
  quote it when documenting resolution chains.
- `applyPrefill` now takes `{ silent }`. The auto-seed passes it, so seeding no
  longer toasts; the explicit "Apply prefill" dialog still does.
- WP 0.2 is unblocked and untouched by this: no file it lists was edited.

### WP 0.2 — Unit conversion + orphan-table honesty · 2026-09-15 · `c07ac98`

Preconditions held? **yes, with two corrections.**
- `// @ts-nocheck` at `combine-project/index.ts:1`, `rateToWeekly` dependency-free in
  `_shared/grading.ts`, `product_code_map` destructuring only `{ data }`, and both
  `risk_data` reads with quoted column names — all confirmed by reading.
- **Correction 1: there are EIGHT raw `volume` reads, not seven.** The brief's list
  missed `:310` (`(row.volume || 0) / totalMaterialVolume` in the multi-tier inbound
  loop), which is a *share* denominator — exactly the class of use the WP exists to
  fix. `:115` is not itself a read: it consumes `productDemandByPlant`, so converting
  `:60` fixes it transitively. All eight sites are converted.
- **Correction 2: the `risk_data` error was not fully swallowed.** Both pages already
  `console.warn` it. What was missing — and what this WP added — is the *UI notice*;
  an empty risk map renders every node's risk as "Unknown", which reads as an answer.

Exit checks passed? **two of three; the third could not be run.**
- ✅ Unit test: two arcs, one `week` one `year`, the same physical volume → identical
  `sourcing_ratio` (0.5 / 0.5). The same test shows the pre-fix arithmetic gave
  2 % / 98 %, i.e. the ETL named the wrong primary supplier.
- ✅ Both pages show `RiskDataNotice` when `risk_data` is unavailable or empty.
- ⚠️ **`supply_chain_data.weighted` non-zero where keys match — NOT VERIFIED.** It
  requires a database. See below.

`npm test` 40/40 (10 new). `npm run lint`: 340 errors / 115 warnings vs. the 342/115
baseline — this WP *removed* two (`prefer-const` in the ETL) and added none.
`audit:ui` unchanged (the one pre-existing `MobileSheet.tsx:169` violation).
`check:docs` passes. `tsc --noEmit` errors confined to the two pre-existing files.

Baseline numbers: **NONE. This session has no database access** — verified, not
assumed: no `SUPABASE_*`/`DATABASE_URL`/`POSTGRES_*` in the environment, and
`.env.production` holds only client feature flags. `psql` is installed but there is no
host, project ref or key to point it at. **Every §15 query is therefore unrun, and the
Phase 0 baseline does not exist.**

What that costs, stated plainly so it is not discovered later:
- No "before" counts for D5 (duplicate arcs), D6 (field shift), D7 (blank numerics),
  D8 (untrimmed ids) — Phase 3 has nothing to measure its fix against.
- The D2 headline query (`supply_chain_data` rows with `weighted = 0`) is the number
  that would have *proved* this WP's fix on real data. It is unrun.
- Overflow on `supply_chain_data.weighted` (`numeric(16,6)`, migration
  `20250816031317`) is bounded by ANALYSIS, not measurement: `rateToWeekly` multiplies
  by `7/unit_days`, so every unit coarser than a day SHRINKS the stored value
  (month ÷4.35, quarter ÷13, year ÷52.2) and only day-quoted rows grow, by exactly 7×.
  A day-quoted project therefore overflows only if its largest `weighted` already
  exceeded ~1.43e9 before this change. Pinned by a test over `UNIT_DAYS`.
  `supply_chain_data_multi_tier.weighted` is unconstrained `numeric` — no risk there.
- **Whoever next has database access must run §15 before Phase 1 exits** and append the
  counts here. Until then every "we improved X" in Phases 1–6 is unmeasured.

Discovered:
- **D25** — `combine-project`'s own core reads (`outbound_logistics`,
  `inbound_logistics`, `bom_single_level`, and each `bom_multi_level` PAGE) swallowed
  their errors exactly as `product_code_map` did. A failed read produced a graph
  missing a whole lane and still returned `success: true`; a failed *page* was worse —
  the pages already fetched would have been treated as the entire BOM. **Fixed here**
  rather than deferred: it is the same defect, in the same function, in the lines this
  WP was already editing, and the WP's theme is precisely that a silent failure must
  become loud. → added to §4 as D25, closed by WP 0.2.
- `product_code_map`'s failure now rides back on the response as `warnings[]`, not only
  a function log — §5 T2 requires a substitution to be visible at the point of display.
  **No UI reads `warnings` yet.** → affects **WP 1.4** (which decides the table's fate)
  and **WP 4.4** (the Trust Report, the natural home for it). Recorded, not built.
- Behaviour change, deliberate: the multi-tier inbound denominator was
  `totalVolumeByPlantMaterial.get(k) || 1`, so when a material had no measured flow the
  code divided by 1 and used a raw volume AS a ratio (always 0 in practice). It now
  uses the same `volumeShare` convention as the primary lane (total 0 → share 1.0).
  Note the standing wart this exposes, on BOTH lanes: N suppliers all quoting zero
  volume now each get share 1.0, so the §15 "shares sum to 1" query will flag them.
  That is the honest reading — a zero-volume material has no measurable split — but it
  is a convention, not a measurement. → affects **WP 3.3**.
- WP 0.1's `suggested` provenance and this WP's conversion interact: the policy grid's
  primary-supplier suggestion ranks by volume, so before this fix the dot said
  "suggested" over a ranking computed on mixed units. The suggestion is only as good
  as the ETL under it. → nothing to do; noted so WP 6.1 does not re-derive it.

Handoff to next WP:
- Unit normalization for the ETL now lives in `_shared/laneVolumes.ts`. It imports
  `rateToWeekly` from `grading.ts` — do NOT add a unit table to it (I3). WP 1.3's
  "one unit table" work should make `grading.ts` the generated artifact and leave
  `laneVolumes.ts` as a consumer.
- `combine-project` is reachable from vitest only through `_shared/` (the function
  itself imports `https://esm.sh/...`). Anything in it that needs a test has to move
  to `_shared/` first — that is why `laneVolumes.ts` exists.
- **Deno was not available in this session**, so the edge function was never
  `deno check`ed. It passes eslint and its imports are relative `.ts`, but the first
  real deploy is the first true typecheck.
- `runETLLogic` now returns `warnings: string[]`. Callers that spread its result should
  expect it.

### WP 0.3 — Documentation consolidation, finished · 2026-09-15 · `183a43c`

*(The archive half is the earlier entry above, `719f59b`. This is the remainder.)*

Preconditions held? **yes — the earlier entry's handoff was accurate.** Re-verified,
not assumed: `/help` and `/help/:slug` still route to `NotFound` (`App.tsx:213-214`);
`DocsLayout.tsx` still imports `@/components/docs/registry` and `registry.ts` is still
in `src/components/docs/`; `docBodies.tsx` (157 kB) is archived, not deleted, and was
not touched here — mining it stays WP 5.2a's.

Exit checks passed? **yes.** `check:docs` passes. `npm test` 40/40. `npm run lint` is
red only at its pre-existing baseline (see the WP 0.1 entry). Content moved verbatim —
`git mv`, so the moves show as renames and the history follows the file; the only new
prose is the banners and the README index.

What landed:
- `docs/data-simulation-mapping.md` → `docs/data/field-mapping.md` (AUTHORED)
- `docs/simulation-data-lifecycle.md` → `docs/data/lifecycle.md` (AUTHORED)
- Tombstones at both old paths (DEPRECATED → naming the successor)
- `CLAUDE.md`: a "The plan" section (PLAN.md is the single plan; §4 is the only
  authority for data-layer `file:line` evidence; `check:docs` enforces it; every WP
  ends with a gap check and a §16 entry) and the §2.1 invariants table

Discovered:
- **Tombstones are load-bearing, not politeness.** 27 files cite the old paths —
  `project_map.py`, `datamap.py`, `graph_cache.py`, `item_master.sql`,
  `20260712000001_product_demand_bounds.sql`, `columnSpecs.ts`, `dataMap.ts`,
  `paramMeta.ts`, `estimators.ts`, `useStageRows.tsx`, `DataMapGrid.tsx`, six design
  docs and the archived `docBodies.tsx`. Rewriting 27 files was not this WP's scope and
  would have buried the doc move in an unreviewable diff. → affects **WP 5.1**: its
  lineage work updates the citations and only then may the stubs go. Recorded in both
  stubs so nobody deletes them early.
- **Deviation from the brief, deliberate.** It said to leave `docs/data/README.md`
  alone. Its first line read *"generated table reference … **Do not edit anything
  here**"*, which became false the moment two AUTHORED pages landed beside the
  generated ones — a doc lying about its own directory, in the directory this plan
  created to end exactly that. Rewrote its index to carry a Status column; the section
  pointing at the plan is untouched.
- `App.tsx:212` carried `see CLAUDE.md task history` — CLAUDE.md has no task history and
  never did. Fixed in place to name the archive and WP 5.2a. Small, but it is the same
  failure as D21/D22 (a reference outliving its referent) in a code comment, and this
  WP is where it gets caught.
- **§2.1's invariant IDs `G1`–`G4` collide with the blueprint's gap IDs `G1`–`G18`.**
  Copying the table into `CLAUDE.md` put both numbering schemes on one page, where
  "G4" means "governance invariant" in one table and "no data-entry surface for the
  economics" in the other. Disambiguated with a note under the table rather than
  renumbering, which would invalidate every existing citation. → affects **WP 1.4**
  (which promotes the invariants to CI gates): pick gate names, not bare `G` numbers.

Handoff to next WP:
- Every page under `docs/data/` opens with a status banner. WP 1.4's generator must
  emit a **GENERATED** banner on each `tables/*.md`, or the directory goes back to
  being a guess.
- The tombstones stay until WP 5.1 updates the 27 citations. Do not delete them to
  tidy up; check `grep -rl data-simulation-mapping` first.
- `CLAUDE.md` now states the `check:docs` rule, so a future session has no excuse for
  citing `file:line` outside §4. When `check:docs` fails on a *derived* file, the fix
  is to update §4 first and the derived file second — never the other way round.

### Phase 1 precondition — repairing merge `5c7129f` · 2026-09-15

Not a work package. Phase 1's precondition is "Phase 0 is complete and its three
drift-log entries are in §16". Phase 0's *code* was complete; its *record* was not,
and the reason turned out to be worse than a missing note.

**What happened.** WP 0.1 was implemented twice, independently, on two branches —
`4ec6fa6` (`isPrefillPersistable` in `resolveEffective.ts`) and `415d579`
(`prefillSourceFor` in `prefillSelect.ts`). Merge `5c7129f` ("Merge branch 'main'
into claude/wizardly-archimedes-2ykyle") resolved the collision file by file rather
than implementation by implementation. Measured, not inferred:

| Artifact | At `183a43c` | At `5c7129f` |
|---|---|---|
| §16 `### WP 0.x` entries | 4 | **2** (WP 0.2 and WP 0.3-finished dropped) |
| `npm run check:docs` orphan citations | 0 | **13** |
| `decidedMap` in `resolveEffective.ts` | defined + used | **used, never defined** |

**The third row is the serious one.** `5c7129f` took `main`'s `resolveEffective.ts`
(which had neither the definition nor the use) but kept the other branch's
`suggested` provenance branch, which reads `decidedMap[col.field]`. The result
referenced an undefined binding inside `resolveCell` — so **every policy-grid cell
render threw a `ReferenceError`**, in both copies of the provenance logic. Five unit
tests were red on the branch and stayed red through PR #189. `origin/main` is clean
(it has neither), so the breakage exists only on the merge's descendants.

**Repaired here, before WP 1.1:**
1. `decidedMap` defined in both copies — `resolveEffective.ts:144-149` and
   `StagePolicyTable.tsx:1211-1212`. Edited together, as WP 0.1's handoff requires.
   `npm test` 51/51.
2. §16's two lost entries restored verbatim from `183a43c`, stamped with the commits
   that wrote them (`c07ac98`, `183a43c`).
3. §4's D2/D3/D4 rows restored to their post-WP-0.2 state — they had reverted to
   pre-fix evidence (`index.ts:96`, `ProductLevelNetwork.tsx:482`) while the fixed
   code sat in the tree.
4. §4.1's policy-grid table re-derived from the code rather than from either side of
   the merge. **Both sides were partly wrong**: `columnSpecs.ts:119-181`,
   `:132-171`, `:353` and `policyGridUi.tsx:15-41`, `:54` were right on the losing
   side; `useStageRows.tsx:208-…` and the `StagePolicyTable` spans were right on the
   winning one. Every number in that table was re-checked against the file.
5. `PLAN-PROMPTS.md` de-spliced — the WP 0.1 block carried two headers and both
   sets of stale citations; WP 6.1 and WP 6.2 each carried a bullet twice.
   `check:docs` green.

Discovered:
- **D26** — two live copies of the D1 prefill rule, both unit-tested, only one
  reachable (`prefillSelect.ts`'s is imported at `StagePolicyTable.tsx:53` and never
  called). Both suites pass, so the duplication is invisible to CI and the next edit
  to "the rule" has even odds of landing on the dead one. → added to §4 as D26,
  assigned to **WP 6.2**, which already owns de-duplicating the *other* pair.
  Not fixed here: deleting one is a behavioural choice between two implementations,
  which is WP 6.2's call, not a precondition repair's.
- **A merge can silently un-do a CI gate.** `check:docs` went from green to 13
  orphans inside one merge commit and nothing failed, because the gate runs under
  `npm run lint`, which is red at baseline (342 errors) and therefore not a gate
  anybody reads. → affects **WP 1.4**: wiring `contract:check` into a job that also
  runs `check:docs` and `npm test` directly — not through `lint` — is now part of
  that package. Plan edited (§8 WP 1.4).

Handoff to WP 1.1:
- **Do not trust a `file:line` in §4.1 that you have not re-checked** until WP 1.4's
  gate covers §4 itself. Two of the three documents in this repo that cite code were
  wrong about it this morning.
- The §15 baseline is still unrun and there is still no database in this
  environment — see WP 0.2's entry above. WP 1.1's gap check asks for a `\dt` diff
  against the live DB; expect to record that as not-run, not to skip it silently.
- `npm ci` is required before `npm test` in a fresh container; `node_modules` is not
  present at clone time.

### WP 1.1 — Schema introspector · 2026-09-15 · `1f77451`

Preconditions held? **no.** "Phase 0 complete" was true of the code and false of the
record; see the precondition entry above. Repaired before starting.

Exit checks passed? **seven of eight.** `npm run contract:verify` is the re-runnable
form; the eighth is a finding, not a failure to hide.

| Check | Result |
|---|---|
| four lane tables, three masters, `supply_chain_data`, `dataset_versions`, governance | ✓ 71 tables |
| `inbound_logistics` has no unique key beyond `id` (D5) | ✓ `column PRIMARY KEY(id)` only |
| `supply_chain_data.weighted` is `numeric(16,6)` | ✓ |
| orphans are exactly `product_code_map` + `risk_data` | ✗ **three** — see below |
| every DDL statement was read (introspector's own gate) | ✓ 0 unparsed |

**The hard part was harder than the brief.** The brief says `CREATE TABLE IF NOT
EXISTS` makes the FIRST definition win, so the lane tables carry `plant_id uuid`
(`20250820145017`) rather than `plant_name text` (`20250820145837`). Modelled that
way, the introspector produced a schema **nothing in the repo can write to**: every
`INSERT INTO public.inbound_logistics (…)` in the migration history names
`plant_name`, `ingest-inbound-logistics/index.ts:44` sends `plant_name`, and no
statement anywhere writes `plant_id`. `outbound_logistics` is the same story with
`expected_lead_time` against the first definition's `lead_time`.

The rule is not first-wins. **It is first-SUCCESSFUL-wins**, and a migration is one
transaction: if any statement raises, the file rolls back and every `CREATE TABLE` in
it is undone. `20250820145017` and its byte-identical retry `20250820145155` open
with

    ALTER TABLE public.approved_users
      ALTER COLUMN role TYPE public.app_role USING (...),
      ALTER COLUMN role SET DEFAULT 'user'::public.app_role;

against a column that already carries a text default — which Postgres rejects
("default for column cannot be cast automatically"). The proof that this is what
happened is in the repo: `20250820145652` is the next migration and it opens by
dropping that default first. It is the fix-up, so the two before it aborted. It in
turn declares `projects.plant_id`, which every later `INSERT INTO public.projects`
contradicts, so it aborted too.

Rather than hard-code that conclusion, the introspector **asks the migrations**: for
each shadowed `CREATE TABLE`, it compares both definitions against every
`INSERT INTO <table> (cols)` in the history. When the shadowed definition is
corroborated by all of them and the replayed one is contradicted by none, the file
that would have won is marked aborted and the replay is re-run without it — iterated
to a fixed point, because excluding a file promotes its retry. Mixed or absent
evidence adopts nothing and leaves the divergence open: a guess is worse than a
question. Result: **3 aborted migrations, 288 applied**, and lane tables that match
what the code writes.

Baseline numbers:
- 71 tables · 6 views · 4 enums · 231 functions · 8 shadowed definitions ·
  3 aborted migrations · 3 orphans · 1 phantom table · **0 unparsed statements**.
- 291 migration files on disk.

Discovered:
- **`approved_users` is a third orphan, and a different class from the other two.**
  Not a dead branch — the authentication table. 24 migration statements ALTER it,
  index it and add policies to it; `useAuth.tsx:82` and four admin pages read it;
  and the FIRST migration in the history (`20250815225910`) opens by dropping one of
  its policies. It was created outside `supabase/migrations/`, so the history cannot
  build a working database. → affects **WP 1.4** → plan edited (step 3 now names it
  and says reconstruct-from-ALTERs, not recreate).
- **`user_plant_access` and `plants` do not exist** — both dropped by
  `20250820172632`, along with `sim_scenarios` (`20260609000021`). §6.3 listed
  `user_plant_access` as an internal-only table to document. → §6.3 edited.
- **`for` and `tier` are confirmed parse artefacts**, as §6.3 suspected: neither
  appears among the 71 tables. → §6.3 edited, the entry struck rather than deleted.
- **`simulation_jobs` has an unresolved shadowed definition** (`20250914113723`
  would add `job_id`, `plant_name`, `current_stage`). No `INSERT` in the migrations
  names those columns, so the resolver correctly declined to adopt it and left it
  open. Not a simulation-path table, so not WP 1.2's twelve. → **WP 1.4** should
  decide it when `check.mjs` starts failing on undocumented columns.
- **`storage.from('avatars')` is not an orphan table.** The first cut of the orphan
  scan reported `avatars`, `workspace` and `secrets`, because `supabase.storage`
  sits on the line *above* `.from('avatars')` in `Profile.tsx`. Buckets and other
  schemas (`vault.secrets`, `storage.objects`) are now excluded by scanning the 120
  characters before each match across the whole file rather than line by line. Worth
  knowing: a line-local test of a `.from()` chain is wrong in this codebase.
- **The introspector has no authored input and must keep it that way.** Everything
  above is derived; the abort resolution is the one place where a hand-written
  "these migrations failed" list would have been easier and would have rotted. WP
  1.2's sidecars are the first authored layer — keep the boundary.

Gap check against the live DB: **not run — no database reachable.** Unchanged since
WP 0.2's entry: no `SUPABASE_*` / `DATABASE_URL` / `POSTGRES_*` in the environment.
So the second orphan class the brief anticipated (a table live but absent from
migrations) could not be enumerated from `\dt`. What it could be enumerated from is
the migrations' own internal contradictions, which is how `approved_users` surfaced —
but that catches only tables the migrations *mention*. A table that is live and
mentioned nowhere remains invisible to this WP.

Handoff to WP 1.2:
- **Read the lane tables' columns from `build/schema.introspected.json`, not from
  `20250820145837`, and not from the first `CREATE TABLE` you grep.** The artifact is
  the only place the abort resolution is applied. `inbound_logistics` is
  (`id`, `project_id`, `plant_name`, `supplier_id`, `material_id`, `volume`,
  `time_unit`, `lead_time`, `unit_price`, `created_at`, `updated_at`) — 11 columns,
  no `lead_time_unit` (that is WP 1.3's to add), and `outbound_logistics` says
  `expected_lead_time`, not `lead_time`.
- `natural_key_unique` is already computed per table, from all five sources (table
  and column `PRIMARY KEY`, table and column `UNIQUE`, unique indexes incl. partial).
  Copy it into the sidecars; do not re-derive it. It confirms the brief: the four
  lane tables have only `id`; `materials` / `products` / `suppliers` have composite
  primary keys.
- `build/` is git-ignored as a Python artifact directory. `.gitignore` now carries a
  narrow un-ignore for the two contract artifacts. If WP 1.4 emits anything else
  under `build/`, it must be added there too or the gate compares against nothing.
- `npm ci` before `npm test` in a fresh container.

---

## 17. Sequencing

| Phase | WPs | Focus | Blocks |
|---|---|---|---|
| 0 | 0.1 – 0.3 | stabilize, consolidate docs | everything |
| 1 | 1.1 – 1.4 | contract + CI gate | 2, 3, 5 |
| 2 | 2.1 – 2.4 | governance | 3 (promotion needs a role) |
| 3 | 3.1 – 3.4 | one ingestion contract | 4 |
| 4 | 4.1 – 4.4 | trust anchor + analysis store + Trust Report | 5 |
| 5 | 5.1 – 5.3 | lineage + the 77-page manual | 6 |
| 6 | 6.1 – 6.3 | policy contract, researcher grade | — |
| 7+ | deferred | observations, estimation, backtesting | — |

**26 work packages** (25 + the five 5.2 sub-packages counted as one).
Commit convention: `Phase N / WP N.M / <blueprint ref>: <title>`.

**Out of order by design:** WP 5.2a (P1, P5, un-hide `/docs`) needs nothing and can
ship at any time. It is the cheapest user-visible improvement in the plan.
