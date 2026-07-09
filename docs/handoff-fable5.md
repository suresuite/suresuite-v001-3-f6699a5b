# Handoff: stand up the real simulation server

> A complete, self-contained task brief for the next agent (Fable 5 Ultracode) to
> continue this project. It carries the full history and the lessons already learned
> the hard way, so the same mistakes are not repeated.

## Mission

Stand up the **real simulation compute server** and connect the entire architecture
end-to-end so **complex simulations run reliably for the long term** — many
replications, long horizons — without freezing the user's browser. The frontend is
hosted on **Vercel**. Keep the existing **in-browser Pyodide engine as an offline /
quick-check fallback** (do not delete it).

**Do not rewrite the server. It already exists and is tested.** The job is
**deploy → wire secrets → point the frontend at it → harden for scale → verify
end-to-end.** The reason nothing worked before was purely that the worker was never
deployed (an empty `FLY_API_TOKEN`), so every run sat `queued` forever.

Work on branch `claude/simulation-engine-policies-vfkfx7` (create from latest `main`
if needed). If that branch's PR has already been merged, start a fresh branch from
`main` — never stack new commits on already-merged history. Reference the blueprint
section/gap/phase in commits (e.g. `Phase A / G4 / §8.3: …`). Only open a PR if the
user asks.

## Governing document — read first

`docs/design/next-gen-platform-design.md`. Standing laws:
- **scsim is the strategic engine** (`scsim/`). The legacy engine
  `sim-worker/sim_worker/engine.py` is **frozen** — never add capability to it.
- The **registry export** is the single source of truth for policy schemas
  (`scsim/scsim/io/registry_export.py`) — never hand-write parallel schemas.
- **Extend existing artifacts, don't replace them.**
- Companion docs: `docs/data-simulation-mapping.md`, `docs/simulation-data-lifecycle.md`.

## The architecture that already exists (connect it, don't reinvent)

**Control plane (Supabase Edge Function)** — `supabase/functions/sim-command/index.ts`
- Validates the command, runs the §8.1 **required-data gate** (service-role read; a
  `block` → HTTP 422 with typed findings; `ack_required` → 422 unless the client
  acknowledged; fail-open on read error, recording `gate_skipped` on the run).
- Inserts the `simulation_runs` row as `queued` **using the service role** (sole creator
  of the queued row).
- Snapshots the dataset, embeds the immutable policy-version snapshot, and `XADD`s the
  command envelope to Upstash Redis stream `sim.cmd.<project_id>` (drops the embedded
  snapshot and lets the worker fetch by id if the envelope > 700 KB).
- Broadcasts `run.queued` over Supabase Realtime; returns `202 {run_id}`.
- Handles `experiment.cancel` and `experiment.add_reps` too.

**Queue** — Upstash Redis Streams. Consumer group `sim-workers`, stream key
`sim.cmd.<project_id>`.

**Execution plane (Fly.io background worker)** — `sim-worker/`
- `sim_worker/worker.py` (`SimWorker`): discovers per-project streams (Redis `SCAN`
  today; a shared active-projects set is reserved for scale), consumes via the consumer
  group, and for `experiment.run` calls `compute_run_from_project(data, on_replication)`
  (the scsim canonical path).
- It is the **sole authoritative writer of results**: PATCHes `simulation_runs`
  (`queued`→`running`→`done`/`failed`) and UPSERTs `run_replications` idempotently on
  `(run_id, rep_index)` via PostgREST with the **service role**, streaming each
  replication live (`_stream_replication`) and re-upserting everything at the end
  (losing a streamed write costs liveness, never data). Broadcasts `kpi.delta`.
- `SCSIM_ENGINE=1` (set in `fly.toml`) selects the scsim engine.
- Deploy uses `sim-worker/Dockerfile` + `sim-worker/fly.toml`, build context = **repo
  root** (the image bakes in `scsim/`).

