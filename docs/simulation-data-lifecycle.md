# Simulation Project — Data Lifecycle

How user input flows from the browser through to permanent storage, and where each piece of state actually lives.

```
                            ┌──────────────────────────┐
   User edits in /policies  │ Local React state        │   TEMPORARY
   ─────────────────────▶  │ drafts{} in StagePolicy- │   (in-browser only,
                            │ Table, PolicyDefaults-   │    lost on refresh
                            │ Card                     │    until Save)
                            └────────────┬─────────────┘
                                         │ Save changes
                                         ▼
                            ┌──────────────────────────┐
                            │ Postgres (Lovable Cloud) │   PERMANENT
                            │ policy_defaults          │   per project,
                            │ policy_overrides         │   RLS-scoped to
                            │ scenarios / experiments  │   project members
                            └────────────┬─────────────┘
                                         │ dispatchSim()
                                         ▼
                            ┌──────────────────────────┐
                            │ sim-command edge fn      │
                            │  → Upstash Redis stream  │   TRANSIENT
                            │     sim.cmd.{project}    │   (queue / broadcast,
                            │  → Supabase Realtime     │    not persisted)
                            │     channel sim:{project}│
                            └────────────┬─────────────┘
                                         │ Run scenario (experiment mode)
                                         ▼
                            ┌──────────────────────────┐
                            │ Fly.io sim-worker        │
                            │  writes results back to: │
                            │    simulation_runs       │   PERMANENT
                            │    run_replications      │   (audit + compare)
                            └──────────────────────────┘
```

## Three tiers of state

### 1. Temporary — browser only
- `StagePolicyTable.drafts` (per-cell edits, keyed by row)
- `PolicyDefaultsCard` form state
- Filter / search / focused-stage UI state

Cleared on **Save** or **Revert**. Lost on refresh. Never leaves the client.

### 2. Transient — server-side, not persisted
- Upstash Redis stream `sim.cmd.{project_id}` — command queue between the edge function and the Fly.io worker.
- Supabase Realtime channel `sim:{project_id}` — live KPI deltas during preview mode.

Designed to be cheap and replaceable. If the worker misses one, the next save or run reconstructs the world from Postgres.

### 3. Permanent — Postgres (Lovable Cloud)

| Table              | Written by             | Holds                                                  |
| ------------------ | ---------------------- | ------------------------------------------------------ |
| `policy_defaults`  | client on Save         | one row per project — global defaults + strategy       |
| `policy_overrides` | client on Save         | per-node / per-edge / per-family patches               |
| `policy_presets`   | client                 | reusable preset libraries                              |
| `scenarios`        | client                 | disruption scenarios (network → lab handoff)           |
| `recovery_playbooks` | client               | named recovery strategy bundles                        |
| `experiments`      | client on Run          | committed Monte Carlo experiment definitions           |
| `simulation_runs`  | sim-worker (service role) | per-run header (status, KPIs, CIs)                  |
| `run_replications` | sim-worker (service role) | per-replication detail                              |

All tables are RLS-scoped by project membership. The sim worker uses the service role to write back without spoofing user identity.

## Save vs Run

| User action                  | Hits Postgres? | Hits Redis/Realtime? | Persists results? |
| ---------------------------- | -------------- | -------------------- | ----------------- |
| Edit a cell                  | No             | No                   | No                |
| **Save changes**             | Yes — upsert   | Yes — delta only     | N/A               |
| **Preview** (toggle/slider)  | No             | Yes — delta only     | No — broadcast    |
| **Run scenario** (experiment)| Yes — create run row | Yes — command   | Yes — runs + reps |

## Source-of-truth boundary

- The sim worker **always** reads effective policy from Postgres at run time. It never trusts client-supplied bundles.
- The browser only ships **deltas** into the Redis command — not the full policy bundle.
- Anything not in Postgres is not authoritative. If you can't see it after refresh, it wasn't saved.

## Data API requirements

Every table above must have explicit `GRANT` statements for `authenticated` (and `service_role` for tables touched by the edge function / worker). Without those grants, PostgREST hides the table from its schema cache and the client sees `Could not find the table 'public.<name>' in the schema cache` — which is what caused the recent /policies save failure.
