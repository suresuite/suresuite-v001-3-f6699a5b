<!-- run_id: 37221220481  outcome: failure -->
<!-- trigger: push  ref: claude/new-session-lzq7ro  sha: 7a65f535f2c2aa0312a4de222084855bdfe1d105 -->
# PLAN.md §15 — verification SQL, executed

- project ref: `wckdrutwkytwcomrlpib`
- run at: 2026-10-04T17:37:47.560Z
- route: Supabase Management API `/database/query` (the route §16 · WP 2.1 follow-up and `seed-project.yml` prove)
- every statement is a `select`; `assertReadOnly()` refuses anything else.
- migration ledger at start: **20261004000002** (402 applied)

### TEMPORARY DIAGNOSTIC — (R,Q) scenario revenue 0
<!-- at 2026-10-04T17:37:48.579Z -->

- project `50141cd1-9285-4d91-a7d1-dbd91a3ffcb5`, scenario `9a3aecb6-c2b4-462f-b5b9-034ca87608e8`

**All recent runs in the project (both scenarios, newest first):**
  | id                                   | scenario_name | status | code_version | rep_count_done | revenue  | fill_rate | lost_sales_value | engine | created_at                    | error_message |
  |--------------------------------------|---------------|--------|--------------|----------------|----------|-----------|------------------|--------|-------------------------------|---------------|
  | 47d45f78-9f4c-406c-9769-c5a7ea36525b | Test New      | done   | scsim-0.2.8  | 10             | 225000.0 | 0.8334    | 44979.8          | scsim  | 2026-09-25 20:29:42.929029+00 |               |
  | 9b8e04b0-d0ff-47fe-9481-c53d111ea72c | Test New      | done   | scsim-0.2.8  | 10             | 225000.0 | 0.8334    | 44979.8          | scsim  | 2026-09-25 20:28:14.0572+00   |               |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | Test New      | done   | scsim-0.2.8  | 10             | 245424.7 | 0.9091    | 24555.1          | scsim  | 2026-09-25 18:54:19.368952+00 |               |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | Test New      | done   | scsim-0.2.8  | 10             | 3200.0   | 0.01      | 316736.55        | scsim  | 2026-09-25 18:53:19.209478+00 |               |

**Full aggregate_kpis of the newest runs on the named scenario:**
- run `47d45f78-9f4c-406c-9769-c5a7ea36525b` (done, 2026-09-25 20:29:42.929029+00):
  ```json
  {"_meta": {"engine": "scsim", "stopping_rule": "fixed", "capacity_binding": {"products": [], "suppliers": [{"id": "S001", "capacity": 30000.0, "bound_weeks": 26.0}, {"id": "S004", "capacity": 40000.0, "bound_weeks": 8.4}, {"id": "S003", "capacity": 40000.0, "bound_weeks": 4.0}], "replications": 10, "window_weeks": 27, "plant_capacity": 40000.0, "unlimited_suppliers": 0, "finite_supplier_capacity": 130000.0}}, "revenue": 225000.0, "fill_rate": 0.8334, "max_backlog": 0.0, "avg_fg_units": 0.0, "avg_fg_value": 0.0, "lost_sales_value": 44979.8, "avg_on_hand_units": 143076.1593, "avg_on_hand_value": 19935.9935, "cost_of_resilience": 50077.6022, "lost_inbound_units": 0.0, "capacity_utilization": 0.4167, "products_capacity_bound": 0.0, "suppliers_capacity_bound": 3.0, "supplier_capacity_utilization": 0.3924}
  ```
- run `9b8e04b0-d0ff-47fe-9481-c53d111ea72c` (done, 2026-09-25 20:28:14.0572+00):
  ```json
  {"_meta": {"engine": "scsim", "stopping_rule": "fixed", "capacity_binding": {"products": [], "suppliers": [{"id": "S001", "capacity": 30000.0, "bound_weeks": 26.0}, {"id": "S004", "capacity": 40000.0, "bound_weeks": 8.4}, {"id": "S003", "capacity": 40000.0, "bound_weeks": 4.0}], "replications": 10, "window_weeks": 27, "plant_capacity": 40000.0, "unlimited_suppliers": 0, "finite_supplier_capacity": 130000.0}}, "revenue": 225000.0, "fill_rate": 0.8334, "max_backlog": 0.0, "avg_fg_units": 0.0, "avg_fg_value": 0.0, "lost_sales_value": 44979.8, "avg_on_hand_units": 143076.1593, "avg_on_hand_value": 19935.9935, "cost_of_resilience": 50077.6022, "lost_inbound_units": 0.0, "capacity_utilization": 0.4167, "products_capacity_bound": 0.0, "suppliers_capacity_bound": 3.0, "supplier_capacity_utilization": 0.3924}
  ```

**Mapping warnings on the two Test New runs (154d7032 = the (R,Q) one):**
  | run_id                               | level | entity                   | field                | reason                                                                                                                                                                       |
  |--------------------------------------|-------|--------------------------|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | warn  | event:S001               | start                | authored start week 6 is inside the warm-up, which no KPI measures → run from week 20, the first measured week; recovery (TTR/TTS) is not measurable for it                  |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | material:M001            | cost                 | no master cost → using volume-weighted inbound price                                                                                                                         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | material:M002            | cost                 | no master cost → using volume-weighted inbound price                                                                                                                         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | warn  | policy:feasibility       | constraint_overlap   | P-P.3 + P-S.1 both pre-deploy against 'material_availability' — submodular (diminishing) returns are likely; check the synergy decomposition.                                |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | warn  | policy:feasibility       | single_sourced_peers | 1 supplier(s) are single-sourced (S004); backup_supplier cannot protect materials they exclusively source — a BoM peer shortage still blocks production (manuscript Part I). |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | policy:inventory_control | order_up_to          | legacy absolute order_up_to replaced by coverage-based κ (≈8 weeks); a supplier-grid row's absolute s/S IS applied to that material                                          |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | warn  | product:P001             | production_capacity  | no capacity source → defaulted (capacity will not bind)                                                                                                                      |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | product:P001             | unit_price           | no master sell_price → demand-weighted outbound price                                                                                                                        |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | scenario                 | analysis_window      | 52 wk is outside the engine range [13, 39] wk → 39 wk used                                                                                                                   |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | info  | scenario                 | horizon              | 51 wk is outside the engine range [52, 520] wk → 52 wk used                                                                                                                  |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | warn  | event:S001               | start                | authored start week 6 is inside the warm-up, which no KPI measures → run from week 25, the first measured week; recovery (TTR/TTS) is not measurable for it                  |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | material:M001            | cost                 | no master cost → using volume-weighted inbound price                                                                                                                         |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | material:M002            | cost                 | no master cost → using volume-weighted inbound price                                                                                                                         |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | warn  | policy:feasibility       | single_sourced_peers | 1 supplier(s) are single-sourced (S004); backup_supplier cannot protect materials they exclusively source — a BoM peer shortage still blocks production (manuscript Part I). |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | warn  | policy:feasibility       | constraint_overlap   | P-P.3 + P-S.1 both pre-deploy against 'material_availability' — submodular (diminishing) returns are likely; check the synergy decomposition.                                |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | policy:inventory_control | material_overrides   | 2 material(s) carry supplier-grid replenishment overrides (type/Q/κ/absolute levels) — applied per material                                                                  |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | policy:inventory_control | order_up_to          | legacy absolute order_up_to replaced by coverage-based κ (≈8 weeks); a supplier-grid row's absolute s/S IS applied to that material                                          |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | warn  | product:P001             | production_capacity  | no capacity source → defaulted (capacity will not bind)                                                                                                                      |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | product:P001             | unit_price           | no master sell_price → demand-weighted outbound price                                                                                                                        |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | scenario                 | analysis_window      | 52 wk is outside the engine range [13, 39] wk → 39 wk used                                                                                                                   |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | info  | scenario                 | horizon              | 51 wk is outside the engine range [52, 520] wk → 52 wk used                                                                                                                  |

**Policy snapshot per recent run — default inventory + overrides:**
- run `47d45f78-9f4c-406c-9769-c5a7ea36525b` · version "Run: Test New — 9/25/2026, 10:28:12 PM"
  inventory default: `{"type": "rop", "rop_q_quantity": 400}`
  defaults (all families): `{"demand": {}, "recovery": {}, "sourcing": {}, "inventory": {"type": "rop", "rop_q_quantity": 400}, "transport": {}, "production": {}, "fulfillment": {}}`
  overrides: `[{"patch": {"primary_source": true}, "scope": "node", "family": "fulfillment", "target_key": "C001::P001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S001::M001"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S001::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S002::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S002::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S003::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S003::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S004::M002"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S004::M002"}]`
- run `9b8e04b0-d0ff-47fe-9481-c53d111ea72c` · version "Run: Test New — 9/25/2026, 10:28:12 PM"
  inventory default: `{"type": "rop", "rop_q_quantity": 400}`
  defaults (all families): `{"demand": {}, "recovery": {}, "sourcing": {}, "inventory": {"type": "rop", "rop_q_quantity": 400}, "transport": {}, "production": {}, "fulfillment": {}}`
  overrides: `[{"patch": {"primary_source": true}, "scope": "node", "family": "fulfillment", "target_key": "C001::P001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S001::M001"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S001::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S002::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S002::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S003::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S003::M001"}, {"patch": {"type": "rop", "rop_q_quantity": 100000}, "scope": "node", "family": "inventory", "target_key": "S004::M002"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S004::M002"}]`
- run `33b669c0-b52e-49d2-be6c-105081b08912` · version "Run: Test New — 9/25/2026, 8:54:17 PM"
  inventory default: `{"type": "rop", "rop_q_quantity": 400}`
  defaults (all families): `{"demand": {}, "recovery": {}, "sourcing": {}, "inventory": {"type": "rop", "rop_q_quantity": 400}, "transport": {}, "production": {}, "fulfillment": {}}`
  overrides: `[{"patch": {"primary_source": true}, "scope": "node", "family": "fulfillment", "target_key": "C001::P001"}, {"patch": {"type": "min_max"}, "scope": "node", "family": "inventory", "target_key": "S001::M001"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S001::M001"}, {"patch": {"type": "min_max"}, "scope": "node", "family": "inventory", "target_key": "S002::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S002::M001"}, {"patch": {"type": "min_max"}, "scope": "node", "family": "inventory", "target_key": "S003::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S003::M001"}, {"patch": {"type": "min_max"}, "scope": "node", "family": "inventory", "target_key": "S004::M002"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S004::M002"}]`
- run `154d7032-a01c-4456-9f04-f4dc86549a5b` · version "Run: Test New — 9/25/2026, 8:53:15 PM"
  inventory default: `{"type": "rop", "rop_q_quantity": 400}`
  defaults (all families): `{"demand": {}, "recovery": {}, "sourcing": {}, "inventory": {"type": "rop", "rop_q_quantity": 400}, "transport": {}, "production": {}, "fulfillment": {}}`
  overrides: `[{"patch": {"primary_source": true}, "scope": "node", "family": "fulfillment", "target_key": "C001::P001"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S001::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S002::M001"}, {"patch": {"primary_source": false}, "scope": "node", "family": "sourcing", "target_key": "S003::M001"}, {"patch": {"primary_source": true}, "scope": "node", "family": "sourcing", "target_key": "S004::M002"}]`

**Replication rows for the named scenario's runs:**
  | run_id                               | rep_index | status | revenue  | fill_rate | lost_sales_value |
  |--------------------------------------|-----------|--------|----------|-----------|------------------|
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 0         | done   | 3200.0   | 0.010026  | 315968.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 1         | done   | 3200.0   | 0.01003   | 315848.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 2         | done   | 3200.0   | 0.009993  | 317021.5         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 3         | done   | 3200.0   | 0.010021  | 316119.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 4         | done   | 3200.0   | 0.009986  | 317248.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 5         | done   | 3200.0   | 0.009992  | 317068.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 6         | done   | 3200.0   | 0.010004  | 316678.0         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 7         | done   | 3200.0   | 0.009972  | 317699.5         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 8         | done   | 3200.0   | 0.00999   | 317106.5         |
  | 154d7032-a01c-4456-9f04-f4dc86549a5b | 9         | done   | 3200.0   | 0.010006  | 316609.0         |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | 0         | done   | 248441.0 | 0.922343  | 20917.5          |
  | 33b669c0-b52e-49d2-be6c-105081b08912 | 1         | done   | 242144.5 | 0.899093  | 27176.5          |

**The project's scenarios (newest first):**
- `9a3aecb6-c2b4-462f-b5b9-034ca87608e8` **Test New** — horizon 360d, step day, warmup auto/14, reps 10, seed 42, crn true, primary_kpi fill_rate, from_network false
  demand_model: `{"kind": "poisson", "lambda": 50}`
  disruptions: `[{"target": "S001", "start_day": 42, "target_type": "node", "duration_days": 50, "magnitude_pct": 50}]`

### D205 — /admin's users: the list the page reads, and the three org facts
<!-- at 2026-10-04T17:37:54.178Z -->

**A · Accounts by role and state** (the population /admin/users should list):
  | role        | is_active | accounts |
  |-------------|-----------|----------|
  | super_admin | true      | 2        |
  | user        | true      | 23       |

**B · What `v_admin_user_usage` returns to a reader who carries no GUC and no
session** — the browser's shape (D155). The Management API runs as the owner, so
this is the view's OWN predicate answering, not a grant:
  | accounts | view_rows | predicate_for_this_reader |
  |----------|-----------|---------------------------|
  | 25       | 0         | false                     |

**C · Per organization: the three authors of "who is in it"** — `organization_id`
(the authority, D13), the `organization_members` rows (the Organizations page's
Members figure), and the `organization` text copy:
  | organization           | status | by_uuid | member_rows | by_text |
  |------------------------|--------|---------|-------------|---------|
  | ACCURATE-AA            | active | 5       | 20          | 5       |
  | ACCURATE-AU            | active | 2       | 2           | 2       |
  | ACCURATE-Aumovio       | active | 5       | 21          | 5       |
  | ACCURATE-DeltaDAO      | active | 1       | 1           | 1       |
  | ACCURATE-ES            | active | 2       | 2           | 2       |
  | ACCURATE-Fraunhofer    | active | 1       | 1           | 1       |
  | ACCURATE-IMT           | active | 4       | 4           | 4       |
  | ACCURATE-Simavi        | active | 2       | 2           | 2       |
  | ACCURATE-TRON          | active | 1       | 19          | 1       |
  | HWR                    | active | 1       | 6           | 1       |
  | SuReSuite-default-2026 | active | 1       | 2           | 0       |

**D · Contradictions between `organization_members` and `organization_id`:**
  | member_rows_in_another_org | of_which_owner_or_admin | accounts_missing_their_row | accounts_without_org | text_copy_disagrees |
  |----------------------------|-------------------------|----------------------------|----------------------|---------------------|
  | 55                         | 4                       | 0                          | 0                    | 1                   |

**E · Org roles held, by whether the row agrees with the account's org:**
  | org_role | agrees | app_role    | rows |
  |----------|--------|-------------|------|
  | admin    | false  | super_admin | 1    |
  | admin    | false  | user        | 3    |
  | admin    | true   | user        | 1    |
  | member   | false  | user        | 51   |
  | member   | true   | super_admin | 2    |
  | member   | true   | user        | 22   |

**F · Suspended accounts that signed in AFTER they were suspended** (the login
never reads `is_active`; the sign-in rows exist since D185):
  | suspended_accounts | suspension_not_in_log | sign_ins_after |
  |--------------------|-----------------------|----------------|
  | 0                  | 0                     | 0              |

**G · What the Overview's zeros may be hiding:**
  | usage_rows | usage_rows_mtd | organizations | projects | active_super_admins |
  |------------|----------------|---------------|----------|---------------------|
  | 101        | 0              | 11            | 6        | 2                   |

### WP 9.4 — the validated baseline: by name, and by role (D227)
<!-- at 2026-10-04T17:38:03.988Z -->

**A · Per project: scenarios named like the baseline, and baselines by role.** More
than one named row is the rename/duplicate shape the name lookup produced; after the
deploy every project with a validation run should read exactly one by role:
  | project             | named_baseline | by_role | rows_with_column | scenarios |
  |---------------------|----------------|---------|------------------|-----------|
  | Aumovio             | 0              | 0       | 3                | 3         |
  | Example — 1P/2M/3S  | 1              | 1       | 1                | 1         |
  | Project AA - ver3   | 0              | 0       | 1                | 1         |
  | Project TRON - ver1 | 1              | 1       | 2                | 2         |
  | Test_MTS            | 1              | 1       | 7                | 7         |
  | Test_Simulation     | 0              | 0       | 1                | 1         |

**B · Active model cards whose evidence run belongs to a scenario that is NOT the
project's baseline by role** — should be 0 after the deploy:
  | cards_off_baseline |
  |--------------------|
  | 0                  |

### Phase 10 · WP 10.1–10.8 — versions by content, the stored graph state, Validated Models, engines and RunKeys, D248, result tiers, capacity, the training set
<!-- at 2026-10-04T17:38:05.800Z -->

**(1) D241 — policy versions vs the contents they hold:**
  | versions | distinct_contents | same_content_duplicates | no_hash |
  |----------|-------------------|-------------------------|---------|
  | 44       | 21                | 23                      | 0       |
**(2) D242 — active model cards and the content triples they cover:**
  | active_cards | distinct_triples |
  |--------------|------------------|
  | 3            | 3                |
**(3) policy version numbers (after the merge):**
  | versions | numbered | distinct_numbers |
  |----------|----------|------------------|
  | 44       | 44       | 21               |
**(4) graph versions (after the merge: every row numbered, levels where the snapshot supports them):**
  | versions | distinct_contents | numbered | with_firm_level | with_process_level |
  |----------|-------------------|----------|-----------------|--------------------|
  | 17       | 17                | 17       | 13              | 14                 |
**(5) the stored graph state:**
  | projects_with_state | dirty | stored_clean | projects |
  |---------------------|-------|--------------|----------|
  | 6                   | 0     | 6            | 6        |
**(6) analysis runs by kind and level:**
  | analysis_kind     | input_scope | status    | runs | with_graph_version |
  |-------------------|-------------|-----------|------|--------------------|
  | combine_etl       | all         | succeeded | 1    | 0                  |
  | critical_nodes    | all         | succeeded | 2    | 0                  |
  | critical_nodes    | process     | succeeded | 1    | 1                  |
  | network_metrics   | all         | succeeded | 3    | 0                  |
  | process_structure | process     | succeeded | 3    | 3                  |
  | prominence        | firm        | succeeded | 3    | 3                  |
**(7) Validated Models (before the merge this errors: the columns deploy with it):**
  | status     | models | with_protocol | backfilled | unknown_keys_total | with_engine |
  |------------|--------|---------------|------------|--------------------|-------------|
  | active     | 3      | 3             | 2          | 5                  | 3           |
  | superseded | 2      | 2             | 2          | 4                  | 2           |
