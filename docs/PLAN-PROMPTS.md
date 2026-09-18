# Data Spine — Execution Prompts

> **Companion to** `docs/PLAN.md`
> **Branch:** `claude/busy-lovelace-5hxsh6` · **PR:** #187
> **Status:** AUTHORED

One prompt per work package. Each is sized for a fresh session — paste the
**preamble** followed by **one** WP prompt. Never run two WPs in one session:
the gap check is what makes phase-to-phase handoff hold, and it needs the
session's full attention on a single package.

The `Already verified` lines carry findings from the audit that produced the
plan. They are there so a cold session does not spend its budget rediscovering
them — but **treat them as leads, not facts**: re-check anything you rely on.

---

## The preamble — paste before every WP prompt

```
You are implementing ONE work package from docs/PLAN.md
on a fresh branch off the latest default. Read §1 of that plan first —
it defines the work-package lifecycle. Follow it exactly.

Before anything else, read the PHASE BOUNDARY entry at the end of §16. It
records what the Phase 0-1 review found true, what it found merely claimed,
and what the next package inherits.

Non-negotiables:

1. VERIFY every Precondition against the actual code. Do not assume the
   previous WP left things as promised. If a precondition does not hold, stop
   and report rather than working around it.
2. STAY IN SCOPE. The plan's §4 lists the defects, each assigned to a WP. If you
   find one belonging to another WP, record it in §16 and move on. Do not fix it.
3. RUN every Exit check. All must pass before you commit. If one cannot pass,
   say so plainly instead of weakening the check.
4. Spend the last ~10% of your budget on the GAP CHECK. Append your findings
   and your Handoff note to §16 Drift Log in the SAME commit as the code.
5. If a finding changes a later WP, EDIT that WP in the plan, same commit. The
   plan and the code move together (CLAUDE.md).
6. Commit as: Phase N / WP N.M / <blueprint ref>: <title>. Push to your branch
   and open a PR for it.

Read docs/design/next-gen-platform-design.md §2.3 and §8.1–8.4 before touching
the simulation platform, per CLAUDE.md.
```

---

## Phase 0 — Stabilize and consolidate

### WP 0.1 — Kill the silent policy override ✅ DONE

*(Retired, not cached. Every `line:number` this prompt carried described the state
BEFORE the fix and is now stale; `5c7129f` merged two independent implementations of
it and spliced this block, which is how the stale numbers survived at all — see §16's
WP 1.1 entry and D26. What was found lives in `docs/PLAN.md` §16, the closed defects
are marked in §4, and the surviving locations are in §4.1. Cite those, not this.)*

Two things it settled that later packages rely on:
· the constants were **dropped**, not tagged — tagging needs a second registry of
  "not data", which is the parallel source of truth I1 forbids;
· `__from_data` now also carries the routing decisions the data's shape makes
  (`primary_source`, `sourcing_firm`), because the pre-dispatch validator reads
  those from the saved override bundle, not from the row.
· the two provenance copies are GONE — WP 6.2 de-duplicated them, the desktop grid
  calls `resolveEffective.ts::resolveCell`, and `oneResolver.test.ts` is a gate that
  fails if either renderer rebuilds the ladder inline. The two prefill rules D26 left
  behind are still there, until the same WP kills one.

### WP 0.2 — Unit conversion + orphan-table honesty ✅ DONE

*(Kept for the record. The evidence below describes the state BEFORE the fix, and
two of its claims were wrong — there were EIGHT raw volume reads, not seven, and
the `risk_data` error was warned to the console, not swallowed. §16's WP 0.2
entry records what actually landed, and that the §15 baseline is still unrun.)*

```
Implement WP 0.2 from docs/PLAN.md.

Already verified (re-check before relying on it):
· combine-project/index.ts carries `// @ts-nocheck` and reads row.volume raw at
  :60, :68, :268, :274. There are further unconverted uses at :115 (productDemand
  feeding the single-level BOM weighting), :234-235 and :318 (multi-tier). Trace
  all of them — fixing only the four obvious ones leaves the multi-tier lane wrong.
· rateToWeekly lives in supabase/functions/_shared/grading.ts, which is
  dependency-free and Deno-safe. Import it; do NOT write a local copy (invariant I3).
· product_code_map at combine-project/index.ts:131-145 destructures only { data }
  — the error is swallowed and the table exists in NO migration. The mapped
  branch at :158-163 is therefore dead code today. Make the failure loud;
  deciding whether to add the table or delete the branch is WP 1.4, not this one.
· risk_data is read at ProductLevelNetwork.tsx:500 and FirmLevelNetwork.tsx:301
  and had no migration either. WP 1.4 gave it one (20260915000003_risk_data.sql)
  and renamed the quoted columns; the line numbers above are post-WP-1.4.

Conversion changes weighted magnitudes. supply_chain_data.weighted is
numeric(16,6) (set by migration 20250816031317) — confirm no overflow for the
largest project you can find.

