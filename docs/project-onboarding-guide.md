# Onboarding a new simulation project — the reusable workflow

> Distilled from the first real-project onboarding (Project TRON - ver2,
> `docs/projects/project-tron-ver2.md`) and the minimal example fixture
> (`scripts/seed_example_project.mjs`). This is the checklist an engineer — or
> the AI Supply-Chain Modeler agent (`docs/ai-modeling-workflow.md`) — follows
> to take a company dataset + a modeling methodology to a running, validated
> simulation project. Governing contracts: `docs/design/next-gen-platform-design.md`
> §8 and `docs/data-simulation-mapping.md`.

## 0. The shape of every project

A SureSuite project is exactly six datasets + three configuration surfaces:

```
item masters             arcs                          configuration
  suppliers                inbound_logistics             policy_defaults (7 families)
  materials                bom_single_level (or multi)     + policy_versions (immutable snapshots)
  products                 outbound_logistics            scenarios (horizon, reps, warm-up, seed, disruptions)
```

The worker reads *only* these (`sim-worker/sim_worker/datamap.py`); the mapping
contract (`docs/data-simulation-mapping.md` §4) defines every field's priority
chain and fallback. **A fully specified project produces zero warn-level
mapping entries** — that is the onboarding success criterion, not "it ran".

## 1. Required inputs

| Input | Used for | Minimum |
|---|---|---|
| Product list + prices | revenue/lost-sales valuation, demand identity | product_id, sell_price |
| Demand history or distribution parameters | weekly demand generation | per product: mode (median) + cv, optionally explicit min/max bounds |
| BOM (single- or multi-level) | material requirements (Eq. 1) | product_id, material_id, consumption_rate > 0 |
| Sourcing table | supplier links | per material: supplier, unit cost > 0, lead time (weeks, 1–51), MOQ |
| Supplier list | masters, disruption targets | supplier_id (+ name) |
| Methodology | policy + scenario configuration | inventory rule, sourcing rule, unmet-demand rule, horizon, reps, warm-up |
| (Optional) reference results | acceptance check | any independent run/statistics of the same system |

## 2. The workflow

### Step 1 — Profile the data before writing anything
Sheet/table inventory; row counts; per-product demand statistics; BOM coverage
(does every BOM product have a master? every BOM material a source?);
sourcing-arc hygiene (duplicate pairs, zero/negative costs, sentinel lead
times, missing MOQs). Every anomaly becomes an explicit **derivation rule**
with an audit line — never a silent fix. If a reference dataset exists,
reconcile entity sets against it *first*; it decides ambiguous exclusions.

### Step 2 — Map the methodology onto the engine
Read `scsim/docs/reference/` (policies, pipeline, variables — generated, do not
edit) and locate each methodology element:
- inventory rule → `policy_defaults.inventory` (`min_max` is coverage-based,
  κ ≈ 8 weeks; safety stock via `safety_stock_method`)
- supplier selection → engine primary source = **min cost per material**;
  encode a different selection by *which arcs you include*
- unmet demand → `fulfillment.backorder_allowed` (lost sales vs backorder)
- demand → `products.demand_distribution` + mean/cv (+ explicit
  `demand_min`/`demand_max` for asymmetric empirical shapes)
- warm-up → `scenarios.warmup_mode` (`auto` = MSER-5 + Conway, most
  conservative — prefer it; the engine warm-starts inventories at S_m, so
  steady state begins early). **KPIs are measured over [t_w, t_w + 52 wks]**:
  place disruption events inside that window, expressed relative to
  steady-state onset, not copied as absolute weeks from another
  implementation.

Anything the data path cannot express is a **platform gap**: extend it per the
mapping contract's §9 recipe (master column → upsert RPC → `ProjectRow` →
`from_project_data` + MappingWarning → editor/data-map surfaces → docs →
tests → wheels), never work around it with distorted data.

