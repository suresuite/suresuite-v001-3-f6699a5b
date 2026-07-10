"""P-P.1 inventory_control — BUILT_IN buffer (Part IV §4.1). ✅ min_max.

Context: the everyday replenishment rule — the baseline shock absorber every
chain already has; quantifying it prevents over-buying dedicated resilience.

Variants: min-max (ERP discrete manufacturing — the case company),
base-stock (high-value/low-volume), (R,Q) (stable flows), periodic
(consolidated cadence).

Mechanics (Eqs. 2–6): levels at PH-70, release at PH-80 — order
max(S_m − position, MOQ) when position < s_m, on the material's primary
(min-cost) supplier link.
"""
from __future__ import annotations

from typing import ClassVar, Literal, Optional

import numpy as np
from pydantic import Field, field_validator, model_validator

from scsim.core.context import SimContext
from scsim.core.phases import (
    INVENTORY_LEVELS,
    MATERIAL_DEMAND,
    PURCHASE_ORDERS,
    ST_ON_HAND,
    ST_PIPELINE,
    ST_QUEUE,
    Hook,
    PhaseId,
)
from scsim.entities.enums import (
    ConstraintTag,
    FulfillmentMode,
    PolicyStatus,
    Stage,
    StrategyClass,
    TransportMode,
)
from scsim.entities.network import Network
from scsim.entities.scenario import Scenario
from scsim.policies.base import (
    DataRequirement,
    FeasibilityIssue,
    FeasibilityResult,
    ModeStrip,
    PolicyParams,
    PolicyPlugin,
)
from scsim.policies.registry import register_plugin


def _primary_link_lts(net: Network) -> dict[str, int]:
    """Effective primary-link lead time per material id, mirroring
    CompiledModel's (cost, lt, supplier) primary selection and edge
    lead-time folding — kept in lockstep by a drift test."""
    lane_extra: dict[str, int] = {}
    for lane in sorted(net.lanes, key=lambda l: (l.mode != TransportMode.DEFAULT, l.id)):
        lane_extra.setdefault(lane.supplier_id, int(lane.lead_time_weeks))
    out: dict[str, int] = {}
    for link in sorted(net.supplier_links,
                       key=lambda l: (l.cost, l.lead_time_weeks, l.supplier_id)):
        out.setdefault(link.material_id,
                       int(link.lead_time_weeks) + lane_extra.get(link.supplier_id, 0))
    return out


class InventoryControlParams(PolicyParams):
    policy_type: Literal["min_max", "base_stock", "rop_q", "periodic"] = Field(
        "min_max",
        json_schema_extra={"unit": "enum", "scope": "M", "notes": "min_max ✅ (manuscript)."},
    )
    basis: Literal["days_of_supply", "forward_visible"] = Field(
        "days_of_supply",
        json_schema_extra={
            "unit": "enum", "scope": "G/M",
            "notes": "Policy Basis (§II.4): days_of_supply sizes levels from the stationary "
                     "mean (s = E[D_m]·T_s); forward_visible sums the committed forward "
                     "order book over the coverage window (WSC-2026 MTO) — requires the "
                     "P-C.6 forward_visibility customer policy.",
        },
    )
    coverage_weeks: ModeStrip = Field(
        default_factory=lambda: ModeStrip(nominal=8, alert=10, crisis=12),
        json_schema_extra={
            "unit": "weeks", "scope": "G/M", "range": "[0, 26]",
            "notes": "κ — order-up-to cover beyond lead time. Strip 8/10/12.",
        },
    )
    review_cadence_weeks: Literal[1, 2, 4] = Field(
        1, json_schema_extra={"unit": "weeks", "scope": "G"},
    )
    rop_q_quantity: Optional[float] = Field(
        None, gt=0,
        json_schema_extra={"unit": "units", "scope": "M", "notes": "Fixed (R,Q) lot; ≥ MOQ enforced."},
    )
    periodic_review_weeks: int = Field(
        4, ge=1, le=13, json_schema_extra={"unit": "weeks", "scope": "G"},
    )

    @field_validator("coverage_weeks")
    @classmethod
    def _kappa_range(cls, v: ModeStrip) -> ModeStrip:
        for mode in ("nominal", "alert", "crisis"):
            k = getattr(v, mode)
            if not (0 <= k <= 26):
                raise ValueError(f"coverage_weeks.{mode} must be in [0, 26]")
        return v

    @model_validator(mode="after")
    def _forward_needs_integral_kappa(self) -> "InventoryControlParams":
        if self.basis == "forward_visible":
            for mode in ("nominal", "alert", "crisis"):
                k = getattr(self.coverage_weeks, mode)
                if k != int(k):
                    raise ValueError(
                        f"basis='forward_visible' sums whole forward weeks: "
                        f"coverage_weeks.{mode} must be integral, got {k}"
                    )
        return self


