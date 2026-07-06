"""P-C.2 customer_allocation — IMPROVISATION, who do we disappoint first. ✅

Context: under scarcity the engine's product-level fulfillment (P-C.1,
PH-60) says HOW MUCH ships; this policy says WHO gets it. Each product's
weekly new-demand fulfillment is distributed across the customers that buy
it (``Network.customer_links`` shares, uniform when absent), and per-segment
service KPIs are reported so "protect strategic accounts" becomes a measured
outcome instead of a hope. Inert for single-customer networks.

Rules (weekly-bucket fidelity — within a bucket there is no arrival order,
so ``fcfs``, ``proportional``, and demand-basis ``fair_share`` coincide as a
pro-rata split; they stay separate enum values because they diverge if a
sub-weekly tick ever lands):

- ``fcfs`` / ``proportional`` / ``fair_share``: pro-rata to demand shares —
  every customer of a product gets the same fill rate.
- ``priority``: serve customers in descending priority weight
  (``priority_weights`` param, else ``Customer.priority_weight``); high
  priority fills completely before lower sees a unit.
- ``sla_tier``: two passes — first guarantee each segment's fill floor
  (``sla_tiers``: segment → floor %, scaled down pro-rata when supply
  cannot honor all floors), then distribute the remainder by priority.

The split is value-weighted with the product's unit price, matching the
engine's value-based fill-rate convention. Distribution does not alter
product-level physics (totals are conserved); its output is the per-segment
service view — the §7 interaction-8 path made observable.

KPIs (facet 7, via ``kpi_contribution``): ``fill_rate_segment_<segment>``
per customer segment and ``min_segment_fill_rate``, both over the analysis
window. Segments are capped at 10 by the entity contract, so the KPI
surface stays bounded regardless of customer count.
"""
from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from scsim.core.context import SimContext
from scsim.core.phases import DEMAND, FULFILLMENT, Hook, PhaseId
from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass
from scsim.entities.scenario import Scenario
from scsim.policies.base import (
    DataRequirement,
    FeasibilityIssue,
    FeasibilityResult,
    PolicyParams,
    PolicyPlugin,
)
from scsim.policies.registry import register_plugin


class CustomerAllocationParams(PolicyParams):
    rule: Literal["fcfs", "proportional", "fair_share", "priority", "sla_tier"] = Field(
        "fcfs", json_schema_extra={"unit": "enum", "scope": "C",
                                   "notes": "fcfs/proportional/fair_share coincide at weekly "
                                            "buckets (pro-rata); priority and sla_tier reorder."})
    priority_weights: dict[str, float] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "weight per customer", "scope": "C",
                           "notes": "Overrides Customer.priority_weight; higher serves first."})
    sla_tiers: dict[str, float] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "segment → fill floor %", "scope": "C",
                           "notes": "Guaranteed first-pass fill per segment; scaled down "
                                    "pro-rata when supply cannot honor all floors."})


