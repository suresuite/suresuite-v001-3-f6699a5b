"""Discrete-time supply chain simulation engine.

Weekly-tick loop: t = 1..T.  Each call to compute_kpis runs N_R independent
Monte Carlo replications and returns mean ± 95% CI for every KPI.

Notation follows the Architecture Reference (see CLAUDE.md / project docs):
  I_m, SR_m, BO_p, Q_p, D_p, SS_m, RP_m, OUL_m, FR(t), C_res, HC, LS, BSC
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import networkx as nx
import numpy as np

from .kpi import ReplicationKpis, aggregate
from .seeds import ReplicationStreams, make_streams

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@dataclass
class SCState:
    I:   dict[str, float]          # on-hand inventory per material m
    SR:  dict[str, list[float]]    # scheduled receipts SR_m[t]
    BO:  dict[str, float]          # backlog per product p
    WIP: dict[str, float]          # work-in-process (reserved for future use)
    disruptions: dict[str, dict]   # sup_id → {start_week, end_week, cap_fraction}
    ts_fill_rate:    list[float] = field(default_factory=list)
    ts_revenue:      list[float] = field(default_factory=list)
    ts_hold_cost:    list[float] = field(default_factory=list)
    ts_lost_sales:   list[float] = field(default_factory=list)
    ts_backlog_cost: list[float] = field(default_factory=list)
    horizon: int = 52
    warmup:  int = 15


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _policy(policies: dict, scope: str, key: str, family: str) -> dict:
    """Merge project-level default with node/edge override; override wins."""
    default = policies.get("default", {}).get(family, {})
    override = policies.get(f"{scope}:{key}", {}).get(family, {})
    return {**default, **override}


def _bom(graph: nx.DiGraph, p_id: str) -> dict[str, float]:
    """Return {m_id: consumption_rate} for product p_id (in-edges typed 'bom')."""
    result: dict[str, float] = {}
    for m_id, _, data in graph.in_edges(p_id, data=True):
        if data.get("edge_type") == "bom" or "consumption_rate" in data:
            result[m_id] = float(data.get("consumption_rate", 1.0))
    return result


def _suppliers(
    graph: nx.DiGraph,
    m_id: str,
    disruptions: dict,
    t: int,
) -> list[dict]:
    """Return [{sup_id, base_lt, lt_std, lt_dist, unit_price, cap_fraction}]."""
    result: list[dict] = []
    for sup_id, _, data in graph.in_edges(m_id, data=True):
        if data.get("edge_type") not in ("supply", None):
            continue
        if graph.nodes.get(sup_id, {}).get("node_type") not in ("supplier", None):
            continue
        dis = disruptions.get(sup_id, {})
        in_window = (
            dis.get("start_week", 0) <= t <= dis.get("end_week", 0)
        ) if dis else False
        cap_frac = float(dis.get("cap_fraction", 1.0)) if in_window else 1.0
        result.append({
            "sup_id": sup_id,
            "base_lt": float(data.get("lead_time", 2.0)),
            "lt_std": float(data.get("lead_time_std", 0.5)),
            "lt_dist": str(data.get("lt_dist", "normal")),
            "unit_price": float(data.get("unit_price", 1.0)),
            "cap_fraction": cap_frac,
        })
    return result


# z-scores for common service levels (one-sided normal)
_Z_TABLE = {
    0.80: 0.842, 0.85: 1.036, 0.90: 1.282, 0.92: 1.405,
    0.95: 1.645, 0.97: 1.881, 0.98: 2.054, 0.99: 2.326,
    0.995: 2.576, 0.999: 3.090,
}


def _z(service_level: float) -> float:
    keys = sorted(_Z_TABLE.keys())
    for k in keys:
        if service_level <= k:
            return _Z_TABLE[k]
    return _Z_TABLE[0.999]


def _sample_lead_time(
    base_lt: float,
    lt_std: float,
    lt_dist: str,
    rng: np.random.Generator,
) -> int:
    """Sample actual lead time in weeks; minimum 1."""
    if lt_dist == "fixed" or lt_std <= 0:
        return max(1, int(round(base_lt)))
    if lt_dist == "normal":
        sampled = float(rng.normal(base_lt, lt_std))
    elif lt_dist == "lognormal":
        sigma2 = math.log(1 + (lt_std / max(base_lt, 1e-9)) ** 2)
        mu = math.log(max(base_lt, 1e-9)) - sigma2 / 2
        sampled = float(rng.lognormal(mu, math.sqrt(sigma2)))
    elif lt_dist == "triangular":
        lo = max(0.5, base_lt - 2 * lt_std)
        hi = base_lt + 2 * lt_std
        sampled = float(rng.triangular(lo, base_lt, hi))
    elif lt_dist == "uniform":
        lo = max(0.5, base_lt - lt_std)
        hi = base_lt + lt_std
        sampled = float(rng.uniform(lo, hi))
    else:
        sampled = float(rng.normal(base_lt, lt_std))
    return max(1, int(round(sampled)))


def _demand_t(
    graph: nx.DiGraph,
    p_id: str,
    t: int,
    demand_pol: dict,
    rng: np.random.Generator,
) -> float:
    """Sample weekly demand D_p(t) = mean_demand × δ_p(t) × noise."""
    node = graph.nodes.get(p_id, {})
    mean_d = float(node.get("weekly_demand", demand_pol.get("mean_demand", 100.0)))

    season: list = demand_pol.get("seasonality_profile", [])
    factor = float(season[(t - 1) % 52]) if len(season) == 52 else 1.0

    cv = float(demand_pol.get("cv", 0.15))
    dist = demand_pol.get("distribution", "normal")
    scaled = mean_d * factor
    if scaled <= 0 or dist == "constant" or cv <= 0:
        return max(0.0, scaled)
    if dist == "poisson":
        return float(rng.poisson(max(0.01, scaled)))
    # normal (default)
    return max(0.0, float(rng.normal(scaled, cv * scaled)))


def _weekly_material_demand(graph: nx.DiGraph, m_id: str) -> float:
    """Average weekly demand for material m (sum over downstream products × BOM)."""
    total = 0.0
    for _, p_id, data in graph.out_edges(m_id, data=True):
        if data.get("edge_type") == "bom" or "consumption_rate" in data:
            d = float(graph.nodes.get(p_id, {}).get("weekly_demand", 100.0))
            c = float(data.get("consumption_rate", 1.0))
            total += d * c
    return total or float(graph.nodes.get(m_id, {}).get("weekly_demand", 100.0))


# ---------------------------------------------------------------------------
# Step functions
# ---------------------------------------------------------------------------

def _receive_arrivals(state: SCState, t: int) -> None:
    """SR_m(t) lands into I_m."""
    for m_id, sr in state.SR.items():
        if t < len(sr) and sr[t] > 0:
            state.I[m_id] = state.I.get(m_id, 0.0) + sr[t]
            sr[t] = 0.0


def _production_step(
    graph: nx.DiGraph,
    state: SCState,
    policies: dict,
    p_id: str,
    D_p: float,
    t: int,
    misc_rng: np.random.Generator,
) -> tuple[float, float, float]:
    """Produce Q_p, consume materials.  Returns (Q_p, revenue_t, lost_sales_t)."""
    node = graph.nodes.get(p_id, {})
    prod_pol = _policy(policies, "node", p_id, "production")
    fulfill_pol = _policy(policies, "node", p_id, "fulfillment")

    backlog_allowed = bool(fulfill_pol.get("backorder_allowed", True))
    total_demand = D_p + state.BO.get(p_id, 0.0)

    # Weekly capacity (S3: utilization_cap_pct = 100 → full capacity)
    cap_day = float(prod_pol.get("capacity_units_per_day", node.get("capacity_units_per_day", 1000.0)))
    util_cap = float(prod_pol.get("utilization_cap_pct", 85.0)) / 100.0
    weekly_cap = cap_day * 7.0 * util_cap
    yield_rate = float(prod_pol.get("yield_rate", node.get("yield_rate", 1.0)))
    if yield_rate <= 0:
        yield_rate = 1.0

    # Material-limited feasible output
    bom = _bom(graph, p_id)
    if bom:
        mat_limits = [
            state.I.get(m_id, 0.0) / max(c / yield_rate, 1e-9)
            for m_id, c in bom.items()
        ]
        Q_possible = min(weekly_cap, min(mat_limits))
    else:
        Q_possible = weekly_cap

    Q_p = min(total_demand, max(0.0, Q_possible))

    for m_id, c in bom.items():
        consume = (c / yield_rate) * Q_p
        state.I[m_id] = max(0.0, state.I.get(m_id, 0.0) - consume)

    unit_price = float(node.get("unit_price", 1.0))
    revenue_t = Q_p * unit_price
    unfulfilled = total_demand - Q_p
    if backlog_allowed:
        state.BO[p_id] = max(0.0, unfulfilled)
        lost_sales_t = 0.0
    else:
        state.BO[p_id] = 0.0
        lost_sales_t = max(0.0, unfulfilled) * unit_price

    return Q_p, revenue_t, lost_sales_t


def _place_order(
    state: SCState,
    m_id: str,
    supplier: dict,
    qty: float,
    t: int,
    lt_rng: np.random.Generator,
) -> None:
    if qty <= 0:
        return
    actual_lt = _sample_lead_time(
        supplier["base_lt"], supplier["lt_std"], supplier["lt_dist"], lt_rng
    )
    arrival = t + actual_lt
    sr = state.SR.setdefault(m_id, [0.0] * (state.horizon + actual_lt + 10))
    while arrival >= len(sr):
        sr.extend([0.0] * 10)
    sr[arrival] += qty


def _inventory_review(
    graph: nx.DiGraph,
    state: SCState,
    policies: dict,
    m_id: str,
    t: int,
    lt_rng: np.random.Generator,
) -> float:
    """Review inventory position; place order if IP_m < RP_m. Returns HC_m(t)."""
    inv_pol = _policy(policies, "node", m_id, "inventory")
    sourcing_pol = _policy(policies, "node", m_id, "sourcing")
    recovery_pol = _policy(policies, "default", "", "recovery")

    I_m = state.I.get(m_id, 0.0)
    hc_rate = float(inv_pol.get("holding_cost_pct", 0.20)) / 52.0
    hold_cost = I_m * hc_rate

    # Inventory position
    sr = state.SR.get(m_id, [])
    IP = I_m + sum(sr)

    suppliers = _suppliers(graph, m_id, state.disruptions, t)
    avg_lt = suppliers[0]["base_lt"] if suppliers else 2.0
    lt_std = suppliers[0]["lt_std"] if suppliers else 0.5

    avg_d = _weekly_material_demand(graph, m_id)
    cv = float(inv_pol.get("cv", 0.15))

    # Safety stock
    sl_target = float(inv_pol.get("service_level_alpha", inv_pol.get("service_level_target", 0.95)))
    ss_method = inv_pol.get("safety_stock_method", "fixed_days")
    if ss_method == "service_level":
        z = _z(sl_target)
        demand_std = cv * avg_d
        ss = z * math.sqrt(avg_lt * demand_std ** 2 + avg_d ** 2 * lt_std ** 2)
    elif ss_method == "king_method":
        z = _z(sl_target)
        demand_std = cv * avg_d
        ss = z * demand_std * math.sqrt(avg_lt) + z * avg_d * lt_std
    else:  # fixed_days (default)
        ss_days = float(inv_pol.get("safety_stock_days", 7.0))
        ss = avg_d * ss_days / 7.0

    RP = avg_lt * avg_d + ss

    inv_type = inv_pol.get("type", "min_max")
    review_days = int(inv_pol.get("review_period_days", 7))
    review_weeks = max(1, review_days // 7)
    continuous = inv_type in ("continuous_review", "s_S")
    if not continuous and t % review_weeks != 0:
        return hold_cost

    if IP >= RP:
        return hold_cost

    OUL_raw = inv_pol.get("order_up_to_level", inv_pol.get("order_up_to", None))
    OUL = float(OUL_raw) if OUL_raw is not None else RP * 2.0
    MOQ = float(inv_pol.get("moq", 0.0))
    OQ = max(OUL - IP, MOQ)
    if OQ <= 0:
        return hold_cost

    if not suppliers:
        return hold_cost

    strategy = sourcing_pol.get("strategy", "single")
    response: list = recovery_pol.get("response", [])

    # S5 expediting reduces lead time (expedite_freight is an alias for mode_shift)
    def _expedite(sup: dict) -> dict:
        if "mode_shift" in response or "expedite_freight" in response:
            return dict(sup, base_lt=max(1, sup["base_lt"] * 0.5), lt_std=0.0)
        return sup

    active = [s for s in suppliers if s["cap_fraction"] > 0]
    if not active:
        return hold_cost

    # S1 Backup supplier
    if strategy == "primary_backup" or "dual_source_activate" in response:
        primary_ok = suppliers[0]["cap_fraction"] > 0
        chosen = suppliers[0] if primary_ok else (suppliers[1] if len(suppliers) > 1 else suppliers[0])
        _place_order(state, m_id, _expedite(chosen), OQ * chosen["cap_fraction"], t, lt_rng)

    elif strategy in ("dual_sourcing", "multi") and len(active) > 1:
        ratios_raw = sourcing_pol.get("ratios", {})
        ratio_vals = list(ratios_raw.values()) if ratios_raw else [1.0 / len(active)] * len(active)
        for i, sup in enumerate(active[:len(ratio_vals)]):
            ratio = float(ratio_vals[i]) if i < len(ratio_vals) else 1.0 / len(active)
            _place_order(state, m_id, _expedite(sup), OQ * ratio * sup["cap_fraction"], t, lt_rng)

    else:
        _place_order(state, m_id, _expedite(active[0]), OQ * active[0]["cap_fraction"], t, lt_rng)

    return hold_cost


# ---------------------------------------------------------------------------
# Replication loop
# ---------------------------------------------------------------------------

def _resolve_node_id(graph: nx.DiGraph, target: str) -> str | None:
    """Map a raw disruption target string to a graph node ID.

    Tries exact match first, then prefixed forms (supplier:X, material:X, etc.).
    """
    if target in graph.nodes:
        return target
    for prefix in ("supplier", "material", "product", "customer"):
        candidate = f"{prefix}:{target}"
        if candidate in graph.nodes:
            return candidate
    # Substring match as last resort
    for node in graph.nodes:
        if node.endswith(f":{target}") or node == target:
            return node
    return None


def _init_state(
    graph: nx.DiGraph,
    policies: dict,
    horizon: int,
    warmup: int,
    disruption_schedule: list[dict] | None = None,
) -> SCState:
    materials = [n for n, d in graph.nodes(data=True) if d.get("node_type") == "material"]
    products  = [n for n, d in graph.nodes(data=True) if d.get("node_type") == "product"]

    I: dict[str, float] = {}
    for m_id in materials:
        inv_pol = _policy(policies, "node", m_id, "inventory")
        ss_days = float(inv_pol.get("safety_stock_days", 7.0))
        avg_d = _weekly_material_demand(graph, m_id)
        I[m_id] = avg_d * ss_days / 7.0

    SR: dict[str, list[float]] = {m: [0.0] * (horizon + 15) for m in materials}
    BO: dict[str, float] = {p: 0.0 for p in products}

    # Build time-windowed disruption dict from graph attributes (apply_delta path)
    disruptions: dict[str, dict] = {}
    for n, data in graph.nodes(data=True):
        mag = float(data.get("_disruption", 0))
        if mag > 0:
            disruptions[n] = {
                "start_week": 1,
                "end_week": horizon,
                "cap_fraction": max(0.0, 1.0 - mag / 100.0),
            }

    # Overlay explicit time-windowed entries from the scenario disruption_schedule.
    # These override the static _disruption attribute with proper start/end weeks.
    for entry in (disruption_schedule or []):
        target = str(entry.get("target", ""))
        node_id = _resolve_node_id(graph, target)
        if node_id is None:
            continue
        start_day = float(entry.get("start_day", 0))
        duration_days = float(entry.get("duration_days", 7))
        magnitude_pct = float(entry.get("magnitude_pct", 0))
        start_week = max(1, int(start_day / 7))
        end_week   = min(horizon, int((start_day + duration_days) / 7))
        cap_fraction = max(0.0, 1.0 - magnitude_pct / 100.0)
        # Last entry for a node wins if there are multiple; combine by picking worst
        existing = disruptions.get(node_id)
        if existing:
            cap_fraction = min(cap_fraction, existing.get("cap_fraction", 1.0))
        disruptions[node_id] = {
            "start_week": start_week,
            "end_week": end_week,
            "cap_fraction": cap_fraction,
        }

    return SCState(
        I=I, SR=SR, BO=BO, WIP={},
        disruptions=disruptions,
        horizon=horizon,
        warmup=warmup,
    )


def _one_rep(
    graph: nx.DiGraph,
    policies: dict,
    n_weeks: int,
    warmup: int,
    streams: ReplicationStreams,
    disruption_schedule: list[dict] | None = None,
) -> dict[str, float]:
    state = _init_state(graph, policies, n_weeks, warmup, disruption_schedule)

    products  = [n for n, d in graph.nodes(data=True) if d.get("node_type") == "product"]
    materials = [n for n, d in graph.nodes(data=True) if d.get("node_type") == "material"]

    # S4 allocation: pre-sort once (stable across weeks)
    fulfill_def = policies.get("default", {}).get("fulfillment", {})
    if fulfill_def.get("allocation") == "revenue_max":
        products = sorted(
            products,
            key=lambda p: float(graph.nodes.get(p, {}).get("unit_price", 1.0)),
            reverse=True,
        )

    for t in range(1, n_weeks + 1):
        _receive_arrivals(state, t)

        # Sample all demands this week first (demand stream for CRN)
        demands: dict[str, float] = {
            p: _demand_t(graph, p, t, _policy(policies, "node", p, "demand"), streams.demand)
            for p in products
        }

        total_dval = sum(
            demands[p] * float(graph.nodes.get(p, {}).get("unit_price", 1.0))
            for p in products
        )
        total_pval = 0.0
        total_rev_t = 0.0
        total_ls_t = 0.0

        for p_id in products:
            Q_p, rev_t, ls_t = _production_step(
                graph, state, policies, p_id, demands[p_id], t, streams.misc
            )
            total_pval += Q_p * float(graph.nodes.get(p_id, {}).get("unit_price", 1.0))
            total_rev_t += rev_t
            total_ls_t += ls_t

        fr_t = min(1.0, total_pval / total_dval) if total_dval > 0 else 1.0
        state.ts_fill_rate.append(fr_t)
        state.ts_revenue.append(total_rev_t)
        state.ts_lost_sales.append(total_ls_t)

        total_hc_t = 0.0
        for m_id in materials:
            total_hc_t += _inventory_review(graph, state, policies, m_id, t, streams.lead_time)

        bc_per_day = float(fulfill_def.get("backorder_cost_per_day", 2.0))
        total_bc_t = sum(state.BO.values()) * bc_per_day * 7.0

        state.ts_hold_cost.append(total_hc_t)
        state.ts_backlog_cost.append(total_bc_t)

    return _extract_kpis(state)


def _extract_kpis(state: SCState) -> dict[str, float]:
    w = state.warmup

    def _mean(ts: list[float]) -> float:
        post = ts[w:]
        return sum(post) / len(post) if post else 0.0

    def _total(ts: list[float]) -> float:
        return sum(ts[w:])

    fr   = _mean(state.ts_fill_rate)
    rev  = _total(state.ts_revenue)
    hc   = _total(state.ts_hold_cost)
    ls   = _total(state.ts_lost_sales)
    bc   = _total(state.ts_backlog_cost)

    return {
        "fill_rate": fr,
        "revenue":   rev,
        "hold_cost": hc,
        "lost_sales": ls,
        "backlog_cost": bc,
        "cost_of_resilience": hc + bc + ls,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_delta(graph: nx.DiGraph, payload: dict[str, Any]) -> set[str]:
    """Mutate node disruption attributes; return dirty node set."""
    lever = payload.get("lever", "disruption.global")
    magnitude = float(payload.get("magnitude", 0))
    dirty: set[str] = set()

    if lever == "disruption.global":
        for n in graph.nodes:
            graph.nodes[n]["_disruption"] = magnitude
            dirty.add(n)
    elif lever.startswith("node:"):
        node_id = lever.split(":", 1)[1]
        if node_id in graph.nodes:
            graph.nodes[node_id]["_disruption"] = magnitude
            dirty.add(node_id)
            dirty.update(nx.descendants(graph, node_id))
    return dirty


KPI_KEYS = ["fill_rate", "revenue", "hold_cost", "lost_sales", "backlog_cost", "cost_of_resilience"]


def compute_kpis(
    graph: nx.DiGraph,
    dirty: set[str],
    policies: dict | None = None,
    n_weeks: int = 52,
    seed: int = 42,
    n_reps: int = 30,
    disruption_schedule: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Run N_R Monte Carlo replications of the weekly-tick loop.

    Returns a dict with mean_X and ci_X for every KPI key, plus
    back-compat aliases (fill_rate, revenue) for the existing broadcast format.
    Falls back to an analytical stub when the graph has no typed nodes
    (keeps the worker functional before real data is loaded).

    disruption_schedule: list of {target, target_type, start_day, duration_days, magnitude_pct}
      entries from the scenarios table. Takes precedence over static _disruption graph attributes.
    """
    if policies is None:
        policies = {}

    node_types = {d.get("node_type") for _, d in graph.nodes(data=True)}
    if not (node_types & {"product", "material", "supplier"}):
        return _analytical_fallback(graph, dirty)

    warmup = min(15, n_weeks // 4)
    rep_streams = make_streams(seed, n_reps)
    reps = [
        _one_rep(graph, policies, n_weeks, warmup, streams, disruption_schedule)
        for streams in rep_streams
    ]

    agg = aggregate(reps, KPI_KEYS)

    result: dict[str, Any] = {
        "source": "worker",
        "n_reps": n_reps,
        "dirty_nodes": len(dirty),
    }
    for k, stats in agg.items():
        result[f"mean_{k}"] = round(stats["mean"], 4)
        result[f"ci_{k}"]   = round(stats["ci95"], 4)
        result[f"min_{k}"]  = round(stats["min"],  4)
        result[f"max_{k}"]  = round(stats["max"],  4)

    # Back-compat aliases consumed by existing broadcast handler
    result["fill_rate"] = result.get("mean_fill_rate", 0.0)
    result["otif"]      = result.get("mean_fill_rate", 0.0)   # proxy until OTIF tracked
    result["revenue"]   = result.get("mean_revenue", 0.0)
    result["lead_time_days"] = 7.0  # TODO: track actual lead times in state

    return result


def _analytical_fallback(graph: nx.DiGraph, dirty: set[str]) -> dict[str, Any]:
    """Cheap stub for empty / untyped graphs — identical to original Phase 1 engine."""
    n_nodes = max(graph.number_of_nodes(), 1)
    avg_disruption = (
        sum(float(graph.nodes[n].get("_disruption", 0)) for n in graph.nodes) / n_nodes
    )
    k = math.tanh(avg_disruption / 100.0)
    return {
        "fill_rate": round(0.94 - 0.18 * k, 4),
        "otif":      round(0.91 - 0.22 * k, 4),
        "revenue":   round(1_000_000 * (1 - 0.27 * k)),
        "lead_time_days": round(7.2 + 4.5 * k, 2),
        "co2_kg":    round(12_400 * (1 + 0.18 * k)),
        "source":    "worker",
        "dirty_nodes": len(dirty),
    }
