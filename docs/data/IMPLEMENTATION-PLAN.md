# The SuReSuite Data Spine

> **Status:** AUTHORED · approved architecture, not yet started
> **Baseline:** commit `d3cfc9d`
> **Figures:** https://claude.ai/artifact/4sXUGPiyCmpXGAfRp78mu1 *(11 diagrams)*
> **Execution:** `docs/data/PROMPTS.md` — one prompt per work package
> **Blueprint refs:** `docs/design/next-gen-platform-design.md` §2.3 G4–G6 · §8.1–8.4 · Phase A

**This is the single plan.** Architecture, defects, transparency standard, user
documentation and the work packages live here and nowhere else. `PROMPTS.md` is
execution mechanics only and cites this document by section and defect ID; it
restates nothing.

*(Supersedes `TRANSPARENCY.md` and `USER-DOCS-PLAN.md`, both folded in — they
duplicated facts stated here, which is the defect this plan exists to end.)*

---

## Contents

| § | |
|---|---|
| 1 | How to use this document |
| 2 | The architecture — the spine |
| 3 | What already exists, and is good |
| 4 | Confirmed defects |
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

Found by reading code, not docs. **This is the only place file:line evidence is
recorded.** Everything else cites the D-number.

| ID | Defect | Evidence | Closed by |
|---|---|---|---|
| D1 | Auto-seed persists `safety_stock_days = 0`, overriding the engine's 7-day default | `useStageRows.tsx:288` + `StagePolicyTable.tsx:844,887`; `project_map.py:783` | WP 0.1 |
| D2 | `combine-project` never converts `volume` by `time_unit` | `combine-project/index.ts:60,68,268,274` (+ `:115,:234-235,:318`) | WP 0.2 |
| D3 | `product_code_map` queried but exists in no migration; error swallowed | `combine-project/index.ts:96` | WP 0.2, 1.4 |
| D4 | `risk_data` queried by two network pages; no migration, no `project_id`, quoted column names | `ProductLevelNetwork.tsx:482`, `FirmLevelNetwork.tsx:283` | WP 0.2, 1.4 |
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
| D16 | Hardcoded constants render with "From project data" dot | `StagePolicyTable.tsx:1194-1203` | WP 0.1, 6.2 |
| D17 | NULL `capacity_per_week` (= unlimited) renders as `0`, no dot | `resolveEffective.ts:135` | WP 6.2 |
| D18 | `material_price` displayed prominently; consumed nowhere in the engine | `columnSpecs.ts:133,350` | WP 6.2 |
| D19 | Analysis results smeared onto entity columns; no identity or version | `network_nodes.degree_centrality` | WP 4.2, 4.3 |
| D20 | `projectLanes` fallback truncates at 10 000 rows silently | `projectLanes.ts:30-33` | WP 3.1 |
| **D21** | **User docs name fields the user never sees.** `products.csv` says `sell_price`/`demand_mean`/`demand_distribution`; the engine says `unit_price`/`demand_mode`/`demand_model`; the legacy docs showed the engine's names | `public/template/products.csv`; `item_master.sql:28-32`; `network.py:145,151,154` | WP 5.2b |
| D22 | Legacy docs hand-copied the Pydantic models while `gen_docs.py` already renders them from the registry | archived `docBodies.tsx` `SIM_PARAM_GROUPS` | WP 0.3 *(done)* |

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
| A1 | Provenance dot | *Is this real data?* | exists, partly lying (D16, D17) | 0.1, 6.2 |
| A2 | Value-chain popover | *Where did THIS number come from?* | missing | 6.3 |
| A3 | Project Data Trust Report | *Is this model built on good data?* | grading exists, unassembled | 4.4 |
| A4 | Verifiable export | *Can I check this without your app?* | **exists, strong** | 3.3 extends it |
| A5 | Reproducibility record | *Can I reproduce this in two years?* | missing | 6.3 |

