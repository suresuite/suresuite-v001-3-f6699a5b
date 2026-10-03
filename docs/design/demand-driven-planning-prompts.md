# Demand-driven planning — execution prompts (Phase 14)

> **Companion to** `docs/PLAN.md` §24 (the work plan) and `docs/design/mrp-multi-stage-planning.md`
> (the design: definitions, formulas, the worked example).
> **Status:** AUTHORED 2026-10-02.

One prompt per work package. Each is sized for **one fresh session**: paste the **preamble**,
then **one** WP prompt. Never run two WPs in one session. The gap check at the end of each
package is what keeps the next one honest.

The *Already verified* lines are leads from the investigation that produced the plan, recorded
so a cold session does not spend its budget rediscovering them. **Re-check anything you rely
on**: code moves.

---

## The preamble — paste before every WP prompt

```
You are implementing ONE work package of Phase 14 ("Demand-driven planning") of
docs/PLAN.md. Work on the branch your session names; if none, branch from the latest
default branch.

Read first, in this order:
1. CLAUDE.md — the invariants by gate name, the data-contract commands, and
   "AFTER A BASE MERGE, RUN contract:check AND npm test BEFORE ANYTHING ELSE".
2. docs/PLAN.md §1 (the work-package lifecycle) and §24 (Phase 14: the owner's eight
   decisions, how it fits Phase 13, your package's scope and Exit).
3. docs/design/mrp-multi-stage-planning.md — §0 decisions, §2 the worked example,
   §3 the exact definitions, §5 the engine changes. Your package must match it.
4. docs/design/next-gen-platform-design.md §2.3 (G20), §5.2, §5.4 and §13 B2.
5. The §16 drift-log entries of every earlier Phase 14 package (search "WP 14.").

Non-negotiables:
1. VERIFY every precondition in your prompt against the code before you start. If one
   does not hold, stop and report. Do not work around it.
2. STAY IN SCOPE. A defect that belongs to another package goes into §16 and into that
   package's text in §24, not into your diff.
3. BEHAVIOUR-NEUTRAL BY DEFAULT. A project that sets none of the new fields must run
   byte-identically: the golden traces in scsim/tests must not move — since WP 14.0 that
   means the frozen digests scsim/tests/data/golden_digests.json and
   sim-worker/tests/data/golden_runs.json (regenerate them only for a declared change,
   with SCSIM_WRITE_GOLDEN=1 / SIMWORKER_WRITE_GOLDEN=1, and name what moved). A deliberate
   behaviour change needs an ENGINE_VERSION bump (scsim/scsim/__init__.py), a line in
   scsim/docs/adr/0002-demand-driven-planning.md and a §16 note.
4. THE PLAN NEVER READS REALIZED FUTURE DEMAND. Any planner you write reads the projected
   demand (forecast or mean), never ctx.demand_schedule beyond the current week. The
   information-honesty test must stay green.
5. ONE WRITER PER STATE KEY (blueprint A1). New keys are declared in
   scsim/scsim/core/phases.py and validated at compile; never write a key another hook owns.
6. SCHEMAS COME FROM THE REGISTRY (A6). A new or changed policy parameter is a Pydantic
   field in the plugin. Regenerate the frontend registry and the engine docs; never
   hand-write a parallel schema.
7. PAGE EQUALS RUN. Every new /policies cell either reaches the engine (declare its scope
   in POLICY_BUNDLE_KEYS in scsim/scsim/io/project_map.py) or is badged "not simulated".
   Edits on /policies are policy overrides, never item-master writes (Phase 13).
8. A TABLE OR COLUMN THE ENGINE NEWLY READS joins the dataset snapshot's simulation scope
   in the same package (simulationScopeParity.test.ts, graphHashCoverage.test.ts).
9. Data-layer file:line evidence is cited ONLY in PLAN.md §4 (npm run check:docs).
   Elsewhere cite the D-number or a symbol (file::function).

Checks — run all that apply, and all must pass before you commit:
  Engine:   (cd scsim && python -m pytest tests -q)
            (cd scsim && python scripts/gen_docs.py --check)
            (cd scsim && python scripts/gen_frontend_registry.py --check)
            node scripts/check_registry_bridge.mjs
            bash scripts/build_engine_wheels.sh --check
            (cd sim-worker && python -m pytest tests -q)
            (cd supabase/functions/_shared && deno test --allow-read grading_test.ts env_test.ts)
  Web/data: npm run lint        (typecheck, check:docs, audit:ui, eslint)
            npm test
            npm run contract:check
  If you add a migration (needs PostgreSQL 16):
            npm run contract:rehearse
            npm run contract:rehearse -- --fixtures
            npm run contract:rehearse -- --since HEAD
  Regenerate when the input changed, and commit the output:
            (cd scsim && python scripts/gen_frontend_registry.py && python scripts/gen_docs.py)
            bash scripts/build_engine_wheels.sh
            npm run contract:generate

Finish:
- Spend the last ~10% of your budget on the GAP CHECK: what the previous package
  promised versus what you found, and what the next package inherits. Append a §16
  entry (format at the top of §16) in the SAME commit as the code. If a finding changes
  a later package, edit that package in §24 (and the design doc) in the same commit.
- Mark your package ✅ in §24's heading and update its row in §17.
- Commit as: Phase 14 / WP 14.N / <blueprint ref>: <title>
- Push. Open a PR only if your session instructions allow it.
```

