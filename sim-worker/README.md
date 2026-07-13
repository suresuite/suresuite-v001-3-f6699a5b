# sim-worker (Fly.io)

Long-running Python worker that turns scenario commands into KPI deltas in
real time. This is the "Sim Worker" box from
`.lovable/plan.md` (Phase 1 architecture).

## Responsibilities

1. Subscribe to the per-project Upstash Redis Stream `sim.cmd.{project_id}`.
2. Lazily load the project's supply chain graph from Supabase Postgres on first
   command and keep it warm in memory (LRU eviction after `IDLE_TTL`).
3. Apply the command as a delta, run incremental Discrete Event Simulation on
   the dirty sub-graph (target ≤80 ms p95 for medium graphs of 500-5k nodes).
4. Diff the new KPI vector against the previous and broadcast `kpi.delta`
   events over Supabase Realtime on channel `sim:{project_id}`.
5. On `simulation.stable` (debounced 500 ms idle), persist a snapshot row to
   `simulation_results`.

The current edge function (`supabase/functions/sim-command`) also publishes
*stub* KPI deltas so the UI loop works before this worker is deployed. Once
the worker is online and broadcasting real deltas, drop `STUB_KPI_ENABLED` in
the edge function (or filter `source==='stub'` client-side).

## Tech

- Python 3.12
- `redis[hiredis]` — Upstash Redis (uses native protocol, not REST)
- `httpx` — Supabase Realtime broadcast + REST reads
- `networkx` + `simpy` — graph + DES (reuse logic from the existing `ml-service`)
- `pydantic` — shared command/event schemas

## SCSIM engine (the deployed default)

`experiment.run` workloads execute on the phase-pipeline engine in
[`../scsim`](../scsim/README.md). The Docker image bundles scsim (the build
context is the repo root so `COPY scsim` works) and `fly.toml` sets
`SCSIM_ENGINE=1`, so the deployed worker always runs the canonical scsim
path: project data + saved policy snapshot → `scsim.io.from_project_data` →
`run_scenario` → the worker persists `simulation_runs` aggregates and
per-replication `run_replications` rows as the sole authoritative writer.

For a local checkout the engine is installed from the sibling directory:

```bash
pip install -e ../scsim        # alongside requirements.txt
SCSIM_ENGINE=1 python -m sim_worker
```

Unsetting `SCSIM_ENGINE` falls back to the frozen legacy analytical engine
(`code_version "worker-legacy"`; aggregates only, no per-replication rows).
The worker logs its engine mode at startup — check `fly logs` for
`engine mode: scsim <version>`.

`sim_worker/scsim_bridge.py` converts the project graph + effective policy
dict via `scsim.io.legacy_graph.from_legacy_graph` (a structural mapping —
every approximation is listed in the returned `scsim_notes`) and reshapes
the results into the existing `mean_*/ci_*` broadcast format, adding
`engine_version`, replication badges, and portfolio feasibility warnings.
Any bridge failure falls back to the legacy engine, so the flag is safe to
flip per deployment.

## Local run

```bash
cd sim-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -e ../scsim
cp .env.example .env  # fill in values
python -m sim_worker
```

## Deploy to Fly.io

Deploy from the **repo root** (the Docker build context must contain both
`sim-worker/` and `scsim/`):

```bash
fly launch --no-deploy --copy-config --name <your-app> --path sim-worker
fly secrets set --app <your-app> \
  UPSTASH_REDIS_URL=rediss://...:6379 \
  SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
cd <repo-root>
fly deploy . --config sim-worker/fly.toml --dockerfile sim-worker/Dockerfile
fly scale count 1 --region <closest-to-supabase>
```

Use the native Redis URL (`rediss://`) from Upstash, **not** the REST URL
that the edge function uses. The native protocol gives you `XREAD BLOCK`
which is essential for sub-50 ms command pickup.

### Automated deploy (CI)