**Data plane (Supabase Postgres)** — tables `simulation_runs`, `run_replications`,
`policy_versions`, `dataset_versions`. Anon-read grants + realtime are what let the
frontend see runs (migrations `20260706000001`, `20260707000002`, `20260707000001`).

**Frontend (already wired for the server path)**
- `src/hooks/useSimulationRun.tsx` — subscribes to `postgres_changes` on
  `simulation_runs` + `run_replications` (coalesced 400 ms reloads) and exposes
  `runExperiment` (dispatch via `sim-command`), `cancelRun`, `addReps`. It already prefers
  DB rows over local state.
- `src/components/policies/RunValidateStage.tsx` — the Run & Validate UI. It currently
  dispatches best-effort **and always computes in the browser** (Pyodide). Make the server
  the default and browser the fallback (see "Frontend switch").
- `src/lib/sim/pyodideEngine.ts` + `src/lib/sim/engine.worker.ts` — the in-browser engine
  (Pyodide in a Web Worker). **Keep as fallback.**

**CI/CD that already exists**
- `.github/workflows/deploy-sim-worker.yml` — deploys the worker to Fly (needs the
  secrets/variable below). Triggers on push to `main` touching `sim-worker/**` or
  `scsim/**`, or `workflow_dispatch`.
- `.github/workflows/supabase-functions.yml` — deploys edge functions.
- `.github/workflows/supabase-migrations.yml` — applies migrations.
- `.github/workflows/scsim-tests.yml` — engine/worker tests + wheel-drift gate.

## Data & policy fidelity — the non-negotiable requirement

The user's #1 concern: **their real item-master data and their policy settings must reach
the engine on the server faithfully — no silent divergence.** The mechanisms exist; your
job is to *prove* they hold on the user's actual project, not to assume.

How it works today (do not weaken any of this):
- **Policies** travel as the immutable `policy_versions.snapshot` (with `policy_hash`)
  embedded by `sim-command`; the worker runs `snapshot_to_policies()`
  (`sim-worker/sim_worker/policy_snapshot.py`) — the SAME function the browser uses. Runs
  are version-bound and reproducible (defaults + per-node/edge overrides + fulfillment
  strategy all carry).
- **Data** is read straight from the project's live tables with the service role in
  `load_project_data()` (`sim-worker/sim_worker/datamap.py`): `suppliers`, `materials`,
  `products`, `inbound_logistics`, `bom_single_level`, `outbound_logistics`. The DB is the
  single source of truth; `ensure_item_masters` is called first so every graph node has a
  master row. Both paths funnel through the pure `build_project_data()`.
- **Fidelity is observable**: the §8.1 required-data gate blocks/warns pre-dispatch on
  missing required fields; the engine's **mapping-warnings** report (persisted on
  `simulation_runs.mapping_warnings`) lists every field it had to default or derive. A
  fully-specified project → zero mapping warnings + no gate block.

Mandatory fidelity checks you must perform and report (on the USER'S real project, not a
fixture):
1. **Table parity** — confirm the six tables `load_project_data()` reads are exactly the
   tables the app's Data Manager / Item Master / logistics uploads WRITE to. If the app
   writes item masters or BOM to differently-named tables/views, the worker will read empty
   and the run will be all-defaults. Fix the read set (or add a view) — do not let it
   silently diverge. Trace the frontend writers (e.g. `src/pages/DataManager.tsx`,
   `src/lib/policies/projectLanes.ts`, the ingest edge functions
   `supabase/functions/ingest-*`) against these six tables.
2. **Zero-drift on real data** — dispatch a run on the user's real project and show the
   `mapping_warnings` report is empty (or only expected `info` derivations). Any `warn`
   ("defaulted because no source existed") means data did NOT fully transfer — surface it,
   don't bury it. The UI already renders this (`src/components/sim/RunProgressPanel.tsx`
   "Engine mapping report").
3. **Browser == server == golden parity** — the browser fallback's `engineDataset()`
   (`RunValidateStage.tsx`) must map to the same `ProjectData` the server builds. Lock this
   with the existing parity test `sim-worker/tests/test_validation_parity.py` (extend it if
   needed) so identical input → identical KPIs on both paths. This is the guarantee that
   "run on server" and "run in browser (offline)" agree.