---

## WP 14.0 — Baseline and the shared allocation helper

```
GOAL. Pin today's behaviour, and build the one allocation function that both per-row
fulfillment (WP 14.3) and the planned-production shortfall split (WP 14.4) will call.
No behaviour change.

PRECONDITIONS — verify:
- Phase 13 is complete (PLAN.md §17 row 13 says PHASE COMPLETE).
- scsim/scsim/policies/improvisation/p_c2_customer_allocation.py is still a read-only
  PH-60 resident that splits product fulfillment across customers (fcfs / proportional /
  fair_share pro-rata, priority, sla_tier).
- scsim/scsim/core/engine.py::_mech_material_demand still uses exp_demand_m (MTO) or
  forecast × BOM (MTS).

Already verified (leads):
- Probe method: the design doc's appendix. Golden-#1 chain, demand stepped 100 → 150
  at week 25 by editing ctx.demand_schedule: material_demand reads 100 in all weeks.
- The backlog is per product: P-C.1's age_buckets has shape (n_prods, horizon+1).

DO:
1. scsim/tests/test_planning_baseline.py: characterization tests for
   (a) material_demand constant under a demand step (MTO);
   (b) backlog shape = per product.
   Comment each assertion with the WP that will flip it (14.5 for (a), 14.3 for (b)).
2. scsim/scsim/core/allocation.py: a pure, vectorized function, for example
     allocate(supply: float, backlog_by_age: [rows × ages], new_demand: [rows],
              rule, priority, price, floor_pct) -> served_backlog_by_age, served_new
   for ONE product's rows. Rules:
   - priority: highest priority filled fully first.
   - fair_share: equal fill rate.
   - proportional: pro-rata to weight (default: the row's want).
   - revenue_max: by price, highest first.
   - sla_tier: floors first (scaled pro-rata if supply cannot meet all floors), then
     priority.
   Within a row: oldest backlog first, then new demand. Deterministic tie-break by row
   order. Totals conserved exactly.
   Also provide a batched form over all products (CSR row→product index), so the hot
   path has no per-product Python loop where avoidable (blueprint R4).
3. Refactor P-C.2 to call the helper. Its outputs must be identical: its existing tests
   and the golden traces are the proof.
4. scsim/docs/adr/0002-demand-driven-planning.md: decisions 1–8 from PLAN.md §24,
   status "accepted", with links to the design doc and §24.

TESTS. Each rule: scarcity, zero supply, more supply than want, ties, sla floors that
cannot all be met, conservation (property test over random inputs).

EXIT. All engine checks green, golden traces byte-identical, P-C.2 delegates to the
helper. No registry change is expected; if gen_frontend_registry --check moves, explain
why in §16.

COMMIT. Phase 14 / WP 14.0 / G20 §5.4: planning baseline and the shared allocation helper
```

