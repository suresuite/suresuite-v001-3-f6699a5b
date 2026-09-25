<!-- run_id: 36180610265  outcome: success -->
<!-- trigger: push  ref: claude/rq-scenario-revenue-zero-uok11q  sha: 647fbb032b793c07dd0aaa7678d884cf31c4516f -->
# PLAN.md §15 — verification SQL, executed

- project ref: `wckdrutwkytwcomrlpib`
- run at: 2026-09-25T19:37:33.936Z
- route: Supabase Management API `/database/query` (the route §16 · WP 2.1 follow-up and `seed-project.yml` prove)
- every statement is a `select`; `assertReadOnly()` refuses anything else.
- migration ledger at start: **20260922000009** (348 applied)

### Schema probe — production vs. the migrations (D32, D43)
<!-- at 2026-09-25T19:37:34.993Z -->

- migrations create **81 tables** and **7 views**; production's `public` schema holds **88 relations**.
- **created by a migration, ABSENT from production: 0 tables, 0 views**
- **present in production, created by NO migration: 0**

### D38 — every view runs as its caller, or is the declared exception
<!-- at 2026-09-25T19:37:35.915Z -->

- production's `public` schema holds **7 views**.
  | view                             | runs_as | states_own_rule |
  |----------------------------------|---------|-----------------|
  | admin_audit_logs                 | caller  | —               |
  | admin_org_file_usage             | caller  | —               |
  | sc_edges                         | caller  | —               |
  | sc_nodes                         | caller  | —               |
  | simulation_result_scenarios      | caller  | —               |
  | simulation_results_with_settings | caller  | —               |
  | v_admin_user_usage               | OWNER   | yes             |
- `v_admin_user_usage` runs as its owner AND states its own rule — the declared exception is intact in production.

### D30 — which of the two duplicate-policy migrations ran
<!-- at 2026-09-25T19:37:36.780Z -->

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
  | plane | rows  | first_row                     |
  |-------|-------|-------------------------------|
  | admin | 18    | 2026-07-11 18:11:02.13357+00  |
  | data  | 12979 | 2026-09-16 06:34:12.104994+00 |
- No policy name is duplicated. WP 2.1's drop-and-recreate left one of each, which is the END STATE D30 says was already deterministic.

### D29 — `organizations.name` collisions (the dual read's text branch)
<!-- at 2026-09-25T19:37:41.405Z -->

- **0** normalized organization names are held by more than one organization.
- No collision today. D29 is latent, not live — nothing prevents the next one (`name` has no unique constraint).
- organizations: **3**

**D29 · the one project the text branch is load-bearing for.** Removing the branch is gated on this row:
  | project_id                           | project_name            | org_text    | orgs_matching_text | candidates | modeler_id                           | modeler_rows |
  |--------------------------------------|-------------------------|-------------|--------------------|------------|--------------------------------------|--------------|
  | 4f314330-6f55-48b7-a654-8784e2778508 | Demo Simulation Project | default_org | 0                  |            | 16afcc1b-0d86-4c95-ad60-ef28de8c695d | 0            |
- At least one row's org text matches zero or several organizations. A migration must not choose; say so in §16 instead.
  | id                                   | name     | slug     | status |
  |--------------------------------------|----------|----------|--------|
  | 35cae3ee-63cb-4fc9-8d1f-939720b28fd1 | Company1 | company1 | active |
  | 32186f24-3135-492c-ac1c-f6b534a1aba2 | Company2 | company2 | active |
  | 46feb45d-9df3-4d3e-9b13-5f205799d7cd | DMRG     | dmrg     | active |

**D29 · who would lose access if the text branch were removed.** The branch can only admit a reader whose own org TEXT matches a project's:
  | users_with_default_org_text | active | users_with_blank_org_text |
  |-----------------------------|--------|---------------------------|
  | 0                           | 0      | 0                         |
- Nobody carries the `default_org` text, so the NULL-org project is reachable by no ordinary user today. Removing the branch revokes nothing.

### The four decisions §15 gates (§16 PHASE BOUNDARY, condition 2)
<!-- at 2026-09-25T19:37:46.039Z -->

**1 · The org backfill's real coverage** — WP 2.1's unverifiable exit check.
  | projects | projects_org_null | projects_org_text_blank | approved_users | users_org_null |
  |----------|-------------------|-------------------------|----------------|----------------|
  | 11       | 1                 | 0                       | 14             | 0              |

**2 · Projects whose `modeler_id` resolves to no `approved_users` row** — WP 2.2's owner backfill.
  | projects_with_modeler | modeler_without_account |
  |-----------------------|-------------------------|
  | 11                    | 1                       |

**3 · Production's audit rows against WP 2.3's new `plane` CHECK.**
  | plane | rows  |
  |-------|-------|
  | data  | 12979 |
  | admin | 18    |
- Every row's `plane` is inside `(admin, data, access)`. The generalization migrated cleanly.

### WP 3.1 — the ingestion tables, after the rename
<!-- at 2026-09-25T19:37:49.945Z -->

  | runs | runs_connector | runs_without_link | runs_without_project | staged_products | staged_bom_versions | staged_bom_lines | landed_files | links |
  |------|----------------|-------------------|----------------------|-----------------|---------------------|------------------|--------------|-------|
  | 10   | 0              | 10                | 0                    | 0               | 0                   | 0                | 10           | 0     |

### WP 3.2 — the CSV landing, and whether it has ever run
<!-- at 2026-09-25T19:37:50.950Z -->

  | csv_runs | csv_runs_applied | staged_rows | staged_rows_rejected | csv_files | landing_audit_rows |
  |----------|------------------|-------------|----------------------|-----------|--------------------|
  | 10       | 3                | 23          | 0                    | 10        | 11                 |
- **10 landed CSV file(s) but 11 landing audit row(s)** — they are written in the same transaction, so a difference means something writes `ingest_files` outside `ingest_land_file`. That is invariant `audit-actor` failing, not a counting quirk.

### WP 3.4 — provenance on tier 2, and what `diff_state` actually holds
<!-- at 2026-09-25T19:37:51.843Z -->

  | tbl                | total | with_run | with_row |
  |--------------------|-------|----------|----------|
  | bom_multi_level    | 792   | 0        | 0        |
  | bom_single_level   | 2909  | 2        | 2        |
  | inbound_logistics  | 1695  | 4        | 4        |
  | materials          | 1317  | 0        | 0        |
  | outbound_logistics | 39    | 1        | 1        |
  | products           | 29    | 0        | 0        |
  | suppliers          | 205   | 0        | 0        |
- **7 of 6986 canonical rows trace to a source line.** A NULL means the provenance is UNKNOWN, never that there was none: both columns are `ON DELETE SET NULL`, and every row predating the CSV landing path carries neither because the files were never stored. Nothing can backfill it.
  | diff_state | rows |
  |------------|------|
  | new        | 17   |
  | unchanged  | 6    |
  | id                                   | source_kind | status  | staged | rows_new | rows_changed | rows_unchanged | rows_superseded | rows_held | rows_removed |
  |--------------------------------------|-------------|---------|--------|----------|--------------|----------------|-----------------|-----------|--------------|
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
  | 11       | 1                       | 0                    | 10          |
- Every project's modeler is a member of it. The role gate resolves for the person who created the project, which is the precondition WP 3.4's exit check stands on.

### WP 6.5 (a) — the landing switch: precondition, bucket, baseline, exit
<!-- at 2026-09-25T19:37:55.882Z -->

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
  | ingest | false  | 11      |
- Present and private.

