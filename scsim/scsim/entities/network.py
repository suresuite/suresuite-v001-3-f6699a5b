"""Network entities — Part III §3.1–3.6.

Three echelons: suppliers → plant (materials, BoM, products) → customers.
v1 is single-plant; the schema reserves extension points (plant_id on lanes,
``Supplier.tier``) so Tier-2/3 propagation lands as a Tier-2/3 governance
change, not a rewrite.

Behavior-neutral defaults on :class:`Lane` guarantee exact manuscript
reproduction until edge features are switched on (§3.6).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from scsim.entities.enums import (
    DemandModel,
    FgPolicy,
    ForecastModel,
    FulfillmentMode,
    LeadTimeDist,
    SupplierProfile,
    TransportMode,
)


def _meta(unit: str, scope: str, notes: str = "") -> dict:
    return {"unit": unit, "scope": scope, "notes": notes}


def triangular_av(average: float, variability: float) -> tuple[float, float, float]:
    """AnyLogic-style ``triangularAV`` — a symmetric triangular distribution
    expressed as "average ± variability" rather than explicit (min, mode, max).

    ``AV`` stands for *Average & Variability*. The mode is the average and the
    half-range is ``variability`` (a fraction in [0, 1]) of the average::

        triangularAV(avg, v) = triangular(avg·(1−v), avg, avg·(1+v))

    The lower bound is floored at 0 (demand cannot be negative), so for v > 1 the
    left tail clamps to 0 while the mode stays at the average.

    Returns the ``(a, b, c)`` triple consumed by the triangular demand sampler.
    """
    return (max(0.0, average * (1.0 - variability)), average, average * (1.0 + variability))


class Supplier(BaseModel):
    """Supplier echelon — §3.5."""

    model_config = ConfigDict(validate_assignment=True)

    id: str = Field(..., min_length=1, json_schema_extra=_meta("id", "S"))
    name: str = Field("", json_schema_extra=_meta("-", "S"))
    capacity_per_week: Optional[float] = Field(
        None, gt=0,
        json_schema_extra=_meta(
            "units/wk", "S",
            "None = ∞ (manuscript). Finite required for capacity_reduction events and P-S.3.",
        ),
    )
    reliability_score: float = Field(
        1.0, ge=0.0, le=1.0,
        json_schema_extra=_meta("-", "S", "Selection-rule input (P-S.1 reliability rule)."),
    )
    tier: int = Field(
        1, ge=1, le=3,
        json_schema_extra=_meta("-", "S", "Reserved extension point; v1 simulates tier 1 only."),
    )


class SupplierLink(BaseModel):
    """Qualified (supplier × material) source — §3.4/§3.5 SM-scoped variables."""

    model_config = ConfigDict(validate_assignment=True)

    supplier_id: str
    material_id: str
    cost: float = Field(
        ..., gt=0, json_schema_extra=_meta("€/unit", "SM", "c_{m,s}"),
    )
    lead_time_weeks: int = Field(
        ..., ge=1, le=51,
        json_schema_extra=_meta("weeks", "SM", "T_s; includes transport in v1."),
    )
    lead_time_dist: LeadTimeDist = Field(
        LeadTimeDist.DETERMINISTIC,
        json_schema_extra=_meta(
            "enum", "SM",
            "Stochastic lead times consume the world leadtime stream only when an order "
            "is placed; CRN caveat documented in docs/statistics.md.",
        ),
    )
    lead_time_cv: float = Field(
        0.0, ge=0.0, le=1.0,
        json_schema_extra=_meta("-", "SM", "CV for lognormal/gamma lead-time dists."),
    )
    moq: float = Field(
        0.0, ge=0,
        json_schema_extra=_meta("units", "SM", "Q_MOQ — minimum order quantity."),
    )


class Material(BaseModel):
    """Plant material master — §3.4."""

    model_config = ConfigDict(validate_assignment=True)

    id: str = Field(..., min_length=1, json_schema_extra=_meta("id", "M"))
    name: str = Field("", json_schema_extra=_meta("-", "M"))
    cost: float = Field(
        ..., gt=0, json_schema_extra=_meta("€/unit", "M", "c_m at the primary source."),
    )
    holding_cost_rate: float = Field(
        20.0, ge=5.0, le=50.0,
        json_schema_extra=_meta("%/yr of c_m", "G/M", "h_m"),
    )
    initial_on_hand: Optional[float] = Field(
        None, ge=0,
        json_schema_extra=_meta(
            "units", "M",
            "None → initialized to the order-up-to level S_m at t=0 (warm start).",
        ),
    )


class BomLine(BaseModel):
    """r_{p,m} — §3.2. ALL listed materials are required (hard constraint, Eq. 8)."""

    product_id: str
    material_id: str
    rate: float = Field(
        ..., gt=0, json_schema_extra=_meta("units m / unit p", "P×M", "r_{p,m}"),
    )


class Product(BaseModel):
    """Product + demand model + fulfillment mode (CODP) — §3.1–3.3."""

    model_config = ConfigDict(validate_assignment=True)

    id: str = Field(..., min_length=1, json_schema_extra=_meta("id", "P"))
    name: str = Field("", json_schema_extra=_meta("-", "P"))
    unit_price: float = Field(
        ..., gt=0, json_schema_extra=_meta("€/unit", "P", "u_p"),
    )

    # Demand model (§3.1). b = historical median, c = historical max,
    # a = max{0, (1−ν)·b} when not given explicitly.
    demand_model: DemandModel = Field(
        DemandModel.TRIANGULAR, json_schema_extra=_meta("enum", "P"),
    )
    demand_mode: float = Field(
        ..., ge=0,
        json_schema_extra=_meta(
            "units/wk", "P",
            "b_p — historical median; the average (mode) of the triangularAV demand form.",
        ),
    )
    demand_min: Optional[float] = Field(
        None, ge=0,
        json_schema_extra=_meta("units/wk", "P", "a_p; default max{0,(1−ν)·b_p}."),
    )
    demand_max: Optional[float] = Field(
        None, ge=0,
        json_schema_extra=_meta("units/wk", "P", "c_p — historical max; default (1+ν)·b_p."),
    )
    demand_floor_factor: Optional[float] = Field(
        None, ge=0.0, le=1.0,
        json_schema_extra=_meta(
            "-", "P",
            "ν override; falls back to the global setting. Acts as the variability of the "
            "triangularAV demand form: triangular(b·(1−ν), b, b·(1+ν)).",
        ),
    )
    demand_history: list[float] = Field(
        default_factory=list,
        json_schema_extra=_meta("units/wk", "P", "Required for demand_model=bootstrap."),
    )
    negbin_dispersion: float = Field(
        1.0, gt=0,
        json_schema_extra=_meta("-", "P", "k for negbin (variance = b + b²/k)."),
    )

    # Plant — §3.2.
    production_capacity: float = Field(
        ..., gt=0, json_schema_extra=_meta("units/wk", "P", "O_p"),
    )

    # Fulfillment mode (CODP) — §3.3. MTO is the validated core; MTS is M7.
    fulfillment_mode: FulfillmentMode = Field(
        FulfillmentMode.MTO, json_schema_extra=_meta("enum", "P"),
    )
    fg_policy: FgPolicy = Field(FgPolicy.BASE_STOCK, json_schema_extra=_meta("enum", "P", "MTS only."))
    fg_base_stock: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta("units", "P", "S^FG_p; derived if None. MTS only."),
    )
    forecast_model: ForecastModel = Field(
        ForecastModel.MA, json_schema_extra=_meta("enum", "P", "MTS plans to forecast."),
    )
    forecast_window: int = Field(
        8, ge=2, le=26, json_schema_extra=_meta("weeks", "P"),
    )
    forecast_bias: float = Field(
        0.0, ge=-30.0, le=30.0,
        json_schema_extra=_meta("%", "P", "Experimental mis-forecast lever."),
    )

    @model_validator(mode="after")
    def _check(self) -> "Product":
        if self.demand_model == DemandModel.TRIANGULAR:
            b = self.demand_mode
            a = self.demand_min if self.demand_min is not None else 0.0
            c = self.demand_max if self.demand_max is not None else b
            if self.demand_min is not None and a > b:
                raise ValueError(f"product {self.id}: demand_min > demand_mode")
            if self.demand_max is not None and c < b:
                raise ValueError(f"product {self.id}: demand_max < demand_mode")
        if self.demand_model == DemandModel.BOOTSTRAP and not self.demand_history:
            raise ValueError(f"product {self.id}: bootstrap demand requires demand_history")
        return self

    @classmethod
    def with_triangular_av(
        cls, *, average: float, variability: float, **kwargs: object
    ) -> "Product":
        """Build a product whose demand is the triangularAV form — "average ±
        variability" — instead of explicit (min, mode, max). Equivalent to
        ``triangular(average·(1−v), average, average·(1+v))`` (see
        :func:`triangular_av`)."""
        a, b, c = triangular_av(average, variability)
        return cls(
            demand_model=DemandModel.TRIANGULAR,
            demand_mode=b, demand_min=a, demand_max=c,
            **kwargs,  # type: ignore[arg-type]
        )

    def triangular_params(self, global_floor_factor: float) -> tuple[float, float, float]:
        """(a, b, c) with the ν floor correction applied.

        With ``demand_min``/``demand_max`` left at their defaults this is exactly
        the triangularAV form ``triangular_av(demand_mode, ν)``; explicit bounds
        override the symmetric default.
        """
        nu = self.demand_floor_factor if self.demand_floor_factor is not None else global_floor_factor
        a_av, b, c_av = triangular_av(self.demand_mode, nu)
        a = self.demand_min if self.demand_min is not None else a_av
        c = self.demand_max if self.demand_max is not None else c_av
        return a, b, max(c, b)

    def mean_demand(self, global_floor_factor: float) -> float:
        if self.demand_model == DemandModel.TRIANGULAR:
            a, b, c = self.triangular_params(global_floor_factor)
            return (a + b + c) / 3.0
        if self.demand_model == DemandModel.BOOTSTRAP and self.demand_history:
            return float(sum(self.demand_history) / len(self.demand_history))
        return self.demand_mode


class Customer(BaseModel):
    """Customer segments — §3.1. Needed by P-C.2; inert for single-customer MTO."""

    id: str = Field(..., min_length=1)
    name: str = ""
    segment: str = Field("default", json_schema_extra=_meta("-", "C", "≤10 segments."))
    priority_weight: float = Field(1.0, ge=0)


class CustomerLink(BaseModel):
    """Outbound demand edge — which customer buys which product, and how much.

    ``share`` is a relative weight (e.g. the outbound arc's weekly volume);
    shares are normalized per product at compile time. Products with no links
    default to a uniform split across all customers, so the field is
    behavior-neutral until P-C.2 customer_allocation reads it."""

    product_id: str = Field(..., min_length=1)
    customer_id: str = Field(..., min_length=1)
    share: float = Field(1.0, gt=0, json_schema_extra=_meta(
        "relative weight", "PC", "Normalized per product at compile."))


class Lane(BaseModel):
    """Transport edge — §3.6. Transit time composes into the effective link
    lead time at compile (default 0 = behavior-neutral); per-mode pipelines
    and lane capacity land with P-T.1."""

    model_config = ConfigDict(validate_assignment=True)

    id: str = Field(..., min_length=1, json_schema_extra=_meta("id", "E"))
    supplier_id: str
    plant_id: str = Field("plant", json_schema_extra=_meta("id", "E", "v1 single plant."))
    mode: TransportMode = Field(TransportMode.DEFAULT, json_schema_extra=_meta("enum", "E"))
    lead_time_weeks: int = Field(
        0, ge=0, le=26,
        json_schema_extra=_meta("weeks", "E", "T_E transit leg, added to the supplier link's "
                                              "lead time at compile; 0 = behavior-neutral."),
    )
    capacity_per_week: Optional[float] = Field(
        None, gt=0, json_schema_extra=_meta("units/wk", "E", "None = ∞."),
    )
    cost_per_unit: float = Field(0.0, ge=0, json_schema_extra=_meta("€/unit", "E"))


class Network(BaseModel):
    """The three-echelon world: validated entity sets + derived supplier typology."""

    model_config = ConfigDict(validate_assignment=True)

    suppliers: list[Supplier] = Field(..., min_length=1, max_length=500)
    materials: list[Material] = Field(..., min_length=1, max_length=5000)
    products: list[Product] = Field(..., min_length=1, max_length=500)
    bom: list[BomLine] = Field(..., min_length=1)
    supplier_links: list[SupplierLink] = Field(..., min_length=1)
    customers: list[Customer] = Field(default_factory=list, max_length=10_000)
    customer_links: list[CustomerLink] = Field(default_factory=list)
    lanes: list[Lane] = Field(default_factory=list)

    # Supplier-profile classifier thresholds (configurable; §3.5).
    multi_sourcing_threshold_pct: float = Field(50.0, ge=0, le=100)

    @model_validator(mode="after")
    def _check(self) -> "Network":
        sup_ids = {s.id for s in self.suppliers}
        mat_ids = {m.id for m in self.materials}
        prod_ids = {p.id for p in self.products}
        if len(sup_ids) != len(self.suppliers):
            raise ValueError("duplicate supplier ids")
        if len(mat_ids) != len(self.materials):
            raise ValueError("duplicate material ids")
        if len(prod_ids) != len(self.products):
            raise ValueError("duplicate product ids")

        for link in self.supplier_links:
            if link.supplier_id not in sup_ids:
                raise ValueError(f"supplier_link references unknown supplier {link.supplier_id!r}")
            if link.material_id not in mat_ids:
                raise ValueError(f"supplier_link references unknown material {link.material_id!r}")
        link_keys = {(l.supplier_id, l.material_id) for l in self.supplier_links}
        if len(link_keys) != len(self.supplier_links):
            raise ValueError("duplicate (supplier, material) links")

        sourced = {l.material_id for l in self.supplier_links}
        unsourced = mat_ids - sourced
        if unsourced:
            raise ValueError(f"materials with no qualified supplier: {sorted(unsourced)[:5]}")

        bom_products = set()
        for line in self.bom:
            if line.product_id not in prod_ids:
                raise ValueError(f"bom references unknown product {line.product_id!r}")
            if line.material_id not in mat_ids:
                raise ValueError(f"bom references unknown material {line.material_id!r}")
            bom_products.add(line.product_id)
        missing_bom = prod_ids - bom_products
        if missing_bom:
            raise ValueError(f"products with empty BoM: {sorted(missing_bom)[:5]}")
        bom_keys = {(l.product_id, l.material_id) for l in self.bom}
        if len(bom_keys) != len(self.bom):
            raise ValueError("duplicate (product, material) BoM lines")

        for lane in self.lanes:
            if lane.supplier_id not in sup_ids:
                raise ValueError(f"lane {lane.id!r} references unknown supplier {lane.supplier_id!r}")

        cust_ids = {c.id for c in self.customers}
        if len(cust_ids) != len(self.customers):
            raise ValueError("duplicate customer ids")
        for cl in self.customer_links:
            if cl.product_id not in prod_ids:
                raise ValueError(f"customer_link references unknown product {cl.product_id!r}")
            if cl.customer_id not in cust_ids:
                raise ValueError(f"customer_link references unknown customer {cl.customer_id!r}")
        cl_keys = {(l.product_id, l.customer_id) for l in self.customer_links}
        if len(cl_keys) != len(self.customer_links):
            raise ValueError("duplicate (product, customer) links")
        return self

    # ------------------------------------------------------------------ derived

    def supplier_options(self, material_id: str) -> list[SupplierLink]:
        """𝒮_m, sorted by (cost, lead time, id) — primary supplier is first (min cost)."""
        opts = [l for l in self.supplier_links if l.material_id == material_id]
        return sorted(opts, key=lambda l: (l.cost, l.lead_time_weeks, l.supplier_id))

    def primary_link(self, material_id: str) -> SupplierLink:
        return self.supplier_options(material_id)[0]

    def multi_sourcing_rate(self, supplier_id: str) -> float:
        """ρ_s — % of s's materials that have at least one alternative source."""
        own = [l.material_id for l in self.supplier_links if l.supplier_id == supplier_id]
        if not own:
            return 0.0
        counts = {m: 0 for m in own}
        for l in self.supplier_links:
            if l.material_id in counts:
                counts[l.material_id] += 1
        with_alt = sum(1 for m in own if counts[m] > 1)
        return 100.0 * with_alt / len(own)

    def supplier_profile(self, supplier_id: str) -> SupplierProfile:
        rho = self.multi_sourcing_rate(supplier_id)
        if rho == 0.0:
            return SupplierProfile.SINGLE_SOURCED
        if rho < self.multi_sourcing_threshold_pct:
            return SupplierProfile.LOW_MULTI
        return SupplierProfile.HIGH_MULTI

    def shared_material_index(self) -> float:
        """Fraction of materials consumed by >1 product (P-P.9 value scales with this)."""
        consumers: dict[str, set[str]] = {}
        for line in self.bom:
            consumers.setdefault(line.material_id, set()).add(line.product_id)
        if not consumers:
            return 0.0
        return sum(1 for v in consumers.values() if len(v) > 1) / len(consumers)
