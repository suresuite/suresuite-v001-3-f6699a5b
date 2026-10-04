# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Network entities — Part III §3.1–3.6.

Three echelons: suppliers → plant (materials, BoM, products) → customers.
v1 is single-plant; the schema reserves extension points (plant_id on lanes,
``Supplier.tier``) so Tier-2/3 propagation lands as a Tier-2/3 governance
change, not a rewrite.

Behavior-neutral defaults on :class:`Lane` guarantee exact manuscript
reproduction until edge features are switched on (§3.6).
"""
from __future__ import annotations

from typing import Literal, Optional

import numpy as np

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


RowDemandModel = Literal["deterministic", "normal", "triangular", "triangular_av", "poisson"]


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
            "Stochastic lead times are pre-drawn per (link, week) from the world leadtime "
            "stream, so CRN pairing holds across policies (docs/statistics.md).",
        ),
    )
    lead_time_cv: float = Field(
        0.0, ge=0.0, le=1.0,
        json_schema_extra=_meta("-", "SM", "CV for normal/lognormal/gamma lead-time dists."),
    )
    # PLAN.md §25 WP 15.1 — the bounded shapes (triangular, uniform). The link's
    # `lead_time_weeks` stays its PLANNING lead time and must lie inside the
    # bounds; the mapper sets it to the bounds' mean (§25.2 rule 3).
    lead_time_min_weeks: Optional[float] = Field(
        None, ge=0, le=51,
        json_schema_extra=_meta("weeks", "SM", "Lower bound (triangular, uniform)."),
    )
    lead_time_mode_weeks: Optional[float] = Field(
        None, ge=0, le=51,
        json_schema_extra=_meta("weeks", "SM", "Most likely value (triangular)."),
    )
    lead_time_max_weeks: Optional[float] = Field(
        None, ge=0, le=51,
        json_schema_extra=_meta("weeks", "SM", "Upper bound (triangular, uniform)."),
    )
    moq: float = Field(
        0.0, ge=0,
        json_schema_extra=_meta("units", "SM", "Q_MOQ — minimum order quantity."),
    )
    primary: bool = Field(
        False,
        json_schema_extra=_meta(
            "-", "SM",
            "Chosen primary source for its material (the /policies Supplier stage). "
            "False everywhere → the manuscript rule: min cost, then lead time, then id.",
        ),
    )

    @model_validator(mode="after")
    def _check_lead_time_shape(self) -> "SupplierLink":
        check_lead_time_shape(
            f"supply:{self.supplier_id}->{self.material_id}", self.lead_time_dist,
            self.lead_time_min_weeks, self.lead_time_mode_weeks, self.lead_time_max_weeks,
            planning=self.lead_time_weeks, planning_floor=1, what="lead_time_weeks")
        return self


def check_lead_time_shape(label: str, d: LeadTimeDist, lo: Optional[float], mo: Optional[float],
                          hi: Optional[float], *, planning: int, planning_floor: int,
                          what: str) -> None:
    """One validation for every lead-time shape (PLAN.md §25 WP 15.1 / 15.4): a
    supplier link's and a product's production lead time. A bounded shape needs
    its bounds in order and its planning lead time inside them (the mapper
    derives it as their mean, §25.2 rule 3); any other shape carries no bounds."""
    if d == LeadTimeDist.TRIANGULAR:
        if lo is None or mo is None or hi is None:
            raise ValueError(f"{label}: a triangular lead time needs min, mode and max")
        if not lo <= mo <= hi:
            raise ValueError(f"{label}: a triangular lead time needs min ≤ mode ≤ max, got "
                             f"{lo:g} / {mo:g} / {hi:g}")
    elif d == LeadTimeDist.UNIFORM:
        if lo is None or hi is None:
            raise ValueError(f"{label}: a uniform lead time needs min and max")
        if not lo <= hi:
            raise ValueError(f"{label}: a uniform lead time needs min ≤ max, got "
                             f"{lo:g} / {hi:g}")
        if mo is not None:
            raise ValueError(f"{label}: a uniform lead time has no mode")
    elif lo is not None or mo is not None or hi is not None:
        raise ValueError(f"{label}: lead-time bounds apply to triangular and uniform only, "
                         f"not {d.value}")
    if d in (LeadTimeDist.TRIANGULAR, LeadTimeDist.UNIFORM):
        if not (int(lo) <= planning <= max(planning_floor, int(np.ceil(hi)))):
            raise ValueError(f"{label}: {what} {planning} lies outside the lead-time bounds "
                             f"[{lo:g}, {hi:g}]")


def lead_time_bounds_mean(dist: LeadTimeDist, lo: float, mode: Optional[float],
                          hi: float) -> float:
    """The mean of a bounded lead-time shape — its planning lead time (§25.2
    rule 3): (min + mode + max)/3 for triangular, (min + max)/2 for uniform."""
    if dist == LeadTimeDist.TRIANGULAR:
        return (lo + float(mode) + hi) / 3.0
    return (lo + hi) / 2.0


def lead_time_bounds_cv(dist: LeadTimeDist, lo: float, mode: Optional[float],
                        hi: float) -> float:
    """The coefficient of variation of a bounded shape — what P-P.3's King
    formula reads as σ_LT / μ_LT for a lognormal or gamma link's CV."""
    mean = lead_time_bounds_mean(dist, lo, mode, hi)
    if mean <= 0:
        return 0.0
    if dist == LeadTimeDist.TRIANGULAR:
        c = float(mode)
        var = (lo * lo + c * c + hi * hi - lo * c - lo * hi - c * hi) / 18.0
    else:
        var = (hi - lo) ** 2 / 12.0
    return float(np.sqrt(max(var, 0.0)) / mean)


