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

## SCSIM engine bridge (opt-in)

`experiment.run` workloads can execute on the new phase-pipeline engine in
[`../scsim`](../scsim/README.md) instead of the legacy dict-based engine:

```bash
pip install -e ../scsim        # alongside requirements.txt
SCSIM_ENGINE=1 python -m sim_worker
```

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
pip install -r requirements.txt
cp .env.example .env  # fill in values
python -m sim_worker
```

## Deploy to Fly.io

```bash
fly launch --no-deploy --copy-config --name <your-app>
fly secrets set \
  UPSTASH_REDIS_URL=rediss://...:6379 \
  SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
fly deploy
fly scale count 1 --region <closest-to-supabase>
```

Use the native Redis URL (`rediss://`) from Upstash, **not** the REST URL
that the edge function uses. The native protocol gives you `XREAD BLOCK`
which is essential for sub-50 ms command pickup.

## Latency budget (target)

| Stage | Budget |
|---|---|
| Redis XREAD blocking pickup | 5 ms |
| Apply delta + incremental DES | 80 ms |
| KPI diff + Realtime broadcast | 15 ms |
| **Worker contribution to e2e** | **~100 ms** |