---

## WP 14.1 — Demand per customer × product row, in the engine

```
GOAL. Demand is specified and drawn per customer × product row. Product demand = the
sum of its rows. The plan can read projected demand (forecast or mean) without seeing
draws. Owner decisions 2 and 8.

PRECONDITIONS — verify:
- WP 14.0 merged (allocation helper and ADR 0002 exist).
- scsim/scsim/entities/network.py::CustomerLink has product_id, customer_id, share.
- scsim/scsim/core/context.py::draw_week_demand draws per product by demand group, and
  the draw order is the world-stream contract the golden traces byte-compare.
- scsim/scsim/io/project_map.py::_build_product maps an unsupported kind (including
  "normal") to triangularAV with a warning, and passes demand_cv as triangular_av's
  fraction (§4 D284 (b)).

DO:
1. Entities. Give CustomerLink an optional demand spec:
   - demand_model: deterministic | normal | triangular | triangular_av | poisson
   - demand_mean (units/week)
   - demand_variation, interpreted by model:
     normal → CV; triangular_av → ± fraction; deterministic/poisson → ignored
   - demand_min, demand_max (triangular)
   - forecast: optional list[float], one value per simulated week from week 0
   Validate each combination with a clear error.
2. DemandModel.NORMAL: draw N(μ, σ = CV·μ), set negatives to 0, and count the clips per
   row. ScenarioResult reports the clip count and the realized mean shift; a mapping/run
   warning appears when clips > 0. Support it at product level too.
3. CompiledModel and SimContext:
   - If ANY row has a spec, pre-draw demand per row [rows × (T + lookahead)] in a fixed
     row order from the world demand stream (a NEW consumption contract, documented in
     the function's docstring).
   - Rows without a spec take their product's distribution scaled by the row's share.
   - Product demand = row sum (sparse row→product matrix).
   - If NO row has a spec, keep today's per-product draw: byte-identical.
4. Forecast series: the per-week centre of the row's distribution. Past the end of the
   series: the row's mean if set, else the last value, with a warning.
5. ctx.projected_demand_rows(t, H) and ctx.projected_demand(t, H) (products): the plan's
   view = forecast value or mean. They MUST NOT read the drawn schedule.
6. KPIs (kpi_contribution or the accounting phase): projected-vs-actual bias and MAPE
   per product over the analysis window.
7. Mapper (project_map.py):
   - Accept optional per-row demand fields on the outbound arcs / ProjectData. The data
     columns arrive in WP 14.2; build the plumbing and test it with fixtures.
   - Make "normal" a real normal. This is a DECLARED behaviour change: bump
     ENGINE_VERSION, add an ADR 0002 line and a §16 note naming the projects whose
     products declare normal (if you cannot measure them, say so).
   - Variation by distribution: demand_cv stays triangular_av's fraction for
     triangular/triangular_av and is a CV for normal. Say so in the mapping warning
     text and in the products sidecar's meaning in WP 14.2 (record it in §24 for 14.2
     if you do not touch sidecars).
8. Regenerate the registry, docs and wheels if anything they read changed.

TESTS:
- No row specs → golden traces byte-identical.
- Two rows (one forecast, one normal) → product demand = sum; per-row series shape.
- Normal sampler: mean and sd within tolerance over a long horizon; clip count correct
  at CV = 1.5.
- Information honesty: perturb ctx.demand_schedule for weeks > t and assert
  projected_demand(t, H) is unchanged.
- Mapper: "normal" no longer warns or falls back; variation semantics.

EXIT. All engine and worker checks green, ENGINE_VERSION bumped, wheels rebuilt, ADR
line added.

COMMIT. Phase 14 / WP 14.1 / G20 §5.4: demand per customer × product row (P-C.4), real normal
```

---

## WP 14.2 — Demand per row: data, ingestion, snapshot, Customer table

