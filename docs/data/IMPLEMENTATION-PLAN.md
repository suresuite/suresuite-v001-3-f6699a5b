# Data Spine — Implementation Plan

> **Status:** AUTHORED · approved architecture, not yet started
> **Baseline:** commit `d3cfc9d`
> **Figures:** https://claude.ai/artifact/4sXUGPiyCmpXGAfRp78mu1 *(all 11 diagrams)*
> **Companions:** `docs/data/TRANSPARENCY.md` (the standard) · `docs/data/PROMPTS.md` (execution)
> **Blueprint refs:** `docs/design/next-gen-platform-design.md` §2.3 G4–G6 · §8.1–8.4 · Phase A
>
> **Transparency is non-negotiable.** `TRANSPARENCY.md` defines the standard every
> WP below is measured against: *every number on screen answers where it came from,
> when it was computed, and what would change it — in one click.* Its §6 lists the
> ~3.5 days of additional work, folded into the WPs rather than added as a phase.

---

## 0. How to use this document

Work is decomposed into **work packages (WP)**, each sized to roughly **70 % of one
session at Opus 5 high effort**, leaving ~20 % headroom and ~10 % for the mandatory
gap check at the end of the package.

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
       · append findings to §9 Drift Log in this file
       · update the next WP's Preconditions if they changed
  5. write this WP's own Handoff note into §9
  6. commit with `Phase N / WP N.M: <title>`
