# Data ↔ Simulation Mapping (canonical reference)

**This is the single source of truth for how stored project data becomes a simulation run.**
If you are adding a field, a KPI, or a data path, read this first and keep it in sync with the
code that implements it: `scsim/scsim/io/project_map.py` (`ProjectData` → `Scenario`) and the worker
ingestion `sim-worker/sim_worker/datamap.py`. The human contract (this file) and the typed contract
(`ProjectData`) must agree.

Why this exists: the old ingestion derived prices and demand ad-hoc (material cost = cheapest
supplier price, product price = last-writer / MAX across customers, capacity = a hardcoded 1000),
and two different code paths (the worker vs the `sc_nodes`/`sc_edges` views) disagreed. The result
was meaningless value-weighted KPIs. The rules below replace all of that.

---

## 1. The pipeline

```
Supabase (Postgres)                Fly worker                         Supabase (Postgres)
  item masters  ─┐                                                      simulation_runs
  logistics/BOM  ├─ datamap.py ─► ProjectData ─► from_project_data ─►   run_replications
  policies       │   (service     (typed,        (scsim Scenario       (worker = sole writer,
  scenario       ┘    role read)   pure)          + MappingWarnings)     idempotent by run_id)
                                         │
                                         └─► run_scenario() ─► ScenarioResult ─► build_run_update()
```

- **Economics come from the item masters first.** Logistics and policy values are only fallbacks.
- **Every fallback is recorded** as a `MappingWarning` and persisted to
  `simulation_runs.mapping_warnings`, so a planner can see "product X price missing → defaulted to
  1.0" instead of getting silent garbage.
- **All time is normalized to weeks.** The engine clock is weekly.

---

## 2. Source tables

| Purpose | Table(s) | Notes |
|---|---|---|
| Item economics (authoritative) | `materials`, `products`, `suppliers` (item masters) | cost, sell price, capacity, MOQ, holding, demand shape, fulfillment mode |
| Network arcs | `inbound_logistics` (supplier→material), `bom_single_level` (material→product), `outbound_logistics` (product→customer) | lead time, volume, consumption rate, fallback prices |
| Operating rules | `policy_defaults` (one row, 7 families) + `policy_overrides` (per node/edge patches) | merged into an effective policy; see §6 |
| Run settings | `scenarios` | horizon, warmup, replications, seed, CRN, demand_model, disruption_schedule, stopping_rule |
| Project mode | `projects.supply_chain_model` | Make-To-Stock / Make-To-Order → fulfillment mode |

`materials` / `products` / `suppliers` are reconciled from logistics ids by `ensure_item_masters()`
so a master row (with NULL economics to fill) always exists for every id in the graph.

---

## 3. Unit normalization (always to weeks)

`day=1, week=7, month=30.4375, year=365.25` days. Unknown unit → assume week.

- **Duration → weeks** (lead time, start, duration): `value × days(unit) / 7`
  (day ÷7, week ×1, month ×4.348, year ×52.18).
- **Quantity-per-period → per week** (demand volume): `value × 7 / days(unit)`
  (per-day ×7, per-week ×1, per-month ÷4.348, per-year ÷52.18).

---

## 4. Field mapping (the rules)

Priority = first non-null wins. A ⚠ default emits a `warn`; a derived value emits `info`.

### SupplierLink (per supplier × material) — from `inbound_logistics`
| scsim param | Source | Reducer / unit | Default |
|---|---|---|---|
| `cost` c_{m,s} | `inbound_logistics.unit_price` | per arc | 1.0 ⚠ |
| `lead_time_weeks` T_s | `inbound_logistics.lead_time` (+ `lead_time_unit`/`time_unit`) | →weeks, clamp [1,51] | 2 wks ⚠ |
| `lead_time_dist`, `lead_time_cv` | `materials.lead_time_dist`/`lead_time_cv` | — | deterministic, 0 |
| `moq` | `materials.moq` | units | 0 |

### Material — from `materials` master, else links/policy
| `cost` c_m | `materials.cost` → cheapest supplier link → 1.0 ⚠ | master first |
| `holding_cost_rate` | `materials.holding_cost_pct` → policy `inventory.holding_cost_pct` → 20 | ×100, clamp [5,50] |
| `initial_on_hand` | `materials.initial_on_hand` | else engine warm-starts at S_m |

### Product — from `products` master, else outbound/policy
| `unit_price` u_p | `products.sell_price` → **demand-weighted average** of `outbound_logistics.unit_price` → 1.0 ⚠ | weighted by weekly volume |
| `demand_mode` b_p | `products.demand_mean` → Σ weekly outbound volume → 0 ⚠ | normalize all units |
| `demand_model` (+params) | `scenarios.demand_model.kind` → `products.demand_distribution` → triangular | see §5 |
| `production_capacity` O_p | `products.production_capacity` → policy `capacity_units_per_day`×7×util → max(2·demand,1000) ⚠ | units/week |
| `fulfillment_mode` | `products.fulfillment_mode` → `projects.supply_chain_model` → mto | MTS/MTO/ATO |