4. **Policy round-trip** — verify the `policy_hash` on the finished `simulation_runs` row
   matches the saved `policy_versions.policy_hash` the user ran, proving the exact policy
   configuration (not the live tables) drove the run.

## Step 1 — one-time human setup (an agent cannot do these)

These require the user's own accounts/dashboards. Do **not** invent tokens. There is a
**single-source-of-truth** flow so the secrets can't drift across their three homes (Fly,
GitHub, Supabase):

1. **Create accounts + one database**: Upstash Redis (free tier, one database) and Fly.io.
   Get a Fly deploy token: `fly tokens create deploy -a suresuite-sim-worker`.
2. **Fill `scripts/deploy.env`** once (`cp scripts/deploy.env.example scripts/deploy.env`).
   From the Upstash console: the **native** `rediss://…:6379` URL (worker) AND the **REST**
   URL + token (edge function) — same database, two access styles. From Supabase → Project
   Settings → API: URL + service_role key + project ref.
3. **Validate then sync**:
   - `scripts/preflight_check.sh` — live-tests every credential (Upstash REST PING, Supabase
     service-role read, Fly app reachable) and fails loudly on a typo *before* any deploy.
   - `scripts/setup_secrets.sh` — pushes from that one file to all three homes: Fly worker
     secrets (`flyctl`), Supabase function secrets (`supabase`), and the only two GitHub
     values CI needs (`FLY_API_TOKEN` secret + `FLY_APP_NAME` variable, via `gh`). Idempotent;
     re-run any time a value changes — nothing to reset.

Notes:
- **GitHub only needs `FLY_API_TOKEN` + `FLY_APP_NAME`.** The runtime secrets
  (`UPSTASH_REDIS_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`) live on the Fly app
  only — the old "Sync Fly secrets" CI step was removed because it re-pushed them from GitHub
  every deploy and could overwrite good Fly values with blanks (a drift/reset trap).
- `SCSIM_ENGINE=1` comes from `sim-worker/fly.toml` on every CI deploy — do not set it as a
  Fly secret (avoids an env/secret name collision) and never run `fly deploy` by hand (the
  dashboard's minimal `fly.toml` lacks the flag → the worker would silently run the legacy
  engine).

## Step 2 — what the agent does

1. **Confirm the data plane.** Apply migrations (`supabase-migrations.yml` or
   `supabase db push`). Verify `simulation_runs` and `run_replications` are in the
   `supabase_realtime` publication **and** the anon role has `SELECT` — otherwise the worker
   writes rows the UI never sees. If not, add a migration; do not hand-edit prod.
2. **Deploy `sim-command`** (edge-functions workflow) so the enqueue path is live with its
   Upstash REST secrets.
3. **Deploy the worker**: push to `main` touching `sim-worker/**`, or run
   `deploy-sim-worker.yml` via `workflow_dispatch`. Confirm with `flyctl status` (machine
   `started`) and `flyctl logs` (`subscribed to sim.cmd.*`). Deploy command:
   `flyctl deploy . --config sim-worker/fly.toml --dockerfile sim-worker/Dockerfile`.
4. **Frontend switch** (below).
5. **Harden for scale** (below).
6. **Verify end-to-end** (below), then commit + push. Run local gates first:
   `cd scsim && pytest -q`, `cd sim-worker && pytest -q`,
   `bash scripts/build_engine_wheels.sh --check`, `npx tsc --noEmit -p tsconfig.app.json`,
   `npm run build`.

## Frontend switch — server default, browser fallback

