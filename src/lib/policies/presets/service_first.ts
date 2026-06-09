import type { PresetDefinition } from "../resolvePreset";

export const serviceFirst: PresetDefinition = {
  slug: "service_first",
  name: "Service-first",
  description: "99% SLA, large safety stock, fair-share allocation, premium transport.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 100;
    return {
      sourcing: {
        strategy: { value: "dual_sourcing", why: "Dual source protects availability." },
        ratios: { value: { primary: 0.6, backup: 0.4 }, why: "More even split = both stay sharp." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top supplier as primary." },
        failover_trigger: { value: "lead_time_breach", why: "Trip early to avoid stockout." },
      },
      inventory: {
        type: { value: "base_stock", why: "Base-stock keeps shelf full." },
        safety_stock_method: { value: "service_level", why: "Size SS to 99% target." },
        safety_stock_days: { value: 21, why: "3-week buffer for service guarantee." },
        service_level_target: { value: 0.99, why: "Headline 99% target." },
        order_up_to: { value: Math.round(mean * 28), why: "4-week order-up-to." },
      },
      transport: {
        mode: { value: "road", why: "Reliable + fast." },
        load_type: { value: "FTL", why: "FTL = predictable lead time." },
        lead_time_std_days: { value: 0.2, why: "Premium carriers, low σ." },
        cost_per_unit: { value: 1.8, why: "Premium transport costs more." },
      },
      fulfillment: {
        allocation: { value: "fair_share", why: "Fair-share when stock is short." },
        backorder_allowed: { value: false, why: "No backorder — must ship today." },
        service_level_alpha: { value: 0.99, why: "99% fill rate." },
        service_level_beta: { value: 0.995, why: "99.5% line fill." },
        lost_sales_cost_per_unit: { value: 50, why: "Brand cost of lost sale." },
      },
      production: {
        utilization_cap_pct: { value: 70, why: "Heavy slack for surge response." },
        lot_policy: { value: "fixed", why: "Stable lot keeps schedule predictable." },
      },
      demand: {
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: ctx.demand_cv ?? 0.3, why: "Observed CV." },
        forecast_method: { value: "exp_smoothing", why: "Smoothing avoids over-reaction." },
        forecast_horizon_days: { value: 28, why: "4-week S&OP horizon." },
        priority_tier: { value: "A", why: "Treat all customers as tier-A." },
        delivery_window_days: { value: 1, why: "Same/next-day promise." },
        late_penalty_per_day: { value: 20, why: "Strong incentive on time." },
      },
      recovery: {
        enabled: { value: true, why: "Service preset never lets shock reach customer." },
        response: { value: ["safety_stock_drawdown", "mode_shift", "capacity_flex"], why: "Use any lever to keep ship-rate." },
        recovery_target_days: { value: 7, why: "Fastest recovery target." },
      },
    };
  },
};