```

**Rule:** if a gap check finds something that changes a later WP, **edit this file in
the same commit.** The plan and the code move together, exactly as CLAUDE.md requires
of the blueprint.

---

## 1. Architecture summary

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

**Three laws.** External data never lands below Tier 1. Tier 3 is always safe to drop
and rebuild. Tier 4 knows the hash it was seeded from.

### The invariants (to be added to CLAUDE.md in WP 1.4)

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

---

## 2. Confirmed defects driving this work

Found by reading code, not docs. Each has a WP that closes it.

| ID | Defect | Evidence | Closed by |
|---|---|---|---|
| D1 | Auto-seed persists `safety_stock_days = 0`, overriding the engine's 7-day default | `useStageRows.tsx:288` + `StagePolicyTable.tsx:844,887`; `project_map.py:783` | WP 0.1 |
| D2 | `combine-project` never converts `volume` by `time_unit` | `combine-project/index.ts:60,68,268,274` | WP 0.2 |
| D3 | `product_code_map` queried but exists in no migration; error swallowed | `combine-project/index.ts:96` | WP 0.2, WP 1.4 |
| D4 | `risk_data` queried by two network pages; no migration, no `project_id` | `ProductLevelNetwork.tsx:482`, `FirmLevelNetwork.tsx:283` | WP 0.2, WP 1.4 |
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
| D16 | Hardcoded constants render with "From project data" dot | `StagePolicyTable.tsx:1194-1203` | WP 0.1, WP 6.2 |
| D17 | NULL `capacity_per_week` (= unlimited) renders as `0`, no dot | `resolveEffective.ts:135` | WP 6.2 |
| D18 | `material_price` displayed prominently; consumed nowhere in the engine | `columnSpecs.ts:133,350` | WP 6.2 |
| D19 | Analysis results smeared onto entity columns; no identity or version | `network_nodes.degree_centrality` | WP 4.2, 4.3 |
| D20 | `projectLanes` fallback truncates at 10 000 rows silently | `projectLanes.ts:30-33` | WP 3.1 |

---

## 3. Phase 0 — Stabilize and consolidate

> **Goal:** stop the bleeding before documenting the model. Three WPs.

### WP 0.1 — Kill the silent policy override

**Preconditions**
- Branch `claude/busy-lovelace-5hxsh6` off latest default.
- Verify D1 still reproduces: open `/policies` on a project with inbound data, confirm
  `policy_overrides` gains rows with `patch->>'safety_stock_days' = '0'`.

**Files**
`src/hooks/useStageRows.tsx` · `src/components/policies/StagePolicyTable.tsx` ·
`src/lib/policies/resolveEffective.ts` · tests under `src/**/__tests__/`

**Steps**
1. In `useStageRows`, mark hardcoded row constants (`safety_stock_days`, `ordering_cost`,
   `moq`, `supplier_capacity_per_day`, `lead_time_distribution`) so they are **not**
   indistinguishable from uploaded data. Simplest correct fix: do not write them onto
   the row at all; let `columnSpecs.defaultWhenMissing` supply them.
2. In `applyPrefill`, skip any field not present in `row.__from_data`. One guard clause.
3. Fix the auto-seed re-fire: `await applyPrefill()`, and set the in-flight flag before
   the row loop, not after.
4. Provenance: a field that is neither tracked nor master resolves to `default`, not `data`
   (`StagePolicyTable.tsx:1203` and the mirrored branch in `resolveEffective.ts:155`).

**Exit checks**
- `npm test` green.
- New regression test: a stage row with no uploaded `safety_stock_days` produces **no**
  `policy_overrides` row for that field.
- New regression test: auto-seed fires at most once per `(project, stage)` across a
  stage-tab round trip.
- Manual: `/policies` shows `safety_stock_days` with no green dot and no persisted override.

**Gap check** — confirm nothing else in `useStageRows` writes a constant onto a row that a
`ColSpec` also declares. Grep every `col(` field name in `columnSpecs.ts` against the object
literals in `useStageRows.tsx`. Record any further collisions in §9.

---

### WP 0.2 — Unit conversion + orphan-table honesty

**Preconditions**
- WP 0.1 merged.
- Confirm D2: a project with mixed `time_unit` values produces `sourcing_ratio` that does
  not reflect physical volume (use the SQL in §8).

**Files**
`supabase/functions/combine-project/index.ts` ·
`supabase/functions/_shared/grading.ts` (import only) ·
`src/pages/ProductLevelNetwork.tsx` · `src/pages/FirmLevelNetwork.tsx`

**Steps**
1. Import `rateToWeekly` from `_shared/grading.ts` into `combine-project`. Apply at every
   `row.volume` read (`:60, :68, :268, :274`). Do **not** write a local copy — I3.
2. `product_code_map` (`:96`): check `error`. If the relation is missing, log an explicit
   warning and continue with an empty mapping. The failure must be visible in logs.
3. Same for `risk_data` in both network pages: check `error`, surface a UI notice rather
   than rendering a silently unjoined graph.
4. Add a short comment at each site pointing at this plan's D3/D4 rows.

**Exit checks**
- Unit test: two arcs, one `week` one `year`, same physical volume → equal `sourcing_ratio`.
- Deploy `combine-project` to a scratch project; `supply_chain_data.weighted` is non-zero
  where inbound and BOM keys match.
- Both network pages render a visible notice when `risk_data` is unavailable.

**Gap check** — run every SQL query in §8 against one real project. Record actual counts in
§9; those numbers become the baseline the later phases are measured against.

---

### WP 0.3 — Documentation consolidation

**Preconditions** — WP 0.1 and 0.2 merged.

**Files** — `docs/data/**` (new) · moved files from `docs/` · `CLAUDE.md`

**Steps**
1. Create `docs/data/README.md` as the index.
2. Move in and stamp each file with a status banner:
   - `docs/data-simulation-mapping.md` → `docs/data/field-mapping.md` — **AUTHORED**
   - `docs/simulation-data-lifecycle.md` → `docs/data/lifecycle.md` — **AUTHORED**
   - data sections of `docs/design/next-gen-platform-design.md` — **AUTHORED**, cross-linked
   - `scsim/docs/reference/*` — **GENERATED**, leave in place, link only
3. Leave a tombstone stub at every old path: one line + new location.
4. Add to `CLAUDE.md`: `docs/data/` is the single archive for data facts; no data fact is
   authored in more than one place.

**Exit checks**
- Every file under `docs/data/` has a status banner.
- No broken relative links (`grep -ro '](\./[^)]*' docs/ | check each`).
- `docs/data/README.md` lists every file with its status.

**Gap check** — list every data fact that still appears in two places (typically
`docBodies.tsx` vs `docs/data/`). Record in §9 as the Phase 5 worklist.

---

## 4. Phase 1 — The contract and its gate

> **Goal:** one machine-readable description of every table and field, with a CI gate.
> **Decision (approved):** sidecar YAML next to the migrations.

### WP 1.1 — Schema introspector

**Preconditions** — Phase 0 complete. `docs/data/` exists.

**Files** — `scripts/data-contract/introspect.mjs` (new) · `package.json`

**Steps**
1. Parse `supabase/migrations/*.sql` in filename order, building the effective schema:
   tables, columns, types, nullability, defaults, constraints, indexes, RLS policies,
   and function signatures. Apply `ALTER` statements in sequence.
2. Emit `build/schema.introspected.json`.
3. Handle the known awkward cases: `CREATE TABLE IF NOT EXISTS` repeated across
   migrations, `ALTER COLUMN … TYPE`, `DROP CONSTRAINT IF EXISTS`, and quoted
   identifiers with spaces (`"RISK CLASS"`).
4. Add `npm run contract:introspect`.

**Exit checks**
- Output contains all four lane tables, three masters, `supply_chain_data`,
  `dataset_versions`, and the governance tables.
- `inbound_logistics` shows **no** unique constraint beyond `id` (confirms D5).
- `supply_chain_data.weighted` shows `numeric(16,6)` (the `20250816031317` alteration).
- Tables referenced in code but absent from migrations are listed under `orphans`:
  must contain `product_code_map` and `risk_data`.

**Gap check** — diff the introspected table list against `\dt` on the live database if
reachable. Any table present live but not in migrations is a second class of orphan;
record in §9.

---

### WP 1.2 — Sidecar schema and the first twelve tables

**Preconditions** — WP 1.1 emits `schema.introspected.json`.

**Files** — `supabase/migrations/*.contract.yaml` (new, ~12) ·
`scripts/data-contract/contract.schema.json` (new)

**Steps**
1. Define the sidecar JSON Schema. Per table: `tier`, `grain`, `natural_key_unique`,
   `owner`, `governance {read, write, min_project_role, audited}`. Per field: `type`,
   `unit`, `unit_source`, `meaning`, `grain` (`rate` | `event`), `engine {consumed_by,
   transform, missing_default}`, `substitutions[]`, `ingest {csv_header, required,
   validate}`, `surfaces[]` *(filled in Phase 5)*, and `resolution` *(WP 1.3)*.
2. Reserve the vocabulary now, unused: `tier: "2-O"`, the `observations` schema name,
   provenance state `estimated`, provenance state `contract`.
3. Author sidecars for the simulation path: `inbound_logistics`, `outbound_logistics`,
   `bom_single_level`, `bom_multi_level`, `materials`, `products`, `suppliers`,
   `supply_chain_data`, `supply_chain_data_multi_tier`, `dataset_versions`,
   `policy_defaults`, `policy_overrides`.
4. For every engine-consumed field, fill `engine.consumed_by` by grepping `scsim/`.
   A field you cannot trace is a finding, not a blank.

**Exit checks**
- All 12 sidecars validate against the schema.
- Every column in those 12 tables has an entry — no silent omissions.
- `inbound_logistics.lead_time` records `unit: weeks`, `unit_source: fixed`.

**Gap check** — for each of the 12, list fields with no `engine.consumed_by` and no UI
surface. Those are candidates for deletion; record in §9, do not delete yet.

---

### WP 1.3 — One unit table, `lead_time_unit`, resolution modes

**Preconditions** — WP 1.2 sidecars exist.

**Files** — `supabase/functions/_shared/grading.ts` ·
`src/lib/policies/effectiveEconomics.ts` · `supabase/migrations/…_item_master.sql`
(the `sc_nodes` view) · new migration for `lead_time_unit` · sidecars

**Steps**
1. **One `UNIT_DAYS`.** `grading.ts` keeps the canonical table (it is the isomorphic,
   parity-pinned module). `effectiveEconomics.ts` already imports it — verify no local copy
   remains. Replace the `sc_nodes` SQL `CASE` with a lookup consistent with `UNIT_DAYS`;
   `quarter`/`quarterly` currently falls into `ELSE` and is 13× wrong.
2. **`lead_time_unit` (D9).** Add the column to `inbound_logistics`, add it to the
   ingest sanitizer allow-list, add it to the CSV template headers, and record it in the
   sidecar. Default `NULL` = weeks, matching `project_map.py:420`.
3. **Resolution block.** Add to each engine-consumed field:
   `resolution: {default_mode, assertable_by[], estimable_from[], hybrid{centre, spread},
   on_conflict, threshold_pct}`. Set `estimable_from: []` on engineering facts
   (`consumption_rate`, `moq`, `capacity_per_week`) — this is the line that stops a future
   estimator fitting a distribution to a BOM rate.
4. Record the price gap explicitly: `cost`/`unit_price` have no variability field anywhere
   in `scsim`. Mark `resolution.hybrid: null` with a note pointing to the engine RFC.

**Exit checks**
- `grep -rn "UNIT_DAYS\|_UNIT_DAYS\|ILIKE '%month%'" src supabase scsim` returns exactly
  the canonical definition, its Python mirror, and imports.
- Parity fixture: `rateToWeekly(v, 'quarter')` agrees between TS, the SQL view, and
  `project_map.py`.
- A CSV with `lead_time_unit=day` round-trips to the DB.

**Gap check** — re-read `project_map.py` `_UNIT_DAYS` and confirm the TS table still matches
key for key. Any divergence is a parity break; record and fix before closing the WP.

---

### WP 1.4 — Generator, drift gate, orphan reconciliation

**Preconditions** — WP 1.1–1.3 complete.

**Files** — `scripts/data-contract/generate.mjs` · `scripts/data-contract/check.mjs` ·
`.github/workflows/data-contract.yml` · `build/data-contract.generated.json` ·
`docs/data/tables/*.md` (generated) · `CLAUDE.md`

**Steps**
1. `generate.mjs`: merge introspected schema + sidecars + `registry.generated.json` →
   `data-contract.generated.json`; render `docs/data/tables/*.md` with a GENERATED header.
2. `check.mjs` — fails when:
   - a table or column exists with no sidecar entry;
   - a sidecar describes something that does not exist;
   - generated markdown differs from committed (the `gen_docs.py --check` pattern);
   - a `tier: 2` table lacks a natural-key unique index *(warn until WP 3.3, then error)*;
   - a code-referenced table has no migration (orphans).
3. **Reconcile the orphans.** `product_code_map`: the mapping branch in `combine-project`
   is dead code — either add the migration or delete `:96-102,110-113`. `risk_data`: add a
   proper migration with `source`, `vintage`, `licence`, `refreshed_at`, and rename the
   quoted columns. Decide in this WP; do not defer.
4. Wire into CI. Add `npm run contract:check`.
5. Add the invariants table from §1 to `CLAUDE.md`.

**Exit checks**
- `npm run contract:check` green.
- Adding a scratch column to a migration makes it fail; reverting makes it pass.
- `docs/data/tables/` has one page per covered table.
- No orphans remain in the introspector output.

**Gap check** — confirm the gate actually runs on PRs (open a throwaway PR with a scratch
column). A gate that is not wired is not a gate. Record the CI run URL in §9.

---

## 5. Phase 2 — Governance consolidation

> **Goal:** one identity, real project delegation, a data-plane audit — before the
> ingestion rewrite, because promotion needs a role to check.

### WP 2.1 — One organization identity

**Preconditions** — Phase 1 gate green.

**Files** — new migration · `supabase/functions/**` (org comparisons) · `src/hooks/useAuth`

**Steps**
1. Backfill `approved_users.organization_id` and add `projects.organization_id uuid`
   (nullable at first), backfilled from the name.
2. Add `get_current_user_org_id()` returning `uuid`.
3. Migrate every `v_org <> get_current_user_org()` comparison to the uuid form. Inventory
   first: `grep -rn "get_current_user_org()" supabase/migrations | wc -l`.
4. Dual-read during transition: authorize if **either** matches. Remove the text branch in
   a follow-up migration once the backfill is verified complete.
5. Fix the `organizations` RLS, which currently self-bridges by `name`/`slug` string match.
6. Retire `user_plant_access` (the third, vestigial path) or document why it stays.

**Exit checks**
- Renaming an organization changes nothing about project access (test).
- `projects.organization_id` non-null for 100 % of rows.
- No new code path compares organization by text.

**Gap check** — grep for remaining text comparisons including in edge functions and the
public API. List survivors in §9 with a reason each.

---

### WP 2.2 — Project membership and the resolver

**Preconditions** — WP 2.1 merged; org is uuid-keyed.

**Files** — new migration · `unified_access_control` resolver · `src/hooks/useCapabilities`

**Steps**
1. `project_members(project_id, user_id, project_role, granted_by, expires_at, rationale)`
   with roles `owner | editor | analyst | viewer`. Backfill: `projects.modeler_id` → `owner`.
2. Extend `capabilities_for_user()` to **role → org → project → user**. Project sits between
   org and user: an org grant narrows per project, a user override still wins.
3. `delegation_grants` — subtractive only: a grant may not exceed the grantor's own level,
   and carries `expires_at`.
4. Split `data_editing` into tier-scoped capabilities: `data_edit_inputs` (T2) and
   `data_edit_policies` (T4). Keep `data_editing` as a deprecated alias mapping to both.

**Exit checks**
- A `viewer` on project A cannot read project B (test).
- An expired grant stops granting (test with a past `expires_at`).
- A grant exceeding the grantor's level is rejected.
- `/profile` remains non-deniable.

**Gap check** — walk the resolver by hand for four cases: super-admin, org admin with a
project deny, user allow over org deny, expired grant. Record the truth table in §9.

---

### WP 2.3 — Data-plane audit

**Preconditions** — WP 2.2 merged.

**Files** — new migration · `supabase/functions/**` write paths

**Steps**
1. Generalize `admin_audit_logs` → `audit_logs` with `plane text CHECK (plane IN
   ('admin','data','access'))`. Keep the column shape; migrate existing rows to
   `plane='admin'`.
2. RLS: super-admin reads all; org admins read their own org's `data` and `access` rows.
3. Emit an audit row on every tier transition: ingest promote, ETL run, policy override
   write, dataset delete, analysis run *(the last lands in WP 4.2)*.
4. `erp_sync_runs.applied_by_user_id` becomes one source among several, not the only one.
5. **Transparency (T-§3):** make export a governed action. The `export` capability
   already exists (`unified_access_control.sql:53`); a dataset workbook contains every
   price on the network, so exporting must check it and write an audit row. Without
   this, the verifiable export is an exfiltration path.

**Exit checks**
- Every Tier-2 write in a smoke run appears in `audit_logs`.
- An org admin sees their org's rows and no others.
- Existing admin audit history is intact and readable.

**Gap check** — list every write path to a T2/T3/T4 table and tick off whether it audits.
Un-audited paths go in §9 as a WP 3.x addendum.

---

### WP 2.4 — Contract-generated RLS tests

**Preconditions** — WP 2.1–2.3 merged; contract carries `governance` per table.

**Files** — `scripts/data-contract/gen-rls-tests.mjs` · generated test suite · CI

**Steps**
1. From each table's `governance` block, generate assertions: for each role × table ×
   operation, expect allow or deny.
2. Run against a seeded test project with one user per role.
3. Flip `check.mjs`'s natural-key rule from warn to **error** for `tier: 2` tables —
   which will fail until WP 3.3 lands. Gate it behind a dated TODO so it is not forgotten.

**Exit checks**
- Generated suite runs in CI and passes.
- Removing a policy from a migration makes the suite fail.

**Gap check** — compare generated expectations against the actual RLS policies in the
introspected schema. Any table whose real policy is broader than the contract claims is a
security finding; record in §9 and fix in this WP, not later.

---

## 6. Phase 3 — One ingestion contract

> **Goal:** CSV joins the MRP path. **Decision (approved):** generalize `erp_staged_*` now.

### WP 3.1 — `ingest_*` generalization

**Preconditions** — Phase 2 complete.

**Files** — new migration · `supabase/functions/erp-sync-orbit-mrp/**` ·
`src/lib/policies/projectLanes.ts`

**Steps**
1. Rename/restructure `erp_staged_*` → `ingest_staged_*`, adding
   `source_kind text CHECK (source_kind IN ('csv','orbit-mrp','api'))` and
   `fact_class text CHECK (fact_class IN ('master','transactional'))`.
2. `erp_sync_runs` → `ingest_runs`, with `source_kind`. Add `ingest_files` for Tier 0.
3. Update the MRP connector to the new names; behaviour unchanged.
4. Fix D20 while here: `projectLanes.ts` fallback truncates at 10 000 silently — paginate
   or surface a truncation flag like `GradingDataset.truncated` already does.

**Exit checks**
- An MRP sync still stages, diffs and promotes exactly as before (regression).
- `ingest_runs` carries `source_kind='orbit-mrp'` for those runs.
- A project with >10 000 lane rows no longer truncates silently.

**Gap check** — confirm no code still references `erp_staged_*` or `erp_sync_runs`,
including `delete-project/index.ts`, which enumerates table names by hand.

---

### WP 3.2 — Server-side parse and Tier 0/1 landing for CSV

**Preconditions** — WP 3.1 merged.

**Files** — new edge function `ingest-file` · `src/components/UploadWizard.tsx`

**Steps**
1. Upload stores the file in Tier 0 (`ingest_files` + storage), opens an `ingest_run`.
2. Parse **server-side** with a real CSV parser (papaparse or equivalent) — one
   implementation for every source. Closes D6.
3. Validation from the contract, not hand-written: types, units, id shape, required.
   Closes D7 (`null` must fail a required check) and D8 (trim + empty-check ids, the
   pattern `ingest-bom-multi-level/index.ts:42-44` already uses).
4. Rows land in `ingest_staged_*` with `fact_class='transactional'` for lanes,
   `'master'` for item-master uploads. Findings attach per row.
5. `UploadWizard` becomes an uploader + status view. The old client-side parse is deleted,
   not left behind a flag.

**Exit checks**
- A CSV with a quoted comma round-trips with fields intact (closes D6).
- A CSV with blank `volume` is **rejected** with a row-level finding (closes D7).
- `" MAT-1 "` and `"MAT-1"` resolve to one id (closes D8).
- A semicolon-delimited file is rejected with a clear message.

**Gap check** — re-run the full A-section trace from the audit (BOM, CRLF, trailing comma,
fewer/more fields). Record the new behaviour for each in §9 as the regression baseline.

---

### WP 3.3 — Natural keys, upsert, normalization at promotion

**Preconditions** — WP 3.2 merged; staged rows exist.

**Files** — new migration · promote RPC

**Steps**
1. Deduplicate existing rows first (keep newest per natural key; report counts).
2. `CREATE UNIQUE INDEX` on all four lane tables:
   `(project_id, plant_name, supplier_id, material_id)` and equivalents. Closes D5.
3. Promotion is an **upsert** on that key, inside one transaction, audited.
4. **Normalize units at promotion** (I3), from the contract. After this, no consumer converts.
5. Add provenance columns to T2: `ingest_run_id`, `source_row_id`.
6. Flip `check.mjs`'s natural-key rule to error (the WP 2.4 TODO).

**Exit checks**
- Uploading the same file twice is a no-op (row count unchanged).
- A partial-failure retry does not duplicate.
- Every T2 row traces to an `ingest_run_id`.
- `contract:check` passes with the natural-key rule at error.

**Gap check** — run the duplicate-detection SQL from §8 on a real project before and after.
Record both counts. If dedup removed rows, verify no downstream aggregate changed
unexpectedly — and if it did, that is the D5 damage being undone, so record it.

---

### WP 3.4 — Diff, review, promote UI

**Preconditions** — WP 3.3 merged.

**Files** — `src/pages/DataManager.tsx` · new review component

**Steps**
1. Compute `diff_state` per staged row against current canonical.
2. Review screen: counts (new/changed/unchanged/removed), row-level findings, and the
   actual diff. Model it on the MRP sync mapping report — same shape, same vocabulary.
3. Promote requires project role ≥ `editor`; the action is audited.
4. Show provenance on canonical rows: which run, which file, which row.

**Exit checks**
- A user can answer "where did this number come from?" by clicking through to the source row.
- Promotion by an `analyst` is refused.
- The review screen renders for both CSV and MRP runs from one component.

**Gap check** — walk one CSV and one MRP run end to end through the same UI. Any place the
two still diverge is unfinished generalization; record in §9.

---

## 7. Phase 4 — Trust anchor and the analysis store

### WP 4.1 — Complete and compose `graph_hash`

**Preconditions** — Phase 3 complete.

**Files** — new migration replacing `_build_dataset_snapshot`

**Steps**
1. Add `bom_multi_level` to the snapshot (closes D11) and the network tables.
2. Split into per-domain hashes: `hash_inputs`, `hash_network`, plus a composite
   `graph_hash`. Keep `graph_hash` name and shape so `simulation_runs` is unaffected.
3. `current_graph_hash(project, domain)` gains an optional domain argument.
4. Bump `schema_version` in the snapshot payload.

**Exit checks**
- Editing a multi-level BOM moves the hash (closes D11).
- Editing only network tables moves `hash_network` and not `hash_inputs`.
- Existing `simulation_runs` rows still resolve their `dataset_version_id`.

**Gap check** — confirm every Tier-2 table is represented in the snapshot. Missing tables
are silent blind spots of exactly the D11 kind; list coverage table-by-table in §9.

---

### WP 4.2 — The analysis store

**Preconditions** — WP 4.1 merged.

**Files** — new migration · `supabase/functions/_shared/analysisStore.ts`

**Steps**
1. Create:
   ```
   analysis_runs(id, project_id, analysis_kind, input_hash, params_hash,
                 code_version, status, started_at, finished_at, duration_ms,
                 row_counts jsonb, warnings jsonb, actor_user_id,
                 UNIQUE (project_id, analysis_kind, input_hash, params_hash, code_version))
   analysis_results(run_id, entity_type, entity_id, metrics jsonb)
   ```
2. `analysis_kind` is an **open** enum with a params schema in the contract, so
   `lead_time_fit` needs no migration later.
3. Shared helper: `getOrCompute(kind, params, codeVersion, computeFn)` — lookup by key,
   return on hit, compute and persist on miss. Never update, never delete.
4. Audit each run (`plane='data'`, per WP 2.3).
5. Deprecate `should_recalculate_network_metrics` — leave it in place but unused, with a
   comment naming D12 (returns "up to date" for an empty project; 5-way cartesian join).

**Exit checks**
- A repeat request with an unchanged project is a cache hit (assert zero compute).
- Changing an input produces a miss, not a stale hit.
- Reverting the input re-hits the original run.
- Two `code_version`s over the same `input_hash` coexist.

**Gap check** — verify the unique constraint actually prevents duplicate runs under
concurrency (two parallel requests on a cold key). If it does not, add the ON CONFLICT path
before closing.

---

### WP 4.3 — Migrate the four analyzers (dual-write)

**Preconditions** — WP 4.2 merged.

**Files** — `calculate-network-science-metrics` · `calculate-node-prominence` ·
`predict-critical-nodes` · `project-ai-health` · `combine-project`

**Steps**
1. Each analyzer writes **both** its existing entity columns and `analysis_results`.
   Additive — nothing breaks.
2. Each gains a `code_version` constant, bumped on any algorithm change.
3. `combine-project` becomes `analysis_kind='combine_etl'`, stamping
   `supply_chain_data.computed_from_hash`.
4. Add `computed_from_hash` + `computed_at` to every Tier-3 table.

**Exit checks**
- Each analyzer produces identical numbers in both destinations (comparison test).
- Every Tier-3 row written in a smoke run carries a hash stamp.

**Gap check** — compare old-column values against `analysis_results` for a real project,
field by field. Any mismatch means the migration changed semantics silently — investigate
before Phase 5 drops the columns.

---

### WP 4.4 — Staleness and invalidation

**Preconditions** — WP 4.3 merged.

**Files** — Tier-4 migration · `StagePolicyTable` · network pages

**Steps**
1. Add `seeded_from_hash` to `policy_overrides`; populate on write.
2. One staleness rule everywhere: stale iff `computed_from_hash <> current_graph_hash()`.
   Delete the three ad-hoc rules.
3. A re-upload flags stale seeded overrides in the UI rather than silently keeping them.
4. Freshness badge component: dataset version, hash prefix, computed-at, stale flag.
5. **Transparency (T-rung 3):** assemble the Project Data Trust Report. Most of it
   already exists inside `grading.ts` — this is assembly, not new computation:
   coverage per engine-read field, blocking findings, neutral-constant substitutions,
   derived values, per-table freshness, ingest history, and a **Known limits** block.
   See `TRANSPARENCY.md` §2 for the exact shape. The limits block is not optional.

**Exit checks**
- Every network page states its version and freshness.
- After a re-upload, affected overrides are flagged, not silently applied.
- No page computes its own staleness.

**Gap check** — grep for any remaining timestamp-comparison staleness logic across
`src/` and `supabase/`. Record survivors in §9.

---

## 8. Phase 5 — Lineage and in-app documentation

### WP 5.1 — Surfaces (lineage) block
Static analysis over hooks and edge functions → `surfaces[]` per field; human-confirmed.
Regenerate `docs/data/tables/*.md` with lineage. **Exit:** the feature map is generated,
not transcribed. **Gap check:** every page in `src/pages/` appears in at least one
`surfaces` entry, or is explicitly marked as reading no project data.

### WP 5.2 — `/docs` renderer
Rebuild `/docs` over `data-contract.generated.json`, reusing `DocsLayout.tsx`. Per the
approved decision, `docBodies.tsx` keeps its narrative and loses its reference half.
Role filters reuse the **capability catalog** — not a second taxonomy. Desktop and mobile
read one payload. **Exit:** no table or field list is hand-written in `src/`.
**Gap check:** work the Phase-0 duplicate list from §9 to zero.

### WP 5.3 — Pages read `analysis_results`; drop entity columns
Migrate each page's transform stage to read stored results. Once every reader has moved,
drop `network_nodes.degree_centrality` et al. (closes D19). **Exit:** no page computes
centrality, adjacency or reachability in the browser. **Gap check:** confirm no remaining
reader before dropping each column — drop in a separate commit from the migration.

---

## 9. Phase 6 — The policy data contract (researcher grade)

### WP 6.1 — Resolution chains, documented and pinned
For every Supplier/Plant/Customer grid field: CSV column → DB column → RPC → hook →
substitution → engine field → unit at each hop. Pin with parity fixtures in the style of
`grading.ts`. **Exit:** every cell has a documented chain. **Gap check:** a chain you cannot
write down is a bug — list them rather than inventing prose.

### WP 6.2 — Fix the divergences the audit found
D16 (hardcoded constants dotted as data — residual after WP 0.1), D17 (NULL
`capacity_per_week` renders `0`; should render unlimited), D18 (`material_price` consumed
nowhere — mark read-only with a milestone badge or map it to `materials.cost`), plus the
`cheapestInboundCost` (floors ≤0 to 1.0) vs `resolveField` (imputes an average) divergence.
Also de-duplicate `StagePolicyTable.tsx:1170-1225`, a verbatim copy of `resolveCell`.

### WP 6.3 — Provenance vocabulary, value chain, reproducibility record
Complete the vocabulary: `data · master · contract · estimated · imputed · derived ·
override · edited · default`. Then ship the three transparency artifacts that depend on
everything before them (`TRANSPARENCY.md` §2, rungs 2 / 3 / 5):
**(a)** the **value chain popover** — click any cell, see source file → row → uploader →
approver → unit → engine transform → substitutions applied → freshness → what would
change it; **(b)** the **Trust Report** PDF/JSON export via `report-render`;
**(c)** the **Reproducibility Record** — dataset, policy, scenario, engine and analysis
versions plus declared limits, attachable to any exported figure.
**Exit — the standard's acceptance test:** hand a stakeholder a number from the Supplier
grid and a laptop; with no help and no app access beyond the export, they trace it to a
row in a named file uploaded by a named person on a named date — or find the named rule
that produced it in the absence of data.

---

## 10. Deferred — Phase 7+ (real-world timestamped data)

Not scheduled. Additive to everything above. See figures 06–11.

- **Tier 2-O `observations`** — append-only, bitemporal (`valid_time` + `recorded_at`),
  partitioned monthly, joined to T2 by the same arc keys.
- **Estimators** as `analysis_kind` (`lead_time_fit`, `demand_fit`, `reliability_fit`),
  recording n, window and fit quality.
- **`as_of` reproducibility** — runs pin `(as_of, graph_hash)`.
- **Backtesting** — fit window → simulate hold-out → compare to actuals.
- **Conflict findings** — contract vs. observed gap, with a recorded simulate-with choice.

**Cheap reservations already made in Phases 1–6** (~2 days total): the `2-O` tier name, the
`observations` schema name, `grain` per field, open `analysis_kind`, and the `estimated` /
`contract` provenance states.

### Engine RFCs (separate track, `scsim` roadmap — not this plan)
1. **`cost_dist` + `cost_cv` on `SupplierLink`.** Price is a bare scalar; there is no way to
   model price fluctuation as a process. Structurally identical to the existing
   `lead_time_dist`/`lead_time_cv` pair. Interim: scenario sweep over fitted quantiles.
2. **M7 — `LeadTimeDist.EMPIRICAL`.** Already in the enum; the compiler rejects it with
   *"lands with the data-import path (M7)"*. Implementable once observations exist.
3. **Non-stationarity.** The engine is steady-state: no calendar, no time-varying
   parameters. `projects.simulation_start/end` exist but never reach the engine. Until this
   lands, the honest position is that fitted parameters describe the window they were fitted
   on — and the UI must show that window beside the number.

---

## 11. Verification SQL

Run against one project before Phase 0 and after each phase. Record counts in §12.

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

-- D3/plant_name drift: arcs whose plant matches no BOM row
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

-- D17: suppliers the grid will render as capacity 0 (means unlimited)
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

## 12. Drift log

Append after every gap check. Newest last. Never delete an entry — a superseded finding is
struck through with a pointer to the entry that replaced it.

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

*(no entries yet — Phase 0 not started)*

---

## 13. Sequencing summary

| Phase | WPs | Focus | Blocks |
|---|---|---|---|
| 0 | 0.1 – 0.3 | stabilize, consolidate docs | everything |
| 1 | 1.1 – 1.4 | contract + CI gate | 2, 3, 5 |
| 2 | 2.1 – 2.4 | governance | 3 (promotion needs a role) |
| 3 | 3.1 – 3.4 | one ingestion contract | 4 |
| 4 | 4.1 – 4.4 | trust anchor + analysis store | 5 |
| 5 | 5.1 – 5.3 | lineage + in-app docs | 6 |
| 6 | 6.1 – 6.3 | policy contract, researcher grade | — |
| 7+ | deferred | observations, estimation, backtesting | — |

**25 work packages.** Commit message convention:
`Phase N / WP N.M / <blueprint ref>: <title>`.
