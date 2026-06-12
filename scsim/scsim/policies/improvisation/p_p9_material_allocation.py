"""P-P.9 material_allocation — IMPROVISATION, rolling LP (Part IV §4.4). ✅

Context: the weekly war-room — reassign shared materials across products to
protect revenue, formalized as a rolling LP (Eqs. 13–17). Costs planner
time only; value scales with material sharing (shared-material index).

Mechanics: at PH-40, solve a W-week LP over x[p, τ]:
    max Σ weight_p · x[p, τ]
    s.t. cumulative shared-material balance  Σ_p r_{p,m} Σ_{τ'≤τ} x ≤ I_m + arrivals≤τ
         x[p, 0] ≤ min(want_p, O_p + δ^o, non-shared feasibility)
         x[p, τ>0] ≤ min(E[D_p], O_p)
Implement week 1 (write production_plan), roll next week. HiGHS via
scipy.linprog; LP capped at active products × binding shared materials
(prefilter, §10.2.5); greedy revenue-ranked fallback behind ``solver`` and
on LP failure (fallback count lands in run metadata).
"""
from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy import sparse
from scipy.optimize import linprog

from scsim.core.context import SimContext
from scsim.core.mechanics import greedy_feasible
from scsim.core.phases import (
    DEMAND,
    FIRM_KNOWLEDGE,
    OVERTIME_CAPACITY,
    PRODUCTION_PLAN,
    ST_BACKLOG,
    ST_COST_LEDGER,
    ST_ON_HAND,
    ST_PIPELINE,
    Hook,
    PhaseId,
)
from scsim.entities.enums import ConstraintTag, PolicyStatus, Stage, StrategyClass
from scsim.policies.base import PolicyParams, PolicyPlugin
from scsim.policies.registry import register_plugin


class MaterialAllocationParams(PolicyParams):
    window_weeks: int = Field(
        4, ge=1, le=13,
        json_schema_extra={"unit": "weeks", "scope": "G", "notes": "W — rolling horizon."},
    )
    objective: Literal["max_revenue", "max_fill_rate", "priority_weighted", "fg_replenish"] = Field(
        "max_revenue",
        json_schema_extra={"unit": "enum", "scope": "G",
                           "notes": "max_revenue ✅; fg_replenish is MTS-only (M7)."},
    )
    priority_weights: dict[str, float] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "weight per product", "scope": "P",
                           "notes": "objective=priority_weighted; missing products weigh 1."},
    )
    annual_cost: float = Field(
        6240.0, ge=0,
        json_schema_extra={"unit": "€/yr", "scope": "G", "notes": "C^alc — planner labor."},
    )
    activation: Literal["during_disruption", "always"] = Field(
        "during_disruption", json_schema_extra={"unit": "enum", "scope": "G"},
    )
    solver: Literal["lp", "greedy"] = Field(
        "lp",
        json_schema_extra={"unit": "enum", "scope": "G",
                           "notes": "greedy = revenue-ranked heuristic (R3 fallback flag)."},
    )


