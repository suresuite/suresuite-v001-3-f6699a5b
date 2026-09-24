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

from dataclasses import dataclass, field, replace
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


def _fmt(x: float) -> str:
    return f"{x:g}"


def _clamp(
    v: float, lo: float, hi: float, *,
    w: list["MappingWarning"], entity: str, field: str,
    unit: str = "", scale: float = 1.0, level: str = "warn",
) -> float:
    """Bound ``v`` to the engine's range — and SAY so when that changed it.

    The only two-sided clamp in this module (audit 2026-09-22, F-21). It used to
    return silently, and a dozen values the user typed were bounded with the
    substitution recorded in a comment or in ``docs/data/field-mapping.md``,
    which is T2's exact prohibition. ``w``, ``entity`` and ``field`` are
    keyword-only with no default, so a call cannot omit the sink, and
    ``tests/test_mapping_clamps.py`` fails on any clamp idiom outside this one.

    ``scale`` converts the engine value back to the unit the user typed for the
    message only (e.g. a holding rate in %/yr against a stored fraction).
    """
    used = max(lo, min(hi, v))
    if used != v:
        w.append(MappingWarning(
            level, entity, field,
            f"{_fmt(v / scale)}{unit} is outside the engine range "
            f"[{_fmt(lo / scale)}, {_fmt(hi / scale)}]{unit} → {_fmt(used / scale)}{unit} used"))
    return used


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
class CustomerRow:
    """``customers`` row — the table the mapper never read (§4 D69).

    ``ProjectData.customers`` is a list of IDS and stays that way. This carries
    the ATTRIBUTES for those ids and NOTHING ELSE — in particular it does not
    decide WHICH customers exist.

    That separation was not the first draft's, and CI is what settled it. The
    draft also unioned these rows into the id set, so a row naming a customer the
    graph does not trade with became a `Customer` entity with no demand — and, as
    a side effect, `unmatched` below compared against a set that already
    contained every row, so it could never fire and
    `test_a_row_naming_an_id_with_no_demand_is_reported_not_silent` failed. Which
    customers exist is decided by the outbound arcs exactly as it was before D69;
    widening it is a behaviour change beyond the defect, and one that would have
    put demand-less customers into `len(net.customers)`, which P-C.2's own
    feasibility check reads.

    ``sla_fill_floor_pct`` is deliberately absent: the column exists on the table
    and ``Customer`` has no field for it, so there is nothing to carry it into.
    Mapping a per-customer floor onto P-C.2's per-SEGMENT ``sla_tiers`` needs a
    rule for what happens when two customers in one segment disagree, and
    inventing that rule is not a reader change (§16).
    """
    id: str
    name: Optional[str] = None
    segment: Optional[str] = None
    priority_weight: Optional[float] = None


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
    # The ATTRIBUTES of the customers the `customers` table describes. Additive
    # to `customers` above, which remains the id list — see `CustomerRow` (D69).
    customer_rows: list[CustomerRow] = field(default_factory=list)
    # §4 D174 — master products CONSUMED by another product (sub-assemblies).
    # Stamped by the caller from the RAW BOM shape, because the flattened
    # `bom` arcs no longer show which nodes were intermediate. The mapper
    # excludes these from the engine's product list WITH a warning; a
    # ProductRow for one would otherwise reach `Network` with an empty BoM
    # and the engine would refuse the whole project.
    subassemblies: list[str] = field(default_factory=list)
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