End by running EVERY query in §15 of the plan against one real project and
recording the counts in §16. Those numbers are the baseline every later phase is
measured against — this is the most valuable thing this WP produces.
```

### WP 0.3 — Documentation consolidation ✅ DONE (`719f59b` + the Phase 0 finish)

*(Kept for the record. §16's WP 0.3 entries record what landed — both halves.)*

```
Finish WP 0.3 from docs/PLAN.md. The archive half is DONE —
docBodies.tsx and HelpPage.tsx are in docs/archive/legacy-help-site/ with a README.
Read §16's WP 0.3 drift-log entry before starting.

Remaining:
· Move docs/data-simulation-mapping.md → docs/data/field-mapping.md and
  docs/simulation-data-lifecycle.md → docs/data/lifecycle.md, each with a status
  banner (GENERATED / AUTHORED / DEPRECATED → superseded by X).
· Leave a tombstone stub at every old path.
· Add to CLAUDE.md: docs/PLAN.md is the single plan and the only authority for
  data-layer file:line evidence (§4); npm run check:docs enforces it. Add the §2.1
  invariants table too.
· docs/data/README.md already exists and points at the plan — leave it.

Preserve content verbatim. The only new prose is the banners and the index.
Do NOT touch the archived files — mining them is WP 5.2a's job.
```

---

## Phase 1 — The contract and its gate

### WP 1.1 — Schema introspector

```
Implement WP 1.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· There are 291 migrations. Order matters and is by filename.
· CREATE TABLE IF NOT EXISTS appears for the SAME table with DIFFERENT
  definitions: 20250820145017 and 20250820145155 define the lane tables with
  `plant_id uuid`, while 20250820145837 defines them with `plant_name text`.
  Under IF NOT EXISTS semantics the FIRST one to run wins. Your introspector must
  model this or it will report the wrong schema. This is the single hardest part
  of the WP — get it right before anything else.
· supply_chain_data.plant was RENAMED to plant_name (20250822025432).
· The UNIQUE on supply_chain_data.plant was DROPPED (20250816002505).
· Column types were widened to numeric(16,6) (20250816031317).
· Quoted identifiers with spaces exist (risk_data."RISK CLASS").

Expect the orphan list to contain exactly product_code_map and risk_data. If it
contains more, that is a finding — record it.

Do not author any sidecar YAML in this WP. Introspection only.
```

### WP 1.2 — Sidecar schema and the first twelve tables

```
Implement WP 1.2 from docs/PLAN.md.

Already verified (re-check before relying on it):
· scsim/scsim/io/registry_export.py + scsim/scripts/gen_docs.py are the pattern to
  mirror. Read them first — the sidecar generator should feel like their sibling,
  not a new invention.
· materials/products/suppliers have PRIMARY KEY (project_id, <id>). The four lane
  tables have only `id`. Record this truthfully in natural_key_unique — WP 3.3
  fixes it, this WP documents it.
· Engine-consumed fields are findable via scsim/scsim/io/project_map.py and
  sim-worker/sim_worker/datamap.py. A field you cannot trace to either is a
  finding — write `consumed_by: null` with a note, never a guess.

Reserve (unused, one line each): tier "2-O", the `observations` schema name,
provenance states `estimated` and `contract`, and a per-field `grain` of
`rate` | `event`. Reserving now costs nothing; retrofitting costs a UI pass.

Author sidecars only. The generator and gate are WP 1.4.
```

### WP 1.3 — One unit table, lead_time_unit, resolution modes

```
Implement WP 1.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· THREE unit conversions exist and disagree:
  – grading.ts:113-135 UNIT_DAYS + rateToWeekly (canonical; mirrors project_map.py)
  – effectiveEconomics.ts:43-50 ratePerDay (already delegates — verify it still does)
  – item_master.sql:138-141 sc_nodes SQL CASE — ILIKE branches only; quarter falls
    into ELSE and is treated as weekly, a 13x error. Its price aggregate at :143
    also weights by RAW volume with a MAX() fallback, unlike demandWeightedSellPrice.
· lead_time_unit is READ by the engine (project_map.py:420, datamap.py:126) but has
  NO column, is not in UploadWizard's expectedHeaders, and would be dropped by
  ingest-inbound-logistics/index.ts:37-46 anyway. All three need fixing together.
· Price has NO variability field anywhere in scsim — SupplierLink.cost and
  Product.unit_price are bare floats. Record resolution.hybrid: null with a pointer
  to the engine RFC in §14. Do NOT attempt to add one; that is an engine change.
· The engine's deterministic path is real: engine.py:294 reads
  `if dist != DETERMINISTIC and cv > 0`. LeadTimeDist.EMPIRICAL exists in
  enums.py:60 and the compiler rejects it with "lands with the data-import path
  (M7)". Reference both when writing the resolution block.

