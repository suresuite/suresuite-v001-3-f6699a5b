# Architecture

## The weekly cycle is data, not code

Every simulated week executes the named phase sequence PH-00 → PH-99
(see the [generated pipeline contract](reference/pipeline.md)). Engine
mechanics and policy hooks are both registered as hooks with declared
`reads`/`writes`; **load-time validation** rejects, with hard errors:

* a hook on an unknown phase;
* a read of a transient key before its owning phase has produced it
  (including same-phase priority ordering);
* a write to a transient key outside its owning phase, or to a persistent
  `state.*` key from a non-authorized phase;
* two hooks writing the same key in the same phase without distinct
  priorities **and** a declared `resolution` rule on the later writer.

The shipped catalog exercises the resolution mechanism on purpose:
P-P.3 rewrites `inventory_levels` after P-P.1, P-S.1 rewrites
`purchase_orders` after P-P.1's release, and P-P.9 replaces the default
`production_plan`. Each declares how the overlap is resolved; the generated
[policy catalog](reference/policies.md) shows every rule.

MTO and MTS are the SAME pipeline: PH-30 (`fulfill_from_stock`) is a no-op
for MTO products and serves MTS demand from finished-goods stock (active
since 0.2.0 — ADR 0001). Networks may mix modes per product.

## One week in detail (MTO core)

| Phase | What happens |
|---|---|
| PH-00 | Reset weekly transients; compose physical disruption state per supplier (max severity across events: min capacity factor, max deferral end). |
| PH-10 | Update the demand forecast from history (§3.3 models: naive/ma/exp_smoothing/perfect + bias lever; no RNG), then draw `D_p[t]` from the world demand stream (per-model vectorized groups; order fixed → CRN-stable). |
| PH-20 | Firm knowledge = events with `t ≥ start + detection_lag` (lag 0 by default; P-S.4 will govern it). |
| PH-30 | MTO: no-op. MTS (§3.3 step ①): serve `min(D_p + B_p, I^FG_p)` from FG stock, backlog first; the shortfall flows to P-C.1. |
| PH-40 | Default plan — MTO: `min(D_p + B_p, O_p + δ^o)`; MTS (step ②): replenish `max(0, S^FG − I^FG) + unserved backlog`, capacity-capped. P-P.5 grants overtime headroom δ^o (priority 40); P-P.9 replaces the plan with the rolling LP when active (priority 60). |
| PH-50 | Eq. 8 executed greedily in fixed product (declaration) order against on-hand materials; consumption via the sparse BoM. MTS output credits `I^FG` (Eq. 9; same-week completion, W^FG = 0 in v1). |
| PH-60 | P-C.1 applies the lost-sales / backorder / partial rule, CODP-aware: MTO ships production output, MTS shipped from FG at PH-30. Backorders age in weekly buckets and expire to lost sales. |
| PH-70 | `D_m` projection (Eq. 1 — stationary for MTO, forecast for MTS); FG cycle target base (mechanic, priority 45) + P-P.4 FG safety stock (priority 55) → `state.fg_target` for next week's PH-40; P-P.1 sets `s_m = E·T`, `S_m = E·(T+κ)` (Eqs. 2–3, κ mode strip nominal→crisis under a visible event); P-P.3 adds `z·σ·√T` / `z·σ·√(T+κ)` (Eqs. 20–21). |
| PH-80 | P-P.1 releases orders (Eqs. 4–6: `max(S − position, MOQ)` when `position < s`, on the primary = min-cost link); P-S.2 splits releases across warm sources (priority 55); P-S.1 reroutes firm-visibly disrupted slices to the selected backup (priority 60); orders enter the supplier queue. |
| PH-90 | Deferral mechanic → queue shipping under capacity gating → P-T.2 expediting → arrivals land. Details below. |
| PH-99 | KPI row, lost-sales cost, policy `cost_contribution`s into the C^res ledger, optional full-debug matrices. |

## Disruption semantics

**Event = (target, effect, magnitude, start, duration).** Targets resolve to
suppliers (`edge:lane` maps to the lane's supplier while edges are
behavior-neutral — golden trace #5 asserts the equivalence; `node:plant`
lands in M7).

### lead_time_extension (✅ Eqs. 11–12)

The target ships nothing *into the plant* during `[t*, t*+Δt)`:

* in-transit quantities whose arrival week falls inside the window are
  deferred to the first week after it (slice-shift, applied week-by-week as
  arrivals come due);
* orders placed during the window are quoted `arrival = max(t + T_s, t_end)`;
* units are delayed, never destroyed (conservation invariant, tested).

### capacity_reduction

The supplier's weekly outbound flow is throttled to `φ × capacity_per_week`
(finite capacity required — validated at compile). Orders accumulate in the
supplier **queue**, shipped FIFO pro-rata when capacity allows. Under
`overflow_rule="queue"` nothing is lost; under `"reject"` the overflow is
logged as `lost_inbound_units` and the position drop triggers reordering.
`ramp_linear` onset/recovery interpolates φ over `ramp_weeks`.

### Why expediting can beat the LT window but not the capacity queue

P-T.2 pulls **in-transit** quantities forward — premium freight around the
blockage — including arrivals the LT event deferred. That is the strategy's
entire point and reproduces the manuscript's "expedite dominates long
disruptions" result. It cannot touch the supplier queue: goods a capacity
cut never shipped do not exist in transit (asymmetry preserved, tested).

## Timing conventions

* Pipeline slot `w` means "usable for production in week `w`"; slot `w`
  lands into on-hand during PH-90 of week `w − 1`.
* An order placed in week `t` with lead time `T` is therefore usable in
  week `t + T` exactly.
* P-T.2 expedites future slots into the slot landing this week → usable
  next week ("arrives current week" in Eq. 18–19 terms).

## Initialization (warm start)

At `t = 0` the engine runs the PH-70 chain once to obtain levels, then sets
`I_m(0) = max(S_m − E[D_m]·T_s, 0)` (= `E·κ` + safety stock) and primes the
pipeline with one expected week per lead-time slot — so position starts at
exactly `S_m` and the min-max saw-tooth begins in phase. `initial_on_hand`
overrides per material.

## SimContext and determinism

Policies receive a `SimContext` and interact only through typed accessors:
state views, guarded mutation helpers (`write_levels`, `write_purchase_orders`,
`move_pipeline`, …), `ctx.events_visible()` (the post-detection view),
`ctx.params(policy_id)`, `ctx.cost.add(component, amount)`, and
`ctx.rng(policy_id)` — the **only** RNG a policy may consume
([keyed streams](statistics.md)). In debug builds the mutation helpers
enforce each hook's declared write-set (`WriteGuardError`).

Within a replication everything is single-threaded and deterministic;
parallelism is across replications/cells only (§10.2.3). Golden trace #1
asserts byte-identical weekly traces across runs.

## Deviations from the manuscript (documented, deliberate)

1. **Continuous quantities.** Eq. 8 floors `⌊I_m/r⌋`; the engine uses the
   fluid approximation (standard for weekly buckets; negligible at
   manuscript volumes). An integer mode is a Tier-2 candidate.
2. **Baseline shared-material allocation** is greedy in fixed product order
   (deterministic, documented); the manuscript's implicit baseline is
   sequential too. P-P.9 exists to replace exactly this.
3. **Stochastic lead times** (`lognormal`/`gamma`) consume the world
   leadtime stream only when an order ships — see the
   [CRN caveat](statistics.md#crn-caveats). The manuscript core is
   deterministic-LT and unaffected.