# ── §4 D90 · THE POLICY-BUNDLE KEYS, DECLARED ───────────────────────────────
#
# WP 6.1 traced every /policies grid field to the engine and found THREE doors:
# the registry's `data_requirements` (`table.column` the engine needs from the
# dataset), a policy's `params_schema` (80 declared parameters), and — for
# everything else — A QUOTED STRING IN THIS FILE.
#
# Door 3 is not a contract. It is a text scan over Python, it was the only proof
# those fields reach the engine at all, and `single-source` (I1) says a data fact
# is authored once somewhere a generator can read. §3's standing law — "the
# registry export is the single source of truth for policy schemas" — was true of
# the schemas that exist and silent about these.
#
# §4 D90 said the fix belongs here and deferred it on "it needs a session that can
# run Python", the same premise D94 and D106 were deferred on and which WP 6.2
# found false.
#
# WHAT THIS IS AND IS NOT. It is not a second copy of the mapping: the mapper
# below is still the only code that performs it, and this table makes no runtime
# decision. It declares WHICH POLICY PARAMETER OR ENTITY FIELD each bundle key
# feeds, so a reader outside Python can answer "does this grid cell reach the
# engine, and as what" without scanning for a dict read. `registry_export`
# publishes it and `resolutionChains` reads it as door 3 proper.
#
# `parity` is what keeps it from drifting into fiction: every key here must be
# READ by this module, and every bundle key this module reads must be here —
# `scsim/tests/test_registry_io.py` asserts both directions against the source.
#
# TEN KEYS, TWELVE CHAINS: `type` and `safety_stock_days` are rendered by both
# the supplier and the plant stage, so the grid has twelve cells for ten keys.
# (`utilization_cap_pct` joined in WP 9.3 — it was on the test's `not_rendered`
# list, which is the list of keys that are NOT grid cells, while the arithmetic
# it performs is half of what the plant stage exists to show.)
#
# `shadowed_by` is OPTIONAL and names the entity field that, when present,
# makes this key's value unreachable. Two keys carry it and both name
# `products.production_capacity` (§4 D167).
POLICY_BUNDLE_KEYS: tuple[dict[str, str | None], ...] = (
    {
        "key": "supply_share",
        "family": "sourcing",
        "target": "proactive_multi_sourcing.weights",
        "catalog_ref": "P-S.2",
        "transform": "fraction x 100 into the material's weight map, keyed by supplier; "
                     "only for a supplier the material actually has a link to",
    },
    {
        "key": "type",
        "family": "inventory",
        "target": "inventory_control.policy_type",
        "catalog_ref": "P-X.1",
        "transform": "enum map — min_max/s_S/continuous_review -> min_max, base_stock -> "
                     "base_stock, rop -> rop_q, periodic_review -> periodic; anything "
                     "unrecognised falls back to min_max",
    },
    {
        "key": "safety_stock_days",
        "family": "inventory",
        "target": "safety_stock_materials.fixed_days_cover",
        "catalog_ref": "P-X.2",
        "transform": "days, clamped 0-84. Only when `safety_stock_method` is neither "
                     "service_level/demand_variability nor king_method — those two take "
                     "a different classification and this key is not read",
    },
    {
        "key": "service_level_target",
        "family": "inventory",
        "target": "safety_stock_materials.uniform_service_level",
        "catalog_ref": "P-X.2",
        "transform": "fraction x 100, clamped 80.0-99.9. Read only when "
                     "`safety_stock_method` is service_level or demand_variability",
    },
    {
        "key": "capacity_units_per_day",
        "family": "production",
        # NOT a policy parameter. This one lands on an ENTITY field, which is why
        # door 2 could never have declared it and why the row needed this table
        # rather than a Params addition.
        "target": "Product.production_capacity",
        "catalog_ref": None,
        "transform": "units/day x 7 x utilization_cap_pct (default 0.85) -> units/week. "
                     "The MASTER `products.production_capacity` shadows it entirely when "
                     "present, and the mapper warns that the grid entry is not applied",
        # THE SHADOW, MACHINE-READABLE (§4 D167). The sentence above has been in
        # this table since D90 and no surface could act on it: the plant grid
        # rendered an editable `capacity_units_per_day` cell with nothing saying
        # the engine would ignore it whenever the product carried a master
        # capacity. A surface cannot read prose. It can read this.
        "shadowed_by": "products.production_capacity",
    },
    {
        # The OTHER half of the same arithmetic, and it had no declaration and no
        # column — so a planner saw 1 000 units/day become 5 950 units/week with
        # nothing on screen holding the 0.85. It is read by `_map_policies`'s
        # capacity branch exactly as `capacity_units_per_day` is.
        "key": "utilization_cap_pct",
        "family": "production",
        "target": "Product.production_capacity",
        "catalog_ref": None,
        "transform": "percent / 100, multiplied into the weekly capacity above; the "
                     "mapper substitutes 85 when the production policy sets none and "
                     "says so. Read ONLY on the branch that derives capacity from the "
                     "grid — a master production_capacity shadows this too",
        "shadowed_by": "products.production_capacity",
    },
    {
        "key": "fg_safety_stock",
        "family": "inventory",
        "target": "fg_safety_stock.sizing",
        "catalog_ref": "P-P.4",
        "transform": "enum — 'none' skips the policy; 'service_level' selects "
                     "service-level sizing; anything else selects fixed_days. Gated on the "
                     "engine's own `has_mts`, not on the policy's fulfillment_strategy string",
    },
    {
        "key": "fg_service_level_target",
        "family": "inventory",
        "target": "fg_safety_stock.service_level_pct",
        "catalog_ref": "P-P.4",
        "transform": "fraction x 100, clamped 80.0-99.9. Read only when `fg_safety_stock` "
                     "is service_level",
    },
    {
        "key": "fg_safety_stock_days",
        "family": "inventory",
        "target": "fg_safety_stock.fixed_days_cover",
        "catalog_ref": "P-P.4",
        "transform": "days, clamped 0-12. Read only when `fg_safety_stock` selects "
                     "fixed_days sizing",
    },
    {
        "key": "allocation_priority_weight",
        "family": "production",
        "target": "material_allocation.priority_weights",
        "catalog_ref": "P-X.3",
        "transform": "per-product weight, collected from composite `node:<node>::<product>` "
                     "override keys. Read only when the scenario asks for "
                     "`allocate_materials`, and its presence switches the objective to "
                     "priority_weighted",
    },
)


