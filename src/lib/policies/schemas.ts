import { z } from "zod";
import { responseEngineEffect } from "./engineBridge";

/**
 * Supply chain policy schemas — v2 (sophisticated).
 * Mirrored in sim-worker/sim_worker/policies.py (Pydantic) and validated again
 * in supabase/functions/sim-command/index.ts. Keep all three in sync.
 *
 * Six families: sourcing, inventory, transport, fulfillment, production, recovery.
 */

export const PolicyFamily = z.enum([
  "sourcing",
  "inventory",
  "transport",
  "fulfillment",
  "production",
  "recovery",
  "demand",
]);
export type PolicyFamily = z.infer<typeof PolicyFamily>;

// ---------- Fulfillment strategy (top-level project decision) ----------
export const FulfillmentStrategy = z.enum([
  "make_to_stock",
  "make_to_order",
  "assemble_to_order",
  "engineer_to_order",
  "configure_to_order",
]);
export type FulfillmentStrategy = z.infer<typeof FulfillmentStrategy>;

export const STRATEGY_LABELS: Record<FulfillmentStrategy, string> = {
  make_to_stock: "Make to Stock (MTS)",
  make_to_order: "Make to Order (MTO)",
  assemble_to_order: "Assemble to Order (ATO)",
  engineer_to_order: "Engineer to Order (ETO)",
  configure_to_order: "Configure to Order (CTO)",
};

export const STRATEGY_DESCRIPTIONS: Record<FulfillmentStrategy, string> = {
  make_to_stock: "Produce ahead of demand against forecast. High FG inventory, fast fulfilment.",
  make_to_order: "Produce only after customer order. No FG inventory, longer lead times.",
  assemble_to_order: "Stock components, assemble on order. Balances variety and speed.",
  engineer_to_order: "Design + build per customer. Project-style, no stock.",
  configure_to_order: "Standard modules, customer picks config. Stock at module level.",
};

// ---------- Sourcing ----------
export const SourcingStrategy = z.enum([
  "single",
  "multi",
  "primary_backup",
  "dual_sourcing",
  "tiered",
]);
export const ContractType = z.enum(["spot", "contract", "vmi", "consignment"]);
export const FailoverTrigger = z.enum([
  "stockout",
  "lead_time_breach",
  "cost_threshold",
  "manual",
]);
export const ConsolidationCadence = z.enum(["none", "daily", "weekly", "monthly"]);

export const SourcingPolicy = z.object({
  strategy: SourcingStrategy.default("single"),
  ratios: z.record(z.string(), z.number().min(0).max(1)).default({}),
  primary_supplier: z.string().default(""),
  backup_supplier: z.string().default(""),
  tertiary_supplier: z.string().default(""),
  failover_trigger: FailoverTrigger.default("stockout"),
  failover_threshold_pct: z.number().min(0).max(100).default(20),
  failover_cooldown_days: z.number().min(0).default(7),
  min_reliability: z.number().min(0).max(1).default(0.85),
  max_lead_time_variance_days: z.number().min(0).default(3),
  contract_type: ContractType.default("contract"),
  order_consolidation: ConsolidationCadence.default("none"),
  // per (supplier × material) extensions
  primary_source: z.boolean().default(false),
  material_price: z.number().min(0).default(0),
  supplier_capacity_per_day: z.number().min(0).default(0),
});

// ---------- Inventory ----------
export const InventoryPolicyType = z.enum([
  "min_max",
  "s_S",
  "base_stock",
  "rop",
  "periodic_review",
  "continuous_review",
]);
export const SafetyStockMethod = z.enum([
  "fixed_days",
  "service_level",
  "demand_variability",
  "king_method",
]);
export const ABCClass = z.enum(["A", "B", "C"]);
export const StockRotation = z.enum(["FIFO", "LIFO", "FEFO"]);