**(3) the baseline — every project, every landable table** (`rows / with ingest_run_id / with source_row_id`):
  | tbl                | project                        | rows | with_run | with_row |
  |--------------------|--------------------------------|------|----------|----------|
  | bom_multi_level    | Project 2 · 639005df           | 396  | 0        | 0        |
  | bom_multi_level    | Project AA - ver3 · 8724f960   | 396  | 0        | 0        |
  | bom_single_level   | Aumovio · 6d721b5d             | 2202 | 0        | 0        |
  | bom_single_level   | Example — 1P/2M/3S · 16a68569  | 2    | 0        | 0        |
  | bom_single_level   | Project 1 · 27a86f0e           | 95   | 0        | 0        |
  | bom_single_level   | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | bom_single_level   | Project TRON - ver2 · 0a7040e1 | 596  | 0        | 0        |
  | bom_single_level   | Test_Simulation · 50141cd1     | 2    | 2        | 2        |
  | customers          | Aumovio · 6d721b5d             | 1    | 0        | 0        |
  | customers          | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | customers          | Project 2 · 639005df           | 1    | 0        | 0        |
  | customers          | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | customers          | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | customers          | Project TRON - ver2 · 0a7040e1 | 1    | 0        | 0        |
  | inbound_logistics  | Aumovio · 6d721b5d             | 367  | 0        | 0        |
  | inbound_logistics  | Example — 1P/2M/3S · 16a68569  | 3    | 0        | 0        |
  | inbound_logistics  | Project 1 · 27a86f0e           | 123  | 0        | 0        |
  | inbound_logistics  | Project 2 · 639005df           | 305  | 0        | 0        |
  | inbound_logistics  | Project AA - ver3 · 8724f960   | 321  | 0        | 0        |
  | inbound_logistics  | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | inbound_logistics  | Project TRON - ver2 · 0a7040e1 | 560  | 0        | 0        |
  | inbound_logistics  | Test_Simulation · 50141cd1     | 4    | 4        | 4        |
  | materials          | Aumovio · 6d721b5d             | 367  | 0        | 0        |
  | materials          | Example — 1P/2M/3S · 16a68569  | 2    | 0        | 0        |
  | materials          | Project 2 · 639005df           | 179  | 0        | 0        |
  | materials          | Project AA - ver3 · 8724f960   | 195  | 0        | 0        |
  | materials          | Project TRON - ver1 · 4a308fec | 12   | 0        | 0        |
  | materials          | Project TRON - ver2 · 0a7040e1 | 560  | 0        | 0        |
  | materials          | Test_Simulation · 50141cd1     | 2    | 0        | 0        |
  | network_edges      | Project AA - ver3 · 8724f960   | 2129 | —        | —        |
  | network_nodes      | Aumovio · 6d721b5d             | 439  | —        | —        |
  | network_nodes      | Project AA - ver3 · 8724f960   | 1385 | —        | —        |
  | node_list          | Aumovio · 6d721b5d             | 439  | —        | —        |
  | node_list          | Example — 1P/2M/3S · 16a68569  | 7    | —        | —        |
  | node_list          | Project 1 · 27a86f0e           | 154  | —        | —        |
  | node_list          | Project 2 · 639005df           | 242  | —        | —        |
  | node_list          | Project AA - ver3 · 8724f960   | 242  | —        | —        |
  | node_list          | Project TRON - ver1 · 4a308fec | 25   | —        | —        |
  | node_list          | Project TRON - ver2 · 0a7040e1 | 638  | —        | —        |
  | node_list          | Test_Simulation · 50141cd1     | 8    | —        | —        |
  | outbound_logistics | Aumovio · 6d721b5d             | 6    | 0        | 0        |
  | outbound_logistics | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | outbound_logistics | Project 1 · 27a86f0e           | 10   | 0        | 0        |
  | outbound_logistics | Project 2 · 639005df           | 1    | 0        | 0        |
  | outbound_logistics | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | outbound_logistics | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | outbound_logistics | Project TRON - ver2 · 0a7040e1 | 17   | 0        | 0        |
  | outbound_logistics | Test_Simulation · 50141cd1     | 1    | 1        | 1        |
  | products           | Aumovio · 6d721b5d             | 6    | 0        | 0        |
  | products           | Example — 1P/2M/3S · 16a68569  | 1    | 0        | 0        |
  | products           | Project 2 · 639005df           | 1    | 0        | 0        |
  | products           | Project AA - ver3 · 8724f960   | 1    | 0        | 0        |
  | products           | Project TRON - ver1 · 4a308fec | 2    | 0        | 0        |
  | products           | Project TRON - ver2 · 0a7040e1 | 17   | 0        | 0        |
  | products           | Test_Simulation · 50141cd1     | 1    | 0        | 0        |
  | suppliers          | Aumovio · 6d721b5d             | 65   | 0        | 0        |
  | suppliers          | Example — 1P/2M/3S · 16a68569  | 3    | 0        | 0        |
  | suppliers          | Project 2 · 639005df           | 32   | 0        | 0        |
  | suppliers          | Project AA - ver3 · 8724f960   | 32   | 0        | 0        |
  | suppliers          | Project TRON - ver1 · 4a308fec | 9    | 0        | 0        |
  | suppliers          | Project TRON - ver2 · 0a7040e1 | 60   | 0        | 0        |
  | suppliers          | Test_Simulation · 50141cd1     | 4    | 0        | 0        |

Totals (the line the after-read is compared against — a table whose `rows` falls lost data):
  | tbl                     | projects | rows | with_run | with_row |
  |-------------------------|----------|------|----------|----------|
  | inbound_logistics       | 8        | 1695 | 4        | 4        |
  | outbound_logistics      | 8        | 39   | 1        | 1        |
  | bom_single_level        | 6        | 2909 | 2        | 2        |
  | bom_multi_level         | 2        | 792  | 0        | 0        |
  | materials               | 7        | 1317 | 0        | 0        |
  | products                | 7        | 29   | 0        | 0        |
  | suppliers               | 7        | 205  | 0        | 0        |
  | customers               | 6        | 7    | 0        | 0        |
  | tier2_suppliers         | 0        | 0    | 0        | 0        |
  | tier3_suppliers         | 0        | 0    | 0        | 0        |
  | multi_tier_supply_chain | 0        | 0    | 0        | 0        |
  | node_list               | 8        | 1755 | 0        | 0        |
  | network_nodes           | 2        | 1824 | 0        | 0        |
  | network_edges           | 1        | 2129 | 0        | 0        |

**(3) the ingestion tables, per project:**
  | project_id | project                 | ingest_runs | csv_runs | applied_runs | ingest_files | ingest_staged_rows |
  |------------|-------------------------|-------------|----------|--------------|--------------|--------------------|
  | 4f314330   | Demo Simulation Project | 0           | 0        | 0            | 0            | 0                  |
  | 8724f960   | Project AA - ver3       | 0           | 0        | 0            | 0            | 0                  |
  | 27a86f0e   | Project 1               | 0           | 0        | 0            | 0            | 0                  |
  | 639005df   | Project 2               | 0           | 0        | 0            | 0            | 0                  |
  | d8a4c2d5   | First Project           | 0           | 0        | 0            | 0            | 0                  |
  | 4a308fec   | Project TRON - ver1     | 0           | 0        | 0            | 0            | 0                  |
  | 16a68569   | Example — 1P/2M/3S      | 0           | 0        | 0            | 0            | 0                  |
  | 0a7040e1   | Project TRON - ver2     | 0           | 0        | 0            | 0            | 0                  |
  | 4512fc3e   | Project 3 - test AI     | 0           | 0        | 0            | 0            | 0                  |
  | 6d721b5d   | Aumovio                 | 0           | 0        | 0            | 0            | 0                  |
  | 50141cd1   | Test_Simulation         | 10          | 10       | 3            | 10           | 23                 |
- **1 project(s)** hold both a landed file and staged rows — the first half of WP 6.5 (a)'s exit.
  | ingest_runs_total | ingest_files_total | ingest_staged_rows_total | landing_audit_rows |
  |-------------------|--------------------|--------------------------|--------------------|
  | 10                | 10                 | 23                       | 11                 |

**(4) the exit — one tier-2 row per table, resolved through `ingest_value_chain`:**
  | tbl                | traced_rows | has_provenance | source_kind | original_filename | source_row_number | uploaded_by_name | promoted_at                   | run_status |
  |--------------------|-------------|----------------|-------------|-------------------|-------------------|------------------|-------------------------------|------------|
  | bom_single_level   | 2           | true           | csv         | bom_test.csv      | 3                 |                  | 2026-09-22 21:31:17.312033+00 | applied    |
  | inbound_logistics  | 4           | true           | csv         | inbound_test.csv  | 4                 |                  | 2026-09-22 21:31:45.555541+00 | applied    |
  | outbound_logistics | 1           | true           | csv         | outbound_test.csv | 2                 |                  | 2026-09-22 21:32:00.898271+00 | applied    |
- **MET for 3 table(s)**: a tier-2 row names its source file and line through the function the review screen calls.

**(4b) every applied run, and how many of its staged rows a tier-2 row still names:**
  | run      | project         | target_table       | status  | applied_at                    | staged | in_tier2 | held |
  |----------|-----------------|--------------------|---------|-------------------------------|--------|----------|------|
  | f0ebdd47 | Test_Simulation | bom_single_level   | applied | 2026-09-22 21:31:17.312033+00 | 2      | 2        | 0    |
  | 2a56d7a8 | Test_Simulation | inbound_logistics  | applied | 2026-09-22 21:31:45.555541+00 | 4      | 4        | 0    |
  | 46a1c85e | Test_Simulation | outbound_logistics | applied | 2026-09-22 21:32:00.898271+00 | 1      | 1        | 0    |
- Every applied run's staged rows are either held or named by a tier-2 row.

**(4c) every statement that wrote a landable table since `ingest-file` went live** (`audit_logs`, plane `data`):
  | at                            | tbl                | action | rows_after | rows_before | actor                    |
  |-------------------------------|--------------------|--------|------------|-------------|--------------------------|
  | 2026-09-22 21:31:17.312033+00 | bom_single_level   | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:31:45.555541+00 | inbound_logistics  | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:00.898271+00 | outbound_logistics | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | suppliers          | insert | 4          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | materials          | insert | 2          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:32:43.07732+00  | products           | insert | 1          | 0           | SuperUser3@suresuite.com |
  | 2026-09-22 21:35:44.45522+00  | bom_single_level   | insert | 271        | 0           | modeler1@gmail.com       |
  | 2026-09-22 21:35:57.271502+00 | bom_single_level   | delete | 0          | 200         | (unknown)                |
  | 2026-09-22 21:35:57.774263+00 | bom_single_level   | delete | 0          | 71          | (unknown)                |
  | 2026-09-22 21:48:37.115589+00 | suppliers          | update | 4          | 4           | SuperUser3@suresuite.com |

