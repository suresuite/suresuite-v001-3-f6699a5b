# ADR 0001 — MTS fulfillment mode: `forecast` and `state.fg_target` contract keys

**Status:** accepted · **Engine:** 0.1.0 → 0.2.0 (minor) · **Tier:** 3
(pipeline contract change → schema re-frozen, this ADR).

## Context

M7 activates the MTS branch of the CODP (§3.3): PH-30 serves demand from
finished-goods stock, production replenishes toward a target, and material
planning projects from a forecast instead of the stationary mean. The phase
sequence itself was designed for this (PH-30 has owned `fg_fulfillment` and
`state.fg_on_hand` since 0.1.0) but two pieces of state had no home:

1. the **demand forecast** consumed by production planning (PH-40) and
   material planning (PH-70);
2. the **FG stock target** `S^FG_p`, set during planning (PH-70 — where
   P-P.4 resides per Part IV) and consumed by the NEXT week's PH-40.

## Decision

* New transient key **`forecast`**, owned by **PH-10** (demand
  realization). The mechanic computes the forecast from the demand history
  *before* drawing the week's demand (information timing: `forecast_t =
  f(D_{t−window..t−1})`), then appends the realization. Models per §3.3:
  naive / ma / exp_smoothing (α = 2/(window+1)) / perfect (true model
  mean), with the `forecast_bias` lever applied multiplicatively. No RNG is
  consumed — the G-RNG guarantee is untouched.
* New persistent key **`state.fg_target`**, writable from **PH-70**: a base
  mechanic (priority 45) sets the cycle target `forecast × 1 week of
  production LT`; P-P.4 (priority 55, declared resolution) adds the FG
  safety stock on top. PH-40 reads last week's value — targets follow
  planning by one week, exactly like `s_m`/`S_m` feed PH-80.
* MTO products are byte-for-byte unaffected: PH-30 stays a no-op for them,
  the default plan still targets `D_p + B_p`, and material projection still
  uses the stationary mean. Golden traces #1–#5 remain identical (tested).

## Consequences

* `scsim/pipeline_schema.json` re-frozen (0.1.0 snapshot superseded by this
  ADR per §9.5; the git history is the archive).
* `ENGINE_VERSION` 0.2.0 — results from 0.1.0 and 0.2.0 must be flagged in
  any cross-version comparison.
* Warm-state snapshots now capture the demand-history buffer and smoothing
  state; 0.1.0 snapshots are invalidated by the engine-version component of
  the family digest (by design).
* New golden trace #6 (MTS drain/replenish) freezes the MTS semantics.