estimable_from: [] on consumption_rate, moq and capacity_per_week is the
load-bearing line of this WP. It is what stops a future estimator fitting a
distribution to an engineering fact.
```

### WP 1.4 — Generator, drift gate, orphan reconciliation ✅ *(done)*

```
Implement WP 1.4 from docs/PLAN.md.

DONE. All three orphans reconciled, the gate is wired, and the prompt below is
kept as the record of what was asked. See PLAN.md §16 for what it found.

Already verified (re-check before relying on it):
· scsim/scripts/gen_docs.py --check is the exact gate pattern to copy, including
  its GENERATED header and its drift failure mode. Read it before writing check.mjs.
· registry.generated.json is committed in TWO places (src/lib/policies/ and
  supabase/functions/_shared/) by scsim/scripts/gen_frontend_registry.py, and
  scripts/check_registry_bridge.mjs guards the bridge. Follow the same convention.
· CI workflows live in .github/workflows/. scsim-tests.yml and
  supabase-functions.yml are the closest models.

You must DECIDE the orphans in this WP, not defer them:
· product_code_map — add the migration, or delete the read at
  combine-project/index.ts:131-145 and the mapped branch at :158-163. Deleting is
  my recommendation: the branch has never executed. WP 0.2 made the failure loud
  (console.error + a `warnings[]` entry on the response) but changed nothing else;
  no UI reads `warnings` yet, which is WP 4.4's Trust Report.
· risk_data — needs a real migration with source, vintage, licence and
  refreshed_at, and the quoted columns renamed. Two pages depend on it.

Set the natural-key rule to WARN, not error — WP 3.3 makes it passable. Leave a
dated TODO so WP 2.4 can flip it.

Add the invariants table from §2.1 of the plan to CLAUDE.md in this commit. Use
gate NAMES, not bare G numbers — §2.1's G1-G4 collide with the blueprint's gap IDs.

WIDENED BY THE PHASE 0-1 BOUNDARY REVIEW (§16, findings F1 and F4):

· The problem is not one missing gate. NO CI JOB RUNS ANY OF THEM. Twelve
  workflows exist; none invokes npm test, check:docs, or any contract:* command,
  and npm run lint is not in CI either. So wire SIX commands into the new job,
  not one: contract:introspect -- --check, contract:validate,
  contract:units -- --check, contract:verify, check:docs, npm test.
· contract:verify EXITS 1 TODAY on the orphan check — it finds three orphans,
  not two. Your step 3 is what makes it green. Reconcile the orphans in this
  same package or the phase ends with a gate that is red on arrival, which is
  exactly what made lint unreadable.
· approved_users is the THIRD orphan and the one that matters: it is the
  authentication table, it predates the migration history, and a fresh database
  cannot be built from supabase/migrations/ alone until you reconstruct its
  CREATE TABLE from the ALTERs the history does carry. Do NOT drop or recreate
  it in place.
· build/schema.introspected.json was committed STALE and drifted within a day
  of WP 1.1 landing, because nothing runs --check on it. It is the cheapest
  gate in the phase.
· Budget this as a FULL session. It is now the largest package in Phase 1, not
  the smallest. Do not attempt a second package alongside it.

Do not treat a green local run as done. The gap check is to open a throwaway PR,
add a scratch column to a migration on it, and confirm CI goes RED. The boundary
review already proved the scratch column fails contract:validate locally — that
proves the rule, not the wiring, and the wiring is the whole package.
```

---

## Phase 2 — Governance consolidation

### WP 2.1 — One organization identity

```
Implement WP 2.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· TWO org identities coexist. Legacy: approved_users.organization TEXT and
  projects.organization TEXT DEFAULT 'default_org', compared by string equality
  via get_current_user_org(). Modern: organizations(id uuid, name, slug) +
  organization_members + approved_users.organization_id, added by
  20260709000002_super_admin_phase1.sql.
· get_current_user_org() is defined THREE times — 20250820163748 (LANGUAGE sql),
  20250820165722 (plpgsql), 20250820170403 (plpgsql, reads a session GUC for the
  user id). The LAST wins: 20250820170403. (Corrected after WP 1.4; this block
  said "defined twice" and named the wrong winner.)
· The bridge is fragile by construction: the RLS on `organizations` itself reads
  USING (name = get_current_user_org() OR slug = get_current_user_org()).
· Renaming an organization therefore revokes access to its own projects. Write a
  failing test for this FIRST — it is the proof the WP works.
· projects.organization_id AND approved_users.organization_id ALREADY EXIST, both
  uuid REFERENCES organizations(id) ON DELETE SET NULL, both added and backfilled
  by 20260709000002. §9's "add projects.organization_id uuid" is already done.
  What is NOT done is keeping it true — see D27.
· D27: set_project_defaults() stamps NEW.organization and never NEW.organization_id,
  so every project created since that backfill has organization_id NULL and is
  invisible to the public /v1 API while visible through RLS. Fix the trigger, or any
  backfill you write rots the same way.