**(5) is `ingest-file` published?** (Management API, GET):
- **LIVE** — version 18, status ACTIVE, verify_jwt true, updated 2026-09-25T17:33:08.484Z.
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
  | bom_multi_level              | trg_bom_multi_level_rebuild_lanes_del     | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | bom_single_level             | audit_bom_single_level_delete             | statement | after  | del         | audit_tier_write                      | O       |
  | bom_single_level             | bom_sl_completion_del                     | statement | after  | del         | update_project_completion_stmt        | O       |
  | bom_single_level             | trg_bom_single_level_rebuild_lanes_del    | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | disruption_scenarios         | audit_disruption_scenarios_delete         | statement | after  | del         | audit_tier_write                      | O       |
  | inbound_logistics            | audit_inbound_logistics_delete            | statement | after  | del         | audit_tier_write                      | O       |
  | inbound_logistics            | inbound_completion_del                    | statement | after  | del         | update_project_completion_stmt        | O       |
  | inbound_logistics            | trg_inbound_logistics_rebuild_lanes_del   | statement | after  | del         | auto_rebuild_supply_chain_lanes       | O       |
  | multi_tier_supply_chain      | audit_multi_tier_supply_chain_delete      | statement | after  | del         | audit_tier_write                      | O       |
  | multi_tier_supply_chain      | multi_tier_completion_del                 | statement | after  | del         | update_project_completion_stmt        | O       |
  | network_edges                | aud_network_edges_completion              | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_edges                | audit_network_edges_delete                | statement | after  | del         | audit_tier_write                      | O       |
  | network_edges                | update_completion_on_network_edges_change | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_nodes                | aud_network_nodes_completion              | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | network_nodes                | audit_network_nodes_delete                | statement | after  | del         | audit_tier_write                      | O       |
  | network_nodes                | update_completion_on_network_nodes_change | row       | after  | ins/del/upd | update_project_completion_status      | O       |
  | node_list                    | audit_node_list_delete                    | statement | after  | del         | audit_tier_write                      | O       |
  | outbound_logistics           | audit_outbound_logistics_delete           | statement | after  | del         | audit_tier_write                      | O       |
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
  | disruption_scenario_profiles   | projects           | c         | true          |
  | experiments                    | projects           | c         | true          |
  | external_evidence              | projects           | c         | true          |
  | inbound_logistics              | projects           | c         | true          |
  | ingest_runs                    | projects           | c         | true          |
  | materials                      | projects           | c         | true          |
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
  | project_members                | projects           | c         | true          |
  | project_memory                 | projects           | c         | true          |
  | proposals                      | projects           | c         | true          |
  | recovery_playbooks             | projects           | c         | true          |
  | run_item_series                | projects           | c         | false         |
  | run_replications               | projects           | c         | false         |
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
  | name                    | id                                   | updated                       | nn   | ne   | scd  | scdmt | nl  | bsl  | sr |
  |-------------------------|--------------------------------------|-------------------------------|------|------|------|-------|-----|------|----|
  | Aumovio                 | 6d721b5d-ca53-4be8-9a40-e668a5387e1b | 2026-09-21 13:55:05.945083+00 | 439  | 0    | 2575 | 2575  | 439 | 2202 | 0  |
  | Demo Simulation Project | 4f314330-6f55-48b7-a654-8784e2778508 | 2025-09-01 13:52:25.672175+00 | 0    | 0    | 0    | 0     | 0   | 0    | 0  |
  | Example — 1P/2M/3S      | 16a68569-5fcb-43ef-b2bc-1dc62a31617e | 2026-09-15 22:21:11.650418+00 | 0    | 0    | 6    | 6     | 7   | 2    | 0  |
  | First Project           | d8a4c2d5-92eb-49b2-9ead-a60b08db3156 | 2026-07-09 09:18:16.685635+00 | 0    | 0    | 0    | 0     | 0   | 0    | 0  |
  | Project 1               | 27a86f0e-81e8-4d83-a03f-d46981af281a | 2026-07-09 09:18:16.685635+00 | 0    | 0    | 228  | 0     | 154 | 95   | 2  |
  | Project 2               | 639005df-58ad-405a-8e81-4a26cde1b18f | 2026-09-16 21:17:33.673622+00 | 0    | 0    | 670  | 751   | 242 | 0    | 0  |
  | Project 3 - test AI     | 4512fc3e-c665-40f0-a1d4-4e5265e697ec | 2026-09-15 22:21:11.650418+00 | 0    | 0    | 0    | 0     | 0   | 0    | 0  |
  | Project AA - ver3       | 8724f960-b612-4bd5-a010-ab3250849f6a | 2026-09-17 23:15:02.63109+00  | 1385 | 2129 | 767  | 767   | 242 | 0    | 31 |
  | Project TRON - ver1     | 4a308fec-742b-4d43-8dc1-185c5858efad | 2026-07-09 09:18:16.685635+00 | 0    | 0    | 26   | 26    | 25  | 12   | 0  |
  | Project TRON - ver2     | 0a7040e1-a3b8-4083-a160-728782fdfb67 | 2026-07-13 12:46:34.926026+00 | 0    | 0    | 1173 | 1173  | 638 | 596  | 0  |
  | Test_Simulation         | 50141cd1-9285-4d91-a7d1-dbd91a3ffcb5 | 2026-09-22 21:32:00.898271+00 | 0    | 0    | 7    | 7     | 8   | 2    | 0  |

**(8e) every delete the audit recorded since `delete-project` was republished (22:47Z):**
  | at                            | tbl              | action | actor                    |
  |-------------------------------|------------------|--------|--------------------------|
  | 2026-09-25 15:20:21.846905+00 | scenarios        | delete | (unknown)                |
  | 2026-09-25 11:00:36.895015+00 | scenarios        | delete | (unknown)                |
  | 2026-09-24 22:24:41.234178+00 | scenarios        | delete | (unknown)                |
  | 2026-09-24 22:24:38.015465+00 | scenarios        | delete | (unknown)                |
  | 2026-09-24 22:24:35.073649+00 | scenarios        | delete | (unknown)                |
  | 2026-09-24 12:53:33.955612+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 12:53:33.44081+00  | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 12:53:32.964319+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 12:53:32.520155+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 12:53:32.088693+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 12:53:31.142003+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 11:44:01.191131+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-24 11:43:59.754653+00 | policy_overrides | delete | modeler1@gmail.com       |
  | 2026-09-23 21:29:14.320899+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:29:10.939054+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:29:07.600391+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:29:04.176835+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:28:56.146742+00 | policy_overrides | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:28:43.468873+00 | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:28:40.05781+00  | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:27:33.893486+00 | policy_overrides | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:20:41.418235+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:20:38.153952+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:20:34.248686+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:20:31.038838+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:20:21.603654+00 | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:20:18.084488+00 | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:20:14.793243+00 | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:20:11.503987+00 | scenarios        | delete | (unknown)                |
  | 2026-09-23 21:07:34.030351+00 | policy_overrides | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:05:21.52632+00  | policy_overrides | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:05:16.878418+00 | policy_overrides | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:04:54.407662+00 | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-23 21:04:41.09347+00  | policy_versions  | delete | SuperUser3@suresuite.com |
  | 2026-09-22 23:12:11.437317+00 | policy_defaults  | delete | modeler1@gmail.com       |
- **(8f) postgres log since the fix deployed** — QUERY FAILED: `HTTP 410: {"message":"The logs.all endpoint has been removed. Use GET /v1/projects/{ref}/analytics/endpoints/logs instead. See https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint"}`

### WP 4.1 — what the `schema_version` bump costs, counted before it happens
<!-- at 2026-09-25T19:38:22.111Z -->

  | dataset_versions | projects_with_a_version | distinct_graph_hashes | projects |
  |------------------|-------------------------|-----------------------|----------|
  | 13               | 6                       | 13                    | 11       |
- Every one of these 13 rows is IMMUTABLE and keeps its stored `snapshot` and `graph_hash`. The bump does not rewrite them; it means the NEXT `snapshot_dataset` call inserts a new version instead of deduping against the latest, which is the intended behaviour and not the cost. The cost is below.
  | runs | runs_bound_to_a_version | runs_with_a_graph_hash | runs_whose_version_is_gone |
  |------|-------------------------|------------------------|----------------------------|
  | 32   | 32                      | 32                     | 0                          |
- Every bound run resolves its version. The bump cannot change this: `dataset_versions` rows are never updated and never deleted by any path this package touches, and the FK is `ON DELETE SET NULL`.
  | proposals | live | live_grounded_on_graph_hash | live_and_fresh_today | already_expired |
  |-----------|------|-----------------------------|----------------------|-----------------|
  | 1         | 0    | 0                           | 0                    | 0               |
- No live proposal is grounded on a `graph_hash`, so the bump expires nothing. The write path exists and is unexercised; the decision costs nothing today and would cost `live_grounded_on_graph_hash` proposals on any day it is not zero.
  | validation_cards | active_cards | active_and_data_fresh_today |
  |------------------|--------------|-----------------------------|
  | 1                | 1            | 1                           |
- 1 active card(s) match their project's hash today and will report `drift: ["data"]` from the deploy onward. **This one is display-only and reversible** — the badge is derived at read time (`useModelValidation`), no column is written, and re-validating clears it.
  | memories | grounded_on_graph_hash |
  |----------|------------------------|
  | 0        | 0                      |
- Display-only and reversible, same as the cards: `useProjectMemory` compares at read time.

### WP 4.1 — the tables the hash starts covering, and the three that hold nothing
<!-- at 2026-09-25T19:38:26.858Z -->

  | tbl                     | rows | projects |
  |-------------------------|------|----------|
  | bom_multi_level         | 792  | 2        |
  | customers               | 7    | 6        |
  | multi_tier_supply_chain | 0    | 0        |
  | tier2_suppliers         | 0    | 0        |
  | tier3_suppliers         | 0    | 0        |
- **`hash_network`'s three tables hold ZERO rows in every project**, which is the settled decision's second clause measured rather than asserted. The half is free to add and is UNEXERCISED until somebody uploads one: a green test on it is not a working path.

### WP 4.1 — did the bump actually reach production?
<!-- at 2026-09-25T19:38:28.329Z -->

  | domain_columns | wp41_functions |
  |----------------|----------------|
  | 2              | 9              |
- Landed: both domain columns and all nine functions are present.
  | project_id                           | schema_version | has_inputs | has_network | inputs_hash | network_hash |
  |--------------------------------------|----------------|------------|-------------|-------------|--------------|
  | 4f314330-6f55-48b7-a654-8784e2778508 | 3              | true       | true        | true        | true         |
  | 8724f960-b612-4bd5-a010-ab3250849f6a | 3              | true       | true        | true        | true         |
  | 27a86f0e-81e8-4d83-a03f-d46981af281a | 3              | true       | true        | true        | true         |
  | 639005df-58ad-405a-8e81-4a26cde1b18f | 3              | true       | true        | true        | true         |
  | d8a4c2d5-92eb-49b2-9ead-a60b08db3156 | 3              | true       | true        | true        | true         |
- Every project builds a v3 snapshot with both domains, and both domain hashes compute.
  | versions | pre_bump_still_matching | post_bump_matching_expected | without_domain_hashes |
  |----------|-------------------------|-----------------------------|-----------------------|
  | 13       | 0                       | 2                           | 6                     |
- 2 POST-bump version(s) match their project's current
  hash, which is correct: a v2 version on a project nobody has edited since
  should match. This row used to be counted as a failure.
- All 13 version(s) read dirty against the live project, and 6 carry no domain hashes — correct and not backfillable: a v1 snapshot has no `network` domain. The next freeze on each project writes all three.

