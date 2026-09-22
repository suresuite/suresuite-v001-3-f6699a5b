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
    FG_FULFILLMENT,
    FULFILLMENT,
    INVENTORY_LEVELS,
    OVERTIME_CAPACITY,
    PRODUCTION_PLAN,
    PURCHASE_ORDERS,
    ST_BACKLOG,
    ST_FG_TARGET,
    ST_PIPELINE,
    BoundHook,
)
from scsim.entities.enums import (
    LeadTimeDist,
    DemandModel,
    EffectType,
    FulfillmentMode,
    OverflowRule,
    RampProfile,
    TransportMode,
)
from scsim.entities.scenario import Scenario
from scsim.stats.seeds import ReplicationStreams

# C^res components — Part V cost_of_resilience.
COST_COMPONENTS: tuple[str, ...] = (
    "ss_holding",             # P-P.3 incremental material safety-stock holding
    "backup_premium",         # P-S.1 premium on rerouted orders
    "multi_sourcing_premium", # P-S.2 pay-always premium on non-primary slices
    "expediting",             # P-T.2 premium freight
    "overtime",               # P-P.5 short-term capacity
    "lost_sales",             # Σ u_p · L_p
    "allocation_labor",       # P-P.9 planner time
    "fg_ss_holding",          # P-P.4 FG safety stock at full COGS (MTS)
    "backorder_penalty",      # P-C.1 backorder variant
    "monitoring",             # P-S.4 standing visibility cost
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
    # node:plant target — applies to the plant's production, not a supplier's
    # inbound. supplier_idx is -1 for these. The time/severity math below is
    # target-agnostic and shared with supplier events.
    is_plant: bool = False

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
        # Edge lead-time split (M7): a lane's transit time composes into the
        # effective link lead time, so planning (s_m/S_m coverage), shipping,
        # and ring sizing all see the same total. Quoting transit on the lane
        # is exactly equivalent to folding it into the supplier link (tested
        # byte-identical). One lane per supplier binds in v1: the default-mode
        # lane wins, then lowest id; per-mode pipelines land with P-T.1.
        lane_extra: dict[str, int] = {}
        for lane in sorted(net.lanes, key=lambda l: (l.mode != TransportMode.DEFAULT, l.id)):
            lane_extra.setdefault(lane.supplier_id, int(lane.lead_time_weeks))
        self.link_lt = np.array(
            [l.lead_time_weeks + lane_extra.get(l.supplier_id, 0) for l in links], dtype=int
        )
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

        # Fulfillment mode split (CODP, §3.3). MTO stays the no-op PH-30 path.
        self.mts_mask = np.array(
            [p.fulfillment_mode == FulfillmentMode.MTS for p in net.products]
        )
        self.forecast_model_of = [p.forecast_model for p in net.products]
        self.forecast_window = np.array([p.forecast_window for p in net.products], dtype=int)
        self.forecast_bias = np.array([p.forecast_bias for p in net.products]) / 100.0
        self.fg_base_stock_override = np.array(
            [-1.0 if p.fg_base_stock is None else p.fg_base_stock for p in net.products]
        )
        # Full COGS per FG unit (P-P.4 holding basis): Σ_m r_{p,m} · c_m.
        self.fg_unit_cogs = np.asarray(self.bom @ self.mat_cost).ravel()

        # Customers (P-C.2). Share matrix rows are normalized per product;
        # products with no customer_links split uniformly — behavior-neutral
        # until a customer-allocation policy reads it.
        self.cust_ids = [c.id for c in net.customers]
        self.n_custs = len(self.cust_ids)
        self.cust_index = {cid: i for i, cid in enumerate(self.cust_ids)}
        self.cust_priority = np.array([c.priority_weight for c in net.customers])
        self.cust_segment = [c.segment for c in net.customers]
        if self.n_custs:
            W = np.zeros((self.n_prods, self.n_custs))
            for cl in net.customer_links:
                W[self.prod_index[cl.product_id], self.cust_index[cl.customer_id]] = cl.share
            unlinked = W.sum(axis=1) == 0.0
            W[unlinked, :] = 1.0
            self.cust_share = W / W.sum(axis=1, keepdims=True)
        else:
            self.cust_share = np.zeros((self.n_prods, 0))

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


def draw_week_demand(model: CompiledModel, rng: np.random.Generator, out: np.ndarray) -> None:
    """Draw one week of product demand into ``out``.

    The per-group draw sequence is the world-stream consumption contract:
    golden traces byte-compare on it, so schedule pre-generation and the
    former per-week loop must consume ``rng`` in exactly this order.
    """
    for model_type, idx in model.demand_groups:
        if model_type == DemandModel.TRIANGULAR:
            a, b, c = model.demand_a[idx], model.demand_b[idx], model.demand_c[idx]
            spread = c > a + 1e-12
            vals = np.where(spread, 0.0, b)
            if spread.any():
                vals[spread] = rng.triangular(a[spread], b[spread], c[spread])
            out[idx] = vals
        elif model_type == DemandModel.DETERMINISTIC:
            out[idx] = model.demand_b[idx]
        elif model_type == DemandModel.POISSON:
            out[idx] = rng.poisson(model.demand_b[idx]).astype(float)
        elif model_type == DemandModel.NEGBIN:
            b, k = model.demand_b[idx], model.negbin_k[idx]
            p = k / (k + np.maximum(b, 1e-12))
            out[idx] = rng.negative_binomial(k, p).astype(float)
        else:  # BOOTSTRAP
            for j in idx:
                out[j] = float(rng.choice(model.demand_history[j]))


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


@dataclass(frozen=True)
class WeeklySeries:
    """One always-on weekly scalar, declared once.

    `key` is BOTH the attribute name on `WeeklyTrace` and the name the series
    travels under everywhere downstream — the golden-trace column, the progress
    observer, `ScenarioResult.extra_series`, `run_replications.time_series` and
    the chart that reads it. One name, one place it is written down.

    `aggregation` says what may honestly be done to the series across weeks:

        level  — a stock measured at the end of the week (on-hand, backlog).
                 Averaging is meaningful; summing is not: adding a stock to
                 itself week after week counts the same goods repeatedly.
        flow   — a quantity that happened during the week (revenue, lost units).
                 Summing is meaningful; averaging gives a per-week rate.
        ratio  — a quotient (fill rate). NEITHER sum nor plain mean is correct
                 across weeks; the honest aggregate is the ratio of the summed
                 numerator to the summed denominator.

    `published` marks the series that leave the engine and reach a user. The
    rest stay in the golden trace. Before this declaration existed that subset
    was a second hand-maintained list, and `fg_value` — finished-goods
    inventory, computed on every replication of every run since the trace was
    written — fell into the gap between the two and was discarded for the whole
    of its life (§4 D163 / G19).
    """

    key: str
    unit: str
    aggregation: str       # "level" | "flow" | "ratio"
    published: bool
    doc: str


# THE weekly-series vocabulary. Adding a series is one row here; nothing else
# in the engine keeps a parallel list. `WeeklyTrace.__post_init__` allocates
# from it, `io.traces.trace_frame` orders the golden trace by it, and
# `core.engine` builds both `fr_series` and `extra_series` from it.
WEEKLY_SERIES: tuple[WeeklySeries, ...] = (
    WeeklySeries("demand_value", "currency", "flow", False,
                 "Demand valued at sell price."),
    WeeklySeries("fulfilled_value", "currency", "flow", False,
                 "Demand served, capped at demand — the fill-rate numerator."),
    WeeklySeries("revenue_value", "currency", "flow", True,
                 "Units shipped at sell price, including backlog clearing."),
    WeeklySeries("lost_value", "currency", "flow", False,
                 "Demand lost rather than backlogged, at sell price."),
    WeeklySeries("lost_units", "units", "flow", False,
                 "Demand lost rather than backlogged, in units."),
    WeeklySeries("backlog_units", "units", "level", True,
                 "Unserved demand still owed at the end of the week."),
    WeeklySeries("fill_rate", "fraction", "ratio", True,
                 "Fulfilled value over demand value; 1.0 in a week with no demand."),
    WeeklySeries("inbound_rejected", "units", "flow", False,
                 "Inbound material refused this week."),
    WeeklySeries("on_hand_value", "currency", "level", True,
                 "Material inventory on hand at the end of the week, at unit cost."),
    WeeklySeries("fg_value", "currency", "level", True,
                 "Finished-goods inventory on hand at the end of the week, at unit COGS."),
    WeeklySeries("on_hand_units", "units", "level", True,
                 "Material inventory on hand at the end of the week, in units. "
                 "Summed across materials, which carry no declared unit of "
                 "measure — see the note this obliges at the point of display."),
    WeeklySeries("fg_units", "units", "level", True,
                 "Finished-goods inventory on hand at the end of the week, in units. "
                 "Summed across products, with the same caveat as `on_hand_units`."),
    # ── Capacity (WP 9.3 / §4 D167) ──────────────────────────────────────────
    # `capacity_utilization` has been a KPI since the KPI module was written and
    # it read `trace.Q`, which exists only under `full_debug` — so on every
    # Monte Carlo run it was NaN, and the /policies sanity panel printed "not
    # recorded" for a quantity the engine clips production against every single
    # week. These four are plain weekly scalars, so the measure exists on EVERY
    # run, and the KPI is computed from them.
    #
    # A `flow` and not a `level`: capacity is a quantity the week can pass, and
    # the honest cross-week aggregate of a utilization is Σused / Σavailable —
    # which is why the pair is published rather than the ratio.
    WeeklySeries("plant_capacity_units", "units", "flow", True,
                 "Plant production capacity available this week, summed across "
                 "products — after any disruption throttle and any short-term "
                 "capacity (P-P.5) the portfolio added."),
    WeeklySeries("plant_capacity_used_units", "units", "flow", True,
                 "Units actually produced this week, summed across products. "
                 "Below the line above either because demand did not need the "
                 "capacity or because materials ran out — capacity BINDING is a "
                 "different measure, carried per product in `capacity_binding`."),
    WeeklySeries("supplier_capacity_units", "units", "flow", True,
                 "Weekly shipping capacity of the suppliers that declare a FINITE "
                 "one, after any disruption throttle. A supplier whose "
                 "`capacity_per_week` is empty is unlimited and contributes to "
                 "neither this series nor the one below — so a project that "
                 "declares no capacity at all reports 0/0 rather than a "
                 "utilization computed against infinity."),
    WeeklySeries("supplier_capacity_used_units", "units", "flow", True,
                 "Units shipped this week by those same finite-capacity suppliers."),
)

WEEKLY_SERIES_KEYS: tuple[str, ...] = tuple(s.key for s in WEEKLY_SERIES)
PUBLISHED_SERIES_KEYS: tuple[str, ...] = tuple(
    s.key for s in WEEKLY_SERIES if s.published
)


@dataclass
class WeeklyTrace:
    """Always-on weekly scalars + optional per-entity matrices (full_debug)."""

    horizon: int
    n_prods: int
    n_mats: int
    keep_matrices: bool
    n_sups: int = 0
    demand_value: np.ndarray = field(init=False)
    fulfilled_value: np.ndarray = field(init=False)   # capped at demand (FR numerator)
    revenue_value: np.ndarray = field(init=False)     # u·F including backlog clearing
    lost_value: np.ndarray = field(init=False)
    lost_units: np.ndarray = field(init=False)
    backlog_units: np.ndarray = field(init=False)
    fill_rate: np.ndarray = field(init=False)
    inbound_rejected: np.ndarray = field(init=False)
    on_hand_value: np.ndarray = field(init=False)
    fg_value: np.ndarray = field(init=False)
    on_hand_units: np.ndarray = field(init=False)
    fg_units: np.ndarray = field(init=False)
    plant_capacity_units: np.ndarray = field(init=False)
    plant_capacity_used_units: np.ndarray = field(init=False)
    supplier_capacity_units: np.ndarray = field(init=False)
    supplier_capacity_used_units: np.ndarray = field(init=False)
    # Per-entity capacity BINDING, always on rather than gated on `full_debug`
    # (WP 9.3). 1.0 in the weeks where capacity was the thing that clipped the
    # plan / the shipment, 0.0 otherwise. Two `[n, horizon]` float matrices is
    # the price of answering "for WHICH products" on an ordinary Monte Carlo
    # run, which the `full_debug`-only matrices below cannot: they exist on
    # single-replication inspection runs and nowhere else.
    #
    # Deliberately NOT weekly series: a per-entity matrix is not a scalar, and
    # widening WEEKLY_SERIES to carry one would make every declared aggregation
    # rule ("level"/"flow"/"ratio") a lie about half its rows.
    prod_cap_bound: np.ndarray = field(init=False)
    sup_cap_bound: np.ndarray = field(init=False)
    D: Optional[np.ndarray] = None
    Q: Optional[np.ndarray] = None
    F: Optional[np.ndarray] = None
    B: Optional[np.ndarray] = None
    L: Optional[np.ndarray] = None
    I_mat: Optional[np.ndarray] = None
    # Per-material in-transit (pipeline content) and weekly purchase orders,
    # aggregated over supplier links — the inspection-mode companions of
    # I_mat (single-run inspection surface, platform blueprint §9.5.1/G17).
    I_transit: Optional[np.ndarray] = None
    O_mat: Optional[np.ndarray] = None

    def __post_init__(self) -> None:
        T = self.horizon
        # Allocated FROM the declaration, so a series cannot be declared and
        # then not exist — the failure mode this loop used to have when it
        # carried its own copy of the list.
        for name in WEEKLY_SERIES_KEYS:
            setattr(self, name, np.zeros(T))
        self.prod_cap_bound = np.zeros((self.n_prods, T))
        self.sup_cap_bound = np.zeros((self.n_sups, T))
        if self.keep_matrices:
            self.D = np.zeros((self.n_prods, T))
            self.Q = np.zeros((self.n_prods, T))
            self.F = np.zeros((self.n_prods, T))
            self.B = np.zeros((self.n_prods, T))
            self.L = np.zeros((self.n_prods, T))
            self.I_mat = np.zeros((self.n_mats, T))
            self.I_transit = np.zeros((self.n_mats, T))
            self.O_mat = np.zeros((self.n_mats, T))


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

        # Stochastic lead-time variates, pre-drawn per (link, week) from the WORLD
        # stream before any policy acts (audit F-24). Drawing at ship time made
        # the number of draws — and so every later lead time — depend on how
        # many orders the policy shipped, which broke common random numbers
        # across scenarios. Standardised so the shipment's own mean (a policy
        # may expedite) is applied at use: a standard normal for lognormal
        # links, Gamma(shape=1/cv², 1) for gamma links, 0 for the rest.
        self.lt_variates = np.zeros((model.n_links, T))
        for k in range(model.n_links):
            cv = float(model.link_lt_cv[k])
            dist = model.link_lt_dist[k]
            if cv <= 0 or dist == LeadTimeDist.DETERMINISTIC:
                continue
            if dist == LeadTimeDist.LOGNORMAL:
                self.lt_variates[k] = streams.leadtime.standard_normal(T)
            elif dist == LeadTimeDist.GAMMA:
                self.lt_variates[k] = streams.leadtime.gamma(1.0 / (cv * cv), 1.0, T)

        # Persistent state.
        self.on_hand = np.zeros(model.n_mats)
        self.pipeline = np.zeros((model.n_links, model.ring_width))
        self.queue = np.zeros(model.n_links)
        self.backlog = np.zeros(model.n_prods)
        self.fg_on_hand = np.zeros(model.n_prods)
        self.fg_target = np.zeros(model.n_prods)        # S^FG_p (ADR 0001)
        self.cost = CostLedger(T)
        self.policy_state: dict[str, dict] = {}
        self.policy_rng_created_week: dict[str, int] = {}
        # Forecast machinery (PH-10 mechanic state; no contract key needed for
        # the raw history — only the `forecast` transient is contractual).
        self.demand_history = np.zeros((model.n_prods, 26))  # ring, max window
        self.demand_history_n = 0
        self.forecast_smooth = model.mean_demand_p.copy()

        # World demand schedule (§II.4 / §III-D.6): the realized trajectory
        # plus a τ*-week forward tail, drawn up front. Weeks 0..H−1 are drawn
        # first, in the exact order the week loop consumed the stream before,
        # so realized demand stays bit-identical; the tail draws come after.
        # The schedule depends only on settings + network + world seed, never
        # on the policy portfolio (G-RNG invariance).
        lookahead = model.settings.visibility_horizon
        self.demand_schedule = np.zeros((model.n_prods, T + lookahead))
        for t in range(T + lookahead):
            draw_week_demand(model, streams.demand, self.demand_schedule[:, t])

        # Weekly transients (rebound each week by the engine/mechanics).
        self.week: int = 0
        self.demand = np.zeros(model.n_prods)
        self.forecast = model.mean_demand_p.copy()
        self.fg_served_backlog = np.zeros(model.n_prods)  # PH-30 (MTS)
        self.fg_served_new = np.zeros(model.n_prods)
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
        # node:plant disruption state (one plant → scalars). Composed weekly in
        # the week_start mechanic; read by production planning/execute.
        self.plant_lt_block_end = 0   # > week ⇒ plant produces nothing this week
        self.plant_cap_factor = 1.0   # φ throttle on the plant's production capacity
        self.lost_inbound_this_week = 0.0
        # Draws bounded to the in-transit ring, per link (audit F-36). A draw
        # longer than the ring used to wrap and land EARLY with no symptom.
        self.lt_truncated = np.zeros(model.n_links, dtype=int)
        # P-S.4 early_warning_failover: monitored detection lag. None → the
        # scenario's settings.detection_lag_weeks applies unchanged.
        self.detection_lag_override: Optional[int] = None
        # P-C.6 forward_visibility: weeks of committed forward order book the
        # plant may read (τ*, §III-D.6). 0 = no customer visibility policy.
        self.visibility_horizon: int = 0
        self._forward_mat_cum: Optional[np.ndarray] = None

        self.trace = WeeklyTrace(T, model.n_prods, model.n_mats, keep_matrices,
                                 n_sups=model.n_sups)
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
        lag = (self.detection_lag_override
               if self.detection_lag_override is not None
               else self.model.settings.detection_lag_weeks)
        return [e for e in self.events if e.start + lag <= t and t < e.end + e.ramp_weeks]

    def visible_disrupted_suppliers(self) -> np.ndarray:
        mask = np.zeros(self.model.n_sups, dtype=bool)
        for e in self.events_visible():
            if e.is_plant:
                continue  # plant events do not disrupt a supplier
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

    def forward_material_demand(self, start_week: int, cover_weeks) -> np.ndarray:
        """Per-material forward-visible demand summed INCLUSIVELY over
        τ = start_week .. start_week + cover_weeks (§II.4): BoM-exploded
        D̂_m[τ] = Σ_p D̂_p[τ]·r_{p,m} over the coverage window.

        ``cover_weeks`` is an int or an (n_mats,) int array (per-material
        lead times). Windows are clamped to the schedule edge; feasibility
        (T_s + κ ≤ τ*) guarantees full windows for every simulated week.
        """
        if self._forward_mat_cum is None:
            mat_sched = np.asarray(self.model.bom.T @ self.demand_schedule)
            cum = np.zeros((self.model.n_mats, mat_sched.shape[1] + 1))
            np.cumsum(mat_sched, axis=1, out=cum[:, 1:])
            self._forward_mat_cum = cum
        cum = self._forward_mat_cum
        width = cum.shape[1] - 1
        lo = min(max(start_week, 0), width)
        hi = np.clip(start_week + np.asarray(cover_weeks, dtype=int) + 1, lo, width)
        rows = np.arange(self.model.n_mats)
        return cum[rows, hi] - cum[rows, lo]

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

    def write_fg_target(self, target: np.ndarray) -> None:
        """S^FG_p — MTS stock target, consumed by next week's PH-40 (ADR 0001)."""
        self._check_write(ST_FG_TARGET)
        self.fg_target = np.where(self.model.mts_mask, np.maximum(target, 0.0), 0.0)

    def write_fg_fulfillment(self, served_backlog: np.ndarray, served_new: np.ndarray) -> None:
        self._check_write(FG_FULFILLMENT)
        self.fg_served_backlog = np.maximum(served_backlog, 0.0)
        self.fg_served_new = np.maximum(served_new, 0.0)

    def write_fulfillment(
        self, fulfilled: np.ndarray, served_new: np.ndarray, lost_units: np.ndarray
    ) -> None:
        """``fulfilled`` = total units shipped (incl. backlog clearing);
        ``served_new`` = portion serving THIS week's demand (FR numerator)."""
        self._check_write(FULFILLMENT)
        self.fulfillment = fulfilled
        self.served_new_week = np.clip(served_new, 0.0, None)
        self.lost_units_week = np.maximum(lost_units, 0.0)
