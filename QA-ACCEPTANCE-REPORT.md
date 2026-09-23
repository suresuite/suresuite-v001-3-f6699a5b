# SuReSuite — full acceptance test report

**Tester:** independent QA (Claude Code session) · **Date:** 2026-09-23 · **Branch tested:** `claude/new-session-tw5gi8` (= `main` + 4 migrations dated 2026-09-22)

## How this was tested (read first)

The session's egress policy denies all connections to the production Supabase project and
the deployed frontend, so the running app and the live API were **unreachable**. Instead of
skipping, testing was done against the same code production runs, one layer down:

- **Database:** a production-shaped PostgreSQL 16 built by the repo's own rehearsal tooling
  (`contract:rehearse`, which reconstructs production's schema from the introspection artifact
  and applies this branch's migrations). All 37 of the repo's behavioural rehearsal files
  passed on it first.
- **Uploads:** the *same* server modules the `ingest-file` edge function runs
  (`csvParse.ts`, `ingestValidate.ts`, `ingestSpec.generated.ts`) executed under Node,
  feeding the *same* RPCs (`ingest_land_file`, `ingest_diff_run`, `ingest_apply_run`)
  in that database. Only the HTTP layer and the storage-bucket write were stubbed.
- **Simulation:** the worker's canonical path (`sim_worker.datamap.build_project_data` →
  `scsim_bridge.compute_run_from_project` → scsim 0.2.7) run natively on the QA project's rows.
- **Frontend:** the full vitest suite (1080 passed / 4 skipped / 0 failed), plus direct
  execution of the pure modules pages use (echelon classifier, MSER-5, paired comparison,
  money formatter), plus code reading for what only a browser can show.

Anything that needs a live browser session, the deployed API, the Fly worker's queue, or
the storage bucket is marked **Blocked** below rather than guessed at.

**Test data:** the prescribed small dataset — 3 suppliers (S1–S3), 4 materials (M1–M4, M4
with no supplier), 2 finished products (P1; P2 with zero demand), 1 sub-assembly (SA1,
consumed by P1), 2 customers (C1, C2); a 3-level BOM (P1 ← SA1 ← M1/M2, P1/P2 ← M3);
lead times mixed days/weeks, volumes mixed monthly/weekly; blank optional cell; duplicated
row; 80 %/yr holding cost; 60-week lead time.

---

## 1 · Results table

