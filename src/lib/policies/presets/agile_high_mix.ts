import type { PresetDefinition } from "../resolvePreset";

export const agileHighMix: PresetDefinition = {
  slug: "agile_high_mix",
  name: "Agile / High-mix",
  description: "Multi-source, short review, parcel + LTL mix — adapts to choppy demand.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 100;
    const cv = ctx.demand_cv ?? 0.6;
    return {
      sourcing: {
        strategy: { value: "multi", why: "Multi-source for SKU coverage breadth." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top supplier as anchor." },
        order_consolidation: { value: "daily", why: "Frequent small POs follow volatile demand." },
        failover_trigger: { value: "stockout", why: "React fast to misses." },
      },
      inventory: {
        type: { value: "s_S", why: "(s,S) adapts to choppy demand." },
        review_period_days: { value: 1, why: "Daily review needed for high mix." },
        safety_stock_method: { value: "demand_variability", why: "Size SS to CV directly." },
        safety_stock_days: { value: Math.ceil(7 + cv * 10), why: `7 + CV × 10 = ${Math.ceil(7 + cv * 10)}d.` },
        order_up_to: { value: Math.round(mean * 10), why: "10-day cover." },
        abc_class: { value: "A", why: "Treat most SKUs as A under high mix." },
      },
      transport: {
        mode: { value: "road", why: "Road = most flexible." },
        load_type: { value: "parcel", why: "Parcel for small frequent shipments." },
        routing: { value: "milk_run", why: "Milk-run pools high-mix small drops." },
        min_fill_pct: { value: 50, why: "Accept low fill — speed > $/unit." },
      },
      fulfillment: {
        allocation: { value: "priority", why: "Priority allocation under churn." },
        backorder_allowed: { value: true, why: "Some misses inevitable; backorder absorbs." },
        max_backorder_days: { value: 7, why: "Short window — react fast." },
        service_level_alpha: { value: 0.94, why: "Realistic under high CV." },
        order_batching_window_hours: { value: 4, why: "4h batching for fast turnaround." },
      },
      production: {
        lot_policy: { value: "lot_for_lot", why: "Match each order one-for-one." },
        scheduling: { value: "edd", why: "Earliest-due-date keeps mix on time." },
        utilization_cap_pct: { value: 75, why: "Slack for sequence changes." },
        setup_time_hours: { value: 0.5, why: "SMED-style fast setup expected." },
      },
      demand: {
        pattern: { value: cv > 1.0 ? "lumpy" : "intermittent", why: "Classified by CV." },
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: cv, why: "Observed CV." },
        forecast_method: { value: cv > 1.5 ? "croston" : "exp_smoothing", why: "Croston for intermittent (CV > 1.5)." },
        forecast_horizon_days: { value: 7, why: "Short horizon for choppy series." },
        order_size_distribution: { value: cv > 1.0 ? "negbin" : "poisson", why: "NegBin captures lumpy orders." },
        priority_tier: { value: "B", why: "Default tier." },
      },
      recovery: {
        enabled: { value: true, why: "Volatile demand needs active recovery." },
        response: { value: ["safety_stock_drawdown", "dual_source_activate"], why: "Tap buffer + open alt source." },
      },
    };
  },
};
