import type { PresetDefinition } from "../resolvePreset";

export const makeToStock: PresetDefinition = {
  slug: "make_to_stock",
  name: "Make-to-Stock",
  description: "Produce ahead of demand, hold FG inventory, ship from stock.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 100;
    return {
      sourcing: {
        strategy: { value: "single", why: "Single sourcing for predictable replenishment." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top-volume supplier." },
        order_consolidation: { value: "weekly", why: "Weekly POs match production plan." },
      },
      inventory: {
        type: { value: "s_S", why: "(s,S) classic MTS replenishment." },
        reorder_point: { value: Math.round(mean * 10), why: "10-day cover at reorder." },
        order_up_to: { value: Math.round(mean * 30), why: "30-day order-up-to (FG stock)." },
        max_stock: { value: Math.round(mean * 45), why: "45-day ceiling." },
        safety_stock_method: { value: "service_level", why: "Service-level method." },
        safety_stock_days: { value: 14, why: "2-week buffer typical for MTS." },
        service_level_target: { value: 0.95, why: "Headline 95% from stock." },
      },
      transport: {
        mode: { value: "road", why: "Default for MTS distribution." },
        load_type: { value: "FTL", why: "FTL on planned replenishment." },
        routing: { value: "direct", why: "Direct from DC to customer." },
      },
      fulfillment: {
        allocation: { value: "fair_share", why: "Fair-share allocation from stock." },
        backorder_allowed: { value: true, why: "Backorder if stock dips." },
        max_backorder_days: { value: 14, why: "14-day window." },
        service_level_alpha: { value: 0.95, why: "Match inventory target." },
      },
      production: {
        lot_policy: { value: "epq", why: "EPQ = classic MTS lot sizing." },
        scheduling: { value: "fifo", why: "FIFO on stock replenishment." },
        utilization_cap_pct: { value: 85, why: "High utilization, modest slack." },
      },
      demand: {
        pattern: { value: "stationary", why: "MTS works on smoothed demand." },
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: ctx.demand_cv ?? 0.3, why: "Observed CV." },
        forecast_method: { value: "exp_smoothing", why: "Robust for stationary." },
        forecast_horizon_days: { value: 30, why: "Monthly plan." },
        priority_tier: { value: "B", why: "Default tier." },
        delivery_window_days: { value: 2, why: "2-day promise from stock." },
      },
      recovery: {
        enabled: { value: true, why: "Stock buffer is the first line of defence." },
        response: { value: ["safety_stock_drawdown"], why: "Draw down before escalating." },
      },
    };
  },
};