export const InventoryPolicy = z.object({
  type: InventoryPolicyType.default("min_max"),
  reorder_point: z.number().min(0).default(50),
  order_up_to: z.number().min(0).default(200),
  max_stock: z.number().min(0).default(500),
  min_stock: z.number().min(0).default(0),
  safety_stock_method: SafetyStockMethod.default("fixed_days"),
  safety_stock_days: z.number().min(0).default(7),
  service_level_target: z.number().min(0).max(1).default(0.95),
  review_period_days: z.number().min(0).default(1),
  abc_class: ABCClass.default("B"),
  holding_cost_pct: z.number().min(0).max(2).default(0.2),
  stockout_cost_per_unit: z.number().min(0).default(5),
  ordering_cost: z.number().min(0).default(100),
  shelf_life_days: z.number().min(0).default(0),
  rotation: StockRotation.default("FIFO"),
  // per-row extensions
  moq: z.number().min(0).default(0),
});

// ---------- Transport ----------
export const TransportMode = z.enum(["road", "rail", "sea", "air", "intermodal"]);
export const LoadType = z.enum(["LTL", "FTL", "parcel", "container"]);
export const LeadTimeDistribution = z.enum(["normal", "lognormal", "gamma", "triangular"]);
export const RoutingPolicy = z.enum(["direct", "milk_run", "cross_dock", "hub_spoke"]);

export const TransportPolicy = z.object({
  mode: TransportMode.default("road"),
  lead_time_mean_days: z.number().min(0).default(3),
  lead_time_std_days: z.number().min(0).default(0.5),
  lead_time_distribution: LeadTimeDistribution.default("normal"),
  // gamma
  lead_time_shape: z.number().min(0).default(2),
  lead_time_scale: z.number().min(0).default(1),
  // triangular
  lead_time_min: z.number().min(0).default(0),
  lead_time_mode: z.number().min(0).default(1),
  lead_time_max: z.number().min(0).default(2),
  vehicles: z.number().min(0).default(5),
  capacity_weight_kg: z.number().min(0).default(20000),
  capacity_volume_m3: z.number().min(0).default(80),
  load_type: LoadType.default("FTL"),
  min_fill_pct: z.number().min(0).max(100).default(70),
  cost_per_unit: z.number().min(0).default(1.0),
  cost_per_km: z.number().min(0).default(1.5),
  fixed_dispatch_cost: z.number().min(0).default(50),
  routing: RoutingPolicy.default("direct"),
  carbon_intensity_kg_per_tkm: z.number().min(0).default(0.062),
});

// ---------- Fulfillment ----------
export const AllocationRule = z.enum([
  "priority",
  "fair_share",
  "proportional",
  "revenue_max",
  "sla_tier",
]);

export const FulfillmentPolicy = z.object({
  allocation: AllocationRule.default("priority"),
  backorder_allowed: z.boolean().default(true),
  max_backorder_days: z.number().min(0).default(14),
  backorder_cost_per_day: z.number().min(0).default(2),
  lost_sales_cost_per_unit: z.number().min(0).default(20),
  service_level_alpha: z.number().min(0).max(1).default(0.95),
  service_level_beta: z.number().min(0).max(1).default(0.98),
  order_batching_window_hours: z.number().min(0).default(0),
  tier_overrides: z.record(z.string(), z.number().min(0).max(1)).default({}),
  // per (customer × product) extensions
  sourcing_firm: z.string().default(""),
  primary_source: z.boolean().default(false),
  price: z.number().min(0).default(0),
});

// ---------- Production ----------
export const LotPolicy = z.enum(["fixed", "epq", "lot_for_lot", "pohm"]);
export const SchedulingRule = z.enum(["fifo", "edd", "spt", "critical_ratio"]);

