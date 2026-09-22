"""SCSIM weekly engine — compile, replicate, aggregate.

The week is the phase pipeline of Part IX §9.1; built-in mechanics and
policy hooks are dispatched per phase in priority order, all validated at
compile time. Parallelism is ACROSS replications only (§10.2.3); within a
replication everything is single-threaded and deterministic.

Public entry points:
    compile_scenario(scenario)          → CompiledScenario (validated)
    resolve_warmup(compiled)            → WarmupReport (MSER-5 + Conway)
    run_scenario(scenario, ...)         → ScenarioResult
    run_portfolio_study(scenario, ...)  → PortfolioStudy (CRN deltas vs S0)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import numpy as np

from scsim import ENGINE_VERSION
from scsim.core.context import (
    COST_COMPONENTS,
    PUBLISHED_SERIES_KEYS,
    CompiledModel,
    ResolvedEvent,
    SimContext,
)
from scsim.core.mechanics import greedy_feasible
from scsim.core.phases import (
    ARRIVALS,
    DEMAND,
    DISRUPTION_STATE,
    FG_FULFILLMENT,
    FIRM_KNOWLEDGE,
    FORECAST,
    KPI_ROWS,
    MATERIAL_DEMAND,
    OVERTIME_CAPACITY,
    PRODUCTION_OUTPUT,
    PRODUCTION_PLAN,
    PURCHASE_ORDERS,
    ST_BACKLOG,
    ST_COST_LEDGER,
    ST_FG_ON_HAND,
    ST_FG_TARGET,
    ST_ON_HAND,
    ST_PIPELINE,
    ST_QUEUE,
    BoundHook,
    Hook,
    PhaseId,
    validate_hooks,
)
from scsim.disruption.injector import any_stochastic, resolve_events, validate_events
from scsim.entities.config import StatisticsReport, WarmupReport
from scsim.entities.enums import (
    EffectType,
    FulfillmentMode,
    LeadTimeDist,
    OverflowRule,
    RunMode,
    TraceVerbosity,
    WarmupMethod,
)
from scsim.entities.scenario import BUILT_IN_POLICY_IDS, Scenario
from scsim.kpi.compute import compute_replication_kpis
from scsim.policies.base import FeasibilityIssue, PolicyPlugin
from scsim.policies.registry import check_portfolio, instantiate
from scsim.stats.bootstrap import aggregate_mean_ci, t_halfwidth
from scsim.stats.seeds import replication_grid, world_streams
from scsim.stats.warmup import detect_warmup


class CompileError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Mechanics (engine-owned phase work). Each is registered with a BoundHook so
# hook validation covers mechanics + policies uniformly.
# ---------------------------------------------------------------------------

def _mech_week_start(model: CompiledModel, ctx: SimContext) -> None:
    t = ctx.week
    ctx.cost.set_week(t)
    # Reset weekly transients.
    ctx.demand[:] = 0.0
    ctx.fg_served_backlog[:] = 0.0
    ctx.fg_served_new[:] = 0.0
    ctx.production_plan[:] = 0.0
    ctx.overtime_extra[:] = 0.0
    ctx.production_output[:] = 0.0
    ctx.fulfillment[:] = 0.0
    ctx.lost_units_week[:] = 0.0
    ctx.material_demand[:] = 0.0
    ctx.purchase_orders[:] = 0.0
    ctx.po_lt_override[:] = -1
    ctx.arrivals[:] = 0.0
    ctx.lost_inbound_this_week = 0.0
    # Physical disruption state (composition: max severity per target).
    ctx.lt_block_end[:] = 0
    ctx.cap_factor[:] = 1.0
    ctx.plant_lt_block_end = 0
    ctx.plant_cap_factor = 1.0
    for e in ctx.events:
        if e.is_plant:
            # node:plant → throttle/halt the plant's own production.
            if e.lt_active_at(t):
                ctx.plant_lt_block_end = max(ctx.plant_lt_block_end, e.end)
            f = e.cap_factor_at(t)
            if f < 1.0:
                ctx.plant_cap_factor = min(ctx.plant_cap_factor, f)
            continue
        if e.lt_active_at(t):
            s = e.supplier_idx
            ctx.lt_block_end[s] = max(ctx.lt_block_end[s], e.end)
        f = e.cap_factor_at(t)
        if f < 1.0:
            ctx.cap_factor[e.supplier_idx] = min(ctx.cap_factor[e.supplier_idx], f)


def _mech_demand(model: CompiledModel, ctx: SimContext) -> None:
    # Forecast BEFORE reading the week (information timing, ADR 0001):
    # forecast_t = f(D_{t-window..t-1}); falls back to the model mean cold.
    _update_forecast(model, ctx)
    # Realized demand is this week's column of the pre-drawn world schedule
    # (§III-D.6: D_{p}[t] = D̃_{p}[t] — the committed order book realizes).
    ctx.demand = ctx.demand_schedule[:, ctx.week].copy()
    # Append the realization to the history ring (consumed by next week's forecast).
    ctx.demand_history[:, ctx.demand_history_n % 26] = ctx.demand
    ctx.demand_history_n += 1


def _update_forecast(model: CompiledModel, ctx: SimContext) -> None:
    from scsim.entities.enums import ForecastModel

    n = ctx.demand_history_n
    fc = model.mean_demand_p.copy()
    if n > 0:
        last = ctx.demand_history[:, (n - 1) % 26]
        for j in range(model.n_prods):
            fm = model.forecast_model_of[j]
            if fm == ForecastModel.PERFECT:
                continue  # true model mean
            if fm == ForecastModel.NAIVE:
                fc[j] = last[j]
            elif fm == ForecastModel.MA:
                w = min(int(model.forecast_window[j]), n, 26)
                idx = [(n - 1 - k) % 26 for k in range(w)]
                fc[j] = float(ctx.demand_history[j, idx].mean())
            else:  # EXP_SMOOTHING: s_t = α·D_{t−1} + (1−α)·s_{t−1}
                alpha = 2.0 / (model.forecast_window[j] + 1.0)
                ctx.forecast_smooth[j] = alpha * last[j] + (1 - alpha) * ctx.forecast_smooth[j]
                fc[j] = float(ctx.forecast_smooth[j])
    ctx.forecast = np.maximum(fc * (1.0 + model.forecast_bias), 0.0)


def _mech_detection(model: CompiledModel, ctx: SimContext) -> None:
    # firm_knowledge is served on demand via ctx.events_visible() (detection
    # lag applied there); the phase slot is where P-S.4 / P-X.1 will live.
    return


def _mech_fulfill_from_stock(model: CompiledModel, ctx: SimContext) -> None:
    """§3.3 MTS step ①: F_p = min(D_p + B_p, I^FG_p), backlog served first.
    The shortfall flows to P-C.1 at PH-60. No-op for MTO products."""
    mts = model.mts_mask
    if not mts.any():
        return
    want = np.where(mts, ctx.demand + ctx.backlog, 0.0)
    served = np.minimum(want, ctx.fg_on_hand)
    served_backlog = np.minimum(served, ctx.backlog)
    served_new = served - served_backlog
    ctx.fg_on_hand = ctx.fg_on_hand - served
    ctx.fg_served_backlog = served_backlog
    ctx.fg_served_new = served_new


def _effective_prod_capacity(model: CompiledModel, ctx: SimContext) -> np.ndarray:
    """Plant production capacity for this week, after any node:plant disruption.

    Identical to ``model.capacity + overtime`` when no plant event is active
    (plant_cap_factor = 1.0, plant_lt_block_end = 0). A plant lead-time
    extension halts production outright (overtime cannot override a halt); a
    plant capacity_reduction throttles base capacity by φ.
    """
    if ctx.plant_lt_block_end > ctx.week:
        return np.zeros_like(model.capacity)
    return model.capacity * ctx.plant_cap_factor + ctx.overtime_extra


def _mech_default_plan(model: CompiledModel, ctx: SimContext) -> None:
    # MTO: produce to order (D + backlog). MTS step ②: replenish toward last
    # week's S^FG plus any backlog PH-30 could not serve from stock.
    want_mto = ctx.demand + ctx.backlog
    if model.mts_mask.any():
        backlog_unserved = ctx.backlog - ctx.fg_served_backlog
        gap = np.maximum(ctx.fg_target - ctx.fg_on_hand, 0.0) + backlog_unserved
        want = np.where(model.mts_mask, gap, want_mto)
    else:
        want = want_mto
    cap = _effective_prod_capacity(model, ctx)
    # CAPACITY BINDING IS MEASURED HERE AND NOWHERE ELSE (WP 9.3 / §4 D167).
    #
    # This is the only point in the week where the UNCLIPPED want still exists:
    # `ctx.production_plan` is the clipped figure, so `plan > cap` downstream is
    # false by construction and an "did capacity bind" test written there would
    # answer no on every week of every run. The flag is what lets a result say
    # WHICH products the capacity held back, rather than only that utilization
    # was high — those are different statements and only one of them is an
    # answer to "should I buy another line".
    ctx.trace.prod_cap_bound[:, ctx.week] = (want > cap + 1e-9) & (cap > 0.0)
    ctx.production_plan = np.minimum(want, cap)


def _mech_production_execute(model: CompiledModel, ctx: SimContext) -> None:
    # Eq. 8: greedy in fixed product order; P-P.9 pre-shapes the plan when active.
    cap = _effective_prod_capacity(model, ctx)
    plan = np.minimum(ctx.production_plan, cap)
    Q, remaining = greedy_feasible(model, plan, ctx.on_hand)
    ctx.production_output = Q
    ctx.on_hand = remaining
    # The capacity the week offered, and the output that used it. Recorded from
    # the SAME `cap` the clip above used, so the two can never describe
    # different weeks — including under a plant disruption, where `cap` is the
    # throttled figure and a utilization against the nominal one would read as
    # a collapse in demand rather than a loss of capacity.
    ctx.trace.plant_capacity_units[ctx.week] = float(cap.sum())
    ctx.trace.plant_capacity_used_units[ctx.week] = float(Q.sum())
    if model.mts_mask.any():
        # Eq. 9: MTS output replenishes FG (same-week completion, W^FG = 0 in v1).
        ctx.fg_on_hand = ctx.fg_on_hand + np.where(model.mts_mask, Q, 0.0)


def _mech_material_demand(model: CompiledModel, ctx: SimContext) -> None:
    # Eq. 1 — stationary expectation for MTO; forecast projection for MTS (§3.3).
    if model.mts_mask.any():
        exp_p = np.where(model.mts_mask, ctx.forecast, model.mean_demand_p)
        ctx.material_demand = np.asarray(model.bom.T @ exp_p).ravel()
    else:
        ctx.material_demand = model.exp_demand_m.copy()


def _mech_fg_target_base(model: CompiledModel, ctx: SimContext) -> None:
    """Base S^FG = forecast over the production cycle (1 week, v1) — the thin
    cycle stock. P-P.4 adds the real FG safety stock on top (priority 55)."""
    if not model.mts_mask.any():
        return
    base = np.where(model.fg_base_stock_override >= 0,
                    model.fg_base_stock_override, ctx.forecast)
    ctx.fg_target = np.where(model.mts_mask, base, 0.0)


def _mech_orders_to_queue(model: CompiledModel, ctx: SimContext) -> None:
    np.add.at(ctx.queue, np.arange(model.n_links), ctx.purchase_orders)


def _mech_defer_arrivals(model: CompiledModel, ctx: SimContext) -> None:
    """Eqs. 11–12: arrivals usable inside an LT-extension window land at its end."""
    t = ctx.week
    W = model.ring_width
    blocked = np.flatnonzero(ctx.lt_block_end > t + 1)  # end > t+1 ⇒ t+1 in window
    for s in blocked:
        end = int(ctx.lt_block_end[s])
        links = np.flatnonzero(model.link_sup == s)
        src = (t + 1) % W
        qty = ctx.pipeline[links, src]
        moving = qty > 0
        if moving.any():
            dst = end % W
            ctx.pipeline[links[moving], dst] += qty[moving]
            ctx.pipeline[links[moving], src] = 0.0


def _mech_ship_queue(model: CompiledModel, ctx: SimContext) -> None:
    """Move supplier-held orders into the in-transit pipeline under capacity gating."""
    t = ctx.week
    W = model.ring_width
    rng = ctx.streams.leadtime
    reject_sups = {
        e.supplier_idx
        for e in ctx.events
        if e.effect == EffectType.CAPACITY_REDUCTION
        and e.overflow_rule == OverflowRule.REJECT
        and e.cap_factor_at(t) < 1.0
    }
    for s in range(model.n_sups):
        links = model.links_of_sup[s]
        total_q = float(ctx.queue[links].sum())
        cap_eff = model.sup_capacity[s] * ctx.cap_factor[s]
        # A FINITE capacity is the only one that can be utilized, and an empty
        # `suppliers.capacity_per_week` is `np.inf` by construction
        # (`context.py`), which is the declared meaning of the blank rather
        # than a missing value. So an unlimited supplier contributes to NEITHER
        # side of the ratio: counting its shipments against an infinite
        # denominator would report 0% forever, and against its own shipments
        # would report 100% forever. Both are answers to a question nobody asked.
        finite = not np.isinf(cap_eff)
        if finite:
            ctx.trace.supplier_capacity_units[t] += float(cap_eff)
        if total_q <= 0:
            continue
        if finite:
            ctx.trace.sup_cap_bound[s, t] = float(total_q > cap_eff + 1e-9)
        if np.isinf(cap_eff):
            shipped = ctx.queue[links].copy()
            ctx.queue[links] = 0.0
        else:
            ship_total = min(total_q, float(cap_eff))
            ctx.trace.supplier_capacity_used_units[t] += ship_total
            factor = ship_total / total_q
            shipped = ctx.queue[links] * factor
            ctx.queue[links] -= shipped
            if s in reject_sups:
                rejected = float(ctx.queue[links].sum())
                if rejected > 0:
                    ctx.lost_inbound_this_week += rejected
                    ctx.queue[links] = 0.0
        # Assign arrival weeks per link.
        for k, link in enumerate(links):
            qty = float(shipped[k])
            if qty <= 0:
                continue
            lt = int(ctx.po_lt_override[link]) if ctx.po_lt_override[link] > 0 else int(model.link_lt[link])
            dist = model.link_lt_dist[link]
            if dist != LeadTimeDist.DETERMINISTIC and model.link_lt_cv[link] > 0:
                lt = _sample_lt(rng, dist, lt, float(model.link_lt_cv[link]))
            arrival = t + max(1, lt)
            if ctx.lt_block_end[s] > 0:
                arrival = max(arrival, int(ctx.lt_block_end[s]))
            # The ring holds W slots; a delay of W or more writes a slot that is
            # read EARLIER than the arrival week — the shipment lands early and
            # nothing downstream can tell (audit F-36). Bound it, and count it:
            # `lead_time_truncations` on the result, a warning on the run.
            if arrival - t > W - 2:
                arrival = t + W - 2
                ctx.lt_truncated[link] += 1
            ctx.pipeline[link, arrival % W] += qty


def _sample_lt(rng: np.random.Generator, dist: LeadTimeDist, mean: int, cv: float) -> int:
    # Consumed only when an order ships — CRN caveat documented (docs/statistics.md).
    if dist == LeadTimeDist.LOGNORMAL:
        sigma2 = np.log1p(cv * cv)
        mu = np.log(max(mean, 1e-9)) - sigma2 / 2.0
        return int(round(float(rng.lognormal(mu, np.sqrt(sigma2)))))
    if dist == LeadTimeDist.GAMMA:
        shape = 1.0 / (cv * cv)
        return int(round(float(rng.gamma(shape, mean / shape))))
    return mean


def _mech_land_arrivals(model: CompiledModel, ctx: SimContext) -> None:
    slot = (ctx.week + 1) % model.ring_width
    per_link = ctx.pipeline[:, slot].copy()
    if per_link.any():
        ctx.pipeline[:, slot] = 0.0
        ctx.arrivals = np.asarray(model.link_to_mat @ per_link).ravel()
        ctx.on_hand = ctx.on_hand + ctx.arrivals
    else:
        ctx.arrivals = np.zeros(model.n_mats)


def _mech_accounting(model: CompiledModel, ctx: SimContext, policies: list[PolicyPlugin]) -> None:
    t = ctx.week
    tr = ctx.trace
    u = model.unit_price
    D, F, L = ctx.demand, ctx.fulfillment, ctx.lost_units_week
    served_new = ctx.served_new_week
    dv = float((u * D).sum())
    tr.demand_value[t] = dv
    tr.fulfilled_value[t] = float((u * served_new).sum())
    tr.revenue_value[t] = float((u * F).sum())
    lost_v = float((u * L).sum())
    tr.lost_value[t] = lost_v
    tr.lost_units[t] = float(L.sum())
    tr.backlog_units[t] = float(ctx.backlog.sum())
    tr.fill_rate[t] = tr.fulfilled_value[t] / dv if dv > 0 else 1.0
    tr.inbound_rejected[t] = ctx.lost_inbound_this_week
    tr.on_hand_value[t] = float((ctx.on_hand * model.mat_cost).sum())
    tr.fg_value[t] = float((ctx.fg_on_hand * model.fg_unit_cogs).sum())
    # The same two stocks in units. Plain scalars, so — unlike the per-item
    # matrices below — they cost nothing, need no `keep_matrices`, and exist on
    # every replication of every run rather than on inspection runs only.
    tr.on_hand_units[t] = float(ctx.on_hand.sum())
    tr.fg_units[t] = float(ctx.fg_on_hand.sum())
    if lost_v > 0:
        ctx.cost.add("lost_sales", lost_v)
    for pol in policies:
        cb = pol.cost_contribution(ctx)
        for component, amount in cb.components.items():
            if amount:
                ctx.cost.add(component, amount)
    if tr.keep_matrices:
        tr.D[:, t] = D
        tr.Q[:, t] = ctx.production_output
        tr.F[:, t] = F
        tr.B[:, t] = ctx.backlog
        tr.L[:, t] = L
        tr.I_mat[:, t] = ctx.on_hand
        # Inspection-mode per-material flows: pipeline content (in transit,
        # all future arrival slots) and this week's purchase orders, both
        # aggregated over supplier links onto materials.
        tr.I_transit[:, t] = np.asarray(
            model.link_to_mat @ ctx.pipeline.sum(axis=1)
        ).ravel()
        tr.O_mat[:, t] = np.asarray(model.link_to_mat @ ctx.purchase_orders).ravel()


_MECHANIC_HOOKS: list[tuple[str, Hook, Callable]] = [
    ("mech.week_start", Hook(phase=PhaseId.PH00, priority=50, writes={DISRUPTION_STATE}),
     _mech_week_start),
    ("mech.demand_realization", Hook(phase=PhaseId.PH10, priority=50,
                                     writes={DEMAND, FORECAST}),
     _mech_demand),
    ("mech.detection", Hook(phase=PhaseId.PH20, priority=50,
                            reads={DISRUPTION_STATE}, writes={FIRM_KNOWLEDGE}),
     _mech_detection),
    ("mech.fulfill_from_stock", Hook(phase=PhaseId.PH30, priority=50,
                                     reads={DEMAND, ST_BACKLOG, ST_FG_TARGET},
                                     writes={FG_FULFILLMENT, ST_FG_ON_HAND}),
     _mech_fulfill_from_stock),
    ("mech.default_plan", Hook(phase=PhaseId.PH40, priority=50,
                               reads={DEMAND, FG_FULFILLMENT, OVERTIME_CAPACITY,
                                      ST_BACKLOG, ST_FG_TARGET},
                               writes={PRODUCTION_PLAN}),
     _mech_default_plan),
    ("mech.production_execute", Hook(phase=PhaseId.PH50, priority=50,
                                     reads={PRODUCTION_PLAN, OVERTIME_CAPACITY},
                                     writes={PRODUCTION_OUTPUT, ST_ON_HAND, ST_FG_ON_HAND}),
     _mech_production_execute),
    ("mech.material_demand", Hook(phase=PhaseId.PH70, priority=40,
                                  reads={FORECAST}, writes={MATERIAL_DEMAND}),
     _mech_material_demand),
    ("mech.fg_target_base", Hook(phase=PhaseId.PH70, priority=45,
                                 reads={FORECAST}, writes={ST_FG_TARGET}),
     _mech_fg_target_base),
    ("mech.orders_to_queue", Hook(phase=PhaseId.PH80, priority=90,
                                  reads={PURCHASE_ORDERS}, writes={ST_QUEUE}),
     _mech_orders_to_queue),
    ("mech.defer_arrivals", Hook(phase=PhaseId.PH90, priority=10,
                                 reads={DISRUPTION_STATE}, writes={ST_PIPELINE}),
     _mech_defer_arrivals),
    ("mech.ship_queue", Hook(phase=PhaseId.PH90, priority=20,
                             reads={DISRUPTION_STATE, PURCHASE_ORDERS},
                             writes={ST_PIPELINE, ST_QUEUE}),
     _mech_ship_queue),
    ("mech.land_arrivals", Hook(phase=PhaseId.PH90, priority=90,
                                writes={ARRIVALS, ST_ON_HAND, ST_PIPELINE}),
     _mech_land_arrivals),
]


# ---------------------------------------------------------------------------
# Compilation
# ---------------------------------------------------------------------------

@dataclass
class CompiledScenario:
    scenario: Scenario
    model: CompiledModel
    policies: list[PolicyPlugin]
    params_by_id: dict[str, Any]
    dispatch: dict[PhaseId, list[tuple[int, BoundHook, Callable]]]
    feasibility_warnings: list[FeasibilityIssue]
    warmup: Optional[WarmupReport] = None


def compile_scenario(scenario: Scenario, debug: bool = True) -> CompiledScenario:
    for p in scenario.network.products:
        if p.fulfillment_mode == FulfillmentMode.ATO:
            raise CompileError(
                f"product {p.id!r}: fulfillment_mode=ato is a reserved enum value "
                f"(not scheduled); use mto or mts"
            )

    model = CompiledModel(scenario)
    validate_events(model)
    for links in model.links_of_sup:
        for link in links:
            if model.link_lt_dist[link] == LeadTimeDist.EMPIRICAL:
                raise CompileError("lead_time_dist=empirical lands with the data-import path (M7)")

    # Policies: portfolio + always-on built-ins (manuscript baseline defaults).
    policy_specs = dict(scenario.policies)
    for builtin in BUILT_IN_POLICY_IDS:
        policy_specs.setdefault(builtin, {})
    issues = check_portfolio(scenario)
    errors = [i for i in issues if i.severity == "error"]
    if errors:
        msgs = "; ".join(f"[{e.code}] {e.message}" for e in errors)
        raise CompileError(f"portfolio infeasible: {msgs}")

    policies = [instantiate(pid, raw) for pid, raw in sorted(policy_specs.items())]
    params_by_id = {pol.id: pol.params for pol in policies}

    bound: list[BoundHook] = [
        BoundHook(owner=name, hook=hook, is_mechanic=True) for name, hook, _ in _MECHANIC_HOOKS
    ]
    for pol in policies:
        for hook in pol.hooks:
            bound.append(BoundHook(owner=pol.id, hook=hook))
    # PH-99 accounting reads freely (read-only by contract) — registered last.
    accounting_hook = Hook(phase=PhaseId.PH99, priority=50,
                           writes={KPI_ROWS, ST_COST_LEDGER})
    bound.append(BoundHook(owner="mech.accounting", hook=accounting_hook, is_mechanic=True))
    validate_hooks(bound)

    dispatch: dict[PhaseId, list[tuple[int, BoundHook, Callable]]] = {ph: [] for ph in PhaseId}
    for (name, hook, fn) in _MECHANIC_HOOKS:
        bh = BoundHook(owner=name, hook=hook, is_mechanic=True)
        dispatch[hook.phase].append((hook.priority, bh, _bind_mechanic(fn, model)))
    acc_bh = BoundHook(owner="mech.accounting", hook=accounting_hook, is_mechanic=True)
    dispatch[PhaseId.PH99].append(
        (50, acc_bh, lambda ctx, _m=model, _p=policies: _mech_accounting(_m, ctx, _p))
    )
    for pol in policies:
        for hook in pol.hooks:
            bh = BoundHook(owner=pol.id, hook=hook)
            dispatch[hook.phase].append((hook.priority, bh, _bind_policy(pol, hook.phase)))
    for ph in PhaseId:
        dispatch[ph].sort(key=lambda item: item[0])

    return CompiledScenario(
        scenario=scenario,
        model=model,
        policies=policies,
        params_by_id=params_by_id,
        dispatch=dispatch,
        feasibility_warnings=[i for i in issues if i.severity == "warning"],
    )


def _bind_mechanic(fn: Callable, model: CompiledModel) -> Callable:
    return lambda ctx: fn(model, ctx)


def _bind_policy(pol: PolicyPlugin, phase: PhaseId) -> Callable:
    return lambda ctx: pol.on_phase(phase, ctx)


# ---------------------------------------------------------------------------
# Replication loop
# ---------------------------------------------------------------------------

def run_replication(
    compiled: CompiledScenario,
    model_rep: int,
    event_rep: int,
    events: list[ResolvedEvent],
    debug: bool = False,
    snapshot_store=None,
    snapshot_digest: Optional[str] = None,
    warmup_week: Optional[int] = None,
) -> SimContext:
    model = compiled.model
    settings = model.settings
    keep_matrices = settings.trace_verbosity == TraceVerbosity.FULL_DEBUG
    streams = world_streams(settings.project_seed, model_rep, event_rep)
    ctx = SimContext(model, streams, events, keep_matrices=keep_matrices, debug=debug)
    ctx._params = compiled.params_by_id

    for pol in compiled.policies:
        pol.setup(ctx)
    _initialize_state(compiled, ctx)

    # Warm-state snapshots (§10.2.4): resume at t_w when the family is cached.
    start_week = 0
    capture_at: Optional[int] = None
    use_snapshots = (
        snapshot_store is not None
        and snapshot_digest is not None
        and warmup_week is not None
        and all(e.start >= warmup_week for e in events)
    )
    if use_snapshots:
        resumed = snapshot_store.restore(snapshot_digest, model_rep, ctx)
        if resumed is not None:
            start_week = resumed
        else:
            capture_at = warmup_week

    dispatch = compiled.dispatch
    phases = list(PhaseId)
    for t in range(start_week, settings.horizon):
        if capture_at is not None and t == capture_at:
            from scsim.io.snapshots import SnapshotInvalid
            try:
                snapshot_store.capture(snapshot_digest, model_rep, ctx, t)
            except SnapshotInvalid:
                pass
            capture_at = None
        ctx.week = t
        for ph in phases:
            for _prio, bh, fn in dispatch[ph]:
                if debug and not bh.is_mechanic:
                    ctx._active_hook = bh
                    try:
                        fn(ctx)
                    finally:
                        ctx._active_hook = None
                else:
                    fn(ctx)
    return ctx


def _initialize_state(compiled: CompiledScenario, ctx: SimContext) -> None:
    """Warm start: run the PH-70 chain once to get levels and FG targets, set
    I_m(0), prime the in-transit pipeline with one expected week per slot."""
    model = compiled.model
    ctx.week = 0
    for _prio, bh, fn in compiled.dispatch[PhaseId.PH70]:
        fn(ctx)
    init = np.where(model.mat_initial >= 0, model.mat_initial,
                    np.maximum(ctx.level_S - model.exp_demand_m * model.link_lt[model.primary_link], 0.0))
    ctx.on_hand = init.astype(float)
    if model.mts_mask.any():
        ctx.fg_on_hand = ctx.fg_target.copy()  # MTS starts at its stock target
    W = model.ring_width
    for m in range(model.n_mats):
        link = model.primary_link[m]
        exp_d = model.exp_demand_m[m]
        if exp_d <= 0:
            continue
        for w in range(1, int(model.link_lt[link]) + 1):
            ctx.pipeline[link, w % W] += exp_d


# ---------------------------------------------------------------------------
# Warm-up resolution (Part VIII §1)
# ---------------------------------------------------------------------------

def resolve_warmup(compiled: CompiledScenario, detection_reps: int = 10) -> WarmupReport:
    settings = compiled.model.settings
    if settings.warmup_method == WarmupMethod.MANUAL:
        report = WarmupReport(
            conway_week=-1, mser5_week=-1,
            adopted_week=int(settings.warmup_end), method=WarmupMethod.MANUAL,
        )
        compiled.warmup = report
        return report

    n = min(detection_reps, settings.model_seeds)
    series = np.zeros((n, settings.horizon))
    for i in range(n):
        ctx = run_replication(compiled, model_rep=i, event_rep=0, events=[])
        series[i] = ctx.trace.fill_rate
    mean_series = series.mean(axis=0)
    report = detect_warmup(mean_series, settings.warmup_method, settings.warmup_end)
    adopted = min(report.adopted_week, settings.horizon // 2)
    report = WarmupReport(
        conway_week=report.conway_week, mser5_week=report.mser5_week,
        mser5_published_week=report.mser5_published_week,
        adopted_week=adopted, method=report.method, series_used="fill_rate",
    )
    compiled.warmup = report
    return report


# ---------------------------------------------------------------------------
# Scenario run + aggregation
# ---------------------------------------------------------------------------

@dataclass
class ScenarioResult:
    name: str
    kpis: list[dict[str, float]]                  # one row per replication
    fr_series: np.ndarray                          # [n_reps, horizon]
    aggregates: dict[str, dict[str, float]]
    stats: StatisticsReport
    feasibility_warnings: list[FeasibilityIssue] = field(default_factory=list)
    rep_cells: list[tuple[int, int]] = field(default_factory=list)
    warmup: Optional[WarmupReport] = None
    lp_fallbacks: int = 0
    # Additional weekly per-replication series lifted from the trace (same
    # shape as fr_series): every `PUBLISHED_SERIES_KEYS` entry except
    # `fill_rate`, which is `fr_series` above. Keyed by the declared name, so
    # the set follows `WEEKLY_SERIES` rather than a list kept here by hand.
    extra_series: dict[str, np.ndarray] = field(default_factory=dict)
    # Single-run inspection surface (blueprint G17/§9.5.1): per-item weekly
    # matrices lifted from the full-debug trace — populated ONLY when
    # trace_verbosity=full_debug and the run has exactly one replication
    # (per-item evidence at multi-rep scale is deliberately not exposed).
    # Keys: "material.on_hand" / "material.in_transit" / "material.orders"
    # ([n_mats, horizon]) and "product.demand" / "product.production" /
    # "product.fulfillment" / "product.backlog" / "product.lost_units"
    # ([n_prods, horizon]).
    item_series: Optional[dict[str, np.ndarray]] = None
    # Row labels for item_series: {"material": [...ids], "product": [...ids]}.
    item_ids: Optional[dict[str, list[str]]] = None
    # WHICH products and suppliers the capacity held back, over the analysis
    # window, averaged across replications (WP 9.3 / §4 D167). Present on EVERY
    # run — unlike `item_series`, which needs a single-replication full-debug
    # inspection run, and which is why "for which products did capacity bind"
    # had no answer a user could reach. Shape:
    #   {"window_weeks": int, "replications": int,
    #    "products":  [{"id", "bound_weeks", "capacity", "produced", "utilization"}],
    #    "suppliers": [{"id", "bound_weeks", "capacity", "shipped", "utilization"}],
    #    "unlimited_suppliers": int}
    # Only entities the capacity bound for at least one week are listed: a list
    # of every product on every run is a table nobody reads, and the absence of
    # a row is the same statement as a zero.
    capacity_binding: Optional[dict] = None
    # Stochastic lead-time draws bounded to the in-transit ring (audit F-36):
    # [{"supplier_id", "material_id", "draws", "replications", "bounded_to_weeks"}].
    # Empty when no draw was bounded — the common case.
    lead_time_truncations: list = field(default_factory=list)
    # Fixed-start events moved from inside warm-up to t_w (audit F-03):
    # [{"event_index", "target_id", "authored_week", "used_week", "replications"}].
    event_shifts: list = field(default_factory=list)

    def kpi_array(self, key: str) -> np.ndarray:
        return np.array([row.get(key, np.nan) for row in self.kpis])


# Per-replication progress observer: called as (done, total, kpi_row,
# weekly_series) after each replication completes; ``weekly_series`` carries
# exactly the published traces ScenarioResult exposes — `PUBLISHED_SERIES_KEYS`
# — for that single replication. ``total`` is the planned grid size and may
# grow under sequential-CI stopping.
ProgressFn = Callable[[int, int, dict[str, float], dict[str, np.ndarray]], None]


def _notify_progress(
    progress: Optional[ProgressFn], done: int, total: int,
    row: dict[str, float], ctx: SimContext,
) -> None:
    """Observer errors must never kill a run — swallow and continue."""
    if progress is None:
        return
    try:
        progress(done, total, row, {
            k: getattr(ctx.trace, k) for k in PUBLISHED_SERIES_KEYS
        })
    except Exception:  # noqa: BLE001 — observer only, run integrity first
        pass



class _CapacityBindingAccumulator:
    """Per-entity capacity evidence, summed across replications as they run.

    Kept OUTSIDE the trace because a trace belongs to one replication and this
    question is asked of the run: "which products did capacity hold back", not
    "which products did capacity hold back in replication 7". Accumulating here
    also means the matrices are never retained — each replication's context is
    discarded as before, and what survives is two float vectors per entity kind.
    """

    def __init__(self, model) -> None:
        self.prod_ids = list(model.prod_ids)
        self.sup_ids = list(model.sup_ids)
        self.prod_bound = np.zeros(model.n_prods)
        self.sup_bound = np.zeros(model.n_sups)
        self.reps = 0
        # `np.inf` is the declared meaning of an empty `capacity_per_week`, so
        # this counts the suppliers that opted OUT of being a constraint.
        self.unlimited_suppliers = int(np.isinf(model.sup_capacity).sum())
        self.finite_capacity = float(
            model.sup_capacity[np.isfinite(model.sup_capacity)].sum()
        )
        self.plant_capacity = float(model.capacity.sum())
        # Not capacity evidence, but the same shape of question — a run-level
        # count summed over replications — so it rides the same observer rather
        # than a second parameter through `_extend_until_ci` (audit F-36).
        self.lt_truncated = np.zeros(model.n_links, dtype=int)
        self.ring_width = int(model.ring_width)
        self.link_ids = [(model.sup_ids[model.link_sup[k]], model.mat_ids[model.link_mat[k]])
                         for k in range(model.n_links)]

    def lead_time_truncations(self) -> list[dict]:
        return [
            {"supplier_id": sid, "material_id": mid, "draws": int(self.lt_truncated[k]),
             "replications": self.reps, "bounded_to_weeks": self.ring_width - 2}
            for k, (sid, mid) in enumerate(self.link_ids) if self.lt_truncated[k] > 0
        ]

    def observe(self, ctx: SimContext, t_w: int, window_end: int) -> None:
        w = slice(t_w, window_end)
        self.lt_truncated += ctx.lt_truncated
        self.prod_bound += ctx.trace.prod_cap_bound[:, w].sum(axis=1)
        self.sup_bound += ctx.trace.sup_cap_bound[:, w].sum(axis=1)
        self.reps += 1

    def summary(self, model, t_w: int, window_end: int) -> dict:
        if self.reps == 0:
            return {}
        n = float(self.reps)
        products = [
            {
                "id": self.prod_ids[i],
                "bound_weeks": round(float(self.prod_bound[i]) / n, 3),
                "capacity": round(float(model.capacity[i]), 4),
            }
            for i in range(len(self.prod_ids))
            if self.prod_bound[i] > 0
        ]
        suppliers = [
            {
                "id": self.sup_ids[i],
                "bound_weeks": round(float(self.sup_bound[i]) / n, 3),
                "capacity": (
                    None if np.isinf(model.sup_capacity[i])
                    else round(float(model.sup_capacity[i]), 4)
                ),
            }
            for i in range(len(self.sup_ids))
            if self.sup_bound[i] > 0
        ]
        products.sort(key=lambda r: (-r["bound_weeks"], r["id"]))
        suppliers.sort(key=lambda r: (-r["bound_weeks"], r["id"]))
        return {
            "window_weeks": int(window_end - t_w),
            "replications": self.reps,
            "products": products,
            "suppliers": suppliers,
            "unlimited_suppliers": self.unlimited_suppliers,
            "finite_supplier_capacity": self.finite_capacity,
            "plant_capacity": self.plant_capacity,
        }


def run_scenario(
    scenario: Scenario,
    debug: bool = False,
    compiled: Optional[CompiledScenario] = None,
    snapshot_store=None,
    progress: Optional[ProgressFn] = None,
) -> ScenarioResult:
    compiled = compiled or compile_scenario(scenario)
    settings = compiled.model.settings
    warmup = compiled.warmup or resolve_warmup(compiled)
    t_w = warmup.adopted_week
    window_end = min(t_w + settings.analysis_window, settings.horizon)

    snapshot_digest = None
    if snapshot_store is not None:
        from scsim.io.snapshots import family_digest
        snapshot_digest = family_digest(scenario)

    grid = replication_grid(
        settings.model_seeds,
        settings.disruption_event_seeds,
        any_stochastic(scenario.events),
    )
    kpis: list[dict[str, float]] = []
    # One [n_reps, horizon] block per PUBLISHED series, keyed by its declared
    # name. This was four separate locals threaded through `_extend_until_ci`'s
    # signature, which is why adding a fifth series meant touching five call
    # sites and is a large part of why `fg_value` never became one (§4 D163).
    rows: dict[str, np.ndarray] = {
        k: np.zeros((len(grid), settings.horizon)) for k in PUBLISHED_SERIES_KEYS
    }
    lp_fallbacks = 0
    cap_acc = _CapacityBindingAccumulator(compiled.model)
    # event index → (authored week, week used). Deterministic per event, so one
    # entry per event whatever the replication count (audit F-03).
    shifts: dict[int, tuple[int, int]] = {}
    for n, (i, j) in enumerate(grid):
        events = resolve_events(compiled.model, t_w, j, shifts) if scenario.events else []
        ctx = run_replication(
            compiled, i, j, events, debug=debug,
            snapshot_store=snapshot_store, snapshot_digest=snapshot_digest, warmup_week=t_w,
        )
        row = compute_replication_kpis(ctx, t_w, window_end, events)
        for pol in compiled.policies:
            row.update(pol.kpi_contribution(ctx, t_w, window_end))
        row["model_rep"], row["event_rep"] = float(i), float(j)
        kpis.append(row)
        for k in PUBLISHED_SERIES_KEYS:
            rows[k][n] = getattr(ctx.trace, k)
        cap_acc.observe(ctx, t_w, window_end)
        lp_fallbacks += int(ctx.policy_state.get("material_allocation", {}).get("lp_fallbacks", 0))
        _notify_progress(progress, n + 1, len(grid), row, ctx)

    # Sequential stopping (optional) extends model seeds until ε is met.
    from scsim.entities.enums import ReplicationStopping
    if settings.replication_stopping == ReplicationStopping.SEQUENTIAL_CI and scenario.events:
        kpis, rows, grid = _extend_until_ci(
            compiled, scenario, kpis, rows, grid, t_w, window_end, debug, progress,
            cap_acc, shifts=shifts,
        )

    # Single-run inspection surface (G17/§9.5.1): expose the full-debug
    # per-item matrices when — and only when — the run is exactly one
    # replication. `ctx` is the sole replication's context here.
    item_series: Optional[dict[str, np.ndarray]] = None
    item_ids: Optional[dict[str, list[str]]] = None
    if (
        settings.trace_verbosity == TraceVerbosity.FULL_DEBUG
        and len(grid) == 1
        and ctx.trace.keep_matrices
    ):
        tr = ctx.trace
        item_series = {
            "material.on_hand": tr.I_mat,
            "material.in_transit": tr.I_transit,
            "material.orders": tr.O_mat,
            "product.demand": tr.D,
            "product.production": tr.Q,
            "product.fulfillment": tr.F,
            "product.backlog": tr.B,
            "product.lost_units": tr.L,
        }
        item_ids = {
            "material": list(compiled.model.mat_ids),
            "product": list(compiled.model.prod_ids),
        }

    keys = sorted({k for row in kpis for k in row} - {"model_rep", "event_rep"})
    aggregates = {
        k: aggregate_mean_ci(np.array([r[k] for r in kpis if k in r]), settings.ci_level)
        for k in keys
    }
    stats = StatisticsReport(
        engine_version=ENGINE_VERSION,
        project_seed=settings.project_seed,
        model_seeds=settings.model_seeds,
        disruption_event_seeds=settings.disruption_event_seeds,
        n_replications=len(grid),
        crn_enabled=settings.crn_enabled,
        run_mode=settings.run_mode,
        warmup=warmup,
        below_replication_floor=settings.below_replication_floor,
        wide_ci_badge=settings.run_mode == RunMode.FAST_SCAN,
    )
    return ScenarioResult(
        name=scenario.name,
        kpis=kpis,
        fr_series=rows["fill_rate"],
        aggregates=aggregates,
        stats=stats,
        feasibility_warnings=compiled.feasibility_warnings,
        rep_cells=grid,
        warmup=warmup,
        lp_fallbacks=lp_fallbacks,
        # Every published series except `fill_rate`, which keeps its own
        # `fr_series` field for the callers that have always read it there.
        extra_series={k: v for k, v in rows.items() if k != "fill_rate"},
        item_series=item_series,
        item_ids=item_ids,
        capacity_binding=cap_acc.summary(compiled.model, t_w, window_end) or None,
        lead_time_truncations=cap_acc.lead_time_truncations(),
        event_shifts=[
            {"event_index": i, "target_id": scenario.events[i].target_id,
             "authored_week": a, "used_week": u, "replications": len(grid)}
            for i, (a, u) in sorted(shifts.items())
        ],
    )


def _extend_until_ci(compiled, scenario, kpis, rows, grid, t_w, window_end, debug,
                     progress: Optional[ProgressFn] = None,
                     cap_acc: Optional["_CapacityBindingAccumulator"] = None,
                     shifts: Optional[dict] = None):
    settings = compiled.model.settings
    e_axis = max({j for _, j in grid}) + 1
    next_i = max({i for i, _ in grid}) + 1
    while next_i < 200:
        fr = np.array([r["fill_rate"] for r in kpis])
        fr = fr[np.isfinite(fr)]
        # No measured fill rate (no demand in the window) → nothing to converge
        # on; extending to 200 replications would change nothing (audit F-08).
        if fr.size == 0 or t_halfwidth(fr, settings.ci_level) <= settings.ci_halfwidth_target:
            break
        batch = []
        for i in range(next_i, min(next_i + 10, 200)):
            for j in range(e_axis):
                batch.append((i, j))
        for (i, j) in batch:
            events = resolve_events(compiled.model, t_w, j, shifts) if scenario.events else []
            ctx = run_replication(compiled, i, j, events, debug=debug)
            row = compute_replication_kpis(ctx, t_w, window_end, events)
            for pol in compiled.policies:
                row.update(pol.kpi_contribution(ctx, t_w, window_end))
            row["model_rep"], row["event_rep"] = float(i), float(j)
            kpis.append(row)
            for k in PUBLISHED_SERIES_KEYS:
                rows[k] = np.vstack([rows[k], getattr(ctx.trace, k)[None, :]])
            # The extension replications are replications: leaving them out
            # would make `bound_weeks` a mean over a denominator that no longer
            # matches the run (`replications` below would disagree with
            # `stats.n_replications`, which is exactly the kind of silent
            # divergence §2.1 `single-source` is about).
            if cap_acc is not None:
                cap_acc.observe(ctx, t_w, window_end)
            # The final total is unknown while extending — report the current
            # count as both done and total so observers see monotone progress.
            _notify_progress(progress, len(kpis), len(kpis), row, ctx)
        grid = grid + batch
        next_i += 10
    return kpis, rows, grid


# ---------------------------------------------------------------------------
# Portfolio study under CRN (deltas vs S0; synergy-ready)
# ---------------------------------------------------------------------------

@dataclass
class PortfolioStudy:
    base_name: str
    s0: ScenarioResult
    portfolios: dict[str, ScenarioResult]
    clean: dict[str, ScenarioResult]               # per-portfolio no-event reference
    deltas: dict[str, dict[str, np.ndarray]]       # name → per-rep ΔR / ΔC / SLA arrays
    portfolio_policies: dict[str, list[str]]       # name → strategy policy ids
    settings_seed: int
    bootstrap_resamples: int
    ci_level: float


def run_portfolio_study(
    scenario: Scenario,
    portfolios: dict[str, dict[str, dict]],
    include_clean_reference: bool = True,
    debug: bool = False,
) -> PortfolioStudy:
    """Run S0 (built-ins only) + each portfolio under CRN; produce per-rep
    paired ΔR (Eq. 25-style) and ΔC^res (Eq. 24-style) plus SLA when the
    clean reference is enabled."""
    if not scenario.events:
        raise ValueError("portfolio study needs at least one disruption event")
    builtins = {
        pid: params for pid, params in scenario.policies.items() if pid in BUILT_IN_POLICY_IDS
    }
    s0_scenario = scenario.with_policies(dict(builtins), name=f"{scenario.name}__S0")

    # Shared warm-up: detect once on S0 (same network/built-ins ⇒ same steady state).
    s0_compiled = compile_scenario(s0_scenario)
    warmup = resolve_warmup(s0_compiled)
    s0 = run_scenario(s0_scenario, debug=debug, compiled=s0_compiled)

    results: dict[str, ScenarioResult] = {}
    clean: dict[str, ScenarioResult] = {}
    deltas: dict[str, dict[str, np.ndarray]] = {}
    settings = scenario.settings

    d_total = s0.kpi_array("demand_value")
    q_s0 = s0.kpi_array("produced_value")
    c_s0 = s0.kpi_array("cost_of_resilience")
    portfolio_policies: dict[str, list[str]] = {}

    for name, policy_set in portfolios.items():
        merged = {**builtins, **policy_set}
        sc = scenario.with_policies(merged, name=f"{scenario.name}__{name}")
        sc_compiled = compile_scenario(sc)
        sc_compiled.warmup = warmup
        res = run_scenario(sc, debug=debug, compiled=sc_compiled)
        results[name] = res
        portfolio_policies[name] = [p for p in policy_set if p not in BUILT_IN_POLICY_IDS]

        q_i = res.kpi_array("produced_value")
        c_i = res.kpi_array("cost_of_resilience")
        if len(q_i) != len(q_s0):
            raise ValueError(
                "replication grids differ between S0 and portfolio runs — keep "
                "replication_stopping='fixed' for portfolio studies (CRN pairing)"
            )
        denom = d_total - q_s0
        delta_r = np.where(np.abs(denom) > 1e-9, (q_i - q_s0) / np.where(denom == 0, 1, denom), 0.0)
        delta_c = np.where(np.abs(c_s0) > 1e-9, 1.0 - c_i / np.where(c_s0 == 0, 1, c_s0), 0.0)
        entry = {"delta_revenue": delta_r, "delta_cost": delta_c}

        if include_clean_reference:
            sc_clean = sc.without_events(name=f"{scenario.name}__{name}__clean")
            cl_compiled = compile_scenario(sc_clean)
            cl_compiled.warmup = warmup
            cl = run_scenario(sc_clean, debug=debug, compiled=cl_compiled)
            clean[name] = cl
            t_w = warmup.adopted_week
            w_end = min(t_w + settings.analysis_window, settings.horizon)
            # CRN pairing: disrupted rep (i, j) shares world streams with the
            # clean rep at the same model seed i (clean grid has event axis 1).
            clean_row_of_model_rep = {cell[0]: r for r, cell in enumerate(cl.rep_cells)}
            sla = np.zeros(len(res.rep_cells))
            for r, (i, _j) in enumerate(res.rep_cells):
                ref = cl.fr_series[clean_row_of_model_rep[i], t_w:w_end]
                gap = ref - res.fr_series[r, t_w:w_end]
                sla[r] = float(np.maximum(gap, 0.0).sum())
            entry["service_loss_area"] = sla
        deltas[name] = entry

    return PortfolioStudy(
        base_name=scenario.name,
        s0=s0,
        portfolios=results,
        clean=clean,
        deltas=deltas,
        portfolio_policies=portfolio_policies,
        settings_seed=settings.project_seed,
        bootstrap_resamples=settings.bootstrap_resamples,
        ci_level=float(settings.ci_level),
    )
