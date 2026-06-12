"""Compiled model + SimContext — Part IX §9.3 and Part X §10.2.

``CompiledModel`` turns the validated Scenario into index maps and NumPy
arrays once; replications share it read-only. ``SimContext`` is the typed
accessor policies receive: per-week transient state, persistent arrays, the
keyed policy RNG, and the cost ledger. Inner mechanics are array ops over
materials / products / supplier-links (phase-sweep vectorization, §10.2.1);
the in-transit pipeline is a ring buffer over supplier-material links
(§10.2.2) so a 5,000-material week costs milliseconds, not 5,000 events.

Debug builds (default in tests) enforce each hook's declared write-set at
the mutation helpers — a policy writing state it didn't declare is a bug,
not a feature.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import sparse

from scsim.core.phases import (
    FULFILLMENT,
    INVENTORY_LEVELS,
    OVERTIME_CAPACITY,
    PRODUCTION_PLAN,
    PURCHASE_ORDERS,
    ST_BACKLOG,
    ST_PIPELINE,
    BoundHook,
)
from scsim.entities.enums import DemandModel, EffectType, OverflowRule, RampProfile
from scsim.entities.scenario import Scenario
from scsim.stats.seeds import ReplicationStreams

# C^res components — Part V cost_of_resilience.
COST_COMPONENTS: tuple[str, ...] = (
    "ss_holding",        # P-P.3 incremental material safety-stock holding
    "backup_premium",    # P-S.1 premium on rerouted orders
    "expediting",        # P-T.2 premium freight
    "overtime",          # P-P.5 short-term capacity
    "lost_sales",        # Σ u_p · L_p
    "allocation_labor",  # P-P.9 planner time
    "fg_ss_holding",     # P-P.4 (MTS, M7)
    "backorder_penalty", # P-C.1 backorder variant
)
COST_INDEX = {name: i for i, name in enumerate(COST_COMPONENTS)}


@dataclass(frozen=True)
class ResolvedEvent:
    """A disruption event with all stochastic fields drawn for one replication."""

    supplier_idx: int
    effect: EffectType
    start: int          # 0-based week, inclusive
    end: int            # exclusive — first unaffected week (t_end)
    capacity_factor: float
    overflow_rule: OverflowRule
    onset_profile: RampProfile
    recovery_profile: RampProfile
    ramp_weeks: int

    def cap_factor_at(self, t: int) -> float:
        """Effective capacity multiplier at week t (1.0 = unaffected)."""
        if self.effect != EffectType.CAPACITY_REDUCTION:
            return 1.0
        phi = self.capacity_factor
        if self.start <= t < self.end:
            if self.onset_profile == RampProfile.RAMP_LINEAR and self.ramp_weeks > 0:
                k = t - self.start + 1
                if k < self.ramp_weeks:
                    return 1.0 + (phi - 1.0) * (k / self.ramp_weeks)
            return phi
        if self.recovery_profile == RampProfile.RAMP_LINEAR and self.ramp_weeks > 0:
            if self.end <= t < self.end + self.ramp_weeks:
                k = t - self.end + 1
                return phi + (1.0 - phi) * (k / self.ramp_weeks)
        return 1.0

    def lt_active_at(self, t: int) -> bool:
        return self.effect == EffectType.LEAD_TIME_EXTENSION and self.start <= t < self.end


class CompiledModel:
    """Index maps + arrays + instantiated policies for one scenario."""

    def __init__(self, scenario: Scenario):
        net = scenario.network
        self.scenario = scenario
        self.settings = scenario.settings

        self.mat_ids = [m.id for m in net.materials]
        self.prod_ids = [p.id for p in net.products]
        self.sup_ids = [s.id for s in net.suppliers]
        self.mat_index = {mid: i for i, mid in enumerate(self.mat_ids)}
        self.prod_index = {pid: i for i, pid in enumerate(self.prod_ids)}
        self.sup_index = {sid: i for i, sid in enumerate(self.sup_ids)}
        self.n_mats = len(self.mat_ids)
        self.n_prods = len(self.prod_ids)
        self.n_sups = len(self.sup_ids)

        # Products.
        self.unit_price = np.array([p.unit_price for p in net.products])
        self.capacity = np.array([p.production_capacity for p in net.products])
        nu = self.settings.demand_floor_factor
        tri = np.array([p.triangular_params(nu) for p in net.products])
        self.demand_a, self.demand_b, self.demand_c = tri[:, 0], tri[:, 1], tri[:, 2]
        self.demand_model_of = [p.demand_model for p in net.products]
        self.negbin_k = np.array([p.negbin_dispersion for p in net.products])
        self.demand_history = [np.asarray(p.demand_history, dtype=float) for p in net.products]
        self.mean_demand_p = np.array([p.mean_demand(nu) for p in net.products])
        self.var_demand_p = self._demand_variances()

        # BoM as sparse CSR (production O(nnz), §10.3).
        rows, cols, vals = [], [], []
        for line in net.bom:
            rows.append(self.prod_index[line.product_id])
            cols.append(self.mat_index[line.material_id])
            vals.append(line.rate)
        self.bom = sparse.csr_matrix(
            (vals, (rows, cols)), shape=(self.n_prods, self.n_mats), dtype=float
        )
        self.bom_csc = self.bom.tocsc()
        consumers = np.diff(self.bom_csc.indptr)
        self.shared_mats = np.flatnonzero(consumers > 1)

        # Materials.
        self.mat_cost = np.array([m.cost for m in net.materials])
        self.mat_holding_weekly = np.array(
            [m.cost * m.holding_cost_rate / 100.0 / 52.0 for m in net.materials]
        )
        self.mat_initial = np.array(
            [-1.0 if m.initial_on_hand is None else m.initial_on_hand for m in net.materials]
        )
        self.exp_demand_m = np.asarray(self.bom.T @ self.mean_demand_p).ravel()  # Eq. 1
        self.var_demand_m = np.asarray((self.bom.power(2)).T @ self.var_demand_p).ravel()

        # Supplier-material links, sorted (cost, lt, supplier) per material so
        # links_of_mat[m][0] is the primary source (min cost — manuscript §3.5).
        links = sorted(
            net.supplier_links,
            key=lambda l: (self.mat_index[l.material_id], l.cost, l.lead_time_weeks, l.supplier_id),
        )
        self.n_links = len(links)
        self.link_sup = np.array([self.sup_index[l.supplier_id] for l in links], dtype=int)
        self.link_mat = np.array([self.mat_index[l.material_id] for l in links], dtype=int)
        self.link_lt = np.array([l.lead_time_weeks for l in links], dtype=int)
        self.link_cost = np.array([l.cost for l in links])
        self.link_moq = np.array([l.moq for l in links])
        self.link_lt_dist = [l.lead_time_dist for l in links]
        self.link_lt_cv = np.array([l.lead_time_cv for l in links])
        self.links_of_mat: list[np.ndarray] = [
            np.flatnonzero(self.link_mat == m) for m in range(self.n_mats)
        ]
        self.primary_link = np.array([idx[0] for idx in self.links_of_mat], dtype=int)
        # Aggregation matrix link → material (CSR for fast pipeline sums).
        self.link_to_mat = sparse.csr_matrix(
            (np.ones(self.n_links), (self.link_mat, np.arange(self.n_links))),
            shape=(self.n_mats, self.n_links),
        )

        self.sup_capacity = np.array(
            [np.inf if s.capacity_per_week is None else s.capacity_per_week for s in net.suppliers]
        )
        self.sup_reliability = np.array([s.reliability_score for s in net.suppliers])
        self.lane_supplier = {l.id: self.sup_index[l.supplier_id] for l in net.lanes}
        self.links_of_sup: list[np.ndarray] = [
            np.flatnonzero(self.link_sup == s) for s in range(self.n_sups)
        ]
        self.demand_groups: list[tuple[DemandModel, np.ndarray]] = []
        for dm in DemandModel:
            idx = np.array(
                [j for j, mdl in enumerate(self.demand_model_of) if mdl == dm], dtype=int
            )
            if idx.size:
                self.demand_groups.append((dm, idx))

        # Ring width: longest quoted arrival distance is max(T_link, deferral≤52)
        # plus the recovery ramp; +4 slack (§10.2.2).
        self.ring_width = int(self.link_lt.max()) + 52 + 8 + 4

    def _demand_variances(self) -> np.ndarray:
        out = np.zeros(self.n_prods)
        for j, model in enumerate(self.demand_model_of):
            a, b, c = self.demand_a[j], self.demand_b[j], self.demand_c[j]
            if model == DemandModel.TRIANGULAR:
                out[j] = (a * a + b * b + c * c - a * b - a * c - b * c) / 18.0
            elif model == DemandModel.POISSON:
                out[j] = b
            elif model == DemandModel.NEGBIN:
                out[j] = b + b * b / self.negbin_k[j]
            elif model == DemandModel.BOOTSTRAP and self.demand_history[j].size > 1:
                out[j] = float(self.demand_history[j].var(ddof=1))
            else:  # deterministic
                out[j] = 0.0
        return out


class CostLedger:
    def __init__(self, horizon: int):
        self.weekly = np.zeros((len(COST_COMPONENTS), horizon))
        self._t = 0

    def set_week(self, t: int) -> None:
        self._t = t

    def add(self, component: str, amount: float) -> None:
        self.weekly[COST_INDEX[component], self._t] += amount

    def total_by_component(self, start: int, end: int) -> dict[str, float]:
        window = self.weekly[:, start:end].sum(axis=1)
        return {name: float(window[i]) for i, name in enumerate(COST_INDEX)}


@dataclass
class WeeklyTrace:
    """Always-on weekly scalars + optional per-entity matrices (full_debug)."""

    horizon: int
    n_prods: int
    n_mats: int
    keep_matrices: bool
    demand_value: np.ndarray = field(init=False)
    fulfilled_value: np.ndarray = field(init=False)   # capped at demand (FR numerator)
    revenue_value: np.ndarray = field(init=False)     # u·F including backlog clearing
    lost_value: np.ndarray = field(init=False)
    lost_units: np.ndarray = field(init=False)
    backlog_units: np.ndarray = field(init=False)
    fill_rate: np.ndarray = field(init=False)
    inbound_rejected: np.ndarray = field(init=False)
    on_hand_value: np.ndarray = field(init=False)
    D: Optional[np.ndarray] = None
    Q: Optional[np.ndarray] = None
    F: Optional[np.ndarray] = None
    B: Optional[np.ndarray] = None
    L: Optional[np.ndarray] = None
    I_mat: Optional[np.ndarray] = None

    def __post_init__(self) -> None:
        T = self.horizon
        for name in (
            "demand_value", "fulfilled_value", "revenue_value", "lost_value", "lost_units",
            "backlog_units", "fill_rate", "inbound_rejected", "on_hand_value",
        ):
            setattr(self, name, np.zeros(T))
        if self.keep_matrices:
            self.D = np.zeros((self.n_prods, T))
            self.Q = np.zeros((self.n_prods, T))
            self.F = np.zeros((self.n_prods, T))
            self.B = np.zeros((self.n_prods, T))
            self.L = np.zeros((self.n_prods, T))
            self.I_mat = np.zeros((self.n_mats, T))


class WriteGuardError(RuntimeError):
    pass


class SimContext:
    """The world as one replication sees it. Policies receive exactly this."""

    def __init__(
        self,
        model: CompiledModel,
        streams: ReplicationStreams,
        events: list[ResolvedEvent],
        keep_matrices: bool,
        debug: bool = True,
    ):
        self.model = model
        self.streams = streams
        self.events = events
        self.debug = debug
        T = model.settings.horizon

        # Persistent state.
        self.on_hand = np.zeros(model.n_mats)
        self.pipeline = np.zeros((model.n_links, model.ring_width))
        self.queue = np.zeros(model.n_links)
        self.backlog = np.zeros(model.n_prods)
        self.fg_on_hand = np.zeros(model.n_prods)
        self.cost = CostLedger(T)
        self.policy_state: dict[str, dict] = {}
        self.policy_rng_created_week: dict[str, int] = {}

        # Weekly transients (rebound each week by the engine/mechanics).
        self.week: int = 0
        self.demand = np.zeros(model.n_prods)
        self.production_plan = np.zeros(model.n_prods)
        self.overtime_extra = np.zeros(model.n_prods)
        self.production_output = np.zeros(model.n_prods)
        self.fulfillment = np.zeros(model.n_prods)
        self.material_demand = np.zeros(model.n_mats)
        self.level_s = np.zeros(model.n_mats)
        self.level_S = np.zeros(model.n_mats)
        self.purchase_orders = np.zeros(model.n_links)
        self.po_lt_override = np.full(model.n_links, -1, dtype=int)  # -1 = link default
        self.arrivals = np.zeros(model.n_mats)
        self.lost_units_week = np.zeros(model.n_prods)
        self.served_new_week = np.zeros(model.n_prods)  # FR numerator (β-service vs D_p[t])
        self.lt_block_end = np.zeros(model.n_sups, dtype=int)   # 0 = no active LT event
        self.cap_factor = np.ones(model.n_sups)
        self.lost_inbound_this_week = 0.0

        self.trace = WeeklyTrace(T, model.n_prods, model.n_mats, keep_matrices)
        self._active_hook: Optional[BoundHook] = None
        self._params: dict[str, object] = {}

    # ------------------------------------------------------------- accessors

    def rng(self, policy_id: str) -> np.random.Generator:
        """Keyed policy stream (§9.4) — the only RNG a policy may consume."""
        if policy_id not in self.streams._policy_cache:
            self.policy_rng_created_week[policy_id] = self.week
        return self.streams.policy_rng(policy_id)

    def params(self, policy_id: str):
        return self._params[policy_id]

    def events_physical(self) -> list[ResolvedEvent]:
        t = self.week
        return [e for e in self.events if e.start <= t < e.end + e.ramp_weeks]

    def events_visible(self) -> list[ResolvedEvent]:
        """Post-detection view (PH-20): events the FIRM knows about (§3.7, P-S.4)."""
        t = self.week
        lag = self.model.settings.detection_lag_weeks
        return [e for e in self.events if e.start + lag <= t and t < e.end + e.ramp_weeks]

    def visible_disrupted_suppliers(self) -> np.ndarray:
        mask = np.zeros(self.model.n_sups, dtype=bool)
        for e in self.events_visible():
            if e.lt_active_at(self.week) or e.cap_factor_at(self.week) < 1.0:
                mask[e.supplier_idx] = True
        return mask

    def pipeline_on_order(self) -> np.ndarray:
        """Per-material in-transit + supplier-queue quantities (position input)."""
        per_link = self.pipeline.sum(axis=1) + self.queue
        return np.asarray(self.model.link_to_mat @ per_link).ravel()

    def pipeline_arrivals_between(self, start_week: int, end_week: int) -> np.ndarray:
        """Per-material arrivals scheduled in [start_week, end_week) (planning view)."""
        W = self.model.ring_width
        if end_week - start_week >= W:
            per_link = self.pipeline.sum(axis=1)
        else:
            slots = np.arange(start_week, end_week) % W
            per_link = self.pipeline[:, slots].sum(axis=1)
        return np.asarray(self.model.link_to_mat @ per_link).ravel()

    # ------------------------------------------------------- guarded writers

    def _check_write(self, key: str) -> None:
        if self.debug and self._active_hook is not None:
            if key not in self._active_hook.hook.writes:
                raise WriteGuardError(
                    f"{self._active_hook.owner}: write to {key!r} not declared in its "
                    f"{self._active_hook.hook.phase.value} hook"
                )

    def write_production_plan(self, plan: np.ndarray) -> None:
        self._check_write(PRODUCTION_PLAN)
        self.production_plan = np.maximum(plan, 0.0)

    def write_overtime_extra(self, extra: np.ndarray) -> None:
        self._check_write(OVERTIME_CAPACITY)
        self.overtime_extra = np.maximum(extra, 0.0)

    def write_levels(self, s: np.ndarray, S: np.ndarray) -> None:
        self._check_write(INVENTORY_LEVELS)
        self.level_s = s
        self.level_S = np.maximum(S, s)

    def write_purchase_orders(self, orders: np.ndarray) -> None:
        self._check_write(PURCHASE_ORDERS)
        self.purchase_orders = np.maximum(orders, 0.0)

    def write_po_lt_override(self, link_idx: int, lead_time_weeks: int) -> None:
        """Quote a non-default lead time for this week's order on one link
        (folded into the purchase_orders write-contract)."""
        self._check_write(PURCHASE_ORDERS)
        self.po_lt_override[link_idx] = lead_time_weeks

    def move_pipeline(self, link_idx: int, from_week: int, to_week: int, qty: float) -> None:
        """Reschedule in-transit quantity between arrival weeks (defer/expedite)."""
        self._check_write(ST_PIPELINE)
        W = self.model.ring_width
        src, dst = from_week % W, to_week % W
        take = min(qty, self.pipeline[link_idx, src])
        self.pipeline[link_idx, src] -= take
        self.pipeline[link_idx, dst] += take

    def set_backlog(self, backlog: np.ndarray) -> None:
        self._check_write(ST_BACKLOG)
        self.backlog = np.maximum(backlog, 0.0)

    def write_fulfillment(
        self, fulfilled: np.ndarray, served_new: np.ndarray, lost_units: np.ndarray
    ) -> None:
        """``fulfilled`` = total units shipped (incl. backlog clearing);
        ``served_new`` = portion serving THIS week's demand (FR numerator)."""
        self._check_write(FULFILLMENT)
        self.fulfillment = fulfilled
        self.served_new_week = np.clip(served_new, 0.0, None)
        self.lost_units_week = np.maximum(lost_units, 0.0)