@register_plugin
class InventoryControl(PolicyPlugin):
    id: ClassVar[str] = "inventory_control"
    catalog_ref: ClassVar[str] = "P-P.1"
    stage: ClassVar[Stage] = Stage.PLANT
    strategy_class: ClassVar[StrategyClass] = StrategyClass.BUILT_IN
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.MATERIAL_AVAILABILITY
    requires_predeployment: ClassVar[bool] = False
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "Everyday replenishment rule (min-max / base-stock / (R,Q) / periodic). The baseline "
        "shock absorber every chain already has; quantifying it prevents over-buying "
        "dedicated resilience."
    )
    Params: ClassVar[type[PolicyParams]] = InventoryControlParams
    data_requirements: ClassVar[tuple[DataRequirement, ...]] = (
        DataRequirement(
            field="materials.moq", level="defaulted",
            reason="Minimum order quantity rounds up PH-80 order releases.",
            fallback="0 (no minimum)",
        ),
        DataRequirement(
            field="materials.holding_cost_pct", level="defaulted",
            reason="Holding cost rate prices the inventory this policy carries.",
            fallback="policy inventory.holding_cost_pct, then 20%",
        ),
    )

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH70, priority=50,
                reads={MATERIAL_DEMAND},
                writes={INVENTORY_LEVELS},
            ),
            Hook(
                phase=PhaseId.PH80, priority=50,
                reads={INVENTORY_LEVELS, ST_ON_HAND, ST_PIPELINE, ST_QUEUE},
                writes={PURCHASE_ORDERS},
            ),
        ]

    # ------------------------------------------------------------ feasibility

    def feasibility(self, scenario: Scenario) -> FeasibilityResult:
        p: InventoryControlParams = self.params
        if p.basis != "forward_visible":
            return FeasibilityResult.ok()
        # §II.4 two-stage contract: the forward basis is selectable only when
        # a customer policy provides τ* ≥ T_s + κ, and only for MTO worlds.
        fv = scenario.policies.get("forward_visibility")
        if fv is None:
            return FeasibilityResult(False, (FeasibilityIssue(
                "error", "forward_basis_needs_visibility",
                "basis='forward_visible' requires the forward_visibility customer policy "
                "(P-C.6): the plant can only read a forward order book a customer commits",
            ),))
        mts = [pr.id for pr in scenario.network.products
               if pr.fulfillment_mode == FulfillmentMode.MTS]
        if mts:
            return FeasibilityResult(False, (FeasibilityIssue(
                "error", "forward_basis_is_mto_only",
                f"basis='forward_visible' is MTO-only (§II.4): MTS products plan material "
                f"demand from the forecast, not the committed book — found MTS: {mts[:5]}",
            ),))
        tau = fv.get("visibility_horizon") or scenario.settings.visibility_horizon
        max_lt = max(_primary_link_lts(scenario.network).values(), default=0)
        kappa_crisis = int(p.coverage_weeks.crisis)
        if max_lt + kappa_crisis > tau:
            return FeasibilityResult(False, (FeasibilityIssue(
                "error", "coverage_beyond_visibility",
                f"forward windows must fit the visible book (T_s + κ ≤ τ*, §II.4): "
                f"max primary lead time {max_lt}w + crisis κ {kappa_crisis}w exceeds "
                f"τ* = {tau}w",
            ),))
        return FeasibilityResult.ok()

    # ---------------------------------------------------------------- runtime

    def _kappa(self, ctx: SimContext) -> float:
        strip: ModeStrip = self.params.coverage_weeks
        return strip.crisis if ctx.events_visible() else strip.nominal

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        if phase == PhaseId.PH70:
            self._set_levels(ctx)
        elif phase == PhaseId.PH80:
            self._release(ctx)

    def _set_levels(self, ctx: SimContext) -> None:
        m = ctx.model
        kappa = self._kappa(ctx)
        if self.params.basis == "forward_visible":
            # §II.4 Forward-visible schedule (WSC-2026 MTO), inclusive windows:
            # s_m[t] = Σ_{τ=t}^{t+T_s} D̂_m[τ]; S_m[t] = Σ_{τ=t}^{t+T_s+κ} D̂_m[τ].
            lt = m.link_lt[m.primary_link]
            t = ctx.week
            s = ctx.forward_material_demand(t, lt)
            S = ctx.forward_material_demand(t, lt + int(kappa))
            ctx.write_levels(s, S)
            return
        # Eqs. 2–3: s_m = E[D_m]·T_s ; S_m = E[D_m]·(T_s + κ). P-P.3 adds SS after us.
        exp_d = ctx.material_demand
        lt = m.link_lt[m.primary_link].astype(float)
        s = exp_d * lt
        S = exp_d * (lt + kappa)
        ctx.write_levels(s, S)

    def _release(self, ctx: SimContext) -> None:
        m = ctx.model
        p: InventoryControlParams = self.params
        position = ctx.on_hand + ctx.pipeline_on_order()
        orders_mat = np.zeros(m.n_mats)
        moq = m.link_moq[m.primary_link]

        if p.policy_type == "min_max":
            if ctx.week % p.review_cadence_weeks == 0:
                short = position < ctx.level_s
                orders_mat[short] = np.maximum(ctx.level_S[short] - position[short], moq[short])
        elif p.policy_type == "base_stock":
            deficit = ctx.level_S - position
            up = deficit > 1e-12
            orders_mat[up] = np.maximum(deficit[up], moq[up])
        elif p.policy_type == "rop_q":
            short = position < ctx.level_s
            q = p.rop_q_quantity if p.rop_q_quantity is not None else 0.0
            orders_mat[short] = np.maximum(q, moq[short])
        else:  # periodic
            if ctx.week % p.periodic_review_weeks == 0:
                deficit = ctx.level_S - position
                up = deficit > 1e-12
                orders_mat[up] = np.maximum(deficit[up], moq[up])

        orders = np.zeros(m.n_links)
        nonzero = orders_mat > 0
        orders[m.primary_link[nonzero]] = orders_mat[nonzero]
        ctx.write_purchase_orders(orders)
