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

## Latency budget (target)

| Stage | Budget |
|---|---|
| Redis XREAD blocking pickup | 5 ms |
| Apply delta + incremental DES | 80 ms |
| KPI diff + Realtime broadcast | 15 ms |
| **Worker contribution to e2e** | **~100 ms** |