def base_data_requirements() -> tuple:
    # Imported lazily: scsim.policies pulls in scsim.core, which imports this
    # module's package — a top-level import here would be circular.
    #
    # fallback_spec mirrors THIS module's reducers step for step (§8.2): the
    # named reducers are the shared vocabulary the TS grading module
    # (supabase/functions/_shared/grading.ts) dispatches on, and each step's
    # grade matches the MappingWarning level the mapper emits when that step
    # is what resolves the field — the validation-parity tests pin this.
    from scsim.policies.base import DataRequirement, EmptyMeaning, FallbackStep

    return (
        DataRequirement(
            field="materials.cost", level="required",
            reason="Inventory valuation and holding cost — the terminal default of "
                   "1.0 makes every cost KPI meaningless.",
            fallback="volume-weighted average inbound unit_price across the "
                     "material's supply lanes; the cheapest quoted price when no "
                     "lane carries a volume",
            fallback_spec=(
                FallbackStep(grade="info", reducer="volume_weighted_inbound_price"),
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
            # NOT a fallback: `context.py` builds `np.inf` from the NULL, so the
            # engine honours the blank instead of substituting for it. Declared
            # here because the sentence had TWO authors — this table said
            # "unlimited" in prose and `columnSpecs.ts::master.nullMeans` carried
            # the token and the tooltip the grid actually rendered (§4 D167).
            empty_means=EmptyMeaning(
                token="∞",
                meaning="No capacity limit. An empty supplier capacity means "
                        "unlimited, so this supplier never throttles shipments — "
                        "and a partial-magnitude disruption on it degrades to a "
                        "full outage. Enter a number to model a finite capacity.",
            ),
        ),
    )


# ── Policy & demand helpers ───────────────────────────────────────────────────

def _merged_policy(policies: dict, node_id: str, family: str) -> dict:
    default = (policies.get("default") or {}).get(family) or {}
    override = (policies.get(f"node:{node_id}") or {}).get(family) or {}
    return {**default, **override}


def _composite_target(key_body: str, targets: set[str]) -> Optional[str]:
    """The target id inside a composite ``<owner>::<target>`` key, or None.

    Splitting at the FIRST ``::`` is this file's convention — the same parse
    :func:`_multi_sourcing_weights` and the P-P.9 priority fold use, and the
    one the TS grader mirrors. Both halves of a key are free-text user data
    though, so a plant named ``A::B`` would defeat it; the LAST ``::`` is
    tried as a second candidate for exactly that case. Each candidate is
    validated against the known ids, so an extra one cannot mis-resolve —
    it can only rescue a key the first split got wrong.
    """
    first = key_body.partition("::")[2]
    if first and first in targets:
        return first
    last = key_body.rpartition("::")[2]
    if last and last in targets:
        return last
    return None


def _composite_patches(
    policies: dict, family: str, targets: set[str], w: list[MappingWarning],
) -> dict[str, dict]:
    """Index ``node:<owner>::<target>`` patches of ``family`` by their target.

    The policy grid's two-key stages write one override row per pair — the
    plant stage as ``<plant>::<product>``, the supplier stage as
    ``<supplier>::<material>`` (``src/lib/policies/columnSpecs.ts``). The
    engine only ever holds the target id, so a lookup keyed by the target
    alone has to reach those rows or they are stored and never read (§4 D75).

    Keys are visited in sorted order, so when two owners patch the same
    target the winner is stable — and it is ANNOUNCED rather than picked in
    silence, because a silent choice between two user-entered values is the
    same defect this function exists to close.
    """
    seen: dict[str, list[str]] = {}
    out: dict[str, dict] = {}
    for key in sorted(k for k in policies if isinstance(k, str)):
        if not key.startswith("node:") or "::" not in key:
            continue
        target = _composite_target(key[len("node:"):], targets)
        if target is None:
            continue
        patch = (policies.get(key) or {}).get(family) or {}
        if not patch:
            continue
        seen.setdefault(target, []).append(key)
        out.setdefault(target, {}).update(patch)
    for target, keys in seen.items():
        if len(keys) > 1:
            w.append(MappingWarning(
                "warn", f"{family}:{target}", "target_key",
                f"{len(keys)} {family!r} overrides name {target!r} under different "
                f"owners ({', '.join(repr(k) for k in keys)}) — merged in key order, "
                f"{keys[-1]!r} wins on any field they share"))
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

    # §4 D174 — a master product consumed by another product is a SUB-ASSEMBLY,
    # not a finished product. The BOM flatten models it through its components
    # (root→leaf arcs), so a ProductRow for it would reach `Network` with an
    # empty BoM and the engine would refuse the whole project — which is what
    # the 2026-09-23 acceptance audit hit with the canonical sub-assembly
    # dataset. Excluded here, and SAID: info when the exclusion is pure
    # modeling, warn when the sub-assembly also ships (its own outbound demand
    # is then not simulated, and silence about that would be a T2 breach).
    if data.subassemblies:
        sub = set(data.subassemblies)
        shipping = {o.product_id for o in data.outbound}
        for pid in sorted(sub):
            if pid in shipping:
                w.append(MappingWarning(
                    "warn", f"product:{pid}", "subassembly",
                    "consumed by another product — modeled through the BOM as a component; "
                    "its OWN outbound demand is not simulated (spare-parts demand on a "
                    "sub-assembly is not supported yet)"))
            else:
                w.append(MappingWarning(
                    "info", f"product:{pid}", "subassembly",
                    "consumed by another product — modeled through the BOM as a component, "
                    "not as a finished product"))
        if any(p.id in sub for p in data.products):
            data = replace(data, products=[p for p in data.products if p.id not in sub])

    prod_ids = {p.id for p in data.products}
    # Computed HERE rather than beside its `unsourced` check below, because the
    # arc loop needs it: a material the BOM consumes is part of this project
    # whether or not anyone gave it a master row (§4 D166).
    bom_mat_ids = {b.material_id for b in data.bom if b.product_id in prod_ids}
    sup_ids = {s.id for s in data.suppliers}

    # ── Supplier links (per supplier×material) + the materials.cost fallback ──
    # Duplicate (supplier, material) inbound rows are reduced to one link:
    # cheapest unit_price wins, ties broken by shortest lead time.
    #
    # Two per-material price reductions are accumulated here, and they are the
    # two data-derived steps of the `materials.cost` chain (the registry's
    # fallback_spec below declares them in this order):
    #
    #   volume_weighted_inbound_price — Σ(price × weekly volume) / Σ(weekly
    #     volume) over the material's arcs. The exact analogue of the
    #     demand-weighted outbound price that backs `products.sell_price`: a
    #     lane contributes at the rate the project actually buys through it,
    #     so a material quoted by three suppliers is valued at what it costs
    #     rather than at its cheapest quote.
    #   cheapest_inbound_price — min over the arcs. Reached only when NO arc
    #     of the material carries a positive volume, i.e. when there is no
    #     weight to average by.
    #
    # Both reduce over the RAW arcs rather than over `links_by_key`: the
    # platform graders (supabase/functions/_shared/grading.ts) see raw rows
    # and cannot dedupe, so reducing over the deduped links would make the
    # engine and every surface that predicts it disagree by construction. A
    # duplicate (supplier, material) row is extra volume quoted at its own
    # price, which is what the weighted mean should say.
    links_by_key: dict[tuple[str, str], SupplierLink] = {}
    cheapest_cost: dict[str, float] = {}
    vol_price_num: dict[str, float] = {}
    vol_price_den: dict[str, float] = {}
    mat_lt_dist = {m.id: m for m in data.materials}
    for arc in data.supply_arcs:
        # A master row is not what makes a material real — the BOM is. An arc
        # whose material the BOM consumes counts even with no row in
        # `materials`, which is what makes the BOM-only branch below reachable
        # (§4 D166). An arc for a material NOTHING consumes is still noise and
        # is still dropped.
        if arc.material_id not in mat_ids and arc.material_id not in bom_mat_ids:
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
            cost=cost, lead_time_weeks=int(_clamp(
                round(lt_weeks), 1, 51, w=w, field="lead_time", unit=" wk",
                entity=f"supply:{arc.supplier_id}->{arc.material_id}")),
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
        # `time_unit` describes the VOLUME period (§3), so the weight is a
        # weekly rate. A zero/absent/negative volume is no weight at all
        # rather than an epsilon one: the lane is excluded from the mean, and
        # a material with no weighted lane at all falls through to cheapest.
        weekly_vol = _rate_to_weekly(float(arc.volume or 0.0), arc.time_unit)
        if weekly_vol > 0:
            vol_price_num[arc.material_id] = vol_price_num.get(arc.material_id, 0.0) + cost * weekly_vol
            vol_price_den[arc.material_id] = vol_price_den.get(arc.material_id, 0.0) + weekly_vol

    def _inbound_cost(material_id: str) -> Optional[tuple[float, str]]:
        """The material's inbound-derived cost and the reducer that derived it.

        `None` when the material has no inbound arc at all — the caller then
        applies the terminal 1.0 and warns. Mirrored by
        `volume_weighted_inbound_price` / `cheapest_inbound_price` in
        supabase/functions/_shared/grading.ts.
        """
        den = vol_price_den.get(material_id, 0.0)
        if den > 0:
            return vol_price_num[material_id] / den, "volume_weighted_inbound_price"
        if material_id in cheapest_cost:
            return cheapest_cost[material_id], "cheapest_inbound_price"
        return None

    links = list(links_by_key.values())

    # BOM materials with no source link cannot be simulated. Since D166 this
    # says what it always claimed: a material here has NO inbound arc at all,
    # rather than merely no master row.
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
        elif (derived := _inbound_cost(m.id)) is not None:
            cost, via = derived
            w.append(MappingWarning(
                "info", f"material:{m.id}", "cost",
                "no master cost → using volume-weighted inbound price"
                if via == "volume_weighted_inbound_price"
                else "no master cost and no inbound volumes → using cheapest supplier price"))
        else:
            cost = 1.0
            w.append(MappingWarning("warn", f"material:{m.id}", "cost",
                                    "no master cost and no supplier price → defaulted to 1.0"))
        hold_pct = m.holding_cost_pct if m.holding_cost_pct is not None else inv.get("holding_cost_pct")
        holding = _clamp(float(hold_pct) * 100.0, 5.0, 50.0, w=w, entity=f"material:{m.id}",
                         field="holding_cost_pct", unit=" %/yr") \
            if hold_pct is not None else 20.0
        materials.append(Material(
            id=m.id, name=str(m.name or m.id), cost=cost, holding_cost_rate=holding,
            initial_on_hand=(float(m.initial_on_hand) if m.initial_on_hand is not None else None),
        ))
    # Materials the BOM consumes that have no master row. REACHABLE since §4
    # D166 — before it, the arc filter above dropped their arcs, so the
    # `unsourced` check raised first and this loop could only ever see an empty
    # set. Same chain as above: a row with no master cannot have a master cost,
    # so the fallback is all it has, and every such material is NAMED rather
    # than quietly materialized (T1 — no number without a source).
    for mid in sorted(bom_mat_ids - {m.id for m in materials}):
        derived = _inbound_cost(mid)
        cost = derived[0] if derived else 1.0
        w.append(MappingWarning(
            "info", f"material:{mid}", "master_row",
            "no row in `materials` — simulated from its BOM and inbound lanes, "
            f"cost {'derived from those lanes' if derived else 'defaulted to 1.0'}; "
            "holding cost, MOQ and lead-time distribution take engine defaults"))
        materials.append(Material(id=mid, name=mid, cost=cost))

    # ── Products ──
    # The plant grid keys its production overrides "<focal plant>::<product>",
    # so the composite index is what makes a per-row line-capacity edit reach
    # the engine at all; the bare "node:<product>" form still wins nothing and
    # loses nothing (§4 D75).
    prod_composite = _composite_patches(data.policies, "production", prod_ids, w)
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
        customers=_build_customers(customers, data.customer_rows, w),
        customer_links=[
            CustomerLink(product_id=pid, customer_id=cid, share=share)
            for (pid, cid), share in sorted(cust_share.items()) if pid in prod_ids
        ],
    )

    settings = _build_settings(sc, w)
    events = _map_events(sc.disruption_schedule, sup_ids, cap_by_sup, w)
    # The engine extends replications under a sequential-CI rule only when the
    # scenario HAS events (`run_scenario` gates on `scenario.events`). A baseline
    # scenario with that rule ran its fixed count and said nothing (audit F-32).
    if (settings.replication_stopping == ReplicationStopping.SEQUENTIAL_CI
            and not events):
        w.append(MappingWarning(
            "warn", "scenario", "stopping_rule",
            f"sequential-CI stopping applies to disrupted scenarios only — this one has "
            f"no disruptions, so it ran a fixed {settings.model_seeds} replications"))
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


