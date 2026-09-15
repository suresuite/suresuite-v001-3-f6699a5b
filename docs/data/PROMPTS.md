# Data Spine — Execution Prompts

> **Companion to** `docs/data/IMPLEMENTATION-PLAN.md`
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
You are implementing ONE work package from docs/data/IMPLEMENTATION-PLAN.md
on branch claude/busy-lovelace-5hxsh6 (PR #187). Read §1 of that plan first —
it defines the work-package lifecycle. Follow it exactly.

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
6. Commit as: Phase N / WP N.M / <blueprint ref>: <title>. Push to the branch;
   it updates PR #187.

Read docs/design/next-gen-platform-design.md §2.3 and §8.1–8.4 before touching
the simulation platform, per CLAUDE.md.
```

---

## Phase 0 — Stabilize and consolidate

### WP 0.1 — Kill the silent policy override

```
Implement WP 0.1 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· useStageRows.tsx:283-288 writes hardcoded constants onto every supplier row.
  Only safety_stock_days has a matching ColSpec and reaches the engine
  (project_map.py:783 defaults it to 7.0 — we are persisting 0).
  supplier_capacity_per_day, ordering_cost and lead_time_distribution have NO
  matching ColSpec field; confirm and delete them rather than preserving them.
· StagePolicyTable.tsx:887 calls applyPrefill() un-awaited, and setApplying(true)
  only runs at :865 AFTER the row loop — so the `applying` guard is not armed
  during the window the effect can re-enter.
· The autoSeedMarkerRef marker is `${projectId}::${stageKey}`, so a
  supplier→plant→supplier tab round trip re-enters for supplier.
· The provenance logic at StagePolicyTable.tsx:1170-1225 is a VERBATIM copy of
  resolveEffective.ts:124-180. Fix both branches identically. De-duplicating
  them is WP 6.2's job — do not do it here, but note in §16 that they must stay
  in lockstep until then.

Decide and record: whether to drop the constants from the row entirely (my
recommendation — let columnSpecs.defaultWhenMissing supply them) or tag them as
non-data. Justify whichever you pick in the commit message.
```

### WP 0.2 — Unit conversion + orphan-table honesty

```
Implement WP 0.2 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· combine-project/index.ts carries `// @ts-nocheck` and reads row.volume raw at
  :60, :68, :268, :274. There are further unconverted uses at :115 (productDemand
  feeding the single-level BOM weighting), :234-235 and :318 (multi-tier). Trace
  all of them — fixing only the four obvious ones leaves the multi-tier lane wrong.
· rateToWeekly lives in supabase/functions/_shared/grading.ts, which is
  dependency-free and Deno-safe. Import it; do NOT write a local copy (invariant I3).
· product_code_map at :96 destructures only { data } — the error is swallowed and
  the table exists in NO migration. The mapped branch at :110-113 is therefore
  dead code today. Make the failure loud; deciding whether to add the table or
  delete the branch is WP 1.4, not this one.
· risk_data is read at ProductLevelNetwork.tsx:482 and FirmLevelNetwork.tsx:283
  with quoted column names ("RISK CLASS") and has no migration either.

Conversion changes weighted magnitudes. supply_chain_data.weighted is
numeric(16,6) (set by migration 20250816031317) — confirm no overflow for the
largest project you can find.

End by running EVERY query in §15 of the plan against one real project and
recording the counts in §16. Those numbers are the baseline every later phase is
measured against — this is the most valuable thing this WP produces.
```

### WP 0.3 — Documentation consolidation · PARTLY DONE (`719f59b`)

```
Finish WP 0.3 from docs/data/IMPLEMENTATION-PLAN.md. The archive half is DONE —
docBodies.tsx and HelpPage.tsx are in docs/archive/legacy-help-site/ with a README.
Read §16's WP 0.3 drift-log entry before starting.

Remaining:
· Move docs/data-simulation-mapping.md → docs/data/field-mapping.md and
  docs/simulation-data-lifecycle.md → docs/data/lifecycle.md, each with a status
  banner (GENERATED / AUTHORED / DEPRECATED → superseded by X).
· Leave a tombstone stub at every old path.
· Write docs/data/README.md as the index.
· Add to CLAUDE.md: docs/data/ is the single archive for data facts; no data fact
  is authored in more than one place.

Preserve content verbatim. The only new prose is the banners and the index.
Do NOT touch the archived files — mining them is WP 5.2a's job.
```

---

## Phase 1 — The contract and its gate

### WP 1.1 — Schema introspector

```
Implement WP 1.1 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 1.2 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 1.3 from docs/data/IMPLEMENTATION-PLAN.md.

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

### WP 1.4 — Generator, drift gate, orphan reconciliation

```
Implement WP 1.4 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· scsim/scripts/gen_docs.py --check is the exact gate pattern to copy, including
  its GENERATED header and its drift failure mode. Read it before writing check.mjs.
· registry.generated.json is committed in TWO places (src/lib/policies/ and
  supabase/functions/_shared/) by scsim/scripts/gen_frontend_registry.py, and
  scripts/check_registry_bridge.mjs guards the bridge. Follow the same convention.
· CI workflows live in .github/workflows/. scsim-tests.yml and
  supabase-functions.yml are the closest models.

You must DECIDE the orphans in this WP, not defer them:
· product_code_map — add the migration, or delete combine-project/index.ts:96-102
  and :110-113. Deleting is my recommendation: the branch has never executed.
· risk_data — needs a real migration with source, vintage, licence and
  refreshed_at, and the quoted columns renamed. Two pages depend on it.

Set the natural-key rule to WARN, not error — WP 3.3 makes it passable. Leave a
dated TODO so WP 2.4 can flip it.

Add the invariants table from §2.1 of the plan to CLAUDE.md in this commit.
```

---

## Phase 2 — Governance consolidation

### WP 2.1 — One organization identity

```
Implement WP 2.1 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· TWO org identities coexist. Legacy: approved_users.organization TEXT and
  projects.organization TEXT DEFAULT 'default_org', compared by string equality
  via get_current_user_org() (defined twice — 20250820163748 and 20250820165722;
  the later one wins). Modern: organizations(id uuid, name, slug) +
  organization_members + approved_users.organization_id, added by
  20260709000002_super_admin_phase1.sql.
· The bridge is fragile by construction: the RLS on `organizations` itself reads
  USING (name = get_current_user_org() OR slug = get_current_user_org()).
· Renaming an organization therefore revokes access to its own projects. Write a
  failing test for this FIRST — it is the proof the WP works.
· user_plant_access is a third, vestigial mechanism keyed on plant TEXT, still
  referenced in 20250820145017 RLS policies.

Inventory before editing: grep -rn "get_current_user_org()" supabase/ | wc -l.
Report the number; it sizes the WP.

Dual-read (uuid OR text) during transition. Do NOT remove the text branch in this
WP — that is a follow-up migration once the backfill is verified at 100%.
```

### WP 2.2 — Project membership and the resolver

```
Implement WP 2.2 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 2.3 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 2.4 from docs/data/IMPLEMENTATION-PLAN.md.

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

### WP 3.1 — ingest_* generalization

```
Implement WP 3.1 from docs/data/IMPLEMENTATION-PLAN.md.

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
· projectLanes.ts:30-33 truncates at .limit(10000) with no flag. GradingDataset
  already models this correctly with a `truncated` field — copy that pattern.

Behaviour of the MRP connector must not change. Write the regression test for a
full stage→diff→promote cycle BEFORE renaming anything.
```

### WP 3.2 — Server-side parse and Tier 0/1 landing for CSV

```
Implement WP 3.2 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· UploadWizard.tsx:476-477 and :497-523 parse with split(','). Confirmed behaviour:
  – a quoted comma shifts EVERY subsequent column left by one
  – BOM is stripped (U+FEFF is ES WhiteSpace, so .trim() removes it) — accidental
  – CRLF survives (the per-field .trim() removes \r)
  – a semicolon file is correctly BLOCKED by the missing-headers check
  – fewer fields → Number(undefined) → NaN → null, silently
· Validation gaps: :369 tests `=== undefined || === ''`, but :505/:508 already
  turned blanks and garbage into NULL, which passes. And :410/:413 use
  `if (x && x < 0)`, so 0 and null pass.
· ingest-bom-multi-level/index.ts:42-44 already does the right thing:
  (x ?? '').toString().trim() || null. Copy that pattern to the other two — do not
  invent a third.
· The standard upload button IS gated on errors.length === 0 (UploadWizard.tsx:1833),
  so validateData errors do block. The problem is what it fails to catch, not the gate.

Delete the client-side parse. Do not leave it behind a flag — two parsers is the
defect class this WP exists to end.
```

### WP 3.3 — Natural keys, upsert, normalization at promotion

```
Implement WP 3.3 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· NO lane table has a natural-key unique index — only `id UUID PRIMARY KEY`
  (20250820145837_5a2d95f1). materials/products/suppliers DO have composite PKs.
· Duplicates therefore already exist in real projects. Run the §15 duplicate query
  and report counts BEFORE deduplicating, and again after.
· Duplicates distort sourcing_ratio (combine-project:277 — the duplicate appears in
  both numerator and denominator), the smart-average imputation basis
  (useStageRows.tsx:125-131), and the grading reducers. Dedup will therefore CHANGE
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
Implement WP 3.4 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 4.1 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 4.2 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 4.3 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· Four analyzers: calculate-network-science-metrics, calculate-node-prominence,
  predict-critical-nodes, project-ai-health. Plus combine-project, which is an
  analysis in everything but name — give it analysis_kind 'combine_etl'.
· Each currently has its own storage convention and its own (or no) invalidation.
· calculate-node-prominence is auto-invoked after deep-tier uploads
  (UploadWizard.tsx:1280-1307) — that call site must keep working.
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
Implement WP 4.4 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· THREE ad-hoc staleness mechanisms exist and none consults graph_hash:
  should_recalculate_network_metrics (timestamps), prominence-recalc-on-upload
  (event-triggered), and StagePolicyTable's autoSeedMarkerRef (a useRef).
  All three must go.
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
Implement WP 5.1 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· Data access is concentrated enough to analyse statically: src/hooks/useStageRows.tsx,
  useItemMasters.tsx, src/lib/policies/projectLanes.ts, and the .rpc()/.from()/
  functions.invoke() calls in src/pages/*.tsx. Start there.
· Per-page reads confirmed by the audit are listed in §4 of the plan and
  in the plan's defect table — use them to validate your analyser's output, not to
  replace it.
· Some pages read tables directly with no RPC (ProcessLevelNetwork.tsx:1110-1111).
  The lineage must record what the code does, not what it should do.

Seed by static analysis, then CONFIRM by hand. An unconfirmed lineage entry is
worse than none — it will be trusted.

Gap check: every page in src/pages/ appears in at least one surfaces entry, or is
explicitly marked as reading no project data.
```

### WP 5.2a — Docs shell + Getting started  ← no dependencies, do this early

```
Implement WP 5.2a from docs/data/IMPLEMENTATION-PLAN.md (§6.3, §12).

Stand up the manual's shell and its first section (~7 pages):
  Getting started · What SuReSuite is · Your first project · Projects ·
  What happens to your data · Units and time periods · Uploading data

Already verified (re-check before relying on it):
· /help and /help/:slug route to NotFound at App.tsx:212-214. Reverting that is
  part of this WP.
· src/components/docs/DocsLayout.tsx (408 ln) is good chrome — nav, breadcrumbs,
  pager, search, responsive. Reuse it as-is; do not write a second shell.
· src/components/docs/registry.ts has the right SHAPE (slug/title/summary/
  keywords/related, grouped) and the wrong entries. Rewrite the entries for the
  14-section tree in §6.3; keep the type. DocsLayout imports it at that path.
· The old bodies are at docs/archive/legacy-help-site/docBodies.tsx. Mine ONLY the
  narrative in plan §6.6 (ACCURATE framing, planner workflow, use cases, glossary,
  ST-1…ST-7). Do NOT revive the generated-duplicate sections.

Build the full 14-section nav tree now, with later sections stubbed as
"coming with <section>" rather than hidden — a reader should see the shape of the
manual from day one, and each later sub-package becomes a drop-in.

"Units and time periods" is load-bearing: it is the page that settles that
time_unit governs VOLUME only and lead_time is always weeks. Write it carefully.

Follow §6.1 Rules 1-5 — especially Rule 3: plain language first, notation in a
collapsed block. These pages are read by a planner, not a modeller.
```

### WP 5.2b — Input tables reference  (closes D21) ← the core of the manual

```
Implement WP 5.2b from docs/data/IMPLEMENTATION-PLAN.md (§6.3 section 2).

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
Implement WP 5.2<c|d|e|f|g|h> from docs/data/IMPLEMENTATION-PLAN.md (§6.3, §12).

c · Policies + Verification (12 pages). The policy catalog and policy types already
    render from the engine registry via gen_docs.py — link or embed, never re-type.
d · Experiments, scenarios, results, statistics (12). Needs WP 4.4.
e · Networks + Project Intelligence (9). Needs WP 5.1 lineage.
f · Computed tables + Exports & reproducibility (7). Needs WP 4.1, 4.4.
g · Connectors + Access & administration + Developer API (14). Needs WP 2.2, 3.1.
h · Reference (5) — publish the spine per §6.5, the all-tables index, the glossary
    and the known-limits page. Move the figure SVGs out of the published artifact
    and into the repo so the docs have no external dependency.

Replace the section's stubs from 5.2a; do not leave both.

Gap check for every sub-package: diff §6.3 against the live schema and App.tsx. A
table or route with no page and no internal-only justification is a finding.
```

### WP 5.3 — Pages read analysis_results; drop entity columns

```
Implement WP 5.3 from docs/data/IMPLEMENTATION-PLAN.md.

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
Implement WP 6.1 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· The Supplier stage is the deepest chain and the right one to do first:
  columnSpecs.ts:119-178 declares the columns; useStageRows.tsx:191-325 builds the
  rows; resolveEffective.ts resolves each cell; project_map.py consumes the result.
· Substitutions to document exhaustively: resolveField's `> 0` test
  (useStageRows.tsx:164), the per-item-then-global smart averages (:146-153),
  defaultWhenMissing (columnSpecs.ts:132-168), the effectivePolicy bundle,
  liveDefault = derivedVal ?? 0 (resolveEffective.ts:135), grading.ts's reducers,
  and ENGINE_DEFAULT_PRICE.
· supabase/functions/_shared/grading.ts is pinned to project_map.py by
  validation-parity fixtures. Pin the chains the same way, in the same style.

A chain you cannot write down is a bug. List those rather than inventing prose for
them — the list is this WP's most valuable output and feeds WP 6.2.
```

### WP 6.2 — Fix the divergences

```
Implement WP 6.2 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· D17: ensure_item_masters (item_master.sql:85-89) inserts supplier rows with
  capacity_per_week NULL = UNLIMITED. masterValueFor returns undefined for null,
  derivedValueFor has no suppliers branch, so liveDefault = derivedVal ?? 0 renders
  "0" with provenance "default" — whose colour is null, so NO dot at all. The grid
  states capacity is zero when the model means infinite.
· D18: material_price is consumed NOWHERE in scsim/ or sim-worker/ — grep returns
  nothing. It is COLUMN_FIT keep:true (columnSpecs.ts:350) while material_cost,
  which the engine does read, carries prio:8 and folds away first.
· The cheapestInboundCost / resolveField divergence: grading.ts:159 floors a <=0
  arc price to 1.0 before taking the min, while useStageRows.tsx:164 rejects the
  same 0 and imputes an average. One row can show Price 42.50 (imputed) and Cost
  1.00 (derived) for the same material.
· D16 residual from WP 0.1: re-verify the tracked/untracked provenance branch.
· ensure_item_masters unions bom_single_level ONLY — multi-level BOM materials get
  no master row. Fix here or record as a separate finding.

De-duplicate StagePolicyTable.tsx:1170-1225 against resolveEffective.ts's
resolveCell in this WP — it has been carried in lockstep since WP 0.1 and this is
where that debt is paid.
```

### WP 6.3 — Provenance vocabulary and researcher export

```
Implement WP 6.3 from docs/data/IMPLEMENTATION-PLAN.md.

Already verified (re-check before relying on it):
· Current vocabulary: policyGridUi.tsx:15-35 defines data | master | imputed |
  derived | override | edited | default. `default` has colour null, so it renders
  NO dot — decide deliberately whether that stays true for the new states.
· Reserved in WP 1.2 and now to be used: `contract` and `estimated`.
· ProvenanceLegend (policyGridUi.tsx:49) must gain the new states or it will
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
A previous session started WP <N.M> from docs/data/IMPLEMENTATION-PLAN.md and did
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
Do the GAP CHECK for WP <N.M> in docs/data/IMPLEMENTATION-PLAN.md. No new feature
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
Phase <N> of docs/data/IMPLEMENTATION-PLAN.md is complete. Before Phase <N+1>:

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