### WP 4.1 — D36's six PostgREST writers, as the audit log holds them
<!-- at 2026-09-25T19:38:33.072Z -->

  | target_type                  | action             | rows  | actor_known | actor_unknown |
  |------------------------------|--------------------|-------|-------------|---------------|
  | supply_chain_data            | update             | 10300 | 0           | 10300         |
  | network_nodes                | update             | 2268  | 2           | 2266          |
  | scenarios                    | update             | 187   | 0           | 187           |
  | scenarios                    | insert             | 23    | 0           | 23            |
  | scenarios                    | delete             | 18    | 0           | 18            |
  | policy_defaults              | update             | 19    | 6           | 13            |
  | dataset_versions             | insert             | 7     | 0           | 7             |
  | policy_overrides             | delete             | 19    | 15          | 4             |
  | products                     | update             | 3     | 0           | 3             |
  | bom_single_level             | delete             | 2     | 0           | 2             |
  | node_list                    | delete             | 2     | 0           | 2             |
  | policy_overrides             | insert             | 14    | 12          | 2             |
  | policy_overrides             | update             | 9     | 7           | 2             |
  | bom_multi_level              | delete             | 1     | 0           | 1             |
  | customers                    | insert             | 1     | 0           | 1             |
  | inbound_logistics            | delete             | 1     | 0           | 1             |
  | materials                    | insert             | 2     | 1           | 1             |
  | network_nodes                | insert             | 1     | 0           | 1             |
  | node_list                    | update             | 12    | 11          | 1             |
  | policy_defaults              | delete             | 2     | 1           | 1             |
  | policy_overrides             | remediate          | 1     | 0           | 1             |
  | products                     | insert             | 2     | 1           | 1             |
  | suppliers                    | insert             | 2     | 1           | 1             |
  | tier2_lane_tables            | natural_key_dedup  | 1     | 0           | 1             |
  | analysis_results             | insert             | 2     | 2           | 0             |
  | analysis_runs                | insert             | 2     | 2           | 0             |
  | analysis_runs                | update             | 2     | 2           | 0             |
  | bom_single_level             | insert             | 2     | 2           | 0             |
  | inbound_logistics            | insert             | 1     | 1           | 0             |
  | ingest_files                 | ingest_file_landed | 11    | 11          | 0             |
  | node_list                    | insert             | 5     | 5           | 0             |
  | outbound_logistics           | insert             | 1     | 1           | 0             |
  | policy_defaults              | insert             | 2     | 2           | 0             |
  | policy_versions              | delete             | 10    | 10          | 0             |
  | policy_versions              | insert             | 31    | 31          | 0             |
  | suppliers                    | update             | 1     | 1           | 0             |
  | supply_chain_data            | delete             | 1     | 1           | 0             |
  | supply_chain_data            | insert             | 2     | 2           | 0             |
  | supply_chain_data_multi_tier | delete             | 4     | 4           | 0             |
  | supply_chain_data_multi_tier | insert             | 5     | 5           | 0             |
- **12840 data-plane row(s) record `actor_known: false`.** That is honest and it is not attribution (§2.1 `audit-actor`). This package moves the six PostgREST writes into RPCs that take the actor as a parameter; the after-run is how we find out whether the number moved for a path anyone actually ran.

### WP 4.2 — the four DERIVED tables, and D19 as a quantity
<!-- at 2026-09-25T19:38:33.958Z -->

  | tbl             | rows | projects | rows_with_computed | rows_geocoded |
  |-----------------|------|----------|--------------------|---------------|
  | node_list       | 1755 | 8        | 0                  | 108           |
  | network_nodes   | 1824 | 2        | 1824               | 1327          |
  | network_edges   | 2129 | 1        | 0                  | 0             |
  | network_summary | 0    | 0        | 0                  | 0             |

- **5708 row(s) across the four tables, 1824 of them carrying at least one COMPUTED column and NONE of them carrying an input hash** — no tier-3 table has `computed_from_hash` yet. That is D19 as a number rather than an adjective, and it is WP 4.3's before-figure.
  | project                 | node_list | network_nodes | network_edges | network_summary | nodes_with_metrics |
  |-------------------------|-----------|---------------|---------------|-----------------|--------------------|
  | Demo Simulation Project | 0         | 0             | 0             | 0               | 0                  |
  | Project AA - ver3       | 242       | 1385          | 2129          | 0               | 1003               |
  | Project 1               | 154       | 0             | 0             | 0               | 0                  |
  | Project 2               | 242       | 0             | 0             | 0               | 0                  |
  | First Project           | 0         | 0             | 0             | 0               | 0                  |
  | Project TRON - ver1     | 25        | 0             | 0             | 0               | 0                  |
  | Example — 1P/2M/3S      | 7         | 0             | 0             | 0               | 0                  |
  | Project TRON - ver2     | 638       | 0             | 0             | 0               | 0                  |
  | Project 3 - test AI     | 0         | 0             | 0             | 0               | 0                  |
  | Aumovio                 | 439       | 439           | 0             | 0               | 439                |
  | Test_Simulation         | 8         | 0             | 0             | 0               | 0                  |
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
<!-- at 2026-09-25T19:38:36.780Z -->

  | store_tables | store_functions | partial_unique_key | audit_triggers |
  |--------------|-----------------|--------------------|----------------|
  | 2            | 5               | 1                  | 6              |
- Landed: both tables, all five functions, the partial unique key and all six audit triggers.
  | definition                                                                                                                                                                         |
  |------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | CREATE UNIQUE INDEX analysis_runs_key_uniq ON public.analysis_runs USING btree (project_id, analysis_kind, input_hash, params_hash, code_version) WHERE (status <> 'failed'::text) |
  | runs | results | projects | runs_with_no_actor |
  |------|---------|----------|--------------------|
  | 2    | 878     | 1        | 0                  |
  | rows | null_uid | rows_a_unique_index_would_reject | duplicated_keys |
  |------|----------|----------------------------------|-----------------|
  | 1824 | 0        | 0                                | 0               |

- **0 row(s) across 0 duplicated key(s)** would be rejected by the unique index `calculate-network-science-metrics:115` already names in its `onConflict`. Until it exists that upsert raises `42P10` on every run, the handler logs and carries on, and the per-node update loop then matches nothing (D72). `null_uid` is 0 — a nullable key column means the index must be `NULLS NOT DISTINCT` or it constrains every row except those (D5).

### WP 4.3 / 4.4 — provenance coverage, and D70's realised damage
<!-- at 2026-09-25T19:38:40.791Z -->

  | tbl               | rows | no_provenance | projects |
  |-------------------|------|---------------|----------|
  | network_nodes     | 1824 | 1385          | 2        |
  | network_summary   | 0    | 0             | 0        |
  | node_list         | 1755 | 1755          | 8        |
  | supply_chain_data | 5452 | 5452          | 8        |
- **8592 of 9031** derived row(s) carry NO input hash. Those are rows
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
<!-- at 2026-09-25T19:38:44.552Z -->

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
  | policy_versions    | 91   |
  | recovery_playbooks | 7    |
  | scenario_templates | 12   |
  | scenarios          | 14   |
- Every one of these is now described, governed and audited by three triggers.
- A table with 0 rows here is not a finding on its own: `external_evidence` fills
  only when an agent has run, and `policy_presets` is D126's subject.

### WP 8.0 — the graph layer, measured before it is changed (D127–D133)
<!-- at 2026-09-25T19:38:47.155Z -->

  | project                 | bom_level | bom_single | bom_multi | max_bom_depth | inbound | outbound | scd_rows | scdmt_rows |
  |-------------------------|-----------|------------|-----------|---------------|---------|----------|----------|------------|
  | Demo Simulation Project | single    | 0          | 0         | 0             | 0       | 0        | 0        | 0          |
  | Project AA - ver3       | multi     | 0          | 396       | 4             | 321     | 1        | 767      | 767        |
  | Project 1               | single    | 95         | 0         | 0             | 123     | 10       | 228      | 0          |
  | Project 2               | multi     | 0          | 396       | 4             | 305     | 1        | 670      | 751        |
  | First Project           | multi     | 0          | 0         | 0             | 0       | 0        | 0        | 0          |
  | Project TRON - ver1     | single    | 12         | 0         | 0             | 12      | 2        | 26       | 26         |
  | Example — 1P/2M/3S      | single    | 2          | 0         | 0             | 3       | 1        | 6        | 6          |
  | Project TRON - ver2     | single    | 596        | 0         | 0             | 560     | 17       | 1173     | 1173       |
  | Project 3 - test AI     | single    | 0          | 0         | 0             | 0       | 0        | 0        | 0          |
  | Aumovio                 | single    | 2202       | 0         | 0             | 367     | 6        | 2575     | 2575       |
  | Test_Simulation         | single    | 2          | 0         | 0             | 4       | 1        | 7        | 7          |