In `src/components/policies/RunValidateStage.tsx` (`runValidationScenario`, `onRunSingle`,
`onRunMulti`):
- Add a small toggle: **"Run on server (default)"** vs **"Run in browser (offline)"**.
- **Server mode**: dispatch via `useSimulationRun.runExperiment(projectId, policyVersionId,
  ack)` (which already handles the 422 gate + "Run anyway"), then **do not compute
  locally** — let the realtime subscription drive the UI. The component already prefers
  `dbRun ?? localRun` and `dbReps` over `localReps`, so results appear and stream
  automatically once the worker writes rows and realtime is on. Drive the loud `runPhase`
  banner from the run row's `status`/`rep_count_done`/`rep_count_target`.
- **Browser mode / fallback**: keep the current `runInBrowser` Web Worker path exactly as
  is — used when the user picks offline, or as auto-fallback if `sim-command` is
  unreachable. Keep `cancelBrowserRun()` on Cancel for browser runs; `cancelRun` (edge
  function) for server runs.
- Keep the self-test, build-version marker, and loud status banner from prior work.

## Long-term / complex-sim hardening (the point of moving to a server)

- **Scale the Fly VM**: `fly.toml` is `shared-cpu-1x` / 1024 MB — too small for heavy runs.
  Raise `cpus`/`memory_mb` (consider `performance-cpu`). Choose `min_machines_running` (1 =
  low latency, always-on cost) vs autostop/autostart (cheaper, cold-start latency).
- **Parallelism**: replications are independent (CRN seeds per rep, `sim_worker/seeds.py`).
  Exploit more CPUs or distribute reps across machines while preserving determinism.
- **Timeouts + liveness**: add a per-run wall-clock timeout → mark stuck runs `failed`. Use
  `XAUTOCLAIM` to reclaim pending messages from dead consumers so a crash doesn't strand a run.
- **Backpressure/concurrency**: the per-project cache lock serializes a project; bound total
  concurrent heavy runs so one big study can't starve others.
- **Rep/horizon caps**: both `sim-command` and the worker clamp replications to **200**.
  Raise deliberately with resource guards. Watch `run_replications.time_series` payload sizes
  on long horizons, and the Upstash 700 KB envelope limit (already handled by dropping the
  embedded snapshot and fetching by id).
- **Stream discovery at scale**: `worker._discover_loop` uses Redis `SCAN` — fine for low
  cardinality. For many projects, populate the reserved `sim.active_projects` set from
  `sim-command` and consume that instead.
- **Dead-letter + observability**: bad commands are `XACK`'d and dropped — add a DLQ stream.
  Add Fly metrics/log alerts and a worker heartbeat surfaced in the UI (so the user can tell
  "queued because worker down" from "running").
- **Cost**: Upstash free-tier request limits; Fly autostop. Document expected cost.

## Lessons learned this project — do not repeat

1. **Vercel deploys are atomic.** A Python serverless function (`api/run_simulation.py` +
   `requirements.txt` + `vercel.json`) made numpy+scipy exceed Vercel's ~250 MB Lambda
   limit; the failed function build failed the **whole** deploy and Vercel silently kept the
   OLD build live (symptom: UI stuck on old code). **Keep the Vercel project pure-Vite;
   never add server/Python builds to it.** Those files were deleted — do not resurrect them.
2. **The Fly worker never deployed** because `FLY_API_TOKEN` was empty — the sole reason runs
   sat `queued`. Set the secrets; confirm the deploy actually ran.
3. **Docker build context = repo root** (the image bakes in `scsim/`). Deploy with exactly
   `flyctl deploy . --config sim-worker/fly.toml --dockerfile sim-worker/Dockerfile`.
4. **Namespace-package hazard**: a repo-root `scsim/` dir shadows the installed `scsim`
   package when cwd is the repo root. The Dockerfile installs **non-editable** then `rm -rf`
   the source; CI uses `working-directory` + non-editable installs. **Never `pip install -e
   scsim`** in the worker image or CI.
5. **This app has NO Supabase Auth session.** It authenticates via the `approved_users` RPC
   flow and always uses the **anon JWT** (hardcoded in
   `src/integrations/supabase/client.ts`). RLS keyed to `auth.uid()` returns zero rows under
   anon — **server code must use the service role** for reads/writes (both `sim-command` and
   the worker do). `created_by` is null for app users. The frontend reads projects via the
   `list_projects` SECURITY DEFINER RPC for the same reason. Do not "fix" this by adding auth.
