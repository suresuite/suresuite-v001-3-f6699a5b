# Statistical engine (Part VIII hard requirements)

## Seed tree — keyed, structural, leak-proof

All randomness derives from `SimulationSettings.project_seed` through
`numpy.random.SeedSequence` **spawn keys** (never sequential spawning), in
three realms:

| Realm | Key | Streams |
|---|---|---|
| WORLD | `(realm, model_rep, stream_id)` | demand, leadtime |
| HAZARD | `(realm, event_rep, event_index, draw_id)` | start, duration, magnitude |
| POLICY | `(realm, model_rep, event_rep, sha256(policy_id)[:8])` | one per policy instance |

Consequences, all tested:

* **CRN by construction** — world streams are scenario- and portfolio-
  independent, so every portfolio, every stress cell, and every event seed
  of a project shares identical demand/lead-time worlds. No configuration
  can break this.
* **Determinism guarantee for additions (§9.4)** — `policy_key` is a digest
  of the policy id, so enabling policy #22 cannot perturb the draws of
  policies #1–21 or the world. Golden test G-RNG asserts identical demand
  trajectories across portfolios.
* World streams are NEVER handed to policies: the SimContext only exposes
  `ctx.rng(policy_id)`.

## Replication grid

`replications = model_seeds × disruption_event_seeds`, where the event axis
collapses to 1 when every event is fully specified (fixed start and
duration). The 30-seed floor is study-grade guidance: runs below 10 model
seeds carry `below_replication_floor` in their `StatisticsReport`;
`fast_scan` results always carry `wide_ci_badge` (Risk R4) and the budget
(10×6, kpi_only traces) is enforced by the settings model itself.

Optional `replication_stopping="sequential_ci"` extends model seeds in
batches of 10 (cap 200) until the fill-rate CI half-width meets
`ci_halfwidth_target`. Keep it `fixed` for portfolio studies — synergy needs
one shared grid (the engine refuses mismatched grids).

## Warm-up (always both detectors)

`resolve_warmup` runs clean replications, averages the weekly fill-rate
series across them, and computes **MSER-5** (White 1997: batch means of 5,
z(d) = Σ(b − b̄)² / (n_b − d)², truncation restricted to the first half — the
published statistic since engine 0.2.7; the earlier one, which divided by one
factor too many, is reported for one release as `mser5_legacy_week`) and **Conway's rule** (first observation that
is neither min nor max of the remainder). `most_conservative` adopts the
later week; both are always reported in `WarmupReport`. `manual` pins
`warmup_end` (the manuscript uses week 85 on its 156-week horizon).

Auto-started events draw `t* ~ U{t_w, t_w+2}` from the hazard start stream —
the manuscript's "steady state, U{85..87}".

## Significance

Δ and synergy metrics are CRN-paired per replication and tested with a
**two-sided percentile bootstrap** (default 10,000 resamples, level from
`ci_level`): resampling replication indices preserves the pairing. Stars:
`*` p<.05, `**` p<.01, `***` p<.001; `significant` means 0 outside the CI.
The bootstrap RNG is analysis-time randomness — deterministically seeded,
but outside the simulation seed tree.

Plain KPI aggregates use Student-t half-widths (`aggregate_mean_ci`).

## CRN caveats

* **Stochastic lead times** (`lognormal` / `gamma` links) are drawn
  per (link, week) from the world leadtime stream at replication start, as
  standardised variates (a standard normal, or Γ(1/cv², 1)); the shipment's
  own mean is applied at use. The draw count therefore no longer depends on
  how many orders a policy ships, and CRN pairing holds on those links too.
  This was the planned draw-per-(link, week) scheme; it shipped in engine
  0.2.6 (audit 2026-09-22, F-24). Before it, draws happened at ship time and
  portfolios with different ordering patterns consumed the stream differently.
* **Warm-state snapshots** capture world RNG states at `t_w`. Policy streams
  are deliberately not captured (the ✅ policies draw nothing pre-event);
  if a policy ever draws during warm-up, the snapshot is refused for that
  family — correctness over speed (`SnapshotInvalid`).
