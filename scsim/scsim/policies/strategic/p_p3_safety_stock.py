"""P-P.3 safety_stock_materials — STRATEGIC, ABC-XYZ buffer (Part IV §4.2). ✅

Context: the classic buffer, ABC-XYZ-differentiated so euros protect where
it matters. Dominates SHORT disruptions; depletes — beyond ~7–9 weeks
expediting wins (the SS-vs-expedite crossover experiment of Part VII).

Mechanics (Eqs. 20–21), applied on top of P-P.1's levels at PH-70:
    s_m += z_m · σ_{D_m} · √T_s
    S_m += z_m · σ_{D_m} · √(T_s + κ)
The incremental holding cost of the planned reorder-point buffer
(h_m · c_m · SS_m weekly) flows into C^res as ``ss_holding``.
"""
from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, field_validator
from scipy import stats as sps

from scsim.core.context import SimContext
from scsim.core.phases import (
    INVENTORY_LEVELS,
    MATERIAL_DEMAND,
    ST_COST_LEDGER,
    Hook,
    PhaseId,
)
from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass
from scsim.policies.base import CostBreakdown, DataRequirement, PolicyParams, PolicyPlugin
from scsim.policies.registry import register_plugin

# Plan §4.2 z-matrix defaults (service levels in %).
DEFAULT_Z_MATRIX: dict[str, float] = {
    "AX": 99.5, "AY": 99.0, "AZ": 98.0,
    "BX": 98.0, "BY": 95.0, "BZ": 90.0,
    "CX": 95.0, "CY": 90.0, "CZ": 80.0,
}


class SafetyStockParams(PolicyParams):
    classification: Literal["abc_xyz", "uniform", "fixed_days", "king"] = Field(
        "abc_xyz", json_schema_extra={"unit": "enum", "scope": "G", "notes": "abc_xyz ✅."},
    )
    z_matrix: dict[str, float] = Field(
        default_factory=lambda: dict(DEFAULT_Z_MATRIX),
        json_schema_extra={"unit": "% service level", "scope": "G", "range": "[80, 99.9]",
                           "notes": "Nine ABC×XYZ cells."},
    )
    abc_breakpoints: tuple[float, float] = Field(
        (0.80, 0.95),
        json_schema_extra={"unit": "cumulative value share", "scope": "G",
                           "notes": "A up to 80%, B up to 95%, C the rest (80/15/5)."},
    )
    xyz_cv_breakpoints: tuple[float, float] = Field(
        (0.13, 0.25),
        json_schema_extra={"unit": "demand CV", "scope": "G",
                           "notes": "X ≤ 0.13, Y ≤ 0.25, Z above."},
    )
    uniform_service_level: float = Field(
        95.0, ge=80.0, le=99.9,
        json_schema_extra={"unit": "%", "scope": "G", "notes": "classification=uniform."},
    )
    fixed_days_cover: float = Field(
        14.0, ge=0.0, le=84.0,
        json_schema_extra={"unit": "days", "scope": "G", "notes": "classification=fixed_days."},
    )

    @field_validator("z_matrix")
    @classmethod
    def _cells(cls, v: dict[str, float]) -> dict[str, float]:
        missing = set(DEFAULT_Z_MATRIX) - set(v)
        if missing:
            raise ValueError(f"z_matrix missing cells: {sorted(missing)}")
        for cell, sl in v.items():
            if cell not in DEFAULT_Z_MATRIX:
                raise ValueError(f"unknown z_matrix cell {cell!r}")
            if not (80.0 <= sl <= 99.9):
                raise ValueError(f"z_matrix[{cell}] must be in [80, 99.9] %")
        return v