**A1 vocabulary** after the plan lands:
`data · master · contract · estimated · imputed · derived · override · edited · default`.
Two rules the current implementation breaks: no dot may claim more than it knows
(D16), and a missing value must not render as a real one (D17).

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

### 6.3 The eight pages

Route group **"Your data"**, placed second in the nav — after Overview, before
anything written for modelers.

| | Page | What it carries | Source |
|---|---|---|---|
| **P1** | What happens to your data | The journey in plain language, one diagram. States T1–T5 in user language. The page a new user reads once and a buyer reads before signing. | written |
| **P2** | The files you upload | One card per dataset: purpose, exact header row, three example rows, template download, which columns may be blank, link to each column in P3. Replaces the 34-line `csv-upload-guide.md`. | generated |
| **P3** | **Field reference** | One entry per field at a stable URL. Leads with **the name the user typed**; unit in capitals where routinely misread; an **"if blank"** line; the three-name translation as an expandable aside. | generated |
| **P4** | When a value is missing | Every substitution in one table, plain language, with the dot it produces. Turns *"the system did something I didn't ask for"* into *"the system did what it said it would."* | generated |
| **P5** | Where a number came from | What the dots mean, in the reader's language; how to trace a value back. Deep-linked from the grid legend. | written |
| **P6** | What we calculate for you | The derived layer without jargon — sourcing shares, network metrics, rankings: what each is, which uploads it comes from, how to tell if it is current. | generated |
| **P7** | Who can see your data | Organization, project, roles, export, deletion. Written after Phase 2, because before then the honest version is uncomfortable. | written |
| **P8** | **How your data is structured** | **The spine, published.** The six tiers as the user's journey, the eleven figures, the invariants in plain language, and the known limits. For modelers, researchers and prospective customers who want to see the engineering. | written + generated diagram |

**P3 example** — the entry that has never existed:

```
lead_time                                          inbound_logistics

  What it is   How long this supplier takes to deliver this material,
               from order to arrival.
  Unit         WEEKS.  Not days. The time_unit column next to it
               describes the VOLUME period only — it does not apply here.
  Required     Yes.
  If blank     The simulation assumes 2 weeks and flags the row.
  Example      2
  Limits       Rounded to whole weeks, minimum 1, maximum 51.

  Also called  inbound_logistics.lead_time  (stored)
               SupplierLink.lead_time_weeks (simulation)          [expand]
  Used on      Policies → Supplier stage, "Lead time" column       [open]
```

### 6.4 Rules for all eight

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

### 6.5 Publishing the spine (P8)

The architecture is a selling point, not an internal secret. P8 publishes it:

- the six tiers, as the user's journey rather than as a schema
- the eleven figures, served from the repo rather than linked to a private artifact
- the invariants (§2.1) restated in plain language — *"we never change your numbers
  silently"* rather than *"I6: a fallback absent from the contract may not exist in
  code"*
- the **known limits** block, per T3 — steady-state engine, `graph_hash` v1 scope,
  no price-volatility model

The figures currently live in a published artifact. WP 5.2e moves their SVG into the
repo so the docs site has no external dependency and the diagrams version with the
code they describe.

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

### WP 0.1 — Kill the silent policy override *(D1, D16)*

**Preconditions** — branch off latest default. Verify D1 reproduces: open `/policies`
on a project with inbound data, confirm `policy_overrides` gains rows with
`patch->>'safety_stock_days' = '0'`.

**Files** — `src/hooks/useStageRows.tsx` · `src/components/policies/StagePolicyTable.tsx` ·
`src/lib/policies/resolveEffective.ts` · tests

**Steps**
1. Stop `useStageRows` writing hardcoded constants onto rows so they are
   indistinguishable from uploaded data. Preferred fix: do not write them at all —
   let `columnSpecs.defaultWhenMissing` supply them.
2. In `applyPrefill`, skip any field not present in `row.__from_data`.
3. Fix the auto-seed re-fire: `await applyPrefill()`, arm the in-flight flag before
   the row loop.
4. Provenance: a field neither tracked nor master resolves to `default`, not `data`
   — in **both** copies of the logic (they are duplicated; de-dup is WP 6.2).