# ── The run window — ONE author, exported (audit 2026-09-22, F-02) ─────────────
#
# The Run-window card printed `horizon − warm-up` days as "measured" while the
# engine measured a fixed 52-week window after warm-up: 987 days claimed, 364
# measured, at the shipped defaults. The decision (§16 · audit WP 2) is to keep
# the engine's window and make the card print IT — so the rule lives here once,
# and `registry_export.run_window_rule()` hands it to the UI through
# `registry.generated.json`. Nothing in `src/` may restate 52.
HORIZON_WEEKS_FLOOR = 52
HORIZON_WEEKS_CEILING = 520
ANALYSIS_WINDOW_WEEKS = 52
ANALYSIS_WINDOW_MIN_WEEKS = 13
ANALYSIS_WINDOW_MAX_WEEKS = 156
ANALYSIS_WINDOW_TAIL_WEEKS = 13  # the horizon keeps this many weeks after the window


def analysis_window_weeks(horizon: int, w: list[MappingWarning]) -> int:
    """Weeks measured after warm-up. The engine then takes
    ``window_end = min(t_w + window, horizon)``, so a late warm-up can shorten it
    further at run time; that half is reported on the run, not here."""
    # The upper bound is a derived quantity, not a typed one; the clamp below is
    # what can change the window, and it says so.
    room = max(ANALYSIS_WINDOW_MIN_WEEKS, horizon - ANALYSIS_WINDOW_TAIL_WEEKS)
    hi = min(ANALYSIS_WINDOW_MAX_WEEKS, room)
    return int(_clamp(ANALYSIS_WINDOW_WEEKS, ANALYSIS_WINDOW_MIN_WEEKS, hi, w=w,
                      entity="scenario", field="analysis_window", unit=" wk", level="info"))


