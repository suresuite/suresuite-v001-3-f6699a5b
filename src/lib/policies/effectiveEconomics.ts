// Frontend view over the engine's economics fallback chains.
//
// The reducers themselves live in the ONE grading module shared with the
// edge pre-dispatch gate (supabase/functions/_shared/grading.ts) — the same
// code that mirrors scsim/scsim/io/project_map.py and is pinned to it by the
// validation-parity fixtures. This file re-exports them for display call
// sites and keeps the provenance-annotated `effective*` helpers (a UI
// concern: "what value will the engine use, and where does it come from").

export {
  ENGINE_DEFAULT_PRICE,
  cheapestInboundCost,
  demandWeightedSellPrice,
  rateToWeekly,
  unitDays,
  weeklyDemand,
} from "../../../supabase/functions/_shared/grading.ts";
import {
  ENGINE_DEFAULT_PRICE as DEFAULT_PRICE,
  unitDays as sharedUnitDays,
} from "../../../supabase/functions/_shared/grading.ts";

export type Provenance = "master" | "inbound" | "outbound" | "engine-default";

export interface EffectiveValue {
  value: number;
  source: Provenance;
}

export interface InboundArc {
  material_id: string | null;
  unit_price: number | string | null;
}

export interface OutboundArc {
  product_id: string | null;
  unit_price: number | string | null;
  volume: number | string | null;
  time_unit: string | null;
}

/** Quantity per `unit`-period → quantity per day. Unknown unit → weekly basis. */
export function ratePerDay(
  value: number,
  unit: string | null | undefined,
  defaultDays = 7,
): number {
  const days = sharedUnitDays(unit) ?? defaultDays;
  return value / days;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Priority chain: master(>0) → cheapest inbound → engine default 1.0. */
export function effectiveMaterialCost(
  masterCost: number | string | null | undefined,
  cheapest: Map<string, number>,
  materialId: string,
): EffectiveValue {
  const master = num(masterCost);
  if (master > 0) return { value: master, source: "master" };
  const derived = cheapest.get(materialId);
  if (derived !== undefined) return { value: derived, source: "inbound" };
  return { value: DEFAULT_PRICE, source: "engine-default" };
}

/** Priority chain: master(>0) → demand-weighted outbound → engine default 1.0. */
export function effectiveSellPrice(
  masterPrice: number | string | null | undefined,
  weighted: Map<string, number>,
  productId: string,
): EffectiveValue {
  const master = num(masterPrice);
  if (master > 0) return { value: master, source: "master" };
  const derived = weighted.get(productId);
  if (derived !== undefined) return { value: derived, source: "outbound" };
  return { value: DEFAULT_PRICE, source: "engine-default" };
}

/** Priority chain: master(>0) → Σ weekly outbound volume → 0 (never ordered). */
export function effectiveDemandMean(
  masterMean: number | string | null | undefined,
  demand: Map<string, number>,
  productId: string,
): EffectiveValue {
  const master = num(masterMean);
  if (master > 0) return { value: master, source: "master" };
  const derived = demand.get(productId) ?? 0;
  if (derived > 0) return { value: derived, source: "outbound" };
  return { value: 0, source: "engine-default" };
}