6. **Realtime needs both** the table in the `supabase_realtime` publication **and** anon
   `SELECT`. If DB rows update but the UI doesn't move, check those two first.
7. **Single-writer discipline**: `sim-command` is the sole creator of the `queued` row; the
   worker is the sole authoritative writer of results. Don't add a competing writer. The
   browser fallback writes best-effort via anon (needs the anon-write migrations) — keep it
   clearly separate.
8. **Upstash has two credential styles**: worker → native `rediss://…:6379`
   (`UPSTASH_REDIS_URL`); edge fn → REST URL + token (`UPSTASH_REDIS_REST_URL/TOKEN`). Same
   DB. Mixing them up is a classic failure.
9. **The engine already streams**: `compute_run_from_project(data, on_replication)`
   (`sim-worker/sim_worker/scsim_bridge.py`) fires `on_replication(row, done, total)` after
   each rep. Reuse it — the worker and the browser Web Worker both already do.
10. **WASM in the browser is 2–5× slower and single-threaded**, and running it on the main
    thread **froze the tab** (looked like a hang). It was moved into a Web Worker
    (`src/lib/sim/engine.worker.ts`); cancel works only by `worker.terminate()`. This is
    *why* complex/long runs need the server. Keep the browser path as fallback only.
11. **Wheel-drift gate**: `public/engine/*.whl` must match the engine source — if you touch
    `scsim/` or `sim-worker/`, run `scripts/build_engine_wheels.sh` and commit the wheels;
    CI's `browser-wheels` job (`scsim-tests.yml`) fails otherwise.
12. **Validation gate**: `sim-command` returns **422** with typed findings on incomplete
    data; the frontend shows "Run anyway" for `ack_required`. Preserve this — don't dispatch
    on silently-defaulted data.
13. **GitHub access** is via the GitHub MCP tools only (no `gh` CLI). Retry pushes with
    backoff on network errors. PRs only when the user asks.

## Verification — the real proof (on the deployed app, not just tests)

1. `flyctl status` → worker machine `started`; `flyctl logs` → `subscribed to sim.cmd.*`.
2. In the app, dispatch a run (server mode). Watch `simulation_runs`:
   `queued → running → done`; `run_replications` rows **stream in live** and the per-rep grid
   + weekly charts fill via realtime; `code_version` = `scsim-<version>`; aggregate KPIs + CI
   half-widths present; mapping-warnings report shown.
2b. **Fidelity proof** (see "Data & policy fidelity"): on the user's real project the
    `mapping_warnings` report is empty / only expected `info`; the finished run's
    `policy_hash` equals the saved version's; and the browser/server parity test passes.
3. **Cancel** a running run → status `cancelled`. **Add reps** → more replications land.
4. **Big run** (e.g. 200 reps × 365 days): completes **without freezing the browser**
   (compute is entirely server-side). This is the whole objective.
5. **Negative test**: stop the worker → dispatch → run stays `queued` (proves the worker is
   the executor) → redeploy → it drains and finishes. Toggle **browser fallback** → a run
   still computes locally when the server is off.
6. Local gates green before commit: `scsim` pytest, `sim-worker` pytest,
   `build_engine_wheels.sh --check`, `tsc --noEmit`, `npm run build`.

## Definition of done

Server deployed and consuming; a run dispatched from the Vercel-hosted app goes
queued→running→done with replications streaming into the UI via realtime; a 200-rep / long
run completes without freezing the browser; cancel/add-reps work; the browser engine remains
a working offline fallback behind a toggle; all local gates + CI green; changes committed to
the working branch with blueprint traceability.

## State as of 2026-07-09 (branch claude/suresuite-sim-engine-deploy-4mrzj5)

Step 2 executed. What is now true in production, and the operational surfaces
added to keep it verifiable:

