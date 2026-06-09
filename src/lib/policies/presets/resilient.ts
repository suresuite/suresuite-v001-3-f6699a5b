import type { PresetDefinition } from "../resolvePreset";

export const resilient: PresetDefinition = {
  slug: "resilient",
  name: "Resilient",
  description: "Dual-source, 14-day safety stock, mode-shift on disruption.",
  is_system: true,
  derive: (ctx) => {
    const ltCv = ctx.supplier_lt_cv ?? 0.3;
    const ss = Math.max(14, Math.ceil(2 * ltCv * (ctx.supplier_lt_mean_days ?? 3)));
    const mean = ctx.demand_mean_per_day ?? 100;
    return {
      sourcing: {
        strategy: { value: "dual_sourcing", why: "Dual source eliminates single-point failure." },
        ratios: { value: { primary: 0.7, backup: 0.3 }, why: "70/30 split keeps both suppliers warm." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top-volume supplier as primary." },
        failover_trigger: { value: "lead_time_breach", why: "Trigger before stockout, not after." },
        failover_threshold_pct: { value: 15, why: "Conservative trigger." },
        min_reliability: { value: 0.95, why: "Resilient demands reliable suppliers." },
      },
      inventory: {
        type: { value: "s_S", why: "(s,S) absorbs supply variability." },
        safety_stock_method: { value: "service_level", why: "Service-level method sizes SS to risk." },
        safety_stock_days: { value: ss, why: `max(14, 2 × LT_cv × LT) = ${ss}d.` },
        service_level_target: { value: 0.97, why: "High target." },
        review_period_days: { value: 1, why: "Daily review catches drift fast." },
        holding_cost_pct: { value: 0.18, why: "Accept higher holding for resilience." },
      },
      transport: {
        mode: { value: "intermodal", why: "Intermodal allows mode-shift recovery." },
        load_type: { value: "FTL", why: "FTL for reliability." },
        lead_time_std_days: { value: 0.3, why: "Lower σ — prefer reliable carriers." },
      },
      fulfillment: {
        allocation: { value: "sla_tier", why: "Protect top-tier customers under stress." },
        backorder_allowed: { value: true, why: "Backorder preserves goodwill in disruption." },
        max_backorder_days: { value: 21, why: "21d window matches recovery target." },
        service_level_alpha: { value: 0.97, why: "High SLA matches inventory target." },
      },
      production: {
        utilization_cap_pct: { value: 75, why: "Reserve 25% capacity for surge." },
        lot_policy: { value: "epq", why: "EPQ balances setup vs holding." },
      },
      demand: {
        pattern: { value: ctx.demand_cv && ctx.demand_cv > 0.6 ? "lumpy" : "stationary", why: "Classify by observed CV." },
        mean_per_day: { value: mean, why: "From outbound_logistic." },
        cv: { value: ctx.demand_cv ?? 0.3, why: "Observed CV (fallback 0.3)." },
        forecast_method: { value: "exp_smoothing", why: "Robust under variability." },
        forecast_horizon_days: { value: 21, why: "Match recovery horizon." },
        priority_tier: { value: "A", why: "Treat as high-priority demand." },
      },
      recovery: {
        enabled: { value: true, why: "Core of this preset." },
        response: {
          value: ["dual_source_activate", "mode_shift", "safety_stock_drawdown"],
          why: "Layered response: switch source → switch mode → tap buffer.",
        },
        trigger_magnitude_pct: { value: 15, why: "Early trigger." },
        recovery_target_days: { value: 21, why: "Industry-standard resilience target." },
        cost_cap: { value: 50000, why: "Higher cap — resilience is paid for." },
      },
    };
  },
};
