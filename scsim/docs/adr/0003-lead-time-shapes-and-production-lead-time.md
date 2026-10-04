# ADR 0003 — Lead-time shapes chosen like demand, and a production lead time

**Status:** accepted (2026-10-03) · **Engine:** from 0.7.0 · **Tier:** 3
(each package records its line under *Changes* below).

**Governs:** blueprint catalog rows **P-S.6** (widened) and **P-P.13** (new), the
§2.4 fidelity boundary ("W^FG = 0 by default; a per-product production lead time
is opt-in"); `docs/PLAN.md` §25 (Phase 15) and §4 **D291**, **D292**.

## Context

Engine 0.6.1 drew a supplier lead time only as a CV-parameterised lognormal or
gamma around the link's lead time, with the shape taken per MATERIAL, and
completed production in the week it started. The product owner asked
(2026-10-03) for lead times configured like demand — a distribution per
supplier × material row with only the parameters it needs — and for a
production lead time per product.

## Decision

1. **Shapes.** `LeadTimeDist` gains `normal` (mean + CV, a draw below one week
   is raised to one and counted), `triangular` (min, mode, max) and `uniform`
   (min, max). `empirical` stays reserved and a `CompileError`.
2. **One planning lead time per link.** For the CV shapes the link's
   `lead_time_weeks` is the mean. A bounded shape IS its bounds; its planning
   lead time is their mean, and `SupplierLink` refuses a `lead_time_weeks`
   outside them. P-P.3's King formula reads the bounded shape's own σ/μ.
3. **CRN.** The new shapes draw standard uniforms per (lane, week) before any
   policy acts, from a new WORLD spawn key with one child stream per lane keyed
   by a digest of `supplier::material` (`seeds.lane_leadtime_rng`). The link order
   follows the chosen primary, so a positional stream would hand a lane another
   lane's draws. The world `leadtime` stream — every lognormal and gamma draw — is
   consumed exactly as before.
4. **One implementation.** `scsim/core/leadtime.py` is the inverse CDF for every
   lead time the engine draws; production lead times (P-P.13) reuse it.
5. **Expediting.** A shipment whose lead time a policy changed scales a bounded
   draw by its own mean over the link's planning value.

## Changes

| Engine | Package | Change |
|---|---|---|
| 0.7.0 | §25 WP 15.1 | The three shapes, the per-lane world stream, `lead_time_floor_raises` on the result. No phase or state key changed; the pipeline snapshot moved by its engine version only. |
| 0.8.0 | §25 WP 15.4 | P-P.13: `Product.production_lead_time_*`; PH-50 puts starts in a per-product production pipeline (materials consumed at start) and `production_output` becomes what COMPLETES — what P-C.1 ships and FG receives; `production_started` carries the starts (P-P.5's overtime and P-P.1's shortage flag read it). PH-40 offsets the plan by the EXPECTED L, netting the work in progress (`planning.production_lead_time_offset`). A second new world spawn key (`product_prodtime_rng`). WIP traced (`trace.wip_units` / `wip_value`, `WIP`, `ScenarioResult.work_in_progress`) and charged no holding cost. No phase or state key added; L = 0 everywhere is the pre-0.8.0 path. |