export const ProductionPolicy = z.object({
  lot_policy: LotPolicy.default("epq"),
  setup_time_hours: z.number().min(0).default(1),
  setup_cost: z.number().min(0).default(500),
  capacity_units_per_day: z.number().min(0).default(1000),
  utilization_cap_pct: z.number().min(0).max(100).default(85),
  scheduling: SchedulingRule.default("fifo"),
  capacity_machine_per_day: z.number().min(0).default(0),
  capacity_labor_per_day: z.number().min(0).default(0),
  production_cost_per_unit: z.number().min(0).default(0),
  production_lead_time_mean_days: z.number().min(0).default(1),
  production_lead_time_std_days: z.number().min(0).default(0.2),
  lead_time_distribution: LeadTimeDistribution.default("normal"),
  // gamma
  production_lead_time_shape: z.number().min(0).default(2),
  production_lead_time_scale: z.number().min(0).default(1),
  // triangular
  production_lead_time_min: z.number().min(0).default(0),
  production_lead_time_mode: z.number().min(0).default(1),
  production_lead_time_max: z.number().min(0).default(2),
});

// ---------- Recovery ----------
export const RecoveryResponse = z.enum([
  "reroute",
  "dual_source_activate",
  "safety_stock_drawdown",
  "mode_shift",
  "capacity_flex",
  "demand_shaping",
]);

export const RecoveryPolicy = z.object({
  enabled: z.boolean().default(true),
  trigger_magnitude_pct: z.number().min(0).max(100).default(25),
  trigger_duration_days: z.number().min(0).default(2),
  trigger_geography: z.string().default(""),
  response: z.array(RecoveryResponse).default([]),
  detection_lag_days: z.number().min(0).default(1),
  recovery_target_days: z.number().min(0).default(21),
  cost_cap: z.number().min(0).default(25000),
});

// ---------- Demand (customer-side) ----------
export const DemandPattern = z.enum(["stationary", "trend", "seasonal", "intermittent", "lumpy"]);
export const ForecastMethod = z.enum(["naive", "moving_avg", "exp_smoothing", "croston", "ml"]);
export const OrderSizeDist = z.enum(["poisson", "normal", "negbin", "empirical"]);
export const PriorityTier = z.enum(["A", "B", "C"]);

export const DemandPolicy = z.object({
  pattern: DemandPattern.default("stationary"),
  mean_per_day: z.number().min(0).default(100),
  cv: z.number().min(0).max(5).default(0.3),
  seasonality_period_days: z.number().min(0).default(0),
  seasonality_amplitude_pct: z.number().min(0).max(200).default(0),
  trend_pct_per_period: z.number().default(0),
  forecast_method: ForecastMethod.default("exp_smoothing"),
  forecast_horizon_days: z.number().min(1).default(14),
  forecast_bias_pct: z.number().default(0),
  order_size_distribution: OrderSizeDist.default("poisson"),
  priority_tier: PriorityTier.default("B"),
  delivery_window_days: z.number().min(0).default(3),
  late_penalty_per_day: z.number().min(0).default(5),
  // per-row extension
  delivery_schedule: z.string().default(""),
});

export const PolicySchemas = {
  sourcing: SourcingPolicy,
  inventory: InventoryPolicy,
  transport: TransportPolicy,
  fulfillment: FulfillmentPolicy,
  production: ProductionPolicy,
  recovery: RecoveryPolicy,
  demand: DemandPolicy,
} as const;

export type Sourcing = z.infer<typeof SourcingPolicy>;
export type Inventory = z.infer<typeof InventoryPolicy>;
export type Transport = z.infer<typeof TransportPolicy>;
export type Fulfillment = z.infer<typeof FulfillmentPolicy>;
export type Production = z.infer<typeof ProductionPolicy>;
export type Recovery = z.infer<typeof RecoveryPolicy>;
export type Demand = z.infer<typeof DemandPolicy>;

export interface PolicyBundle {
  sourcing: Sourcing;
  inventory: Inventory;
  transport: Transport;
  fulfillment: Fulfillment;
  production: Production;
  recovery: Recovery;
  demand: Demand;
}

export const DEFAULT_BUNDLE: PolicyBundle = {
  sourcing: SourcingPolicy.parse({}),
  inventory: InventoryPolicy.parse({}),
  transport: TransportPolicy.parse({}),
  fulfillment: FulfillmentPolicy.parse({}),
  production: ProductionPolicy.parse({}),
  recovery: RecoveryPolicy.parse({}),
  demand: DemandPolicy.parse({}),
};