```
GOAL. A user can upload or enter demand per customer × product row (a forecast series,
or mean + variation + distribution), see it on the /policies Customer table, and the
run uses exactly that. Owner decisions 2 and 7.

PRECONDITIONS — verify:
- WP 14.1 merged (the engine reads per-row demand specs and forecasts from ProjectData).
- Phase 13 rules hold: /policies writes overrides only (policiesNeverWriteMasters.test.ts);
  the worker computes from frozen snapshots (sim_worker/local.py::run_from_snapshots).
- outbound_logistics is customer × product with volume, time_unit, unit_price (read its
  sidecar in supabase/contract/).

DO:
1. Decide the home of the per-row demand spec: columns on outbound_logistics (default)
   or a new table. Use outbound_logistics' natural key as evidence and record the
   decision in §16.
   Columns: demand_distribution, demand_mean, demand_variation, demand_min, demand_max.
   Units: the row's time_unit, normalized to weeks at promotion.
2. New table for forecast series, e.g. demand_forecasts:
   (project_id, customer_id, product_id, period_start date, quantity, time_unit).
   It needs a sidecar, a natural key (NULLS NOT DISTINCT if any key column is nullable),
   audit triggers, governance block, ingestion spec + CSV template, and an
   ingest_apply_run path (it lands at tier 0/1 and is promoted, gate no-tier-skip).
   A MONTHLY quantity is spread evenly over the weeks of that month AT PROMOTION
   (decision 7, gate normalize-at-promotion); the review screen says so.
3. Snapshot: add the new columns and table to the dataset snapshot's simulation scope.
   simulationScopeParity.test.ts and graphHashCoverage.test.ts must pass.
   datamap.py / run_from_snapshots pass them into ProjectData.
4. /policies Customer table (src/lib/policies/columnSpecs.ts, the customer stage):
   - Columns: demand mode (forecast | model), distribution, mean, variation (label by
     distribution: "CV" for normal, "± fraction" for triangularAV), min, max.
   - The base value comes from the data; an edit is a row policy override
     (key: customer::product).
   - The forecast series is shown read-only with its source (count of weeks, first
     values) and uploaded in Project manager.
   - Declare row scope for the new keys in POLICY_BUNDLE_KEYS.
   - Extend scripts/example_project/page_equals_run.json so pageEqualsRun.test.ts covers
     the new cells.
5. Pre-run gate (supabase/functions/_shared/grading.ts and its vitest mirror):
   - Block: a distribution missing a parameter it needs (triangular without min/max,
     normal without mean).
   - Warn: a forecast shorter than the horizon.
6. Manual: the demand input pages and the CSV template doc. Edit sidecars, never
   docs/data/tables/*.md (generated).
   Inherited from WP 14.1 (§16): the products sidecar's demand_cv meaning says it is
   read by the distribution (CV for normal, ± fraction for triangular/triangularAV);
   demand_distribution's says normal is real since engine 0.3.0. datamap must fill
   OutboundArc's demand_* fields and weekly `forecast` list (the engine side exists).
   Decide and record how a forecast's period_start maps to a simulated week
   (design doc §9, point 4).
7. If useful, add a §15 probe for the new table in its OWN push (CLAUDE.md: the probe
   travels separately).

TESTS. A rehearsal (supabase/rehearsal/NNN_*.sql; take the next free number) proving
upload → promotion → snapshot carries the forecast and the monthly spread. A worker
test: run_from_snapshots uses the uploaded forecast. pageEqualsRun zero diffs.
Ingestion parity tests (ingestSpecParity.test.ts).

EXIT. All web/data checks, contract:check, contract:rehearse three ways, worker tests,
page equals run.

COMMIT. Phase 14 / WP 14.2 / G20 §8.3: demand per row — data, forecast ingestion, snapshot, Customer table
```

---

## WP 14.3 — Per-row fulfillment