def _build_settings(sc: ScenarioSettings, w: list[MappingWarning]) -> SimulationSettings:
    # The horizon FLOOR stays `info`: raising a short horizon to one engine year
    # was always said. The ceiling was not, and is now `warn` like every other.
    horizon_weeks = round(sc.horizon_days / 7.0)
    horizon = int(_clamp(horizon_weeks, HORIZON_WEEKS_FLOOR, HORIZON_WEEKS_CEILING, w=w,
                         entity="scenario", field="horizon", unit=" wk",
                         level="info" if horizon_weeks < HORIZON_WEEKS_FLOOR else "warn"))
    ci_level = int(sc.ci_level) if sc.ci_level in (90, 95, 99) else 95
    if ci_level != sc.ci_level:
        w.append(MappingWarning("warn", "scenario", "ci_level",
                                f"{sc.ci_level}% is not a supported confidence level "
                                f"(90, 95, 99) → {ci_level}% used"))
    kwargs: dict[str, Any] = dict(
        project_seed=int(sc.seed), horizon=horizon,
        model_seeds=int(_clamp(sc.replications, 1, 200, w=w, entity="scenario",
                               field="replications")),
        crn_enabled=bool(sc.crn), ci_level=ci_level,
        analysis_window=analysis_window_weeks(horizon, w),
    )
    if str(sc.warmup_mode).lower() == "manual":
        kwargs["warmup_method"] = WarmupMethod.MANUAL
        kwargs["warmup_end"] = int(_clamp(round(sc.warmup_days / 7.0), 0, horizon // 2, w=w,
                                          entity="scenario", field="warmup", unit=" wk"))
    else:
        kwargs["warmup_method"] = WarmupMethod.MOST_CONSERVATIVE
    rule = (sc.stopping_rule or {}).get("kind", "")
    if str(rule) in ("sequential_ci", "sequential"):
        kwargs["replication_stopping"] = ReplicationStopping.SEQUENTIAL_CI
        eps = (sc.stopping_rule or {}).get("epsilon") or (sc.stopping_rule or {}).get("ci_halfwidth_target")
        if eps is not None:
            kwargs["ci_halfwidth_target"] = float(_clamp(
                float(eps), 0.01, 0.10, w=w, entity="scenario", field="stopping_rule.epsilon"))
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
            # Two different failures, said apart (acceptance audit 2026-09-23):
            # a target KIND the mapper cannot disrupt yet, versus a supplier id
            # this project simply does not have. The old single message blamed
            # "material/edge" even when the target was `supplier:primary`.
            kind = raw.split(":", 1)[0].lower() if ":" in raw else ""
            if kind in ("material", "edge", "customer", "lane"):
                w.append(MappingWarning("warn", f"event:{raw}", "target",
                                        f"{kind} targets cannot be disrupted yet (land later in M7) — event skipped"))
            else:
                w.append(MappingWarning("warn", f"event:{raw}", "target",
                                        f"no supplier or plant named {target!r} in this project's data — event skipped"))
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
            start=int(_clamp(int(start_week), 1, float("inf"), w=w, entity=f"event:{raw}",
                             field="start", unit=" wk")),
            duration=int(_clamp(dur_weeks, 1, 52, w=w, entity=f"event:{raw}",
                                field="duration", unit=" wk")),
        )
        if magnitude < 100.0:
            # Plant capacity is always finite (products carry production_capacity),
            # so a partial cut always throttles; suppliers need capacity_per_week.
            if is_plant or cap_by_sup.get(target) is not None:
                kwargs["effect_type"] = EffectType.CAPACITY_REDUCTION
                kwargs["capacity_factor"] = float(_clamp(
                    (100.0 - magnitude) / 100.0, 0.0, 0.999, w=w, entity=f"event:{target}",
                    field="magnitude", unit=" (remaining capacity share)"))
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


