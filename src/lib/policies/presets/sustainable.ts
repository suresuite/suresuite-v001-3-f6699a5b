import type { PresetDefinition } from "../resolvePreset";

export const sustainable: PresetDefinition = {
  slug: "sustainable",
  name: "Sustainable",
  description: "Sea/rail bias, large batches, carbon-capped routing.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 100;
    const isShortHaul = ctx.supply_chain_model === "distribution";
    return {
      sourcing: {
        strategy: { value: "single", why: "Consolidate to reduce duplicate shipments." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top supplier — fewer touches." },
        order_consolidation: { value: "monthly", why: "Big monthly orders amortise transport CO₂." },
      },
      inventory: {
        type: { value: "s_S", why: "Large lots favour batch policy." },
        order_up_to: { value: Math.round(mean * 45), why: "6-week run = fewer shipments." },
        safety_stock_days: { value: 14, why: "Slow modes need buffer." },
      },
      transport: {
        mode: { value: isShortHaul ? "rail" : "sea", why: "Lowest g CO₂/t·km for the haul length." },
        load_type: { value: "container", why: "Container = best fill on slow modes." },
        routing: { value: "hub_spoke", why: "Hub-spoke pools volume." },
        min_fill_pct: { value: 90, why: "High fill is mandatory for sustainability." },
        carbon_intensity_kg_per_tkm: { value: isShortHaul ? 0.022 : 0.008, why: "Rail/sea baseline." },
      },
      fulfillment: {
        allocation: { value: "proportional", why: "Fair share, no premium expediting." },
        backorder_allowed: { value: true, why: "Backorder beats emergency air freight." },
        max_backorder_days: { value: 45, why: "Long window matches slow modes." },
        service_level_alpha: { value: 0.93, why: "Trade speed for footprint." },
      },
      production: {
        lot_policy: { value: "epq", why: "EPQ minimises energy per unit." },
        utilization_cap_pct: { value: 88, why: "High utilization = low energy/unit." },
      },
      demand: {
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: ctx.demand_cv ?? 0.3, why: "Observed CV." },
        forecast_method: { value: "exp_smoothing", why: "Smoothed plan = fewer expedites." },
        forecast_horizon_days: { value: 45, why: "Long horizon matches slow modes." },
        priority_tier: { value: "B", why: "Default tier — no expediting." },
        delivery_window_days: { value: 10, why: "Wider promise for low-CO₂ ship." },
      },
      recovery: {
        enabled: { value: true, why: "Recovery without breaking carbon cap." },
        response: { value: ["safety_stock_drawdown", "demand_shaping"], why: "Avoid air freight; reshape demand instead." },
        cost_cap: { value: 15000, why: "Cap excludes premium-mode shifts." },
      },
    };
  },
};