- **8 of 11 project(s) are `bom_level = 'single'`**, and 3 of those hold ZERO `supply_chain_data_multi_tier` rows. That was **D130**: the edge function built the multi-tier lanes only inside its multi-level branch, so a single-level project's Process-level page was permanently empty and no error said why. **WP 8.2 CLOSED IT IN THE WRITER, AND A NON-ZERO COUNT HERE IS NOT THE EXIT CHECK** — the surviving ETL never reads `projects.bom_level` and builds both lanes from whichever BOM rows exist, but it changed what a combine WRITES and backfilled nothing. A single-level project still reads ZERO here until somebody presses Combine on it. **This line measures ADOPTION, not the fix**, which is the distinction §4 D88 cost three packages to learn.
- **5 single-level project(s) DO hold multi-tier rows**, which the current ETL cannot produce — they predate a change, or were written by another path. Read them before WP 8.2 backfills the lane, because a backfill that assumes the table is empty would double the graph.
- **2 project(s) have a multi-level BOM at all; 2 of them are exactly 4 levels deep.** `ProcessLevelNetwork.tsx`'s ladder calls level 5 a supplier and the inbound lane writes `max BOM depth + 1`, so the ladder is right on the 4-deep ones and wrong on every other one — suppliers there are rendered and labelled `material level N`. That is **D127** as a count of affected projects.
  | project             | data_source | level | rows | distinct_from | distinct_to |
  |---------------------|-------------|-------|------|---------------|-------------|
  | Aumovio             | bom         | 1     | 2202 | 367           | 6           |
  | Aumovio             | inbound     | 1     | 367  | 65            | 367         |
  | Aumovio             | outbound    | 0     | 6    | 6             | 1           |
  | Example — 1P/2M/3S  | bom         | 1     | 2    | 2             | 1           |
  | Example — 1P/2M/3S  | inbound     | 1     | 3    | 3             | 2           |
  | Example — 1P/2M/3S  | outbound    | 0     | 1    | 1             | 1           |
  | Project 2           | bom         | 1     | 7    | 7             | 3           |
  | Project 2           | bom         | 2     | 29   | 29            | 5           |
  | Project 2           | bom         | 3     | 45   | 45            | 29          |
  | Project 2           | bom         | 4     | 316  | 179           | 29          |
  | Project 2           | inbound     | 5     | 353  | 32            | 179         |
  | Project 2           | outbound    | 0     | 1    | 1             | 1           |
  | Project AA - ver3   | bom         | 2     | 397  | 260           | 66          |
  | Project AA - ver3   | inbound     | 1     | 16   | 1             | 16          |
  | Project AA - ver3   | inbound     | 5     | 353  | 32            | 179         |
  | Project AA - ver3   | outbound    | 0     | 1    | 1             | 1           |
  | Project TRON - ver1 | bom         | 1     | 12   | 12            | 2           |
  | Project TRON - ver1 | inbound     | 1     | 12   | 9             | 12          |
  | Project TRON - ver1 | outbound    | 0     | 2    | 2             | 2           |
  | Project TRON - ver2 | bom         | 1     | 596  | 559           | 17          |
  | Project TRON - ver2 | inbound     | 1     | 560  | 60            | 560         |
  | Project TRON - ver2 | outbound    | 0     | 17   | 17            | 1           |
  | Test_Simulation     | bom         | 1     | 2    | 2             | 1           |
  | Test_Simulation     | inbound     | 2     | 4    | 4             | 2           |
  | Test_Simulation     | outbound    | 0     | 1    | 1             | 1           |

- The inbound lane — every row of which is a SUPPLIER edge by construction — occupies level(s) **1, 2, 5**. The ladder recognises a supplier at 5 and above only. Any other value in that list is a supplier the page types as a material.
  | tbl                          | project             | to_empty | to_null | from_empty | from_null | bom_level_1_rows |
  |------------------------------|---------------------|----------|---------|------------|-----------|------------------|
  | supply_chain_data            | Aumovio             | 0        | 0       | 0          | 0         | 2202             |
  | supply_chain_data            | Example — 1P/2M/3S  | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data            | Project 1           | 0        | 0       | 0          | 0         | 95               |
  | supply_chain_data            | Project 2           | 0        | 0       | 0          | 0         | 316              |
  | supply_chain_data            | Project AA - ver3   | 0        | 0       | 0          | 0         | 397              |
  | supply_chain_data            | Project TRON - ver1 | 0        | 0       | 0          | 0         | 12               |
  | supply_chain_data            | Project TRON - ver2 | 0        | 0       | 0          | 0         | 596              |
  | supply_chain_data            | Test_Simulation     | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data_multi_tier | Aumovio             | 0        | 0       | 0          | 0         | 2202             |
  | supply_chain_data_multi_tier | Example — 1P/2M/3S  | 0        | 0       | 0          | 0         | 2                |
  | supply_chain_data_multi_tier | Project 2           | 0        | 0       | 0          | 0         | 7                |
  | supply_chain_data_multi_tier | Project AA - ver3   | 0        | 0       | 0          | 0         | 0                |
  | supply_chain_data_multi_tier | Project TRON - ver1 | 0        | 0       | 0          | 0         | 12               |
  | supply_chain_data_multi_tier | Project TRON - ver2 | 0        | 0       | 0          | 0         | 596              |
  | supply_chain_data_multi_tier | Test_Simulation     | 0        | 0       | 0          | 0         | 2                |

- **No empty endpoints.** Either the BOM roots reach the product already, or no project has a level-1 BOM row for the defect to act on — the `bom_level_1_rows` column above says which, and a zero there makes D129 latent rather than absent.
  | project             | nodes | nodes_at_many_levels | nodes_in_many_lanes | rows_behind_them | worst_level_spread |
  |---------------------|-------|----------------------|---------------------|------------------|--------------------|
  | Aumovio             | 439   | 6                    | 373                 | 2208             | 2                  |
  | Example — 1P/2M/3S  | 7     | 1                    | 3                   | 3                | 2                  |
  | Project 2           | 294   | 243                  | 180                 | 1125             | 2                  |
  | Project AA - ver3   | 294   | 197                  | 196                 | 754              | 2                  |
  | Project TRON - ver1 | 25    | 2                    | 14                  | 14               | 2                  |
  | Project TRON - ver2 | 638   | 17                   | 576                 | 613              | 2                  |
  | Test_Simulation     | 8     | 3                    | 3                   | 9                | 2                  |

- **469 node(s) appear at more than one `level`.** For every one of them the page's node map is written by whichever row the loop reached last — its level, its type, its lane and its colour. The guard meant to prevent that tests a key the map is never keyed by, so it has never fired once. `levelNodeCounts` is incremented in the same unreachable-guard block, which is why the legend counts and the "BOM levels" tile count ROWS rather than nodes: **D128**.
  | project             | nodes | supplier_and_customer | supplier_and_material | material_and_product | any_dual_role |
  |---------------------|-------|-----------------------|-----------------------|----------------------|---------------|
  | Aumovio             | 439   | 0                     | 0                     | 0                    | 0             |
  | Example — 1P/2M/3S  | 7     | 0                     | 0                     | 0                    | 0             |
  | Project 1           | 154   | 0                     | 0                     | 0                    | 0             |
  | Project 2           | 242   | 0                     | 0                     | 0                    | 0             |
  | Project AA - ver3   | 294   | 0                     | 0                     | 65                   | 65            |
  | Project TRON - ver1 | 25    | 0                     | 0                     | 0                    | 0             |
  | Project TRON - ver2 | 638   | 0                     | 0                     | 0                    | 0             |
  | Test_Simulation     | 8     | 0                     | 0                     | 0                    | 0             |

- **65 node(s) hold more than one lane role**, and each one is where the classifiers diverge by construction: `classify_node_type` resolves a supplier-and-material node to `material` by its priority order, `ProductLevelNetwork` resolves it to A or B depending on which row it read last, `ProcessLevelNetwork` resolves it to `supplier` through its `inbound` override, and `MapView`'s binary supplier-else-customer test drops it from the map. Same node, four answers, one screen apart (**D127**).
- 0 are BOTH a supplier and a customer — **D131**: identity is a bare string with no role in it, so the two collapse into one node. 0 are a supplier and a material; 65 are a material and a product, which is the `subassembly` the SQL classifier has no value for and WP 8.1 adds.
  | project                 | node_list_rows | scd_nodes | scdmt_nodes | scdmt_nodes_untyped | node_list_untyped |
  |-------------------------|----------------|-----------|-------------|---------------------|-------------------|
  | Demo Simulation Project | 0              | 0         | 0           | 0                   | 0                 |
  | Project AA - ver3       | 242            | 294       | 294         | 52                  | 0                 |
  | Project 1               | 154            | 154       | 0           | 0                   | 0                 |
  | Project 2               | 242            | 242       | 294         | 52                  | 0                 |
  | First Project           | 0              | 0         | 0           | 0                   | 0                 |
  | Project TRON - ver1     | 25             | 25        | 25          | 0                   | 0                 |
  | Example — 1P/2M/3S      | 7              | 7         | 7           | 0                   | 0                 |
  | Project TRON - ver2     | 638            | 638       | 638         | 0                   | 0                 |
  | Project 3 - test AI     | 0              | 0         | 0           | 0                   | 0                 |
  | Aumovio                 | 439            | 439       | 439         | 0                   | 0                 |
  | Test_Simulation         | 8              | 8         | 8           | 0                   | 0                 |

- **104 multi-tier node(s) have no `node_list` row.** `rebuild_node_list` reads `supply_chain_data` and nothing else, so the deep-tier half of the graph — the half Process-level renders — is outside the one typed projection this repository has. That is **D132**, and it is why WP 8.1's derivation has to read both edge tables before WP 8.3 can make a page read a type instead of guessing one.
- 0 `node_list` row(s) are typed `unknown` or NULL. `classify_node_type` returns `unknown` when a node appears in no lane it recognises, and `ProductLevelNetwork.tsx` defaults an unrecognised group to **Supplier** rather than rendering it as unknown — a value displayed for data that does not carry it, which is T1.
  | scd_rows | scd_group_written | scdmt_rows | scdmt_level_null | scdmt_level_zero | depth_alias_broken |
  |----------|-------------------|------------|------------------|------------------|--------------------|
  | 5452     |                   | 5305       | 0                | 29               | 5298               |

- **Shape measured:** `data_source_group` is GONE, `bom_depth` EXISTS. WP 8.2 drops the first and adds the second, and its migrations deploy on MERGE — so a report taken from a feature branch measures the schema WITHOUT them, and this line says which one this run saw rather than leaving it to be inferred.
- **`data_source_group` is gone, with its contract claim, and that closes D133.** It was written on 0 of 5 445 rows while its sidecar told readers the network pages filter on it. Writing it was the worse of the two outcomes D133 allowed: `data_source` holds three values and a "coarser grouping" of three is not a grouping.
- **0 row(s) carry a NULL `level`** and 29 carry 0. The read path no longer substitutes 0 for a NULL (D134 closed by WP 8.2), so a NULL here now reaches the page as a NULL. **A non-zero count is no longer a defect — it is an unknown depth arriving as unknown**, which is what the column is for.
- **5298 row(s) have `level` different from `bom_depth`.** `level` is supposed to be a deprecated ALIAS carrying the same value. Something wrote one without the other, and every page still reading `level` is reading a value the honest column disagrees with.
- **AND THE ROWS THIS DEPLOY DID NOT FIX ARE THE POINT.** WP 8.2 changed what a combine WRITES, not what is stored: every project still holds the graph its last combine produced, at whatever `level` that writer meant. `Project AA - ver3` needs Combine re-run. Probe 8's histogram is where to check it.