```
GOAL. Backorder allowed, max backorder days and backorder cost per unit per day are set
per customer × product row, with a per-row backlog. One allocation rule per project,
using per-row priority, price and service target. Owner decisions 4 and 5.

PRECONDITIONS — verify:
- WP 14.0 (allocation helper) and WP 14.1 (rows exist in the engine) merged.
  WP 14.2 is helpful but not required (rows can come from outbound arcs).
- project_map.py::_FULFILLMENT_DEFAULT_ONLY still drops per-node fulfillment keys with
  a warning; revenue_max still maps to priority (§4 D284 (c)).
- customers.sla_fill_floor_pct is read by nothing (its sidecar says NOT TRACED).

DO:
1. Engine, P-C.1 (scsim/scsim/policies/builtin/p_c1_unmet_demand.py):
   - The backlog becomes per row: age buckets [rows × (max_h + 1)] with per-row horizon
     masks, per-row backorder_allowed and per-row cost.
   - Params gain row_overrides: dict["<customer>::<product>", RowFulfillment] (mirror
     P-P.1's material_overrides pattern).
   - P-C.1 stays the ONLY writer of FULFILLMENT and ST_BACKLOG.
   - Add ctx.backlog_rows; ctx.backlog stays the product sum for every existing reader.
   Inherited from WP 14.1: use the demand rows (model.row_*, row_ptr, ctx.demand_rows).
   P-C.2's cust_share spreads a product no link names over ALL customers; the demand
   rows give it one implicit row — make the two agree.
   Inherited from WP 14.2: the Customer stage already carries per-row cells and the
   override entity "row" (<customer>::<product>, entityOverrides.ts), the composite master
   pointer idFrom "customer_id::product_id" onto outbound_logistics, and the mapper's
   per-row reader _apply_row_demand_overrides (literal patch.get("row_...") reads, for the
   D90 gate). Seven production keys, sell_price among them, declare "customer" scope
   because _composite_patches resolves any node:<x>::<product> key to the PRODUCT: a
   sell_price patch on a Customer row sets the product's price, not the row's. A per-row
   price for revenue_max needs its own row key; decide whether to close that latent scope.
2. Engine, P-C.2:
   - Publish the rule and per-row priority / price / floor at setup (the P-C.6
     publish-at-setup pattern).
   - P-C.1 calls the WP 14.0 helper per product. Supply = production output (MTO) or the
     FG quantity PH-30 decided to ship (MTS).
   - revenue_max serves by row price (outbound unit_price, or its override).
   - sla_tier uses row targets (customers.sla_fill_floor_pct as the default).
   - Per-segment KPIs keep working; add fill rate per row and per customer, and
     backorder cost per row.
3. Mapper:
   - Stop dropping per-row fulfillment keys; declare row scope in POLICY_BUNDLE_KEYS.
   - Max backorder days → weeks rounds HALF UP (not Python's banker's round()) and the
     result is reported.
   - Cost per unit per day × 7 per week.
   - partial_backorder stays engine-supported at project level and hidden in the UI.
4. UI (/policies Customer table + the project Fulfillment card):
   - Per-row columns: backorder allowed, max backorder (days, showing "= N wk"), backorder
     cost / unit / day.
   - Priority, price and service target %, each visible only when the project rule uses
     it.
   - The card's label becomes "Customer allocation".
   - Update the customer-stage comment in columnSpecs.ts, which says fulfillment is
     project-only.
5. Data: customers.sla_fill_floor_pct becomes consumed (update its sidecar; regenerate).
   customers.priority_weight gets its FIELD_BINDINGS grading entry, closing contract:check
   R13's warning.

TESTS:
- Two rows of one product, one backorder and one lost-sales: separate backlog, cost,
  lost units and fill rate.
- Each rule under scarcity, including revenue_max by price and sla_tier floors.
- Max-backorder rounding (3 → 0, 4 → 1, 10 → 1, 11 → 2, 14 → 2 weeks).
- One row per product with project-wide settings → golden traces byte-identical.
- pageEqualsRun zero diffs; the "per-node fulfillment override(s) not applied" warning
  is gone.

EXIT. All checks; §4 D284 (c) marked closed with evidence.

COMMIT. Phase 14 / WP 14.3 / G20 §5.4: per-row fulfillment — backlog, backorder and allocation by row
```