@register_plugin
class MaterialAllocation(PolicyPlugin):
    id: ClassVar[str] = "material_allocation"
    catalog_ref: ClassVar[str] = "P-P.9"
    stage: ClassVar[Stage] = Stage.PLANT
    strategy_class: ClassVar[StrategyClass] = StrategyClass.IMPROVISATION
    constraint_targeted: ClassVar[ConstraintTag] = ConstraintTag.ALLOCATION_EFFICIENCY
    requires_predeployment: ClassVar[bool] = False
    status: ClassVar[PolicyStatus] = PolicyStatus.IMPLEMENTED
    summary: ClassVar[str] = (
        "The weekly war-room as a rolling LP (Eqs. 13–17): reassign shared materials across "
        "products to protect revenue during scarcity. Costs planner time only; value scales "
        "with the shared-material index."
    )
    Params: ClassVar[type[PolicyParams]] = MaterialAllocationParams

    @property
    def hooks(self) -> list[Hook]:
        return [
            Hook(
                phase=PhaseId.PH40, priority=60,
                reads={DEMAND, OVERTIME_CAPACITY, FIRM_KNOWLEDGE,
                       ST_ON_HAND, ST_PIPELINE, ST_BACKLOG},
                writes={PRODUCTION_PLAN, ST_COST_LEDGER},
                resolution="Replaces the default greedy plan (priority 50 mechanic) with the "
                           "rolling-LP allocation when active.",
            ),
        ]

    def setup(self, ctx: SimContext) -> None:
        ctx.policy_state[self.id] = {"lp_fallbacks": 0, "weeks_active": 0}

    def on_phase(self, phase: PhaseId, ctx: SimContext) -> None:
        p: MaterialAllocationParams = self.params
        if p.activation == "during_disruption" and not ctx.events_visible():
            return
        state = ctx.policy_state[self.id]
        state["weeks_active"] += 1
        ctx.cost.add("allocation_labor", p.annual_cost / 52.0)

        m = ctx.model
        want = ctx.demand + ctx.backlog
        cap_now = m.capacity + ctx.overtime_extra
        weights = self._weights(ctx)

        if p.solver == "greedy":
            ctx.write_production_plan(self._greedy_plan(ctx, want, cap_now, weights))
            return
        status, plan = self._lp_plan(ctx, want, cap_now, weights)
        if status == "no_binding":
            return  # default plan is already optimal — nothing to allocate
        if status == "fail":
            state["lp_fallbacks"] += 1  # R3 flag: solver trouble, greedy heuristic used
            plan = self._greedy_plan(ctx, want, cap_now, weights)
        ctx.write_production_plan(plan)

    # ----------------------------------------------------------------- pieces

    def _weights(self, ctx: SimContext) -> np.ndarray:
        p: MaterialAllocationParams = self.params
        m = ctx.model
        if p.objective in ("max_revenue", "fg_replenish"):
            return m.unit_price.astype(float)
        if p.objective == "max_fill_rate":
            return np.ones(m.n_prods)
        w = np.ones(m.n_prods)
        for pid, weight in p.priority_weights.items():
            if pid in m.prod_index:
                w[m.prod_index[pid]] = weight
        return w

    def _greedy_plan(self, ctx: SimContext, want, cap_now, weights) -> np.ndarray:
        """Revenue-ranked greedy: serve high-weight products first (R3 fallback)."""
        plan = np.minimum(want, cap_now)
        order = np.argsort(-weights, kind="stable")
        q, _ = greedy_feasible(ctx.model, plan, ctx.on_hand, order=order)
        return q

    def _planning_arrivals(self, ctx: SimContext, W: int) -> np.ndarray:
        """[M, W] arrivals usable at t+τ, through the FIRM's post-detection lens:
        in-transit slots inside a visible LT-extension window are projected to
        land at the window end (the physical deferral happens later, week by
        week, in PH-90 — planning must not overstate near-term supply)."""
        m = ctx.model
        t = ctx.week
        Wr = m.ring_width
        defer_end: dict[int, int] = {}
        for e in ctx.events_visible():
            if e.lt_active_at(t):
                defer_end[e.supplier_idx] = max(defer_end.get(e.supplier_idx, 0), e.end)
        arr = np.zeros((m.n_mats, W))
        for link in range(m.n_links):
            end = defer_end.get(int(m.link_sup[link]), 0)
            mat = int(m.link_mat[link])
            for tau in range(1, W):
                w = t + tau
                qty = ctx.pipeline[link, w % Wr]
                if qty <= 0:
                    continue
                w_eff = end if (end > 0 and w < end) else w
                tau_eff = w_eff - t
                if tau_eff < W:
                    arr[mat, tau_eff] += qty
        return arr

    def _lp_plan(
        self, ctx: SimContext, want, cap_now, weights
    ) -> tuple[str, np.ndarray | None]:
        p: MaterialAllocationParams = self.params
        m = ctx.model
        W = p.window_weeks
        t = ctx.week

        # Cumulative availability of each material over the window:
        # on-hand now + (deferral-aware) arrivals usable in weeks t+1 .. t+τ.
        planned = self._planning_arrivals(ctx, W)
        avail = np.empty((m.n_mats, W))
        avail[:, 0] = ctx.on_hand
        for tau in range(1, W):
            avail[:, tau] = avail[:, tau - 1] + planned[:, tau]

        # Per-product upper bounds.
        ub = np.empty((m.n_prods, W))
        ub[:, 0] = np.minimum(want, cap_now)
        for tau in range(1, W):
            ub[:, tau] = np.minimum(m.mean_demand_p, m.capacity)

        # Tighten week-1 by non-shared materials (kept out of the LP, §10.2.5).
        shared = set(m.shared_mats.tolist())
        indptr, indices, data = m.bom.indptr, m.bom.indices, m.bom.data
        for j in range(m.n_prods):
            lo, hi = indptr[j], indptr[j + 1]
            for k in range(lo, hi):
                mat, rate = indices[k], data[k]
                if mat not in shared:
                    ub[j, 0] = min(ub[j, 0], ctx.on_hand[mat] / rate)

        # Prefilter: shared materials binding at ANY τ of the window — a week-1
        # crunch with a relief bulge at τ=1 still binds (cumulative check per τ).
        rows = []
        for mat in m.shared_mats:
            col = m.bom_csc.getcol(mat)
            prods = col.indices
            rates = col.data
            req_cum = (ub[prods, :].cumsum(axis=1) * rates[:, None]).sum(axis=0)
            if bool((req_cum > avail[mat, :] + 1e-9).any()):
                rows.append((mat, prods, rates))
        if not rows:
            return "no_binding", None

        n_var = m.n_prods * W

        def idx(j, tau):
            return j * W + tau

        A_rows, A_cols, A_vals, b_ub = [], [], [], []
        r = 0
        for mat, prods, rates in rows:
            for tau in range(W):
                for jj, rate in zip(prods, rates):
                    for tp in range(tau + 1):
                        A_rows.append(r)
                        A_cols.append(idx(jj, tp))
                        A_vals.append(rate)
                b_ub.append(avail[mat, tau])
                r += 1
        A = sparse.csr_matrix((A_vals, (A_rows, A_cols)), shape=(r, n_var))

        # Maximize early, weighted output (tiny decay breaks week ties forward).
        c = np.empty(n_var)
        for j in range(m.n_prods):
            for tau in range(W):
                c[idx(j, tau)] = -weights[j] * (1.0 - 1e-6 * tau)
        bounds = [(0.0, float(ub[j, tau])) for j in range(m.n_prods) for tau in range(W)]

        res = linprog(c, A_ub=A, b_ub=np.array(b_ub), bounds=bounds, method="highs")
        if not res.success:
            return "fail", None
        x = res.x.reshape(m.n_prods, W)
        return "ok", np.minimum(x[:, 0], ub[:, 0])
