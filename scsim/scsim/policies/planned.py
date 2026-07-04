"""Planned (🧩) policy catalog entries — Part IV, milestones M7/M8.

Each entry registers the full parameter schema so the registry, the
generated docs, and the frontend forms cover the complete 21-policy
catalog. Compiling a scenario that enables one raises
``PolicyNotImplementedError`` with the milestone reference — planned
policies never silently no-op (Risk R8).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from scsim.entities.enums import ConstraintTag, Stage, StrategyClass
from scsim.policies.base import PolicyParams
from scsim.policies.registry import register_planned


# --------------------------------------------------------------------- 4.1

class LotSizingParams(PolicyParams):
    rule: Literal["lot_for_lot", "fixed_qty", "epq"] = Field(
        "lot_for_lot", json_schema_extra={"unit": "enum", "scope": "M"})
    fixed_qty: Optional[float] = Field(
        None, gt=0, json_schema_extra={"unit": "units", "scope": "M", "notes": "≥ MOQ enforced."})
    epq_setup_cost: Optional[float] = Field(
        None, gt=0, json_schema_extra={"unit": "€/setup", "scope": "M"})


register_planned(
    id="lot_sizing", catalog_ref="P-P.2", stage=Stage.PLANT,
    strategy_class=StrategyClass.BUILT_IN,
    constraint_targeted=ConstraintTag.MATERIAL_AVAILABILITY,
    requires_predeployment=False, params_model=LotSizingParams, milestone="M8",
    summary="Batching exists for setup economics but can amplify shocks (bullwhip) — "
            "test whether your lots worsen propagation. Hook: PH-80.",
)


# --------------------------------------------------------------------- 4.2
# (P-P.4 fg_safety_stock and P-S.2 proactive_multi_sourcing graduated to
#  implemented plugins in 0.2.0 — see policies/strategic/.)

class CapacityReservationParams(PolicyParams):
    reserved_capacity: float = Field(
        ..., ge=0, json_schema_extra={"unit": "units/wk", "scope": "SM"})
    reservation_fee: float = Field(
        ..., gt=0, json_schema_extra={"unit": "€/unit/wk", "scope": "SM"})
    call_leadtime_weeks: int = Field(
        0, ge=0, le=4, json_schema_extra={"unit": "weeks", "scope": "SM"})


register_planned(
    id="capacity_reservation", catalog_ref="P-S.3", stage=Stage.SUPPLIER,
    strategy_class=StrategyClass.STRATEGIC,
    constraint_targeted=ConstraintTag.MATERIAL_AVAILABILITY,
    requires_predeployment=True, params_model=CapacityReservationParams, milestone="M8",
    summary="Real-options contract (semiconductor-style): standing fee for callable capacity; "
            "reserved units bypass capacity cuts. Cheaper than stock for slow, expensive "
            "materials. Hook: PH-80.",
)


class StandingCapacityReserveParams(PolicyParams):
    reserve_factor: float = Field(
        0.2, ge=0.0, le=0.5, json_schema_extra={"unit": "× O_p", "scope": "P"})
    standing_cost: float = Field(
        ..., ge=0, json_schema_extra={"unit": "€/wk", "scope": "P"})


register_planned(
    id="standing_capacity_reserve", catalog_ref="P-P.6", stage=Stage.PLANT,
    strategy_class=StrategyClass.STRATEGIC,
    constraint_targeted=ConstraintTag.PRODUCTION_CAPACITY,
    requires_predeployment=True, params_model=StandingCapacityReserveParams, milestone="M8",
    summary="Permanently maintained plant headroom — option premium vs P-P.5's pay-per-use. "
            "Hook: PH-40.",
)


class LaneSpec(PolicyParams):
    mode: Literal["default", "sea", "air", "road", "rail"] = "default"
    lead_time_weeks: int = Field(..., ge=0, le=26, json_schema_extra={"unit": "weeks", "scope": "E"})
    cost_per_unit: float = Field(..., ge=0, json_schema_extra={"unit": "€/unit", "scope": "E"})
    capacity_per_week: Optional[float] = Field(None, gt=0, json_schema_extra={"unit": "units/wk", "scope": "E"})


class MultimodalLanePortfolioParams(PolicyParams):
    lanes: dict[str, list[LaneSpec]] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "lanes per supplier link", "scope": "SM", "notes": "≤3 per SM."})
    mode_split_pct: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "%", "scope": "SM", "notes": "Shares sum to 100."})


register_planned(
    id="multimodal_lane_portfolio", catalog_ref="P-T.1", stage=Stage.TRANSPORT,
    strategy_class=StrategyClass.STRATEGIC,
    constraint_targeted=ConstraintTag.TRANSPORT_CAPACITY,
    requires_predeployment=True, params_model=MultimodalLanePortfolioParams,
    milestone="M7 (edge split)",
    summary="Qualified alternative lanes/modes per supplier — edge-risk redundancy; "
            "prerequisite for P-T.3 mode_shift. Hook: PH-90.",
)


# --------------------------------------------------------------------- 4.3
# P-S.4 early_warning_failover graduated to an implemented plugin:
# scsim/policies/anticipation/p_s4_early_warning.py


class AlternativeBomParams(PolicyParams):
    substitute_map: dict[str, list[str]] = Field(
        ..., json_schema_extra={"unit": "material → substitutes", "scope": "M"})
    substitution_cost: float = Field(
        0.0, ge=0, json_schema_extra={"unit": "€/unit", "scope": "M"})
    substitute_rates: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        json_schema_extra={"unit": "units m′/unit p", "scope": "P×M", "notes": "r′_{p,m′} > 0."})
    auto_substitute: bool = Field(
        True, json_schema_extra={"unit": "-", "scope": "G"})


register_planned(
    id="alternative_bom", catalog_ref="P-P.8", stage=Stage.PLANT,
    strategy_class=StrategyClass.ANTICIPATION,
    constraint_targeted=ConstraintTag.MATERIAL_AVAILABILITY,
    requires_predeployment=True, params_model=AlternativeBomParams, milestone="M8",
    summary="Pre-qualified substitutes (Tesla chip-redesign pattern) — the only material-side "
            "answer to single-sourced bottlenecks; qualification must precede the crisis. "
            "Hooks: PH-40/PH-50.",
)


class ProcessFlexibilityParams(PolicyParams):
    flexibility_matrix: dict[str, list[str]] = Field(
        ..., json_schema_extra={"unit": "line → products", "scope": "P"})
    switchover_cost: float = Field(
        0.0, ge=0, json_schema_extra={"unit": "€/switch", "scope": "P"})
    switchover_time_weeks: int = Field(
        0, ge=0, le=2, json_schema_extra={"unit": "weeks", "scope": "P"})


register_planned(
    id="process_flexibility", catalog_ref="P-P.7", stage=Stage.PLANT,
    strategy_class=StrategyClass.ANTICIPATION,
    constraint_targeted=ConstraintTag.PRODUCTION_CAPACITY,
    requires_predeployment=True, params_model=ProcessFlexibilityParams, milestone="M8",
    summary="Which lines make which products; Jordan–Graves chaining — a little flexibility "
            "buys most of the value. Hook: PH-40.",
)


class LeadtimeHedgingParams(PolicyParams):
    hedge_weeks: int = Field(
        2, ge=0, le=8, json_schema_extra={"unit": "weeks", "scope": "M"})
    applies_to: Literal["all", "long_lt", "abc_a_only"] = Field(
        "long_lt", json_schema_extra={"unit": "enum", "scope": "G"})
    long_lt_threshold_weeks: int = Field(
        12, ge=1, le=51, json_schema_extra={"unit": "weeks", "scope": "G"})


register_planned(
    id="leadtime_hedging", catalog_ref="P-T.4", stage=Stage.TRANSPORT,
    strategy_class=StrategyClass.ANTICIPATION,
    constraint_targeted=ConstraintTag.RESPONSE_TIME,
    requires_predeployment=False, params_model=LeadtimeHedgingParams, milestone="M8",
    summary="Order earlier than policy dictates for long-lead/critical materials — a time "
            "buffer instead of a unit buffer. Hook: PH-70.",
)


# --------------------------------------------------------------------- 4.4

class ModeShiftParams(PolicyParams):
    upgrade_lane: str = Field(
        ..., json_schema_extra={"unit": "lane id", "scope": "E", "notes": "Requires P-T.1."})
    lt_saving_weeks: int = Field(
        ..., ge=1, json_schema_extra={"unit": "weeks", "scope": "E"})
    upgrade_cost: float = Field(
        ..., gt=0, json_schema_extra={"unit": "€/unit", "scope": "E"})
    decision: Literal["revenue_positive", "always_during_disruption"] = Field(
        "revenue_positive", json_schema_extra={"unit": "enum", "scope": "G"})


register_planned(
    id="mode_shift", catalog_ref="P-T.3", stage=Stage.TRANSPORT,
    strategy_class=StrategyClass.IMPROVISATION,
    constraint_targeted=ConstraintTag.RESPONSE_TIME,
    requires_predeployment=False, params_model=ModeShiftParams, milestone="M7 (needs P-T.1)",
    summary="Switch NEW orders to a faster lane (sea→air) — composable with P-T.2, which "
            "moves the EXISTING flow. Hooks: PH-80/PH-90.",
)


class CustomerAllocationParams(PolicyParams):
    rule: Literal["fcfs", "priority", "fair_share", "sla_tier"] = Field(
        "fcfs", json_schema_extra={"unit": "enum", "scope": "C"})
    priority_weights: dict[str, float] = Field(
        default_factory=dict, json_schema_extra={"unit": "weight per customer", "scope": "C"})
    sla_tiers: dict[str, float] = Field(
        default_factory=dict, json_schema_extra={"unit": "tier → fill floor %", "scope": "C"})
    fair_share_basis: Literal["demand", "history"] = Field(
        "demand", json_schema_extra={"unit": "enum", "scope": "G"})


register_planned(
    id="customer_allocation", catalog_ref="P-C.2", stage=Stage.CUSTOMER,
    strategy_class=StrategyClass.IMPROVISATION,
    constraint_targeted=ConstraintTag.DEMAND_SIDE,
    requires_predeployment=False, params_model=CustomerAllocationParams, milestone="M7",
    summary="Under scarcity, 'who do we disappoint first' is deliberate — protect strategic "
            "accounts / SLA tiers / spread pain. Inert for single-customer MTO. Hook: PH-60.",
)


class DemandShapingParams(PolicyParams):
    substitution_offer: dict[str, str] = Field(
        default_factory=dict, json_schema_extra={"unit": "product → substitute", "scope": "P"})
    substitution_accept_prob: float = Field(
        0.5, ge=0.0, le=1.0, json_schema_extra={"unit": "-", "scope": "P"})
    substitution_discount: float = Field(
        0.0, ge=0, json_schema_extra={"unit": "€/unit", "scope": "P"})
    delay_incentive: float = Field(
        0.0, ge=0, json_schema_extra={"unit": "€/unit", "scope": "P"})
    delay_accept_prob: float = Field(
        0.3, ge=0.0, le=1.0, json_schema_extra={"unit": "-", "scope": "P"})


register_planned(
    id="demand_shaping", catalog_ref="P-C.3", stage=Stage.CUSTOMER,
    strategy_class=StrategyClass.IMPROVISATION,
    constraint_targeted=ConstraintTag.DEMAND_SIDE,
    requires_predeployment=False, params_model=DemandShapingParams, milestone="M8",
    summary="Move demand instead of fighting supply — substitution offers, delay incentives; "
            "cheap when customers accept. Hook: PH-60.",
)


class RepurposingParams(PolicyParams):
    conversion_map: dict[str, str] = Field(
        ..., json_schema_extra={"unit": "line → capability", "scope": "P"})
    conversion_cost: float = Field(
        ..., gt=0, json_schema_extra={"unit": "€/conversion", "scope": "P"})
    conversion_time_weeks: int = Field(
        2, ge=1, le=8, json_schema_extra={"unit": "weeks", "scope": "P"})
    reversion_time_weeks: int = Field(
        1, ge=0, le=4, json_schema_extra={"unit": "weeks", "scope": "P"})


register_planned(
    id="repurposing", catalog_ref="P-P.10", stage=Stage.PLANT,
    strategy_class=StrategyClass.IMPROVISATION,
    constraint_targeted=ConstraintTag.PRODUCTION_CAPACITY,
    requires_predeployment=False, params_model=RepurposingParams, milestone="M8",
    summary="Convert lines to new capability mid-crisis (Intel substrate) — high cost, delay, "
            "true bounce-forward. Hook: PH-40.",
)


# --------------------------------------------------------------------- 4.5

class PlaybookStep(PolicyParams):
    trigger: Literal["disruption_detected", "coverage_below", "fill_rate_below", "backlog_above"]
    trigger_value: Optional[float] = Field(
        None, json_schema_extra={"unit": "trigger-specific", "scope": "G"})
    policy_ref: str = Field(..., json_schema_extra={"unit": "policy id", "scope": "G"})
    param_override: dict = Field(default_factory=dict)
    cooldown_weeks: int = Field(0, ge=0, le=8, json_schema_extra={"unit": "weeks", "scope": "G"})


class RecoveryPlaybookParams(PolicyParams):
    steps: list[PlaybookStep] = Field(
        ..., max_length=10, json_schema_extra={"unit": "ordered steps", "scope": "G"})
    cost_cap: Optional[float] = Field(
        None, gt=0, json_schema_extra={"unit": "€", "scope": "G"})
    evaluation_cadence_weeks: Literal[1, 2] = Field(
        1, json_schema_extra={"unit": "weeks", "scope": "G"})


register_planned(
    id="recovery_playbook", catalog_ref="P-X.1", stage=Stage.CROSS,
    strategy_class=StrategyClass.META,
    constraint_targeted=None,
    requires_predeployment=False, params_model=RecoveryPlaybookParams, milestone="M8",
    summary="Firms execute SEQUENCED responses — detect → expedite → backup → overtime — "
            "gated by triggers and budget. Composes enabled policies; replaces flat recovery "
            "lists. Hook: PH-20 (evaluation) + delegated.",
)