---

## WP 14.4 — Planned production and finished-goods policies

```
GOAL. Planned production over a short horizon = min(requirement, capacity), where the
requirement is projected demand (MTO) or what the FG policy needs (MTS). A shortfall
carries only for rows that allow backorder. FG policies base-stock / min-max / days of
cover are real, and FG opening stock exists. Owner decisions 1, 3 and 6.

PRECONDITIONS — verify:
- WP 14.0, 14.1 merged. WP 14.3 merged, or at least its per-row backorder settings
  reachable in the engine (the carry-forward needs them).
- engine.py::_mech_default_plan plans one week; _mech_fg_target_base sets S^FG =
  forecast (or fg_base_stock) and P-P.4 adds safety stock at priority 55.
- network.py::Product.fg_policy exists and nothing reads it (§4 D284 (d)).
- RFC 4 in PLAN.md §14: there is no FG opening stock.

DO:
1. New transient key planned_production [products × H], owned by PH-40. Week t's column
   is production_plan, so the execution contract is unchanged. H = 1 until WP 14.5 sets
   it from MRP lead times.
2. Requirement per week τ (design doc §3.3):
   - MTO: projected demand + projected backlog.
   - MTS: the FG-policy requirement, projecting FG stock forward, + projected backlog.
   Planned production = min(requirement, capacity).
   - Split each week's shortfall across rows with the WP 14.0 helper (project rule).
   - Only rows with backorder allowed carry their share, dropped after their max
     backorder weeks; lost-sales rows' share leaves the plan.
   - Week t starts from the actual per-row backlog.
3. FG policies (design doc §3.2). Product gains fg_policy ∈ {base_stock, min_max,
   days_of_cover}, fg_base_stock (S), fg_reorder_point (s), fg_cover_days (D) and
   fg_initial_on_hand.
   - base-stock: requirement = S + d̂ − start stock.
   - min-max: if start − d̂ < s, produce up to S, else 0.
   - days of cover: target = D/7 × d̂(τ), then as base-stock.
   - One source: a typed level IS the target. P-P.4 computes S only when none is typed,
     and is never added on top.
   - S unset + base_stock → today's derivation: byte-identical.
4. FG opening stock: the context initializes fg_on_hand from fg_initial_on_hand when set,
   else the target (today). This closes RFC 4's capability.
5. Data: products columns for fg_policy, S, s, D and fg_initial_on_hand, with sidecars,
   ingestion template, snapshot simulation scope, and Plant-table cells on /policies as
   overrides (scope declared in POLICY_BUNDLE_KEYS). Close RFC 4 in PLAN.md §14.
6. Inspection series per product: projected demand, requirement, planned, built.
   Inherited from WP 14.3: per-row backorder settings are in P-C.1's row_overrides and
   in ctx.policy_state["unmet_demand_handling.rows"] (accept, horizon) after its first
   PH-60. ctx.backlog_rows is TRACKED only on the per-row path (else a share-split view),
   and P-C.1 decides "per row or not" lazily at PH-60 — the plan at PH-40 needs that
   decision earlier (design doc §9 point 8): move it where both can read it. The rule and
   row inputs are ctx.row_allocation (P-C.2 setup), else fair share.
   Inherited from WP 14.2: uploaded per-row specs and dated forecasts reach the engine
   (design doc §9 point 5 is the calendar). A new products column copies the outbound
   demand columns' route: rate conversion at promotion, jsonb_strip_nulls in
   _build_dataset_snapshot_v2 (a project that sets none hashes as before), and datamap's
   projection names it.

TESTS:
- The design doc's §2 example, built as a test: two rows, capacity 180, fair_share. Week
  5 plans 160 when both rows allow backorder, and 144 when C1 is lost-sales.
- Each FG policy reproduces its §3.2 example exactly.
- Days of cover's target moves when the forecast moves.
- Existing MTS tests and golden traces byte-identical.
- The honesty test extended to planned_production.

EXIT. All checks; §4 D284 (d) and RFC 4 marked closed with evidence.

COMMIT. Phase 14 / WP 14.4 / G20 §5.2: planned production = min(requirement, capacity), FG policies, FG opening stock
```

