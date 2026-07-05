"""P-S.1 backup_supplier — STRATEGIC, contingent rerouting (Part IV §4.2). ✅

Context: cheap until activated (premium only on rerouted orders), slower
than warm dual-sourcing, and USELESS when a BoM peer is single-sourced —
the manuscript's hard lesson. The UI shows ρ_s beside the toggle.

Mechanics: while the firm SEES a disruption on a material's chosen source
(PH-20 view), this week's released orders for that material reroute to the
backup s′; the cost premium (c_{m,s′} − c_{m,s}) · qty flows into C^res as
``backup_premium``. After the event clears, rerouting persists for
``cooldown_weeks`` (anti-flapping), then orders return to the primary.

Feasibility (§4.6 rule 1): materials without an alternative qualified
source are auto-excluded; if NO enabled material has one, the policy is
infeasible for the scenario.
"""
from __future__ import annotations

from typing import ClassVar, Literal, Optional, Union

import numpy as np
from pydantic import Field

from scsim.core.context import SimContext
from scsim.core.phases import (
    FIRM_KNOWLEDGE,
    PURCHASE_ORDERS,
    ST_COST_LEDGER,
    ST_ON_HAND,
    ST_PIPELINE,
    ST_QUEUE,
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


class BackupSupplierParams(PolicyParams):
    enabled_materials: Union[Literal["all_multi_sourced"], list[str]] = Field(
        "all_multi_sourced",
        json_schema_extra={"unit": "ids", "scope": "M",
                           "notes": "Materials covered; single-sourced ones are skipped."},
    )
    backup_lead_time_weeks: Optional[int] = Field(
        None, ge=1, le=26,
        json_schema_extra={"unit": "weeks", "scope": "SM",
                           "notes": "T_{s′} override; None → the backup link's own lead time. Plan default 6."},
    )
    selection_rule: Literal["min_cost", "min_leadtime", "reliability"] = Field(
        "min_cost", json_schema_extra={"unit": "enum", "scope": "G"},
    )
    activation_trigger: Literal["on_disruption", "coverage_threshold"] = Field(
        "on_disruption", json_schema_extra={"unit": "enum", "scope": "G"},
    )
    coverage_threshold_weeks: float = Field(
        4.0, ge=0.5, le=26,
        json_schema_extra={"unit": "weeks-of-supply", "scope": "G",
                           "notes": "Reroute only when position covers fewer weeks than this."},
    )
    cooldown_weeks: int = Field(
        0, ge=0, le=8,
        json_schema_extra={"unit": "weeks", "scope": "G",
                           "notes": "Keep using the backup this long after the event clears."},
    )


@register_plugin
class BackupSupplier(PolicyPlugin):
    id: ClassVar[str] = "backup_supplier"
    catalog_ref: ClassVar[str] = "P-S.1"
    stage: ClassVar[Stage] = Stage.SUPPLIER
    strategy_class: ClassVar[StrategyClass] = StrategyClass.STRATEGIC
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.MATERIAL_AVAILABILITY
    requires_predeployment: ClassVar[bool] = True
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "Contingent rerouting to a qualified backup source — premium paid only on rerouted "
        "orders. Slower than warm dual-sourcing, and useless when a BoM peer is "
        "single-sourced: one missing material still blocks the product."
    )
    Params: ClassVar[type[PolicyParams]] = BackupSupplierParams
    data_requirements: ClassVar[tuple[DataRequirement, ...]] = (
        DataRequirement(
            field="inbound_logistics.unit_price", level="recommended",
            reason="The min_cost reroute selection rule compares supplier "
                   "prices; missing prices default to 1.0.",
            fallback=None,
        ),
        DataRequirement(
            field="suppliers.reliability_score", level="defaulted",
            reason="The reliability selection rule ranks backup sources by "
                   "this score.",
            fallback="1.0",
        ),
    )

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH80, priority=60,
                reads={PURCHASE_ORDERS, FIRM_KNOWLEDGE, ST_ON_HAND, ST_PIPELINE, ST_QUEUE},
                writes={PURCHASE_ORDERS, ST_COST_LEDGER},
                resolution="Reroutes orders released by inventory_control (priority 50) away "
                           "from firm-visibly disrupted primary suppliers.",
            ),
        ]

    # ------------------------------------------------------------ feasibility

    def feasibility(self, scenario: Scenario) -> FeasibilityResult:
        p: BackupSupplierParams = self.params
        net = scenario.network
        if p.enabled_materials == "all_multi_sourced":
            eligible = [m.id for m in net.materials if len(net.supplier_options(m.id)) > 1]
        else:
            unknown = [m for m in p.enabled_materials if m not in {x.id for x in net.materials}]
            if unknown:
                return FeasibilityResult(False, (FeasibilityIssue(
                    "error", "unknown_material",
                    f"backup_supplier enabled for unknown material(s): {unknown[:5]}"),))
            eligible = [m for m in p.enabled_materials if len(net.supplier_options(m)) > 1]
            skipped = [m for m in p.enabled_materials if m not in eligible]
            if skipped:
                return FeasibilityResult(bool(eligible), (FeasibilityIssue(
                    "warning" if eligible else "error", "single_sourced_excluded",
                    f"{len(skipped)} enabled material(s) are single-sourced and auto-excluded "
                    f"({skipped[:3]}{'…' if len(skipped) > 3 else ''})"),))
        if not eligible:
            return FeasibilityResult(False, (FeasibilityIssue(
                "error", "no_alternative_sources",
                "backup_supplier is infeasible: no enabled material has an alternative "
                "qualified source (all single-sourced)"),))
        return FeasibilityResult.ok()

    # ---------------------------------------------------------------- runtime

    def setup(self, ctx: SimContext) -> None:
        m = ctx.model
        p: BackupSupplierParams = self.params
        if p.enabled_materials == "all_multi_sourced":
            enabled = np.array([len(m.links_of_mat[i]) > 1 for i in range(m.n_mats)])
        else:
            ids = set(p.enabled_materials)
            enabled = np.array([
                m.mat_ids[i] in ids and len(m.links_of_mat[i]) > 1 for i in range(m.n_mats)
            ])
        ctx.policy_state[self.id] = {
            "enabled": enabled,
            "reroute_until": np.full(m.n_mats, -1, dtype=int),  # cooldown bookkeeping
        }

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        m = ctx.model
        p: BackupSupplierParams = self.params
        state = ctx.policy_state[self.id]
        disrupted = ctx.visible_disrupted_suppliers()
        if not disrupted.any() and (state["reroute_until"] < ctx.week).all():
            return

        orders = ctx.purchase_orders.copy()
        position = ctx.on_hand + ctx.pipeline_on_order()
        changed = False

        for mat in np.flatnonzero(state["enabled"]):
            primary = m.primary_link[mat]
            qty = orders[primary]
            primary_disrupted = disrupted[m.link_sup[primary]]
            in_cooldown = ctx.week <= state["reroute_until"][mat]
            if not (primary_disrupted or in_cooldown) or qty <= 0:
                continue
            if primary_disrupted and p.activation_trigger == "coverage_threshold":
                exp_d = max(ctx.material_demand[mat], 1e-9)
                if position[mat] / exp_d >= p.coverage_threshold_weeks:
                    continue
            backup = self._select_backup(ctx, mat, disrupted)
            if backup is None:
                continue
            orders[backup] += qty
            orders[primary] = 0.0
            if p.backup_lead_time_weeks is not None:
                ctx.write_po_lt_override(backup, p.backup_lead_time_weeks)
            premium = (m.link_cost[backup] - m.link_cost[primary]) * qty
            ctx.cost.add("backup_premium", max(0.0, float(premium)))
            if primary_disrupted:
                state["reroute_until"][mat] = ctx.week + p.cooldown_weeks
            changed = True

        if changed:
            ctx.write_purchase_orders(orders)

    def _select_backup(self, ctx: SimContext, mat: int, disrupted: np.ndarray) -> Optional[int]:
        m = ctx.model
        p: BackupSupplierParams = self.params
        candidates = [
            int(l) for l in m.links_of_mat[mat][1:]  # everything but the primary
            if not disrupted[m.link_sup[l]]
        ]
        if not candidates:
            return None
        if p.selection_rule == "min_leadtime":
            return min(candidates, key=lambda l: (m.link_lt[l], m.link_cost[l]))
        if p.selection_rule == "reliability":
            return max(candidates, key=lambda l: (m.sup_reliability[m.link_sup[l]], -m.link_cost[l]))
        return min(candidates, key=lambda l: (m.link_cost[l], m.link_lt[l]))