**(8) `sim_engines` (after the merge, scsim should carry the worker's build):**
  | slug          | status  | version | code_version             | reported_at                  |
  |---------------|---------|---------|--------------------------|------------------------------|
  | legacy-worker | retired |         |                          |                              |
  | scsim         | active  | 0.6.1   | scsim-0.6.1+77b8c27865c3 | 2026-10-04 13:24:11.29458+00 |
**(9) run rows and their bindings (history has no RunKey by design):**
  | runs | with_engine | with_run_key | exploratory | with_overrides | last_7_days |
  |------|-------------|--------------|-------------|----------------|-------------|
  | 19   | 19          | 3            | 18          | 1              | 11          |
**(10) D248 — `_`-prefixed SECURITY DEFINER functions the API roles can execute:**
  (no rows)
**(11) the `run-results` bucket:**
  | id          | public | file_size_limit |
  |-------------|--------|-----------------|
  | run-results | false  |                 |
- **(12) D246 — the series sweep's schedule** — QUERY FAILED: `HTTP 400: {"message":"Failed to run sql query: ERROR:  42P01: relation \"cron.job\" does not exist\nLINE 1: select jobname, schedule, active from cron.job where jobname = 'run-series-sweep'\n                                              ^\n"}`
**(13) completed runs by retention — Parquet objects against JSONB-era series:**
  | retention | runs | in_parquet | with_expiry | expired | parquet_bytes | jsonb_bytes |
  |-----------|------|------------|-------------|---------|---------------|-------------|
  | evidence  | 2    | 1          | 0           | 0       | 6003          | 0           |
  | standard  | 17   | 2          | 17          | 0       | 19973         | 0           |
**(14) organization plans (after the merge every organization starts at 90 days):**
  | organizations | with_compute_quota | with_storage_quota | with_concurrency_cap | retention_90_days | retention_unlimited |
  |---------------|--------------------|--------------------|----------------------|-------------------|---------------------|
  | 11            | 0                  | 0                  | 0                    | 11                | 0                   |
**(15) role shares, and the ledger by kind (a post-merge run with no `dispatch` row skipped admission — D252):**
  | source               | scope   | kind     | rows | rep_weeks |
  |----------------------|---------|----------|------|-----------|
  | plan_role_allowances | default | analyst  | 1    |           |
  | plan_role_allowances | default | editor   | 1    |           |
  | plan_role_allowances | default | owner    | 1    |           |
  | plan_role_allowances | default | viewer   | 1    |           |
  | run_usage            | all     | complete | 3    | 1093      |
  | run_usage            | all     | dispatch | 3    | 1093      |
**(16) the training set (empty is a true reading until a Validated Model's runs complete after the merge):**
  | project_id                           | models | graph_versions | runs | replications | feature_kind_seeded |
  |--------------------------------------|--------|----------------|------|--------------|---------------------|
  | 4a308fec-742b-4d43-8dc1-185c5858efad | 3      | 1              | 1    | 3            | 1                   |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | 1      | 1              | 1    | 1            | 1                   |

### Phase 11 · WP 11.1–11.4 — a version per level, the simulation scope, the bindings, the lineage
<!-- at 2026-10-04T17:38:20.831Z -->

**(1) level versions per project and level (numbers are per LEVEL; a project with history has every level from v1):**
  | project_id                           | level      | versions | highest_no | first_snapshot_gone |
  |--------------------------------------|------------|----------|------------|---------------------|
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | firm       | 1        | 1          | 0                   |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | process    | 1        | 1          | 0                   |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | product    | 2        | 2          | 0                   |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | simulation | 2        | 2          | 0                   |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | firm       | 1        | 1          | 0                   |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | process    | 1        | 1          | 0                   |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | product    | 1        | 1          | 0                   |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | simulation | 1        | 1          | 0                   |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | firm       | 1        | 1          | 0                   |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | process    | 1        | 1          | 0                   |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | product    | 1        | 1          | 0                   |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | simulation | 1        | 1          | 0                   |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | firm       | 5        | 5          | 0                   |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | process    | 1        | 1          | 0                   |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | product    | 4        | 4          | 0                   |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | simulation | 4        | 4          | 0                   |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | firm       | 1        | 1          | 0                   |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | process    | 1        | 1          | 0                   |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | product    | 1        | 1          | 0                   |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | simulation | 1        | 1          | 0                   |
**(2) snapshot tuples (a NULL is right only where the hash is NULL; the two `_unregistered` columns must be 0):**
  | snapshots | no_product | no_process | no_firm | no_simulation | firm_hash_unregistered | sim_hash_unregistered |
  |-----------|------------|------------|---------|---------------|------------------------|-----------------------|
  | 17        | 3          | 3          | 4       | 3             | 0                      | 0                     |
**(3) Validated Models (`could_have_learnt` must be 0 — the backfill read every model's own snapshot):**
  | status     | models | bind_simulation_scope | composite_only | could_have_learnt |
  |------------|--------|-----------------------|----------------|-------------------|
  | active     | 3      | 3                     | 0              | 0                 |
  | superseded | 2      | 2                     | 0              | 0                 |
**(4) runs (every run dispatched after the merge is RunKey v2 with a simulation version):**
  | run_key_version | runs | with_simulation_hash | with_simulation_version | last_day |
  |-----------------|------|----------------------|-------------------------|----------|
  | 2               | 3    | 3                    | 3                       | 2        |
  | none            | 16   | 12                   | 12                      | 0        |
**(5) analysis runs (scope `all` names no level version by design):**
  | input_scope | status    | runs | with_level_version |
  |-------------|-----------|------|--------------------|
  | all         | succeeded | 6    | 0                  |
  | firm        | succeeded | 3    | 3                  |
  | process     | succeeded | 4    | 4                  |
**(6) the simulation scope now vs the newest snapshot (`false` with `dirty` true is an edit not yet captured, not a fault):**
  | project_id                           | dirty | stored_equals_newest | live_is_a_version |
  |--------------------------------------|-------|----------------------|-------------------|
  | 16a68569-5fcb-43ef-b2bc-1dc62a31617e | false |                      | 0                 |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | false | true                 | 1                 |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | false | true                 | 1                 |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | false | true                 | 1                 |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | false | true                 | 1                 |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | false | true                 | 1                 |
**(7) the training set (simulation versions ≤ composites; equal when no deep-tier-only change separated two runs):**
  | project_id                           | simulation_versions | composites | runs | replications |
  |--------------------------------------|---------------------|------------|------|--------------|
  | 4a308fec-742b-4d43-8dc1-185c5858efad | 1                   | 1          | 1    | 3            |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | 1                   | 1          | 1    | 1            |
**(8) doors (the first three and `insert_policies` must be false/0; the tuple read must be true):**
  | anon_inserts_snapshot | anon_inserts_level | anon_registers | anon_reads_tuple | insert_policies |
  |-----------------------|--------------------|----------------|------------------|-----------------|
  | false                 | false              | false          | true             | 0               |
**(9) `network_metrics` / `prominence` runs keyed on a level (any row here is what D240's drop waits for):**
  | analysis_kind | input_scope | runs | latest                        |
  |---------------|-------------|------|-------------------------------|
  | prominence    | firm        | 3    | 2026-10-01 21:29:58.090181+00 |

### Phase 12 · WP 12.2–12.3 — what a library would pull, and who a key is
<!-- at 2026-10-04T17:38:28.848Z -->

**(1) dataset snapshots by project — `max_json_bytes` is the uncompressed response body:**
  | project_id                           | versions | max_json_bytes | avg_json_bytes | max_stored_bytes |
  |--------------------------------------|----------|----------------|----------------|------------------|
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 9        | 592370         | 416444         | 117413           |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | 2        | 534735         | 309701         | 167004           |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | 2        | 7563           | 6872           | 1850             |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | 1        | 2278           | 2278           | 917              |
  | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | 2        | 2277           | 2276           | 908              |
  | 16a68569-5fcb-43ef-b2bc-1dc62a31617e | 1        | 1479           | 1479           | 859              |
**(2) largest dataset snapshots (`inputs` is what a simulation needs; `network` only the analyses):**
  | id                                   | project_id                           | schema_version | json_bytes | inputs_bytes | network_bytes |
  |--------------------------------------|--------------------------------------|----------------|------------|--------------|---------------|
  | c3b6e3a6-b90a-4a06-8c70-b1ffc55f2c3c | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 3              | 592370     | 359475       | 232849        |
  | a8229fdb-b7bf-4770-a410-9ca28ff85922 | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 3              | 540741     | 359475       | 181220        |
  | 530a6840-7dcd-4a31-bf00-7876b47fe97b | 8724f960-b612-4bd5-a010-ab3250849f6a | 3              | 534735     | 160051       | 374638        |
  | 26ef94a5-cadb-41e1-98a6-1437ec92f2a1 | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 3              | 411258     | 359475       | 51737         |
  | e23a93e6-1f91-415c-81ad-7677016c2871 | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 3              | 374928     | 359477       | 15405         |
**(3) policy snapshots:**
  | versions | max_json_bytes | avg_json_bytes |
  |----------|----------------|----------------|
  | 44       | 135527         | 26281          |
**(4) API keys (`with_creator` < `keys` means some keys could not become personal):**
  | env  | keys | with_creator | not_revoked |
  |------|------|--------------|-------------|
  | live | 1    | 1            | 1           |
  | test | 1    | 1            | 0           |

### Phase 15 · WP 15.7 — the engine build ledger and archive
<!-- at 2026-10-04T17:38:33.096Z -->

**(0) engine labels on runs (`names_a_build` is true for every run computed since WP 15.1 deployed):**
  | code_version | names_a_build | runs | first_run  | last_run   |
  |--------------|---------------|------|------------|------------|
  | scsim-0.6.1  | false         | 2    | 2026-10-03 | 2026-10-03 |
  | scsim-0.2.9  | false         | 1    | 2026-10-02 | 2026-10-02 |
  | scsim-0.2.8  | false         | 12   | 2026-09-25 | 2026-09-30 |
  | scsim-0.2.3  | false         | 1    | 2026-07-13 | 2026-07-13 |
  | scsim-0.2.1  | false         | 3    | 2026-07-12 | 2026-07-12 |
**(1) labels on runs vs the ledger (`labels_missing_from_ledger` must be 0 — the backfill and the run trigger record every one):**
  | labels_on_runs | labels_missing_from_ledger |
  |----------------|----------------------------|
  | 5              | 0                          |
**(2) the ledger (`backfill` rows are history and carry no digests; a `worker_report` row after the merge carries digests, commit and image):**
  | first_seen_by | builds | content_named | with_digests | with_commit | with_image | withdrawn |
  |---------------|--------|---------------|--------------|-------------|------------|-----------|
  | backfill      | 6      | 0             | 0            | 0           | 0          | 0         |
  | worker_report | 1      | 1             | 1            | 1           | 1          | 0         |
**(3) registry vs ledger (after the worker deploys, scsim's `code_version` names a build and its row carries the deploy's commit):**
  | slug          | status  | code_version             | reported_at                  | first_seen_by | commit_sha                               | has_image | withdrawn_at |
  |---------------|---------|--------------------------|------------------------------|---------------|------------------------------------------|-----------|--------------|
  | legacy-worker | retired |                          |                              |               |                                          | false     |              |
  | scsim         | active  | scsim-0.6.1+77b8c27865c3 | 2026-10-04 13:24:11.29458+00 | worker_report | f6a0206e3cbb0ab477afa3c648bf3c0da80900be | true      |              |
**(4) runs since the first non-backfill build (every completed one names a build):**
  (no rows)
**(5) the bucket (after the first publish with `--backfill`, `versions_json` is 1 and every committed wheel set is archived):**
  | index_json | versions_json | wheels | scsim_wheels |
  |------------|---------------|--------|--------------|
  | 1          | 0             | 15     | 7            |

### D278 — account role vs the active organization's role, every organization
<!-- at 2026-10-04T17:38:39.882Z -->

**(1) account admins left at organization `member` (what `admin_list_account_role_gaps` lists; empty is clean):**
  (no rows)
**(2) non-admin accounts holding an organization `admin` row — they manage the organization's API keys (a demotion before D278 left these; an explicit `admin_set_user_org_role` also makes them):**
  | organization     | account_role | accounts |
  |------------------|--------------|----------|
  | ACCURATE-Aumovio | user         | 1        |
**(3) totals:**
  | admin_at_member | non_admin_at_admin | account_admins | accounts_with_an_active_membership |
  |-----------------|--------------------|----------------|------------------------------------|
  | 0               | 1                  | 0              | 25                                 |

### Schema probe — production vs. the migrations (D32, D43)
<!-- at 2026-10-04T17:38:42.575Z -->

- migrations create **94 tables** and **8 views**; production's `public` schema holds **102 relations**.
- **created by a migration, ABSENT from production: 0 tables, 0 views**
- **present in production, created by NO migration: 0**

### D38 — every view runs as its caller, or is the declared exception
<!-- at 2026-10-04T17:38:43.475Z -->

- production's `public` schema holds **8 views**.
  | view                             | runs_as | states_own_rule |
  |----------------------------------|---------|-----------------|
  | admin_audit_logs                 | caller  | —               |
  | admin_org_file_usage             | caller  | —               |
  | sc_edges                         | caller  | —               |
  | sc_nodes                         | caller  | —               |
  | simulation_result_scenarios      | caller  | —               |
  | simulation_results_with_settings | caller  | —               |
  | surrogate_training_runs          | caller  | —               |
  | v_admin_user_usage               | OWNER   | yes             |
- `v_admin_user_usage` runs as its owner AND states its own rule — the declared exception is intact in production.

### D30 — which of the two duplicate-policy migrations ran
<!-- at 2026-10-04T17:38:44.450Z -->

  | trigger_name                            | on_table                       |
  |-----------------------------------------|--------------------------------|
  | simulation_cache_defaults               | simulation_cache               |
  | simulation_job_timing_trigger           | simulation_jobs                |
  | simulation_jobs_defaults                | simulation_jobs                |
  | simulation_performance_metrics_defaults | simulation_performance_metrics |
- from `20250913085427`: **4 of 4**; from `20250914113723`: **0 of 4**.
- **SETTLED: `20250913085427` ran to completion and `20250914113723` ABORTED at its first duplicate `CREATE POLICY` (42710).** Everything after statement 155 of the later file — two functions and four triggers — never reached production. What the tables have is the EARLIER file's set.
  | function_name                  |
  |--------------------------------|
  | cleanup_simulation_cache       |
  | set_simulation_tables_defaults |
  | update_simulation_job_timing   |

**D44 · what the unseed actually did**, read back from the audit row rather than from a NOTICE the `db push` log discards:
  | created_at                    | action    | target_type      | rows_carrying_zero | distinct_targets | keys_removed | rows_deleted_empty | rows_still_zero | actor_known |
  |-------------------------------|-----------|------------------|--------------------|------------------|--------------|--------------------|-----------------|-------------|
  | 2026-09-16 06:34:12.104994+00 | remediate | policy_overrides | 477                | 477              | 477          | 0                  | 0               | false       |
- `rows_deleted_empty = 0` is the number that judges the SHAPE of the fix: every row it did NOT delete is a row a row-level `DELETE` would have taken, along with whatever else its patch held.

**D45 · the data plane, in production** — 18 rows and all of them `admin` was the measurement that opened D45:
  | plane  | rows  | first_row                     |
  |--------|-------|-------------------------------|
  | access | 79    | 2026-09-29 16:21:44.636098+00 |
  | admin  | 314   | 2026-07-11 18:11:02.13357+00  |
  | data   | 22146 | 2026-09-16 06:34:12.104994+00 |
- No policy name is duplicated. WP 2.1's drop-and-recreate left one of each, which is the END STATE D30 says was already deterministic.

### D29 — `organizations.name` collisions (the dual read's text branch)
<!-- at 2026-10-04T17:38:49.875Z -->

- **0** normalized organization names are held by more than one organization.
- No collision today. D29 is latent, not live — nothing prevents the next one (`name` has no unique constraint).
- organizations: **11**

**D29 · the one project the text branch is load-bearing for.** Removing the branch is gated on this row:
  (no rows)
- Each row's org text matches EXACTLY ONE organization, so the backfill's own ambiguity rule resolves it. The branch can go once it is applied.
  | id                                   | name                   | slug                | status |
  |--------------------------------------|------------------------|---------------------|--------|
  | b1aacf37-de4b-41b9-b305-6f0745412eab | ACCURATE-AA            | accurate-aa         | active |
  | 255412d4-8d2c-40eb-826f-8e5328fe078c | ACCURATE-AU            | accurate-au         | active |
  | ecd7f66b-381d-4e0f-a686-15bbfd310d43 | ACCURATE-Aumovio       | accurate-aumovio    | active |
  | 710b06f2-90f4-48e6-9995-1373344a9c0c | ACCURATE-DeltaDAO      | accurate-deltadao   | active |
  | 55ab2ce2-fc7c-4afd-9dd9-642763206259 | ACCURATE-ES            | accurate-es         | active |
  | 0daafcb5-4b28-4dca-9572-8165652f7d09 | ACCURATE-Fraunhofer    | accurate-fraunhofer | active |
  | d2494535-2fb6-4e00-a92b-808183176b26 | ACCURATE-IMT           | accurate-imt        | active |
  | 8e2d94ed-d7c9-430a-a807-ad706478192e | ACCURATE-Simavi        | accurate-simavi     | active |
  | 594be6f1-5fb9-45c7-b214-b9766ccc1a03 | ACCURATE-TRON          | accurate-tron       | active |
  | 3df2ed87-cb1c-48fc-9901-8ec513bbe3db | HWR                    | hwr                 | active |
  | 35cae3ee-63cb-4fc9-8d1f-939720b28fd1 | SuReSuite-default-2026 | company1            | active |

**D29 · who would lose access if the text branch were removed.** The branch can only admit a reader whose own org TEXT matches a project's:
  | users_with_default_org_text | active | users_with_blank_org_text |
  |-----------------------------|--------|---------------------------|
  | 0                           | 0      | 0                         |
- Nobody carries the `default_org` text, so the NULL-org project is reachable by no ordinary user today. Removing the branch revokes nothing.

### The four decisions §15 gates (§16 PHASE BOUNDARY, condition 2)
<!-- at 2026-10-04T17:38:54.381Z -->

**1 · The org backfill's real coverage** — WP 2.1's unverifiable exit check.
  | projects | projects_org_null | projects_org_text_blank | approved_users | users_org_null |
  |----------|-------------------|-------------------------|----------------|----------------|
  | 6        | 0                 | 0                       | 25             | 0              |

**2 · Projects whose `modeler_id` resolves to no `approved_users` row** — WP 2.2's owner backfill.
  | projects_with_modeler | modeler_without_account |
  |-----------------------|-------------------------|
  | 6                     | 0                       |

**3 · Production's audit rows against WP 2.3's new `plane` CHECK.**
  | plane  | rows  |
  |--------|-------|
  | data   | 22146 |
  | admin  | 314   |
  | access | 79    |
- Every row's `plane` is inside `(admin, data, access)`. The generalization migrated cleanly.

### WP 3.1 — the ingestion tables, after the rename
<!-- at 2026-10-04T17:38:57.055Z -->

  | runs | runs_connector | runs_without_link | runs_without_project | staged_products | staged_bom_versions | staged_bom_lines | landed_files | links |
  |------|----------------|-------------------|----------------------|-----------------|---------------------|------------------|--------------|-------|
  | 13   | 0              | 13                | 0                    | 0               | 0                   | 0                | 13           | 0     |

### WP 3.2 — the CSV landing, and whether it has ever run
<!-- at 2026-10-04T17:38:57.941Z -->

  | csv_runs | csv_runs_applied | staged_rows | staged_rows_rejected | csv_files | landing_audit_rows |
  |----------|------------------|-------------|----------------------|-----------|--------------------|
  | 13       | 6                | 30          | 0                    | 13        | 14                 |
- **13 landed CSV file(s) but 14 landing audit row(s)** — they are written in the same transaction, so a difference means something writes `ingest_files` outside `ingest_land_file`. That is invariant `audit-actor` failing, not a counting quirk.

### WP 3.4 — provenance on tier 2, and what `diff_state` actually holds
<!-- at 2026-10-04T17:38:58.902Z -->

  | tbl                | total | with_run | with_row |
  |--------------------|-------|----------|----------|
  | bom_multi_level    | 396   | 0        | 0        |
  | bom_single_level   | 2220  | 4        | 4        |
  | inbound_logistics  | 711   | 8        | 8        |
  | materials          | 580   | 0        | 0        |
  | outbound_logistics | 12    | 2        | 2        |
  | products           | 12    | 0        | 0        |
  | suppliers          | 117   | 0        | 0        |
- **14 of 4048 canonical rows trace to a source line.** A NULL means the provenance is UNKNOWN, never that there was none: both columns are `ON DELETE SET NULL`, and every row predating the CSV landing path carries neither because the files were never stored. Nothing can backfill it.
  | diff_state | rows |
  |------------|------|
  | new        | 24   |
  | unchanged  | 6    |
  | id                                   | source_kind | status  | staged | rows_new | rows_changed | rows_unchanged | rows_superseded | rows_held | rows_removed |
  |--------------------------------------|-------------|---------|--------|----------|--------------|----------------|-----------------|-----------|--------------|
  | 107e6ed7-848a-486b-a565-9137ad97fd51 | csv         | applied | 1      | 1        | 0            | 0              | 0               | 0         | 0            |
  | b0b2dca6-04b5-4583-ac6e-e2adceb45d54 | csv         | applied | 4      | 4        | 0            | 0              | 0               | 0         | 0            |
  | 9102e4ce-0eff-4f23-bf28-cb752c85de50 | csv         | applied | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | 418e3000-9b8b-48f4-8781-b3a1bf04e06e | csv         | staged  | 4      | 0        | 0            | 4              | 0               | 0         | 0            |
  | bd5814fb-1a5f-4e39-9c72-e1a2c690984e | csv         | staged  | 2      | 0        | 0            | 2              | 0               | 0         | 0            |
  | 46a1c85e-bc61-4ba2-a09e-3672516062bc | csv         | applied | 1      | 1        | 0            | 0              | 0               | 0         | 0            |
  | 2a56d7a8-afe0-4ecf-83e8-a7ec33f7b760 | csv         | applied | 4      | 4        | 0            | 0              | 0               | 0         | 0            |
  | f0ebdd47-dcd8-436c-a52b-e55d3a7a17c1 | csv         | applied | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | 55312746-40a7-4a74-877b-ebd731249cbd | csv         | staged  | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | f11374e8-4738-4cfc-ba56-824c90d1c3eb | csv         | staged  | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | fba8b2cc-859c-488c-8e37-adc1cdd1ee26 | csv         | staged  | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | 289133d7-3669-47a6-ace3-4b20056b0668 | csv         | staged  | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
  | 9baeffe6-8f80-495b-a7fa-e1fd5fd4c069 | csv         | staged  | 2      | 2        | 0            | 0              | 0               | 0         | 0            |
- Every run's five counts partition its staged rows exactly.
  | projects | projects_with_no_member | modeler_not_a_member | memberships |
  |----------|-------------------------|----------------------|-------------|
  | 6        | 0                       | 0                    | 62          |
- Every project's modeler is a member of it. The role gate resolves for the person who created the project, which is the precondition WP 3.4's exit check stands on.

### WP 6.5 (a) — the landing switch: precondition, bucket, baseline, exit
<!-- at 2026-10-04T17:39:02.651Z -->

**(1) D156 — which table each landing actor column keys to:**
  | table_name   | columns              | constraint_name                    | references_table      | on_delete |
  |--------------|----------------------|------------------------------------|-----------------------|-----------|
  | ingest_files | uploaded_by          | ingest_files_uploaded_by_fkey      | public.approved_users | SET NULL  |
  | ingest_runs  | applied_by_user_id   | ingest_runs_applied_by_user_fkey   | public.approved_users | SET NULL  |
  | ingest_runs  | triggered_by_user_id | ingest_runs_triggered_by_user_fkey | public.approved_users | SET NULL  |
- **MET.** All three actor columns key to `public.approved_users`, none to `auth.users`, so a real uploader satisfies the landing's non-NULL actor AND its foreign key.

**(2) the storage bucket `ingest-file` writes to:**
  | id     | public | objects |
  |--------|--------|---------|
  | ingest | false  | 14      |
- Present and private.

**(3) the baseline — every project, every landable table** (`rows / with ingest_run_id / with source_row_id`):
  | tbl                | project                        | rows | with_run | with_row |
  |--------------------|--------------------------------|------|----------|----------|
  | bom_multi_level    | Project AA - ver3 · 8724f960   | 396  | 0        | 0        |
  | bom_single_level   | Aumovio · 6d721b5d             | 2202 | 0        | 0        |
  | bom_single_level   | Example — 1P/2M/3S · 16a68569  | 2    | 0        | 0        |
  | bom_single_level   | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | bom_single_level   | Test_MTS · 3750c886            | 2    | 2        | 2        |
  | bom_single_level   | Test_Simulation · 50141cd1     | 2    | 2        | 2        |
  | customers          | Aumovio · 6d721b5d             | 1    | 0        | 0        |
  | customers          | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | customers          | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | customers          | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | inbound_logistics  | Aumovio · 6d721b5d             | 367  | 0        | 0        |
  | inbound_logistics  | Example — 1P/2M/3S · 16a68569  | 3    | 0        | 0        |
  | inbound_logistics  | Project AA - ver3 · 8724f960   | 321  | 0        | 0        |
  | inbound_logistics  | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | inbound_logistics  | Test_MTS · 3750c886            | 4    | 4        | 4        |
  | inbound_logistics  | Test_Simulation · 50141cd1     | 4    | 4        | 4        |
  | materials          | Aumovio · 6d721b5d             | 367  | 0        | 0        |
  | materials          | Example — 1P/2M/3S · 16a68569  | 2    | 0        | 0        |
  | materials          | Project AA - ver3 · 8724f960   | 195  | 0        | 0        |
  | materials          | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | materials          | Test_MTS · 3750c886            | 2    | 0        | 0        |
  | materials          | Test_Simulation · 50141cd1     | 2    | 0        | 0        |
  | network_edges      | Aumovio · 6d721b5d             | 958  | —        | —        |
  | network_edges      | Project AA - ver3 · 8724f960   | 2129 | —        | —        |
  | network_nodes      | Aumovio · 6d721b5d             | 810  | —        | —        |
  | network_nodes      | Project AA - ver3 · 8724f960   | 1385 | —        | —        |
  | node_list          | Aumovio · 6d721b5d             | 439  | —        | —        |
  | node_list          | Example — 1P/2M/3S · 16a68569  | 7    | —        | —        |
  | node_list          | Project AA - ver3 · 8724f960   | 294  | —        | —        |
  | node_list          | Project TRON - ver1 · 4a308fec | 25   | —        | —        |
  | node_list          | Test_MTS · 3750c886            | 8    | —        | —        |
  | node_list          | Test_Simulation · 50141cd1     | 8    | —        | —        |
  | outbound_logistics | Aumovio · 6d721b5d             | 6    | 0        | 0        |
  | outbound_logistics | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | outbound_logistics | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | outbound_logistics | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | outbound_logistics | Test_MTS · 3750c886            | 1    | 1        | 1        |
  | outbound_logistics | Test_Simulation · 50141cd1     | 1    | 1        | 1        |
  | products           | Aumovio · 6d721b5d             | 6    | 0        | 0        |
  | products           | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | products           | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | products           | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | products           | Test_MTS · 3750c886            | 1    | 0        | 0        |
  | products           | Test_Simulation · 50141cd1     | 1    | 0        | 0        |
  | suppliers          | Aumovio · 6d721b5d             | 65   | 0        | 0        |
  | suppliers          | Example — 1P/2M/3S · 16a68569  | 3    | 0        | 0        |
  | suppliers          | Project AA - ver3 · 8724f960   | 32   | 0        | 0        |
  | suppliers          | Project TRON - ver1 · 4a308fec | 9    | 0        | 0        |
  | suppliers          | Test_MTS · 3750c886            | 4    | 0        | 0        |
  | suppliers          | Test_Simulation · 50141cd1     | 4    | 0        | 0        |

Totals (the line the after-read is compared against — a table whose `rows` falls lost data):
  | tbl                     | projects | rows | with_run | with_row |
  |-------------------------|----------|------|----------|----------|
  | inbound_logistics       | 6        | 711  | 8        | 8        |
  | outbound_logistics      | 6        | 12   | 2        | 2        |
  | bom_single_level        | 5        | 2220 | 4        | 4        |
  | bom_multi_level         | 1        | 396  | 0        | 0        |
  | materials               | 6        | 580  | 0        | 0        |
  | products                | 6        | 12   | 0        | 0        |
  | suppliers               | 6        | 117  | 0        | 0        |
  | customers               | 4        | 5    | 0        | 0        |
  | tier2_suppliers         | 0        | 0    | 0        | 0        |
  | tier3_suppliers         | 0        | 0    | 0        | 0        |
  | multi_tier_supply_chain | 0        | 0    | 0        | 0        |
  | node_list               | 6        | 781  | 0        | 0        |
  | network_nodes           | 2        | 2195 | 0        | 0        |
  | network_edges           | 2        | 3087 | 0        | 0        |

**(3) the ingestion tables, per project:**
  | project_id | project             | ingest_runs | csv_runs | applied_runs | ingest_files | ingest_staged_rows |
  |------------|---------------------|-------------|----------|--------------|--------------|--------------------|
  | 8724f960   | Project AA - ver3   | 0           | 0        | 0            | 0            | 0                  |
  | 4a308fec   | Project TRON - ver1 | 0           | 0        | 0            | 0            | 0                  |
  | 16a68569   | Example — 1P/2M/3S  | 0           | 0        | 0            | 0            | 0                  |
  | 6d721b5d   | Aumovio             | 0           | 0        | 0            | 0            | 0                  |
  | 50141cd1   | Test_Simulation     | 10          | 10       | 3            | 10           | 23                 |
  | 3750c886   | Test_MTS            | 3           | 3        | 3            | 3            | 7                  |
- **2 project(s)** hold both a landed file and staged rows — the first half of WP 6.5 (a)'s exit.
  | ingest_runs_total | ingest_files_total | ingest_staged_rows_total | landing_audit_rows |
  |-------------------|--------------------|--------------------------|--------------------|
  | 13                | 13                 | 30                       | 14                 |

**(4) the exit — one tier-2 row per table, resolved through `ingest_value_chain`:**
  | tbl                | traced_rows | has_provenance | source_kind | original_filename | source_row_number | uploaded_by_name | promoted_at                   | run_status |
  |--------------------|-------------|----------------|-------------|-------------------|-------------------|------------------|-------------------------------|------------|
  | bom_single_level   | 4           | true           | csv         | bom_test.csv      | 3                 |                  | 2026-09-29 09:18:32.243211+00 | applied    |
  | inbound_logistics  | 8           | true           | csv         | inbound_test.csv  | 5                 |                  | 2026-09-29 09:18:55.882156+00 | applied    |
  | outbound_logistics | 2           | true           | csv         | outbound_test.csv | 2                 |                  | 2026-09-29 09:19:14.027368+00 | applied    |
- **MET for 3 table(s)**: a tier-2 row names its source file and line through the function the review screen calls.

**(4b) every applied run, and how many of its staged rows a tier-2 row still names:**
  | run      | project         | target_table       | status  | applied_at                    | staged | in_tier2 | held |
  |----------|-----------------|--------------------|---------|-------------------------------|--------|----------|------|
  | f0ebdd47 | Test_Simulation | bom_single_level   | applied | 2026-09-22 21:31:17.312033+00 | 2      | 2        | 0    |
  | 2a56d7a8 | Test_Simulation | inbound_logistics  | applied | 2026-09-22 21:31:45.555541+00 | 4      | 4        | 0    |
  | 46a1c85e | Test_Simulation | outbound_logistics | applied | 2026-09-22 21:32:00.898271+00 | 1      | 1        | 0    |
  | 9102e4ce | Test_MTS        | bom_single_level   | applied | 2026-09-29 09:18:32.243211+00 | 2      | 2        | 0    |
  | b0b2dca6 | Test_MTS        | inbound_logistics  | applied | 2026-09-29 09:18:55.882156+00 | 4      | 4        | 0    |
  | 107e6ed7 | Test_MTS        | outbound_logistics | applied | 2026-09-29 09:19:14.027368+00 | 1      | 1        | 0    |
- Every applied run's staged rows are either held or named by a tier-2 row.

**(4c) every statement that wrote a landable table since `ingest-file` went live** (`audit_logs`, plane `data`):
  | at                            | tbl                | action | rows_after | rows_before | actor                    |
  |-------------------------------|--------------------|--------|------------|-------------|--------------------------|
  | 2026-09-22 21:31:17.312033+00 | bom_single_level   | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:31:45.555541+00 | inbound_logistics  | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:00.898271+00 | outbound_logistics | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | suppliers          | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | products           | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | materials          | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:35:44.45522+00  | bom_single_level   | insert | 271        | 0           | modeler1@gmail.com       |
  | 2026-09-22 21:35:57.271502+00 | bom_single_level   | delete | 0          | 200         | (unknown)                |
  | 2026-09-22 21:35:57.774263+00 | bom_single_level   | delete | 0          | 71          | (unknown)                |
  | 2026-09-22 21:48:37.115589+00 | suppliers          | update | 4          | 4           | SuperUser3@suresuite.com |
  | 2026-09-29 09:18:32.243211+00 | bom_single_level   | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:18:55.882156+00 | inbound_logistics  | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:19:14.027368+00 | outbound_logistics | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:19:26.682099+00 | materials          | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:19:26.682099+00 | products           | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:19:26.682099+00 | suppliers          | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-29 09:42:00.860518+00 | materials          | update | 2          | 2           | SuperUser3@suresuite.com |
  | 2026-09-29 18:02:33.496987+00 | outbound_logistics | delete | 0          | 10          | modeler1@gmail.com       |
  | 2026-09-29 18:02:33.496987+00 | inbound_logistics  | delete | 0          | 123         | modeler1@gmail.com       |
  | 2026-09-29 18:02:33.496987+00 | bom_single_level   | delete | 0          | 95          | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | bom_multi_level    | delete | 0          | 396         | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | inbound_logistics  | delete | 0          | 305         | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | outbound_logistics | delete | 0          | 1           | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | materials          | delete | 0          | 179         | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | products           | delete | 0          | 1           | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | suppliers          | delete | 0          | 32          | modeler1@gmail.com       |
  | 2026-09-29 23:38:59.428801+00 | customers          | delete | 0          | 1           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | bom_single_level   | delete | 0          | 596         | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | inbound_logistics  | delete | 0          | 560         | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | outbound_logistics | delete | 0          | 17          | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | materials          | delete | 0          | 560         | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | products           | delete | 0          | 17          | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | suppliers          | delete | 0          | 60          | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | customers          | delete | 0          | 1           | modeler1@gmail.com       |

**(5) is `ingest-file` published?** (Management API, GET):
- **LIVE** — version 74, status ACTIVE, verify_jwt true, updated 2026-10-04T17:38:49.294Z.
- **(6) `ingest-file` invocations** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`
- **(6) `ingest-file` console** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`
- **(7) `delete-project` invocations** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`
- **(7) `delete-project` console** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`

## (8) §4 D170 — why a deletion still fails after the fix shipped


**(8a) every trigger that fires on a DELETE of a table `delete_project` empties:**
  | tbl                          | trigger                                   | level     | timing | events      | fn                                    | enabled |
  |------------------------------|-------------------------------------------|-----------|--------|-------------|---------------------------------------|---------|
  | bom_multi_level              | audit_bom_multi_level_delete              | statement | after  | del         | audit_tier_write                      | O       |
  | bom_multi_level              | bom_ml_completion_del                     | statement | after  | del         | update_project_completion_stmt        | O       |
  | bom_multi_level              | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | bom_multi_level              | trg_bom_multi_level_rebuild_lanes_del     | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | bom_single_level             | audit_bom_single_level_delete             | statement | after  | del         | audit_tier_write                      | O       |
  | bom_single_level             | bom_sl_completion_del                     | statement | after  | del         | update_project_completion_stmt        | O       |
  | bom_single_level             | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | bom_single_level             | trg_bom_single_level_rebuild_lanes_del    | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | disruption_scenarios         | audit_disruption_scenarios_delete         | statement | after  | del         | audit_tier_write                      | O       |
  | inbound_logistics            | audit_inbound_logistics_delete            | statement | after  | del         | audit_tier_write                      | O       |
  | inbound_logistics            | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | inbound_logistics            | inbound_completion_del                    | statement | after  | del         | update_project_completion_stmt        | O       |
  | inbound_logistics            | trg_inbound_logistics_rebuild_lanes_del   | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | multi_tier_supply_chain      | audit_multi_tier_supply_chain_delete      | statement | after  | del         | audit_tier_write                      | O       |
  | multi_tier_supply_chain      | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | multi_tier_supply_chain      | multi_tier_completion_del                 | statement | after  | del         | update_project_completion_stmt        | O       |
  | network_edges                | aud_network_edges_completion              | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_edges                | audit_network_edges_delete                | statement | after  | del         | audit_tier_write                      | O       |
  | network_edges                | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | network_edges                | update_completion_on_network_edges_change | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_nodes                | aud_network_nodes_completion              | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_nodes                | audit_network_nodes_delete                | statement | after  | del         | audit_tier_write                      | O       |
  | network_nodes                | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | network_nodes                | update_completion_on_network_nodes_change | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | node_list                    | audit_node_list_delete                    | statement | after  | del         | audit_tier_write                      | O       |
  | outbound_logistics           | audit_outbound_logistics_delete           | statement | after  | del         | audit_tier_write                      | O       |
  | outbound_logistics           | graph_state_touch_del                     | statement | after  | del         | _graph_state_touch_del                | O       |
  | outbound_logistics           | outbound_completion_del                   | statement | after  | del         | update_project_completion_stmt        | O       |
  | outbound_logistics           | trg_outbound_logistics_rebuild_lanes_del  | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | supply_chain_data            | audit_supply_chain_data_delete            | statement | after  | del         | audit_tier_write                      | O       |
  | supply_chain_data            | trg_scd_auto_refresh_node_list_del        | statement | after  | del         | auto_refresh_node_list_on_lane_change | O       |
  | supply_chain_data_multi_tier | audit_supply_chain_data_multi_tier_delete | statement | after  | del         | audit_tier_write                      | O       |
  | supply_chain_data_multi_tier | trg_scdmt_auto_refresh_node_list_del      | statement | after  | del         | auto_refresh_node_list_on_lane_change | O       |

**(8b) foreign keys pointing INTO them** (`on_delete`: a=no action, r=restrict, c=cascade, n=set null; an unindexed child makes every parent delete a scan):
  | child                          | parent             | on_delete | child_indexed |
  |--------------------------------|--------------------|-----------|---------------|
  | analysis_runs                  | projects           | c         | true          |
  | bom_multi_level                | projects           | c         | true          |
  | bom_single_level               | projects           | c         | true          |
  | chat_plans                     | projects           | c         | false         |
  | chat_threads                   | projects           | n         | false         |
  | customers                      | projects           | c         | true          |
  | customers                      | projects           | c         | true          |
  | dataset_versions               | projects           | c         | true          |
  | delegation_grants              | projects           | c         | false         |
  | demand_forecasts               | projects           | c         | true          |
  | disruption_scenario_profiles   | projects           | c         | true          |
  | experiments                    | projects           | c         | true          |
  | external_evidence              | projects           | c         | true          |
  | graph_level_versions           | projects           | c         | true          |
  | inbound_logistics              | projects           | c         | true          |
  | ingest_runs                    | projects           | c         | true          |
  | materials                      | projects           | c         | true          |
  | model_validation_evidence      | projects           | c         | false         |
  | model_validations              | projects           | c         | true          |
  | multi_tier_supply_chain        | projects           | c         | true          |
  | network_summary                | projects           | c         | false         |
  | node_list                      | projects           | c         | true          |
  | outbound_logistics             | projects           | c         | true          |
  | policy_defaults                | projects           | c         | true          |
  | policy_overrides               | projects           | c         | true          |
  | policy_versions                | projects           | c         | true          |
  | products                       | projects           | c         | true          |
  | project_erp_links              | projects           | c         | true          |
  | project_graph_state            | projects           | c         | true          |
  | project_members                | projects           | c         | true          |
  | project_memory                 | projects           | c         | true          |
  | proposals                      | projects           | c         | true          |
  | recovery_playbooks             | projects           | c         | true          |
  | run_item_series                | projects           | c         | false         |
  | run_replications               | projects           | c         | false         |
  | run_usage                      | projects           | c         | false         |
  | scenarios                      | projects           | c         | true          |
  | simulation_cache               | projects           | c         | true          |
  | simulation_job_magnitudes      | projects           | c         | true          |
  | simulation_jobs                | projects           | c         | true          |
  | simulation_performance_metrics | projects           | c         | false         |
  | simulation_runs                | projects           | c         | true          |
  | suppliers                      | projects           | c         | true          |
  | supply_chain_data              | projects           | c         | true          |
  | supply_chain_data              | projects           | c         | true          |
  | tier2_suppliers                | projects           | c         | true          |
  | tier3_suppliers                | projects           | c         | true          |
  | user_files                     | projects           | n         | false         |
  | simulation_jobs                | simulation_results | c         | false         |

**(8c) the time budget each role runs under** (`statement_timeout` in `settings`):
  | role          | settings                                                                    |
  |---------------|-----------------------------------------------------------------------------|
  | anon          | {statement_timeout=3s}                                                      |
  | authenticated | {statement_timeout=8s}                                                      |
  | authenticator | {session_preload_libraries=safeupdate,statement_timeout=8s,lock_timeout=8s} |
  | postgres      | {"search_path=\"\\$user\", public, extensions"}                             |
  | service_role  |                                                                             |

**(8d) every project still present, with the rows a deletion must remove:**
  | name                | id                                   | updated                       | nn   | ne   | scd  | scdmt | nl  | bsl  | sr |
  |---------------------|--------------------------------------|-------------------------------|------|------|------|-------|-----|------|----|
  | Aumovio             | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 2026-10-01 21:29:58.341109+00 | 810  | 958  | 2575 | 2575  | 439 | 2202 | 0  |
  | Example — 1P/2M/3S  | 16a68569-5fcb-43ef-b2bc-1dc62a31617e | 2026-09-15 22:21:11.650418+00 | 0    | 0    | 6    | 6     | 7   | 2    | 0  |
  | Project AA - ver3   | 8724f960-b612-4bd5-a010-ab3250849f6a | 2026-09-30 14:17:02.489178+00 | 1385 | 2129 | 501  | 718   | 294 | 0    | 31 |
  | Project TRON - ver1 | 4a308fec-742b-4d43-8dc1-185c5858efad | 2026-09-30 16:29:34.974671+00 | 0    | 0    | 26   | 26    | 25  | 12   | 0  |
  | Test_MTS            | 3750c886-2850-4d7f-b3c5-3d8118c06f2c | 2026-09-29 09:19:14.027368+00 | 0    | 0    | 7    | 7     | 8   | 2    | 0  |
  | Test_Simulation     | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | 2026-09-22 21:32:00.898271+00 | 0    | 0    | 7    | 7     | 8   | 2    | 0  |

**(8e) every delete the audit recorded since `delete-project` was republished (22:47Z):**
  | at                            | tbl                | action           | actor                    |
  |-------------------------------|--------------------|------------------|--------------------------|
  | 2026-10-04 13:38:38.632982+00 | policy_versions    | delete           | modeler1@gmail.com       |
  | 2026-10-04 13:38:29.172061+00 | policy_versions    | delete           | modeler1@gmail.com       |
  | 2026-10-02 22:33:18.450551+00 | scenarios          | delete           | (unknown)                |
  | 2026-10-02 22:33:16.192478+00 | scenarios          | delete           | (unknown)                |
  | 2026-10-02 22:33:13.637845+00 | scenarios          | delete           | (unknown)                |
  | 2026-10-02 22:33:11.079591+00 | scenarios          | delete           | (unknown)                |
  | 2026-10-02 22:33:04.024512+00 | scenarios          | delete           | (unknown)                |
  | 2026-10-02 16:09:30.13011+00  | scenarios          | delete           | (unknown)                |
  | 2026-10-01 21:29:27.13675+00  | network_edges      | delete           | phu.nguyen@hwr-berlin.de |
  | 2026-10-01 21:29:18.626889+00 | network_nodes      | delete           | phu.nguyen@hwr-berlin.de |
  | 2026-10-01 11:37:42.480837+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 22:32:31.470831+00 | scenarios          | delete           | (unknown)                |
  | 2026-09-30 22:32:13.098342+00 | scenarios          | delete           | (unknown)                |
  | 2026-09-30 22:32:10.136589+00 | scenarios          | delete           | (unknown)                |
  | 2026-09-30 22:25:39.176006+00 | policy_overrides   | delete           | phu.nguyen@hwr-berlin.de |
  | 2026-09-30 18:51:03.378093+00 | scenarios          | delete           | (unknown)                |
  | 2026-09-30 18:35:49.997101+00 | policy_versions    | delete           | phu.nguyen@hwr-berlin.de |
  | 2026-09-30 18:35:42.33957+00  | policy_versions    | delete           | phu.nguyen@hwr-berlin.de |
  | 2026-09-30 16:29:34.974671+00 | projects           | project.transfer | modeler1@gmail.com       |
  | 2026-09-30 14:23:01.092648+00 | projects           | project.transfer | modeler1@gmail.com       |
  | 2026-09-30 14:17:02.489178+00 | projects           | project.transfer | modeler1@gmail.com       |
  | 2026-09-30 14:10:57.200293+00 | projects           | project.transfer | modeler1@gmail.com       |
  | 2026-09-30 13:36:36.990615+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 13:36:20.250501+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 13:36:09.167563+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 13:35:58.664107+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 13:35:47.100313+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 13:35:27.211322+00 | approved_users     | user.delete      | modeler1@gmail.com       |
  | 2026-09-30 12:41:39.295437+00 | organizations      | org.delete       | modeler1@gmail.com       |
  | 2026-09-30 12:26:03.558376+00 | organizations      | org.delete       | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | bom_single_level   | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | inbound_logistics  | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | outbound_logistics | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | scenarios          | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | policy_versions    | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | materials          | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | products           | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | suppliers          | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | dataset_versions   | delete           | modeler1@gmail.com       |
  | 2026-09-30 12:25:41.980607+00 | customers          | delete           | modeler1@gmail.com       |
- **(8f) postgres log since the fix deployed** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`

### WP 4.1 — what the `schema_version` bump costs, counted before it happens
<!-- at 2026-10-04T17:39:29.477Z -->

  | dataset_versions | projects_with_a_version | distinct_graph_hashes | projects |
  |------------------|-------------------------|-----------------------|----------|
  | 17               | 6                       | 17                    | 6        |
- Every one of these 17 rows is IMMUTABLE and keeps its stored `snapshot` and `graph_hash`. The bump does not rewrite them; it means the NEXT `snapshot_dataset` call inserts a new version instead of deduping against the latest, which is the intended behaviour and not the cost. The cost is below.
  | runs | runs_bound_to_a_version | runs_with_a_graph_hash | runs_whose_version_is_gone |
  |------|-------------------------|------------------------|----------------------------|
  | 19   | 19                      | 19                     | 0                          |
- Every bound run resolves its version. The bump cannot change this: `dataset_versions` rows are never updated and never deleted by any path this package touches, and the FK is `ON DELETE SET NULL`.
  | proposals | live | live_grounded_on_graph_hash | live_and_fresh_today | already_expired |
  |-----------|------|-----------------------------|----------------------|-----------------|
  | 0         | 0    | 0                           | 0                    | 0               |
- No live proposal is grounded on a `graph_hash`, so the bump expires nothing. The write path exists and is unexercised; the decision costs nothing today and would cost `live_grounded_on_graph_hash` proposals on any day it is not zero.
  | validation_cards | active_cards | active_and_data_fresh_today |
  |------------------|--------------|-----------------------------|
  | 5                | 3            | 3                           |
- 3 active card(s) match their project's hash today and will report `drift: ["data"]` from the deploy onward. **This one is display-only and reversible** — the badge is derived at read time (`useModelValidation`), no column is written, and re-validating clears it.
  | memories | grounded_on_graph_hash |
  |----------|------------------------|
  | 0        | 0                      |
- Display-only and reversible, same as the cards: `useProjectMemory` compares at read time.

### WP 4.1 — the tables the hash starts covering, and the three that hold nothing
<!-- at 2026-10-04T17:39:34.114Z -->

  | tbl                     | rows | projects |
  |-------------------------|------|----------|
  | bom_multi_level         | 396  | 1        |
  | customers               | 5    | 4        |
  | multi_tier_supply_chain | 0    | 0        |
  | tier2_suppliers         | 0    | 0        |
  | tier3_suppliers         | 0    | 0        |
- **`hash_network`'s three tables hold ZERO rows in every project**, which is the settled decision's second clause measured rather than asserted. The half is free to add and is UNEXERCISED until somebody uploads one: a green test on it is not a working path.

### WP 4.1 — did the bump actually reach production?
<!-- at 2026-10-04T17:39:34.956Z -->

  | domain_columns | wp41_functions |
  |----------------|----------------|
  | 2              | 9              |
- Landed: both domain columns and all nine functions are present.
  | project_id                           | schema_version | has_inputs | has_network | inputs_hash | network_hash |
  |--------------------------------------|----------------|------------|-------------|-------------|--------------|
  | 8724f960-b612-4bd5-a010-ab3250849f6a | 3              | true       | true        | true        | true         |
  | 4a308fec-742b-4d43-8dc1-185c5858efad | 3              | true       | true        | true        | true         |
  | 16a68569-5fcb-43ef-b2bc-1dc62a31617e | 3              | true       | true        | true        | true         |
  | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 3              | true       | true        | true        | true         |
  | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | 3              | true       | true        | true        | true         |
- Every project builds a v3 snapshot with both domains, and both domain hashes compute.
  | versions | pre_bump_still_matching | post_bump_matching_expected | without_domain_hashes |
  |----------|-------------------------|-----------------------------|-----------------------|
  | 17       | 0                       | 5                           | 3                     |
- 5 POST-bump version(s) match their project's current
  hash, which is correct: a v2 version on a project nobody has edited since
  should match. This row used to be counted as a failure.
- All 17 version(s) read dirty against the live project, and 3 carry no domain hashes — correct and not backfillable: a v1 snapshot has no `network` domain. The next freeze on each project writes all three.

### WP 4.1 — D36's six PostgREST writers, as the audit log holds them
<!-- at 2026-10-04T17:39:38.255Z -->

  | target_type                  | action            | rows  | actor_known | actor_unknown |
  |------------------------------|-------------------|-------|-------------|---------------|
  | supply_chain_data            | update            | 10303 | 3           | 10300         |
  | network_nodes                | update            | 2272  | 6           | 2266          |
  | scenarios                    | update            | 307   | 2           | 305           |
  | scenarios                    | insert            | 45    | 0           | 45            |
  | scenarios                    | delete            | 38    | 1           | 37            |
  | graph_level_versions         | insert            | 32    | 7           | 25            |
  | dataset_versions             | update            | 28    | 6           | 22            |
  | policy_defaults              | update            | 20    | 7           | 13            |
  | dataset_versions             | insert            | 14    | 4           | 10            |
  | project_graph_state          | insert            | 6     | 0           | 6             |
  | policy_overrides             | delete            | 21    | 17          | 4             |
  | products                     | update            | 3     | 0           | 3             |
  | project_graph_state          | update            | 4364  | 4361        | 3             |
  | bom_single_level             | delete            | 4     | 2           | 2             |
  | node_list                    | delete            | 5     | 3           | 2             |
  | policy_overrides             | insert            | 18    | 16          | 2             |
  | policy_overrides             | update            | 15    | 13          | 2             |
  | policy_versions              | update            | 7     | 5           | 2             |
  | analysis_runs                | update            | 15    | 14          | 1             |
  | bom_multi_level              | delete            | 2     | 1           | 1             |
  | customers                    | insert            | 1     | 0           | 1             |
  | graph_level_versions         | update            | 1     | 0           | 1             |
  | inbound_logistics            | delete            | 4     | 3           | 1             |
  | materials                    | insert            | 3     | 2           | 1             |
  | model_validations            | update            | 2     | 1           | 1             |
  | network_nodes                | insert            | 2431  | 2430        | 1             |
  | node_list                    | update            | 28    | 27          | 1             |
  | policy_defaults              | delete            | 8     | 7           | 1             |
  | policy_overrides             | remediate         | 1     | 0           | 1             |
  | products                     | insert            | 3     | 2           | 1             |
  | suppliers                    | insert            | 3     | 2           | 1             |
  | tier2_lane_tables            | natural_key_dedup | 1     | 0           | 1             |
  | analysis_results             | insert            | 12    | 12          | 0             |
  | analysis_runs                | insert            | 13    | 13          | 0             |
  | bom_single_level             | insert            | 3     | 3           | 0             |
  | customers                    | delete            | 2     | 2           | 0             |
  | dataset_versions             | delete            | 1     | 1           | 0             |
  | disruption_scenario_effects  | delete            | 1     | 1           | 0             |
  | disruption_scenario_profiles | delete            | 2     | 2           | 0             |
  | disruption_scenario_settings | delete            | 1     | 1           | 0             |
- **13063 data-plane row(s) record `actor_known: false`.** That is honest and it is not attribution (§2.1 `audit-actor`). This package moves the six PostgREST writes into RPCs that take the actor as a parameter; the after-run is how we find out whether the number moved for a path anyone actually ran.

### WP 4.2 — the four DERIVED tables, and D19 as a quantity
<!-- at 2026-10-04T17:39:39.372Z -->

  | tbl             | rows | projects | rows_with_computed | rows_geocoded |
  |-----------------|------|----------|--------------------|---------------|
  | node_list       | 781  | 6        | 0                  | 33            |
  | network_nodes   | 2195 | 2        | 2195               | 1960          |
  | network_edges   | 3087 | 2        | 0                  | 0             |
  | network_summary | 0    | 0        | 0                  | 0             |

- **6063 row(s) across the four tables, 2195 of them carrying at least one COMPUTED column and NONE of them carrying an input hash** — no tier-3 table has `computed_from_hash` yet. That is D19 as a number rather than an adjective, and it is WP 4.3's before-figure.
  | project             | node_list | network_nodes | network_edges | network_summary | nodes_with_metrics |
  |---------------------|-----------|---------------|---------------|-----------------|--------------------|
  | Project AA - ver3   | 294       | 1385          | 2129          | 0               | 1385               |
  | Project TRON - ver1 | 25        | 0             | 0             | 0               | 0                  |
  | Example — 1P/2M/3S  | 7         | 0             | 0             | 0               | 0                  |
  | Aumovio             | 439       | 810           | 958           | 0               | 0                  |
  | Test_Simulation     | 8         | 0             | 0             | 0               | 0                  |
  | Test_MTS            | 8         | 0             | 0             | 0               | 0                  |
  | tbl               | audit_triggers |
  |-------------------|----------------|
  | external_evidence | 0              |
  | model_validations | 0              |
  | network_edges     | 0              |
  | network_nodes     | 0              |
  | network_summary   | 0              |
  | node_list         | 0              |

- **6 of 6 carry no `audit_tier_write` trigger.** They are outside the contract, therefore outside `dataPlaneAudit.test.ts`'s rule, therefore their writes are unattributable with nothing to notice. That is D54 measured rather than described.

### WP 4.2 — did the analysis store reach production?
<!-- at 2026-10-04T17:39:42.267Z -->

  | store_tables | store_functions | partial_unique_key | audit_triggers |
  |--------------|-----------------|--------------------|----------------|
  | 2            | 5               | 1                  | 6              |
- Landed: both tables, all five functions, the partial unique key and all six audit triggers.
  | definition                                                                                                                                                                         |
  |------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | CREATE UNIQUE INDEX analysis_runs_key_uniq ON public.analysis_runs USING btree (project_id, analysis_kind, input_hash, params_hash, code_version) WHERE (status <> 'failed'::text) |
  | runs | results | projects | runs_with_no_actor |
  |------|---------|----------|--------------------|
  | 13   | 9437    | 5        | 0                  |
  | rows | null_uid | rows_a_unique_index_would_reject | duplicated_keys |
  |------|----------|----------------------------------|-----------------|
  | 2195 | 0        | 0                                | 0               |

- **0 row(s) across 0 duplicated key(s)** would be rejected by the unique index `calculate-network-science-metrics:115` already names in its `onConflict`. Until it exists that upsert raises `42P10` on every run, the handler logs and carries on, and the per-node update loop then matches nothing (D72). `null_uid` is 0 — a nullable key column means the index must be `NULLS NOT DISTINCT` or it constrains every row except those (D5).

### WP 4.3 / 4.4 — provenance coverage, and D70's realised damage
<!-- at 2026-10-04T17:39:46.152Z -->

  | tbl               | rows | no_provenance | projects |
  |-------------------|------|---------------|----------|
  | network_nodes     | 2195 | 0             | 2        |
  | network_summary   | 0    | 0             | 0        |
  | node_list         | 781  | 781           | 6        |
  | supply_chain_data | 3122 | 514           | 6        |
- **1295 of 6098** derived row(s) carry NO input hash. Those are rows
  written before WP 4.3, and nothing can say whether they are current — the
  freshness badge reports them as `unknown`, which is not the same as stale.
- This is the size of what WP 5.3 cannot migrate: dropping the entity columns
  loses these values with no `analysis_results` row to replace them.
  | expired_for_drift | projects | earliest | latest |
  |-------------------|----------|----------|--------|
  | 0                 | 0        |          |        |
- **Zero.** D70 was closed before it cost anything, which is what WP 4.1's
  measure-before-the-bump discipline bought.
  | live_grounded_on_graph_hash | projects |
  |-----------------------------|----------|
  | 0                           | 0        |
- **Zero.** WP 5.3 can take the bump for the same reason WP 4.1 could.
  | key_present | null_uid |
  |-------------|----------|
  | 1           | 0        |

### §15 · WP 6.2 / 6.4 — before the cascade, and the catalog nothing reads
<!-- at 2026-10-04T17:39:50.715Z -->

  | tbl                       | orphan_rows |
  |---------------------------|-------------|
  | customers                 | 0           |
  | network_summary           | 0           |
  | policy_defaults           | 0           |
  | policy_overrides          | 0           |
  | simulation_job_magnitudes | 0           |
  | tier2_suppliers           | 0           |
  | tier3_suppliers           | 0           |
- **0 row(s)** belong to a project that has been deleted. No screen can
  reach them — every read is `WHERE project_id = <a project you can open>` —
  and nothing has ever removed them.
- `policy_defaults` and `policy_overrides` are the sharp ones: those rows are
  the decisions a user typed into the grid.
- `20260919000005` deletes exactly these and then adds seven `ON DELETE CASCADE`
  keys, so the same query must return 0 everywhere after the merge.
  | rows | system_rows | slugs | user_rows |
  |------|-------------|-------|-----------|
  | 7    | 7           | 7     | 0         |
- **7 row(s)** are seeded here and NO code reads them: not `src/`, not an
  RPC, not an edge function. The presets a user applies are compiled into the
  bundle under `src/lib/policies/presets/`, so this catalog cannot be edited
  into effect — changing a preset needs a deploy.
  | tbl                | rows |
  |--------------------|------|
  | external_evidence  | 0    |
  | policy_presets     | 7    |
  | policy_versions    | 44   |
  | recovery_playbooks | 7    |
  | scenario_templates | 12   |
  | scenarios          | 15   |
- Every one of these is now described, governed and audited by three triggers.
- A table with 0 rows here is not a finding on its own: `external_evidence` fills
  only when an agent has run, and `policy_presets` is D126's subject.

### WP 8.0 — the graph layer, measured before it is changed (D127–D133)
<!-- at 2026-10-04T17:39:53.410Z -->

  | project             | bom_level | bom_single | bom_multi | max_bom_depth | inbound | outbound | scd_rows | scdmt_rows |
  |---------------------|-----------|------------|-----------|---------------|---------|----------|----------|------------|
  | Project AA - ver3   | multi     | 0          | 396       | 4             | 321     | 1        | 501      | 718        |
  | Project TRON - ver1 | single    | 12         | 0         | 0             | 12      | 2        | 26       | 26         |
  | Example — 1P/2M/3S  | single    | 2          | 0         | 0             | 3       | 1        | 6        | 6          |
  | Aumovio             | single    | 2202       | 0         | 0             | 367     | 6        | 2575     | 2575       |
  | Test_Simulation     | single    | 2          | 0         | 0             | 4       | 1        | 7        | 7          |
  | Test_MTS            | single    | 2          | 0         | 0             | 4       | 1        | 7        | 7          |

- **5 of 6 project(s) are `bom_level = 'single'`**, and 0 of those hold ZERO `supply_chain_data_multi_tier` rows. That was **D130**: the edge function built the multi-tier lanes only inside its multi-level branch, so a single-level project's Process-level page was permanently empty and no error said why. **WP 8.2 CLOSED IT IN THE WRITER, AND A NON-ZERO COUNT HERE IS NOT THE EXIT CHECK** — the surviving ETL never reads `projects.bom_level` and builds both lanes from whichever BOM rows exist, but it changed what a combine WRITES and backfilled nothing. A single-level project still reads ZERO here until somebody presses Combine on it. **This line measures ADOPTION, not the fix**, which is the distinction §4 D88 cost three packages to learn.
- **5 single-level project(s) DO hold multi-tier rows**, which the current ETL cannot produce — they predate a change, or were written by another path. Read them before WP 8.2 backfills the lane, because a backfill that assumes the table is empty would double the graph.
- **1 project(s) have a multi-level BOM at all; 1 of them are exactly 4 levels deep.** `ProcessLevelNetwork.tsx`'s ladder calls level 5 a supplier and the inbound lane writes `max BOM depth + 1`, so the ladder is right on the 4-deep ones and wrong on every other one — suppliers there are rendered and labelled `material level N`. That is **D127** as a count of affected projects.
  | project             | data_source | level | rows | distinct_from | distinct_to |
  |---------------------|-------------|-------|------|---------------|-------------|
  | Aumovio             | bom         | 1     | 2202 | 367           | 6           |
  | Aumovio             | inbound     | 1     | 367  | 65            | 367         |
  | Aumovio             | outbound    | 0     | 6    | 6             | 1           |
  | Example — 1P/2M/3S  | bom         | 1     | 2    | 2             | 1           |
  | Example — 1P/2M/3S  | inbound     | 1     | 3    | 3             | 2           |
  | Example — 1P/2M/3S  | outbound    | 0     | 1    | 1             | 1           |
  | Project AA - ver3   | bom         | 0     | 2    | 2             | 1           |
  | Project AA - ver3   | bom         | 1     | 5    | 5             | 2           |
  | Project AA - ver3   | bom         | 2     | 29   | 29            | 5           |
  | Project AA - ver3   | bom         | 3     | 45   | 45            | 29          |
  | Project AA - ver3   | bom         | 4     | 315  | 179           | 29          |
  | Project AA - ver3   | inbound     | 4     | 16   | 1             | 16          |
  | Project AA - ver3   | inbound     | 5     | 305  | 32            | 179         |
  | Project AA - ver3   | outbound    | 0     | 1    | 1             | 1           |
  | Project TRON - ver1 | bom         | 1     | 12   | 12            | 2           |
  | Project TRON - ver1 | inbound     | 1     | 12   | 9             | 12          |
  | Project TRON - ver1 | outbound    | 0     | 2    | 2             | 2           |
  | Test_MTS            | bom         | 1     | 2    | 2             | 1           |
  | Test_MTS            | inbound     | 2     | 4    | 4             | 2           |
  | Test_MTS            | outbound    | 0     | 1    | 1             | 1           |
  | Test_Simulation     | bom         | 1     | 2    | 2             | 1           |
  | Test_Simulation     | inbound     | 2     | 4    | 4             | 2           |
  | Test_Simulation     | outbound    | 0     | 1    | 1             | 1           |

- The inbound lane — every row of which is a SUPPLIER edge by construction — occupies level(s) **1, 2, 4, 5**. The ladder recognises a supplier at 5 and above only. Any other value in that list is a supplier the page types as a material.
  | tbl                          | project             | to_empty | to_null | from_empty | from_null | bom_level_1_rows |
  |------------------------------|---------------------|----------|---------|------------|-----------|------------------|
  | supply_chain_data            | Aumovio             | 0        | 0       | 0          | 0         | 2202             |
  | supply_chain_data            | Example — 1P/2M/3S  | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data            | Project AA - ver3   | 0        | 0       | 0          | 0         | 179              |
  | supply_chain_data            | Project TRON - ver1 | 0        | 0       | 0          | 0         | 12               |
  | supply_chain_data            | Test_MTS            | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data            | Test_Simulation     | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data_multi_tier | Aumovio             | 0        | 0       | 0          | 0         | 2202             |
  | supply_chain_data_multi_tier | Example — 1P/2M/3S  | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data_multi_tier | Project AA - ver3   | 0        | 0       | 0          | 0         | 5                |
  | supply_chain_data_multi_tier | Project TRON - ver1 | 0        | 0       | 0          | 0         | 12               |
  | supply_chain_data_multi_tier | Test_MTS            | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data_multi_tier | Test_Simulation     | 0        | 0       | 0          | 0         | 2                |

- **No empty endpoints.** Either the BOM roots reach the product already, or no project has a level-1 BOM row for the defect to act on — the `bom_level_1_rows` column above says which, and a zero there makes D129 latent rather than absent.
  | project             | nodes | nodes_at_many_levels | nodes_in_many_lanes | rows_behind_them | worst_level_spread |
  |---------------------|-------|----------------------|---------------------|------------------|--------------------|
  | Aumovio             | 439   | 6                    | 373                 | 2208             | 2                  |
  | Example — 1P/2M/3S  | 7     | 1                    | 3                   | 3                | 2                  |
  | Project AA - ver3   | 294   | 261                  | 196                 | 1161             | 2                  |
  | Project TRON - ver1 | 25    | 2                    | 14                  | 14               | 2                  |
  | Test_MTS            | 8     | 3                    | 3                   | 9                | 2                  |
  | Test_Simulation     | 8     | 3                    | 3                   | 9                | 2                  |

- **276 node(s) appear at more than one `level`.** For every one of them the page's node map is written by whichever row the loop reached last — its level, its type, its lane and its colour. The guard meant to prevent that tests a key the map is never keyed by, so it has never fired once. `levelNodeCounts` is incremented in the same unreachable-guard block, which is why the legend counts and the "BOM levels" tile count ROWS rather than nodes: **D128**.
  | project             | nodes | supplier_and_customer | supplier_and_material | material_and_product | any_dual_role |
  |---------------------|-------|-----------------------|-----------------------|----------------------|---------------|
  | Aumovio             | 439   | 0                     | 0                     | 0                    | 0             |
  | Example — 1P/2M/3S  | 7     | 0                     | 0                     | 0                    | 0             |
  | Project AA - ver3   | 229   | 0                     | 0                     | 0                    | 0             |
  | Project TRON - ver1 | 25    | 0                     | 0                     | 0                    | 0             |
  | Test_MTS            | 8     | 0                     | 0                     | 0                    | 0             |
  | Test_Simulation     | 8     | 0                     | 0                     | 0                    | 0             |

- **0 node(s) hold more than one lane role**, and each one is where the classifiers diverge by construction: `classify_node_type` resolves a supplier-and-material node to `material` by its priority order, `ProductLevelNetwork` resolves it to A or B depending on which row it read last, `ProcessLevelNetwork` resolves it to `supplier` through its `inbound` override, and `MapView`'s binary supplier-else-customer test drops it from the map. Same node, four answers, one screen apart (**D127**).
- 0 are BOTH a supplier and a customer — **D131**: identity is a bare string with no role in it, so the two collapse into one node. 0 are a supplier and a material; 0 are a material and a product, which is the `subassembly` the SQL classifier has no value for and WP 8.1 adds.
  | project             | node_list_rows | scd_nodes | scdmt_nodes | scdmt_nodes_untyped | node_list_untyped |
  |---------------------|----------------|-----------|-------------|---------------------|-------------------|
  | Project AA - ver3   | 294            | 229       | 294         | 0                   | 0                 |
  | Project TRON - ver1 | 25             | 25        | 25          | 0                   | 0                 |
  | Example — 1P/2M/3S  | 7              | 7         | 7           | 0                   | 0                 |
  | Aumovio             | 439            | 439       | 439         | 0                   | 0                 |
  | Test_Simulation     | 8              | 8         | 8           | 0                   | 0                 |
  | Test_MTS            | 8              | 8         | 8           | 0                   | 0                 |

- **0 multi-tier node(s) have no `node_list` row.** `rebuild_node_list` reads `supply_chain_data` and nothing else, so the deep-tier half of the graph — the half Process-level renders — is outside the one typed projection this repository has. That is **D132**, and it is why WP 8.1's derivation has to read both edge tables before WP 8.3 can make a page read a type instead of guessing one.
- 0 `node_list` row(s) are typed `unknown` or NULL. `classify_node_type` returns `unknown` when a node appears in no lane it recognises, and `ProductLevelNetwork.tsx` defaults an unrecognised group to **Supplier** rather than rendering it as unknown — a value displayed for data that does not carry it, which is T1.
  | scd_rows | scd_group_written | scdmt_rows | scdmt_level_null | scdmt_level_zero | depth_alias_broken |
  |----------|-------------------|------------|------------------|------------------|--------------------|
  | 3122     |                   | 4090       | 0                | 15               | 3358               |

- **Shape measured:** `data_source_group` is GONE, `bom_depth` EXISTS. WP 8.2 drops the first and adds the second, and its migrations deploy on MERGE — so a report taken from a feature branch measures the schema WITHOUT them, and this line says which one this run saw rather than leaving it to be inferred.
- **`data_source_group` is gone, with its contract claim, and that closes D133.** It was written on 0 of 5 445 rows while its sidecar told readers the network pages filter on it. Writing it was the worse of the two outcomes D133 allowed: `data_source` holds three values and a "coarser grouping" of three is not a grouping.
- **0 row(s) carry a NULL `level`** and 15 carry 0. The read path no longer substitutes 0 for a NULL (D134 closed by WP 8.2), so a NULL here now reaches the page as a NULL. **A non-zero count is no longer a defect — it is an unknown depth arriving as unknown**, which is what the column is for.
- **3358 row(s) have `level` different from `bom_depth`.** `level` is supposed to be a deprecated ALIAS carrying the same value. Something wrote one without the other, and every page still reading `level` is reading a value the honest column disagrees with.
- **AND THE ROWS THIS DEPLOY DID NOT FIX ARE THE POINT.** WP 8.2 changed what a combine WRITES, not what is stored: every project still holds the graph its last combine produced, at whatever `level` that writer meant. `Project AA - ver3` needs Combine re-run. Probe 8's histogram is where to check it.

### WP 8.0 — WHICH ETL wrote this graph, and what it invented (D140, D141)
<!-- at 2026-10-04T17:40:00.890Z -->

  | project             | bom_table_max_depth | bom_table_depths | lane_bom_levels | lane_inbound_levels |
  |---------------------|---------------------|------------------|-----------------|---------------------|
  | Project AA - ver3   | 4                   | 5                | 0,1,2,3,4       | 4,5                 |
  | Project TRON - ver1 | 0                   | 0                | 1               | 1                   |
  | Example — 1P/2M/3S  | 0                   | 0                | 1               | 1                   |
  | Aumovio             | 0                   | 0                | 1               | 1                   |
  | Test_Simulation     | 0                   | 0                | 1               | 2                   |
  | Test_MTS            | 0                   | 0                | 1               | 2                   |

- **0 project(s) have a multi-depth BOM whose entire bom lane sits at level 2**, and 1 carry a ladder of several levels. Those are the two ETLs' fingerprints: the SQL RPC writes a LITERAL `2` for every `bom_multi_level` row and the edge function writes `row.level || 1`, so the histogram says which one last ran — and a page reading a fixed echelon ladder is reading a column whose meaning depends on that. **D140**: two live writers, one column, two definitions.
- The `lane_inbound_levels` column is the same story on the other lane. Both writers use a `max BOM depth + 1` shape there, so a material absent from `bom_multi_level` lands at **1** and one at depth 4 lands at **5** — two suppliers, four levels apart, in the same upload. The page's ladder calls the first a material.
  | project             | scdmt_root_edges | scd_root_edges | node_list_root | bom_roots |
  |---------------------|------------------|----------------|----------------|-----------|
  | Project AA - ver3   | 0                | 0              | 0              | 0         |
  | Project TRON - ver1 | 0                | 0              | 0              | 0         |
  | Example — 1P/2M/3S  | 0                | 0              | 0              | 0         |
  | Aumovio             | 0                | 0              | 0              | 0         |
  | Test_Simulation     | 0                | 0              | 0              | 0         |
  | Test_MTS            | 0                | 0              | 0              | 0         |

- **No `ROOT` edges.** The substitution is in the live RPC and has produced nothing measurable — either no project has a parentless BOM row (the `bom_roots` column says: 0 across all projects), or the lane predates it. A zero here makes D141 latent, not absent: the `COALESCE` is still what the next parentless row meets.
- 0 `bom_multi_level` row(s) have no parent at all, which is how many finished-product edges the two writers have to get right. The edge function drops them (the demand walk finds no parent, so the child gets no root and the row is never emitted); the RPC points them at `ROOT`. **Neither writes the product** — which is D129, restated against what the data actually shows rather than against the `|| ''` a reader sees first.
  | project             | inbound_src | inbound_lane | outbound_src | outbound_lane | bom_src | bom_lane | lane_written                  | inbound_touched               |
  |---------------------|-------------|--------------|--------------|---------------|---------|----------|-------------------------------|-------------------------------|
  | Project AA - ver3   | 321         | 321          | 1            | 1             | 396     | 396      | 2026-09-29 10:57:50.255426+00 | 2026-07-05 20:22:45.213329+00 |
  | Project TRON - ver1 | 12          | 12           | 2            | 2             | 12      | 12       | 2026-06-12 18:50:18.412521+00 | 2026-06-12 18:50:03.886856+00 |
  | Example — 1P/2M/3S  | 3           | 3            | 1            | 1             | 2       | 2        | 2026-07-12 02:00:12.353602+00 | 2026-07-12 02:00:12.167048+00 |
  | Aumovio             | 367         | 367          | 6            | 6             | 2202    | 2202     | 2026-09-15 16:55:01.594943+00 | 2026-09-15 16:53:35.539218+00 |
  | Test_Simulation     | 4           | 4            | 1            | 1             | 2       | 2        | 2026-09-22 21:32:00.898271+00 | 2026-09-22 21:31:45.555541+00 |
  | Test_MTS            | 4           | 4            | 1            | 1             | 2       | 2        | 2026-09-29 09:19:14.027368+00 | 2026-09-29 09:18:55.882156+00 |

- Every non-empty inbound lane matches its source row count. That does not make the lane fresh — a same-size edit moves no count — but it removes the largest and cheapest explanation.
- `lane_written` beside `inbound_touched` is the direct comparison. A source touched AFTER the lane was written is a graph derived from data that has since changed, and `project_freshness` is shown on Product-level and on no other network page.

### §15 · WP 7.1 stage 0 — the access surface, from the live database
<!-- at 2026-10-04T17:40:04.285Z -->

  | policies | tables | no_predicate | no_predicate_write | via_guc | via_auth_uid |
  |----------|--------|--------------|--------------------|---------|--------------|
  | 176      | 87     | 52           | 15                 | 55      | 13           |
- **52 of 176** policies refuse nothing: no USING and no
  WITH CHECK, or one that is literally `true`. Those are what makes the product
  work while it runs as `anon`, and stage 3 is what replaces them.
- **55** name the GUC path (`get_current_user_id` /
  `app.current_user_id`) and **13** name `auth.uid()`. The first
  number is the size of what stage 2's re-ordering has to keep working; the
  second is how much of the schema already speaks the language stage 1 issues.
- **Compare all of these with §14's counts from migration history.** A difference
  is not an error in either place — it is a policy or grant that moved outside a
  migration, and it is the reason this stage exists (D43's class).
  | tablename                 | no_predicate_policies | commands       |
  |---------------------------|-----------------------|----------------|
  | ai_models                 | 1                     | SELECT         |
  | ai_providers              | 1                     | SELECT         |
  | analysis_kinds            | 1                     | SELECT         |
  | bom_multi_level           | 2                     | SELECT         |
  | bom_single_level          | 2                     | SELECT         |
  | capabilities              | 1                     | SELECT         |
  | chat_plans                | 1                     | SELECT         |
  | customers                 | 2                     | ALL, SELECT    |
  | dataset_versions          | 1                     | SELECT         |
  | docs_section_releases     | 1                     | SELECT         |
  | experiments               | 1                     | ALL            |
  | external_evidence         | 1                     | SELECT         |
  | inbound_logistics         | 2                     | SELECT         |
  | materials                 | 2                     | ALL, SELECT    |
  | model_validations         | 1                     | SELECT         |
  | outbound_logistics        | 2                     | SELECT         |
  | plan_role_allowances      | 1                     | SELECT         |
  | policy_defaults           | 2                     | SELECT         |
  | policy_overrides          | 2                     | SELECT         |
  | policy_presets            | 1                     | SELECT         |
  | policy_versions           | 3                     | INSERT, SELECT |
  | products                  | 2                     | ALL, SELECT    |
  | project_memory            | 1                     | SELECT         |
  | project_role_capabilities | 1                     | SELECT         |
  | proposals                 | 1                     | SELECT         |
  | recovery_playbooks        | 1                     | SELECT         |
  | risk_data                 | 2                     | SELECT         |
  | role_capabilities         | 1                     | SELECT         |
  | run_item_series           | 2                     | ALL            |
  | run_replications          | 2                     | ALL            |
  | scenarios                 | 2                     | ALL            |
  | sim_engine_builds         | 1                     | SELECT         |
  | sim_engines               | 1                     | SELECT         |
  | simulation_runs           | 2                     | ALL            |
  | suppliers                 | 2                     | ALL, SELECT    |
- **35 table(s).** `governanceEnforcement.test.ts` pins a list of 27 read
  from the migrations; this is the same question asked of production.
- Stage 3 adds ONE restrictive policy per table here. A restrictive policy ANDs
  with whatever is already present, so `DROP POLICY` is an exact undo — which is
  why the plan prefers it to rewriting each permissive policy in place.
  | grantee       | select_on | write_privs | writable_tables |
  |---------------|-----------|-------------|-----------------|
  | anon          | 98        | 293         | 98              |
  | authenticated | 100       | 295         | 99              |
  | service_role  | 102       | 302         | 101             |
- `anon` is the role this product runs as. Its `writable_tables` is what stage 4
  revokes, one table per push, with a read either side.
- A `PUBLIC` row here would be the widest finding on the page: a grant to PUBLIC
  reaches every role including `anon`, and revoking it from `anon` alone would
  change nothing at all.
  | table_name                       | privs                  |
  |----------------------------------|------------------------|
  | admin_org_file_usage             | DELETE, INSERT, UPDATE |
  | ai_budgets                       | DELETE, INSERT, UPDATE |
  | ai_chat_events                   | DELETE, INSERT, UPDATE |
  | ai_model_capabilities            | DELETE, INSERT, UPDATE |
  | ai_models                        | DELETE, INSERT, UPDATE |
  | ai_providers                     | DELETE, INSERT, UPDATE |
  | ai_usage_logs                    | DELETE, INSERT, UPDATE |
  | analysis_kinds                   | DELETE, INSERT, UPDATE |
  | analysis_results                 | DELETE, INSERT, UPDATE |
  | analysis_runs                    | DELETE, INSERT, UPDATE |
  | api_idempotency                  | DELETE, INSERT, UPDATE |
  | api_keys                         | DELETE, INSERT, UPDATE |
  | api_rate_limits                  | DELETE, INSERT, UPDATE |
  | api_request_logs                 | DELETE, INSERT, UPDATE |
  | audit_logs                       | DELETE, INSERT, UPDATE |
  | bom_multi_level                  | DELETE, INSERT, UPDATE |
  | bom_single_level                 | DELETE, INSERT, UPDATE |
  | capabilities                     | DELETE, INSERT, UPDATE |
  | chat_folders                     | DELETE, INSERT, UPDATE |
  | chat_messages                    | DELETE, INSERT, UPDATE |
  | chat_plans                       | DELETE, INSERT, UPDATE |
  | chat_threads                     | DELETE, INSERT, UPDATE |
  | customers                        | DELETE, INSERT, UPDATE |
  | dataset_versions                 | DELETE, UPDATE         |
  | delegation_grants                | DELETE, INSERT, UPDATE |
  | demand_forecasts                 | DELETE, INSERT, UPDATE |
  | disruption_scenario_effects      | DELETE, INSERT, UPDATE |
  | disruption_scenario_profiles     | DELETE, INSERT, UPDATE |
  | disruption_scenario_settings     | DELETE, INSERT, UPDATE |
  | disruption_scenario_targets      | DELETE, INSERT, UPDATE |
  | disruption_scenarios             | DELETE, INSERT, UPDATE |
  | docs_faq                         | DELETE, INSERT, UPDATE |
  | docs_section_releases            | DELETE, INSERT, UPDATE |
  | experiments                      | DELETE, INSERT, UPDATE |
  | external_evidence                | DELETE, INSERT, UPDATE |
  | inbound_logistics                | DELETE, INSERT, UPDATE |
  | ingest_files                     | DELETE, INSERT, UPDATE |
  | ingest_runs                      | DELETE, INSERT, UPDATE |
  | ingest_staged_bom_lines          | DELETE, INSERT, UPDATE |
  | ingest_staged_bom_versions       | DELETE, INSERT, UPDATE |
  | ingest_staged_products           | DELETE, INSERT, UPDATE |
  | ingest_staged_rows               | DELETE, INSERT, UPDATE |
  | materials                        | DELETE, INSERT, UPDATE |
  | model_validation_evidence        | DELETE, INSERT, UPDATE |
  | model_validations                | DELETE, INSERT, UPDATE |
  | multi_tier_supply_chain          | DELETE, INSERT, UPDATE |
  | network_edges                    | DELETE, INSERT, UPDATE |
  | network_nodes                    | DELETE, INSERT, UPDATE |
  | network_summary                  | DELETE, INSERT, UPDATE |
  | node_list                        | DELETE, INSERT, UPDATE |
  | org_capabilities                 | DELETE, INSERT, UPDATE |
  | organization_members             | DELETE, INSERT, UPDATE |
  | organizations                    | DELETE, INSERT, UPDATE |
  | outbound_logistics               | DELETE, INSERT, UPDATE |
  | plan_role_allowances             | DELETE, INSERT, UPDATE |
  | policy_defaults                  | DELETE, INSERT, UPDATE |
  | policy_overrides                 | DELETE, INSERT, UPDATE |
  | policy_presets                   | DELETE, INSERT, UPDATE |
  | policy_versions                  | DELETE, INSERT, UPDATE |
  | products                         | DELETE, INSERT, UPDATE |
  | project_erp_links                | DELETE, INSERT, UPDATE |
  | project_graph_state              | DELETE, INSERT, UPDATE |
  | project_members                  | DELETE, INSERT, UPDATE |
  | project_memory                   | DELETE, INSERT, UPDATE |
  | project_role_capabilities        | DELETE, INSERT, UPDATE |
  | projects                         | DELETE, INSERT, UPDATE |
  | proposals                        | DELETE, INSERT, UPDATE |
  | recovery_playbooks               | DELETE, INSERT, UPDATE |
  | risk_data                        | DELETE, INSERT, UPDATE |
  | role_capabilities                | DELETE, INSERT, UPDATE |
  | run_item_series                  | DELETE, INSERT, UPDATE |
  | run_replications                 | DELETE, INSERT, UPDATE |
  | run_series_orphans               | DELETE, INSERT, UPDATE |
  | run_usage                        | DELETE, INSERT, UPDATE |
  | sc_edges                         | DELETE, INSERT, UPDATE |
  | sc_nodes                         | DELETE, INSERT, UPDATE |
  | scenario_templates               | DELETE, INSERT, UPDATE |
  | scenarios                        | DELETE, INSERT, UPDATE |
  | sim_engine_builds                | DELETE, INSERT, UPDATE |
  | sim_engines                      | DELETE, INSERT, UPDATE |
  | simulation_cache                 | DELETE, INSERT, UPDATE |
  | simulation_job_magnitudes        | DELETE, INSERT, UPDATE |
  | simulation_jobs                  | DELETE, INSERT, UPDATE |
  | simulation_performance_metrics   | DELETE, INSERT, UPDATE |
  | simulation_result_scenarios      | DELETE, INSERT, UPDATE |
  | simulation_results               | DELETE, INSERT, UPDATE |
  | simulation_results_with_settings | DELETE, INSERT, UPDATE |
  | simulation_runs                  | DELETE, INSERT, UPDATE |
  | suppliers                        | DELETE, INSERT, UPDATE |
  | supply_chain_data                | DELETE, INSERT, UPDATE |
  | supply_chain_data_multi_tier     | DELETE, INSERT, UPDATE |
  | surrogate_training_runs          | DELETE, INSERT, UPDATE |
  | tier2_suppliers                  | DELETE, INSERT, UPDATE |
  | tier3_suppliers                  | DELETE, INSERT, UPDATE |
  | user_ai_permissions              | DELETE, INSERT, UPDATE |
  | user_capabilities                | DELETE, INSERT, UPDATE |
  | user_files                       | DELETE, INSERT, UPDATE |
  | v_admin_user_usage               | DELETE, INSERT, UPDATE |
- **98 table(s).** §14 counts 7 from migration history; a difference here
  changes stage 4's size and is the kind of thing only a live read can say.
  | auth_users | approved_users | approved_with_matching_auth_row |
  |------------|----------------|---------------------------------|
  | 1          | 25             | 0                               |
- **0 of 25** approved users have a matching `auth.users` row (`auth.users`
  holds 1). Where they do not, stage 1 cannot simply mint a session for the
  existing uuid — it has to create the auth identity first, which is a larger
  change than the plan's stage 1 describes and must be re-planned before stage 2.
  | granted_to         | policies | tables |
  |--------------------|----------|--------|
  | public             | 108      | 55     |
  | authenticated      | 37       | 25     |
  | anon,authenticated | 31       | 29     |
- **No policy is granted to `anon` alone**, so switching a request from `anon` to
  `authenticated` takes no policy away from it. Stage 1 is safe on this axis.
- A `public` row is the benign case: `TO public` covers every role, so the role
  change is invisible to it.
  (no rows)
- **None.** Every privilege `anon` holds, `authenticated` holds too, so the role
  change stage 1 causes cannot produce a permission error before RLS is reached.

**RLS on, every write policy has a predicate** — 47 table(s)

  ai_budgets, ai_models, ai_providers, api_rate_limits, bom_multi_level, bom_single_level, capabilities, demand_forecasts, disruption_scenario_effects, disruption_scenario_profiles, disruption_scenario_settings, disruption_scenario_targets, disruption_scenarios, inbound_logistics, ingest_files, ingest_runs, ingest_staged_bom_lines, ingest_staged_bom_versions, ingest_staged_products, ingest_staged_rows, multi_tier_supply_chain, network_edges, network_nodes, network_summary, node_list, org_capabilities, organization_members, organizations, outbound_logistics, policy_defaults, policy_overrides, policy_presets, project_erp_links, projects, recovery_playbooks, role_capabilities, simulation_cache, simulation_job_magnitudes, simulation_jobs, simulation_performance_metrics, simulation_results, supply_chain_data, supply_chain_data_multi_tier, tier2_suppliers, tier3_suppliers, user_ai_permissions, user_capabilities

**RLS on, NO write policy — denied today** — 34 table(s)

  ai_chat_events, ai_model_capabilities, ai_usage_logs, analysis_kinds, analysis_results, analysis_runs, api_idempotency, api_keys, api_request_logs, audit_logs, chat_folders, chat_messages, chat_plans, chat_threads, dataset_versions, delegation_grants, docs_faq, docs_section_releases, external_evidence, model_validation_evidence, model_validations, plan_role_allowances, project_graph_state, project_members, project_memory, project_role_capabilities, proposals, risk_data, run_series_orphans, run_usage, scenario_templates, sim_engine_builds, sim_engines, user_files

**RLS on, a write policy that refuses nothing** — 10 table(s)

  customers, experiments, materials, policy_versions, products, run_item_series, run_replications, scenarios, simulation_runs, suppliers

**view (grant only; RLS lives on the base table)** — 7 table(s)

  admin_org_file_usage, sc_edges, sc_nodes, simulation_result_scenarios, simulation_results_with_settings, surrogate_training_runs, v_admin_user_usage

- **10 table(s) are genuinely writable by an anonymous caller today.** That is the
  number stages 3 and 4 are sized by — not the 86 grants (most are held behind a
  policy that refuses the write) and not the 16 open write policies (some sit on
  tables `anon` cannot reach anyway).
- A row reading `RLS OFF` is the sharpest case in this report: there is no policy to
  add a restrictive clause to, so stage 3's mechanism does not apply and the only
  fix is the grant. Those tables belong at the FRONT of stage 4, not in its middle.
- `denied today` is the benign large group: the grant exists and RLS refuses every
  write for want of a permissive policy, which is why revoking is tidying rather
  than repair.
  | constraint_name                          | table_name         | columns           |
  |------------------------------------------|--------------------|-------------------|
  | experiments_created_by_fkey              | experiments        | created_by        |
  | policy_presets_owner_id_fkey             | policy_presets     | owner_id          |
  | project_erp_links_linked_by_user_id_fkey | project_erp_links  | linked_by_user_id |
  | recovery_playbooks_created_by_fkey       | recovery_playbooks | created_by        |
  | scenarios_created_by_fkey                | scenarios          | created_by        |
  | simulation_runs_created_by_fkey          | simulation_runs    | created_by        |
- **6 key(s)**. Expected **6** since `20260919000012` re-keyed
  `ingest_runs`' two actor columns to `approved_users` (D156); the artifact records
  seven, and the one it is still wrong about is `policy_versions.created_by`, dropped
  in June and not followed by the introspector (D157).
  A difference is a defect in the artifact, not in the database (D49/D52's class):
  a constraint dropped by a later `ALTER TABLE` that the introspector did not
  follow, and therefore a foreign key this repository believes in and production
  does not — or the reverse, which is worse.
- **`ingest_runs` is NOT in this list**, so its actor columns take an
  `approved_users` id without complaint and the landing path is not blocked by
  this. Then the artifact is wrong about it, which is its own finding.
  (no rows)

**The predicates each one must still have afterwards:**

- **0 policy/policies.** Each becomes `ALTER POLICY <name> ON <table>
  TO anon, authenticated\` — additive, since a policy gaining a role takes none
  away, and revertible by the same statement with `TO anon`.
- **This must land BEFORE stage 1 issues a session.** Until it does, every one of
  these reads is available to an anonymous caller and refused to an authenticated
  one, which is the inversion nothing in §14 had pointed at (D155).

### Audit 2026-09-22 · WP 1 — the shape, before anything moves (F-01…F-37)
<!-- at 2026-10-04T17:40:15.653Z -->

**Q5 · F-18 — which engine produced the stored runs** (every status):
  | code_version | status | runs | claiming_reps | first_seen | last_seen  |
  |--------------|--------|------|---------------|------------|------------|
  | scsim-0.2.8  | done   | 12   | 12            | 2026-09-25 | 2026-09-30 |
  | scsim-0.2.1  | done   | 3    | 3             | 2026-07-12 | 2026-07-12 |
  | scsim-0.6.1  | done   | 2    | 2             | 2026-10-03 | 2026-10-03 |
  | scsim-0.2.3  | done   | 1    | 1             | 2026-07-13 | 2026-07-13 |
  | scsim-0.2.9  | done   | 1    | 1             | 2026-10-02 | 2026-10-02 |

**Q6 · F-18 — `rep_count_done` against the replication rows that exist:**
  | code_version | status | runs | count_disagrees | claims_over_empty | claimed | persisted |
  |--------------|--------|------|-----------------|-------------------|---------|-----------|
  | scsim-0.2.8  | done   | 12   | 0               | 0                 | 111     | 111       |
  | scsim-0.2.1  | done   | 3    | 3               | 3                 | 13      | 0         |
  | scsim-0.6.1  | done   | 2    | 0               | 0                 | 11      | 11        |
  | scsim-0.2.3  | done   | 1    | 0               | 0                 | 1       | 1         |
  | scsim-0.2.9  | done   | 1    | 0               | 0                 | 10      | 10        |

**Q2 · F-04 — replications whose `pre_disruption_fill_rate` is exactly 1.0**
(the substituted value when `pre` is empty; a genuine perfect pre-window is also
1.0, so Q1 below is what separates the two):
  | runs_with_baseline | reps_with_baseline | reps_at_exactly_1 | runs_touched |
  |--------------------|--------------------|-------------------|--------------|
  | 2                  | 20                 | 1                 | 1            |

**Q3 · F-05 — TTR/TTS values, and how many sit at the censoring sentinel**
(the engine window is 52 weeks, so a value ≥ 52 is "never recovered"):
  | runs | reps | ttr_at_window | tts_at_window | ttr_zero | mean_ttr | max_ttr |
  |------|------|---------------|---------------|----------|----------|---------|
  | 2    | 20   | 0             | 0             | 10       | 3.50     | 7.0     |

**Q1 · F-03 — scheduled disruptions whose mapped start week is inside the warm-up:**
  | done_runs_with_disruptions | disruptions | start_in_detected_warmup | runs_affected | min_t_w | max_t_w | mean_t_w |
  |----------------------------|-------------|--------------------------|---------------|---------|---------|----------|
  | 12                         | 12          | 9                        | 9             | 5       | 26      | 17.7     |
  | scenarios_with_disruptions | disruptions | still_the_default | start_inside_authored_warmup | shorter_than_one_tick |
  |----------------------------|-------------|-------------------|------------------------------|-----------------------|
  | 11                         | 11          | 0                 | 1                            | 0                     |

**Q4 · F-06/F-07/F-30 — run states that should not exist:**
  | running_over_2h | queued_over_2h | failed_or_cancelled_with_reps | cancelled | done_mentioning_cancel | total |
  |-----------------|----------------|-------------------------------|-----------|------------------------|-------|
  | 0               | 0              | 0                             | 0         | 0                      | 19    |

**Q7 · F-19(a) — runs dispatched with the gate skipped:**
  | runs | gate_skipped_runs | projects |
  |------|-------------------|----------|
  | 19   | 0                 | 0        |

**Q8 · F-19(b) — the largest project per gate table against the 50 000-row ceiling:**
  | t                  | largest_project_rows | projects_over |
  |--------------------|----------------------|---------------|
  | bom_multi_level    | 396                  | 0             |
  | bom_single_level   | 2202                 | 0             |
  | inbound_logistics  | 367                  | 0             |
  | materials          | 367                  | 0             |
  | outbound_logistics | 6                    | 0             |

**Q9/Q10 · F-09 — `node_list.echelon` in production, beside the legacy `node_type`:**
  | echelon     | node_type | nodes | projects |
  |-------------|-----------|-------|----------|
  | material    | material  | 580   | 6        |
  | supplier    | supplier  | 117   | 6        |
  | subassembly | material  | 65    | 1        |
  | product     | product   | 12    | 6        |
  | customer    | customer  | 7     | 6        |
  | data_source | edges | bom_depth_null | level_ne_depth | distinct_levels | min_level | max_level |
  |-------------|-------|----------------|----------------|-----------------|-----------|-----------|
  | bom         | 3013  | 2613           | 2613           | 5               | 0         | 4         |
  | inbound     | 1064  | 735            | 735            | 4               | 1         | 5         |
  | outbound    | 13    | 10             | 10             | 1               | 0         | 0         |

**Q11 · F-21 — `materials.holding_cost_pct`: fraction or percent?** (`project_map` multiplies by 100 and clamps to [5, 50])
  | rows_set | projects | looks_like_a_percent | below_clamp_floor | above_clamp_ceiling | min | max |
  |----------|----------|----------------------|-------------------|---------------------|-----|-----|
  | 2        | 1        | 0                    | 0                 | 0                   | 0.2 | 0.2 |

**Q12 · F-11 — runs that carry no binding of their own:**
  | runs_without_hash | runs_without_dsv | total |
  |-------------------|------------------|-------|
  | 0                 | 0                | 19    |

**Q14 · F-01 — every `ingest_runs` row by source, ever:**
  | source_kind | runs | first      | last       |
  |-------------|------|------------|------------|
  | csv         | 13   | 2026-09-22 | 2026-09-29 |

**Q15 · F-15 — rows whose project no longer exists** (every table with a `project_id` column):
  | t                            | orphans |
  |------------------------------|---------|
  | supply_chain_data_multi_tier | 751     |
  | ai_chat_events               | 186     |
  | ai_usage_logs                | 52      |
  | disruption_scenarios         | 2       |
  | simulation_results           | 2       |
- 55 table(s) swept; 5 hold orphaned rows.

**F-16 · open question 1 — edge functions deployed in production** (Management API, GET):
  | slug                              | version | status | verify_jwt | updated_at |
  |-----------------------------------|---------|--------|------------|------------|
  | agent-apply                       | 186     | ACTIVE | false      | 2026-10-04 |
  | api                               | 181     | ACTIVE | false      | 2026-10-04 |
  | calculate                         | 224     | ACTIVE | false      | 2025-08-25 |
  | calculate-network-science-metrics | 165     | ACTIVE | true       | 2026-10-01 |
  | calculate-node-prominence         | 260     | ACTIVE | false      | 2026-10-01 |
  | combine-project                   | 292     | ACTIVE | true       | 2026-10-04 |
  | combine-project-into-supply-chain | 265     | ACTIVE | true       | 2026-03-17 |
  | delete-project                    | 291     | ACTIVE | true       | 2026-09-25 |
  | delete-simulation-job             | 165     | ACTIVE | false      | 2026-03-17 |
  | external-simulation-processor     | 178     | ACTIVE | false      | 2026-03-17 |
  | geocode-locations                 | 344     | ACTIVE | true       | 2026-09-25 |
  | get-mapbox-token                  | 347     | ACTIVE | false      | 2026-03-17 |
  | get-multi-tier-network-data       | 223     | ACTIVE | true       | 2026-03-17 |
  | ingest-bom-multi-level            | 283     | ACTIVE | true       | 2026-03-17 |
  | ingest-file                       | 74      | ACTIVE | true       | 2026-10-04 |
  | ingest-inbound-logistics          | 281     | ACTIVE | true       | 2026-03-17 |
  | ingest-outbound-logistics         | 285     | ACTIVE | true       | 2026-03-17 |
  | predict-critical-nodes            | 468     | ACTIVE | true       | 2026-10-01 |
  | project-ai-chat                   | 273     | ACTIVE | false      | 2026-10-04 |
  | project-ai-health                 | 247     | ACTIVE | false      | 2026-10-04 |
  | report-render                     | 173     | ACTIVE | false      | 2026-10-04 |
  | session-mint                      | 82      | ACTIVE | false      | 2026-09-25 |
  | sim-command                       | 206     | ACTIVE | true       | 2026-10-04 |
  | simulation-availability-checker   | 184     | ACTIVE | false      | 2026-03-17 |
  | simulation-cache-manager          | 193     | ACTIVE | false      | 2026-03-17 |
  | simulation-runner                 | 193     | ACTIVE | false      | 2026-03-17 |
  | simulation-status                 | 193     | ACTIVE | false      | 2026-03-17 |
  | test-prominence                   | 295     | ACTIVE | false      | 2026-03-17 |
- `erp-sync-orbit-mrp` (registered as not deployed): absent
- `get-mapbox-token` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-bom-multi-level` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-inbound-logistics` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-outbound-logistics` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product

### §15 · the project measured
<!-- at 2026-10-04T17:40:32.282Z -->

- `project_id` = `6d721b5d-ca53-4be8-9a40-e668a5387e1b` — **Aumovio** — chosen because it has the most inbound_logistics rows (367).

### §15 · D8 — blank / untrimmed / case-variant ids
<!-- at 2026-10-04T17:40:32.282Z -->

  | offending_rows | blank_supplier | blank_material | untrimmed_supplier | untrimmed_material |
  |----------------|----------------|----------------|--------------------|--------------------|
  | 0              | 0              | 0              | 0                  | 0                  |
- **0** normalized material ids carry more than one spelling.

### §15 · D6 — field-shift signature from an unquoted comma
<!-- at 2026-10-04T17:40:34.047Z -->

  | rows_with_quote_char |
  |----------------------|
  | 0                    |
- No row carries the field-shift signature. D6 is unexercised here — it is a parser defect, not a data defect, and WP 3.2 still owns it.

### §15 · D7 — blank numerics that passed validation
<!-- at 2026-10-04T17:40:34.945Z -->

  | null_volume | null_lead_time | null_price | nonpositive_price | total |
  |-------------|----------------|------------|-------------------|-------|
  | 0           | 0              | 0          | 0                 | 367   |

### §15 · D5 — duplicate arcs (WP 3.3's before number)
<!-- at 2026-10-04T17:40:35.812Z -->

  | duplicated_groups | surplus_rows | worst_group |
  |-------------------|--------------|-------------|
  | 0                 | 0            | 0           |

Against `inbound_logistics`'s `natural_key_intended` (`project_id + plant_name + supplier_id + material_id`) — this is the number WP 3.3's `CREATE UNIQUE INDEX` has to survive:
  | duplicated_keys | rows_the_unique_index_would_reject | worst_key |
  |-----------------|------------------------------------|-----------|
  | 0               | 0                                  | 0         |

### §15 · D2 / D10 — mixed and unrecognized `time_unit`
<!-- at 2026-10-04T17:40:37.727Z -->

  | materials_with_mixed_units |
  |----------------------------|
  | 0                          |
- No material mixes time units in this project, so `sourcing_ratio` is at least internally comparable here.
- **0** distinct token(s) fall outside the recognized set and are silently read as weekly.

### §15 · D3 — `plant_name` drift between arcs and BOM
<!-- at 2026-10-04T17:40:39.611Z -->

  | orphan_plants | affected_arcs |
  |---------------|---------------|
  | 0             | 0             |

### §15 · D2 / D3 headline — rows that reached the grid weighted 0
<!-- at 2026-10-04T17:40:40.449Z -->

  | data_source | total | zero_weighted |
  |-------------|-------|---------------|
  | bom         | 2202  | 0             |
  | inbound     | 367   | 0             |
  | outbound    | 6     | 0             |
  | materials_off_one |
  |-------------------|
  | 0                 |

### §15 · masters missing for multi-level BOM materials
<!-- at 2026-10-04T17:40:42.509Z -->

  | materials_without_master |
  |--------------------------|
  | 0                        |

### §15 · D17 — suppliers the grid renders as capacity 0
<!-- at 2026-10-04T17:40:44.826Z -->

  | shown_as_zero_but_unlimited | total |
  |-----------------------------|-------|
  | 65                          | 65    |

### §15 · D1 — auto-seeded zero safety stock
<!-- at 2026-10-04T17:40:45.758Z -->

  | zero_safety_stock_patches |
  |---------------------------|
  | 338                       |
- Project-scoped filtering is deliberately omitted: WP 0.1 closed the WRITE path, so the question is whether any seeded zeros survive anywhere.

### §15 · D3 / D4 — the two adopted-or-dropped tables, each against its own expectation
<!-- at 2026-10-04T17:40:46.710Z -->

- `risk_data` is present, which is CORRECT: WP 1.4 adopted it (`20260915000003_risk_data.sql`) and it is in the contract.
- `product_code_map` is gone, which is CORRECT: WP 3.0 dropped it (0 rows, no writer had ever existed).

### §15 · D175 follow-up — where each project's materials live, per source
<!-- at 2026-10-04T17:40:47.574Z -->


**(D175a) distinct material ids per source per project** — the Supplier grid renders `scd_inbound` lanes; D175 adds `bom_multi` leaves/intermediates and `master`; nothing renders a `bom_single`-only id:
  | project             | master | bom_single | bom_multi | inbound | scd_inbound |
  |---------------------|--------|------------|-----------|---------|-------------|
  | Aumovio             | 367    | 367        | 0         | 367     | 367         |
  | Example — 1P/2M/3S  | 2      | 2          | 0         | 2       | 2           |
  | Project AA - ver3   | 195    | 0          | 260       | 195     | 195         |
  | Project TRON - ver1 | 12     | 12         | 0         | 12      | 12          |
  | Test_MTS            | 2      | 2          | 0         | 2       | 2           |
  | Test_Simulation     | 2      | 2          | 0         | 2       | 2           |

**(D175b) every material id in every SMALL project (≤ 30 ids), and which source knows it** — an id with every visibility column false except `bom_single` is invisible on the Supplier stage even after D175; an id with `is_product` true belongs to the Focal-plant stage instead:
  | project             | material        | master | bom_single | bom_multi | lane | scd_inbound | is_product |
  |---------------------|-----------------|--------|------------|-----------|------|-------------|------------|
  | Example — 1P/2M/3S  | M1              | true   | true       | false     | true | true        | false      |
  | Example — 1P/2M/3S  | M2              | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00140AA6170A    | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00140AA8444A    | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00140J154A-TOSA | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00140P989A-TOSA | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00280N324A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 003110837A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 003116750A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 004806032A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00480Q331A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00503A007A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00590E147A      | true   | true       | false     | true | true        | false      |
  | Project TRON - ver1 | 00590H570A      | true   | true       | false     | true | true        | false      |
  | Test_MTS            | M001            | true   | true       | false     | true | true        | false      |
  | Test_MTS            | M002            | true   | true       | false     | true | true        | false      |
  | Test_Simulation     | M001            | true   | true       | false     | true | true        | false      |
  | Test_Simulation     | M002            | true   | true       | false     | true | true        | false      |

### §15 · BOM usability Phase 1 — the multi-level BOMs production actually holds
<!-- at 2026-10-04T17:40:49.398Z -->

Every project with `bom_multi_level` rows. Vocabulary: **top parent** = a parent that is nobody's child (the engine's roots); **demanded** = a product with outbound volume (the derivation's and the tree's roots); **leaf** = a child that is nobody's parent (what the engine buys); **intermediate** = a child that is also a parent (a sub-assembly).

**(B1) shape per project** — `pairs_on_2plus_rows`: the same child→parent pair on several rows (different `level`), which BOTH the engine and the derivation count once per row:
  | project           | bom_rows | plants | blank_parent_rows | root_rows_naming_a_product | self_rows | pairs_on_2plus_rows | edges | nodes | top_parents | top_demanded | demanded | demanded_not_a_bom_parent | demanded_and_consumed | intermediates | intermediates_in_product_master | leaves | bom_updated                   |
  |-------------------|----------|--------|-------------------|----------------------------|-----------|---------------------|-------|-------|-------------|--------------|----------|---------------------------|-----------------------|---------------|---------------------------------|--------|-------------------------------|
  | Project AA - ver3 | 396      | 1      | 0                 | 0                          | 0         | 0                   | 396   | 261   | 1           | 1            | 1        | 0                         | 0                     | 65            | 0                               | 195    | 2025-09-18 23:22:43.342353+00 |

**(B2) rows per uploaded `level`** — a NULL or zero rate is read as 1.0 by the engine (`_num(rate) or 1.0`) and as 0 by the derivation (`COALESCE(rate, 0)`):
  | project           | level | rows | children | parents | blank_parent | rate_null | rate_zero | rate_not_1 | rate_min | rate_max |
  |-------------------|-------|------|----------|---------|--------------|-----------|-----------|------------|----------|----------|
  | Project AA - ver3 | 0     | 2    | 2        | 1       | 0            | 0         | 0         | 0          | 1        | 1        |
  | Project AA - ver3 | 1     | 5    | 5        | 2       | 0            | 0         | 0         | 0          | 1        | 1        |
  | Project AA - ver3 | 2     | 29   | 29       | 5       | 0            | 0         | 0         | 0          | 1        | 1        |
  | Project AA - ver3 | 3     | 45   | 45       | 29      | 0            | 0         | 0         | 0          | 1        | 1        |
  | Project AA - ver3 | 4     | 315  | 179      | 29      | 0            | 0         | 0         | 154        | 1        | 392      |

**(B3) does the uploaded `level` agree with the edges?** — a tree can indent by path depth or by `level`; this says whether the two ever differ:
  | project           | edge_rows_parent_has_no_row | edge_rows_level_not_parent_plus_1 | children_on_2plus_levels | min_level_under_top | max_level_under_top |
  |-------------------|-----------------------------|-----------------------------------|--------------------------|---------------------|---------------------|
  | Project AA - ver3 | 2                           | 0                                 | 0                        | 0                   | 0                   |

**(B4) fan-out — distinct children per parent:**
  | project           | parent_kind  | parents | min_children | median | p90 | max_children |
  |-------------------|--------------|---------|--------------|--------|-----|--------------|
  | Project AA - ver3 | top parent   | 1       | 2            | 2      | 2   | 2            |
  | Project AA - ver3 | intermediate | 65      | 1            | 2      | 15  | 36           |

**(B5) where-used — distinct parents per child.** An intermediate under 2+ parents repeats its WHOLE subtree in a path-expanded tree:
  | project           | child_kind   | children | one_parent | two | three_to_five | six_plus | max_parents |
  |-------------------|--------------|----------|------------|-----|---------------|----------|-------------|
  | Project AA - ver3 | intermediate | 65       | 65         | 0   | 0             | 0        | 1           |
  | Project AA - ver3 | leaf         | 195      | 146        | 21  | 21            | 7        | 15          |

**(B6) sourcing.** `leaves_no_lane` is what the engine refuses a run over (`materials with no supplier link`); `intermediates_with_lane` are BOUGHT sub-assemblies whose lanes the engine's flatten walks straight past. The four `grid_*` columns re-derive the Supplier grid's line classes from `useStageRows` rules (lanes · unassigned · made in-house · not in BOM) as a cross-check on the `N/N lines` the page prints:
  | project           | leaves_with_lane | leaves_no_lane | intermediates_with_lane | top_with_lane | lane_materials_not_in_bom | leaf_1_sup | leaf_2_sup | leaf_3plus_sup | max_sups | grid_lane_lines | grid_unassigned_lines | grid_in_house_lines | grid_not_in_bom_lines |
  |-------------------|------------------|----------------|-------------------------|---------------|---------------------------|------------|------------|----------------|----------|-----------------|-----------------------|---------------------|-----------------------|
  | Project AA - ver3 | 195              | 0              | 0                       | 0             | 0                         | 160        | 7          | 28             | 10       | 321             | 0                     | 65                  | 0                     |

**(B7) the tree as the Supplier stage builds it** (demanded roots, D129/D171 edge rules). `node_rows_fully_expanded` is how many structural rows a user scrolls through with everything open, before any supplier line — the number a redesign has to beat:
  | project           | demanded_roots | roots_with_no_bom | node_rows_fully_expanded | min_per_root | median_per_root | max_per_root | max_distinct_under_one_root | max_depth | bom_nodes_no_demanded_root_reaches | cycle_hits |
  |-------------------|----------------|-------------------|--------------------------|--------------|-----------------|--------------|-----------------------------|-----------|------------------------------------|------------|
  | Project AA - ver3 | 1              | 0                 | 396                      | 396          | 396             | 396          | 260                         | 5         | 0                                  | 0          |

**(B8) "how much M does one P need?" — the engine's flatten (Σ over paths of Π rate, NULL/0 rate → 1) against the derived deep lane (Σ `weighted` of M's edges under root P ÷ P's demand)**, for every (demanded top parent, leaf) pair. The tree shows the second; the simulation runs the first:
  | project           | root_leaf_pairs | agree | no_derived_row | disagree | max_abs_diff       | qty_not_1 | max_qty_per_unit |
  |-------------------|-----------------|-------|----------------|----------|--------------------|-----------|------------------|
  | Project AA - ver3 | 195             | 195   | 0              | 0        | 0.0000000000000000 | 106       | 392.0            |

**(B9) derived deep lane vs the upload** — `derived_edges_not_uploaded` should be only the D129 blank-parent hangs; `derived_at` older than `bom_updated` means the tree's numbers describe an older BOM:
  | project           | bom_rows | no_path_root | outbound_rows | inbound_rows | uploaded_edges_not_derived | derived_edges_not_uploaded | max_bom_depth | demanded_rows_zero_volume | derived_at                    | bom_updated                   |
  |-------------------|----------|--------------|---------------|--------------|----------------------------|----------------------------|---------------|---------------------------|-------------------------------|-------------------------------|
  | Project AA - ver3 | 396      | 0            | 1             | 321          | 0                          | 0                          | 5             | 0                         | 2026-09-29 10:57:50.255426+00 | 2025-09-18 23:22:43.342353+00 |

**(B10) the one classifier (`node_list.echelon`, D127) against the upload's own shape** — any cell off the diagonal (top→product, intermediate→subassembly, leaf→material) is a node a tree would label differently from every other page:
  | project           | upload_shape | echelon     | ids |
  |-------------------|--------------|-------------|-----|
  | Project AA - ver3 | intermediate | subassembly | 65  |
  | Project AA - ver3 | leaf         | material    | 195 |
  | Project AA - ver3 | top          | product     | 1   |

**(B11) lead times and names** — what a "longest lead-time path" or a human-readable label could be built from (the BOM carries no assembly lead time for an intermediate):
  | project           | lanes | lead_time_null | lt_min | lt_max | lead_time_units | product_master_rows | material_master_rows | materials_with_a_name |
  |-------------------|-------|----------------|--------|--------|-----------------|---------------------|----------------------|-----------------------|
  | Project AA - ver3 | 321   | 150            | 0      | 55     | (null)          | 1                   | 195                  | 0                     |

**(B12) the 10 largest-demand roots per project** (sample):
  | project           | root         | demand_wk | node_rows | distinct_nodes | depth |
  |-------------------|--------------|-----------|-----------|----------------|-------|
  | Project AA - ver3 | DB366 (S14A) | 1.92      | 396       | 260            | 5     |

**(B13) the most-shared children per project** (sample) — the "where used" cases:
  | project           | child             | kind | parents_n | parents                                                                                                                  | suppliers |
  |-------------------|-------------------|------|-----------|--------------------------------------------------------------------------------------------------------------------------|-----------|
  | Project AA - ver3 | ASNA2050DCJ3208   | leaf | 15        | E539.14457.000.00, E539.14459.000.00, E539.15089.000.00, E539.15112.000.00, E539.15113.000.00, E539.15274.000.00, E539.1 | 6         |
  | Project AA - ver3 | ASNA2050DCJ3209   | leaf | 11        | E539.14457.000.00, E539.14459.000.00, E539.15198.000.00, E539.15200.000.00, E539.15273.000.00, E539.15279.000.00, E539.1 | 6         |
  | Project AA - ver3 | ASNA2050DCJ3207   | leaf | 10        | E539.14457.000.00, E539.14459.000.00, E539.15405.000.00, E539.15818.000.00, E539.15819.000.00, E539.15824.000.00, E539.1 | 5         |
  | Project AA - ver3 | E539.14067.000.00 | leaf | 9         | E539.15277.000.00, E539.15279.000.00, E539.15280.000.00, E539.15302.000.00, E539.15405.000.00, E539.15818.000.00, E539.1 | 2         |
  | Project AA - ver3 | E539.14004.000.00 | leaf | 7         | E539.15198.000.00, E539.15200.000.00, E539.15273.000.00, E539.15274.000.00, E539.15276.000.00, E539.15283.000.00, E539.1 | 1         |
  | Project AA - ver3 | ASNA2050DXJ4008   | leaf | 6         | E532.14634.000.00, E532.16288.000.02, E539.14457.000.00, E539.14459.000.00, E539.15279.000.00, E539.15827.000.00         | 9         |
  | Project AA - ver3 | ASNE0254-01       | leaf | 6         | E539.15276.000.00, E539.15277.000.00, E539.15279.000.00, E539.15280.000.00, E539.15283.000.00, E539.15405.000.00         | 1         |
  | Project AA - ver3 | ASNA2050DXJ4010   | leaf | 5         | E539.14457.000.00, E539.15807.000.00, E539.15824.000.00, E539.15827.000.00, E539.15833.000.00                            | 9         |
  | Project AA - ver3 | ASNA2050DXJ4011   | leaf | 5         | E539.14457.000.00, E539.14459.000.00, E539.15818.000.00, E539.15819.000.00, E539.15827.000.00                            | 5         |
  | Project AA - ver3 | ASNA2051DCJ3208   | leaf | 5         | E539.14457.000.00, E539.14459.000.00, E539.15274.000.00, E539.15818.000.00, E539.15819.000.00                            | 3         |

**(B14) the widest parents per project** (sample):
  | project           | parent            | kind         | children | child_level |
  |-------------------|-------------------|--------------|----------|-------------|
  | Project AA - ver3 | E532.14634.000.00 | intermediate | 36       | 4           |
  | Project AA - ver3 | E539.14457.000.00 | intermediate | 24       | 4           |
  | Project AA - ver3 | E539.14459.000.00 | intermediate | 19       | 4           |
  | Project AA - ver3 | E539.15818.000.00 | intermediate | 19       | 4           |
  | Project AA - ver3 | E539.15405.000.00 | intermediate | 16       | 4           |
  | Project AA - ver3 | E539.15827.000.00 | intermediate | 16       | 4           |
  | Project AA - ver3 | E539.15280.000.00 | intermediate | 15       | 4           |
  | Project AA - ver3 | E539.15819.000.00 | intermediate | 15       | 4           |

**(B15) lines that need a user's attention, per class** (first 8 ids each):
  (no rows)

**(B16) the first 45 path-ordered rows under each project's largest-demand root** — the real subtree a mockup is drawn from:
  | project           | depth | node                 | rate | suppliers | path                                                                                       |
  |-------------------|-------|----------------------|------|-----------|--------------------------------------------------------------------------------------------|
  | Project AA - ver3 | 0     | DB366 (S14A)         |      | 0         | DB366 (S14A)                                                                               |
  | Project AA - ver3 | 1     | WP1                  | 1    | 0         | DB366 (S14A) > WP1                                                                         |
  | Project AA - ver3 | 2     | DSC71N               | 1    | 0         | DB366 (S14A) > WP1 > DSC71N                                                                |
  | Project AA - ver3 | 3     | E539.15112.000.11-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15112.000.11-SA                                         |
  | Project AA - ver3 | 4     | E532.16266.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15112.000.11-SA > E532.16266.000.00                     |
  | Project AA - ver3 | 4     | E539.15112.000.00    | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15112.000.11-SA > E539.15112.000.00                     |
  | Project AA - ver3 | 5     | ASNA2050DCJ3208      | 8    | 6         | DB366 (S14A) > WP1 > DSC71N > E539.15112.000.11-SA > E539.15112.000.00 > ASNA2050DCJ3208   |
  | Project AA - ver3 | 5     | E539.14519.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15112.000.11-SA > E539.15112.000.00 > E539.14519.000.00 |
  | Project AA - ver3 | 3     | E539.15113.000.11-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA                                         |
  | Project AA - ver3 | 4     | E532.16267.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA > E532.16267.000.00                     |
  | Project AA - ver3 | 4     | E539.15113.000.00    | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA > E539.15113.000.00                     |
  | Project AA - ver3 | 5     | ASNA2050DCJ3208      | 8    | 6         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA > E539.15113.000.00 > ASNA2050DCJ3208   |
  | Project AA - ver3 | 5     | E539.14055.200.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA > E539.15113.000.00 > E539.14055.200.00 |
  | Project AA - ver3 | 5     | E539.14519.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15113.000.11-SA > E539.15113.000.00 > E539.14519.000.00 |
  | Project AA - ver3 | 3     | E539.15198.000.14-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA                                         |
  | Project AA - ver3 | 4     | E532.15529.200.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E532.15529.200.00                     |
  | Project AA - ver3 | 4     | E532.15529.201.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E532.15529.201.00                     |
  | Project AA - ver3 | 4     | E532.16272.202.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E532.16272.202.00                     |
  | Project AA - ver3 | 4     | E539.15198.000.00    | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00                     |
  | Project AA - ver3 | 5     | ASNA2050DCJ3209      | 12   | 6         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > ASNA2050DCJ3209   |
  | Project AA - ver3 | 5     | ASNA2051DCJ3209      | 4    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > ASNA2051DCJ3209   |
  | Project AA - ver3 | 5     | E539.14004.000.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > E539.14004.000.00 |
  | Project AA - ver3 | 5     | E539.14006.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > E539.14006.000.00 |
  | Project AA - ver3 | 5     | E539.14006.001.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > E539.14006.001.00 |
  | Project AA - ver3 | 5     | E539.15195.200.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15198.000.14-SA > E539.15198.000.00 > E539.15195.200.00 |
  | Project AA - ver3 | 3     | E539.15200.000.12-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA                                         |
  | Project AA - ver3 | 4     | E532.16272.200.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E532.16272.200.00                     |
  | Project AA - ver3 | 4     | E539.15200.000.00    | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00                     |
  | Project AA - ver3 | 5     | ASNA2050DCJ3209      | 25   | 6         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > ASNA2050DCJ3209   |
  | Project AA - ver3 | 5     | ASNA2051DCJ3209      | 25   | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > ASNA2051DCJ3209   |
  | Project AA - ver3 | 5     | E539.14004.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > E539.14004.000.00 |
  | Project AA - ver3 | 5     | E539.14006.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > E539.14006.000.00 |
  | Project AA - ver3 | 5     | E539.14006.001.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > E539.14006.001.00 |
  | Project AA - ver3 | 5     | E539.14021.000.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > E539.14021.000.00 |
  | Project AA - ver3 | 5     | E539.15195.200.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15200.000.12-SA > E539.15200.000.00 > E539.15195.200.00 |
  | Project AA - ver3 | 3     | E539.15273.000.11-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA                                         |
  | Project AA - ver3 | 4     | E532.16263.200.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E532.16263.200.00                     |
  | Project AA - ver3 | 4     | E539.15273.000.00    | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00                     |
  | Project AA - ver3 | 5     | ASNA2050DCJ3209      | 16   | 6         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > ASNA2050DCJ3209   |
  | Project AA - ver3 | 5     | E539.14004.000.00    | 4    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > E539.14004.000.00 |
  | Project AA - ver3 | 5     | E539.14005.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > E539.14005.000.00 |
  | Project AA - ver3 | 5     | E539.14006.000.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > E539.14006.000.00 |
  | Project AA - ver3 | 5     | E539.14007.000.00    | 2    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > E539.14007.000.00 |
  | Project AA - ver3 | 5     | E539.15195.200.00    | 1    | 1         | DB366 (S14A) > WP1 > DSC71N > E539.15273.000.11-SA > E539.15273.000.00 > E539.15195.200.00 |
  | Project AA - ver3 | 3     | E539.15274.000.11-SA | 1    | 0         | DB366 (S14A) > WP1 > DSC71N > E539.15274.000.11-SA                                         |

### §15 · BOM usability Phase 1 — what the Supplier tree's cells read from the derived lane
<!-- at 2026-10-04T17:41:05.291Z -->


**(B17) derived-lane rows per `data_source` × `path_root`** — the tree reads a bom row's numbers only when its `path_root` equals an outbound row's `from_location`:
  | project           | data_source | path_root               | rows | bom_depth_null | level_values | sum_weighted | weighted_zero_or_null | first_created                 | last_created                  |
  |-------------------|-------------|-------------------------|------|----------------|--------------|--------------|-----------------------|-------------------------------|-------------------------------|
  | Project AA - ver3 | bom         | DB366 (S14A)            | 396  | 0              | 0,1,2,3,4    | 5509.9247    | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2536-2              | 10   | 0              | 5            | 183.9836     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4008         | 9    | 0              | 5            | 331.5537     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4010         | 9    | 0              | 5            | 44.0794      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4009         | 8    | 0              | 5            | 42.1629      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | EN6115V2-3              | 8    | 0              | 5            | 153.3196     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2531-3              | 7    | 0              | 5            | 231.8960     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | NSA5050-3               | 7    | 0              | 5            | 5.7495       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4007         | 6    | 0              | 5            | 9.5825       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DCJ3208         | 6    | 0              | 5            | 573.0322     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DCJ3209         | 6    | 0              | 5            | 239.5619     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4013         | 6    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DCJ3207         | 5    | 0              | 5            | 249.1444     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4011         | 5    | 0              | 5            | 22.9979      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4811         | 5    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | MS21069-3               | 5    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DXJ4013         | 5    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4810         | 4    | 0              | 5            | 32.5804      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DCJ2406         | 4    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | NAS6603-3               | 4    | 0              | 5            | 5.7495       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | EN6115V2-2              | 4    | 0              | 5            | 15.3320      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4809         | 3    | 0              | 5            | 40.2464      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4808         | 3    | 0              | 5            | 78.5763      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DXJ4010         | 3    | 0              | 5            | 53.6619      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DCJ3208         | 3    | 0              | 5            | 38.3299      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0785D162C            | 3    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DXJ4012         | 3    | 0              | 5            | 51.7454      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DXJ4015         | 3    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DXJ4009         | 3    | 0              | 5            | 74.7433      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.15075.200.00       | 2    | 0              | 5            | 3.8330       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ETIQ_EPROU_A320         | 2    | 0              | 5            | 7.6660       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.15225.000.00       | 2    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.14505.000.00       | 2    | 0              | 5            | 5.7495       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.15234.000.40       | 2    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.14067.000.00       | 2    | 0              | 5            | 21.0815      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E539.14402.000.00       | 2    | 0              | 5            | 5.7495       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | E532.14343.203.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D539.31043.200.00       | 1    | 0              | 5            | 15.3320      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DKJ4012         | 1    | 0              | 5            | 210.8145     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DKJ4010         | 1    | 0              | 5            | 160.9856     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D532.12628.206.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D532.12628.204.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DCJ3209         | 1    | 0              | 5            | 55.5784      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DCJ3210         | 1    | 0              | 5            | 21.0815      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D532.12627.218.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | AF5055-3-3              | 1    | 0              | 5            | 107.3238     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0785D11C             | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0785D119C            | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D532.12627.216.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | D532.12627.212.00       | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2025-3              | 1    | 0              | 5            | 239.5619     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0785D118C            | 1    | 0              | 5            | 13.4155      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2050DXJ4012         | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0785D116C            | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DKJ4009         | 1    | 0              | 5            | 751.2663     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ABS0354-02              | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DKJ4011         | 1    | 0              | 5            | 26.8309      | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | A321.S14A.ST8.G3.EPV3-2 | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | ASNA2051DKJ4013         | 1    | 0              | 5            | 134.1547     | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |
  | Project AA - ver3 | inbound     | A321.S14A.ST8.G3.EPV3-1 | 1    | 0              | 5            | 1.9165       | 0                     | 2026-09-29 10:57:50.255426+00 | 2026-09-29 10:57:50.255426+00 |

**(B18) the derived lane's outbound rows** — the tree's roots and their demand:
  | project           | from_location | to_location | path_root    | weighted           | level | bom_depth |
  |-------------------|---------------|-------------|--------------|--------------------|-------|-----------|
  | Project AA - ver3 | DB366 (S14A)  | AAMC        | DB366 (S14A) | 1.9164955509924709 | 0     | 0         |

**(B19) how many uploaded BOM edges would show a NUMBER in the tree** (a derived row keyed (child, parent, a root the tree knows)); the rest render `not derived — run Combine`:
  | project           | uploaded_edges | edges_a_tree_cell_can_read | bom_keys_on_2plus_rows | inbound_pairs_on_2plus_rows | other_source_rows |
  |-------------------|----------------|----------------------------|------------------------|-----------------------------|-------------------|
  | Project AA - ver3 | 396            | 396                        | 0                      | 0                           | 0                 |

**(B20) the derived rows behind the first branch of B16** (`DB366 (S14A) > WP1 > DSC71N > … > ASNA2050DCJ3208`) — exactly what those tree cells print:
  | project           | from_location     | to_location          | path_root    | level | bom_depth | rate | weighted             |
  |-------------------|-------------------|----------------------|--------------|-------|-----------|------|----------------------|
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.14457.000.00    | DB366 (S14A) | 4     | 4         | 5    | 9.5824777549623545   |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.14459.000.00    | DB366 (S14A) | 4     | 4         | 3    | 5.7494866529774127   |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15089.000.00    | DB366 (S14A) | 4     | 4         | 7    | 13.4154688569472963  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15112.000.00    | DB366 (S14A) | 4     | 4         | 8    | 15.3319644079397672  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15113.000.00    | DB366 (S14A) | 4     | 4         | 8    | 15.3319644079397672  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15274.000.00    | DB366 (S14A) | 4     | 4         | 18   | 34.4969199178644762  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15276.000.00    | DB366 (S14A) | 4     | 4         | 40   | 76.6598220396988360  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15277.000.00    | DB366 (S14A) | 4     | 4         | 40   | 76.6598220396988360  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15280.000.00    | DB366 (S14A) | 4     | 4         | 60   | 114.9897330595482540 |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15283.000.00    | DB366 (S14A) | 4     | 4         | 50   | 95.8247775496235450  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15302.000.00    | DB366 (S14A) | 4     | 4         | 40   | 76.6598220396988360  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15807.000.00    | DB366 (S14A) | 4     | 4         | 3    | 5.7494866529774127   |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15818.000.00    | DB366 (S14A) | 4     | 4         | 7    | 13.4154688569472963  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15819.000.00    | DB366 (S14A) | 4     | 4         | 6    | 11.4989733059548254  |
  | Project AA - ver3 | ASNA2050DCJ3208   | E539.15826.000.00    | DB366 (S14A) | 4     | 4         | 4    | 7.6659822039698836   |
  | Project AA - ver3 | DSC71N            | WP1                  | DB366 (S14A) | 1     | 1         | 1    | 1.9164955509924709   |
  | Project AA - ver3 | E539.14519.000.00 | E539.15112.000.00    | DB366 (S14A) | 4     | 4         | 1    | 1.9164955509924709   |
  | Project AA - ver3 | E539.14519.000.00 | E539.15113.000.00    | DB366 (S14A) | 4     | 4         | 1    | 1.9164955509924709   |
  | Project AA - ver3 | E539.15112.000.00 | E539.15112.000.11-SA | DB366 (S14A) | 3     | 3         | 1    | 1.9164955509924709   |
  | Project AA - ver3 | WP1               | DB366 (S14A)         | DB366 (S14A) | 0     | 0         | 1    | 1.9164955509924709   |

**(B21) the five largest engine-vs-derived gaps per project** (engine = Σ paths Π rate; derived = Σ `weighted` over the leaf's rows under that root ÷ root demand):
  | project           | root         | leaf                    | paths | engine_qty | derived_qty            | derived_rows | sum_weighted        | root_demand        |
  |-------------------|--------------|-------------------------|-------|------------|------------------------|--------------|---------------------|--------------------|
  | Project AA - ver3 | DB366 (S14A) | 01801-00312             | 1     | 42.0       | 42.0000000000000000    | 1            | 80.4928131416837778 | 1.9164955509924709 |
  | Project AA - ver3 | DB366 (S14A) | A321.S14A.ST8.G3.EPV3-1 | 1     | 1.0        | 1.00000000000000000000 | 1            | 1.9164955509924709  | 1.9164955509924709 |
  | Project AA - ver3 | DB366 (S14A) | A321.S14A.ST8.G3.EPV3-2 | 1     | 1.0        | 1.00000000000000000000 | 1            | 1.9164955509924709  | 1.9164955509924709 |
  | Project AA - ver3 | DB366 (S14A) | ABS0354-02              | 1     | 1.0        | 1.00000000000000000000 | 1            | 1.9164955509924709  | 1.9164955509924709 |
  | Project AA - ver3 | DB366 (S14A) | ABS0785D116C            | 1     | 1.0        | 1.00000000000000000000 | 1            | 1.9164955509924709  | 1.9164955509924709 |

### Audit 2026-09-29 · A — which WRITER produced the graph every page reads
<!-- at 2026-10-04T17:41:10.207Z -->


**(A1) the stored graph, per project, and whether the CURRENT writer produced it** — `mt_rows_not_current_writer` counts multi-tier rows whose `level` differs from `bom_depth`, which `rebuild_supply_chain_lanes` (`20260924000001`) cannot produce:
  | project             | bom_level | scd_rows | mt_rows | mt_rows_not_current_writer | graph_written    | sources_last_touched | scd_hashed |
  |---------------------|-----------|----------|---------|----------------------------|------------------|----------------------|------------|
  | Aumovio             | single    | 2575     | 2575    | 2575                       | 2026-09-15 16:55 | 2026-09-15 16:53     | 2575       |
  | Example — 1P/2M/3S  | single    | 6        | 6       | 6                          | 2026-07-12 02:00 | 2026-07-12 02:00     | 0          |
  | Project AA - ver3   | multi     | 501      | 718     | 0                          | 2026-09-29 10:57 | 2026-07-05 20:22     | 0          |
  | Project TRON - ver1 | single    | 26       | 26      | 26                         | 2026-06-12 18:50 | 2026-06-12 18:50     | 26         |
  | Test_MTS            | single    | 7        | 7       | 0                          | 2026-09-29 09:19 | 2026-09-29 09:19     | 0          |
  | Test_Simulation     | single    | 7        | 7       | 0                          | 2026-09-22 21:32 | 2026-09-22 21:32     | 7          |

- **3 of 6 project(s) with a graph hold multi-tier rows the current writer did not write.**

### Audit 2026-09-29 · B — lane share and primary supplier: stored row vs tier-2 recomputed
<!-- at 2026-10-04T17:41:11.370Z -->


**(B1) the inbound lane: the graph's rows against `inbound_logistics`, and the stored share against the share recomputed now:**
  | project             | src_lanes | graph_lanes | src_not_in_graph | graph_not_in_src | duplicated_in_graph | share_disagrees | share_is_retired_rule |
  |---------------------|-----------|-------------|------------------|------------------|---------------------|-----------------|-----------------------|
  | Aumovio             | 367       | 367         | 0                | 0                | 0                   | 0               | 0                     |
  | Example — 1P/2M/3S  | 3         | 3           | 0                | 0                | 0                   | 0               | 0                     |
  | Project AA - ver3   | 321       | 321         | 0                | 0                | 0                   | 0               | 0                     |
  | Project TRON - ver1 | 12        | 12          | 0                | 0                | 0                   | 0               | 0                     |
  | Test_MTS            | 4         | 4           | 0                | 0                | 0                   | 0               | 0                     |
  | Test_Simulation     | 4         | 4           | 0                | 0                | 0                   | 0               | 0                     |

**(B2) the primary supplier of every multi-sourced material — the stored graph's highest-share lane against the current rule's:**
  | project            | multi_sourced_materials | not_in_graph | primary_disagrees |
  |--------------------|-------------------------|--------------|-------------------|
  | Example — 1P/2M/3S | 1                       | 0            | 0                 |
  | Project AA - ver3  | 35                      | 0            | 0                 |
  | Test_MTS           | 1                       | 0            | 0                 |
  | Test_Simulation    | 1                       | 0            | 0                 |

**(B3) the outbound lane: the stored `sourcing_ratio`/`weighted` against the current rule (weekly volume, share of product demand):**
  | project             | src_lanes | graph_lanes | src_not_in_graph | graph_not_in_src | share_disagrees | weekly_volume_disagrees |
  |---------------------|-----------|-------------|------------------|------------------|-----------------|-------------------------|
  | Aumovio             | 6         | 6           | 0                | 0                | 0               | 0                       |
  | Example — 1P/2M/3S  | 1         | 1           | 0                | 0                | 0               | 0                       |
  | Project AA - ver3   | 1         | 1           | 0                | 0                | 0               | 0                       |
  | Project TRON - ver1 | 2         | 2           | 0                | 0                | 0               | 0                       |
  | Test_MTS            | 1         | 1           | 0                | 0                | 0               | 0                       |
  | Test_Simulation     | 1         | 1           | 0                | 0                | 0               | 0                       |

### Audit 2026-09-29 · C — labels against the rows they describe
<!-- at 2026-10-04T17:41:16.599Z -->


**(C1) `projects.bom_level` against the BOM rows** — every reader that branches on the label (`get_project_datasets`, `datamap.py`, the Supplier stage before D178) reads the table the label names:
  | project             | bom_level | single_rows | multi_rows | verdict            |
  |---------------------|-----------|-------------|------------|--------------------|
  | Aumovio             | single    | 2202        | 0          | agrees (or no BOM) |
  | Example — 1P/2M/3S  | single    | 2           | 0          | agrees (or no BOM) |
  | Project AA - ver3   | multi     | 0           | 396        | agrees (or no BOM) |
  | Project TRON - ver1 | single    | 12          | 0          | agrees (or no BOM) |
  | Test_MTS            | single    | 2           | 0          | agrees (or no BOM) |
  | Test_Simulation     | single    | 2           | 0          | agrees (or no BOM) |

**(C2) `node_list`'s stored `echelon`/`bom_depth`/`node_type` against `classify_node_echelon`/`node_bom_depth`/`classify_node_type` evaluated now over the stored graph:**
  | project             | node_list_rows | echelon_stale | bom_depth_stale | node_type_stale |
  |---------------------|----------------|---------------|-----------------|-----------------|
  | Aumovio             | 439            | 0             | 0               | 0               |
  | Example — 1P/2M/3S  | 7              | 0             | 3               | 0               |
  | Project AA - ver3   | 294            | 0             | 0               | 0               |
  | Project TRON - ver1 | 25             | 0             | 0               | 0               |
  | Test_MTS            | 8              | 0             | 0               | 0               |
  | Test_Simulation     | 8              | 0             | 0               | 0               |

**(C3) `node_list` against the node set of both edge tables:**
  | project             | graph_nodes | node_list_rows | graph_not_in_node_list | node_list_not_in_graph |
  |---------------------|-------------|----------------|------------------------|------------------------|
  | Aumovio             | 439         | 439            | 0                      | 0                      |
  | Example — 1P/2M/3S  | 7           | 7              | 0                      | 0                      |
  | Project AA - ver3   | 294         | 294            | 0                      | 0                      |
  | Project TRON - ver1 | 25          | 25             | 0                      | 0                      |
  | Test_MTS            | 8           | 8              | 0                      | 0                      |
  | Test_Simulation     | 8           | 8              | 0                      | 0                      |

### Audit 2026-09-29 · D — reads that can silently truncate: per-project rows against PostgREST's cap
<!-- at 2026-10-04T17:41:20.151Z -->

- PostgREST `max_rows` = **10000**
  | project             | supply_chain_data | multi_tier | node_list | bom_single_level | bom_multi_level | inbound_logistics | materials | network_nodes | network_edges |
  |---------------------|-------------------|------------|-----------|------------------|-----------------|-------------------|-----------|---------------|---------------|
  | Aumovio             | 2575              | 2575       | 439       | 2202             | 0               | 367               | 367       | 810           | 958           |
  | Example — 1P/2M/3S  | 6                 | 6          | 7         | 2                | 0               | 3                 | 2         | 0             | 0             |
  | Project AA - ver3   | 501               | 718        | 294       | 0                | 396             | 321               | 195       | 1385          | 2129          |
  | Project TRON - ver1 | 26                | 26         | 25        | 12               | 0               | 12                | 12        | 0             | 0             |
  | Test_MTS            | 7                 | 7          | 8         | 2                | 0               | 4                 | 2         | 0             | 0             |
  | Test_Simulation     | 7                 | 7          | 8         | 2                | 0               | 4                 | 2         | 0             | 0             |

- **0 (project, table) pair(s) exceed `max_rows`**: none

### Audit 2026-09-29 · E — repository vs production: migrations and edge functions
<!-- at 2026-10-04T17:41:21.405Z -->

- repository: **404** versions · production ledger: **404**
- in the repository, NOT applied: **0** 
- applied, NOT in the repository: **0** 
- `_shared` last changed: 2026-10-04T17:34:28.000Z
  | slug                              | live_build       | source_commit    | verdict                          |
  |-----------------------------------|------------------|------------------|----------------------------------|
  | agent-apply                       | 2026-10-04T17:38 | 2026-10-02T09:58 | current                          |
  | api                               | 2026-10-04T17:38 | 2026-10-04T12:24 | current                          |
  | calculate-network-science-metrics | 2026-10-01T11:19 | 2026-10-01T09:27 | current                          |
  | calculate-node-prominence         | 2026-10-01T11:19 | 2026-10-01T09:27 | current                          |
  | combine-project                   | 2026-10-04T17:39 | 2026-10-01T15:19 | current                          |
  | delete-project                    | 2026-09-25T17:33 | 2026-09-22T22:40 | current                          |
  | geocode-locations                 | 2026-09-25T17:33 | 2026-06-09T23:51 | current                          |
  | ingest-file                       | 2026-10-04T17:38 | 2026-09-17T02:36 | current                          |
  | predict-critical-nodes            | 2026-10-01T11:19 | 2026-10-01T09:27 | current                          |
  | project-ai-chat                   | 2026-10-04T17:38 | 2026-10-01T16:26 | current                          |
  | project-ai-health                 | 2026-10-04T17:38 | 2026-09-05T07:21 | current                          |
  | report-render                     | 2026-10-04T17:38 | 2026-09-14T11:43 | current                          |
  | session-mint                      | 2026-09-25T17:32 | 2026-09-19T21:18 | current                          |
  | sim-command                       | 2026-10-04T17:38 | 2026-10-01T11:40 | current                          |
  | get-mapbox-token                  | 2026-03-17T01:36 | 2026-06-09T23:51 | LIVE BUILD OLDER THAN ITS SOURCE |
  | ingest-bom-multi-level            | 2026-03-17T01:36 | 2026-09-17T09:11 | LIVE BUILD OLDER THAN ITS SOURCE |
  | ingest-inbound-logistics          | 2026-03-17T01:36 | 2026-09-17T09:11 | LIVE BUILD OLDER THAN ITS SOURCE |
  | ingest-outbound-logistics         | 2026-03-17T01:36 | 2026-09-17T09:11 | LIVE BUILD OLDER THAN ITS SOURCE |
  | calculate                         | 2025-08-25T17:16 |                  | LIVE, NO SOURCE                  |
  | combine-project-into-supply-chain | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | delete-simulation-job             | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | external-simulation-processor     | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | get-multi-tier-network-data       | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | simulation-availability-checker   | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | simulation-cache-manager          | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | simulation-runner                 | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | simulation-status                 | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |
  | test-prominence                   | 2026-03-17T01:36 |                  | LIVE, NO SOURCE                  |

**(D2) each project's latest completed run: materials/products the engine simulated (`run_item_series`) against the project's BOM now** — series exist only for a 1-replication `full_debug` run (`scsim_bridge.py`), so a 0 here says nothing about coverage:
  | project             | code_version | run_date   | run_materials | run_products | bom_materials_now | bom_single_products_now | bom_single_rows_now | inbound_rows_now |
  |---------------------|--------------|------------|---------------|--------------|-------------------|-------------------------|---------------------|------------------|
  | Aumovio             | scsim-0.2.9  | 2026-10-02 | 0             | 0            | 367               | 6                       | 2202                | 367              |
  | Example — 1P/2M/3S  | scsim-0.2.1  | 2026-07-12 | 0             | 0            | 2                 | 1                       | 2                   | 3                |
  | Project TRON - ver1 | scsim-0.2.8  | 2026-09-30 | 12            | 2            | 12                | 2                       | 12                  | 12               |
  | Test_MTS            | scsim-0.6.1  | 2026-10-03 | 0             | 0            | 2                 | 1                       | 2                   | 4                |
  | Test_Simulation     | scsim-0.2.8  | 2026-09-25 | 0             | 0            | 2                 | 1                       | 2                   | 4                |

### Audit 2026-09-29 · F — one tier-2 value, several rules: where the rows make the rules disagree
<!-- at 2026-10-04T17:41:23.675Z -->


**(F1) BOM rows whose consumption rate is NULL or ≤ 0** — lane writer reads 0, engine and grid read 1.0:
  | project             | tbl              | rows | rate_null | rate_zero_or_negative |
  |---------------------|------------------|------|-----------|-----------------------|
  | Aumovio             | bom_single_level | 2202 | 0         | 0                     |
  | Example — 1P/2M/3S  | bom_single_level | 2    | 0         | 0                     |
  | Project AA - ver3   | bom_multi_level  | 396  | 0         | 0                     |
  | Project TRON - ver1 | bom_single_level | 12   | 0         | 0                     |
  | Test_MTS            | bom_single_level | 2    | 0         | 0                     |
  | Test_Simulation     | bom_single_level | 2    | 0         | 0                     |

**(F2) inbound lanes: NULL economics, and `lead_time_unit` values the Supplier grid ignores** (`lt_unit_not_week` rows render 7× wrong or better on the grid, correctly in the engine):
  | project             | inbound_rows | all_three_null | lead_time_null | price_null | lt_unit_null | lt_unit_week | lt_unit_not_week | lt_units | untrimmed_ids |
  |---------------------|--------------|----------------|----------------|------------|--------------|--------------|------------------|----------|---------------|
  | Aumovio             | 367          | 0              | 0              | 0          | 367          | 0            | 0                |          | 0             |
  | Example — 1P/2M/3S  | 3            | 0              | 0              | 0          | 3            | 0            | 0                |          | 0             |
  | Project AA - ver3   | 321          | 23             | 150            | 23         | 321          | 0            | 0                |          | 0             |
  | Project TRON - ver1 | 12           | 0              | 0              | 0          | 12           | 0            | 0                |          | 0             |
  | Test_MTS            | 4            | 0              | 0              | 0          | 0            | 4            | 0                | week     | 0             |
  | Test_Simulation     | 4            | 0              | 0              | 0          | 0            | 4            | 0                | week     | 0             |

**(F3) weekly demand per product: `products.demand_mean` against the outbound sum (engine vs lane writer), and the outbound sum against the per-row average (the grid's placeholder basis):**
  | project             | products_with_outbound | with_demand_mean | demand_mean_ne_outbound_sum | products_with_several_customers | grid_avg_ne_sum |
  |---------------------|------------------------|------------------|-----------------------------|---------------------------------|-----------------|
  | Aumovio             | 6                      | 6                | 6                           | 0                               | 0               |
  | Example — 1P/2M/3S  | 1                      | 1                | 0                           | 0                               | 0               |
  | Project AA - ver3   | 1                      | 0                | 0                           | 0                               | 0               |
  | Project TRON - ver1 | 2                      | 0                | 0                           | 0                               | 0               |
  | Test_MTS            | 1                      | 0                | 0                           | 0                               | 0               |
  | Test_Simulation     | 1                      | 0                | 0                           | 0                               | 0               |

**(F4) `plant_name` on tier-2 rows against `projects.plant_name`** — every ETL join is on plant, so a row on another plant is a separate graph:
  | project             | project_plant | distinct_plants_in_rows | rows_not_on_project_plant | in_tables                            |
  |---------------------|---------------|-------------------------|---------------------------|--------------------------------------|
  | Aumovio             | Aumovio Plant | 1                       | 0                         |                                      |
  | Example — 1P/2M/3S  | Example Plant | 1                       | 0                         |                                      |
  | Project AA - ver3   | Plant AA      | 2                       | 980                       | bom_multi,inbound,node_list,outbound |
  | Project TRON - ver1 | Plant TRONICO | 1                       | 0                         |                                      |
  | Test_MTS            | MTS Plant     | 1                       | 0                         |                                      |
  | Test_Simulation     | Test Plant    | 1                       | 0                         |                                      |

**(F5) ids used by a lane or BOM with no master row** — `ensure_item_masters` reads inbound, `bom_single_level` and outbound, never `bom_multi_level`, and never writes `customers`:
  | project             | bom_multi_ids_no_master | customers_no_master | suppliers_no_master |
  |---------------------|-------------------------|---------------------|---------------------|
  | Aumovio             | 0                       | 0                   | 0                   |
  | Example — 1P/2M/3S  | 0                       | 0                   | 0                   |
  | Project AA - ver3   | 65                      | 0                   | 0                   |
  | Project TRON - ver1 | 0                       | 0                   | 0                   |
  | Test_MTS            | 0                       | 1                   | 0                   |
  | Test_Simulation     | 0                       | 1                   | 0                   |

**(F6) critical-node state on the lane rows (erased by every rebuild) against the analysis store and `node_list`:**
  | project             | scd_critical_rows | scd_scored_rows | analysis_runs | node_list_critical |
  |---------------------|-------------------|-----------------|---------------|--------------------|
  | Aumovio             | 505               | 2575            | 7             | 0                  |
  | Example — 1P/2M/3S  | 0                 | 0               | 0             | 0                  |
  | Project AA - ver3   | 0                 | 0               | 3             | 0                  |
  | Project TRON - ver1 | 5                 | 26              | 1             | 0                  |
  | Test_MTS            | 0                 | 0               | 1             | 0                  |
  | Test_Simulation     | 1                 | 7               | 1             | 0                  |

**(F7) `network_edges` rows that repeat a (source, target) pair** — each inflates degree and weighted centrality:
  | project           | edges | duplicate_edges |
  |-------------------|-------|-----------------|
  | Aumovio           | 958   | 0               |
  | Project AA - ver3 | 2129  | 0               |

**(F8) every non-internal trigger on `projects` and the lane tables** — is `auto_combine_on_completion` attached to anything?
  | tbl                          | tgname                                    | fn                                           | state   |
  |------------------------------|-------------------------------------------|----------------------------------------------|---------|
  | bom_multi_level              | audit_bom_multi_level_delete              | audit_tier_write                             | enabled |
  | bom_multi_level              | audit_bom_multi_level_insert              | audit_tier_write                             | enabled |
  | bom_multi_level              | audit_bom_multi_level_update              | audit_tier_write                             | enabled |
  | bom_multi_level              | bom_ml_completion_del                     | update_project_completion_stmt               | enabled |
  | bom_multi_level              | bom_ml_completion_ins                     | update_project_completion_stmt               | enabled |
  | bom_multi_level              | bom_ml_completion_upd                     | update_project_completion_stmt               | enabled |
  | bom_multi_level              | bom_ml_plant_match                        | ensure_dataset_plant_matches_project         | enabled |
  | bom_multi_level              | graph_state_touch_del                     | _graph_state_touch_del                       | enabled |
  | bom_multi_level              | graph_state_touch_ins                     | _graph_state_touch_ins                       | enabled |
  | bom_multi_level              | graph_state_touch_upd                     | _graph_state_touch_upd                       | enabled |
  | bom_multi_level              | trg_bom_multi_level_rebuild_lanes_del     | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_multi_level              | trg_bom_multi_level_rebuild_lanes_ins     | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_multi_level              | trg_bom_multi_level_rebuild_lanes_upd     | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_multi_level              | update_bom_ml_updated_at                  | update_updated_at_column                     | enabled |
  | bom_single_level             | audit_bom_single_level_delete             | audit_tier_write                             | enabled |
  | bom_single_level             | audit_bom_single_level_insert             | audit_tier_write                             | enabled |
  | bom_single_level             | audit_bom_single_level_update             | audit_tier_write                             | enabled |
  | bom_single_level             | bom_sl_completion_del                     | update_project_completion_stmt               | enabled |
  | bom_single_level             | bom_sl_completion_ins                     | update_project_completion_stmt               | enabled |
  | bom_single_level             | bom_sl_completion_upd                     | update_project_completion_stmt               | enabled |
  | bom_single_level             | bom_sl_plant_match                        | ensure_dataset_plant_matches_project         | enabled |
  | bom_single_level             | graph_state_touch_del                     | _graph_state_touch_del                       | enabled |
  | bom_single_level             | graph_state_touch_ins                     | _graph_state_touch_ins                       | enabled |
  | bom_single_level             | graph_state_touch_upd                     | _graph_state_touch_upd                       | enabled |
  | bom_single_level             | trg_bom_single_level_rebuild_lanes_del    | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_single_level             | trg_bom_single_level_rebuild_lanes_ins    | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_single_level             | trg_bom_single_level_rebuild_lanes_upd    | auto_rebuild_supply_chain_lanes              | enabled |
  | bom_single_level             | update_bom_sl_updated_at                  | update_updated_at_column                     | enabled |
  | inbound_logistics            | audit_inbound_logistics_delete            | audit_tier_write                             | enabled |
  | inbound_logistics            | audit_inbound_logistics_insert            | audit_tier_write                             | enabled |
  | inbound_logistics            | audit_inbound_logistics_update            | audit_tier_write                             | enabled |
  | inbound_logistics            | graph_state_touch_del                     | _graph_state_touch_del                       | enabled |
  | inbound_logistics            | graph_state_touch_ins                     | _graph_state_touch_ins                       | enabled |
  | inbound_logistics            | graph_state_touch_upd                     | _graph_state_touch_upd                       | enabled |
  | inbound_logistics            | inbound_completion_del                    | update_project_completion_stmt               | enabled |
  | inbound_logistics            | inbound_completion_ins                    | update_project_completion_stmt               | enabled |
  | inbound_logistics            | inbound_completion_upd                    | update_project_completion_stmt               | enabled |
  | inbound_logistics            | inbound_plant_match                       | ensure_dataset_plant_matches_project         | enabled |
  | inbound_logistics            | trg_inbound_logistics_rebuild_lanes_del   | auto_rebuild_supply_chain_lanes              | enabled |
  | inbound_logistics            | trg_inbound_logistics_rebuild_lanes_ins   | auto_rebuild_supply_chain_lanes              | enabled |
  | inbound_logistics            | trg_inbound_logistics_rebuild_lanes_upd   | auto_rebuild_supply_chain_lanes              | enabled |
  | inbound_logistics            | update_inbound_updated_at                 | update_updated_at_column                     | enabled |
  | outbound_logistics           | audit_outbound_logistics_delete           | audit_tier_write                             | enabled |
  | outbound_logistics           | audit_outbound_logistics_insert           | audit_tier_write                             | enabled |
  | outbound_logistics           | audit_outbound_logistics_update           | audit_tier_write                             | enabled |
  | outbound_logistics           | graph_state_touch_del                     | _graph_state_touch_del                       | enabled |
  | outbound_logistics           | graph_state_touch_ins                     | _graph_state_touch_ins                       | enabled |
  | outbound_logistics           | graph_state_touch_upd                     | _graph_state_touch_upd                       | enabled |
  | outbound_logistics           | outbound_completion_del                   | update_project_completion_stmt               | enabled |
  | outbound_logistics           | outbound_completion_ins                   | update_project_completion_stmt               | enabled |
  | outbound_logistics           | outbound_completion_upd                   | update_project_completion_stmt               | enabled |
  | outbound_logistics           | outbound_plant_match                      | ensure_dataset_plant_matches_project         | enabled |
  | outbound_logistics           | trg_outbound_logistics_rebuild_lanes_del  | auto_rebuild_supply_chain_lanes              | enabled |
  | outbound_logistics           | trg_outbound_logistics_rebuild_lanes_ins  | auto_rebuild_supply_chain_lanes              | enabled |
  | outbound_logistics           | trg_outbound_logistics_rebuild_lanes_upd  | auto_rebuild_supply_chain_lanes              | enabled |
  | outbound_logistics           | update_outbound_updated_at                | update_updated_at_column                     | enabled |
  | projects                     | auto_calculate_metrics_on_completion      | auto_calculate_network_metrics_on_completion | enabled |
  | projects                     | projects_owner_membership                 | project_owner_membership                     | enabled |
  | projects                     | set_project_defaults_trigger              | set_project_defaults                         | enabled |
  | projects                     | trg_create_policy_defaults                | create_default_policy_defaults               | enabled |
  | projects                     | trg_projects_set_defaults                 | set_project_defaults                         | enabled |
  | projects                     | trg_set_project_defaults                  | set_project_defaults                         | enabled |
  | projects                     | trg_tenant_allowance                      | projects_enforce_org_allowance               | enabled |
  | projects                     | update_projects_updated_at                | update_updated_at_column                     | enabled |
  | supply_chain_data            | audit_supply_chain_data_delete            | audit_tier_write                             | enabled |
  | supply_chain_data            | audit_supply_chain_data_insert            | audit_tier_write                             | enabled |
  | supply_chain_data            | audit_supply_chain_data_update            | audit_tier_write                             | enabled |
  | supply_chain_data            | trg_scd_auto_refresh_node_list_del        | auto_refresh_node_list_on_lane_change        | enabled |
  | supply_chain_data            | trg_scd_auto_refresh_node_list_ins        | auto_refresh_node_list_on_lane_change        | enabled |
  | supply_chain_data            | trg_scd_auto_refresh_node_list_upd        | auto_refresh_node_list_on_lane_change        | enabled |
  | supply_chain_data            | trg_supply_chain_data_set_defaults        | set_supply_chain_data_defaults               | enabled |
  | supply_chain_data            | update_supply_chain_data_updated_at       | update_updated_at_column                     | enabled |
  | supply_chain_data_multi_tier | audit_supply_chain_data_multi_tier_delete | audit_tier_write                             | enabled |
  | supply_chain_data_multi_tier | audit_supply_chain_data_multi_tier_insert | audit_tier_write                             | enabled |
  | supply_chain_data_multi_tier | audit_supply_chain_data_multi_tier_update | audit_tier_write                             | enabled |
  | supply_chain_data_multi_tier | set_sc_multi_tier_defaults                | set_supply_chain_data_defaults               | enabled |
  | supply_chain_data_multi_tier | trg_scdmt_auto_refresh_node_list_del      | auto_refresh_node_list_on_lane_change        | enabled |
  | supply_chain_data_multi_tier | trg_scdmt_auto_refresh_node_list_ins      | auto_refresh_node_list_on_lane_change        | enabled |
  | supply_chain_data_multi_tier | trg_scdmt_auto_refresh_node_list_upd      | auto_refresh_node_list_on_lane_change        | enabled |

**(F9) `projects.bom_level` values** — DataManager writes `multi`, the admin editor writes and tests for `multi_level`, and there is no CHECK:
  | bom_level | projects |
  |-----------|----------|
  | multi     | 1        |
  | single    | 5        |

### Audit 2026-09-29 · G — 'primary supplier' and 'demand model', each answered by three authors
<!-- at 2026-10-04T17:41:31.863Z -->


**(G1) multi-sourced materials whose ENGINE primary (cheapest link) differs from the GRID's suggested primary (highest volume); and the ONE supplier the `supplier:primary` stress preset disrupts, against how many materials the engine actually orders from it:**
  | project            | multi_sourced_materials | engine_ne_grid | stress_primary | materials_engine_orders_from_stress_primary | materials_stress_primary_supplies |
  |--------------------|-------------------------|----------------|----------------|---------------------------------------------|-----------------------------------|
  | Example — 1P/2M/3S | 1                       | 0              | S1             | 1                                           | 1                                 |
  | Project AA - ver3  | 35                      | 27             | AHG            | 8                                           | 27                                |
  | Test_MTS           | 1                       | 0              | S001           | 1                                           | 1                                 |
  | Test_Simulation    | 1                       | 0              | S001           | 1                                           | 1                                 |

**(G2) products with no `demand_distribution` (the engine takes the SCENARIO's kind for them, the Data Map says triangular) and the scenario kinds each project holds:**
  | project             | products | products_no_distribution | scenario_kinds | done_runs_on_poisson_scenario | done_runs |
  |---------------------|----------|--------------------------|----------------|-------------------------------|-----------|
  | Aumovio             | 6        | 6                        | poisson        | 1                             | 1         |
  | Example — 1P/2M/3S  | 1        | 0                        | poisson        | 3                             | 3         |
  | Project AA - ver3   | 1        | 1                        | poisson        | 0                             | 0         |
  | Project TRON - ver1 | 2        | 2                        | poisson        | 3                             | 3         |
  | Test_MTS            | 1        | 1                        | poisson        | 8                             | 8         |
  | Test_Simulation     | 1        | 1                        | poisson        | 4                             | 4         |

### Audit 2026-09-29 · H — what `anon` can read: the browser's direct `.from()` reads against production's policies
<!-- at 2026-10-04T17:41:33.797Z -->


**(H1) SELECT policies on every table the browser reads by `.from()`, as production holds them:**
  | tbl                          | select_policies                                                                                                                                                               | anon_has_a_policy | anon_grant |
  |------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------|------------|
  | analysis_runs                | analysis_runs_select → PUBLIC                                                                                                                                                 | true              | true       |
  | bom_multi_level              | BOM Multi: modifiers only → PUBLIC · BOM Multi: organization access → PUBLIC · bom_multi_level_anon_read → authenticated+anon · bom_multi_level_auth_read → authenticated     | true              | true       |
  | bom_single_level             | BOM Single: modifiers only → PUBLIC · BOM Single: organization access → PUBLIC · bom_single_level_anon_read → authenticated+anon · bom_single_level_auth_read → authenticated | true              | true       |
  | customers                    | Customers: modifiers only → PUBLIC · Customers: organization access → PUBLIC · customers_anon_read → authenticated+anon · customers_auth_all → authenticated                  | true              | true       |
  | experiments                  | experiments_auth_all → authenticated                                                                                                                                          | false             | true       |
  | inbound_logistics            | Inbound: modifiers only → PUBLIC · Inbound: organization access → PUBLIC · inbound_logistics_anon_read → authenticated+anon · inbound_logistics_auth_read → authenticated     | true              | true       |
  | ingest_files                 | ingest_files: project access → authenticated                                                                                                                                  | false             | true       |
  | ingest_runs                  | ingest_runs: project access → authenticated                                                                                                                                   | false             | true       |
  | ingest_staged_rows           | ingest_staged_rows: project access → authenticated                                                                                                                            | false             | true       |
  | materials                    | materials_anon_read → authenticated+anon · materials_auth_all → authenticated                                                                                                 | true              | true       |
  | network_edges                | Network edges: project access view → PUBLIC                                                                                                                                   | true              | true       |
  | network_nodes                | Network nodes: project access view → PUBLIC                                                                                                                                   | true              | true       |
  | node_list                    | Node list: project access view → PUBLIC                                                                                                                                       | true              | true       |
  | outbound_logistics           | Outbound: modifiers only → PUBLIC · Outbound: organization access → PUBLIC · outbound_logistics_anon_read → authenticated+anon · outbound_logistics_auth_read → authenticated | true              | true       |
  | products                     | products_anon_read → authenticated+anon · products_auth_all → authenticated                                                                                                   | true              | true       |
  | projects                     | Projects: org-wide view → PUBLIC                                                                                                                                              | true              | true       |
  | recovery_playbooks           | playbooks_select_all_auth → authenticated                                                                                                                                     | false             | true       |
  | run_item_series              | run_item_series_anon_write → authenticated+anon · run_item_series_auth_all → authenticated                                                                                    | true              | true       |
  | scenario_templates           | Anyone authenticated can read system templates → authenticated                                                                                                                | false             | true       |
  | suppliers                    | suppliers_anon_read → authenticated+anon · suppliers_auth_all → authenticated                                                                                                 | true              | true       |
  | supply_chain_data            | Supply chain data: project access view → PUBLIC                                                                                                                               | true              | true       |
  | supply_chain_data_multi_tier | Supply chain data multi-tier: project access view → PUBLIC                                                                                                                    | true              | true       |

**(I1) completed runs whose scenario has since changed seed or schedule** — the workbook's `run_meta` sheet then contradicts its `reproducibility` sheet:
  | done_runs | runs_with_stamped_seed | live_seed_differs | live_schedule_differs | seed_zero_runs_as_42 |
  |-----------|------------------------|-------------------|-----------------------|----------------------|
  | 19        | 15                     | 0                 | 1                     | 0                    |

**(J1) lanes the critical-node analyser scored, per project:**
  | project             | lane_rows | scored | first_scored     | last_scored      | lanes_written    |
  |---------------------|-----------|--------|------------------|------------------|------------------|
  | Aumovio             | 2575      | 2575   | 2026-10-01 14:21 | 2026-10-01 14:21 | 2026-09-15 16:55 |
  | Project TRON - ver1 | 26        | 26     | 2026-09-30 18:20 | 2026-09-30 18:20 | 2026-06-12 18:50 |
  | Test_Simulation     | 7         | 7      | 2026-09-28 11:12 | 2026-09-28 11:12 | 2026-09-22 21:32 |

**(F4b) for every project with a row off its own plant: each table's plant values:**
  | project           | project_plant | t                 | row_plant           | rows |
  |-------------------|---------------|-------------------|---------------------|------|
  | Project AA - ver3 | Plant AA      | bom_multi         | Plant AA Rocherfort | 396  |
  | Project AA - ver3 | Plant AA      | inbound           | Plant AA            | 16   |
  | Project AA - ver3 | Plant AA      | inbound           | Plant AA Rocherfort | 305  |
  | Project AA - ver3 | Plant AA      | multi_tier        | Plant AA            | 16   |
  | Project AA - ver3 | Plant AA      | multi_tier        | Plant AA Rocherfort | 702  |
  | Project AA - ver3 | Plant AA      | network_nodes     | Plant AA Rocherfort | 1385 |
  | Project AA - ver3 | Plant AA      | node_list         | Plant AA            | 16   |
  | Project AA - ver3 | Plant AA      | node_list         | Plant AA Rocherfort | 278  |
  | Project AA - ver3 | Plant AA      | outbound          | Plant AA Rocherfort | 1    |
  | Project AA - ver3 | Plant AA      | supply_chain_data | Plant AA            | 16   |
  | Project AA - ver3 | Plant AA      | supply_chain_data | Plant AA Rocherfort | 485  |

**(K1) the default fulfillment mode as the worker reads it (`projects.supply_chain_model`) and as the browser engine reads it (`policy_defaults.fulfillment_strategy`):**
  | project             | project_model | policy_strategy | products_without_mode | browser_runs | worker_runs |
  |---------------------|---------------|-----------------|-----------------------|--------------|-------------|
  | Aumovio             | Make-To-Stock | make_to_stock   | 6                     | 0            | 1           |
  | Example — 1P/2M/3S  | Make-To-Order | make_to_stock   | 0                     | 0            | 3           |
  | Project AA - ver3   | Make-To-Order | make_to_stock   | 1                     | 0            | 0           |
  | Project TRON - ver1 | Make-To-Order | make_to_stock   | 2                     | 0            | 3           |
  | Test_MTS            | Make-To-Stock | make_to_stock   | 1                     | 0            | 8           |
  | Test_Simulation     | Make-To-Order | make_to_stock   | 1                     | 0            | 4           |

**(K2) `network_nodes.prominence` NULL — the nodes whose Firm-level size and stats come from the page's own composite:**
  | project           | network_nodes | prominence_null |
  |-------------------|---------------|-----------------|
  | Aumovio           | 810           | 0               |
  | Project AA - ver3 | 1385          | 0               |

### Audit 2026-09-29 · L — the policy grid and the defaults cards: what is STORED, what the engine is SENT
<!-- at 2026-10-04T17:41:47.138Z -->


**(L1) the project defaults AS STORED — an empty cell is a key the page fills with the UI default and the engine reads with its own:**
  | project             | fulfil_keys | backorder_allowed | bo_cost | allocation | inv_keys | inv_type | ss_method     | ss_days | kappa | hold_pct | src_keys | src_strategy  | rec_keys | rec_response | prod_keys | fulfillment_strategy |
  |---------------------|-------------|-------------------|---------|------------|----------|----------|---------------|---------|-------|----------|----------|---------------|----------|--------------|-----------|----------------------|
  | Aumovio             | 0           |                   |         |            | 21       | s_S      | fixed_days    | 7       |       | 0.18     | 16       | single        | 0        |              | 18        | make_to_stock        |
  | Example — 1P/2M/3S  | 0           |                   |         |            | 0        |          |               |         |       |          | 0        |               | 0        |              | 0         | make_to_stock        |
  | Project AA - ver3   | 0           |                   |         |            | 16       | s_S      | service_level | 14      |       | 0.18     | 15       | dual_sourcing | 0        |              | 17        | make_to_stock        |
  | Project TRON - ver1 | 0           |                   |         |            | 0        |          |               |         |       |          | 0        |               | 0        |              | 0         | make_to_stock        |
  | Test_MTS            | 0           |                   |         |            | 0        |          |               |         |       |          | 0        |               | 0        |              | 0         | make_to_stock        |
  | Test_Simulation     | 0           |                   |         |            | 2        | rop      |               |         |       |          | 0        |               | 0        |              | 0         | make_to_stock        |

**(L2) every stored override, by scope / family / key:**
  | scope | family      | key                    | key_shape | overrides | projects |
  |-------|-------------|------------------------|-----------|-----------|----------|
  | node  | demand      | priority_tier          | a::b      | 1         | 1        |
  | node  | fulfillment | backorder_cost_per_day | a::b      | 4         | 1        |
  | node  | fulfillment | price                  | a::b      | 3         | 2        |
  | node  | fulfillment | primary_source         | a::b      | 12        | 6        |
  | node  | fulfillment | sourcing_firm          | a::b      | 10        | 4        |
  | node  | inventory   | basis                  | a::b      | 353       | 3        |
  | node  | inventory   | coverage_weeks         | a::b      | 1         | 1        |
  | node  | inventory   | holding_cost_pct       | a::b      | 675       | 4        |
  | node  | inventory   | order_up_to            | a::b      | 353       | 3        |
  | node  | inventory   | reorder_point          | a::b      | 353       | 3        |
  | node  | inventory   | rop_q_quantity         | a::b      | 5         | 2        |
  | node  | inventory   | safety_stock_days      | a::b      | 340       | 2        |
  | node  | inventory   | service_level_target   | a::b      | 2         | 1        |
  | node  | inventory   | type                   | a::b      | 711       | 6        |
  | node  | production  | capacity_units_per_day | a::b      | 8         | 2        |
  | node  | sourcing    | material_price         | a::b      | 311       | 3        |
  | node  | sourcing    | primary_source         | a::b      | 725       | 6        |
  | node  | transport   | lead_time_distribution | a::b      | 12        | 1        |
  | node  | transport   | lead_time_mean_days    | a::b      | 12        | 1        |
  | node  | transport   | lead_time_std_days     | a::b      | 12        | 1        |

**(L3) the policy snapshot each project's last completed run was SENT:**
  | project             | run_date   | has_version | snap_backorder | snap_fulfil_keys | snap_inv_keys | snap_overrides |
  |---------------------|------------|-------------|----------------|------------------|---------------|----------------|
  | Aumovio             | 2026-10-02 | true        |                | 0                | 21            | 744            |
  | Example — 1P/2M/3S  | 2026-07-12 | true        |                | 0                | 0             | 7              |
  | Project TRON - ver1 | 2026-09-30 | true        |                | 0                | 0             | 44             |
  | Test_MTS            | 2026-10-03 | true        | true           | 12               | 22            | 9              |
  | Test_Simulation     | 2026-09-25 | true        |                | 0                | 2             | 9              |

### Across EVERY project — what one project cannot tell you
<!-- at 2026-10-04T17:41:50.136Z -->

**`inbound_logistics`** — natural key `project_id + plant_name + supplier_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 711  | 6        | 0                                  |

**`outbound_logistics`** — natural key `project_id + plant_name + customer_id, product_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 12   | 6        | 0                                  |

**`bom_single_level`** — natural key `project_id + plant_name + product_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 2220 | 5        | 0                                  |

**`bom_multi_level`** — natural key `project_id + plant_name + material_id, higher_level_component_id, level`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 396  | 1        | 0                                  |

**`tier2_suppliers`** (described in WP 3.2) — natural key `project_id + plant_name + supplier_id, upstream_supplier_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 0    | 0        | 0                                  |

**`tier3_suppliers`** (described in WP 3.2) — natural key `project_id + plant_name + supplier_id, upstream_supplier_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 0    | 0        | 0                                  |

**`multi_tier_supply_chain`** (described in WP 3.2) — natural key `project_id + plant_name + from_firm_id, to_firm_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 0    | 0        | 0                                  |


  | level_0 | level_negative | min_level | total |
  |---------|----------------|-----------|-------|
  | 2       | 0              | 0         | 396   |
  | rows_with_untrimmed_or_blank_ids |
  |----------------------------------|
  | 0                                |

  | null_volume | null_lead_time | null_price | total |
  |-------------|----------------|------------|-------|
  | 148         | 150            | 23         | 711   |

- **11** unrecognized `time_unit` token(s) database-wide, each silently read as weekly.
  | time_unit | rows |
  |-----------|------|
  | <null>    | 16   |
  | 7         | 2    |
  | 21        | 2    |
  | 15        | 1    |
  | 143       | 1    |
  | 5         | 1    |
  | 48        | 1    |
  | 16        | 1    |

**Which rows are actually unresolved** — D29's text branch cannot be removed while any `org_uuid_missing` row exists:
  (no rows)

**D1's surviving damage.** WP 0.1 closed the WRITE path; it did not clean what the path had already written:
  | distinct_targets | rows |
  |------------------|------|
  | 338              | 338  |

### The migration fence — did the database change under this report?
<!-- at 2026-10-04T17:42:03.186Z -->

  | end | version | applied |
  |-----|---------|---------|
  | before | 20261004000002 | 402 |
  | after  | 20261004000004 | 404 |
- **A DEPLOY LANDED WHILE THIS REPORT WAS BEING WRITTEN.** The counts above
  describe two different databases and the report cannot say which section got
  which. Use the per-section timestamps against the deploy log to find the
  boundary, then request a fresh run in a push that carries no migration.

_255 statements, all `SELECT`._

### GATE — this run FAILS
<!-- at 2026-10-04T17:42:03.186Z -->

- the migration ledger moved from 20261004000002 to 20261004000004 during this run (402 → 404 applied): the report straddles a deploy and every count in it is of an unknown shape. Request a fresh run from a push carrying no migration (PLAN.md §4 D153).

_The report above is complete; the run exits non-zero so the workflow is red._