---

## WP 14.5 — MRP for materials

```
GOAL. A material can be planned by MRP. The order is BOM × planned production over the
next lead time, minus on hand and on the way, rounded up to MOQ, sent to the supplier,
and delivered after the lead time. MRP and reorder-point materials coexist.

PRECONDITIONS — verify:
- WP 14.4 merged (planned_production exists).
- p_p1_inventory_control.py: policy_type ∈ {min_max, base_stock, rop_q, periodic};
  material_overrides per material; levels at PH-70, release at PH-80 on the primary link.
- ctx.pipeline_arrivals_between and ctx.pipeline_on_order exist (in-transit + queue).
- P-S.2 (multi-sourcing) and P-S.1 (backup) act on PH-80 orders. Read their hook
  priorities so MRP orders still flow through them.

   Inherited from WP 14.4: ctx.planned_production is [products × H], H =
   model.plan_horizon (1 today; set it at compile, before a SimContext is built — the
   context sizes its plan arrays from it). core/planning.plan_ahead runs inside
   mech.default_plan at PH-40; its later columns already carry only backorder rows'
   shortfall (core/rowbacklog.step_rows, the step P-C.1 runs). Extend the honesty test
   test_the_plan_does_not_read_future_draws; golden #7's plan side is already pinned by
   test_the_worked_example_plans_160_in_week_5_when_both_rows_backorder.

DO:
1. policy_type "mrp" in InventoryControlParams and MaterialInventoryOverride.
2. New transient key gross_requirements [materials × H], owned by PH-70:
   BOM × planned_production.
3. H automatic: the longest primary lead time (link + lane) among MRP materials, + 1.
   Set at compile and passed to the WP 14.4 planner.
4. Order for an mrp material at PH-80 (design doc §3.4):
     order = need(t+1 … t+L) + SS − on_hand − on_the_way   (in transit + queued)
     if order > 0: order = max(order, MOQ)
   - On hand is after this week's production.
   - SS = safety-stock days / 7 × average weekly need over H, from the per-material
     days P-P.3 already receives. Count it ONCE: do not also add P-P.3's level for mrp
     materials.
   - Reorder-point materials are unchanged.
5. KPIs: late receipts (an order not arrived by its due week), material shortage weeks.
   Inspection series per material: need, on hand, on the way, net, order.
6. UI: the Supplier table's policy type options gain "MRP" (from the registry; check
   the mapper's type map and registryPolicyTypes.ts). The MRP record shows in the
   item-series explorer for inspection runs.
7. Regenerate the registry, docs and wheels; bump ENGINE_VERSION (new capability).

TESTS:
- GOLDEN #7, the design doc §2 worked example, exact: orders 250 / 250 / 250 in weeks
  1 / 2 / 3, arriving weeks 3 / 4 / 5; on hand after production 200 / 200 / 210.
- A textbook lot-for-lot MRP record (cite the source in the test docstring).
- MRP and min_max materials in one run.
- The demand-step probe (design doc appendix): MRP loses 0 units.
- The honesty test extended to gross_requirements.
- Performance: scsim/scripts/benchmark.py at TRON scale (17 products × 560 materials),
  ≤ +20 % time per replication versus the previous ENGINE_VERSION; record both numbers
  in §16.
- pageEqualsRun zero diffs.

EXIT. All checks; §4 D284 (a) closed with evidence; the WP 14.0 baseline assertion (a)
flipped and its comment updated.

COMMIT. Phase 14 / WP 14.5 / G20 §5.2: MRP for materials — BOM × planned production, lead time, MOQ
```

---

## WP 14.6 — Validation study, and the gate