### Step 3 — Build a reproducible dataset artifact
A generator script (`scripts/<project>/build_dataset.py` pattern) that reads
the raw source, applies the numbered rules, prints an audit report, and —
when a reference exists — **asserts** entity sets and distribution moments
against it. Commit the generated `dataset.json` (the seeder's only input),
keep the raw workbook out of the repo.

### Step 4 — Validate locally through the canonical worker path
Before touching the deployed system, run
`build_project_data → compute_run_from_project` on the dataset directly
(the engine is a pure Python package; 30 reps × 156 wks ≈ seconds). Check:
mapping warnings (info-only), steady-state KPI plausibility vs the reference,
and that every scenario actually *bites* (a disruption scenario with
byte-identical KPIs to baseline means the event never took effect).

### Step 5 — Seed through the app's own lifecycle (never raw SQL)
Clone `scripts/seed_project_tron_ver2.mjs`. The exact call order matters:

```
create_project (or reuse by name)            ← identity: USER_ID + USER_EMAIL of the
bulk_upsert_suppliers / materials / products     owning modeler, always explicit —
delete_project_dataset('all')                    projects are organization-scoped
bulk_insert_bom_single_level / inbound / outbound   (chunk at ~250 rows/call)
update_project_completion_status
combine_project_into_supply_chain
rebuild_node_list
save_policy_defaults (per family, + fulfillment_strategy)
snapshot_policy                              ← the immutable version runs bind to
scenarios (anon REST upsert by name)
```

Idempotency contract: masters upsert, arcs clear + re-insert, policy snapshot
only when `current_policy_hash` differs from the latest saved version.
`--dry-run` must validate enums, referential integrity, and the §8.1 gate's
hard blocks (≥1 product, BOM↔master match, every BOM material sourced) with
no writes.

From an environment that cannot reach Supabase, trigger
`.github/workflows/seed-project.yml` by pushing a change to
`.github/seed-request` (identity travels as a `user_email=` line; the
workflow resolves the approved_users id via the Management API). Results land
on the `seed-results` branch.

### Step 6 — Verify the deployed path end-to-end
`scripts/verify_sim_e2e.mjs` with `PROJECT_ID` (+ `EXPECTED_CODE_VERSION`
when engine code changed): gate verdict → queued → running → done,
replications land and stream over realtime, `mapping_warnings` empty or
info-only, run `policy_hash` == saved version's. The seed workflow runs this
automatically after seeding.

### Step 7 — Review every surface
/project-manager (dataset status complete), /policies (stage grids populated,
economics show master values not fallbacks, Data map tab all-green, Run &
Validate dispatches), /simulation-lab (scenarios listed, runs visible),
network views (combine/rebuild done). Anything defaulted that shouldn't be is
visible in the Data map tab — fix the data, not the view.

### Step 8 — Document
`docs/projects/<project>.md`: model table, artifact map, numbered assumptions
each traceable to a generator rule, deviations, and the validation evidence.
Update the blueprint in the same PR if the platform was extended.

## 3. Validation checkpoints (gate summary)

| Checkpoint | Tool | Pass condition |
|---|---|---|
| 1. Dataset ↔ reference | generator cross-check | exact entity sets; distribution moments within tolerance |
| 2. Payload hygiene | seeder `--dry-run` | zero findings |
| 3. Local engine run | canonical worker path | info-only warnings; plausible KPIs; scenarios bite |
| 4. Pre-dispatch gate | sim-command (§8.1) | no `block`; acknowledge nothing you can fix in data |
| 5. Deployed e2e | `verify_sim_e2e.mjs` | all assertions incl. policy-hash round-trip + engine version pin |
| 6. Engine gates | `scsim`+`sim-worker` pytest, wheel drift `--check`, `tsc`, `npm run build` | green before push |

## 4. Common pitfalls (all hit or nearly hit on TRON)

- **Absolute event timing copied across implementations.** Warm-start engines
  reach steady state early; express disruption starts relative to t_w and keep
  them inside the [t_w, t_w+52] analysis window.
- **A stale worker silently ignores new mapping fields.** Any engine/data-path
  change requires the worker redeploy (`.github/deploy-request`) *and* the
  `EXPECTED_CODE_VERSION` pin in verification.
- **Sentinel values in company data** (the 143-week lead time ≈ "no data").
  Detect and rule them out explicitly; the engine will otherwise clamp or
  default silently within its legal ranges.
- **Zero/negative economics** (free materials, zero-rate BOM rows) hit engine
  validators late; floor/drop them in the generator with an audit line.
- **Seeding under the wrong identity** hides the project (org scoping). No
  identity defaults, ever; verify visibility via `list_projects` as that user.
- **Engine wheels drift** when `scsim/`/`sim-worker/` change:
  `scripts/build_engine_wheels.sh` and commit `public/engine/*`, or CI fails.
- **Version-stamped snapshots** (`pipeline_schema.json`, generated
  `scsim/docs/reference/`) must be regenerated on any ENGINE_VERSION bump.