def primary_rank(link: SupplierLink) -> tuple:
    """Sort key whose first element per material is that material's PRIMARY link.

    A link the user chose (`primary=True`, the /policies Supplier stage) ranks
    first; otherwise the manuscript rule (§3.5) — min cost, then shortest lead
    time, then supplier id. The ONE statement of the rule: `CompiledModel`,
    `Network.supplier_options` and P-P.1's planning lead times all sort by it,
    so the three cannot pick different primaries.
    """
    return (not link.primary, link.cost, link.lead_time_weeks, link.supplier_id)


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
            "None → warm start at t=0: on hand = S_m − E[D_m]·T_s = E[D_m]·κ + "
            "safety stock, pipeline primed so position = S_m.",
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
    demand_cv: Optional[float] = Field(
        None, ge=0,
        json_schema_extra=_meta(
            "-", "P",
            "Coefficient of variation for demand_model=normal: σ = cv · demand_mode. "
            "Negative draws are set to 0 and counted (ADR 0002, decision 8). Read only "
            "by normal; triangular uses demand_floor_factor / explicit bounds."),
    )

    # Plant — §3.2.
    production_capacity: float = Field(
        ..., gt=0, json_schema_extra=_meta("units/wk", "P", "O_p"),
    )

    # Fulfillment mode (CODP) — §3.3. MTO is the validated core; MTS is M7.
    fulfillment_mode: FulfillmentMode = Field(
        FulfillmentMode.MTO, json_schema_extra=_meta("enum", "P"),
    )
    # FG inventory policy (WP 14.4, ADR 0002 decision 3; design doc §3.2). All
    # levels are END-OF-WEEK finished-goods targets, MTS only. ONE SOURCE PER
    # NUMBER: a typed level IS the target and P-P.4 adds nothing on top; P-P.4
    # sizes the buffer only for base_stock with S empty (today's derivation).
    fg_policy: FgPolicy = Field(
        FgPolicy.BASE_STOCK, json_schema_extra=_meta(
            "enum", "P", "base_stock (S) · min_max (s, S) · days_of_cover (D). MTS only."))
    fg_base_stock: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "units", "P", "S^FG_p: the order-up-to level (base_stock, min_max); derived if None "
                          "under base_stock. MTS only."),
    )
    fg_reorder_point: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "units", "P", "s: min_max only — produce up to S when the stock left after this "
                          "week's demand falls below s."),
    )
    fg_cover_days: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "days", "P", "D: days_of_cover only — target = D/7 × projected weekly demand; "
                         "moves with the forecast."),
    )
    fg_initial_on_hand: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "units", "P", "FG opening stock (engine RFC 4). None = start at the policy target."),
    )
    # P-P.13 production lead time (PLAN.md §25 WP 15.4, ADR 0003): output started
    # in week t completes in week t + L. 0 = same-week completion, today's
    # behaviour (W^FG = 0 by default). The same shapes as a supplier lead time,
    # drawn per (product, week) from their own world stream; a bounded shape's
    # planning L is its mean. Materials are consumed at the start.
    production_lead_time_weeks: int = Field(
        0, ge=0, le=26, json_schema_extra=_meta(
            "weeks", "P", "L_p: the planning production lead time. 0 = completes in the week "
                          "it starts (byte-identical to an engine without it)."),
    )
    production_lead_time_dist: LeadTimeDist = Field(
        LeadTimeDist.DETERMINISTIC, json_schema_extra=_meta(
            "enum", "P", "Shape of the production lead time; drawn per (product, week) from "
                         "the world production-time stream (CRN)."),
    )
    production_lead_time_cv: float = Field(
        0.0, ge=0.0, le=1.0, json_schema_extra=_meta(
            "-", "P", "CV for normal/lognormal/gamma production lead times."),
    )
    production_lead_time_min_weeks: Optional[float] = Field(
        None, ge=0, le=26, json_schema_extra=_meta("weeks", "P", "Lower bound (triangular, uniform)."),
    )
    production_lead_time_mode_weeks: Optional[float] = Field(
        None, ge=0, le=26, json_schema_extra=_meta("weeks", "P", "Most likely value (triangular)."),
    )
    production_lead_time_max_weeks: Optional[float] = Field(
        None, ge=0, le=26, json_schema_extra=_meta("weeks", "P", "Upper bound (triangular, uniform)."),
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
        if self.fg_policy == FgPolicy.MIN_MAX:
            if self.fg_base_stock is None or self.fg_reorder_point is None:
                raise ValueError(f"product {self.id}: fg_policy=min_max needs fg_reorder_point (s) "
                                 f"and fg_base_stock (S)")
            if self.fg_reorder_point >= self.fg_base_stock:
                raise ValueError(f"product {self.id}: fg_policy=min_max needs s < S "
                                 f"({self.fg_reorder_point} ≥ {self.fg_base_stock})")
        if self.fg_policy == FgPolicy.DAYS_OF_COVER and self.fg_cover_days is None:
            raise ValueError(f"product {self.id}: fg_policy=days_of_cover needs fg_cover_days (D)")
        if self.demand_model == DemandModel.NORMAL and self.demand_cv is None:
            raise ValueError(f"product {self.id}: normal demand requires demand_cv "
                             f"(σ = cv · demand_mode)")
        if self.production_lead_time_dist == LeadTimeDist.EMPIRICAL:
            raise ValueError(f"product {self.id}: an empirical production lead time is reserved "
                             f"(observations tier), not selectable")
        check_lead_time_shape(
            f"product {self.id}", self.production_lead_time_dist,
            self.production_lead_time_min_weeks, self.production_lead_time_mode_weeks,
            self.production_lead_time_max_weeks, planning=self.production_lead_time_weeks,
            planning_floor=0, what="production_lead_time_weeks")
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
    # WP 14.3 (ADR 0002 decision 4): the customer's contracted fill floor, the
    # default service target of each of its rows under the `sla_tier` rule.
    # None = no contracted floor (NOT 0): the segment's `sla_tiers` floor applies.
    sla_fill_floor_pct: Optional[float] = Field(
        None, ge=0, le=100, json_schema_extra=_meta(
            "%", "C", "Default per-row service target under sla_tier; None = the segment floor."))


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

    # ── Demand per customer × product row (P-C.4 demand_model, WP 14.1) ──────
    # ADR 0002 decision 2. A row either carries a FORECAST series (the per-week
    # centre of its distribution) or a demand MODEL (mean + variation +
    # distribution). A row that sets neither keeps today's behaviour: its
    # product's distribution, scaled by the row's share. If NO row of the
    # network carries a spec, demand is drawn per product exactly as before.
    demand_model: Optional[RowDemandModel] = Field(
        None, json_schema_extra=_meta(
            "enum", "PC",
            "deterministic | normal | triangular | triangular_av | poisson. None = the "
            "product's distribution scaled by share."))
    demand_mean: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "units/wk", "PC",
            "The row's mean (the mode for triangular). Past the end of a forecast it is "
            "the value the plan uses."))
    demand_variation: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "-", "PC",
            "Interpreted by model: normal → coefficient of variation (σ = cv · centre); "
            "triangular_av → ± fraction of the centre; ignored by deterministic, poisson "
            "and triangular (whose bounds are explicit)."))
    demand_min: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta("units/wk", "PC", "triangular only: the lower bound."))
    demand_max: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta("units/wk", "PC", "triangular only: the upper bound."))
    # WP 14.3 (ADR 0002 decision 4): the row's own price — what `revenue_max`
    # orders rows by and what values the row's fill rate. None = the product's
    # unit_price.
    unit_price: Optional[float] = Field(
        None, ge=0, json_schema_extra=_meta(
            "€/unit", "PC", "The row's sell price; None = the product's unit_price."))
    forecast: Optional[list[float]] = Field(
        None, json_schema_extra=_meta(
            "units/wk", "PC",
            "One value per simulated week from week 0: the centre of that week's "
            "distribution, and what the plan reads. Past its end the row uses "
            "demand_mean if set, else the last value (with a warning)."))

    @property
    def has_demand_spec(self) -> bool:
        return self.demand_model is not None or self.forecast is not None

    @model_validator(mode="after")
    def _check_demand(self) -> "CustomerLink":
        row = f"customer row {self.customer_id}::{self.product_id}"
        if self.forecast is not None:
            if len(self.forecast) == 0:
                raise ValueError(f"{row}: forecast is empty — omit it, or give one value per week")
            if any((not isinstance(v, (int, float))) or v != v or v < 0 for v in self.forecast):
                raise ValueError(f"{row}: forecast values must be finite and ≥ 0")
        model = self.demand_model
        if model is None:
            if self.forecast is None and any(
                    v is not None for v in (self.demand_mean, self.demand_variation,
                                            self.demand_min, self.demand_max)):
                raise ValueError(f"{row}: demand parameters given without a demand_model")
            return self
        has_centre = self.forecast is not None or self.demand_mean is not None
        if model in ("deterministic", "poisson", "normal", "triangular_av") and not has_centre:
            raise ValueError(f"{row}: {model} demand needs demand_mean or a forecast")
        if model == "normal" and self.demand_variation is None:
            raise ValueError(f"{row}: normal demand needs demand_variation (the CV, σ = cv · centre)")
        if model == "triangular_av" and self.demand_variation is None:
            raise ValueError(f"{row}: triangular_av demand needs demand_variation (the ± fraction)")
        if model == "triangular_av" and self.demand_variation is not None and self.demand_variation > 1:
            raise ValueError(f"{row}: triangular_av's ± fraction must be ≤ 1, got "
                             f"{self.demand_variation:g}")
        if model == "triangular":
            if self.demand_min is None or self.demand_max is None or self.demand_mean is None:
                raise ValueError(f"{row}: triangular demand needs demand_min, demand_mean (the "
                                 f"mode) and demand_max")
            if not self.demand_min <= self.demand_mean <= self.demand_max:
                raise ValueError(f"{row}: triangular demand needs demand_min ≤ demand_mean ≤ "
                                 f"demand_max, got {self.demand_min:g} / {self.demand_mean:g} / "
                                 f"{self.demand_max:g}")
            if self.forecast is not None and self.demand_mean + self.demand_min + self.demand_max <= 0:
                raise ValueError(f"{row}: a triangular forecast row needs a triangle with a "
                                 f"positive mean to scale")
        elif self.demand_min is not None or self.demand_max is not None:
            raise ValueError(f"{row}: demand_min / demand_max apply to triangular only, not {model}")
        return self


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
        """𝒮_m in primary order (`primary_rank`) — the primary supplier is first."""
        opts = [l for l in self.supplier_links if l.material_id == material_id]
        return sorted(opts, key=primary_rank)

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