/** Parse and apply defaults for a single family. */
export function parseFamily<F extends PolicyFamily>(
  family: F,
  raw: unknown,
): PolicyBundle[F] {
  return PolicySchemas[family].parse(raw ?? {}) as PolicyBundle[F];
}

/** Field grouping (Basics / Advanced / Costs) for accordion rendering. */
export const FIELD_GROUPS: Record<PolicyFamily, Record<string, string[]>> = {
  sourcing: {
    Basics: ["strategy", "primary_supplier", "backup_supplier", "tertiary_supplier"],
    Advanced: [
      "failover_trigger",
      "failover_threshold_pct",
      "failover_cooldown_days",
      "min_reliability",
      "max_lead_time_variance_days",
      "order_consolidation",
    ],
    Contract: ["contract_type"],
  },
  inventory: {
    Basics: ["type", "reorder_point", "order_up_to", "min_stock", "max_stock"],
    "Safety stock": [
      "safety_stock_method",
      "safety_stock_days",
      "service_level_target",
      "review_period_days",
    ],
    Classification: ["abc_class", "rotation", "shelf_life_days"],
    Costs: ["holding_cost_pct", "stockout_cost_per_unit", "ordering_cost"],
  },
  transport: {
    Basics: ["mode", "load_type", "routing"],
    "Lead time": ["lead_time_mean_days", "lead_time_std_days", "lead_time_distribution"],
    Capacity: ["vehicles", "capacity_weight_kg", "capacity_volume_m3", "min_fill_pct"],
    Costs: ["cost_per_unit", "cost_per_km", "fixed_dispatch_cost", "carbon_intensity_kg_per_tkm"],
  },
  fulfillment: {
    Basics: ["allocation", "service_level_alpha", "service_level_beta"],
    Backorder: ["backorder_allowed", "max_backorder_days", "backorder_cost_per_day", "lost_sales_cost_per_unit"],
    Batching: ["order_batching_window_hours"],
  },
  production: {
    Basics: ["lot_policy", "scheduling", "capacity_units_per_day", "utilization_cap_pct"],
    Setup: ["setup_time_hours", "setup_cost"],
  },
  recovery: {
    Trigger: ["enabled", "trigger_magnitude_pct", "trigger_duration_days", "trigger_geography"],
    Response: ["response", "detection_lag_days"],
    Targets: ["recovery_target_days", "cost_cap"],
  },
  demand: {
    Pattern: ["pattern", "mean_per_day", "cv", "order_size_distribution"],
    Seasonality: ["seasonality_period_days", "seasonality_amplitude_pct", "trend_pct_per_period"],
    Forecast: ["forecast_method", "forecast_horizon_days", "forecast_bias_pct"],
    Service: ["priority_tier", "delivery_window_days", "late_penalty_per_day"],
  },
};

/** Enum metadata for select rendering. */
export const ENUM_OPTIONS: Record<string, readonly string[]> = {
  // sourcing
  strategy: SourcingStrategy.options,
  failover_trigger: FailoverTrigger.options,
  contract_type: ContractType.options,
  order_consolidation: ConsolidationCadence.options,
  // inventory
  type: InventoryPolicyType.options,
  safety_stock_method: SafetyStockMethod.options,
  abc_class: ABCClass.options,
  rotation: StockRotation.options,
  // transport
  mode: TransportMode.options,
  load_type: LoadType.options,
  lead_time_distribution: LeadTimeDistribution.options,
  routing: RoutingPolicy.options,
  // fulfillment
  allocation: AllocationRule.options,
  // production
  lot_policy: LotPolicy.options,
  scheduling: SchedulingRule.options,
  // demand
  pattern: DemandPattern.options,
  forecast_method: ForecastMethod.options,
  order_size_distribution: OrderSizeDist.options,
  priority_tier: PriorityTier.options,
  // recovery (multi-select handled separately)
};