@register_plugin
class SafetyStockMaterials(PolicyPlugin):
    id: ClassVar[str] = "safety_stock_materials"
    catalog_ref: ClassVar[str] = "P-P.3"
    stage: ClassVar[Stage] = Stage.PLANT
    strategy_class: ClassVar[StrategyClass] = StrategyClass.STRATEGIC
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.MATERIAL_AVAILABILITY
    requires_predeployment: ClassVar[bool] = True
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "ABC-XYZ-differentiated material safety stock (Eqs. 20–21). Dominates short "
        "disruptions; depletes — beyond ~7–9 weeks expediting wins (run the crossover sweep)."
    )
    Params: ClassVar[type[PolicyParams]] = SafetyStockParams
    data_requirements: ClassVar[tuple[DataRequirement, ...]] = (
        DataRequirement(
            field="products.demand_cv", level="recommended",
            reason="Safety-stock sizing scales with demand variability; the "
                   "default CV of 0.30 may badly misstate your buffers.",
            fallback="scenario demand_model.cv, then 0.30",
        ),
    )

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH70, priority=60,
                reads={MATERIAL_DEMAND, INVENTORY_LEVELS},
                writes={INVENTORY_LEVELS, ST_COST_LEDGER},
                resolution="Adds the safety-stock buffer on top of inventory_control's "
                           "levels (priority 50) — Eqs. 20–21.",
            ),
        ]

    def setup(self, ctx: SimContext) -> None:
        m = ctx.model
        p: SafetyStockParams = self.params
        sigma = np.sqrt(m.var_demand_m)
        exp_d = m.exp_demand_m
        lt = m.link_lt[m.primary_link].astype(float)
        lt_cv = m.link_lt_cv[m.primary_link]

        if p.classification == "fixed_days":
            ss_s = exp_d * p.fixed_days_cover / 7.0
            ss_S = ss_s
        else:
            z = self._z_per_material(m, p, sigma, exp_d)
            if p.classification == "king":
                # King: z·σ_D·√T + z·μ_D·σ_LT (σ_LT from the link's CV).
                ss_s = z * sigma * np.sqrt(lt) + z * exp_d * (lt_cv * lt)
                ss_S = ss_s
            else:
                ss_s = z * sigma * np.sqrt(lt)            # Eq. 20
                ss_S = z * sigma * np.sqrt(lt + self._kappa_hint(ctx))  # Eq. 21
        ctx.policy_state[self.id] = {"ss_s": ss_s, "ss_S": ss_S}

    def _kappa_hint(self, ctx: SimContext) -> float:
        """κ for Eq. 21 — taken from inventory_control's nominal cover."""
        try:
            ic = ctx.params("inventory_control")
            return float(ic.coverage_weeks.nominal)
        except KeyError:
            return 8.0

    def _z_per_material(self, m, p: SafetyStockParams, sigma, exp_d) -> np.ndarray:
        if p.classification == "uniform":
            z_val = float(sps.norm.ppf(p.uniform_service_level / 100.0))
            return np.full(m.n_mats, z_val)
        # ABC by annual value share (descending, cumulative).
        annual_value = exp_d * 52.0 * m.mat_cost
        order = np.argsort(-annual_value)
        total = max(annual_value.sum(), 1e-12)
        cum = np.cumsum(annual_value[order]) / total
        abc = np.empty(m.n_mats, dtype="<U1")
        a_cut, b_cut = p.abc_breakpoints
        abc_sorted = np.where(cum <= a_cut, "A", np.where(cum <= b_cut, "B", "C"))
        abc[order] = abc_sorted
        # XYZ by demand CV.
        cv = np.divide(sigma, exp_d, out=np.full_like(sigma, np.inf), where=exp_d > 0)
        x_cut, y_cut = p.xyz_cv_breakpoints
        xyz = np.where(cv <= x_cut, "X", np.where(cv <= y_cut, "Y", "Z"))
        z = np.empty(m.n_mats)
        for i in range(m.n_mats):
            sl = p.z_matrix[f"{abc[i]}{xyz[i]}"]
            z[i] = sps.norm.ppf(sl / 100.0)
        return z

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        state = ctx.policy_state[self.id]
        ctx.write_levels(ctx.level_s + state["ss_s"], ctx.level_S + state["ss_S"])

    def cost_contribution(self, ctx: SimContext) -> CostBreakdown:
        # Incremental holding on the planned reorder-point buffer (weekly).
        state = ctx.policy_state[self.id]
        cb = CostBreakdown()
        cb.add("ss_holding", float((ctx.model.mat_holding_weekly * state["ss_s"]).sum()))
        return cb
