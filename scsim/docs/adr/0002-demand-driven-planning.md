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
