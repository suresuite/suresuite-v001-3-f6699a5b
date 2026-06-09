import type { PolicyBundle, PolicyFamily } from "./schemas";
import { parseFamily, DEFAULT_BUNDLE } from "./schemas";

/** Loaded preset row from the DB (or built-in fallback). */
export interface PolicyPreset {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_system: boolean;
  bundle: Partial<Record<PolicyFamily, Record<string, unknown>>>;
}

/** Built-in fallback presets (must mirror the seed migration). Used if the
 *  DB hasn't been seeded yet or for offline rendering. */
export const FALLBACK_PRESETS: PolicyPreset[] = [
  {
    id: "fallback-lean_jit",
    slug: "lean_jit",
    name: "Lean / JIT",
    description: "Low safety stock, daily review, single-source, FTL, no backorder.",
    is_system: true,
    bundle: {
      inventory: { type: "continuous_review", reorder_point: 20, order_up_to: 80, safety_stock_days: 2 },
      sourcing: { strategy: "single" },
      transport: { mode: "road", load_type: "FTL" },
      fulfillment: { backorder_allowed: false, service_level_alpha: 0.92 },
    },
  },
  {
    id: "fallback-resilient",
    slug: "resilient",
    name: "Resilient",
    description: "14-day SS, dual-source 70/30, mode-shift recovery.",
    is_system: true,
    bundle: {
      sourcing: { strategy: "dual_sourcing", ratios: { primary: 0.7, backup: 0.3 } },
      inventory: { safety_stock_days: 14, safety_stock_method: "service_level" },
      recovery: { enabled: true, response: ["dual_source_activate", "mode_shift"] },
    },
  },
  {
    id: "fallback-cost_optimized",
    slug: "cost_optimized",
    name: "Cost-optimized",
    description: "EOQ inventory, milk-run routing, weekly consolidation, LTL.",
    is_system: true,
    bundle: {
      inventory: { type: "s_S", holding_cost_pct: 0.18 },
      transport: { load_type: "LTL", routing: "milk_run" },
      sourcing: { order_consolidation: "weekly" },
    },
  },
  {
    id: "fallback-service_first",
    slug: "service_first",
    name: "Service-first",
    description: "99% SLA, large SS, fair-share allocation.",
    is_system: true,
    bundle: {
      inventory: { type: "base_stock", safety_stock_days: 21 },
      fulfillment: { allocation: "fair_share", service_level_alpha: 0.99 },
    },
  },
  {
    id: "fallback-sustainable",
    slug: "sustainable",
    name: "Sustainable",
    description: "Sea/rail bias, large batches, carbon-capped routing.",
    is_system: true,
    bundle: {
      transport: { mode: "sea", load_type: "container", routing: "hub_spoke" },
    },
  },
  {
    id: "fallback-agile_high_mix",
    slug: "agile_high_mix",
    name: "Agile / High-mix",
    description: "s,S short review, multi-source, parcel + LTL mix.",
    is_system: true,
    bundle: {
      inventory: { type: "s_S", review_period_days: 1 },
      transport: { load_type: "parcel" },
      sourcing: { strategy: "multi" },
    },
  },
  {
    id: "fallback-make_to_order",
    slug: "make_to_order",
    name: "Make-to-order",
    description: "Base-stock=0, full backorder, lot-for-lot production.",
    is_system: true,
    bundle: {
      inventory: { type: "base_stock", reorder_point: 0, order_up_to: 0, safety_stock_days: 0 },
      production: { lot_policy: "lot_for_lot" },
      fulfillment: { backorder_allowed: true, max_backorder_days: 60 },
    },
  },
];

/** Resolve a preset's value for one family (with defaults filling gaps). */
export function presetFamily<F extends PolicyFamily>(
  preset: PolicyPreset,
  family: F,
): PolicyBundle[F] {
  const raw = preset.bundle[family] ?? {};
  return parseFamily(family, { ...DEFAULT_BUNDLE[family], ...raw });
}
