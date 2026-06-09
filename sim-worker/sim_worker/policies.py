"""Policy schemas + delta application for the sim-worker.

Mirrors `src/lib/policies/schemas.ts` and the Zod validator in
`supabase/functions/sim-command/index.ts`. Keep all three in sync.

Six families: sourcing, inventory, transport, fulfillment, production, recovery.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


PolicyFamily = Literal[
    "sourcing", "inventory", "transport", "fulfillment", "production", "recovery"
]


class SourcingPolicy(BaseModel):
    strategy: Literal["single", "multi", "primary_backup", "dual_sourcing", "tiered"] = "single"
    ratios: dict[str, float] = Field(default_factory=dict)
    primary_supplier: str = ""
    backup_supplier: str = ""
    tertiary_supplier: str = ""
    failover_trigger: Literal["stockout", "lead_time_breach", "cost_threshold", "manual"] = "stockout"
    failover_threshold_pct: float = 20.0
    failover_cooldown_days: float = 7
    min_reliability: float = 0.85
    max_lead_time_variance_days: float = 3
    contract_type: Literal["spot", "contract", "vmi", "consignment"] = "contract"
    order_consolidation: Literal["none", "daily", "weekly", "monthly"] = "none"


class InventoryPolicy(BaseModel):
    type: Literal[
        "min_max", "s_S", "base_stock", "rop", "periodic_review", "continuous_review"
    ] = "min_max"
    reorder_point: float = 50
    order_up_to: float = 200
    max_stock: float = 500
    min_stock: float = 0
    safety_stock_method: Literal[
        "fixed_days", "service_level", "demand_variability", "king_method"
    ] = "fixed_days"
    safety_stock_days: float = 7
    service_level_target: float = 0.95
    review_period_days: float = 1
    abc_class: Literal["A", "B", "C"] = "B"
    holding_cost_pct: float = 0.2
    stockout_cost_per_unit: float = 5
    ordering_cost: float = 100
    shelf_life_days: float = 0
    rotation: Literal["FIFO", "LIFO", "FEFO"] = "FIFO"


class TransportPolicy(BaseModel):
    mode: Literal["road", "rail", "sea", "air", "intermodal"] = "road"
    lead_time_mean_days: float = 3
    lead_time_std_days: float = 0.5
    lead_time_distribution: Literal["normal", "lognormal", "gamma", "triangular"] = "normal"
    # gamma
    lead_time_shape: float = 2
    lead_time_scale: float = 1
    # triangular
    lead_time_min: float = 0
    lead_time_mode: float = 1
    lead_time_max: float = 2
    vehicles: float = 5
    capacity_weight_kg: float = 20000
    capacity_volume_m3: float = 80
    load_type: Literal["LTL", "FTL", "parcel", "container"] = "FTL"
    min_fill_pct: float = 70
    cost_per_unit: float = 1.0
    cost_per_km: float = 1.5
    fixed_dispatch_cost: float = 50
    routing: Literal["direct", "milk_run", "cross_dock", "hub_spoke"] = "direct"
    carbon_intensity_kg_per_tkm: float = 0.062


class FulfillmentPolicy(BaseModel):
    allocation: Literal[
        "priority", "fair_share", "proportional", "revenue_max", "sla_tier"
    ] = "priority"
    backorder_allowed: bool = True
    max_backorder_days: float = 14
    backorder_cost_per_day: float = 2
    lost_sales_cost_per_unit: float = 20
    service_level_alpha: float = 0.95
    service_level_beta: float = 0.98
    order_batching_window_hours: float = 0
    tier_overrides: dict[str, float] = Field(default_factory=dict)


class ProductionPolicy(BaseModel):
    lot_policy: Literal["fixed", "epq", "lot_for_lot", "pohm"] = "epq"
    setup_time_hours: float = 1
    setup_cost: float = 500
    capacity_units_per_day: float = 1000
    utilization_cap_pct: float = 85
    scheduling: Literal["fifo", "edd", "spt", "critical_ratio"] = "fifo"
    capacity_machine_per_day: float = 0
    capacity_labor_per_day: float = 0
    production_cost_per_unit: float = 0
    production_lead_time_mean_days: float = 1
    production_lead_time_std_days: float = 0.2
    lead_time_distribution: Literal["normal", "lognormal", "gamma", "triangular"] = "normal"
    # gamma
    production_lead_time_shape: float = 2
    production_lead_time_scale: float = 1
    # triangular
    production_lead_time_min: float = 0
    production_lead_time_mode: float = 1
    production_lead_time_max: float = 2


class RecoveryPolicy(BaseModel):
    enabled: bool = True
    trigger_magnitude_pct: float = 25
    trigger_duration_days: float = 2
    trigger_geography: str = ""
    response: list[
        Literal[
            "reroute", "dual_source_activate", "safety_stock_drawdown",
            "mode_shift", "capacity_flex", "demand_shaping",
        ]
    ] = Field(default_factory=list)
    detection_lag_days: float = 1
    recovery_target_days: float = 21
    cost_cap: float = 25000


class PolicyBundle(BaseModel):
    sourcing: SourcingPolicy = Field(default_factory=SourcingPolicy)
    inventory: InventoryPolicy = Field(default_factory=InventoryPolicy)
    transport: TransportPolicy = Field(default_factory=TransportPolicy)
    fulfillment: FulfillmentPolicy = Field(default_factory=FulfillmentPolicy)
    production: ProductionPolicy = Field(default_factory=ProductionPolicy)
    recovery: RecoveryPolicy = Field(default_factory=RecoveryPolicy)


def apply_policy_delta(
    effective: dict[str, dict[str, Any]],
    payload: dict[str, Any],
) -> set[str]:
    """Merge a sparse policy patch into the effective-policy map.

    ``effective`` is keyed by ``"default" | "node:<id>" | "edge:<from>→<to>"``
    and each value is a per-family dict. Returns the set of dirty keys for
    sub-graph KPI recomputation.
    """
    family = payload.get("family")
    scope = payload.get("scope", "default")
    patch = payload.get("patch") or {}
    dirty: set[str] = set()

    if scope == "default":
        key = "default"
        effective.setdefault(key, {}).setdefault(family, {}).update(patch)
        dirty.add(key)
    elif scope == "bulk":
        for target_key in payload.get("target_keys", []):
            key = _scope_key(family, target_key)
            effective.setdefault(key, {}).setdefault(family, {}).update(patch)
            dirty.add(key)
    else:
        target_key = payload.get("target_key", "")
        key = _scope_key(family, target_key, scope)
        effective.setdefault(key, {}).setdefault(family, {}).update(patch)
        dirty.add(key)

    return dirty


def _scope_key(family: str, target_key: str, scope: Optional[str] = None) -> str:
    if scope:
        return f"{scope}:{target_key}"
    if family == "inventory":
        return f"node:{target_key}"
    return f"edge:{target_key}"