- **Worker live on scsim.** `Deploy sim-worker to Fly` proves it on every run:
  a read-only preflight fails the deploy if any of UPSTASH_REDIS_URL /
  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is missing from the Fly app (it
  never writes secrets), and a post-deploy check fails unless the logs show
  `engine mode: scsim <version>`. `fly.toml` pins `[[restart]] policy =
  "always"` and the workflow starts stopped non-standby machines — a
  crashed-out machine parked in "stopped" was why runs once sat queued
  forever with no error anywhere.
- **Server is the default compute path.** The Run & Validate stage has a
  "Run on server (default) / Run in browser (offline)" toggle. Server mode
  dispatches and stops — the worker is the sole writer, realtime streams the
  rows in, the status banner mirrors the run row. Browser mode (and the
  auto-fallback when sim-command is unreachable) is the unchanged Pyodide
  path, but its dispatch sends `payload.compute = "client"` and sim-command
  then skips the queue XADD, so the worker and a browser never compute the
  same run.
- **Migrations unblocked.** Two faults had silently frozen `db push` since
  Jul 4: an orphaned remote version `20260704000001` (now in the repair
  list), and `super_admin_phase1` using an enum value in the transaction that
  added it while ALSO sharing its version number with `open_logistics_reads`
  (now split into 20260709000001 + 20260709000002). All migrations through
  the run-table anon grants are applied.
- **End-to-end proof is a workflow**: `Verify simulation end-to-end`
  (verify-sim-e2e.yml → scripts/verify_sim_e2e.mjs) runs the whole loop on
  the real project with the app's own anon identity — gate → queued →
  running → done, code_version scsim-*, all replications landed, realtime
  events observed on BOTH run tables, mapping_warnings empty/info-only,
  run policy_hash == saved policy_versions.policy_hash, plus a cancel
  round-trip. Trigger it from the Actions tab, or (from environments that
  can push but cannot call the Actions API) by changing
  `.github/verify-e2e-request`; the full log always lands on the
  `verify-results` branch (`results/latest.log`). The migrations workflow
  publishes its db push log to `migration-results` the same way.
- **Gotcha for future agents**: PostgREST's schema cache can lag a freshly
  added column by minutes — a 42703 "column does not exist" right after a
  migration is not proof the migration failed. The E2E preflight retries for
  this reason. And this container's network policy may block Supabase + the
  GitHub Actions API entirely: the git-native trigger/result branches above
  are the workaround, and GH_TOKEN in the environment is contents-scope only.
- **Realtime publication was never actually applied** until 20260709000003:
  20260607121406 sits in the migrations workflow's "mark baseline as applied"
  range, so it was recorded without executing. A SUBSCRIBED channel that
  receives zero events for a fresh INSERT is the tell.

### Open blocker (needs the human — invalid Upstash credentials)

The third E2E run isolated the last fault to the **Upstash credential values
themselves** (every code path is now proven up to this point):

- The worker crash-loops at boot: `ValueError: Redis URL must specify one of
  the following schemes (redis://, rediss://, unix://)` — the Fly secret
  UPSTASH_REDIS_URL is not a `rediss://…:6379` URL. (`restart = always`
  means it recovers by itself the moment the secret is fixed.)
- sim-command's enqueue fails with a DNS error for
  `viable-calf-117705.upstash.io` — that hostname does not resolve from two
  independent networks: the Upstash database was deleted/renamed or the URL
  was mispasted. This was invisible before the loud-enqueue fix; it is why
  every server run ever sat "queued" forever.

Fix (idempotent, nothing to reset): create/locate the Upstash database, put
BOTH credential styles for the SAME database into `scripts/deploy.env`, then
`scripts/preflight_check.sh` (live-catches both faults) and
`scripts/setup_secrets.sh`. Fly restarts the worker on the secret change;
touch `.github/deploy-request` to re-verify the deploy end-to-end and
`.github/verify-e2e-request` to re-run the full proof (result lands on the
`verify-results` branch).
