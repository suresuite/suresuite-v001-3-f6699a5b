"""P-S.2 proactive_multi_sourcing — STRATEGIC, order splitting (Part IV §4.2). M7 ✅.

Context: split orders across WARM sources in normal operations — no
activation delay, permanent premium; the structural answer to capacity-cut
events. Pay-always, versus P-S.1's pay-on-activation.

Mechanics: at PH-80 (priority 55, between P-P.1's release and P-S.1's
contingent rerouting) each enabled material's released order splits across
its qualified links by ``weights`` (default: equal split over the cheapest
sources that can each carry ≥ ``min_share_pct``). Every slice carries its
own link's lead time and cost — a disruption hits only its slice, which the
link-indexed pipeline gives for free. ``rebalance_trigger="disruption"``
re-normalizes shares away from firm-visibly disrupted suppliers; if P-S.1
is also enabled it still reroutes the primary slice (the composition story:
structural split + contingent reroute).

Premium: Σ over non-primary slices of (c_{m,s} − c_{m,primary} +
secondary_premium) · qty → C^res as ``multi_sourcing_premium``.

Approximation (documented): P-P.1's levels keep using the primary link's
lead time; a share-weighted T_s refinement is an M8 candidate.
"""
from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from scsim.core.context import SimContext
from scsim.core.phases import (
    FIRM_KNOWLEDGE,
    PURCHASE_ORDERS,
    ST_COST_LEDGER,
    Hook,
    PhaseId,
)
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


class ProactiveMultiSourcingParams(PolicyParams):
    weights: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "share % per (material → supplier)", "scope": "SM",
                           "notes": "w_{m,s}; each material's shares sum to 100. "
                                    "Materials absent here use the default equal split."},
    )
    min_share_pct: float = Field(
        20.0, ge=5.0, le=50.0,
        json_schema_extra={"unit": "%", "scope": "G",
                           "notes": "Smallest viable slice; caps how many sources the "
                                    "default split spreads across."},
    )
    rebalance_trigger: Literal["none", "disruption"] = Field(
        "none",
        json_schema_extra={"unit": "enum", "scope": "G",
                           "notes": "disruption: shift shares away from firm-visibly "
                                    "disrupted suppliers. reliability_drop lands with "
                                    "reliability dynamics (M8)."},
    )
    secondary_premium: float = Field(
        0.0, ge=0,
        json_schema_extra={"unit": "€/unit", "scope": "SM",
                           "notes": "Contractual premium on non-primary slices, on top of "
                                    "the link cost difference."},
    )