### WP 8.0 — WHICH ETL wrote this graph, and what it invented (D140, D141)
<!-- at 2026-09-25T19:38:54.219Z -->

  | project                 | bom_table_max_depth | bom_table_depths | lane_bom_levels | lane_inbound_levels |
  |-------------------------|---------------------|------------------|-----------------|---------------------|
  | Demo Simulation Project | 0                   | 0                |                 |                     |
  | Project AA - ver3       | 4                   | 5                | 2               | 1,5                 |
  | Project 1               | 0                   | 0                |                 |                     |
  | Project 2               | 4                   | 5                | 1,2,3,4         | 5                   |
  | First Project           | 0                   | 0                |                 |                     |
  | Project TRON - ver1     | 0                   | 0                | 1               | 1                   |
  | Example — 1P/2M/3S      | 0                   | 0                | 1               | 1                   |
  | Project TRON - ver2     | 0                   | 0                | 1               | 1                   |
  | Project 3 - test AI     | 0                   | 0                |                 |                     |
  | Aumovio                 | 0                   | 0                | 1               | 1                   |
  | Test_Simulation         | 0                   | 0                | 1               | 2                   |

- **1 project(s) have a multi-depth BOM whose entire bom lane sits at level 2**, and 1 carry a ladder of several levels. Those are the two ETLs' fingerprints: the SQL RPC writes a LITERAL `2` for every `bom_multi_level` row and the edge function writes `row.level || 1`, so the histogram says which one last ran — and a page reading a fixed echelon ladder is reading a column whose meaning depends on that. **D140**: two live writers, one column, two definitions.
- The `lane_inbound_levels` column is the same story on the other lane. Both writers use a `max BOM depth + 1` shape there, so a material absent from `bom_multi_level` lands at **1** and one at depth 4 lands at **5** — two suppliers, four levels apart, in the same upload. The page's ladder calls the first a material.
  | project                 | scdmt_root_edges | scd_root_edges | node_list_root | bom_roots |
  |-------------------------|------------------|----------------|----------------|-----------|
  | Demo Simulation Project | 0                | 0              | 0              | 0         |
  | Project AA - ver3       | 0                | 0              | 0              | 0         |
  | Project 1               | 0                | 0              | 0              | 0         |
  | Project 2               | 0                | 0              | 0              | 0         |
  | First Project           | 0                | 0              | 0              | 0         |
  | Project TRON - ver1     | 0                | 0              | 0              | 0         |
  | Example — 1P/2M/3S      | 0                | 0              | 0              | 0         |
  | Project TRON - ver2     | 0                | 0              | 0              | 0         |
  | Project 3 - test AI     | 0                | 0              | 0              | 0         |
  | Aumovio                 | 0                | 0              | 0              | 0         |
  | Test_Simulation         | 0                | 0              | 0              | 0         |

- **No `ROOT` edges.** The substitution is in the live RPC and has produced nothing measurable — either no project has a parentless BOM row (the `bom_roots` column says: 0 across all projects), or the lane predates it. A zero here makes D141 latent, not absent: the `COALESCE` is still what the next parentless row meets.
- 0 `bom_multi_level` row(s) have no parent at all, which is how many finished-product edges the two writers have to get right. The edge function drops them (the demand walk finds no parent, so the child gets no root and the row is never emitted); the RPC points them at `ROOT`. **Neither writes the product** — which is D129, restated against what the data actually shows rather than against the `|| ''` a reader sees first.
  | project                 | inbound_src | inbound_lane | outbound_src | outbound_lane | bom_src | bom_lane | lane_written                  | inbound_touched               |
  |-------------------------|-------------|--------------|--------------|---------------|---------|----------|-------------------------------|-------------------------------|
  | Demo Simulation Project | 0           | 0            | 0            | 0             | 0       | 0        |                               |                               |
  | Project AA - ver3       | 321         | 369          | 1            | 1             | 396     | 397      | 2026-07-05 20:22:45.384569+00 | 2026-07-05 20:22:45.213329+00 |
  | Project 1               | 123         | 0            | 10           | 0             | 95      | 0        |                               | 2025-10-10 17:43:50.291605+00 |
  | Project 2               | 305         | 353          | 1            | 1             | 396     | 397      | 2025-10-10 17:46:14.424248+00 | 2025-10-10 17:46:02.295723+00 |
  | First Project           | 0           | 0            | 0            | 0             | 0       | 0        |                               |                               |
  | Project TRON - ver1     | 12          | 12           | 2            | 2             | 12      | 12       | 2026-06-12 18:50:18.412521+00 | 2026-06-12 18:50:03.886856+00 |
  | Example — 1P/2M/3S      | 3           | 3            | 1            | 1             | 2       | 2        | 2026-07-12 02:00:12.353602+00 | 2026-07-12 02:00:12.167048+00 |
  | Project TRON - ver2     | 560         | 560          | 17           | 17            | 596     | 596      | 2026-07-13 11:18:46.322293+00 | 2026-07-13 11:18:44.595838+00 |
  | Project 3 - test AI     | 0           | 0            | 0            | 0             | 0       | 0        |                               |                               |
  | Aumovio                 | 367         | 367          | 6            | 6             | 2202    | 2202     | 2026-09-15 16:55:01.594943+00 | 2026-09-15 16:53:35.539218+00 |
  | Test_Simulation         | 4           | 4            | 1            | 1             | 2       | 2        | 2026-09-22 21:32:00.898271+00 | 2026-09-22 21:31:45.555541+00 |

- **2 project(s) have an inbound lane whose row count does not match `inbound_logistics`.** Neither writer is a trigger: both are invoked by a client, so a CSV uploaded after the last combine changes the source table and leaves the graph exactly as it was. The page then renders a graph of a world that no longer exists, with no staleness signal on it — **D142**, and it is the one defect in this phase that a user would describe as "the map looks wrong" without any classifier being involved at all.
- `lane_written` beside `inbound_touched` is the direct comparison. A source touched AFTER the lane was written is a graph derived from data that has since changed, and `project_freshness` is shown on Product-level and on no other network page.

### §15 · WP 7.1 stage 0 — the access surface, from the live database
<!-- at 2026-09-25T19:38:56.919Z -->

  | policies | tables | no_predicate | no_predicate_write | via_guc | via_auth_uid |
  |----------|--------|--------------|--------------------|---------|--------------|
  | 168      | 78     | 48           | 16                 | 54      | 13           |
- **48 of 168** policies refuse nothing: no USING and no
  WITH CHECK, or one that is literally `true`. Those are what makes the product
  work while it runs as `anon`, and stage 3 is what replaces them.
