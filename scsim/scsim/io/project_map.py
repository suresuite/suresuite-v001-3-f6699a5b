"""Canonical SureSuite-project → scsim Scenario mapper (single source of truth).

This module is the ONE place that turns a project's stored data (item masters +
logistics + merged policies + scenario settings) into an scsim ``Scenario``. It
is pure and Supabase-agnostic: callers (the Fly worker) fetch rows and populate
the typed :class:`ProjectData`; this module applies the documented reducers,
unit normalization, defaults, and emits a structured :class:`MappingWarning`
list so nothing is ever silently wrong.

The human-readable contract lives in ``docs/data-simulation-mapping.md`` — keep
the two in sync. Economics (material cost, product price, capacity, MOQ, …) come
from the item-master rows first; logistics/policy values are only fallbacks, and
every fallback is recorded as a warning.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from scsim.entities.config import SimulationSettings
from scsim.entities.disruption import DisruptionEvent
from scsim.entities.enums import (
    DemandModel,
    EffectType,
    FulfillmentMode,
    LeadTimeDist,
    ReplicationStopping,
    TargetType,
    WarmupMethod,
)
from scsim.entities.network import (
    BomLine,
    Customer,
    Material,
    Network,
    Product,
    Supplier,
    SupplierLink,
    triangular_av,
)
from scsim.entities.scenario import Scenario

# ── Time-unit normalization ───────────────────────────────────────────────────
# Everything in scsim is weekly. A duration of N units → weeks; a quantity per
# unit-period → quantity per week (the inverse).
_UNIT_DAYS = {
    "day": 1.0, "days": 1.0, "d": 1.0,
    "week": 7.0, "weeks": 7.0, "wk": 7.0, "w": 7.0,
    "month": 30.4375, "months": 30.4375, "mo": 30.4375, "m": 30.4375,
    "year": 365.25, "years": 365.25, "yr": 365.25, "y": 365.25,
}
_DEFAULT_CV = 0.30  # triangularAV variability when none supplied


def _unit_days(unit: Optional[str]) -> Optional[float]:
    if not unit:
        return None
    return _UNIT_DAYS.get(str(unit).strip().lower())


def _duration_to_weeks(value: float, unit: Optional[str], default_days: float = 7.0) -> float:
    days = _unit_days(unit) or default_days
    return float(value) * days / 7.0


def _rate_to_weekly(value: float, unit: Optional[str], default_days: float = 7.0) -> float:
    days = _unit_days(unit) or default_days
    return float(value) * 7.0 / days


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ── Typed, Supabase-agnostic input ────────────────────────────────────────────

@dataclass
class SupplierRow:
    id: str
    name: Optional[str] = None
    capacity_per_week: Optional[float] = None  # None = ∞
    reliability_score: float = 1.0


@dataclass
class MaterialRow:
    id: str
    name: Optional[str] = None
    cost: Optional[float] = None               # c_m (master); else primary supplier link
    holding_cost_pct: Optional[float] = None   # fraction, e.g. 0.20
    moq: Optional[float] = None
    initial_on_hand: Optional[float] = None
    lead_time_dist: Optional[str] = None
    lead_time_cv: Optional[float] = None


@dataclass
class ProductRow:
    id: str
    name: Optional[str] = None
    sell_price: Optional[float] = None         # u_p (master); else demand-weighted outbound price
    production_capacity: Optional[float] = None  # units/week (master); else policy
    fulfillment_mode: Optional[str] = None     # else project supply_chain_model
    demand_distribution: Optional[str] = None  # else scenario demand_model
    demand_mean: Optional[float] = None        # b_p (master); else Σ outbound volume
    demand_cv: Optional[float] = None


@dataclass
class SupplyArc:
    """inbound_logistics row: supplier → material."""
    supplier_id: str
    material_id: str
    unit_price: Optional[float] = None  # c_{m,s}
    lead_time: Optional[float] = None
    lead_time_unit: Optional[str] = None  # falls back to time_unit
    time_unit: Optional[str] = None
    volume: Optional[float] = None


@dataclass
class BomArc:
    product_id: str
    material_id: str
    consumption_rate: float = 1.0


@dataclass
class OutboundArc:
    """outbound_logistics row: product → customer (demand + price fallback)."""
    product_id: str
    customer_id: str
    unit_price: Optional[float] = None
    volume: Optional[float] = None
    time_unit: Optional[str] = None


@dataclass
class ScenarioSettings:
    horizon_days: int = 1092          # ~156 weeks
    warmup_mode: str = "auto"         # auto | manual
    warmup_days: int = 105            # ~15 weeks
    replications: int = 30
    seed: int = 42
    crn: bool = True
    ci_level: int = 95
    demand_model: Optional[dict] = None      # {"kind": "...", "lambda"/"cv": ...}
    disruption_schedule: list[dict] = field(default_factory=list)
    stopping_rule: Optional[dict] = None     # {"kind": "fixed_horizon"|"sequential_ci", "epsilon": ...}
    name: str = "scenario"


@dataclass
class ProjectData:
    suppliers: list[SupplierRow] = field(default_factory=list)
    materials: list[MaterialRow] = field(default_factory=list)
    products: list[ProductRow] = field(default_factory=list)
    supply_arcs: list[SupplyArc] = field(default_factory=list)
    bom: list[BomArc] = field(default_factory=list)
    outbound: list[OutboundArc] = field(default_factory=list)
    customers: list[str] = field(default_factory=list)
    policies: dict[str, Any] = field(default_factory=dict)   # {"default": {...}, "node:<id>": {...}}
    scenario: ScenarioSettings = field(default_factory=ScenarioSettings)
    project_model: Optional[str] = None  # projects.supply_chain_model


# ── Structured warnings ───────────────────────────────────────────────────────

@dataclass
class MappingWarning:
    level: Literal["info", "warn", "error"]
    entity: str
    field: str
    reason: str

    def as_dict(self) -> dict:
        return {"level": self.level, "entity": self.entity, "field": self.field, "reason": self.reason}


@dataclass
class MappingResult:
    scenario: Scenario
    warnings: list[MappingWarning] = field(default_factory=list)

    @property
    def warning_dicts(self) -> list[dict]:
        return [w.as_dict() for w in self.warnings]


# ── Policy & demand helpers ───────────────────────────────────────────────────

def _merged_policy(policies: dict, node_id: str, family: str) -> dict:
    default = (policies.get("default") or {}).get(family) or {}
    override = (policies.get(f"node:{node_id}") or {}).get(family) or {}
    return {**default, **override}


def _fulfillment_mode(raw: Optional[str], project_model: Optional[str]) -> FulfillmentMode:
    token = (raw or project_model or "").strip().lower().replace("-", "_").replace(" ", "_")
    if token in ("mts", "make_to_stock"):
        return FulfillmentMode.MTS
    if token in ("ato", "assemble_to_order"):
        return FulfillmentMode.ATO
    return FulfillmentMode.MTO


def _resolve_demand_kind(product_dist: Optional[str], scenario_model: Optional[dict]) -> str:
    if product_dist:
        return str(product_dist).strip().lower()
    if scenario_model and scenario_model.get("kind"):
        return str(scenario_model["kind"]).strip().lower()
    return "triangular"


def _negbin_k(mean: float, cv: float) -> float:
    if mean <= 0 or cv <= 0:
        return 1.0
    var = (cv * mean) ** 2
    if var <= mean:           # under-dispersed → push toward Poisson
        return 1e6
    return max(1e-3, mean * mean / (var - mean))


def _build_product(
    row: ProductRow, *, price: float, capacity: float, mode: FulfillmentMode,
    mean: float, cv: float, kind: str, warnings: list[MappingWarning],
) -> Product:
    common = dict(
        id=row.id, name=str(row.name or row.id),
        unit_price=max(price, 1e-9), production_capacity=max(capacity, 1e-6),
        fulfillment_mode=mode,
    )
    if kind in ("triangular", "triangular_av", "triangularav", ""):
        a, b, c = triangular_av(max(mean, 0.0), max(cv, 0.0))
        return Product(demand_model=DemandModel.TRIANGULAR,
                       demand_mode=b, demand_min=a, demand_max=c, **common)
    if kind == "deterministic":
        return Product(demand_model=DemandModel.DETERMINISTIC, demand_mode=mean, **common)
    if kind == "poisson":
        return Product(demand_model=DemandModel.POISSON, demand_mode=mean, **common)
    if kind == "negbin":
        return Product(demand_model=DemandModel.NEGBIN, demand_mode=mean,
                       negbin_dispersion=_negbin_k(mean, cv), **common)
    # bootstrap (needs history we don't have) / unknown → triangularAV fallback
    warnings.append(MappingWarning("warn", f"product:{row.id}", "demand_distribution",
                                   f"demand kind {kind!r} unsupported here — using triangularAV"))
    a, b, c = triangular_av(max(mean, 0.0), max(cv, 0.0))
    return Product(demand_model=DemandModel.TRIANGULAR,
                   demand_mode=b, demand_min=a, demand_max=c, **common)


# ── Main entry point ──────────────────────────────────────────────────────────

def from_project_data(data: ProjectData) -> MappingResult:
    """Map a project's stored data into an scsim Scenario + mapping warnings.

    Implements the canonical reducers/units/defaults of
    ``docs/data-simulation-mapping.md``. Pure and deterministic.
    """
    w: list[MappingWarning] = []
    sc = data.scenario

    mat_ids = {m.id for m in data.materials}
    prod_ids = {p.id for p in data.products}
    sup_ids = {s.id for s in data.suppliers}

    # ── Supplier links (per supplier×material) + per-material cheapest cost ──
    links: list[SupplierLink] = []
    cheapest_cost: dict[str, float] = {}
    mat_lt_dist = {m.id: m for m in data.materials}
    for arc in data.supply_arcs:
        if arc.material_id not in mat_ids:
            continue
        sup_ids.add(arc.supplier_id)
        cost = float(arc.unit_price or 0.0)
        if cost <= 0:
            cost = 1.0
            w.append(MappingWarning("warn", f"supply:{arc.supplier_id}->{arc.material_id}",
                                    "cost", "missing inbound unit_price → defaulted to 1.0"))
        lt_unit = arc.lead_time_unit or arc.time_unit
        lt_weeks = _duration_to_weeks(arc.lead_time, lt_unit) if arc.lead_time else 2.0
        if not arc.lead_time:
            w.append(MappingWarning("warn", f"supply:{arc.supplier_id}->{arc.material_id}",
                                    "lead_time", "missing lead_time → defaulted to 2 weeks"))
        mrow = mat_lt_dist.get(arc.material_id)
        links.append(SupplierLink(
            supplier_id=arc.supplier_id, material_id=arc.material_id,
            cost=cost, lead_time_weeks=int(_clamp(round(lt_weeks), 1, 51)),
            lead_time_dist=LeadTimeDist((mrow.lead_time_dist or "deterministic")) if mrow and mrow.lead_time_dist else LeadTimeDist.DETERMINISTIC,
            lead_time_cv=float(mrow.lead_time_cv) if mrow and mrow.lead_time_cv else 0.0,
            moq=float(mrow.moq) if mrow and mrow.moq else 0.0,
        ))
        cheapest_cost[arc.material_id] = min(cheapest_cost.get(arc.material_id, cost), cost)

    # BOM materials with no source link cannot be simulated.
    bom_mat_ids = {b.material_id for b in data.bom if b.product_id in prod_ids}
    unsourced = bom_mat_ids - cheapest_cost.keys()
    if unsourced:
        raise ValueError(f"materials with no supplier link: {sorted(unsourced)}")

    # ── Demand-weighted product price + weekly demand from outbound ──
    out_price_num: dict[str, float] = {}
    out_price_den: dict[str, float] = {}
    out_demand: dict[str, float] = {}
    customers: set[str] = set(data.customers)
    for o in data.outbound:
        customers.add(o.customer_id)
        weekly = _rate_to_weekly(float(o.volume or 0.0), o.time_unit)
        out_demand[o.product_id] = out_demand.get(o.product_id, 0.0) + weekly
        if o.unit_price:
            wgt = max(weekly, 1e-9)
            out_price_num[o.product_id] = out_price_num.get(o.product_id, 0.0) + float(o.unit_price) * wgt
            out_price_den[o.product_id] = out_price_den.get(o.product_id, 0.0) + wgt

    # ── Suppliers ──
    sup_master = {s.id: s for s in data.suppliers}
    suppliers = [
        Supplier(
            id=sid,
            name=str((sup_master.get(sid) or SupplierRow(sid)).name or sid),
            capacity_per_week=(sup_master.get(sid).capacity_per_week if sid in sup_master else None),
            reliability_score=float((sup_master.get(sid) or SupplierRow(sid)).reliability_score or 1.0),
        )
        for sid in sorted(sup_ids)
    ]
    cap_by_sup = {s.id: s.capacity_per_week for s in suppliers}

    # ── Materials ──
    materials: list[Material] = []
    for m in data.materials:
        inv = _merged_policy(data.policies, m.id, "inventory")
        if m.cost and m.cost > 0:
            cost = float(m.cost)
        elif m.id in cheapest_cost:
            cost = cheapest_cost[m.id]
            w.append(MappingWarning("info", f"material:{m.id}", "cost",
                                    "no master cost → using cheapest supplier price"))
        else:
            cost = 1.0
            w.append(MappingWarning("warn", f"material:{m.id}", "cost",
                                    "no master cost and no supplier price → defaulted to 1.0"))
        hold_pct = m.holding_cost_pct if m.holding_cost_pct is not None else inv.get("holding_cost_pct")
        holding = _clamp(float(hold_pct) * 100.0, 5.0, 50.0) if hold_pct is not None else 20.0
        materials.append(Material(
            id=m.id, name=str(m.name or m.id), cost=cost, holding_cost_rate=holding,
            initial_on_hand=(float(m.initial_on_hand) if m.initial_on_hand is not None else None),
        ))
    # Materials referenced only by BOM but lacking a master row.
    for mid in sorted(bom_mat_ids - {m.id for m in materials}):
        materials.append(Material(id=mid, name=mid, cost=cheapest_cost.get(mid, 1.0)))

    # ── Products ──
    products: list[Product] = []
    for p in data.products:
        prod_pol = _merged_policy(data.policies, p.id, "production")
        # price
        if p.sell_price and p.sell_price > 0:
            price = float(p.sell_price)
        elif out_price_den.get(p.id):
            price = out_price_num[p.id] / out_price_den[p.id]
            w.append(MappingWarning("info", f"product:{p.id}", "unit_price",
                                    "no master sell_price → demand-weighted outbound price"))
        else:
            price = 1.0
            w.append(MappingWarning("warn", f"product:{p.id}", "unit_price",
                                    "no sell_price and no outbound price → defaulted to 1.0"))
        # demand mean
        if p.demand_mean and p.demand_mean > 0:
            mean = float(p.demand_mean)
        else:
            mean = out_demand.get(p.id, 0.0)
            if mean <= 0:
                w.append(MappingWarning("warn", f"product:{p.id}", "demand_mean",
                                        "no master demand_mean and no outbound volume → 0"))
        # capacity
        if p.production_capacity and p.production_capacity > 0:
            cap = float(p.production_capacity)
        elif prod_pol.get("capacity_units_per_day"):
            util = float(prod_pol.get("utilization_cap_pct", 85.0)) / 100.0
            cap = float(prod_pol["capacity_units_per_day"]) * 7.0 * util
            w.append(MappingWarning("info", f"product:{p.id}", "production_capacity",
                                    "no master capacity → derived from production policy"))
        else:
            cap = max(mean * 2.0, 1000.0)
            w.append(MappingWarning("warn", f"product:{p.id}", "production_capacity",
                                    "no capacity source → defaulted (capacity will not bind)"))
        mode = _fulfillment_mode(p.fulfillment_mode, data.project_model)
        cv = float(p.demand_cv) if p.demand_cv is not None else (
            float((sc.demand_model or {}).get("cv")) if (sc.demand_model or {}).get("cv") is not None else _DEFAULT_CV
        )
        kind = _resolve_demand_kind(p.demand_distribution, sc.demand_model)
        products.append(_build_product(p, price=price, capacity=cap, mode=mode,
                                       mean=mean, cv=cv, kind=kind, warnings=w))
    if not products:
        raise ValueError("project has no products to simulate")

    bom = [BomLine(product_id=b.product_id, material_id=b.material_id,
                   rate=float(b.consumption_rate or 1.0))
           for b in data.bom if b.product_id in {p.id for p in products}]

    network = Network(
        suppliers=suppliers, materials=materials, products=products,
        bom=bom, supplier_links=links,
        customers=[Customer(id=c, name=c) for c in sorted(customers)],
    )

    settings = _build_settings(sc, w)
    events = _map_events(sc.disruption_schedule, sup_ids, cap_by_sup, w)
    policies = _map_policies(data.policies, w)

    scenario = Scenario(name=sc.name or "scenario", network=network,
                        settings=settings, events=events, policies=policies)
    return MappingResult(scenario=scenario, warnings=w)


def _build_settings(sc: ScenarioSettings, w: list[MappingWarning]) -> SimulationSettings:
    horizon = int(_clamp(round(sc.horizon_days / 7.0), 52, 520))
    if sc.horizon_days / 7.0 < 52:
        w.append(MappingWarning("info", "scenario", "horizon",
                                f"horizon raised to engine floor of 52 weeks"))
    kwargs: dict[str, Any] = dict(
        project_seed=int(sc.seed), horizon=horizon,
        model_seeds=int(_clamp(sc.replications, 1, 200)),
        crn_enabled=bool(sc.crn), ci_level=int(sc.ci_level) if sc.ci_level in (90, 95, 99) else 95,
        analysis_window=int(_clamp(52, 13, min(156, max(13, horizon - 13)))),
    )
    if str(sc.warmup_mode).lower() == "manual":
        kwargs["warmup_method"] = WarmupMethod.MANUAL
        kwargs["warmup_end"] = int(_clamp(round(sc.warmup_days / 7.0), 0, horizon // 2))
    else:
        kwargs["warmup_method"] = WarmupMethod.MOST_CONSERVATIVE
    rule = (sc.stopping_rule or {}).get("kind", "")
    if str(rule) in ("sequential_ci", "sequential"):
        kwargs["replication_stopping"] = ReplicationStopping.SEQUENTIAL_CI
        eps = (sc.stopping_rule or {}).get("epsilon") or (sc.stopping_rule or {}).get("ci_halfwidth_target")
        if eps is not None:
            kwargs["ci_halfwidth_target"] = float(_clamp(float(eps), 0.01, 0.10))
    return SimulationSettings(**kwargs)


def _is_plant_target(raw: str, stripped: str) -> bool:
    """`plant:X`, `node:plant`, or bare `plant` address the (single) focal plant."""
    return raw.lower().startswith("plant:") or stripped.lower() == "plant"


def _map_events(
    schedule: list[dict], sup_ids: set[str], cap_by_sup: dict[str, Optional[float]],
    w: list[MappingWarning],
) -> list[DisruptionEvent]:
    events: list[DisruptionEvent] = []
    for entry in schedule[:5]:
        raw = str(entry.get("target", entry.get("target_id", "")))
        target = raw.rsplit(":", 1)[1] if ":" in raw else raw
        is_plant = target not in sup_ids and _is_plant_target(raw, target)
        if target not in sup_ids and not is_plant:
            w.append(MappingWarning("warn", f"event:{raw}", "target",
                                    "unsupported target skipped (material/edge land later in M7)"))
            continue
        start_days = float(entry.get("start_day", entry.get("start_week", 0)) or 0)
        # 'start_week' already weeks; 'start_day' days
        start_week = round(start_days) if "start_week" in entry else round(start_days / 7.0)
        dur_days = float(entry.get("duration_days", entry.get("duration_weeks", 6)) or 6)
        dur_weeks = round(dur_days) if "duration_weeks" in entry else round(dur_days / 7.0)
        magnitude = float(entry.get("magnitude_pct", entry.get("magnitude", 100.0)) or 100.0)
        kwargs: dict[str, Any] = dict(
            target_type=TargetType.NODE_PLANT if is_plant else TargetType.NODE_SUPPLIER,
            target_id=target or "plant",
            start=max(1, int(start_week)), duration=int(_clamp(dur_weeks, 1, 52)),
        )
        if magnitude < 100.0:
            # Plant capacity is always finite (products carry production_capacity),
            # so a partial cut always throttles; suppliers need capacity_per_week.
            if is_plant or cap_by_sup.get(target) is not None:
                kwargs["effect_type"] = EffectType.CAPACITY_REDUCTION
                kwargs["capacity_factor"] = float(_clamp((100.0 - magnitude) / 100.0, 0.0, 0.999))
            else:
                w.append(MappingWarning("warn", f"event:{target}", "magnitude",
                                        f"{magnitude:.0f}% cut needs a finite supplier capacity — "
                                        f"mapped to a full lead-time-extension outage"))
        events.append(DisruptionEvent(**kwargs))
    if len(schedule) > 5:
        w.append(MappingWarning("warn", "scenario", "disruption_schedule",
                                f"{len(schedule) - 5} events beyond the 5-event cap dropped"))
    return events


def _map_policies(policies: dict, w: list[MappingWarning]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    default = policies.get("default") or {}
    inv = default.get("inventory") or {}
    fulfil = default.get("fulfillment") or {}
    sourcing = default.get("sourcing") or {}
    recovery = default.get("recovery") or {}

    type_map = {
        "min_max": "min_max", "s_S": "min_max", "continuous_review": "min_max",
        "base_stock": "base_stock", "rop": "rop_q", "periodic_review": "periodic",
    }
    out["inventory_control"] = {"policy_type": type_map.get(str(inv.get("type", "min_max")), "min_max")}
    w.append(MappingWarning("info", "policy:inventory_control", "order_up_to",
                            "legacy absolute order_up_to replaced by coverage-based κ (≈8 weeks)"))

    ss_method = str(inv.get("safety_stock_method", "fixed_days"))
    if ss_method in ("service_level", "demand_variability"):
        sl = float(inv.get("service_level_target", 0.95)) * 100.0
        out["safety_stock_materials"] = {"classification": "uniform",
                                         "uniform_service_level": _clamp(sl, 80.0, 99.9)}
    elif ss_method == "king_method":
        out["safety_stock_materials"] = {"classification": "king"}
    else:
        out["safety_stock_materials"] = {
            "classification": "fixed_days",
            "fixed_days_cover": _clamp(float(inv.get("safety_stock_days", 7.0)), 0.0, 84.0),
        }

    if bool(fulfil.get("backorder_allowed", False)):
        out["unmet_demand_handling"] = {
            "rule": "backorder",
            "backorder_horizon": int(_clamp(round(float(fulfil.get("max_backorder_days", 14)) / 7.0), 0, 26)),
            "backorder_penalty": float(fulfil.get("backorder_cost_per_day", 0.0)) * 7.0,
        }
    else:
        out["unmet_demand_handling"] = {"rule": "lost_sales"}

    responses = set(recovery.get("response") or [])
    if str(sourcing.get("strategy", "single")) in ("primary_backup", "dual_sourcing", "multi") \
            or "dual_source_activate" in responses:
        out["backup_supplier"] = {}
    if responses & {"mode_shift", "expedite_freight", "reroute"}:
        out["expedited_shipments"] = {}
    if "capacity_flex" in responses:
        out["short_term_capacity"] = {}
    return out