@register_plugin
class ProactiveMultiSourcing(PolicyPlugin):
    id: ClassVar[str] = "proactive_multi_sourcing"
    catalog_ref: ClassVar[str] = "P-S.2"
    stage: ClassVar[Stage] = Stage.SUPPLIER
    strategy_class: ClassVar[StrategyClass] = StrategyClass.STRATEGIC
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.MATERIAL_AVAILABILITY
    requires_predeployment: ClassVar[bool] = True
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "Split orders across warm sources in NORMAL operations — no activation delay, "
        "permanent premium; the structural answer to capacity-cut events. Pay-always vs "
        "P-S.1's pay-on-activation; each slice carries its own source's lead time, so a "
        "disruption hits only its slice."
    )
    Params: ClassVar[type[PolicyParams]] = ProactiveMultiSourcingParams
    data_requirements: ClassVar[tuple[DataRequirement, ...]] = (
        DataRequirement(
            field="inbound_logistics.volume", level="recommended",
            reason="Standing order splits derive source weights from lane "
                   "volumes when explicit ratios are not set.",
            fallback=None,
        ),
    )

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH80, priority=55,
                reads={PURCHASE_ORDERS, FIRM_KNOWLEDGE},
                writes={PURCHASE_ORDERS, ST_COST_LEDGER},
                resolution="Splits the orders released by inventory_control (priority 50) "
                           "across qualified links; P-S.1 (priority 60) may still reroute "
                           "a disrupted slice afterwards.",
            ),
        ]

    # ------------------------------------------------------------ feasibility

    def feasibility(self, scenario: Scenario) -> FeasibilityResult:
        p: ProactiveMultiSourcingParams = self.params
        net = scenario.network
        issues: list[FeasibilityIssue] = []
        multi = [m.id for m in net.materials if len(net.supplier_options(m.id)) > 1]
        if not multi:
            return FeasibilityResult(False, (FeasibilityIssue(
                "error", "no_alternative_sources",
                "proactive_multi_sourcing is infeasible: every material is single-sourced"),))
        mat_ids = {m.id for m in net.materials}
        for mat, shares in p.weights.items():
            if mat not in mat_ids:
                issues.append(FeasibilityIssue(
                    "error", "unknown_material", f"weights reference unknown material {mat!r}"))
                continue
            qualified = {l.supplier_id for l in net.supplier_options(mat)}
            unknown = set(shares) - qualified
            if unknown:
                issues.append(FeasibilityIssue(
                    "error", "unqualified_source",
                    f"weights[{mat!r}] include non-qualified supplier(s) {sorted(unknown)}"))
            total = sum(shares.values())
            if abs(total - 100.0) > 1e-6:
                issues.append(FeasibilityIssue(
                    "error", "weights_sum", f"weights[{mat!r}] sum to {total}, expected 100"))
            small = [s for s, w in shares.items() if 0 < w < p.min_share_pct]
            if small:
                issues.append(FeasibilityIssue(
                    "error", "below_min_share",
                    f"weights[{mat!r}]: share(s) below min_share_pct={p.min_share_pct}%: "
                    f"{sorted(small)}"))
        errors = [i for i in issues if i.severity == "error"]
        return FeasibilityResult(not errors, tuple(issues))

    # ---------------------------------------------------------------- runtime

    def setup(self, ctx: SimContext) -> None:
        p: ProactiveMultiSourcingParams = self.params
        m = ctx.model
        shares = np.zeros(m.n_links)
        enabled = np.zeros(m.n_mats, dtype=bool)
        for mat in range(m.n_mats):
            links = m.links_of_mat[mat]
            if len(links) < 2:
                continue
            mat_id = m.mat_ids[mat]
            if mat_id in p.weights:
                for link in links:
                    sup_id = m.sup_ids[m.link_sup[link]]
                    shares[link] = p.weights[mat_id].get(sup_id, 0.0) / 100.0
            else:
                # Equal split over the cheapest k sources where 100/k ≥ min_share
                # (links_of_mat is cost-sorted, primary first).
                k = min(len(links), max(2, int(100.0 // p.min_share_pct)))
                for link in links[:k]:
                    shares[link] = 1.0 / k
            enabled[mat] = shares[links].sum() > 0
        ctx.policy_state[self.id] = {"shares": shares, "enabled": enabled}

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        p: ProactiveMultiSourcingParams = self.params
        m = ctx.model
        state = ctx.policy_state[self.id]
        orders = ctx.purchase_orders.copy()
        disrupted = (
            ctx.visible_disrupted_suppliers()
            if p.rebalance_trigger == "disruption" else np.zeros(m.n_sups, dtype=bool)
        )
        premium_total = 0.0
        changed = False
        for mat in np.flatnonzero(state["enabled"]):
            links = m.links_of_mat[mat]
            primary = m.primary_link[mat]
            qty = orders[primary]
            if qty <= 0:
                continue
            shares = state["shares"][links].copy()
            if disrupted.any():
                healthy = ~disrupted[m.link_sup[links]]
                if healthy.any() and not healthy.all():
                    shares = np.where(healthy, shares, 0.0)
                    total = shares.sum()
                    if total > 0:
                        shares = shares / total
            orders[primary] = 0.0
            for k, link in enumerate(links):
                slice_qty = qty * float(shares[k])
                if slice_qty <= 0:
                    continue
                orders[link] += slice_qty
                if link != primary:
                    premium_total += slice_qty * (
                        float(m.link_cost[link] - m.link_cost[primary]) + p.secondary_premium
                    )
            changed = True
        if changed:
            ctx.write_purchase_orders(orders)
            if premium_total > 0:
                ctx.cost.add("multi_sourcing_premium", premium_total)