### Supplier — from `suppliers` master
| `capacity_per_week` | `suppliers.capacity_per_week` (None = ∞) | finite enables partial **capacity_reduction** cuts |
| `reliability_score` | `suppliers.reliability_score` | default 1.0 |

### DisruptionEvent — from `scenarios.disruption_schedule[]` (≤5; extras dropped ⚠)
- `target` → supplier id (`node:supplier`); non-supplier targets skipped ⚠ (material/plant land M7).
- `start`, `duration` → weeks (accepts `start_day`/`start_week`, `duration_days`/`duration_weeks`).
- `magnitude_pct ≥ 100` → `lead_time_extension` (units delayed).
- `magnitude_pct < 100` **and** the supplier has a finite capacity → `capacity_reduction` with
  `capacity_factor = (100 − magnitude)/100`. Without a finite capacity → falls back to a full
  lead-time-extension outage ⚠.

### SimulationSettings — from `scenarios`
`horizon_days`→weeks (floor 52, cap 520) · `replications`→`model_seeds` [1,200] · `seed` · `crn` ·
`ci_level` ∈ {90,95,99} · `warmup_mode=manual`→`warmup_end=warmup_days/7` else auto
(`most_conservative`) · `stopping_rule.kind=sequential_ci`→`replication_stopping` + `ci_halfwidth_target`.

---

## 5. Demand distribution mapping

`kind` resolves to `scenarios.demand_model.kind` → else `products.demand_distribution` → triangular.
`cv` = `products.demand_cv` → `scenarios.demand_model.cv` → 0.30.

| kind | scsim | params |
|---|---|---|
| triangular / triangular_av | `triangular` | `triangularAV(mean, cv)` → (mean·(1−cv), mean, mean·(1+cv)) |
| deterministic | `deterministic` | `demand_mode = mean` |
| poisson | `poisson` | λ = mean |
| negbin | `negbin` | `demand_mode = mean`, `negbin_dispersion = mean²/((cv·mean)²−mean)` |
| bootstrap / unknown | `triangular` (fallback ⚠) | needs history we don't store |

---

## 6. Effective policy (defaults ⊕ overrides → scsim policies)

`_merged_policy(policies, node_id, family)` = `policy_defaults[family]` overlaid with
`policy_overrides` patch for that node. `_map_policies()` then maps the 7 families to scsim policies:

- `inventory.type` → `inventory_control.policy_type` (min_max / base_stock / rop_q / periodic). The
  legacy absolute `order_up_to` is replaced by scsim's coverage-based κ (≈8 weeks) ⚠.
- `inventory.safety_stock_method` → `safety_stock_materials` (uniform service level / king / fixed_days).
- `fulfillment.backorder_allowed` → `unmet_demand_handling` (backorder vs lost_sales).
- `sourcing.strategy` / `recovery.response` → enable `backup_supplier`, `expedited_shipments`,
  `short_term_capacity`.

Note: scsim policy parameters are global (scope G), so per-node policy patches only take effect for
fields materialized onto Material/Product (holding cost, capacity); other per-node patches fall back
to the project default and are reported.

---

## 7. Run → save → persist contract (worker is the sole writer)

1. **Browser** invokes `sim-command` with `kind="experiment.run"`. The edge function authenticates,
   verifies project access (RLS), inserts a `simulation_runs` row `status="queued"` (with the
   `policy_version_id`/snapshot), and `XADD`s the command to `sim.cmd.{project_id}`. It writes **no
   KPIs** (the old stub synthesis is removed).
2. **Worker** consumes the command, builds `ProjectData` via `datamap.py`, maps it with
   `from_project_data`, and runs `run_scenario`. It owns the lifecycle
   `queued → running → done|failed|cancelled` and is **idempotent by `run_id`**:
   - per replication → UPSERT `run_replications` on `(run_id, rep_index)` with `kpis`, `time_series`,
     `seed_used`, `warmup_at`;
   - on finish → PATCH `simulation_runs` with `aggregate_kpis` (means), `ci_half_widths`,
     `warmup_detected_at`, `rep_count_done`, `code_version="scsim-<ver>"`, and `mapping_warnings`.
   - `experiment.add_reps` appends replications + re-aggregates; `experiment.cancel` sets `cancelled`.
3. **Browser** reads `simulation_runs` + `run_replications` (live via `postgres_changes`) and renders
   real results + any mapping warnings.

KPI keys (the `ScenarioResult → DB` contract, in `scsim_bridge.py`): `fill_rate`, `revenue`,
`lost_sales_value`, `cost_of_resilience`, `ttr_weeks`, `tts_weeks`, `service_loss_area`,
`max_backlog`, `resilience_index`. Aggregates carry `mean` and `ci_halfwidth` per key.

---

## 8. Extending

- New stored field that drives the sim → add it to the relevant master table, to `ProjectData`,
  and to a rule in §4 + `from_project_data`; add a `MappingWarning` for its fallback; cover it in
  `scsim/tests/test_project_map.py`; update this file.
- Never read economics from two places. The worker reads masters via `datamap.py`; the `sc_nodes`/
  `sc_edges` SQL views are regenerated to read the same masters so any SQL consumer agrees.