· user_plant_access was DROPPED, with plants, by 20250820172632 CASCADE. (Corrected
  after WP 1.4; this block called it a live "third mechanism ... still referenced in
  20250820145017 RLS policies" — but 20250820145017 is one of the three ABORTED
  migrations, so that reference never took effect. §6.3 struck it at WP 1.1.)

Inventory before editing: grep -rn "get_current_user_org()" supabase/migrations/ | wc -l.
Report the number; it sizes the WP. Measured at main 41de279: 221 in migrations,
0 in supabase/functions/, 0 in src/ — the package is entirely SQL.

Dual-read (uuid OR text) during transition. Do NOT remove the text branch in this
WP — that is a follow-up migration once the backfill is verified at 100%.
```

### WP 2.2 — Project membership and the resolver

```
Implement WP 2.2 from docs/PLAN.md.

Already verified (re-check before relying on it):
· There is NO project_members table. Project access resolves to
  modeler_id = me OR global role = 'admin' OR legacy user_plant_access.
· capabilities_for_user() (20260711000002_unified_access_control.sql:169) is the
  resolver to extend. It merges role → org → user with a tri-state (no row =
  inherit), gives super_admin everything, and keeps /profile non-deniable to avoid
  self-lockout. It takes _user_id EXPLICITLY so it never depends on a pooled
  session GUC — preserve that property exactly.
· Capabilities today are page/feature-scoped. data_editing is one global flag; the
  split into data_edit_inputs / data_edit_policies is what makes an analyst role
  meaningful.
· organization_members.org_role is owner|admin|member — ORG level. Do not overload
  it for projects; project_role is a separate vocabulary.

Delegation must be SUBTRACTIVE: a grant may not exceed the grantor's own level and
must carry expires_at. Enforce in the RPC, not only in the UI.

Write the four-case truth table (super-admin, org admin + project deny, user allow
over org deny, expired grant) into §16 as part of the gap check.
```

### WP 2.3 — Data-plane audit

```
Implement WP 2.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· admin_audit_logs (20260709000002:239) already has the right shape: actor_user_id,
  action, target_type, target_id, before jsonb, after jsonb, ip, user_agent. Keep it
  and add a `plane` discriminator rather than designing a new table.
· It is written only by log_admin_action() for capability/budget changes, and read
  only by super-admins.
· The data plane has exactly ONE audited action in the whole system:
  erp_sync_runs.applied_by_user_id. Everything else — CSV promote, ETL run, policy
  override, dataset delete — is unattributed.

Migrate existing rows to plane='admin' and verify the admin history still reads
before touching anything else.

The gap check for this WP is a full inventory: list every write path to a T2/T3/T4
table and tick whether it audits. Un-audited paths become a WP 3.x addendum in §16.
```

### WP 2.4 — Contract-generated RLS tests

```
Implement WP 2.4 from docs/PLAN.md.

Already verified (re-check before relying on it):
· RLS on the lane tables has a known history of not surviving PostgREST connection
  pooling under this app's custom auth — see the comment block at the top of
  src/lib/policies/projectLanes.ts, which is why the app is RPC-first. Your
  generated tests must exercise the RPC path, not only direct .from() reads, or
  they will pass while the real path is broken.
· supply_chain_data had RLS DISABLED at one point (20250816072224) and re-enabled
  later (20250820163957). Verify the current state from the introspector output
  rather than from any single migration.

The gap check here is a security review, not a formality: compare each table's real
RLS policy against what its contract claims. A policy BROADER than the contract is a
finding to fix in this WP, not to defer.

Flip the natural-key rule in check.mjs from warn to error and confirm it now fails
(WP 3.3 makes it pass). Leave it failing with a clear message naming WP 3.3.
```

---

## Phase 3 — One ingestion contract

### WP 3.1 — ingest_* generalization ✅ done

The prompt as issued is kept below. Two of its "already verified" facts did not
survive contact and PLAN.md §10 + §16 carry the corrections: `delete-project`
never enumerated the connector tables (they cascade from `projects`), and the
regression test belonged in `supabase/rehearsal/`, not in a source-level test.

```
Implement WP 3.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· erp_staged_products / _bom_versions / _bom_lines and erp_sync_runs
  (20260829120000_erp_connector_phase1_2.sql) already implement ~80% of the target:
  raw jsonb, diff_state (new|changed|unchanged|removed_upstream), row counts,
  mapping_warnings, applied_at/applied_by_user_id, auto_apply_threshold_pct = 0.
  You are RENAMING and widening, not redesigning. Read that migration's COMMENT ON
  TABLE blocks — they state the design intent precisely.
· docs/design/erp-mrp-integration-plan.md §6b and §3 are the governing document;
  its own Phase 3 anticipated this generalization.
· delete-project/index.ts:173 enumerates table names by hand, including
  product_code_map. It will break silently on rename — grep for every hardcoded
  table name before you finish.
· projectLanes truncates with no flag — D20, see PLAN.md §4. GradingDataset
  already models this correctly with a `truncated` field — copy that pattern.