| # | Check | Result | Note |
|---|---|---|---|
| 1.1 | Sign in / sign out / redirects | **Blocked** | Needs the live app. |
| 1.2 | Create project; duplicate name error | **Pass (partial)** | DB enforces `uq_modeler_project`; UI maps the violation to "A project with this name already exists" (DataManager.tsx:297). Live click-through blocked. |
| 1.3 | Project selection propagates | **Blocked** | Live app. |
| 1.4 | Delete project — confirmation scope | **Pass** | One shared message (`projectDeletion.ts`), derived from the schema, used by every delete button; names deleted / kept (usage logs) / detached (chat threads, uploaded files). |
| 1.5 | Delete project — real outcome reported, atomic | **Fail in production / Pass in repo** | Defect D-1. Repo's `delete_project` RPC verified here: refuses a non-owner with a clear message, deletes everything in one transaction, keeps `ai_usage_logs`. Production runs a 2026-03-17 build that reports "Deletion started", partially destroys data, then fails — measured by the repo's own §15 run `35790886083`. |
| 2.1 | Upload → review screen before apply | **Pass** | Landing stages tiers 0/1 only; diff (`new/changed/unchanged/superseded/held`) computed before promotion and recomputed inside it with a cross-check that raises on disagreement. |
| 2.2 | Promote, rows land | **Pass** | All 7 datasets promoted; tier-2 rows verified by SQL. |
| 2.3 | Re-upload identical file → "unchanged" | **Pass** | 3/3 unchanged, 0 new. |
| 2.4 | One changed value → exactly that row | **Pass** | 1 changed, 2 unchanged. |
| 2.5 | Unit conversion + label | **Pass** | See hand-checks: month→week and days→weeks exact; the stored unit column reads `week`. |
| 2.6 | Blank optional cell doesn't abort | **Pass** | Landed; counted as `fields_defaulted`. Note D-12: blank `reliability_score` becomes 1.0 ("perfect supplier") — declared in the contract, but optimistic. |
| 2.7 | Malformed file → readable error naming row/column | **Pass** | `Row 2, column "volume": "abc" is not a number…`; unknown unit named with the allowed list; missing required column named with the columns found. Binary bytes get a slightly wrong message (D-14). |
| 2.8 | Duplicated row | **Pass** | Later duplicate marked `superseded` in review, promoted once. |
| 2.9 | Combine → network populates | **Pass** | Lane rebuild triggers + `combine_project_into_supply_chain`; `node_list`, both lane tables populated. |
| 3.1 | One node, one type on every page | **Fail** (conditional) | With the canonical BOM shape: pass — DB `node_list.echelon` and the client mirror agree on all 11 nodes. With finished products listed at level 0 (a shape the validator admits with zero findings): both products become `subassembly` everywhere and edges are fabricated — Defect D-3. |
| 3.2 | Sub-assembly recognised | **Pass** (views) / **Fail** (simulation) | SA1 = `subassembly` in DB and pages; but a products-master row for it makes the project unrunnable — Defect D-6. |
| 3.3 | 3-level BOM depth as separate levels | **Pass** | `bom_depth` correct (P=0, SA1/M3=1, M1/M2=2), read from `bom_multi_level.level`, not the lane's `level` column. |
| 3.4 | Legend counts | **Blocked** | Rendering. Placement logic covered by `placeLaneNodes` tests (green). |
| 3.5 | Node panel: no invented labels | **Pass** (code) | "Manufacturing"/"Direct Supplier" removed from the process page; only remaining `Manufacturing Plant` labels the plant itself. |
| 3.6 | Process metric strip: no Resilience/Bottlenecks; path concentration 0–1 | **Pass** (process page) | Removed per audit F-10; path concentration is an HHI of flow shares, ∈ [0,1] by construction. **But** the Product-level mobile lens still ships a Resilience score — Defect D-4. |
| 3.7 | Map view | **Blocked** | Needs browser + Mapbox token (known-limit list). |
| 3.8 | Money on network pages | **Pass** (code) | One formatter (`money.ts`), symbol read from the engine registry (€), `oneMoney` gate green; no stray `$` in sim/network surfaces. |
| 4.1 | Grid shows value source per column | **Pass (partial)** | `fieldStatus`/`resolveEffective`/`prefillProvenance` modules with green tests; live grid interaction blocked. |
| 4.2 | Edit persists across reload | **Blocked** | Live app. |
| 4.3 | Out-of-range value refused or clamped with message | **Pass** (engine) | 80 %/yr holding → clamped to 50 with a warning naming field, both values and the range; 60-wk lead → 51 wk, same form. Warnings ride `mapping_warnings` on the run. Not silent. |
| 4.4 | Preset changes exactly which cells | **Blocked** | Live app (preset resolution modules tested green). |
| 4.5 | Strategy gating disabled-not-hidden | **Pass (partial)** | `strategyGating.ts` returns disabled (greyed) fields per strategy; on-screen reason text unverified. |
| 4.6 | Policy version snapshot: hash, deterministic | **Pass** | Two snapshots of identical policies → identical `policy_hash` (`d4f5114c…` both), listed with labels. |
| 4.7 | Unused per-node overrides warn | **Pass** | Orphan override keys produce a mapping warning naming the count and the unmatched targets. |
| 5.1 | Pre-run check: severities, blocking, partial-grade honesty | **Fail (partial)** | Warnings with severity and acknowledgement work (zero-demand default stated plainly); truncation at the 50 000-row ceiling is declared a warn. **But** two engine-blocking conditions pass the gate silently — Defect D-5. |
| 5.2 | Run window card | **Blocked** | Live app. Engine-side: horizon floor 52 wk / ceiling 520, analysis window 52 wk, all clamps warned. |
| 5.3 | Disruption start day honoured | **Pass** | Start week 28 used as authored. |
| 5.4 | Start inside warm-up → moved and said | **Pass** | "authored start week 7 is inside the warm-up… → run from week 15, the first measured week; recovery (TTR/TTS) is not measurable for it". |
| 5.5 | >52-week disruption capped with warning | **Pass** | "60 wk is outside the engine range [1, 52] wk → 52 wk used". |
| 5.6 | Status/progress live; cancel keeps completed reps | **Pass (code) / Blocked (live)** | Cooperative cancel (audit F-06): engine stopped at next replication, run left `cancelled`, terminal PATCH transitions only out of active statuses; per-rep upserts idempotent. Not exercised against a live worker. |
| 5.7 | Replication count / CI stopping rule stated | **Pass, with a semantics note** | `stopping_rule` on every result ("fixed" / "sequential_ci"). Note D-11: sequential mode only *extends* beyond the requested count until the CI target (verified 10→20); it never stops earlier than requested. |
| 5.8 | Add replications | **Blocked** | Live worker path. |
| 5.9 | Auto warm-up detected & shown; mser5 parity | **Pass** | `warmup_detected_at` on the result; browser `mser5` = engine `mser5` on the same series (both 45 on my run; repo fixture separates White's statistic (30) from the legacy one (25)). |
| 5.10 | Fill rate = served ÷ demanded, value-weighted; zero demand → "not measured" | **Pass** | Exact: 0.918884 = 94 528.08 / 102 872.72. `kpiRows` renders "not measured" distinct from "not computed". |
| 5.11 | One currency; components sum to total | **Pass** | € single-sourced from the engine registry; per replication Σ(cost components) = `cost_of_resilience` exactly (8 478.6419). |
| 5.12 | Censored recovery | **Pass** | Never-recovered rep: `ttr_weeks: None`, `ttr_censored: 1.0` — a flag, no invented number. Note D-9 on TTR attribution. |
| 5.13 | KPI without value shows a reason | **Pass** (code) | KPI vocabulary distinguishes not-measured / censored / not-computed; run-KPI vocabulary test green. |
| 5.14 | CIs present, shrink with replications | **Pass** | ±0.0078 @ 10 reps → ±0.0039 @ 40 reps (exactly ∝ 1/√n). |
| 5.15 | Mapping warnings listed on run | **Pass** | All clamps/shifts/substitutions in `mapping_warnings` on the run payload. |
| 5.16 | Paired comparison; winner only when interval excludes 0 | **Pass** | `pairedCompare.ts` pairs by CRN cell (`model_rep`,`event_rep`), never by array position; `separated` only when the paired interval excludes 0. Hand-run: diff 0.0222 ± 0.0157 → separated. |
| 5.17 | Replications labelled by replication/world/event draw | **Pass** | `model_rep` / `event_rep` per row; "seed_used" derived, not user-facing labelling. |
| 5.18 | Stress presets complete and state what they tested | **Fail** | Defect D-2: 4 of 5 single-event presets map to *no* disruption at all — KPIs are the baseline's under a stress-test name. |
| 6.1 | Workbook: KPI sheets + reproducibility sheet | **Pass** (code+gates) | Nine bindings, each a value-with-source or null-with-reason; `reproducible` computed, not asserted; seed & schedule read from the run row (stamped at dispatch), proven against the DB by `rehearsal/360`. |
| 6.2 | Known-limits in export ⊇ Trust Report | **Pass** | The record carries the Trust Report's limits verbatim (one list, T3); an empty list is itself declared a limit. |
| 6.3 | Scenario edited after run → export still binds the run's seed/schedule | **Pass** | `resolveRunScenarioBinding`: dispatch stamp, or live row only when provably unchanged; else null-with-reason (audit F-11). |
| 6.4 | Trust Report limits current | **Pass** | `trustReportLimits` gate: publishing a limit that cites a closed §4 defect fails CI (36 tests green). |
| 7.1 | Currency consistent | **Pass** | See 3.8/5.11. Known limit (documented): € is engine-declared; projects store no currency. |
| 7.2 | Units labelled | **Pass (partial)** | Tier-2 unit columns store the canonical token; `leadTimeUnit`/`unitTableParity` gates green. Outbound `expected_lead_time` is fixed-unit weeks — a days value can't be expressed there (declared, but worth knowing). |
| 7.3 | No invented numbers | **Fail** | Defects D-4 (Resilience score), D-7 (hardcoded "—"), D-10 (unknown depth labelled "Plant"). |
| 7.4 | Errors readable; no success toast after failure | **Pass (partial)** | `loudFailure` tests pin failure surfacing; live toast behaviour blocked. |
| 8.* | Public API (all 18 endpoint rows) | **Blocked (live) / Pass (code)** | Route table matches the spec exactly. Verified in code: scopes → 403 `missing_scope`; revoked/expired key → 401 (+ per-IP 401 throttle); cross-org → 404 (no existence oracle); `Idempotency-Key` on POST runs with `Idempotency-Replayed` header; `X-Request-Id` echoed (capped 100 chars) on every response incl. errors; JSON error bodies `{code, message}`; cursor pagination (`limit`, `created_at` cursor); PUT policies zod-validated with field-level errors; rate limiting fails closed (503). No live calls possible. |
| 9.* | Admin pages, forbidden page, audit log | **Blocked (live)** | DB side: every tier-2/3 write in my session produced a statement-grain audit row naming the actor (verified by query); `ingest_file_landed` rows name the uploader. |
| 10.* | Mobile | **Blocked (live)** | `audit:ui` static gate (mobile spec) passes; actual rendering unverified. |

---

## 2 · Defect list (by severity)

### S1

**D-1 · Deleting a project in production destroys data and then fails**
- Where: `delete-project` edge function (production build of 2026-03-17), `/project-manager`.
- Steps (as measured by the repo's own §15 verification run `35790886083`, six attempts 2026-09-22 21:35–22:07): click Delete → page reports deletion started → background batches delete rows (`node_list` 136, `bom_single_level` 271 in the measured case) → the sweep hits `product_code_map`, a table dropped by migration `20260916000003` → `PGRST205` → the project row survives with part of its data gone; audit rows carry `actor_known: false`.
- Expected: delete everything atomically or delete nothing, and report which.
- Actual: partial destruction + a success-ish "started" message; the project cannot be deleted at all.
- Status: **fixed on this branch** (`20260922000003`/`…09`, atomic RPC + updated edge function, both verified here: non-owner refused with a clear message, owner delete removes all project data in one transaction, usage logs kept, actors audited; `rehearsal/370` green). The fix reaches production only on merge + function deploy. Until then this is live data loss.

**D-2 · Four of five stress-test presets test nothing and present baseline KPIs as stress results**
- Where: `/simulation-lab` → stress tests (`StressTestCard.tsx`), engine mapping (`project_map._map_events`).
- Steps: launch "Single-supplier outage" (target `supplier:primary`), "Material shortage" (`material:critical`), "Lead-time shock" (`edge:inbound`), or "Demand surge" (`customer:all`) on a project whose suppliers aren't literally named "primary".
- Expected: the described disruption is simulated, or the run refuses loudly.
- Actual (reproduced through the engine): no event is created; fill rate 0.916 = the undisrupted baseline for all four; the only trace is one `warn` mapping row — whose text for the supplier preset is wrong ("unsupported target skipped (material/edge land later in M7)" for a *supplier* target that simply doesn't exist). The legacy engine path (`sim_worker/engine.py:_resolve_node_id`) skips unresolvable targets **silently**. Preset descriptions promise effects the engine does not support at all (edge lead-time +200 %, demand +40 %).
- Consequence: a user "stress-tests" their chain, sees healthy KPIs, and concludes resilience that was never tested. "Plant shutdown" works but its authored day 30 is inside the default 15-week warm-up, so it always runs shifted (warned).

**D-3 · A BOM file listing finished products at level 0 fabricates edges and mistypes every finished product**
- Where: upload validation (`ingestSpec` bom_multi_level), lane ETL (`rebuild_supply_chain_lanes`), every network page.
- Steps: upload a multi-level BOM containing root rows for the finished products themselves — `P1,0,,1` / `P2,0,,1` (level 0, blank parent; a standard SAP-style export shape). The validator accepts them with **zero findings** ("level 0 is a root component"; "higher_level_component_id may be blank only at the root level").
- Expected: either reject/flag rows whose `material_id` is a shipping product, or ignore them.
- Actual (reproduced in the rehearsal database): the ETL's D129/D141 rule — "a parentless row's parent is every product the plant ships" — turns each row into edges to *every* shipping product: self-loops `P1→P1`, `P2→P2` and false edges `P1→P2`, `P2→P1`; every real BOM lane is then duplicated once per fabricated path root. `classify_node_echelon` (the single-source authority, and its byte-identical client mirror) consequently types **both finished products as `subassembly`** on every page, and every centrality is computed over invented edges. Removing the two rows restores perfect classification (verified).
- Aggravating inconsistency: the **engine drops the same rows** (roots = parents-never-children in `datamap._flatten_multi_level_bom`), so the network views and the simulation disagree about the same uploaded file.

**D-4 · An invented "Resilience" score still ships on the Product-level page (mobile lens)**
- Where: `src/pages/ProductLevelNetwork.tsx:975` / :1191.
- The formula `(hasSPOF ? 0 : 0.4) + 0.3·(1−HHI) + 0.3·(1−peak betweenness)`, red below 0.4, is the same class of ad-hoc composite the Process page removed as impossible to compute honestly (audit F-10: its cousin was "`0.4 + 0.6(1−HHI)`, floored at 0.4 with a red alert no input could reach"). It resolves to no data, no named rule, no stated default — a T1 violation, inconsistently removed on one page and kept on another.

### S2

**D-5 · The pre-run check passes projects the engine then refuses — with a raw technical error**
- Where: validation gate (`validationGate.ts`/`grading.ts`) vs engine `Network` validation.
- Steps: (a) a material with no supplier lane (M4); (b) a sub-assembly present in the products item master (SA1). Run the pre-run check: it returns only acknowledgeable warnings (demand defaults). Dispatch: the engine raises `materials with no qualified supplier: ['M4']` / `products with empty BoM: ['SA1']` inside a pydantic ValidationError, which the worker stores as the run's `error_message` (a 500-char exception dump).
- Expected (§5.1): "A blocking problem prevents the run" — at the check, with a readable message.
- Actual: check green-ish, run fails after dispatch with a stack-trace-flavoured message.

**D-6 · A project with a sub-assembly in its products master cannot be simulated at all**
- Where: `datamap._flatten_multi_level_bom` + engine `Network` validation.
- The BOM flatten collapses chains to root→leaf arcs, so an intermediate product (SA1) ends with no BOM — and the engine hard-refuses any product without one. The canonical test dataset in the product's own upload templates (a sub-assembly is "a product that is also consumed by another product") is unrunnable; the only workaround is deleting the sub-assembly from the products master.

### S3

**D-7 · "Critical path" on the Product-level mobile lens is a hardcoded "—"** (`ProductLevelNetwork.tsx:1190`) — a permanent placeholder with no reason, in a band of real numbers.

**D-8 · Master rows disconnected from the network vanish without notice.** M4 (uploaded material, no lane, not in the BOM) appears on no network page, in no legend count, and in no warning — nothing anywhere says "1 uploaded material is not connected". First notice is D-5's run failure.

**D-9 · TTR/TTS is attributed to the disruption even when the disruption did nothing.** Under CRN, replications whose totals are byte-identical to the baseline (the outage was fully absorbed) still report a TTR (2, 7, 15 weeks in my run) — band excursions from ordinary demand noise, counted into `mean_ttr_weeks`. Misleads a reader into "the disruption bit and we recovered in N weeks".

**D-10 · Unknown depth renders as "Plant".** `FirmLevelNetwork.getTierFromDepth(null) → 'Plant'` — an invented answer for missing data (the D134 class), on the one page still running its own classifier.

**D-11 · Sequential-CI semantics vs wording.** The engine's rule only *extends* replications beyond the requested count until the CI target (verified: 10 → 20); it never stops earlier than requested. Any UI/doc wording promising "stops early when the CI target is met" would be false; results do state the rule used.

**D-12 · Blank supplier reliability becomes 1.0 — "a perfect supplier".** Declared in schema and contract (so T1-legal), but the sidecar itself records one substitution path with `visible_as: null`. An optimistic default on exactly the number resilience runs are sensitive to.

**D-13 · The "Plant shutdown" stress preset always runs shifted** (start day 30 < default 105-day warm-up), so the preset as shipped never tests what its description says, every time, with only a mapping warning.

### S4

**D-14 · Binary/non-CSV bytes get the message "The file has a header row and no data rows"** — readable, but not what happened.

---

## 3 · Numbers verified by hand

| What | Input | Expected | Got |
|---|---|---|---|
| Rate month→week | 100/month | 100·7/30.4375 = 22.99794661… | `22.9979466119…`, unit `week` |
| Duration days→weeks | 14 days | 2 weeks | `2.0000…`, unit `week` |
| Rate month→week | 30.4375/month | 7/week | `7.0000…` |
| Rate month→week | 43.4821428571/month | 10/week | `9.9999999999901437` |
| Fill rate (rep 0) | revenue 94 528.081818 / demand value 102 872.723754 | 0.918884 | `fill_rate = 0.918884` (exact) |
| Cost identity (rep 0) | lost sales 8 344.64 + SS holding 134.00 (+ 8 zeros) | 8 478.6419 | `cost_of_resilience = 8 478.6419` (exact to 1e-6) |
| CI vs replications | 10 → 40 reps (×4) | half-width halves | ±0.0078 → ±0.0039 |
| Holding-cost clamp | 0.8 (80 %/yr) | clamp to 50 %/yr + warning | "80 %/yr is outside the engine range [5, 50] %/yr → 50 %/yr used" |
| Lead-time clamp | 60 wk | clamp to 51 wk + warning | "60 wk … [1, 51] wk → 51 wk used" |
| Disruption cap | 60 wk | 52 wk + warning | "60 wk … [1, 52] wk → 52 wk used" |
| Warm-up shift | start wk 7, warm-up 15 wk | moved to wk 15 + warning | as expected, incl. "TTR/TTS not measurable" |
| MSER-5 parity | my run's weekly fill series | same week both sides | engine 45 = browser 45 |
| Paired comparison | baseline vs 6-wk outage, CRN, 10 reps | paired t on per-rep diffs | mean 0.0222, 95 % ± 0.0157 → separated |
| Policy hash determinism | snapshot twice, same policies | same hash | `d4f5114ce1e8e37e…` both |
| Review diff | identical file / one changed cell / duplicate row | unchanged / exactly 1 changed / superseded | 3 unchanged · 1 changed + 2 unchanged · 1 superseded |
| Sub-assembly typing (clean BOM) | SA1 | `subassembly` | `subassembly`; P1/P2 `product`; depths 0/1/2 correct |

## 4 · Could not test, and why

The environment's egress policy blocks the production Supabase and the deployed frontend,
and no Docker is available for a local Supabase stack. Untestable end-to-end:

- **Live UI**: sign-in/out and redirects, wizard screens, grid editing and persistence,
  presets click-through, legends/map rendering, node panel, toasts/spinners, run progress
  streaming, §9 admin pages, §10 mobile rendering (the static `audit:ui` mobile-spec gate passes).
- **Live API calls** (§8): all endpoints — assessed by code review instead (route table
  matches the spec; scopes/401/403/404/idempotency/request-id/pagination all present).
- **Worker infrastructure**: queueing, live cancel, add-replications, progress events
  (logic verified in code and engine-level; not against a running worker/Redis).
- **Storage half of upload** (bytes → `ingest` bucket) — stubbed; the DB manifest path was real.
- **Geocoding / map token / ERP connector** — also on the known-limits list as possibly
  undeployed builds.
- **Baseline health run for context**: scsim's own test suite, the repo's 37 rehearsal
  files, and the frontend suite (1080 tests) all green before testing began; `npm run lint`:
  typecheck/audit:ui/check:docs green, eslint red at its documented standing baseline.
