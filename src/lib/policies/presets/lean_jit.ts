import type { PresetDefinition } from "../resolvePreset";

export const leanJit: PresetDefinition = {
  slug: "lean_jit",
  name: "Lean / JIT",
  description: "Minimal inventory, daily review, single-source, FTL — fast & cheap when stable.",
  is_system: true,
  derive: (ctx) => {
    const ltCv = ctx.supplier_lt_cv ?? 0.3;
    const ss = Math.max(2, Math.ceil(0.5 * ltCv * (ctx.supplier_lt_mean_days ?? 3)));
    const mean = ctx.demand_mean_per_day ?? 100;
    return {
      sourcing: {
        strategy: { value: "single", why: "Lean prefers a single trusted source." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top-volume supplier from inbound_logistic." },
        order_consolidation: { value: "daily", why: "Daily replenishment matches Lean cadence." },
        contract_type: { value: "contract", why: "Stable contracts reduce variability." },
      },
      inventory: {
        type: { value: "continuous_review", why: "Continuous review = lowest WIP for stable demand." },
        reorder_point: { value: Math.round(mean * (ctx.supplier_lt_mean_days ?? 3) * 0.6), why: "0.6 × demand × LT." },
        order_up_to: { value: Math.round(mean * (ctx.supplier_lt_mean_days ?? 3) * 1.2), why: "1.2 × demand × LT." },
        safety_stock_method: { value: "fixed_days", why: "Lean uses small fixed buffer." },
        safety_stock_days: { value: ss, why: `max(2, 0.5 × LT_cv × LT) = ${ss}d.` },
        review_period_days: { value: 1, why: "Daily review." },
        holding_cost_pct: { value: 0.25, why: "Lean assumes high carrying cost penalty." },
      },
      transport: {
        mode: { value: "road", why: "Default Lean mode for short cycle times." },
        load_type: { value: "FTL", why: "FTL avoids handling delays in JIT." },
        routing: { value: "direct", why: "Direct routing minimises lead-time variance." },
        min_fill_pct: { value: 60, why: "Accept lower fill to keep cadence." },
      },
      fulfillment: {
        backorder_allowed: { value: false, why: "Lean targets perfect availability." },
        service_level_alpha: { value: 0.92, why: "Trades 8% stockouts for low stock." },
        allocation: { value: "priority", why: "Priority-based when inventory is tight." },
      },
      production: {
        lot_policy: { value: "lot_for_lot", why: "Match production to pull signal." },
        utilization_cap_pct: { value: 80, why: "Slack for flow." },
        scheduling: { value: "fifo", why: "FIFO is takt-friendly." },
      },
      demand: {
        pattern: { value: "stationary", why: "Lean assumes smoothed demand." },
        mean_per_day: { value: mean, why: "From outbound_logistic mean." },
        cv: { value: ctx.demand_cv ?? 0.2, why: "Low CV assumption — review if real CV > 0.4." },
        forecast_method: { value: "exp_smoothing", why: "Good for stationary series." },
        forecast_horizon_days: { value: 7, why: "Short horizon matches daily replan." },
        priority_tier: { value: "B", why: "Default tier." },
      },
      recovery: {
        enabled: { value: true, why: "Lean is brittle — recovery must be active." },
        response: { value: ["mode_shift", "safety_stock_drawdown"], why: "Fast modes + buffer when shock hits." },
        recovery_target_days: { value: 14, why: "Aggressive recovery target." },
      },
    };
  },
};
