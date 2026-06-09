import type { PresetDefinition } from "../resolvePreset";

export const costOptimized: PresetDefinition = {
  slug: "cost_optimized",
  name: "Cost-optimized",
  description: "EOQ inventory, milk-run + LTL, weekly consolidation — lowest landed cost.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 100;
    return {
      sourcing: {
        strategy: { value: "single", why: "Single source = best volume rates." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Consolidate to largest supplier." },
        order_consolidation: { value: "weekly", why: "Weekly POs reduce ordering cost." },
        contract_type: { value: "contract", why: "Long-term contracts unlock discount." },
      },
      inventory: {
        type: { value: "s_S", why: "(s,S) approximates EOQ under stochastic demand." },
        reorder_point: { value: Math.round(mean * 5), why: "5-day cover at reorder." },
        order_up_to: { value: Math.round(mean * 21), why: "3-week run = larger lots." },
        safety_stock_method: { value: "fixed_days", why: "Cheap to compute." },
        safety_stock_days: { value: 7, why: "Modest buffer." },
        holding_cost_pct: { value: 0.18, why: "Standard WACC + storage." },
        ordering_cost: { value: 150, why: "Used in EOQ calc." },
      },
      transport: {
        mode: { value: "road", why: "Cheapest for short/medium haul." },
        load_type: { value: "LTL", why: "LTL pools partial loads." },
        routing: { value: "milk_run", why: "Milk runs amortise stops." },
        min_fill_pct: { value: 85, why: "High fill = low $/unit." },
      },
      fulfillment: {
        allocation: { value: "proportional", why: "Fair + cheap to operate." },
        backorder_allowed: { value: true, why: "Backorder is cheaper than stockout." },
        max_backorder_days: { value: 30, why: "Long window — cost over speed." },
        service_level_alpha: { value: 0.90, why: "Lower SLA = lower inventory cost." },
        order_batching_window_hours: { value: 24, why: "Daily batch = fewer dispatches." },
      },
      production: {
        lot_policy: { value: "epq", why: "EPQ minimises total cost." },
        utilization_cap_pct: { value: 90, why: "Push utilization for unit-cost dilution." },
        setup_cost: { value: 600, why: "EPQ input." },
      },
      demand: {
        pattern: { value: "stationary", why: "Cost-opt assumes stable plan." },
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: ctx.demand_cv ?? 0.3, why: "Observed CV." },
        forecast_method: { value: "moving_avg", why: "Cheapest, good for stable demand." },
        forecast_horizon_days: { value: 30, why: "Monthly plan." },
        priority_tier: { value: "C", why: "Treat as commodity." },
      },
      recovery: {
        enabled: { value: false, why: "Resilience plays are expensive — opt-in if needed." },
      },
    };
  },
};