def _build_customers(
    ids: set[str], rows: list[CustomerRow], w: list[MappingWarning],
) -> list[Customer]:
    """Customer entities, with the attributes the `customers` table carries.

    ── WHAT THIS USED TO BE, AND WHY IT MATTERED (§4 D69) ────────────────────

        customers=[Customer(id=c, name=c) for c in sorted(customers)]

    The mapper never read the `customers` table. Every customer therefore
    arrived with the entity DEFAULTS — `segment="default"` and
    `priority_weight=1.0` — and two P-C.2 features were inert on every project:

      · `priority_weight` — `p_c2_customer_allocation` falls back to
        `Customer.priority_weight` when its `priority_weights` param does not
        name a customer, so the fallback was always 1.0 and the `priority`
        ordering could not order anything.
      · `segment` — worse, because it is silent in a second way. Every customer
        was in the segment `"default"`, so `sla_tiers`, which is keyed BY
        SEGMENT, matched nothing and every fill floor was 0.0. The engine
        already warned about this (`unknown_sla_segment` in P-C.2's
        feasibility), and the warning named the symptom while nothing named the
        cause: the segments it compared against were a constant.

    A user filling in a customer's priority or segment changed nothing, on every
    project, with no error. That is T1 — a displayed field that resolves to
    nothing — reaching all the way into the results.

    An id can legitimately have no row: the id set is the union of this table and
    the customer ids found on outbound arcs. Those keep the entity defaults, and
    say so, rather than being dropped.
    """
    by_id = {c.id: c for c in rows if c.id}
    unmatched = sorted(set(by_id) - ids)
    if unmatched:
        w.append(MappingWarning(
            "info", "customers", "customer_id",
            f"{len(unmatched)} customer row(s) describe ids that appear on no outbound "
            f"arc, so they have no demand to allocate: {unmatched[:5]}"))
    out: list[Customer] = []
    defaulted: list[str] = []
    for cid in sorted(ids):
        row = by_id.get(cid)
        if row is None:
            defaulted.append(cid)
            out.append(Customer(id=cid, name=cid))
            continue
        kwargs: dict[str, Any] = {"id": cid, "name": row.name or cid}
        # Only override an entity default when the table actually says something.
        # A NULL column is not a value, and writing `segment=None` would fail the
        # entity's own validation rather than fall back to "default".
        if row.segment:
            kwargs["segment"] = row.segment
        if row.priority_weight is not None:
            kwargs["priority_weight"] = float(row.priority_weight)
        out.append(Customer(**kwargs))
    # ONLY WHEN THE COVERAGE IS PARTIAL, and the E1 gate is what settled that.
    #
    # The first draft warned whenever any customer fell back, including when the
    # table supplied NO rows at all — and `test_e1_fully_specified_project_has_no
    # _silent_fallbacks` failed, correctly. E1's rule is that a fully-specified
    # project maps with no residue, and a project with no customer master data is
    # fully specified: the table is optional, and today nothing in the product
    # writes it (§4 D94), so EVERY project would have carried this note.
    #
    # What is worth saying is that the table describes SOME of these customers
    # and not the rest — that is a gap in data somebody is actively maintaining.
    # An empty table is the documented baseline, not a fallback anybody chose.
    if defaulted and by_id:
        w.append(MappingWarning(
            "info", "customers", "segment",
            f"the `customers` table describes {len(ids) - len(defaulted)} of this "
            f"project's customers but not {len(defaulted)} other(s), which keep "
            f"the engine defaults "
            f"(segment=default, priority_weight=1.0): {defaulted[:5]}"))
    return out


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

    # Surface per-node inventory overrides the engine will not apply.
    # inventory_control is resolved from policies["default"]["inventory"] only
    # (see `inv = default.get("inventory") or {}` below); node-scoped inventory
    # overrides are accepted into the snapshot/hash but never reach the engine.
    dropped_inventory = sum(
        1 for k, fams in policies.items()
        if isinstance(k, str) and k.startswith("node:")
        and (fams.get("inventory") or {})
    )
    if dropped_inventory:
        w.append(MappingWarning(
            "warn", "policy:inventory_control", "inventory",
            f"{dropped_inventory} per-node inventory override(s) not applied — "
            "inventory policy type, safety stock and FG stock are consumed at the "
            "project default scope only"))

    type_map = {
        "min_max": "min_max", "s_S": "min_max", "continuous_review": "min_max",
        "base_stock": "base_stock", "rop": "rop_q", "periodic_review": "periodic",
    }
    out["inventory_control"] = {"policy_type": type_map.get(str(inv.get("type", "min_max")), "min_max")}
    if out["inventory_control"]["policy_type"] == "rop_q" and inv.get("rop_q_quantity") is not None:
        out["inventory_control"]["rop_q_quantity"] = float(inv["rop_q_quantity"])
    w.append(MappingWarning("info", "policy:inventory_control", "order_up_to",
                            "legacy absolute order_up_to replaced by coverage-based κ (≈8 weeks)"))

    ss_method = str(inv.get("safety_stock_method", "fixed_days"))
    if ss_method in ("service_level", "demand_variability"):
        sl = float(inv.get("service_level_target", 0.95)) * 100.0
        out["safety_stock_materials"] = {"classification": "uniform",
                                         "uniform_service_level": _clamp(
                                             sl, 80.0, 99.9, w=w, entity="policy:default",
                                             field="service_level_target", unit=" %")}
    elif ss_method == "king_method":
        out["safety_stock_materials"] = {"classification": "king"}
    else:
        out["safety_stock_materials"] = {
            "classification": "fixed_days",
            "fixed_days_cover": _clamp(float(inv.get("safety_stock_days", 7.0)), 0.0, 84.0,
                                       w=w, entity="policy:default",
                                       field="safety_stock_days", unit=" d"),
        }

    if bool(fulfil.get("backorder_allowed", False)):
        out["unmet_demand_handling"] = {
            "rule": "backorder",
            "backorder_horizon": int(_clamp(
                round(float(fulfil.get("max_backorder_days", 14)) / 7.0), 0, 26, w=w,
                entity="policy:default", field="max_backorder_days", unit=" wk")),
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
                    str(k): _clamp(float(v) * 100.0, 0.0, 100.0, w=w,
                                   entity=f"policy:tier:{k}", field="tier_overrides", unit=" %")
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
                        float(inv.get("fg_service_level_target", 0.95)) * 100.0, 80.0, 99.9,
                        w=w, entity="policy:default", field="fg_service_level_target",
                        unit=" %"),
                    "segmentation": "uniform",
                }
            else:
                out["fg_safety_stock"] = {
                    "sizing": "fixed_days",
                    "fixed_days_cover": _clamp(
                        float(inv.get("fg_safety_stock_days", 2.0)), 0.0, 12.0, w=w,
                        entity="policy:default", field="fg_safety_stock_days", unit=" d"),
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
            "detection_lag_weeks": int(_clamp(round(days / 7.0), 0, 4, w=w,
                                              entity="policy:default",
                                              field="detection_lag_days", unit=" wk")),
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
