# SuReSuite — session guidance

## Governing document — read before platform work

Any work touching the simulation platform — policies UI, data model, engine, worker,
experimentation, AI/surrogates — must first consult the design blueprint:

**`docs/design/next-gen-platform-design.md`**

Where to look inside it:

- **§2.3 Gap catalog (G1–G12)** — the numbered problems the plan closes; check which gap your task serves.
- **§13 Roadmap (Phases A–E)** — where the task sits in the sequence and its exit criteria.
- **§5 + Appendix A — policy catalog** — before adding or changing any policy, find its row (or add one).
- **§2.2 Preserved assets (A1–A15)** — design decisions that must not be broken.

## The plan — the authority for the data layer

`docs/design/next-gen-platform-design.md` says what the platform becomes.
**`docs/PLAN.md` is the single plan for getting the data layer there** — architecture,
confirmed defects, the transparency standard, the documentation manual, the work
packages, the verification SQL and the drift log. There is no second plan; the two
documents it replaced (`TRANSPARENCY.md`, `USER-DOCS-PLAN.md`) were folded in because
duplicating facts is the defect the plan exists to end.

- **§4 is the only authority for data-layer `file:line` evidence.** Anything about the
  CSV parse, ingestion, the ETL, the policy grid, the engine mapping or the migrations
  cites §4 by D-number or §4.1 row — it does not restate the line numbers. A citation
  that lives only in another document is a fact with no owner, and it goes stale within
  a quarter (D21 and D22 are what that looks like).
- **`npm run check:docs` enforces it** (`scripts/check-docs-single-source.mjs`): a
  markdown file outside the allow-list may not carry data-layer evidence at all, and an
  allow-listed *derived* file (today only `docs/PLAN-PROMPTS.md`) may not hold a fact
  the plan lacks. It runs as part of `npm run lint`.
- **Every work package ends with a gap check and a §16 drift-log entry** — what the
  previous package promised versus what this one found. If a finding changes a later
  package, edit the plan in the SAME commit.
- Commit convention: `Phase N / WP N.M / <blueprint ref>: <title>`.

## The invariants (PLAN.md §2.1) — by gate name

**Every invariant has a NAME, and you cite the name.** The plan's `§2.1` table
numbers four of them `G1`–`G4`, and the blueprint numbers eighteen *gaps* `G1`–`G18`;
on one page "G4" means both "every tier transition writes an audit row" and "no
data-entry surface for the economics". Names do not collide. `PLAN.md §2.1` remains
the authority for the statements; this table adds what the plan cannot — **where
each one is enforced today, and where it is still only a promise.**

Each is meant to be a CI gate, not an aspiration — anything unenforced drifts within
two months, which is the lesson of the two orphan tables (D3, D4, both closed in
WP 1.4). Gates land with their work packages; the rule holds from now.