```
GOAL. Show, with statistics, what MRP changes versus reorder point, and make every
Phase 14 rule a named, CI-enforced gate.

PRECONDITIONS — verify: WP 14.1–14.5 merged; D284 (a)–(d) closed.

Inherited from WP 14.5: MRP is inventory_control.policy_type "mrp" (or a per-material
override); mrp_late_receipt_weeks / material_shortage_weeks appear only with MRP
materials. Phase 14's MRP plans from the customer-table forecast, so the appendix's
"unforecast step" is a forecast-bias case (design doc §9 point 15). Golden #7 and the two
honesty tests are named in PLAN.md §24 WP 14.6.

DO:
1. A study script (for example scsim/scripts/study_demand_driven_planning.py) that runs
   CRN-paired comparisons (blueprint A7; sequential-CI stopping where available) on the
   reference networks and Project TRON's committed dataset (scripts/tron_ver2/).
   - Cases: stationary demand; demand step; demand surge; the ST-1 supplier outage;
     forecast bias (projected ≠ actual mean).
   - Policies: min_max / rop_q vs mrp at EQUAL average stock (tune SS to match), and at
     equal fill rate.
   - Report fill rate, lost units, average stock, order CV and time to recover, with
     confidence intervals.
   The script REGENERATES a published page (for example
   docs/research/mrp-vs-reorder-point.md, GENERATED banner) with a --check mode wired
   into scsim-tests.yml.
2. CLAUDE.md: add the gate row plan-from-demand ("planned production and MRP orders
   derive from projected FG demand and the FG policy; the plan never reads realized
   future draws"), naming the tests that enforce it (honesty tests, golden #7).
3. Blueprint: mark G20 closed in §2.3 and §13 B2, with the evidence.
   scsim/docs/roadmap.md: M9 shipped. Manual planning pages complete.
4. §16: a PHASE BOUNDARY entry for Phase 14. What is true, what is only claimed, and
   what WP 14.7 inherits.

EXIT. The study page regenerates byte-identically; all checks green; §17 row 14 says
PHASE COMPLETE (14.7 excluded by design).

COMMIT. Phase 14 / WP 14.6 / G20 §9.5: demand-driven planning validated, gate plan-from-demand
```

---

## WP 14.7 — Multi-stage production (start only when the owner says so)

```
GOAL. Sub-assemblies become real items with stock, WIP, production lead time and
capacity, planned by the same MRP level by level.

PRECONDITIONS — verify:
- WP 14.6 merged and the owner has asked for this package.
- §4 D191 ("which BOM table": one author) is closed. If not, stop and report.
- sim-worker/sim_worker/datamap.py::_flatten_multi_level_bom still flattens root→leaf,
  and project_map excludes sub-assemblies via ProjectData.subassemblies (D174).

DO (design doc §7 package F):
- Engine: an item model with intermediates, an item × item BOM, low-level codes,
  state.item_on_hand, state.wip (production ring), production_lead_time_weeks and
  capacity per make item, service-part demand on intermediates. MRP explodes level by
  level and releases production orders for make items. ADR 0003.
- Data: pass bom_multi_level through when the engine declares level support. Add the
  item fields (make-or-buy, production lead time, capacity, opening stock) with sidecars
  and snapshot scope. D174's exclusion and D136's collapse become the fallback.

TESTS:
- GOLDEN #8: a zero-lead-time, zero-stock multi-level network is byte-identical to its
  flattened twin.
- A 2-week sub-assembly lead time shifts FG output by exactly 2 weeks.
- Per-stage conservation (issued = consumed + ΔWIP).

COMMIT. Phase 14 / WP 14.7 / G20 §2.4: multi-stage production
```

---

## Utility prompts

### Resume a package that ran out of budget

```
Continue WP 14.N of docs/PLAN.md §24 on the same branch. First read the last commit(s)
on the branch and the WIP notes in §16 (if any), then re-run the checks to see what is
red. Finish the remaining scope; do not widen it. The gap check and §16 entry are still
owed, in the same commit as the code that finishes the package.
```

### Gap check only

```
For WP 14.N (docs/PLAN.md §24), compare what the package promised (its scope and Exit)
with what is on the branch. Run every Exit check and report pass/fail with output. List
what the next package inherits. Append the §16 entry; edit later packages in §24 if a
finding changes them. Change no code.
```