Behaviour of the MRP connector must not change. Write the regression test for a
full stage→diff→promote cycle BEFORE renaming anything.
```

### WP 3.2 — Server-side parse and Tier 0/1 landing for CSV ✅ *(done)*

```
DONE. The client-side parse is deleted; `ingest-file` parses server-side with a
real RFC 4180 parser, validates against the contract's own `ingest.rule`, lands
the bytes in tier 0 and the rows in tier 1, and promotes what passed.

What a later package needs from it (PLAN.md §4.1 · Ingestion is the authority for
every line number; PLAN.md §16 · WP 3.2 for the findings):
· `_shared/ingestSpec.generated.ts` is GENERATED from the sidecars. A dataset gains
  a CSV column by gaining a sidecar entry — never by editing the edge function.
· `ingest_land_file` and `ingest_apply_run` take the actor as a PARAMETER and set
  `app.current_user_id` LOCAL to their own transaction. Do not replace either with
  a GUC read: PostgREST pooling is why D36 is not a one-line fix.
· `supabase/rehearsal/070` is the behavioural proof and is mutation-tested six ways.
```

### WP 3.3 — Natural keys, upsert, normalization at promotion

```
Implement WP 3.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· NO lane table has a natural-key unique index — only `id UUID PRIMARY KEY`
  (20250820145837_5a2d95f1). materials/products/suppliers DO have composite PKs.
· Duplicates therefore already exist in real projects. Run the §15 duplicate query
  and report counts BEFORE deduplicating, and again after.
· Duplicates distort sourcing_ratio (combine-project:277 — the duplicate appears in
  both numerator and denominator), the smart-average imputation basis
  (useStageRows.tsx:125-136), and the grading reducers. Dedup will therefore CHANGE
  numbers. That is the D5 damage being undone — record the before/after in §16 so
  nobody later mistakes it for a regression.
· Normalization at promotion (invariant I3) is the point of this WP. After it, no
  consumer converts. WP 5.3 will remove the downstream conversions; note in §16
  which call sites become dead so that WP can find them.

Deduplicate in its own commit, before adding the constraint, so the two are
separately revertible.
```

### WP 3.4 — Diff, review, promote UI

```
Implement WP 3.4 from docs/PLAN.md.

Already verified (re-check before relying on it):
· The MRP sync mapping report is the model to follow. erp_sync_runs carries
  fields_mapped / fields_defaulted / fields_failed and mapping_warnings in the same
  shape as simulation_runs.mapping_warnings (the scsim MappingWarning shape), and
  the migration comment points at src/components/sim/RunProgressPanel.tsx's
  MappingWarningsCard for the green/amber/red badge logic. Reuse that component
  family rather than building a second vocabulary for the same idea.
· Promotion must check project role >= editor (WP 2.2) and audit (WP 2.3). Both
  exist by now — verify, don't assume.

One review component must serve BOTH csv and orbit-mrp runs. If you find yourself
branching on source_kind for anything except labels, the WP 3.1 generalization is
incomplete — record that in §16 rather than papering over it here.
```

---

## Phase 4 — Trust anchor and the analysis store

### WP 4.1 — Complete and compose graph_hash

```
Implement WP 4.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· _build_dataset_snapshot (20260703000001_dataset_versions.sql:70-138) hashes
  suppliers, materials, products, inbound, outbound and bom_single_level ONLY.
  bom_multi_level is absent — so on a multi-level project, editing the BOM does not
  move the hash and snapshot_dataset reports "unchanged". Write the failing test
  first; it is the proof.
· supply_chain_data, network_nodes, network_edges and the deep-tier tables are
  absent too — nothing behind the three network pages is versioned at all.
· simulation_runs.dataset_version_id + graph_hash already bind runs correctly. Do
  NOT change the graph_hash name or its position in that binding; add domains
  alongside it.
· Bump schema_version in the snapshot payload so old and new snapshots are
  distinguishable.

Gap check must produce a table-by-table coverage list of every Tier-2 table against
the snapshot. A missing table is a silent blind spot of exactly the kind this WP
exists to close.
```

### WP 4.2 — The analysis store

```
Implement WP 4.2 from docs/PLAN.md.

Already verified (re-check before relying on it):
· There is NO network_metrics table. Centrality lives as COLUMNS on network_nodes
  (degree_centrality, betweenness_centrality, network_metrics_updated_at); critical
  -node prediction lives as columns on supply_chain_data (is_critical_node,
  critical_node_score, prediction_timestamp).
· should_recalculate_network_metrics (20250925164454) has three structural faults:
  it returns "up to date" when the project has no supply_chain_data rows (NULL
  last_data_time falls to ELSE false); its five LEFT JOINs correlate to
  p_project_id rather than to scd, producing a cartesian product; and it compares
  timestamps, which skew. Do not try to fix it — replace it and leave it unused
  with a comment naming D12.