- **54** name the GUC path (`get_current_user_id` /
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
  | bom_multi_level           | 2                     | SELECT         |
  | bom_single_level          | 2                     | SELECT         |
  | capabilities              | 1                     | SELECT         |
  | chat_plans                | 1                     | SELECT         |
  | customers                 | 2                     | ALL, SELECT    |
  | dataset_versions          | 2                     | INSERT, SELECT |
  | experiments               | 1                     | ALL            |
  | external_evidence         | 1                     | SELECT         |
  | inbound_logistics         | 2                     | SELECT         |
  | materials                 | 2                     | ALL, SELECT    |
  | model_validations         | 1                     | SELECT         |
  | outbound_logistics        | 2                     | SELECT         |
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
  | simulation_runs           | 2                     | ALL            |
  | suppliers                 | 2                     | ALL, SELECT    |
- **30 table(s).** `governanceEnforcement.test.ts` pins a list of 27 read
  from the migrations; this is the same question asked of production.
- Stage 3 adds ONE restrictive policy per table here. A restrictive policy ANDs
  with whatever is already present, so `DROP POLICY` is an exact undo — which is
  why the plan prefers it to rewriting each permissive policy in place.
  | grantee       | select_on | write_privs | writable_tables |
  |---------------|-----------|-------------|-----------------|
  | anon          | 85        | 258         | 86              |
  | authenticated | 87        | 260         | 87              |
  | service_role  | 88        | 263         | 88              |
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
  | dataset_versions                 | DELETE, INSERT, UPDATE |
  | delegation_grants                | DELETE, INSERT, UPDATE |
  | disruption_scenario_effects      | DELETE, INSERT, UPDATE |
  | disruption_scenario_profiles     | DELETE, INSERT, UPDATE |
  | disruption_scenario_settings     | DELETE, INSERT, UPDATE |
  | disruption_scenario_targets      | DELETE, INSERT, UPDATE |
  | disruption_scenarios             | DELETE, INSERT, UPDATE |
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
  | policy_defaults                  | DELETE, INSERT, UPDATE |
  | policy_overrides                 | DELETE, INSERT, UPDATE |
  | policy_presets                   | DELETE, INSERT, UPDATE |
  | policy_versions                  | DELETE, INSERT, UPDATE |
  | products                         | DELETE, INSERT, UPDATE |
  | project_erp_links                | DELETE, INSERT, UPDATE |
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
  | sc_edges                         | DELETE, INSERT, UPDATE |
  | sc_nodes                         | DELETE, INSERT, UPDATE |
  | scenario_templates               | DELETE, INSERT, UPDATE |
  | scenarios                        | DELETE, INSERT, UPDATE |
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
  | tier2_suppliers                  | DELETE, INSERT, UPDATE |
  | tier3_suppliers                  | DELETE, INSERT, UPDATE |
  | user_ai_permissions              | DELETE, INSERT, UPDATE |
  | user_capabilities                | DELETE, INSERT, UPDATE |
  | user_files                       | DELETE, INSERT, UPDATE |
  | v_admin_user_usage               | DELETE, INSERT, UPDATE |
- **86 table(s).** §14 counts 7 from migration history; a difference here
  changes stage 4's size and is the kind of thing only a live read can say.
  | auth_users | approved_users | approved_with_matching_auth_row |
  |------------|----------------|---------------------------------|
  | 1          | 14             | 0                               |
- **0 of 14** approved users have a matching `auth.users` row (`auth.users`
  holds 1). Where they do not, stage 1 cannot simply mint a session for the
  existing uuid — it has to create the auth identity first, which is a larger
  change than the plan's stage 1 describes and must be re-planned before stage 2.
  | granted_to         | policies | tables |
  |--------------------|----------|--------|
  | public             | 103      | 50     |
  | authenticated      | 37       | 25     |
  | anon,authenticated | 28       | 25     |
- **No policy is granted to `anon` alone**, so switching a request from `anon` to
  `authenticated` takes no policy away from it. Stage 1 is safe on this axis.
- A `public` row is the benign case: `TO public` covers every role, so the role
  change is invisible to it.
  (no rows)
- **None.** Every privilege `anon` holds, `authenticated` holds too, so the role
  change stage 1 causes cannot produce a permission error before RLS is reached.

**RLS on, every write policy has a predicate** — 46 table(s)

  ai_budgets, ai_models, ai_providers, api_rate_limits, bom_multi_level, bom_single_level, capabilities, disruption_scenario_effects, disruption_scenario_profiles, disruption_scenario_settings, disruption_scenario_targets, disruption_scenarios, inbound_logistics, ingest_files, ingest_runs, ingest_staged_bom_lines, ingest_staged_bom_versions, ingest_staged_products, ingest_staged_rows, multi_tier_supply_chain, network_edges, network_nodes, network_summary, node_list, org_capabilities, organization_members, organizations, outbound_logistics, policy_defaults, policy_overrides, policy_presets, project_erp_links, projects, recovery_playbooks, role_capabilities, simulation_cache, simulation_job_magnitudes, simulation_jobs, simulation_performance_metrics, simulation_results, supply_chain_data, supply_chain_data_multi_tier, tier2_suppliers, tier3_suppliers, user_ai_permissions, user_capabilities

**RLS on, NO write policy — denied today** — 23 table(s)

  ai_chat_events, ai_model_capabilities, ai_usage_logs, analysis_results, analysis_runs, api_idempotency, api_keys, api_request_logs, audit_logs, chat_folders, chat_messages, chat_plans, chat_threads, delegation_grants, external_evidence, model_validations, project_members, project_memory, project_role_capabilities, proposals, risk_data, scenario_templates, user_files

**RLS on, a write policy that refuses nothing** — 11 table(s)

  customers, dataset_versions, experiments, materials, policy_versions, products, run_item_series, run_replications, scenarios, simulation_runs, suppliers

**view (grant only; RLS lives on the base table)** — 6 table(s)

  admin_org_file_usage, sc_edges, sc_nodes, simulation_result_scenarios, simulation_results_with_settings, v_admin_user_usage

- **11 table(s) are genuinely writable by an anonymous caller today.** That is the
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
<!-- at 2026-09-25T19:39:06.280Z -->

**Q5 · F-18 — which engine produced the stored runs** (every status):
  | code_version | status | runs | claiming_reps | first_seen | last_seen  |
  |--------------|--------|------|---------------|------------|------------|
  | scsim-0.2.3  | done   | 18   | 18            | 2026-07-13 | 2026-09-20 |
  | scsim-0.2.8  | done   | 4    | 4             | 2026-09-25 | 2026-09-25 |
  | scsim-0.2.2  | done   | 3    | 3             | 2026-07-12 | 2026-07-12 |
  | scsim-0.2.1  | done   | 3    | 3             | 2026-07-12 | 2026-07-12 |
  | (blank)      | failed | 2    | 0             | 2026-09-17 | 2026-09-17 |
  | scsim-0.2.7  | done   | 2    | 2             | 2026-09-25 | 2026-09-25 |

**Q6 · F-18 — `rep_count_done` against the replication rows that exist:**
  | code_version | status | runs | count_disagrees | claims_over_empty | claimed | persisted |
  |--------------|--------|------|-----------------|-------------------|---------|-----------|
  | scsim-0.2.3  | done   | 18   | 0               | 0                 | 284     | 284       |
  | scsim-0.2.8  | done   | 4    | 0               | 0                 | 40      | 40        |
  | scsim-0.2.1  | done   | 3    | 3               | 3                 | 13      | 0         |
  | scsim-0.2.2  | done   | 3    | 1               | 1                 | 90      | 60        |
  | (blank)      | failed | 2    | 0               | 0                 | 0       | 0         |
  | scsim-0.2.7  | done   | 2    | 0               | 0                 | 201     | 201       |

**Q2 · F-04 — replications whose `pre_disruption_fill_rate` is exactly 1.0**
(the substituted value when `pre` is empty; a genuine perfect pre-window is also
1.0, so Q1 below is what separates the two):
  | runs_with_baseline | reps_with_baseline | reps_at_exactly_1 | runs_touched |
  |--------------------|--------------------|-------------------|--------------|
  | 10                 | 180                | 20                | 4            |

**Q3 · F-05 — TTR/TTS values, and how many sit at the censoring sentinel**
(the engine window is 52 weeks, so a value ≥ 52 is "never recovered"):
  | runs | reps | ttr_at_window | tts_at_window | ttr_zero | mean_ttr | max_ttr |
  |------|------|---------------|---------------|----------|----------|---------|
  | 10   | 180  | 0             | 0             | 20       | 8.91     | 20.0    |

**Q1 · F-03 — scheduled disruptions whose mapped start week is inside the warm-up:**
  | done_runs_with_disruptions | disruptions | start_in_detected_warmup | runs_affected | min_t_w | max_t_w | mean_t_w |
  |----------------------------|-------------|--------------------------|---------------|---------|---------|----------|
  | 11                         | 12          | 5                        | 5             | 0       | 25      | 8.3      |
  | scenarios_with_disruptions | disruptions | still_the_default | start_inside_authored_warmup | shorter_than_one_tick |
  |----------------------------|-------------|-------------------|------------------------------|-----------------------|
  | 8                          | 9           | 0                 | 0                            | 0                     |

**Q4 · F-06/F-07/F-30 — run states that should not exist:**
  | running_over_2h | queued_over_2h | failed_or_cancelled_with_reps | cancelled | done_mentioning_cancel | total |
  |-----------------|----------------|-------------------------------|-----------|------------------------|-------|
  | 0               | 0              | 0                             | 0         | 0                      | 32    |

**Q7 · F-19(a) — runs dispatched with the gate skipped:**
  | runs | gate_skipped_runs | projects |
  |------|-------------------|----------|
  | 32   | 0                 | 0        |

**Q8 · F-19(b) — the largest project per gate table against the 50 000-row ceiling:**
  | t                  | largest_project_rows | projects_over |
  |--------------------|----------------------|---------------|
  | bom_multi_level    | 396                  | 0             |
  | bom_single_level   | 2202                 | 0             |
  | inbound_logistics  | 560                  | 0             |
  | materials          | 560                  | 0             |
  | outbound_logistics | 17                   | 0             |

**Q9/Q10 · F-09 — `node_list.echelon` in production, beside the legacy `node_type`:**
  | echelon     | node_type | nodes | projects |
  |-------------|-----------|-------|----------|
  | material    | material  | 1403  | 8        |
  | supplier    | supplier  | 240   | 8        |
  | subassembly | material  | 58    | 2        |
  | product     | product   | 39    | 8        |
  | customer    | customer  | 15    | 8        |
  | data_source | edges | bom_depth_null | level_ne_depth | distinct_levels | min_level | max_level |
  |-------------|-------|----------------|----------------|-----------------|-----------|-----------|
  | bom         | 3608  | 3606           | 3606           | 4               | 1         | 4         |
  | inbound     | 1668  | 1664           | 1664           | 3               | 1         | 5         |
  | outbound    | 29    | 28             | 28             | 1               | 0         | 0         |

**Q11 · F-21 — `materials.holding_cost_pct`: fraction or percent?** (`project_map` multiplies by 100 and clamps to [5, 50])
  | rows_set | projects | looks_like_a_percent | below_clamp_floor | above_clamp_ceiling | min | max |
  |----------|----------|----------------------|-------------------|---------------------|-----|-----|
  | 562      | 2        | 0                    | 0                 | 0                   | 0.2 | 0.2 |

**Q12 · F-11 — runs that carry no binding of their own:**
  | runs_without_hash | runs_without_dsv | total |
  |-------------------|------------------|-------|
  | 0                 | 0                | 30    |

**Q14 · F-01 — every `ingest_runs` row by source, ever:**
  | source_kind | runs | first      | last       |
  |-------------|------|------------|------------|
  | csv         | 10   | 2026-09-22 | 2026-09-22 |

**Q15 · F-15 — rows whose project no longer exists** (every table with a `project_id` column):
  | t                    | orphans |
  |----------------------|---------|
  | ai_chat_events       | 14      |
  | disruption_scenarios | 2       |
- 49 table(s) swept; 2 hold orphaned rows.

**F-16 · open question 1 — edge functions deployed in production** (Management API, GET):
  | slug                              | version | status | verify_jwt | updated_at |
  |-----------------------------------|---------|--------|------------|------------|
  | agent-apply                       | 120     | ACTIVE | false      | 2026-09-25 |
  | api                               | 115     | ACTIVE | false      | 2026-09-25 |
  | calculate                         | 177     | ACTIVE | false      | 2025-08-25 |
  | calculate-network-science-metrics | 117     | ACTIVE | true       | 2026-09-25 |
  | calculate-node-prominence         | 212     | ACTIVE | false      | 2026-09-25 |
  | combine-project                   | 234     | ACTIVE | true       | 2026-09-25 |
  | combine-project-into-supply-chain | 218     | ACTIVE | true       | 2026-03-17 |
  | delete-project                    | 244     | ACTIVE | true       | 2026-09-25 |
  | delete-simulation-job             | 118     | ACTIVE | false      | 2026-03-17 |
  | external-simulation-processor     | 131     | ACTIVE | false      | 2026-03-17 |
  | geocode-locations                 | 297     | ACTIVE | true       | 2026-09-25 |
  | get-mapbox-token                  | 300     | ACTIVE | false      | 2026-03-17 |
  | get-multi-tier-network-data       | 176     | ACTIVE | true       | 2026-03-17 |
  | ingest-bom-multi-level            | 236     | ACTIVE | true       | 2026-03-17 |
  | ingest-file                       | 18      | ACTIVE | true       | 2026-09-25 |
  | ingest-inbound-logistics          | 234     | ACTIVE | true       | 2026-03-17 |
  | ingest-outbound-logistics         | 238     | ACTIVE | true       | 2026-03-17 |
  | predict-critical-nodes            | 420     | ACTIVE | true       | 2026-09-25 |
  | project-ai-chat                   | 208     | ACTIVE | false      | 2026-09-25 |
  | project-ai-health                 | 188     | ACTIVE | false      | 2026-09-25 |
  | report-render                     | 109     | ACTIVE | false      | 2026-09-25 |
  | session-mint                      | 35      | ACTIVE | false      | 2026-09-25 |
  | sim-command                       | 143     | ACTIVE | true       | 2026-09-25 |
  | simulation-availability-checker   | 137     | ACTIVE | false      | 2026-03-17 |
  | simulation-cache-manager          | 146     | ACTIVE | false      | 2026-03-17 |
  | simulation-runner                 | 146     | ACTIVE | false      | 2026-03-17 |
  | simulation-status                 | 146     | ACTIVE | false      | 2026-03-17 |
  | test-prominence                   | 248     | ACTIVE | false      | 2026-03-17 |
- `erp-sync-orbit-mrp` (registered as not deployed): absent
- `get-mapbox-token` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-bom-multi-level` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-inbound-logistics` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product
- `ingest-outbound-logistics` (registered as not deployed): **A BUILD IS LIVE** — the register is wrong about the product

### §15 · the project measured
<!-- at 2026-09-25T19:39:22.983Z -->

- `project_id` = `0a7040e1-a3b8-4083-a160-728782fdfb67` — **Project TRON - ver2** — chosen because it has the most inbound_logistics rows (560).

### §15 · D8 — blank / untrimmed / case-variant ids
<!-- at 2026-09-25T19:39:22.983Z -->

  | offending_rows | blank_supplier | blank_material | untrimmed_supplier | untrimmed_material |
  |----------------|----------------|----------------|--------------------|--------------------|
  | 0              | 0              | 0              | 0                  | 0                  |
- **0** normalized material ids carry more than one spelling.

### §15 · D6 — field-shift signature from an unquoted comma
<!-- at 2026-09-25T19:39:24.770Z -->

  | rows_with_quote_char |
  |----------------------|
  | 0                    |
- No row carries the field-shift signature. D6 is unexercised here — it is a parser defect, not a data defect, and WP 3.2 still owns it.

### §15 · D7 — blank numerics that passed validation
<!-- at 2026-09-25T19:39:25.685Z -->

  | null_volume | null_lead_time | null_price | nonpositive_price | total |
  |-------------|----------------|------------|-------------------|-------|
  | 0           | 0              | 0          | 0                 | 560   |

### §15 · D5 — duplicate arcs (WP 3.3's before number)
<!-- at 2026-09-25T19:39:26.529Z -->

  | duplicated_groups | surplus_rows | worst_group |
  |-------------------|--------------|-------------|
  | 0                 | 0            | 0           |

Against `inbound_logistics`'s `natural_key_intended` (`project_id + plant_name + supplier_id + material_id`) — this is the number WP 3.3's `CREATE UNIQUE INDEX` has to survive:
  | duplicated_keys | rows_the_unique_index_would_reject | worst_key |
  |-----------------|------------------------------------|-----------|
  | 0               | 0                                  | 0         |

### §15 · D2 / D10 — mixed and unrecognized `time_unit`
<!-- at 2026-09-25T19:39:28.626Z -->

  | materials_with_mixed_units |
  |----------------------------|
  | 0                          |
- No material mixes time units in this project, so `sourcing_ratio` is at least internally comparable here.
- **0** distinct token(s) fall outside the recognized set and are silently read as weekly.

### §15 · D3 — `plant_name` drift between arcs and BOM
<!-- at 2026-09-25T19:39:30.526Z -->

  | orphan_plants | affected_arcs |
  |---------------|---------------|
  | 0             | 0             |

### §15 · D2 / D3 headline — rows that reached the grid weighted 0
<!-- at 2026-09-25T19:39:31.369Z -->

  | data_source | total | zero_weighted |
  |-------------|-------|---------------|
  | bom         | 596   | 0             |
  | inbound     | 560   | 0             |
  | outbound    | 17    | 0             |
  | materials_off_one |
  |-------------------|
  | 0                 |

### §15 · masters missing for multi-level BOM materials
<!-- at 2026-09-25T19:39:33.570Z -->

  | materials_without_master |
  |--------------------------|
  | 0                        |

### §15 · D17 — suppliers the grid renders as capacity 0
<!-- at 2026-09-25T19:39:34.429Z -->

  | shown_as_zero_but_unlimited | total |
  |-----------------------------|-------|
  | 60                          | 60    |

### §15 · D1 — auto-seeded zero safety stock
<!-- at 2026-09-25T19:39:35.341Z -->

  | zero_safety_stock_patches |
  |---------------------------|
  | 338                       |
- Project-scoped filtering is deliberately omitted: WP 0.1 closed the WRITE path, so the question is whether any seeded zeros survive anywhere.

### §15 · D3 / D4 — the two adopted-or-dropped tables, each against its own expectation
<!-- at 2026-09-25T19:39:36.229Z -->

- `risk_data` is present, which is CORRECT: WP 1.4 adopted it (`20260915000003_risk_data.sql`) and it is in the contract.
- `product_code_map` is gone, which is CORRECT: WP 3.0 dropped it (0 rows, no writer had ever existed).

### §15 · D175 follow-up — where each project's materials live, per source
<!-- at 2026-09-25T19:39:37.155Z -->


**(D175a) distinct material ids per source per project** — the Supplier grid renders `scd_inbound` lanes; D175 adds `bom_multi` leaves/intermediates and `master`; nothing renders a `bom_single`-only id:
  | project                 | master | bom_single | bom_multi | inbound | scd_inbound |
  |-------------------------|--------|------------|-----------|---------|-------------|
  | Aumovio                 | 367    | 367        | 0         | 367     | 367         |
  | Demo Simulation Project | 0      | 0          | 0         | 0       | 0           |
  | Example — 1P/2M/3S      | 2      | 2          | 0         | 2       | 2           |
  | First Project           | 0      | 0          | 0         | 0       | 0           |
  | Project 1               | 0      | 86         | 0         | 101     | 101         |
  | Project 2               | 179    | 0          | 260       | 179     | 179         |
  | Project 3 - test AI     | 0      | 0          | 0         | 0       | 0           |
  | Project AA - ver3       | 195    | 0          | 260       | 195     | 195         |
  | Project TRON - ver1     | 12     | 12         | 0         | 12      | 12          |
  | Project TRON - ver2     | 560    | 559        | 0         | 560     | 560         |
  | Test_Simulation         | 2      | 2          | 0         | 2       | 2           |

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
  | Test_Simulation     | M001            | true   | true       | false     | true | true        | false      |
  | Test_Simulation     | M002            | true   | true       | false     | true | true        | false      |

### Across EVERY project — what one project cannot tell you
<!-- at 2026-09-25T19:39:39.195Z -->

**`inbound_logistics`** — natural key `project_id + plant_name + supplier_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 1695 | 8        | 0                                  |

**`outbound_logistics`** — natural key `project_id + plant_name + customer_id, product_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 39   | 8        | 0                                  |

**`bom_single_level`** — natural key `project_id + plant_name + product_id, material_id`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 2909 | 6        | 0                                  |

**`bom_multi_level`** — natural key `project_id + plant_name + material_id, higher_level_component_id, level`:
  | rows | projects | rows_the_unique_index_would_reject |
  |------|----------|------------------------------------|
  | 792  | 2        | 0                                  |

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
  | 4       | 0              | 0         | 792   |
  | rows_with_untrimmed_or_blank_ids |
  |----------------------------------|
  | 0                                |

  | null_volume | null_lead_time | null_price | total |
  |-------------|----------------|------------|-------|
  | 280         | 318            | 30         | 1695  |

- **27** unrecognized `time_unit` token(s) database-wide, each silently read as weekly.
  | time_unit | rows |
  |-----------|------|
  | 21        | 19   |
  | 15        | 16   |
  | <null>    | 16   |
  | 16        | 13   |
  | 7         | 12   |
  | 14        | 11   |
  | 9         | 10   |
  | 4         | 7    |

**Which rows are actually unresolved** — D29's text branch cannot be removed while any `org_uuid_missing` row exists:
  | project_id                           | org_uuid_missing | modeler_has_no_account |
  |--------------------------------------|------------------|------------------------|
  | 4f314330-6f55-48b7-a654-8784e2778508 | true             | true                   |

**D1's surviving damage.** WP 0.1 closed the WRITE path; it did not clean what the path had already written:
  | distinct_targets | rows |
  |------------------|------|
  | 338              | 338  |

### The migration fence — did the database change under this report?
<!-- at 2026-09-25T19:39:52.357Z -->

  | end | version | applied |
  |-----|---------|---------|
  | before | 20260922000009 | 348 |
  | after  | 20260922000009 | 348 |
- **Unmoved at `20260922000009`.** No migration was applied between the first
  probe and the last, so every count in this report is of one schema.

_149 statements, all `SELECT`._
