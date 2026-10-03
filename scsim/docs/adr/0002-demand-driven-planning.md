# ADR 0002 — Demand-driven planning: customer rows, planned production, MRP, per-row fulfillment

**Status:** accepted (2026-10-02) · **Engine:** from 0.2.11 · **Tier:** 3
(pipeline contract changes land with the packages that make them; each records
its line under *Changes* below).

**Governs:** blueprint gap **G20**, workstream **B2**, engine milestone **M9**;
`docs/PLAN.md` §24 (Phase 14) and §4 **D284**. The design — definitions,
formulas and the worked example — is
[`docs/design/mrp-multi-stage-planning.md`](../../../docs/design/mrp-multi-stage-planning.md);
the work plan is [`docs/PLAN.md` §24](../../../docs/PLAN.md).

## Context

Engine 0.2.9 measured four connected gaps (§4 D284): material demand is a
compile-time constant for MTO and ignores the production plan; demand exists
per product only, with no forecast series, and `normal` silently runs as
triangularAV; fulfillment (backorder, allocation) is project-wide only with a
per-product backlog; and `Product.fg_policy` is declared and read by nothing,
with no FG opening stock (RFC 4). The product owner decided how the flow must
work on 2026-10-02.

## Decision — the owner's eight rules

| # | Rule |
|---|---|
| 1 | Planned production = **min(requirement, capacity)**. The requirement is projected demand (MTO) or what the FG inventory policy asks for (MTS). |
| 2 | Demand is entered **per customer × product row**: a forecast series (quantity per week), or mean + variation + distribution (normal, triangular, triangularAV, deterministic, poisson). The plan uses the forecast or mean; actual demand is drawn around it. |
| 3 | FG policies: **base-stock** (S units), **min-max** (s, S units), **days of cover** (target = D/7 × projected weekly demand, so it moves with the forecast). |
| 4 | **One allocation rule per project**; priority, price and service-level target **per row**. |
| 5 | **Per-row backorder now**: backorder allowed, max backorder days, backorder cost per unit per day, with a per-row backlog. |
| 6 | A capacity shortfall carries to the next week **only for rows that allow backorder**, within their window, split by the allocation rule. The plan and fulfillment share one rule. |
| 7 | A monthly forecast is **spread evenly** over its weeks. |
| 8 | Negative `normal` draws are **set to 0**; the run reports the clip count and the mean shift. |

The principle behind all eight: **the flow starts from future finished-good
demand**, and **the plan never reads the realized future demand draws** (gate
`plan-from-demand`, lands with WP 14.6).

## Invariants every package keeps

* **Behaviour-neutral by default.** A project that sets none of the new fields
  runs byte-identically. Since WP 14.0 this is checkable rather than claimed:
  `scsim/tests/test_golden_digests.py` freezes the reference scenarios' traces
  and `sim-worker/tests/test_golden_runs.py` the committed datasets' runs.
* **A1 — one writer per state key.** New keys are declared in
  `scsim/scsim/core/phases.py` and validated at compile.
* **One allocation function.** Fulfillment (PH-60) and the plan's shortfall
  split (PH-40) call `scsim/scsim/core/allocation.py`; "the plan and
  fulfillment share one rule" (decision 6) is true by construction.

## Changes (one line per package that changes behaviour or the contract)

* **WP 14.0** (engine 0.2.11, no version change) — `core/allocation.py`: the
  shared helper (`priority`, `fair_share`, `proportional`, `revenue_max`,
  `sla_tier`; oldest backlog first; ties by row order; batched over products by
  a CSR row pointer). P-C.2 delegates to it with outputs identical to before
  (golden digests unchanged). No contract or behaviour change.
* **WP 14.1** (engine 0.2.11 → **0.3.0**, Tier 3: a new transient key) —
  `CustomerLink` carries an optional demand spec (`demand_model` ∈
  deterministic / normal / triangular / triangular_av / poisson, `demand_mean`,
  `demand_variation`, `demand_min`, `demand_max`, `forecast`). New transient key
  **`demand_rows`**, owned by **PH-10**; `pipeline_schema.json` re-frozen. When
  any row carries a spec, the world schedule is drawn **per row** under a new
  consumption contract (`context.py::draw_week_demand_rows`) and product demand
  is the row sum; with none, the per-product draw and its contract are
  unchanged byte for byte. `DemandModel.NORMAL` (last in the enum, so no
  existing draw sequence moves): N(μ, cv·μ), negatives set to 0, clips and the
  mean shift reported on `ScenarioResult.demand_clips` and as run warnings.
  **Declared behaviour change:** the mapper's `normal` is a real normal (it ran
  as triangularAV with `demand_cv` as its ± fraction). The plan's view is
  `SimContext.projected_demand_rows` / `projected_demand` — centres only, never
  draws. KPIs `demand_forecast_bias` / `demand_forecast_mape` (pooled and per
  product) appear only when rows carry specs.
* **WP 14.2** (engine 0.3.0, no version change; data contract) — no engine
  behaviour change. The per-row spec and dated forecasts reach `OutboundArc`
  from the data: `outbound_logistics` demand columns and a `demand_forecasts`
  table (monthly buckets spread evenly at promotion, decision 7), both in the
  snapshot's simulation scope, laid on one calendar by
  `sim_worker/datamap.py::forecast_series` (week 0 = the project's earliest
  `period_start`; design doc §9, point 5). The mapper reads the Customer
  table's row overrides (`row_demand_*`, `_apply_row_demand_overrides`).
* **WP 14.3** (engine 0.3.0 → **0.4.0**, Tier 3: P-C.1's hook now reads
  `demand_rows`) — per-row fulfillment. P-C.1 takes `row_overrides`
  (backorder allowed, horizon, penalty per `<customer>::<product>`) and, when
  a row carries any or the project's rule needs per-row inputs, keeps the
  backlog per row (`[rows × (max horizon + 1)]`, each row expiring at its own
  horizon), splits each product's supply with `core/allocation.py`, and writes
  `ctx.fulfilled_rows` / `served_new_rows` / `lost_rows` and
  `ctx.backlog_rows` (Σ = `ctx.backlog`, which every existing reader keeps).
  P-C.2 publishes the rule and per-row priority / price / floor at setup
  (`ctx.row_allocation`); `revenue_max` is a real rule. New entity fields
  `Customer.sla_fill_floor_pct`, `CustomerLink.unit_price`. KPIs per row and per
  customer only on the per-row path. **Declared behaviour changes:** a project
  whose rule is `revenue_max` (ran as `priority`), a project under `sla_tier`
  whose customers state `sla_fill_floor_pct`, and a max-backorder value at a
  half week (3.5 days → 1 week, was 0) run differently. Golden digests (engine
  and worker) unchanged.