export const MULTI_SELECT_FIELDS = new Set(["response"]);
export const MULTI_SELECT_OPTIONS: Record<string, readonly string[]> = {
  // Restricted to the responses the scsim engine maps to policies:
  // dual_source_activate → backup_supplier, mode_shift/reroute → expedited_shipments,
  // capacity_flex → short_term_capacity.
  response: ["reroute", "dual_source_activate", "mode_shift", "capacity_flex"],
};

/**
 * scsim alignment — the simulation engine (scsim) is the source of truth for
 * which policy settings have effect. Only the fields below are consumed by the
 * engine; everything else is hidden from the GUI (stored values are preserved
 * in the database, just not editable). Families absent from this map
 * (transport, demand) are hidden entirely: transport is driven by network edge
 * attributes, demand by product/graph data.
 */
export const SCSIM_VISIBLE_FIELDS: Partial<Record<PolicyFamily, ReadonlySet<string>>> = {
  sourcing: new Set(["strategy"]),
  inventory: new Set([
    "type",
    "safety_stock_method",
    "safety_stock_days",
    "service_level_target",
    "holding_cost_pct",
  ]),
  fulfillment: new Set([
    "allocation",
    "backorder_allowed",
    "max_backorder_days",
    "backorder_cost_per_day",
  ]),
  production: new Set(["capacity_units_per_day"]),
  recovery: new Set(["response"]),
};

/** True when a default-level field is exposed in the GUI (consumed by scsim). */
export function isScsimVisible(family: PolicyFamily, field: string): boolean {
  return SCSIM_VISIBLE_FIELDS[family]?.has(field) ?? false;
}

/** FIELD_GROUPS filtered to scsim-consumed fields; empty groups are dropped. */
export function visibleFieldGroups(family: PolicyFamily): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [group, fields] of Object.entries(FIELD_GROUPS[family] ?? {})) {
    const kept = fields.filter((f) => isScsimVisible(family, f));
    if (kept.length > 0) out[group] = kept;
  }
  return out;
}

/** Enum options narrowed to the values the scsim conversion maps. */
export const SCSIM_ENUM_OPTIONS: Record<string, readonly string[]> = {
  // s_S / continuous_review collapse to min_max in scsim; offer the four real types.
  type: ["min_max", "base_stock", "rop", "periodic_review"],
  // demand_variability is approximated as uniform in scsim; not offered.
  safety_stock_method: ["fixed_days", "service_level", "king_method"],
};

/**
 * Helper text shown next to recovery responses, naming the engine effect.
 * Derived from the engine registry via the validated bridge (§6.2), so the
 * catalog refs track the engine instead of being hand-typed here.
 */
export const RESPONSE_ENGINE_EFFECTS: Record<string, string> = Object.fromEntries(
  (["reroute", "dual_source_activate", "mode_shift", "capacity_flex"] as const)
    .map((r) => [r, responseEngineEffect(r)] as const)
    .filter((e): e is readonly ["capacity_flex" | "dual_source_activate" | "mode_shift" | "reroute", string] => Boolean(e[1])),
);