· simulation_runs is the pattern: it already pins dataset + policy + engine version.
  You are generalizing that idea, not inventing it.

analysis_kind must be an OPEN enum with a params schema in the contract, so
lead_time_fit (Phase 7+) needs no migration later.

Test concurrency explicitly: two parallel requests on a cold key must not create
two runs. If the unique constraint alone does not hold, add the ON CONFLICT path
before closing the WP.
```

### WP 4.3 — Migrate the four analyzers (dual-write)

```
Implement WP 4.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· Four analyzers: calculate-network-science-metrics, calculate-node-prominence,
  predict-critical-nodes, project-ai-health. Plus combine-project, which is an
  analysis in everything but name — give it analysis_kind 'combine_etl'.
· Each currently has its own storage convention and its own (or no) invalidation.
· calculate-node-prominence is auto-invoked after deep-tier uploads
  (UploadWizard.tsx:1221) — that call site must keep working.
· auto_calculate_network_metrics_on_completion (20250925164454:78) fires on the
  projects.completed transition. Check whether it still should.

DUAL-WRITE only. Do not drop any entity column in this WP — WP 5.3 does that, after
every reader has moved. Dropping early is the one thing that makes this migration
irreversible.

The gap check is a field-by-field numeric comparison between the old columns and
analysis_results for a real project. A mismatch means the migration changed
semantics silently; investigate before Phase 5.
```

### WP 4.4 — Staleness and invalidation

```
Implement WP 4.4 from docs/PLAN.md.

Already verified (re-check before relying on it):
· CORRECTED BY WP 4.4 (§4 D81): there were TWO, not three.
  should_recalculate_network_metrics (timestamps) and prominence-recalc-on-upload
  (event-triggered, already made statement-level by WP 4.3). The third,
  "StagePolicyTable's autoSeedMarkerRef", DOES NOT EXIST — the nearest identifier
  is `autoSeededRef`, a Set of `${projectId}::${stageKey}` re-entry markers whose
  own comment records the bug that made it a Set. It is not staleness logic and
  deleting it reintroduces that bug. Verify every "already verified" line.
· getEffectiveValue (resolveEffective.ts:82) checks dataRow[field] BEFORE the
  override bundle. So re-uploads already refresh fields that live on the row
  (material_price, primary_source) but NOT fields that don't (type, basis,
  reorder_point, order_up_to, holding_cost_pct, supply_share). Those are the ones
  seeded_from_hash must flag.
· The engine reads policy overrides, not the grid. A stale override is therefore a
  simulation-correctness problem, not only a display one — say so in the UI copy.