@register_plugin
class CustomerAllocation(PolicyPlugin):
    id: ClassVar[str] = "customer_allocation"
    catalog_ref: ClassVar[str] = "P-C.2"
    stage: ClassVar[Stage] = Stage.CUSTOMER
    strategy_class: ClassVar[StrategyClass] = StrategyClass.IMPROVISATION
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.DEMAND_SIDE
    requires_predeployment: ClassVar[bool] = False
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "Under scarcity, 'who do we disappoint first' is deliberate — protect strategic "
        "accounts / SLA tiers / spread pain. Inert for single-customer MTO. Hook: PH-60."
    )
    Params: ClassVar[type[PolicyParams]] = CustomerAllocationParams
    data_requirements: ClassVar[tuple[DataRequirement, ...]] = (
        DataRequirement(
            field="outbound_logistics.volume", level="required",
            reason="Per-customer demand shares come from outbound volumes; "
                   "without them there are no customer segments to allocate "
                   "between (the policy is inert below two customers).",
            fallback=None,
        ),
    )

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH60, priority=60,
                reads={DEMAND, FULFILLMENT},
                # Read-only resident: distributes the fulfillment P-C.1
                # (priority 50) wrote across customers; product totals are
                # untouched, so no write contract is needed.
            ),
        ]

    # ------------------------------------------------------------ feasibility

    def feasibility(self, scenario: Scenario) -> FeasibilityResult:
        p: CustomerAllocationParams = self.params
        net = scenario.network
        issues: list[FeasibilityIssue] = []
        if len(net.customers) < 2:
            issues.append(FeasibilityIssue(
                "warning", "single_customer",
                "customer_allocation is inert: the network has fewer than two customers — "
                "there is no one to prioritize between",
            ))
        known = {c.id for c in net.customers}
        unknown = sorted(set(p.priority_weights) - known)
        if unknown:
            issues.append(FeasibilityIssue(
                "warning", "unknown_customer_weight",
                f"priority_weights name unknown customer(s): {unknown[:5]}",
            ))
        segments = {c.segment for c in net.customers}
        unknown_seg = sorted(set(p.sla_tiers) - segments)
        if unknown_seg:
            issues.append(FeasibilityIssue(
                "warning", "unknown_sla_segment",
                f"sla_tiers name unknown segment(s): {unknown_seg[:5]}",
            ))
        bad = {k: v for k, v in p.sla_tiers.items() if not 0.0 <= v <= 100.0}
        if bad:
            return FeasibilityResult(False, tuple(issues) + (FeasibilityIssue(
                "error", "sla_floor_out_of_range",
                f"sla_tiers floors must be in [0, 100]%: {bad}"),))
        return FeasibilityResult(True, tuple(issues))

    # ---------------------------------------------------------------- runtime

    def setup(self, ctx: SimContext) -> None:
        m = ctx.model
        p: CustomerAllocationParams = self.params
        T = m.settings.horizon
        seg_ids = sorted(set(m.cust_segment)) if m.n_custs else []
        seg_index = {s: k for k, s in enumerate(seg_ids)}
        # One-hot customer → segment aggregation matrix (n_segs × n_custs).
        seg_of = np.zeros((len(seg_ids), m.n_custs))
        for c, seg in enumerate(m.cust_segment):
            seg_of[seg_index[seg], c] = 1.0
        weights = np.array([
            p.priority_weights.get(cid, m.cust_priority[c])
            for c, cid in enumerate(m.cust_ids)
        ]) if m.n_custs else np.zeros(0)
        floors = np.array([
            p.sla_tiers.get(seg, 0.0) / 100.0 for seg in m.cust_segment
        ]) if m.n_custs else np.zeros(0)
        ctx.policy_state[self.id] = {
            "seg_ids": seg_ids,
            "seg_of": seg_of,
            # Priority order: descending weight, id as the deterministic tiebreak.
            "order": np.lexsort((np.arange(m.n_custs), -weights)),
            "floors": floors,
            "demand_seg": np.zeros((len(seg_ids), T)),
            "served_seg": np.zeros((len(seg_ids), T)),
        }

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        m = ctx.model
        if m.n_custs < 2:
            return
        p: CustomerAllocationParams = self.params
        state = ctx.policy_state[self.id]
        t = ctx.week
        # Value-weighted weekly split (engine fill-rate convention).
        d_pc = (ctx.demand * m.unit_price)[:, None] * m.cust_share       # (P, C)
        avail = ctx.served_new_week * m.unit_price                       # (P,)

        if p.rule in ("fcfs", "proportional", "fair_share"):
            with np.errstate(invalid="ignore", divide="ignore"):
                fill = np.where(ctx.demand > 0, ctx.served_new_week / ctx.demand, 1.0)
            s_pc = d_pc * fill[:, None]
        elif p.rule == "priority":
            s_pc = self._fill_in_order(d_pc, avail, state["order"])
        else:  # sla_tier: floors first (scaled if needed), remainder by priority
            g_pc = d_pc * state["floors"][None, :]
            g_tot = g_pc.sum(axis=1)
            with np.errstate(invalid="ignore", divide="ignore"):
                scale = np.where(g_tot > 0, np.minimum(1.0, avail / g_tot), 0.0)
            g_pc = g_pc * scale[:, None]
            s_pc = g_pc + self._fill_in_order(
                d_pc - g_pc, avail - g_pc.sum(axis=1), state["order"])

        state["demand_seg"][:, t] = state["seg_of"] @ d_pc.sum(axis=0)
        state["served_seg"][:, t] = state["seg_of"] @ s_pc.sum(axis=0)

    @staticmethod
    def _fill_in_order(d_pc: np.ndarray, avail: np.ndarray, order: np.ndarray) -> np.ndarray:
        """Serve customers left→right in ``order``: each fills completely
        before the next sees a unit (vectorized over products)."""
        d_sorted = d_pc[:, order]
        before = np.cumsum(d_sorted, axis=1) - d_sorted
        s_sorted = np.clip(avail[:, None] - before, 0.0, d_sorted)
        s_pc = np.empty_like(d_pc)
        s_pc[:, order] = s_sorted
        return s_pc

    def kpi_contribution(self, ctx: SimContext, t_w: int, window_end: int) -> dict[str, float]:
        if ctx.model.n_custs < 2:
            return {}
        state = ctx.policy_state[self.id]
        w = slice(t_w, window_end)
        out: dict[str, float] = {}
        fills = []
        for k, seg in enumerate(state["seg_ids"]):
            dem = float(state["demand_seg"][k, w].sum())
            srv = float(state["served_seg"][k, w].sum())
            fr = srv / dem if dem > 0 else 1.0
            out[f"fill_rate_segment_{seg}"] = fr
            fills.append(fr)
        out["min_segment_fill_rate"] = min(fills) if fills else 1.0
        return out
