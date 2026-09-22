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
  volumeWeightedInboundCost,
  weeklyDemand,
} from "../../../supabase/functions/_shared/grading.ts";
import {
  ENGINE_DEFAULT_PRICE as DEFAULT_PRICE,
  buildReducerCtx,
  derivedFallbackValues,
  unitDays as sharedUnitDays,
  type FallbackStep,
  type Row,
} from "../../../supabase/functions/_shared/grading.ts";
import { baseDataRequirements } from "./registryAccess";

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

/**
 * What the engine will value each material at when its master `cost` is
 * empty — the inbound half of the `materials.cost` chain, resolved in the
 * order the REGISTRY declares (today: the volume-weighted average price
 * across the material's lanes, then its cheapest quote when no lane carries
 * a volume to weight by).
 *
 * The order is read from `fallback_spec`, never restated here: a display
 * that hard-codes one step shows a number the run will not use the moment
 * the engine gains another (§4 D18's class).
 */
const MATERIAL_COST_STEPS = baseDataRequirements()
  .find((r) => r.field === "materials.cost")?.fallback_spec as FallbackStep[] | undefined;

export function derivedMaterialCost(inbound: Row[]): Map<string, number> {
  const ids = new Set<string>();
  for (const arc of inbound) {
    const id = String(arc.material_id ?? "");
    if (id) ids.add(id);
  }
  // Only the inbound reducers are consulted, so the other tables stay empty.
  const ctx = buildReducerCtx(
    { materials: [], products: [], suppliers: [], inbound, outbound: [], bom: [] },
    {},
  );
  return derivedFallbackValues(MATERIAL_COST_STEPS, ids, ctx);
}

/** Priority chain: master(>0) → derived inbound price → engine default 1.0. */
export function effectiveMaterialCost(
  masterCost: number | string | null | undefined,
  derivedCost: Map<string, number>,
  materialId: string,
): EffectiveValue {
  const master = num(masterCost);
  if (master > 0) return { value: master, source: "master" };
  const derived = derivedCost.get(materialId);
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