`.github/workflows/deploy-sim-worker.yml` deploys this worker to Fly on every
push that touches `sim-worker/**` or `scsim/**` (and on manual
`workflow_dispatch`). It creates the app if missing, syncs the Fly secrets,
and runs `flyctl deploy . --remote-only --config sim-worker/fly.toml
--dockerfile sim-worker/Dockerfile` from the repo root so the image can bundle
the scsim engine. Configure once in **GitHub repo → Settings →
Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `FLY_APP_NAME` | globally-unique Fly app name (must match `fly.toml`'s `app`) |
| Secret | `FLY_API_TOKEN` | output of `flyctl auth token` |
| Secret | `UPSTASH_REDIS_URL` | native `rediss://default:<token>@<host>:6379` (same DB as the edge function's REST URL) |
| Secret | `SUPABASE_URL` | `https://<ref>.supabase.co` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key |

Once it's live, a scenario **Run** in the app flips from the yellow
"preliminary (stub)" badge to a green "worker engine" badge with real KPIs —
that flip confirms the engine is actually running.

## Scale to zero (idle cost → ~$0)

By default the worker blocks on the Redis stream 24/7, so the Fly machine bills
even when you never run a simulation. Scale-to-zero lets an idle worker **stop
itself** and be **woken on the next run**, so idle cost drops to roughly nothing
(you pay only while a run is actually executing, plus Fly's tiny stopped-machine
rootfs charge).

Two halves, both required — enable them together:

1. **Stop when idle** (the worker) — `sim-worker/fly.toml`:
   - Set `IDLE_SHUTDOWN_SECONDS` to a quiet period, e.g. `"900"` (15 min). The
     worker exits cleanly after that long with no command in flight (a running
     `experiment.run` never counts as idle).
   - Change `[[restart]] policy` from `"always"` to `"on-failure"`, so a clean
     `exit(0)` **stops** the machine while genuine crashes still restart. (With
     `"always"`, an idle exit is restarted immediately — you get no savings but
     also never a stranded run, which is why `"always"` is the safe default to
     ship before the wake half is configured.)
   - Redeploy: `flyctl deploy . --config sim-worker/fly.toml --dockerfile
     sim-worker/Dockerfile` (from the repo root). Confirm in `fly logs`:
     `scale-to-zero armed: will exit after 900s idle`.

2. **Wake on demand** (the edge function) — the `sim-command` function starts a
   stopped worker via the Fly Machines API the moment a command is enqueued
   (`supabase/functions/_shared/wakeWorker.ts`). It needs two secrets:

   ```bash
   supabase secrets set --project-ref <ref> \
     FLY_API_TOKEN="$(flyctl auth token)" \
     FLY_APP_NAME="suresuite-sim-worker"
   ```

   `scripts/setup_secrets.sh` and the `Deploy Supabase Functions` workflow now
   set these automatically from the same `FLY_API_TOKEN` / `FLY_APP_NAME` you
   already use to deploy the worker, so in most setups this step is done for you
   on the next functions deploy. Without these secrets the wake is a logged
   no-op — safe, but a stopped worker won't come back, so **don't enable half 1
   without half 2**.

**Tradeoff:** the first run after the worker has slept pays a cold start
(machine boot + scsim import + graph load, typically ~10–30 s) before it begins;
subsequent runs within the idle window are immediate. Interactive
scenario/policy deltas still feel instant because `sim-command` returns stub
KPIs synchronously — the real worker delta just follows a little later on a cold
machine. Tune `IDLE_SHUTDOWN_SECONDS` to trade idle savings against how often
you eat a cold start.

**Other Fly cost levers** (independent of scale-to-zero):
- `fly scale count 1` — make sure you're not paying for an HA pair of machines
  you don't need for a single-project workload.
- `memory_mb` in `fly.toml` — 1024 MB is sized for heavier runs; drop it only if
  your runs fit (an OOM kill fails runs), e.g. `512`.

## Latency budget (target)

| Stage | Budget |
|---|---|
| Redis XREAD blocking pickup | 5 ms |
| Apply delta + incremental DES | 80 ms |
| KPI diff + Realtime broadcast | 15 ms |
| **Worker contribution to e2e** | **~100 ms** |
