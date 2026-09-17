"""Canonical SuReSuite-project → scsim Scenario mapper (single source of truth).

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
    TraceVerbosity,
    WarmupMethod,
)
from scsim.entities.network import (
    BomLine,
    Customer,
    CustomerLink,
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
    "day": 1.0, "days": 1.0, "d": 1.0, "daily": 1.0,
    "week": 7.0, "weeks": 7.0, "wk": 7.0, "w": 7.0, "weekly": 7.0,
    "month": 30.4375, "months": 30.4375, "mo": 30.4375, "m": 30.4375, "monthly": 30.4375,
    "quarter": 91.3125, "quarters": 91.3125, "quarterly": 91.3125,
    "year": 365.25, "years": 365.25, "yr": 365.25, "y": 365.25,
    "yearly": 365.25, "annual": 365.25, "annually": 365.25,
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
    # Explicit triangular bounds (a_p, c_p). When set they override the
    # symmetric triangularAV form — this is how an asymmetric empirical
    # distribution (b = historical median, c = historical max ≫ b·(1+cv))
    # reaches the engine. Ignored for non-triangular demand kinds.
    demand_min: Optional[float] = None         # a_p (master); else b·(1−cv)
    demand_max: Optional[float] = None         # c_p (master); else b·(1+cv)


@dataclass
class SupplyArc:
    """inbound_logistics row: supplier → material.

    Unit contract (docs/data-simulation-mapping.md §3): ``time_unit`` describes
    the VOLUME period only (e.g. "yearly"). ``lead_time`` is in WEEKS unless
    ``lead_time_unit`` explicitly overrides it — it never inherits ``time_unit``.
    """
    supplier_id: str
    material_id: str
    unit_price: Optional[float] = None  # c_{m,s}
    lead_time: Optional[float] = None   # weeks (see unit contract above)
    lead_time_unit: Optional[str] = None  # explicit override only
    time_unit: Optional[str] = None       # volume period
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
    # Single-run inspection mode (G17/§9.5.1): raises trace_verbosity to
    # full_debug so per-item weekly matrices are exposed on the result.
    # Honored only when replications == 1 — ignored (with a warning) otherwise.
    inspection: bool = False


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


# ── Base data requirements (§8.1) ─────────────────────────────────────────────
# The entity fields the always-on engine mechanics read, with the exact
# fallback chains this module applies. Policy-specific requirements live on
# each plugin (PolicyPlugin.data_requirements); these are the world-model
# inputs every run consumes regardless of the policy set. When §4.4 promotes
# the mechanics into named default policies (P-C.4, P-P.0, …), these entries
# migrate onto those plugins. Exported to the frontend/edge validators via
# registry_export.build_registry()["base_data_requirements"].

def base_data_requirements() -> tuple:
    # Imported lazily: scsim.policies pulls in scsim.core, which imports this
    # module's package — a top-level import here would be circular.
    #
    # fallback_spec mirrors THIS module's reducers step for step (§8.2): the
    # named reducers are the shared vocabulary the TS grading module
    # (supabase/functions/_shared/grading.ts) dispatches on, and each step's
    # grade matches the MappingWarning level the mapper emits when that step
    # is what resolves the field — the validation-parity tests pin this.
    from scsim.policies.base import DataRequirement, FallbackStep

    return (
        DataRequirement(
            field="materials.cost", level="required",
            reason="Inventory valuation and holding cost — the terminal default of "
                   "1.0 makes every cost KPI meaningless.",
            fallback="cheapest inbound unit_price across the material's suppliers",
            fallback_spec=(
                FallbackStep(grade="info", reducer="cheapest_inbound_price"),
                FallbackStep(grade="warn", constant=1.0),
            ),
        ),
        DataRequirement(
            field="products.sell_price", level="required",
            reason="Revenue and lost-sales valuation — the terminal default of 1.0 "
                   "makes revenue KPIs meaningless.",
            fallback="demand-weighted average outbound unit_price",
            fallback_spec=(
                FallbackStep(grade="info", reducer="demand_weighted_outbound_price"),
                FallbackStep(grade="warn", constant=1.0),
            ),
        ),
        DataRequirement(
            field="products.demand_mean", level="required",
            reason="Demand generation — with neither source the product is never "
                   "ordered (zero demand).",
            fallback="Σ weekly outbound volume",
            fallback_spec=(
                FallbackStep(grade="info", reducer="weekly_outbound_volume"),
                FallbackStep(grade="warn", constant=0.0),
            ),
        ),
        DataRequirement(
            field="products.production_capacity", level="recommended",
            reason="With no capacity source the engine defaults to max(2·demand, "
                   "1000), so plant capacity never binds.",
            fallback="production policy capacity_units_per_day × 7 × utilization",
            fallback_spec=(
                FallbackStep(grade="info", reducer="production_policy_capacity"),
                FallbackStep(grade="warn", reducer="twice_demand_floor_1000"),
            ),
        ),
        DataRequirement(
            field="inbound_logistics.unit_price", level="recommended",
            reason="Purchase cost per sourcing arc — a missing price defaults to "
                   "1.0 and distorts procurement spend.",
            fallback=None,
            fallback_spec=(FallbackStep(grade="warn", constant=1.0),),
        ),
        DataRequirement(
            field="inbound_logistics.lead_time", level="recommended",
            reason="Supplier lead time per sourcing arc — missing values default "
                   "to 2 weeks.",
            fallback=None,
            fallback_spec=(FallbackStep(grade="warn", constant=2.0),),
        ),
        DataRequirement(
            field="suppliers.capacity_per_week", level="defaulted",
            reason="Empty means unlimited (a valid modeling choice) — but partial-"
                   "magnitude supplier disruptions need a finite capacity to "
                   "throttle, else they degrade to full outages.",
            fallback="unlimited",
        ),
    )


# ── Policy & demand helpers ───────────────────────────────────────────────────

def _merged_policy(
    policies: dict, node_id: str, family: str,
    *, plant_scoped: bool = False,
    warnings: Optional[list["MappingWarning"]] = None,
) -> dict:
    """Family patch of the default merged with a node-level override.

    Most callers key overrides by the bare entity id ("node:<id>"). Some
    families (currently: production) are written by the UI as
    "node:<plant name>::<entity id>", since a project may have more than one
    plant. When `plant_scoped` is set, a compound key is matched by its LAST
    "::"-segment against `node_id` — the plant name itself is never
    consulted, so this works for any plant name or count of plants. If more
    than one compound key resolves to the same node_id (the same product
    overridden under two different plants), the first match wins and — when
    `warnings` is supplied — a MappingWarning records the ambiguity instead
    of silently picking one.
    """
    default = (policies.get("default") or {}).get(family) or {}
    override = (policies.get(f"node:{node_id}") or {}).get(family) or {}
    if not override and plant_scoped:
        matches: list[tuple[str, dict]] = []
        for key, families in policies.items():
            if not isinstance(key, str) or not key.startswith("node:") or "::" not in key:
                continue
            _prefix, _, suffix = key[len("node:"):].rpartition("::")
            if suffix == node_id:
                candidate = (families or {}).get(family) or {}
                if candidate:
                    matches.append((key, candidate))
        if matches:
            override = matches[0][1]
            if len(matches) > 1 and warnings is not None:
                other_keys = ", ".join(k for k, _ in matches[1:])
                warnings.append(MappingWarning(
                    "warn", f"{family}:{node_id}", "target_key",
                    f"multiple plant-scoped {family!r} overrides match {node_id!r} "
                    f"({matches[0][0]!r} used; ignored: {other_keys})"))
    return {**default, **override}


def _composite_patches(policies: dict, family: str, targets: set[str]) -> dict[str, dict]:
    """Index ``node:<owner>::<target>`` patches of ``family`` by their target.

    The policy grid's two-key stages write one override row per pair — the
    plant stage as ``<plant>::<product>``, the supplier stage as
    ``<supplier>::<material>`` (``src/lib/policies/columnSpecs.ts``). The
    engine only ever holds the target id, so a lookup keyed by the target
    alone has to reach those rows or they are stored and never read. Same
    parse as :func:`_multi_sourcing_weights` and the P-P.9 priority fold.

    Keys are visited in sorted order so a project carrying more than one
    owner per target resolves deterministically (the model is single-plant).
    """
    out: dict[str, dict] = {}
    for key in sorted(k for k in policies if isinstance(k, str)):
        if not key.startswith("node:") or "::" not in key:
            continue
        _owner, _, target = key[len("node:"):].partition("::")
        if not target or target not in targets:
            continue
        patch = (policies.get(key) or {}).get(family) or {}
        if patch:
            out.setdefault(target, {}).update(patch)
    return out


# Extended fulfillment strategies the UI offers (FulfillmentStrategy) that the
# engine does not model — they collapse to MTO. Warned so the collapse is never silent.
_MODE_COLLAPSED_TO_MTO = {"cto", "configure_to_order", "eto", "engineer_to_order"}


def _fulfillment_mode(
    raw: Optional[str],
    project_model: Optional[str],
    w: Optional[list["MappingWarning"]] = None,
    product_id: Optional[str] = None,
) -> FulfillmentMode:
    token = (raw or project_model or "").strip().lower().replace("-", "_").replace(" ", "_")
    if token in ("mts", "make_to_stock"):
        return FulfillmentMode.MTS
    if token in ("ato", "assemble_to_order"):
        return FulfillmentMode.ATO
    if token in _MODE_COLLAPSED_TO_MTO and w is not None:
        w.append(MappingWarning(
            "warn", f"product:{product_id or '?'}", "fulfillment_mode",
            f"fulfillment mode {token!r} is not modeled by the engine — treated as make_to_order (MTO)"))
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
        # Master-supplied explicit bounds win over the symmetric AV form
        # (docs/data-simulation-mapping.md §5). Inconsistent bounds are
        # clamped to the mode and reported instead of failing the run.
        if row.demand_min is not None:
            a = float(row.demand_min)
            if a > b:
                warnings.append(MappingWarning(
                    "warn", f"product:{row.id}", "demand_min",
                    f"demand_min {a:g} > demand mode {b:g} — clamped to the mode"))
                a = b
        if row.demand_max is not None:
            c = float(row.demand_max)
            if c < b:
                warnings.append(MappingWarning(
                    "warn", f"product:{row.id}", "demand_max",
                    f"demand_max {c:g} < demand mode {b:g} — clamped to the mode"))
                c = b
        return Product(demand_model=DemandModel.TRIANGULAR,
                       demand_mode=b, demand_min=max(a, 0.0), demand_max=c, **common)
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
    # Duplicate (supplier, material) inbound rows are reduced to one link:
    # cheapest unit_price wins, ties broken by shortest lead time.
    links_by_key: dict[tuple[str, str], SupplierLink] = {}
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
        # Lead times are weeks; time_unit describes the volume period only
        # (§3). With lead_time_unit unset, _duration_to_weeks defaults to a
        # 7-day basis → the value is taken as weeks verbatim.
        lt_unit = arc.lead_time_unit
        lt_weeks = _duration_to_weeks(arc.lead_time, lt_unit) if arc.lead_time else 2.0
        if not arc.lead_time:
            w.append(MappingWarning("warn", f"supply:{arc.supplier_id}->{arc.material_id}",
                                    "lead_time", "missing lead_time → defaulted to 2 weeks"))
        mrow = mat_lt_dist.get(arc.material_id)
        link = SupplierLink(
            supplier_id=arc.supplier_id, material_id=arc.material_id,
            cost=cost, lead_time_weeks=int(_clamp(round(lt_weeks), 1, 51)),
            lead_time_dist=LeadTimeDist((mrow.lead_time_dist or "deterministic")) if mrow and mrow.lead_time_dist else LeadTimeDist.DETERMINISTIC,
            lead_time_cv=float(mrow.lead_time_cv) if mrow and mrow.lead_time_cv else 0.0,
            moq=float(mrow.moq) if mrow and mrow.moq else 0.0,
        )
        key = (arc.supplier_id, arc.material_id)
        prev = links_by_key.get(key)
        if prev is None:
            links_by_key[key] = link
        else:
            w.append(MappingWarning("warn", f"supply:{arc.supplier_id}->{arc.material_id}",
                                    "duplicate_arc",
                                    "duplicate (supplier, material) inbound rows → kept "
                                    "cheapest unit_price (tie: shortest lead time)"))
            if (link.cost, link.lead_time_weeks) < (prev.cost, prev.lead_time_weeks):
                links_by_key[key] = link
        cheapest_cost[arc.material_id] = min(cheapest_cost.get(arc.material_id, cost), cost)

    links = list(links_by_key.values())

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
    cust_share: dict[tuple[str, str], float] = {}  # (product, customer) → weekly volume
    for o in data.outbound:
        customers.add(o.customer_id)
        weekly = _rate_to_weekly(float(o.volume or 0.0), o.time_unit)
        out_demand[o.product_id] = out_demand.get(o.product_id, 0.0) + weekly
        if weekly > 0:
            key = (o.product_id, o.customer_id)
            cust_share[key] = cust_share.get(key, 0.0) + weekly
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
    # The plant grid keys its production overrides "<focal plant>::<product>",
    # so the composite index is what makes a per-row line-capacity edit reach
    # the engine at all; the bare "node:<product>" form still wins nothing and
    # loses nothing (§4 D75).
    prod_composite = _composite_patches(data.policies, "production", prod_ids)
    products: list[Product] = []
    product_modes: set[FulfillmentMode] = set()
    for p in data.products:
        prod_pol = {**_merged_policy(data.policies, p.id, "production"),
                    **prod_composite.get(p.id, {})}
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
        # capacity — master (units/week) wins over the plant grid's line
        # capacity (units/day); say so rather than dropping the edit silently.
        line_cap = prod_pol.get("capacity_units_per_day")
        if p.production_capacity and p.production_capacity > 0:
            cap = float(p.production_capacity)
            if line_cap:
                w.append(MappingWarning("info", f"product:{p.id}", "production_capacity",
                                        "master production_capacity (units/week) shadows the "
                                        "plant grid's line capacity (units/day) — the line "
                                        "capacity entry is not applied"))
        elif line_cap:
            util_raw = prod_pol.get("utilization_cap_pct")
            if util_raw is None:
                w.append(MappingWarning("info", f"product:{p.id}", "utilization_cap_pct",
                                        "production policy sets no utilization cap → 85%"))
            util = float(85.0 if util_raw is None else util_raw) / 100.0
            cap = float(line_cap) * 7.0 * util
            w.append(MappingWarning("info", f"product:{p.id}", "production_capacity",
                                    "no master capacity → derived from production policy"))
        else:
            cap = max(mean * 2.0, 1000.0)
            w.append(MappingWarning("warn", f"product:{p.id}", "production_capacity",
                                    "no capacity source → defaulted (capacity will not bind)"))
        mode = _fulfillment_mode(p.fulfillment_mode, data.project_model, w, p.id)
        product_modes.add(mode)
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
    if not bom:
        # Fail with a diagnosis instead of pydantic's opaque "bom too_short":
        # either the project has no BOM rows at all, or none of its BOM
        # product ids match a product master (for multi-level BOMs the
        # flattened roots must be the outbound/finished products).
        raise ValueError(
            "no usable BOM arcs: the project's BOM is empty or its product ids "
            f"match none of the {len(products)} product(s) — upload a BOM whose "
            "top level is the finished product"
        )

    prod_ids = {p.id for p in products}
    network = Network(
        suppliers=suppliers, materials=materials, products=products,
        bom=bom, supplier_links=links,
        customers=[Customer(id=c, name=c) for c in sorted(customers)],
        customer_links=[
            CustomerLink(product_id=pid, customer_id=cid, share=share)
            for (pid, cid), share in sorted(cust_share.items()) if pid in prod_ids
        ],
    )

    settings = _build_settings(sc, w)
    events = _map_events(sc.disruption_schedule, sup_ids, cap_by_sup, w)
    sups_by_mat: dict[str, set[str]] = {}
    for link in links:
        sups_by_mat.setdefault(link.material_id, set()).add(link.supplier_id)
    policies = _map_policies(data.policies, w, n_customers=len(customers),
                             sups_by_mat=sups_by_mat,
                             has_mts=(FulfillmentMode.MTS in product_modes))

    # Every override the user typed should reach SOME entity. A key whose
    # components name no supplier, material, product or customer joins
    # nothing in any family — the shape of §4 D75, caught here generically
    # so the next stage to invent a target-key spelling is not silent.
    known = prod_ids | mat_ids | sup_ids | customers
    orphan_keys = sorted(
        k for k in data.policies
        if isinstance(k, str) and k.startswith("node:")
        and not (set(k[len("node:"):].split("::")) & known)
    )
    if orphan_keys:
        shown = ", ".join(orphan_keys[:5]) + ("…" if len(orphan_keys) > 5 else "")
        w.append(MappingWarning(
            "warn", "policy:overrides", "target_key",
            f"{len(orphan_keys)} policy override(s) name no supplier, material, "
            f"product or customer in this project and were not applied: {shown}"))

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
    # Single-run inspection mode (G17): full-debug trace so the engine exposes
    # per-item weekly matrices. Strictly single-replication — per-item series
    # at multi-rep scale are deliberately never produced.
    if sc.inspection:
        if kwargs["model_seeds"] == 1:
            kwargs["trace_verbosity"] = TraceVerbosity.FULL_DEBUG
        else:
            w.append(MappingWarning(
                "warn", "scenario", "inspection",
                f"inspection mode requires exactly 1 replication "
                f"(got {kwargs['model_seeds']}) → ignored",
            ))
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


_ALLOCATION_RULE = {  # UI fulfillment.allocation → P-C.2 rule (engineBridge.json mirror)
    "priority": "priority", "fair_share": "fair_share",
    "proportional": "proportional", "sla_tier": "sla_tier",
}


def _node_override(policies: dict, key: str, family: str) -> dict:
    """Family patch of a `node:<target_key>` override, {} when absent."""
    return (policies.get(f"node:{key}") or {}).get(family) or {}


def _multi_sourcing_weights(
    policies: dict, sourcing: dict, sups_by_mat: dict[str, set[str]],
    w: list[MappingWarning],
) -> dict[str, dict[str, float]]:
    """Build P-S.2 ``weights[material][supplier] = share %`` from the UI's
    sourcing ratios: arc-level overrides (target_key ``supplier::material``)
    take precedence; project-level ``sourcing.ratios`` (supplier → fraction)
    spread to every multi-sourced material that supplier serves. Shares are
    renormalized to 100 per material — the plugin hard-errors otherwise."""
    weights: dict[str, dict[str, float]] = {}
    for key, families in policies.items():
        if not isinstance(key, str) or not key.startswith("node:") or "::" not in key:
            continue
        row_sup, _, mat = key[len("node:"):].partition("::")
        src = families.get("sourcing") or {}
        # Grid-friendly scalar: the row's own share of its material.
        scalar = src.get("supply_share")
        if scalar is not None and row_sup in sups_by_mat.get(mat, set()):
            weights.setdefault(mat, {})[row_sup] = float(scalar) * 100.0
        for sup, share in (src.get("ratios") or {}).items():
            if sup in sups_by_mat.get(mat, set()):
                weights.setdefault(mat, {})[str(sup)] = float(share) * 100.0
    for sup, share in (sourcing.get("ratios") or {}).items():
        for mat, sups in sups_by_mat.items():
            if sup in sups and len(sups) > 1:
                weights.setdefault(mat, {}).setdefault(str(sup), float(share) * 100.0)
    for mat, shares in list(weights.items()):
        total = sum(shares.values())
        if total <= 0:
            weights.pop(mat)
            continue
        if abs(total - 100.0) > 1e-6:
            w.append(MappingWarning(
                "info", "policy:proactive_multi_sourcing", "weights",
                f"sourcing shares for {mat!r} sum to {total:.0f}% — renormalized to 100%"))
            weights[mat] = {s: v * 100.0 / total for s, v in shares.items()}
    return weights


# Fulfillment fields the engine consumes at the PROJECT default scope only
# (P-C.1 unmet_demand_handling + P-C.2 customer_allocation). A per-node override
# carrying any of these is not applied — warned rather than dropped silently (doc §6).
# (primary_source / sourcing_firm are firm-routing hints, never engine params, so
# they are deliberately excluded here and never trigger the warning.)
_FULFILLMENT_DEFAULT_ONLY = frozenset({
    "backorder_allowed", "max_backorder_days", "backorder_cost_per_day",
    "lost_sales_cost_per_unit", "allocation", "tier_overrides",
    "service_level_alpha", "service_level_beta", "price",
})


def _map_policies(
    policies: dict, w: list[MappingWarning], n_customers: int = 0,
    sups_by_mat: Optional[dict[str, set[str]]] = None,
    has_mts: bool = False,
) -> dict[str, dict]:
    out: dict[str, dict] = {}
    default = policies.get("default") or {}
    inv = default.get("inventory") or {}
    fulfil = default.get("fulfillment") or {}
    sourcing = default.get("sourcing") or {}
    recovery = default.get("recovery") or {}
    sups_by_mat = sups_by_mat or {}

    # Surface per-node fulfillment overrides the engine will not apply.
    dropped_fulfil = sum(
        1 for k, fams in policies.items()
        if isinstance(k, str) and k.startswith("node:")
        and any(f in (fams.get("fulfillment") or {}) for f in _FULFILLMENT_DEFAULT_ONLY)
    )
    if dropped_fulfil:
        w.append(MappingWarning(
            "warn", "policy:unmet_demand_handling", "fulfillment",
            f"{dropped_fulfil} per-node fulfillment override(s) not applied — backorder, "
            "allocation and service level are consumed at the project default scope only"))

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

    # P-C.2 customer allocation — the UI's fulfillment.allocation enum finally
    # reaches the engine. Inert (skipped) below two customers.
    alloc = str(fulfil.get("allocation", "") or "")
    if alloc and n_customers >= 2:
        if alloc == "revenue_max":
            w.append(MappingWarning("warn", "policy:customer_allocation", "allocation",
                                    "revenue_max needs per-customer pricing (deferred) — "
                                    "mapped to priority"))
            out["customer_allocation"] = {"rule": "priority"}
        elif alloc == "sla_tier":
            # G1 closure: the UI's tier fill floors (fractions) reach P-C.2.
            out["customer_allocation"] = {
                "rule": "sla_tier",
                "sla_tiers": {
                    str(k): _clamp(float(v) * 100.0, 0.0, 100.0)
                    for k, v in (fulfil.get("tier_overrides") or {}).items()
                },
            }
        elif alloc in _ALLOCATION_RULE:
            out["customer_allocation"] = {"rule": _ALLOCATION_RULE[alloc]}

    # P-S.2 proactive multi-sourcing — sourcing.ratios finally reach the
    # engine (G1's flagship loss). Empty weights are valid: the plugin
    # derives a volume/equal split over qualified links.
    strategy = str(sourcing.get("strategy", "single"))
    weights = _multi_sourcing_weights(policies, sourcing, sups_by_mat, w)
    if strategy == "multi" or weights:
        if any(len(s) > 1 for s in sups_by_mat.values()):
            out["proactive_multi_sourcing"] = {"weights": weights}
        else:
            w.append(MappingWarning(
                "warn", "policy:proactive_multi_sourcing", "strategy",
                "multi-sourcing configured but every material is single-sourced — "
                "P-S.2 skipped (add a second qualified supplier arc)"))

    # P-P.4 finished-goods safety stock — MTS only (MTO builds no FG stock).
    # Gate on the engine's ACTUAL product mode (`has_mts`, resolved from
    # products.fulfillment_mode / supply_chain_model), not the separate policy
    # `fulfillment_strategy` string; warn when the two disagree so the split
    # between the two "fulfillment mode" fields can never silently mis-gate.
    fg = str(inv.get("fg_safety_stock", "none") or "none")
    if fg != "none":
        strat = str(default.get("fulfillment_strategy", "")).strip().lower()
        strat_is_mts = strat in ("mts", "make_to_stock")
        if has_mts:
            if fg == "service_level":
                out["fg_safety_stock"] = {
                    "sizing": "service_level",
                    "service_level_pct": _clamp(
                        float(inv.get("fg_service_level_target", 0.95)) * 100.0, 80.0, 99.9),
                    "segmentation": "uniform",
                }
            else:
                out["fg_safety_stock"] = {
                    "sizing": "fixed_days",
                    "fixed_days_cover": _clamp(float(inv.get("fg_safety_stock_days", 2.0)), 0.0, 12.0),
                    "segmentation": "uniform",
                }
            if strat and not strat_is_mts:
                w.append(MappingWarning(
                    "info", "policy:fg_safety_stock", "fulfillment_strategy",
                    f"fulfillment_strategy={strat!r} but MTS products exist — FG safety "
                    "stock applied per the products' actual fulfillment mode"))
        elif strat_is_mts:
            w.append(MappingWarning(
                "warn", "policy:fg_safety_stock", "fulfillment_strategy",
                "fulfillment_strategy=make_to_stock but no product is make_to_stock "
                "(products.fulfillment_mode / supply_chain_model) — FG safety stock skipped"))
        else:
            w.append(MappingWarning(
                "warn", "policy:fg_safety_stock", "fg_safety_stock",
                "finished-goods safety stock requires make_to_stock — skipped under MTO"))

    responses = set(recovery.get("response") or [])
    if strategy in ("primary_backup", "dual_sourcing", "multi") \
            or "dual_source_activate" in responses:
        out["backup_supplier"] = {}
    if responses & {"mode_shift", "expedite_freight", "reroute"}:
        out["expedited_shipments"] = {}
    if "capacity_flex" in responses:
        out["short_term_capacity"] = {}

    # P-S.4 early warning — recovery.detection_lag_days finally reaches the
    # engine, compressing how fast every reactive policy engages.
    if "early_warning" in responses:
        days = float(recovery.get("detection_lag_days", 1.0) or 0.0)
        out["early_warning_failover"] = {
            "detection_lag_weeks": int(_clamp(round(days / 7.0), 0, 4)),
        }

    # P-P.9 optimized material allocation — per-product priorities fold in
    # from plant-stage overrides (target_key "<plant>::<product>").
    if "allocate_materials" in responses:
        priority: dict[str, float] = {}
        for key, families in policies.items():
            if not isinstance(key, str) or not key.startswith("node:") or "::" not in key:
                continue
            _node, _, prod = key[len("node:"):].partition("::")
            v = (families.get("production") or {}).get("allocation_priority_weight")
            if v is not None and prod:
                priority[prod] = float(v)
        params: dict[str, Any] = {"activation": "during_disruption"}
        if priority:
            params["objective"] = "priority_weighted"
            params["priority_weights"] = priority
        out["material_allocation"] = params

    return out