| Gate name | §2.1 | Invariant | Enforced today by |
|---|---|---|---|
| `single-source` | I1 | Every data fact is authored exactly once; docs/validators/RLS generate from it | `check:docs` · `contract:check` R3 (page drift) |
| `no-tier-skip` | I2 | No tier skipping — external data never lands below T1; pages never write T3 | **MET for every CSV dataset the contract describes, since WP 3.3.** All NINE land in tier 0 (`ingest_files`) and tier 1 (`ingest_staged_rows`) and reach tier 2 only through `ingest_apply_run` — the item masters joined in `20260916000020` once the promotion became an upsert (D55). `rehearsal/070` and `090` prove it against a real database, and `ingestSpecParity.test.ts` fails if a `.split(',')` or a `bulk_upsert_*` call returns to the client. **One group still skips and it is named**: the node list and the two deep-tier network tables (D56, WP 4.2), which have no sidecar because WP 4.2 owns the decision about what tier they are. **WP 4.3 DESCRIBED THEM**: all four now carry sidecars at tier 3 — what `graphHashCoverage.test.ts` has treated them as since WP 4.1 — so they are inside the contract, inside the audit rule, and no longer a group nothing can see. They still reach their tables through the four bulk RPCs rather than through `ingest_land_file`, so the SKIP itself is unchanged; what changed is that it is a described skip on a described table. Calling the uploaded half tier 2 is WP 5.3's, after the computed columns go — sooner would fold an analysis's output into the identity of its own inputs (D56, D75). **WP 4.1 turned three more paths from a property of code into a property of the schema**: the three legacy `ingest-*` functions write through `ingest_legacy_upsert_lane`, whose target list is a whitelist in a migration — while they held a PostgREST client they were one `.upsert()` away from any tier-2 table. It also closed a path nobody had named: `erp-sync-orbit-mrp` promoted `ingest_staged_products` → `products` WITHOUT `ingest_apply_run`, per row, with no actor and no role. Still no gate saying a NEW dataset must land — enforced for the nine by the absence of any other write path, not by a check |
| `normalize-at-promotion` | I3 | Units normalize at promotion into T2; nothing downstream converts | `contract:units -- --check` (one `UNIT_DAYS`) · **the promotion converts since WP 3.3**: `ingest_apply_run` calls `rate_to_weekly`/`duration_to_weeks` INSIDE the promoting statement and writes the canonical token into the unit column, so a tier-2 row states what it is in. Authored in the sidecars (`unit_column` + `normalize_at_promotion`), restated in `ingest_normalize_at_promotion()` because SQL cannot import the generated module, and pinned by `ingestSpecParity.test.ts`; asserted in `rehearsal/090` (30.4375/month → 7/week, 14 days → 2 weeks, idempotent on re-promotion). **The second clause is NOT met**: `combine-project` and `sc_nodes` still convert — they are now exactly identity for promoted rows (×7/7) and still load-bearing for rows predating this path. Removing them is a reader change across the ETL and `project_map.py`, owned by no package yet |
| `natural-key` | I4 | Every canonical table has a natural-key unique constraint; ingestion upserts | **MET since WP 3.3.** `contract:check` R5 is a **`fail`**, flipped in the same commit that created the seven unique indexes (`20260916000018`) so neither half can outlive the other. R5 has two halves: a tier-2 table whose only uniqueness is the surrogate `id` fails, AND a table whose landed key differs from its sidecar's `natural_key_intended` fails. Every index is `NULLS NOT DISTINCT` — three of the seven keys contain a nullable column, and a plain index would constrain every row EXCEPT those while `ON CONFLICT` inserted duplicates rather than updating (§4 D5). The ingestion upserts: `ingest_apply_run` reads the arbiter from `pg_index` and raises rather than guessing. `rehearsal/080` + `090`, mutation-tested. **WP 3.4 made the key load-bearing in a second place and did not restate it**: `ingest_promotion_plan()` was lifted OUT of the promotion so the diff compares the columns the upsert would write, with the same normalized values, joining on `IS NOT DISTINCT FROM` because three of the seven keys are `NULLS NOT DISTINCT` — `rehearsal/100` §6 fails if it regresses to `=` |
| `diff-before-decision` | — | A review screen's diff is computed against tier 2 BEFORE the promotion, and re-computed inside it | `ingest_diff_run`, called at landing, on demand, and by `ingest_apply_run` in its own transaction · `ingestDiffReview.test.ts` (the DEFAULT and NOT NULL are gone; the promotion no longer overwrites the split) · `supabase/rehearsal/100`, eight mutations. **The two answers are cross-checked**: `xmax = 0`'s count of rows that already existed must equal the diff's `changed + unchanged`, and a disagreement raises rather than reporting a promotion that did something else (WP 3.4, D62–D64) |
| `input-hash` | I5 | Every derived row carries the input hash it came from | **not yet — and the OWNER in this row was wrong, which `20260917000002` found by finishing.** `20260917000002` completed the HASH: `graph_hash` covers every tier-2 value column, splits into `hash_inputs` / `hash_network`, and `graphHashCoverage.test.ts` fails when a column goes missing (D11, D67, D68 closed). But I5 is about the DERIVED ROW carrying it, and no tier-3 table has a `computed_from_hash` column. **`20260917000006` built the STORE that will**: `analysis_runs.input_hash` is written on every run from `current_graph_hash`, and `supabase/rehearsal/120` §2 fails if a run records a hash the project does not have — so the anchor now lands IN A ROW for the first time, and a run is reproducible. The invariant still is **NOT met**, because a run row is not a derived row: the four analyzers still write centralities onto `network_nodes` with nothing saying which inputs produced them (D19, measured at 1 385 such rows). **`20260917000007` LANDED THAT HALF**: `computed_from_hash` + `computed_at` on `network_nodes`, `node_list`, `network_summary` and `supply_chain_data` (not `network_edges` — every column of it is uploaded, and provenance no writer could fill is a promise, not a fact), written by `analysis_apply_node_metrics` and `analysis_mark_critical_nodes` FROM THE RUN rather than from a parameter, so a row cannot name a world its run never saw. `supabase/rehearsal/130` §2 compares the entity columns against `analysis_results` field by field and §3 fails if a row carries the wrong hash or an unwritten row carries any. **AND I5 IS STILL NOT MET, for a reason `20260917000007` found rather than inherited — D75.** `input_hash` is `current_graph_hash`, which hashes eleven tier-2 tables, and the two centrality analyzers read `network_nodes`/`network_edges`, neither of them: a re-uploaded network moves no hash, so the anchor a derived row now carries is blind to that row's own inputs. Mitigated by a DECLARED `topology_digest` in `analysis_runs.params`, which makes the cache key sound without moving a stored hash; the anchor itself is **WP 4.4's**, after D70 makes a `schema_version` bump safe. `geocode-locations` is the other gap — it writes `node_list` coordinates with no run at all (D36's class) |
| `declared-fallback` | I6 | A fallback absent from the contract may not exist in code | `contract:validate` (`engine.missing_default`) · `contract:generate` fails when the engine registry names a required field the contract has no column for |
| `ingestion-contract` | I7 | A new source implements the ingestion contract; it never touches T2 schemas | **PARTIAL since WP 3.1.** The tables are source-agnostic (`ingest_runs`, `ingest_staged_*`, `ingest_files`, `ingest_staged_rows`, with `source_kind` and `fact_class` CHECK-constrained and no DEFAULT) and `supabase/rehearsal/050`+`060` prove against a real database that a link-less run is governed and that staging reaches T2 only through a promotion. **The second source exists since WP 3.2** — `ingest-file` implements the contract and touches no T2 schema: `rehearsal/070` asserts the whole path and `ingestSpecParity.test.ts` fails if the function names a tier-2 table or a CSV header of its own. **Still a reading, not a check, for the NEXT source**: nothing forces a third one through `ingest_land_file` |
| `result-binding` | I8 | Every result binds dataset + policy + scenario + engine version | **not yet** — WP 4.4 |
| `uuid-identity` | G1 | Orgs/projects/users referenced by uuid; a displayable name is never a join key | `orgIdentity.test.ts` (no live policy, function or edge function compares an org string outside the one predicate) · the predicate itself is **uuid-only since WP 3.0** (D29) · `supabase/rehearsal/040` proves against a real database that a rename still matches and a shared display name does not. **One exception remains and it is named**: the `organizations` table's own read policy still ORs name and slug (D47, WP 6.2) |
| `declared-capability` | G2 | Every table declares read/write capability and minimum project role | `contract:validate` (`governance` is a required sidecar block) |
| `subtractive-delegation` | G3 | Delegation is subtractive and expiring | `projectMembership.test.ts` — subtraction in the RPC, `expires_at NOT NULL`, expiry applied in `effective_project_role`, and NO write policy on either table. **BEHAVIOURAL SINCE WP 3.4, in the one place a live path reads it**: `ingest_apply_run` refuses a promotion below editor and `supabase/rehearsal/100` §3 proves it against a real database with an analyst who is a genuine member. That first live reader also exposed D61 — `project_members` had one writer in its life and it ran once, so every project created after WP 2.2 had no members and its own creator no role. Closed by a trigger; until WP 3.4 nothing had ever called the resolver, so nothing could notice. The rest of the delegation surface is still source-level |
| `audit-actor` | G4 | Every tier transition writes an audit row naming the actor | `dataPlaneAudit.test.ts` (every tier 2/3/4 table **in the contract** has all three triggers, read from every migration) · `contract:check` R9 (`governance.audited` matches them — D40) · **the ROW half is now PROVEN**: `supabase/rehearsal/010` writes one tier-2 statement and asserts exactly one `plane='data'` row at statement grain naming the actor, mutation-tested (D45). **The ingestion landing joined it in WP 3.2**, by the RPC route rather than a trigger: `ingest_land_file` and `ingest_apply_run` take the actor as a PARAMETER and set `app.current_user_id` LOCAL to their own transaction, so the tier-2 trigger names the promoter and the tier-0/1 landing writes its own row naming the uploader — `rehearsal/070`, mutation-tested, including the mutation that removes the GUC. **The SQL writers joined in WP 3.3**: `assign_material_supplier` writes three tier-2/3 tables from the /policies grid and had taken the actor as a parameter all along without telling the trigger — `20260916000021` adds the one line and `rehearsal/090` reads the row back. **The promotion also names the ROLE it acted under since WP 3.4**: `ingest_apply_run` takes the actor, resolves `effective_project_role` and refuses below editor, so the audit row's actor is one the database agreed could write (`rehearsal/100`, mutation-tested). **The six PostgREST writers are CLOSED since WP 4.1** — four RPCs (`ingest_legacy_upsert_lane`, `mrp_apply_staged_products`, `etl_replace_supply_chain`, `analysis_mark_critical_nodes`), each taking the actor through one shared preamble that refuses a NULL actor and sets the GUC LOCAL — and does NOT authorize: a role gate was written, found to refuse an organization admin on `combine-project`'s live path, and removed in `20260917000005`, because `min_project_role` is D66's to make live and not four RPCs' to answer ad hoc; `supabase/rehearsal/110` §7 performs each write and READS THE ROW BACK, with the GUC deliberately poisoned first because the first draft passed for the wrong reason (§16 · WP 4.1 · E). **AND THE INVARIANT IS STILL NOT MET, which is the point of D71**: WP 4.1's gap check measured the class D36 was one slice of — **26 `SECURITY DEFINER` functions write a tier-2/3/4 table and TWO set `app.current_user_id`**; 16 of the rest already take an actor parameter and 17 have live callers. **THOSE FIGURES WERE A TEXT SCAN'S READING AND WP 4.3 CORRECTED THEM — D78**: ten of the 26 attribute through `set_current_user_context`, whose body is one `set_config('app.current_user_id', …, true)` and has been since 2025-08-20; the scan could not follow the call, the same limitation `VIA_SHARED_PREAMBLE` was written for one package earlier. Honest figures now that four more tables are described: **31 writers, 15 attributing, 16 not, six of them live.** The invariant does not move — 16 is still 16 — but WP 6.2 budgets for six live functions rather than seventeen, and `supabase/rehearsal/130` §10 proves the widening with the GUC POISONED first rather than leaving it a reading. WP 4.3 also brought the four deep-tier tables inside the rule for the first time (D54's largest group: 22 tables audited by trigger, was 18; 38 deferrals, was 42). Each is the one line D36 says is not one for PostgREST but IS one here. `dataPlaneAudit.test.ts` holds a RATCHET (the list may shrink, never grow) because a gate would be red on arrival; WP 6.2 owns the work. And note what attribution means here: this application authenticates against `approved_users`, not Supabase Auth, so the uploader's id is CLIENT-ASSERTED — the database refuses a landing into a project that user cannot reach, which is a real constraint, but it is not proof of identity (D28) |
| `table-covered` | — | Every table is described by a sidecar or deferred to a named work package | `contract:check` R1 (WP 1.4). **It is load-bearing for more than documentation**: `dataPlaneAudit.test.ts` scopes the audit rule to tables IN THE CONTRACT, so a deferred tier-2 table's writes are unaudited with nothing to notice (D54). **WP 4.3 is what that costs, measured**: describing the four deep-tier tables added three audit triggers each AND surfaced five writers the scan had never seen, which then corrected D71's headline number by ten (D78). A deferral does not only hide a table from the documentation — it hides its writers from every rule scoped to the contract |
| `no-orphan-table` | — | No relation in production is created by no migration | `contract:check` R4 · `contract:verify` (WP 1.4) — those see only tables the CODE READS · **`npm run verify:sql`'s schema probe is the rule for the class** (WP 3.0, D43): it keys on "production has it", prints the columns of anything untracked and EXITS NON-ZERO. It needs CI to reach the database, so it gates on demand rather than on every pull request |

## The transparency commitments (PLAN.md §5.3)

Also named, for the same reason. These are what the invariants are *for*.

| Commitment | Rule |
|---|---|
| **T1 · No number without a source** | Every displayed value resolves to data, a named substitution rule, or an explicit default. There is no fourth option. |
| **T2 · Substitution is always visible** | At the point of display, not in a log. A fallback absent from the contract may not exist in code (`declared-fallback`). |
| **T3 · We publish our own blind spots** | Every report and export states the known limits of its own computation. |
| **T4 · Reproducible or not published** | Any figure leaving the system carries the dataset, policy, scenario and engine versions that produced it. |
| **T5 · Transparency survives handover** | Generated and CI-gated, so it stays true when the people who built it have moved on. |

## The data-contract commands

One command reproduces everything CI asserts about the data layer:

```
npm run contract:check
```

And one more EXECUTES the migrations a branch adds, which no static gate can (D31):

```
npm run contract:rehearse                 # the migrations this branch adds, fresh
npm run contract:rehearse -- --fixtures   # …and over production's untracked shape
npm run contract:rehearse -- --since HEAD # …and against the artifact YOU wrote
```

It needs a PostgreSQL 16 (`PGHOST`/`PGPORT`/`PGUSER`, or `--database-url`); CI uses
a `postgres:16` service container in `data-contract.yml`'s `migrations run` job and
runs it BOTH ways. It builds the base from the BASE branch's
`build/schema.introspected.json` — not a replay of history, which cannot work: 92
of 296 migrations fail on an empty database and always will. After the migrations
it runs `supabase/rehearsal/*.sql` (nine files as of WP 3.4), which are BEHAVIOURAL
assertions against that database — the half a structural test cannot reach, and the reason `audit-actor`
went from claimed to proved (D45). **Write one whenever a change's correctness
depends on what the database DOES rather than on what a migration SAYS.**

**The third way is the shape `main` meets after your merge.** The first two build
the base from the BASE branch's artifact and then run your migrations, so the tables
come from the migration. Nothing there executes the artifact your branch WRITES —
and an artifact can be wrong about what the migration did. WP 3.1's rename is what
that costs: the introspector did not follow it into the foreign keys, the artifact
recorded a dangling reference, `rehearsal-schema.mjs` skipped the key silently, and
`main` went red on the merge commit with no cascade on three tables (D52). CI runs
all three now; run the third one locally before you push.

**A fixture must no-op once its migration is in the base** (`supabase/rehearsal/fixtures/README.md`).
Guard every statement on the shape it reproduces — `IF to_regclass('public.old_name')
IS NOT NULL` — so the day the migration merges, the fixture stops doing anything. A
fixture that plants ROWS a migration then removes has no shape to key on: it passes
once, on its own branch, and fails on every branch after it. That is D50, and it kept
`main` red from the WP 3.0 merge until WP 3.1.

It runs `contract:introspect -- --check`, `contract:validate`, `contract:units -- --check`,
`contract:verify` and `contract:generate -- --check`, then its own rules (R1 coverage,
R4 orphans, R5 natural keys, R6 §4 citation resolution, R7 §16 append-only **and**
every done package has a §16 entry, R8 nothing open is owned by a finished package,
R9 `governance.audited` matches the audit triggers, R10 §17's sequencing table agrees
with §7–§13's ✅ markers). `.github/workflows/data-contract.yml`
runs the same set, plus `check:docs` and `npm test`, on every pull request.

**R7's append-only half needs history.** It SKIPS on a shallow clone and says so;
CI checks out with `fetch-depth: 0`. A local run that prints "SKIPPED" is expected.

One further command reaches the LIVE database:

```
npm run verify:sql          # PLAN.md §15, read-only (SELECT only)
```

No work-package session can run it — the egress proxy denies CONNECT. Touch
`.github/verify-request` and push; `.github/workflows/verification-sql.yml` runs it
with CI's `SUPABASE_ACCESS_TOKEN` and publishes the report to the
`verification-results` branch.

**NEVER in the same push as a migration — AND THE TRIGGER HAS THREE DOORS.**
`supabase-migrations.yml` has no branch filter (§4 D31), so a branch push DEPLOYS —
and both workflows fire on that push with no ordering between them.
`verification-sql.yml` fires on `.github/verify-request`, on the workflow file, AND
on `scripts/data-contract/verification-sql.mjs`. WP 3.4 pushed a migration together
with four new probes in the runner and lost the run that way — the fourth loss in
three packages, and the first through a door the rule did not name. **A push that
carries a migration must change none of the three.** A §15 run that races a deploy reports a database
that changed underneath it: WP 3.3's first after-run read 1 787 rows in its lane
sweep and a total of 1 691 in a later query of the same report. Push the migration,
wait for `Deploy Supabase Migrations` to finish, THEN touch `.github/verify-request`
in a second push. Three runs across two packages have been lost to this. **Measure every project, never just one** — the
largest project in this database is the one `seed-project.yml` seeds, and reading it
alone reports a clean data layer that is not clean (PLAN.md §4 D42).

- **Added a table?** Author `supabase/contract/<table>.contract.yaml`, or defer it in
  `scripts/data-contract/coverage.yaml` under the work package that will. A table in
  neither fails `table-covered`.
- **Changed a migration or a sidecar?** Run `npm run contract:generate` and commit
  `build/data-contract.generated.json` and `docs/data/tables/*.md` with it. They are
  committed on purpose: a gate that compares against an uncommitted artifact can never
  fail.
- **Never edit `docs/data/tables/*.md`.** They are generated. Edit the sidecar.

## Traceability convention

- Commits and PRs that advance the plan reference the blueprint section, gap, and phase they
  serve — e.g. `Phase A / G4 / §8.3: item-master editing forms`.
- If implementation must deviate from the blueprint, **update the blueprint in the same PR**.
  The document and the code move together; the blueprint is never allowed to go stale.

## Standing architectural laws (from the blueprint)

- **scsim is the strategic engine.** The legacy engine `sim-worker/sim_worker/engine.py` is
  frozen — never add capability to it (§3).
- **The registry export is the single source of truth for policy schemas**
  (`scsim/scsim/io/registry_export.py`). Never hand-write parallel policy schemas; generate
  from the registry (§6.2).
- **Extend existing artifacts, don't replace them** — proposals build on the phase pipeline,
  plugin registry, and version/hash patterns that already exist (§0).
- **Policy catalog IDs**: `P-S.x` supplier, `P-P.x` plant, `P-T.x` transport, `P-C.x` customer,
  `P-F.x` forecasting, `P-X.x` cross-cutting; `P-W.x` reserved for the warehouse echelon (§4.2).

## Repo orientation

| Tier | Path | Entry points |
|---|---|---|
| Frontend (React/Vite) | `src/` | `src/pages/ProjectPolicies.tsx` (/policies), `src/pages/DataManager.tsx` (/project-manager), `src/pages/SimulationLab.tsx` (/simulation-lab) |
| Data & control plane (Supabase) | `supabase/` | `supabase/functions/sim-command/index.ts`, `supabase/migrations/` |
| Execution (Fly.io worker) | `sim-worker/` | `sim_worker/worker.py`, `sim_worker/datamap.py`, `sim_worker/scsim_bridge.py` |
| Engine (Python) | `scsim/` | `scsim/scsim/core/phases.py`, `scsim/scsim/policies/registry.py`, `scsim/scsim/io/project_map.py` |

Companion docs, all under `docs/data/` and each opening with a status banner
(GENERATED / AUTHORED / DEPRECATED) so you know whether to edit it or its generator:
`docs/data/field-mapping.md` (AUTHORED — the field-mapping contract),
`docs/data/lifecycle.md` (AUTHORED — state tiers), `docs/data/tables/*.md`
(GENERATED by the data contract, lands in WP 1.4). The old top-level paths
`docs/data-simulation-mapping.md` and `docs/simulation-data-lifecycle.md` are
tombstones — many code comments still cite them; follow the stub, and do not add
content there.

`scsim/docs/` is the engine reference — generated, edit via
`scsim/scripts/gen_docs.py`, not by hand.