/** Human-friendly labels + units for fields. */
export const FIELD_LABELS: Record<string, string> = {
  strategy: "Sourcing strategy",
  ratios: "Supplier ratios",
  primary_supplier: "Primary supplier",
  backup_supplier: "Backup supplier",
  tertiary_supplier: "Tertiary supplier",
  failover_trigger: "Failover trigger",
  failover_threshold_pct: "Failover threshold (%)",
  failover_cooldown_days: "Failover cooldown (days)",
  min_reliability: "Min supplier reliability (0-1)",
  max_lead_time_variance_days: "Max lead-time variance (days)",
  contract_type: "Contract type",
  order_consolidation: "Order consolidation",
  type: "Policy type",
  reorder_point: "Reorder point (s)",
  order_up_to: "Order-up-to (S)",
  max_stock: "Max stock",
  min_stock: "Min stock",
  safety_stock_method: "Safety stock method",
  safety_stock_days: "Safety stock (days, 0–84)",
  service_level_target: "Service level (0-1)",
  review_period_days: "Review period (days)",
  abc_class: "ABC class",
  holding_cost_pct: "Holding cost (%/yr)",
  stockout_cost_per_unit: "Stockout cost / unit",
  ordering_cost: "Ordering cost",
  shelf_life_days: "Shelf life (days)",
  rotation: "Rotation",
  mode: "Mode",
  lead_time_mean_days: "Lead time mean (days)",
  lead_time_std_days: "Lead time σ (days)",
  lead_time_distribution: "Lead time distribution",
  vehicles: "Vehicles",
  capacity_weight_kg: "Capacity (kg)",
  capacity_volume_m3: "Capacity (m³)",
  load_type: "Load type",
  min_fill_pct: "Min fill (%)",
  cost_per_unit: "Cost / unit",
  cost_per_km: "Cost / km",
  fixed_dispatch_cost: "Fixed dispatch cost",
  routing: "Routing",
  carbon_intensity_kg_per_tkm: "Carbon (kg/t-km)",
  allocation: "Material allocation",
  backorder_allowed: "Backorder allowed",
  max_backorder_days: "Max backorder (days)",
  backorder_cost_per_day: "Backorder cost / day",
  lost_sales_cost_per_unit: "Lost sales cost / unit",
  service_level_alpha: "α fill rate",
  service_level_beta: "β fill rate",
  order_batching_window_hours: "Batching window (h)",
  lot_policy: "Lot sizing",
  setup_time_hours: "Setup time (h)",
  setup_cost: "Setup cost",
  capacity_units_per_day: "Capacity (units/day)",
  utilization_cap_pct: "Utilization cap (%)",
  scheduling: "Scheduling rule",
  enabled: "Enabled",
  trigger_magnitude_pct: "Trigger magnitude (%)",
  trigger_duration_days: "Trigger duration (days)",
  trigger_geography: "Geography filter",
  response: "Response playbook",
  detection_lag_days: "Detection lag (days)",
  recovery_target_days: "Recovery target (days)",
  cost_cap: "Cost cap / event",
  // demand
  pattern: "Demand pattern",
  mean_per_day: "Mean demand (units/day)",
  cv: "Coefficient of variation",
  seasonality_period_days: "Seasonality period (days)",
  seasonality_amplitude_pct: "Seasonality amplitude (%)",
  trend_pct_per_period: "Trend (% / period)",
  forecast_method: "Forecast method",
  forecast_horizon_days: "Forecast horizon (days)",
  forecast_bias_pct: "Forecast bias (%)",
  order_size_distribution: "Order-size distribution",
  priority_tier: "Customer priority tier",
  delivery_window_days: "Delivery window (days)",
  late_penalty_per_day: "Late penalty / day",
  delivery_schedule: "Delivery schedule",
  // sourcing extensions
  primary_source: "Primary",
  share_pct: "Share (%)",
  material_price: "Material price",
  supplier_capacity_per_day: "Supplier capacity (units/day)",
  // inventory extensions
  moq: "MOQ",
  // production extensions
  capacity_machine_per_day: "Capacity machine (units/day)",
  capacity_labor_per_day: "Capacity labor (units/day)",
  production_cost_per_unit: "Production cost / unit",
  production_lead_time_mean_days: "Production lead time mean (days)",
  production_lead_time_std_days: "Production lead time σ (days)",
  // fulfillment extensions
  sourcing_firm: "Sourcing firm",
  price: "Price",
  // transport distribution params
  lead_time_shape: "Lead time shape (k)",
  lead_time_scale: "Lead time scale (θ)",
  lead_time_min: "Lead time min (days)",
  lead_time_mode: "Lead time mode (days)",
  lead_time_max: "Lead time max (days)",
  // production distribution params
  production_lead_time_shape: "Prod. lead time shape (k)",
  production_lead_time_scale: "Prod. lead time scale (θ)",
  production_lead_time_min: "Prod. lead time min (days)",
  production_lead_time_mode: "Prod. lead time mode (days)",
  production_lead_time_max: "Prod. lead time max (days)",
};