**Exit checks** — `npm test` green · a row with no uploaded `safety_stock_days`
produces **no** override for that field · auto-seed fires at most once per
`(project, stage)` across a tab round trip · the grid shows no green dot on it.

**Gap check** — grep every `col(` field in `columnSpecs.ts` against the object
literals in `useStageRows.tsx`; record further collisions in §16.

### WP 0.2 — Unit conversion + orphan-table honesty *(D2, D3, D4)*

**Preconditions** — WP 0.1 merged. Verify D2 with the §15 mixed-unit query.

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

### WP 0.3 — Documentation consolidation ✅ *(done — `719f59b`)*

Archived `docBodies.tsx` + `HelpPage.tsx` to `docs/archive/legacy-help-site/` with a
README recording D21/D22 and what is worth mining. `docs/data/` established as the
single archive. **Remaining:** move `docs/data-simulation-mapping.md` and
`docs/simulation-data-lifecycle.md` in with status banners and tombstones, and add
the `docs/data/` rule to `CLAUDE.md`.

---

## 8. Phase 1 — The contract and its gate

### WP 1.1 — Schema introspector

**Preconditions** — Phase 0 complete.
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
4. Wire into CI. Add the §2.1 invariants and the §5.3 commitments to `CLAUDE.md`.

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

### WP 5.2 — The eight pages (§6.3)

| Sub | Ships | Depends on |
|---|---|---|
| **5.2a** | P1, P5 · un-hide `/docs` (`App.tsx:212-214`) · rewrite `registry.ts` entries | nothing |
| **5.2b** | P2, P3, P4 — generated; **closes D21** | WP 1.2, 1.3 |
| **5.2c** | P6 | WP 4.4 |
| **5.2d** | P7 | WP 2.2 |
| **5.2e** | P8 — publish the spine; move the figure SVGs into the repo | §6.5 |

**5.2a is shippable before Phase 1** and is the highest-value documentation work in
the plan: P1 and P5 need no contract and are the two pages a new user most needs.

**Exit** — no table or field list is hand-written in `src/` · mobile and desktop read
one payload · every generated page carries its provenance footer.
**Gap check** — work the WP 0.3 duplicate list to zero.

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

### WP 6.2 — Fix the divergences *(D16, D17, D18)*
D17 (NULL capacity renders `0` with no dot — `liveDefault = derivedVal ?? 0`),
D18 (`material_price` consumed nowhere; mark read-only or map it to `materials.cost`),
the `cheapestInboundCost` (floors ≤0 to 1.0) vs `resolveField` (imputes an average)
divergence, D16 residual, and `ensure_item_masters` unioning `bom_single_level` only.
**De-duplicate `StagePolicyTable.tsx:1170-1225` against `resolveCell`** — carried in
lockstep since WP 0.1; this is where that debt is paid.

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

*(no further entries — Phase 0 not started)*

---

## 17. Sequencing

| Phase | WPs | Focus | Blocks |
|---|---|---|---|
| 0 | 0.1 – 0.3 | stabilize, consolidate docs | everything |
| 1 | 1.1 – 1.4 | contract + CI gate | 2, 3, 5 |
| 2 | 2.1 – 2.4 | governance | 3 (promotion needs a role) |
| 3 | 3.1 – 3.4 | one ingestion contract | 4 |
| 4 | 4.1 – 4.4 | trust anchor + analysis store + Trust Report | 5 |
| 5 | 5.1 – 5.3 | lineage + the eight published pages | 6 |
| 6 | 6.1 – 6.3 | policy contract, researcher grade | — |
| 7+ | deferred | observations, estimation, backtesting | — |

**26 work packages** (25 + the five 5.2 sub-packages counted as one).
Commit convention: `Phase N / WP N.M / <blueprint ref>: <title>`.

**Out of order by design:** WP 5.2a (P1, P5, un-hide `/docs`) needs nothing and can
ship at any time. It is the cheapest user-visible improvement in the plan.