One rule everywhere: stale iff computed_from_hash <> current_graph_hash(). Grep for
survivors in the gap check; any remaining timestamp comparison is a miss.
```

---

## Phase 5 — Lineage and in-app documentation

### WP 5.1 — Surfaces (lineage) block

```
Implement WP 5.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· Data access is concentrated enough to analyse statically: src/hooks/useStageRows.tsx,
  useItemMasters.tsx, src/lib/policies/projectLanes.ts, and the .rpc()/.from()/
  functions.invoke() calls in src/pages/*.tsx. Start there.
· Per-page reads confirmed by the audit are listed in §4 of the plan and
  in the plan's defect table — use them to validate your analyser's output, not to
  replace it.
· Some pages read tables directly with no RPC (ProcessLevelNetwork.tsx:1104-1105).
  The lineage must record what the code does, not what it should do.

Seed by static analysis, then CONFIRM by hand. An unconfirmed lineage entry is
worse than none — it will be trusted.

Gap check: every page in src/pages/ appears in at least one surfaces entry, or is
explicitly marked as reading no project data.
```

### WP 5.2a — Docs shell + Overview & architecture  ← no dependencies, highest value

```
Implement WP 5.2a from docs/PLAN.md (§6.3, §6.5, §12).

Ship the manual's shell and its first two sections (~10 pages). The manual OPENS
with the architecture — a reader must see how the software is designed before
being asked to fill in anything.

  1 Overview & architecture (7)
      What SuReSuite is · How SuReSuite is designed · The data model at a glance ·
      How your data flows · What happens to your data · System boundary ·
      Known limits
  2 Getting started (3)
      Your first project · Projects · Uploading data

Already verified (re-check before relying on it):
· /help and /help/:slug route to NotFound at App.tsx:212-214. Reverting that is
  part of this WP.
· src/components/docs/DocsLayout.tsx (408 ln) is good chrome — nav, breadcrumbs,
  pager, search, responsive. Reuse it as-is; do not write a second shell.
· src/components/docs/registry.ts has the right SHAPE (slug/title/summary/
  keywords/related, grouped) and the wrong entries. Rewrite for the 15-section
  tree in §6.3; keep the type. DocsLayout imports it at that path.
· The old bodies are at docs/archive/legacy-help-site/docBodies.tsx. Mine ONLY the
  narrative in §6.6 (ACCURATE framing, planner workflow, use cases, glossary,
  ST-1…ST-7). Do NOT revive the generated-duplicate sections.
· The 11 figures are in the published artifact listed in the plan header. Move
  their SVG into the repo in this WP so the docs carry no external dependency.

Build the full 15-section nav tree now, later sections stubbed as "coming with
<section>" rather than hidden — a reader sees the shape of the manual from day one
and every later sub-package becomes a drop-in.

Two pages carry disproportionate weight:
· "How SuReSuite is designed" — the six tiers as the journey the user's data
  takes, the three laws in plain language, the figures. Per §6.5 this answers the
  opening question every reader has: how is this built, and can I trust it.
· "Known limits" — T3. Steady-state engine, graph_hash v1 scope, no
  price-volatility model. At the TOP of the manual, not buried.

Follow §6.1 Rules 1-5 — especially Rule 3: plain language first, notation in a
collapsed block. Invariants get restated for a reader ("we never change your
numbers silently"), never quoted as I-numbers.
```

### WP 5.2b — Input tables reference  (closes D21) ← the core of the manual

```
Implement WP 5.2b from docs/PLAN.md (§6.3 section 2).

Generate 11 table pages + 2 written ones, in the anyLogistix style: purpose,
where to upload, template link, column-by-column reference, example, notes,
related tables. This is the section SuReSuite has never had.

  Inbound Logistics · Outbound Logistics · BOM single · BOM multi · Materials ·
  Products · Suppliers · Node List · Deep-Tier Nodes · Deep-Tier Edges ·
  Multi-Tier Suppliers

This WP closes D21, the defect that killed the old docs. Every column MUST lead
with ingest.csv_header — the name the user typed. The DB column and engine field
go in an expandable "Technical details" block. If you write `unit_price` as a
column heading you have reproduced the original defect.

Three specifics users get wrong today, all verified:
· lead_time is WEEKS. Capitals. The adjacent time_unit column governs VOLUME only.
· capacity_per_week blank means UNLIMITED, not zero.
· sell_price / demand_mean / demand_distribution are the user's names; the engine
  calls them unit_price / demand_mode / demand_model.

Every column needs an "If you leave it blank" line sourced from substitutions. A
column whose blank behaviour you cannot state is a finding — record it in §16, do
not guess.
```

### WP 5.2c–h — the remaining sections

```
Implement WP 5.2<c|d|e|f|g|h> from docs/PLAN.md (§6.3, §12).

c · Policies + Verification (12 pages). The policy catalog and policy types already
    render from the engine registry via gen_docs.py — link or embed, never re-type.
d · Experiments, scenarios, results, statistics (12). Needs WP 4.4.
e · Networks + Project Intelligence (9). Needs WP 5.1 lineage.
f · Computed tables + Exports & reproducibility (7). Needs WP 4.1, 4.4.
g · Connectors + Access & administration + Developer API (14). Needs WP 2.2, 3.1.
h · Reference (4) — the all-tables detail index, units & conventions, the
    glossary, and an A-Z field index. The architecture and known-limits pages are
    NOT here — they ship in 5.2a as section 1.

Replace the section's stubs from 5.2a; do not leave both.

Gap check for every sub-package: diff §6.3 against the live schema and App.tsx. A
table or route with no page and no internal-only justification is a finding.
```

### WP 5.3 — Pages read analysis_results; drop entity columns

```
Implement WP 5.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· Browser-side computation to remove: ProcessLevelNetwork reachability and level
  layout; ProductLevelNetwork adjacency (:278-288) and its centrality read from
  node columns; FirmLevelNetwork prominence. Policies' smart averages stay for now
  — those are WP 6.2.
· The downstream unit conversions made dead by WP 3.3 should be listed in §16.
  Remove them here.

Migrate readers ONE page at a time, each in its own commit, comparing old and new
values before switching. Drop each entity column only after confirming no reader
remains — and drop columns in a SEPARATE commit from the reader migration, so a
revert is cheap.

This is the WP most likely to be cut short by budget. If so, migrate fewer pages
fully rather than all pages partially, and hand off precisely.
```

---

## Phase 6 — The policy data contract

### WP 6.1 — Resolution chains, documented and pinned

```
Implement WP 6.1 from docs/PLAN.md.

Already verified (re-check before relying on it):
· The Supplier stage is the deepest chain and the right one to do first:
  columnSpecs.ts:119-181 declares the columns; useStageRows.tsx:213-359 builds the
  rows; resolveEffective.ts resolves each cell; project_map.py consumes the result.
· Substitutions to document exhaustively: resolveField's `> 0` test
  (useStageRows.tsx:162), the per-item-then-global smart averages (:146-153),
  defaultWhenMissing (columnSpecs.ts:132-171), the effectivePolicy bundle,
  liveDefault's master fallback (§4 D17 — the bare `?? 0` is gone; a column whose
  empty state means something declares it), grading.ts's reducers,
  and ENGINE_DEFAULT_PRICE.
· supabase/functions/_shared/grading.ts is pinned to project_map.py by
  validation-parity fixtures. Pin the chains the same way, in the same style.

A chain you cannot write down is a bug. List those rather than inventing prose for
them — the list is this WP's most valuable output and feeds WP 6.2.
```

### WP 6.2 — Fix the divergences

```
Implement WP 6.2 from docs/PLAN.md.

Already verified (re-check before relying on it):
· D17: ensure_item_masters (item_master.sql:91-96 builds materials; the supplier
  insert is at :85-89) inserts supplier rows with
  capacity_per_week NULL = UNLIMITED. masterValueFor returns undefined for null,
  derivedValueFor has no suppliers branch, so liveDefault = derivedVal ?? 0 renders
  "0" with provenance "default" — whose colour is null, so NO dot at all. The grid
  states capacity is zero when the model means infinite.
· D18: material_price is consumed NOWHERE in scsim/ or sim-worker/ — grep returns
  nothing. It is COLUMN_FIT keep:true (columnSpecs.ts:353) while material_cost,
  which the engine does read, carries prio:8 and folds away first.
· The cheapestInboundCost / resolveField divergence: grading.ts:159 floors a <=0
  arc price to 1.0 before taking the min, while useStageRows.tsx:162 rejects the
  same 0 and imputes an average. One row can show Price 42.50 (imputed) and Cost
  1.00 (derived) for the same material.
· D16 residual from WP 0.1: the untracked branch is GONE — provenance now reads
  __from_data / __imputed / __decided and nothing else. What remains for 6.2 is
  D23 (the row shadows a saved override) and D24. Carry `suggested` through.
· ensure_item_masters unions bom_single_level ONLY — multi-level BOM materials get
  no master row. Fix here or record as a separate finding.

De-duplicate StagePolicyTable.tsx:1208-1276 against resolveEffective.ts's
resolveCell in this WP — it has been carried in lockstep since WP 0.1 and this is
where that debt is paid.

The WP 0.1 gap check added three more divergences to this package: the dead
defaultWhenMissing table, seven bundle fields stored and hashed but shown and read
by nothing, and the plant stage's discarded production_lead_time_mean_days. They
are stated in PLAN.md §13 WP 6.2 with their evidence in §16 — read both.
```

### WP 6.3 — Provenance vocabulary and researcher export

```
Implement WP 6.3 from docs/PLAN.md.

Already verified (re-check before relying on it):
· Current vocabulary: policyGridUi.tsx:15-41 defines data | master | imputed |
  derived | override | edited | default. `default` has colour null, so it renders
  NO dot — decide deliberately whether that stays true for the new states.
· Reserved in WP 1.2 and now to be used: `contract` and `estimated`.
· ProvenanceLegend (policyGridUi.tsx:54) must gain the new states or it will
  under-report.

The export is the deliverable that makes this researcher-grade: for a chosen
project, every displayed value with its full chain — source file, DB column, RPC,
substitutions applied, engine field, unit at each hop, and the dataset version and
hash it was read at.

Exit criterion is behavioural, not cosmetic: a researcher must be able to
reproduce any displayed number from the source file using only the export.
```

---

## Utility prompts

### Resume a WP that ran out of budget

```
A previous session started WP <N.M> from docs/PLAN.md and did
not finish. Do NOT restart it.

1. Read §16 Drift Log for the last entry and any partial handoff note.
2. Read `git log --oneline -10` and `git diff origin/main...HEAD` to see what
   actually landed.
3. Re-verify the WP's Preconditions and re-run its Exit checks to establish the
   true state — the transcript is gone, the code is not.
4. Report what remains, then finish it under the normal WP rules, including the
   gap check.

If what landed contradicts the plan, the plan is wrong — fix the plan.
```

### Gap check only

```
Do the GAP CHECK for WP <N.M> in docs/PLAN.md. No new feature
work.

· Re-read the previous WP's Handoff note in §16. Did reality match?
· Re-run this WP's Exit checks. Report honestly — a check that passes only with a
  caveat has not passed.
· Run the §15 verification SQL if this WP touched data, and compare to the recorded
  baseline.
· List anything discovered that invalidates a later WP, and EDIT those WPs.
· Append the drift-log entry and the handoff note.

Commit as: Phase N / WP N.M: gap check.
```

### Phase boundary review

```
Phase <N> of docs/PLAN.md is complete. Before Phase <N+1>:

1. Read every §12 entry for this phase. Summarize what the plan got wrong.
2. Re-run the full §11 verification SQL; compare against the Phase 0 baseline and
   report the deltas.
3. Confirm each phase Exit criterion actually holds — test it, do not infer it.
4. Re-read Phase <N+1>'s WPs against what you now know and revise their
   Preconditions and Steps.
5. Update §17 Sequencing if effort estimates moved.

Report: what is now true, what the plan still assumes, and whether Phase <N+1> is
correctly scoped. Commit as: Phase N: boundary review.
```
