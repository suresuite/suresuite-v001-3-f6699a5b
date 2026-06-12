"""P-C.1 unmet_demand_handling — BUILT_IN (Part IV §4.1). ✅ lost_sales.

Context: does an unservable order die (competitive markets) or wait
(contractual B2B)? Changes the economics of every strategy: backorders
convert lost revenue to delay cost.

Resident at PH-60. MTO: production Q_p is allocated FIFO to existing
backlog first, then to this week's demand; the rule decides what happens
to the remainder. Backorders age in weekly buckets and expire to lost
sales after ``backorder_horizon`` weeks.
"""
from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from scsim.core.context import SimContext
from scsim.core.phases import (
    DEMAND,
    FG_FULFILLMENT,
    FULFILLMENT,
    PRODUCTION_OUTPUT,
    ST_BACKLOG,
    ST_COST_LEDGER,
    ST_LOST_SALES,
    Hook,
    PhaseId,
)
from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass
from scsim.policies.base import PolicyParams, PolicyPlugin
from scsim.policies.registry import register_plugin


class UnmetDemandParams(PolicyParams):
    rule: Literal["lost_sales", "backorder", "partial_backorder"] = Field(
        "lost_sales",
        json_schema_extra={"unit": "enum", "scope": "P", "notes": "lost_sales ✅ (manuscript)."},
    )
    backorder_horizon: int = Field(
        4, ge=0, le=26,
        json_schema_extra={"unit": "weeks", "scope": "P", "notes": "Aged-out backlog becomes lost."},
    )
    backorder_penalty: float = Field(
        0.0, ge=0,
        json_schema_extra={"unit": "€/unit/wk", "scope": "P"},
    )
    partial_accept_prob: float = Field(
        0.5, ge=0.0, le=1.0,
        json_schema_extra={"unit": "-", "scope": "P", "notes": "Share of unmet demand that waits."},
    )


@register_plugin
class UnmetDemandHandling(PolicyPlugin):
    id: ClassVar[str] = "unmet_demand_handling"
    catalog_ref: ClassVar[str] = "P-C.1"
    stage: ClassVar[Stage] = Stage.CUSTOMER
    strategy_class: ClassVar[StrategyClass] = StrategyClass.BUILT_IN
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.DEMAND_SIDE
    requires_predeployment: ClassVar[bool] = False
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "What happens to an unservable order: it dies (lost_sales — competitive markets), "
        "waits (backorder — contractual B2B), or splits (partial_backorder). Backorders "
        "convert lost revenue into delay cost, changing the economics of every strategy."
    )
    Params: ClassVar[type[PolicyParams]] = UnmetDemandParams

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH60, priority=50,
                reads={DEMAND, PRODUCTION_OUTPUT, FG_FULFILLMENT},
                writes={FULFILLMENT, ST_BACKLOG, ST_LOST_SALES, ST_COST_LEDGER},
            ),
        ]

    def setup(self, ctx: SimContext) -> None:
        p: UnmetDemandParams = self.params
        if p.rule in ("backorder", "partial_backorder") and p.backorder_horizon > 0:
            ctx.policy_state[self.id] = {
                # age_buckets[p, k] = backlog units that have waited k weeks
                "age_buckets": np.zeros((ctx.model.n_prods, p.backorder_horizon + 1)),
            }

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        p: UnmetDemandParams = self.params
        Q = ctx.production_output
        D = ctx.demand
        mts = ctx.model.mts_mask

        # FIFO: clear existing backlog first, then serve this week's demand.
        # CODP-aware availability: MTO ships production output; MTS shipped
        # from FG stock at PH-30 (fg_served_*), production went to stock.
        served_backlog_mto = np.minimum(Q, ctx.backlog)
        served_new_mto = np.minimum(Q - served_backlog_mto, D)
        served_backlog = np.where(mts, ctx.fg_served_backlog, served_backlog_mto)
        served_new = np.where(mts, ctx.fg_served_new, served_new_mto)
        unmet_new = D - served_new
        fulfilled = served_backlog + served_new

        lost = np.zeros_like(D)
        if p.rule == "lost_sales":
            lost = unmet_new
            new_backlog = np.zeros_like(D)
        else:
            waiting = unmet_new if p.rule == "backorder" else unmet_new * p.partial_accept_prob
            lost = unmet_new - waiting
            state = ctx.policy_state.get(self.id)
            if state is not None:
                buckets = state["age_buckets"]
                # Serve oldest first, expire the over-age bucket to lost sales.
                self._drain_fifo(buckets, served_backlog)
                expired = buckets[:, -1].copy()
                lost = lost + expired
                buckets[:, 1:] = buckets[:, :-1]
                buckets[:, 0] = waiting
                new_backlog = buckets.sum(axis=1)
            else:
                # horizon 0: nothing may wait beyond the week — degenerate case.
                new_backlog = ctx.backlog - served_backlog + waiting

            if p.backorder_penalty > 0:
                ctx.cost.add("backorder_penalty", float(new_backlog.sum()) * p.backorder_penalty)

        ctx.write_fulfillment(fulfilled, served_new, lost)
        ctx.set_backlog(new_backlog)

    @staticmethod
    def _drain_fifo(buckets: np.ndarray, served: np.ndarray) -> None:
        """Remove served units from the oldest age buckets first (in place)."""
        remaining = served.copy()
        for k in range(buckets.shape[1] - 1, -1, -1):
            take = np.minimum(buckets[:, k], remaining)
            buckets[:, k] -= take
            remaining -= take
