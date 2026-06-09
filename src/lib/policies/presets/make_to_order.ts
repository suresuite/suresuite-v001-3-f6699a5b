import type { PresetDefinition } from "../resolvePreset";

export const makeToOrder: PresetDefinition = {
  slug: "make_to_order",
  name: "Make-to-Order",
  description: "Zero FG stock, lot-for-lot production, long backorder window.",
  is_system: true,
  derive: (ctx) => {
    const mean = ctx.demand_mean_per_day ?? 50;
    return {
      sourcing: {
        strategy: { value: "primary_backup", why: "Primary + backup for component reliability." },
        primary_supplier: { value: ctx.top_supplier ?? "", why: "Top supplier as primary." },
        order_consolidation: { value: "none", why: "Order materials per customer order." },
      },
      inventory: {
        type: { value: "base_stock", why: "Base-stock = 0 for FG (component buffer only)." },
        reorder_point: { value: 0, why: "MTO: no FG reorder point." },
        order_up_to: { value: 0, why: "MTO: produce to order only." },
        max_stock: { value: 0, why: "Zero FG ceiling." },
        safety_stock_days: { value: 0, why: "No FG safety stock." },
        holding_cost_pct: { value: 0.25, why: "Discourages any unintended stock." },
      },
      transport: {
        mode: { value: "road", why: "Default mode for MTO ships." },
        load_type: { value: "LTL", why: "LTL — orders rarely fill FTL." },
        routing: { value: "direct", why: "Direct to customer on completion." },
      },
      fulfillment: {
        allocation: { value: "priority", why: "FCFS by tier." },
        backorder_allowed: { value: true, why: "Every order is essentially a backorder." },
        max_backorder_days: { value: 60, why: "Engineering + production cycle." },
        service_level_alpha: { value: 0.85, why: "Lower SLA — speed not the promise." },
        lost_sales_cost_per_unit: { value: 30, why: "Customer expectation of wait." },
      },
      production: {
        lot_policy: { value: "lot_for_lot", why: "One lot per customer order." },
        scheduling: { value: "edd", why: "EDD to keep promise dates." },
        utilization_cap_pct: { value: 80, why: "Slack absorbs job-mix variation." },
        setup_cost: { value: 500, why: "Setup per order." },
      },
      demand: {
        pattern: { value: "intermittent", why: "MTO orders are typically lumpy." },
        mean_per_day: { value: mean, why: "Observed mean." },
        cv: { value: ctx.demand_cv ?? 0.9, why: "High-CV assumption for MTO." },
        forecast_method: { value: "croston", why: "Croston for intermittent demand." },
        order_size_distribution: { value: "negbin", why: "NegBin fits lumpy orders." },
        priority_tier: { value: "A", why: "Each order is high-touch." },
        delivery_window_days: { value: 14, why: "Customer agreed lead time." },
        late_penalty_per_day: { value: 100, why: "Strong late penalty on promise." },
      },
      recovery: {
        enabled: { value: true, why: "Recovery = expedite production." },
        response: { value: ["capacity_flex", "dual_source_activate"], why: "Add shifts + alt component source." },
      },
    };
  },
};
