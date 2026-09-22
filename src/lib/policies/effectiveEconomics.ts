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
  derivedFallbackDetails,
  derivedFallbackValues,
  unitDays as sharedUnitDays,
  type DerivedValue,
  type EmptyMeaning,
  type FallbackStep,
  type Row,
} from "../../../supabase/functions/_shared/grading.ts";
import { baseDataRequirements } from "./registryAccess";

export type { DerivedValue, EmptyMeaning };

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

const CAPACITY_STEPS = baseDataRequirements()
  .find((r) => r.field === "products.production_capacity")
  ?.fallback_spec as FallbackStep[] | undefined;

/**
 * A reducer's name, in a sentence — the display half of the registry's chain.
 *
 * NOT a second author of the RULE. The order, the grades and which reducer
 * answers are all read from `fallback_spec`; this only turns a reducer's
 * identifier into something a planner can read, which is presentation and
 * belongs on this side of the boundary. `fallbackStepLabels.test.ts` fails when
 * the registry names a reducer this map does not, so a step added to the engine
 * cannot reach a screen as a bare snake_case token.
 */
export const REDUCER_LABEL: Record<string, string> = {
  volume_weighted_inbound_price:
    "volume-weighted average of this material's inbound lane prices",
  cheapest_inbound_price: "cheapest quoted inbound price for this material",
  demand_weighted_outbound_price:
    "demand-weighted average of this product's outbound lane prices",
  weekly_outbound_volume: "sum of this product's weekly outbound volumes",
  production_policy_capacity:
    "the plant grid's line capacity — units/day × 7 × utilization cap",
  twice_demand_floor_1000:
    "the engine's no-capacity default, max(2 × demand, 1 000) — chosen so " +
    "capacity never binds, so this run cannot tell you whether it would",
};

/** `REDUCER_LABEL` with a safe fallback, for a step added since the last build. */
export const reducerLabel = (via: string): string => REDUCER_LABEL[via] ?? via;

/**
 * What the engine will build each product's weekly capacity from when its
 * master `products.production_capacity` is empty — the chain the REGISTRY
 * declares, and the step that answered.
 *
 * ── THE DISPLAY LAYER RESOLVED THIS TO NOTHING, FOR AS LONG AS IT EXISTED ──
 *
 * `resolveEffective.ts::derivedValueFor` ended on the line
 * `return undefined; // production_capacity has no logistics-derived fallback`.
 * That was true of the LOGISTICS tables and false of the engine: the chain is
 * `production_policy_capacity` (info) → `twice_demand_floor_1000` (warn), the
 * shared grader has walked it since the reducer library was written, and the
 * plant grid showed an empty cell for a number the run was certain to use
 * (§4 D165).
 *
 * The two steps are opposite statements, which is why this returns the STEP
 * and not just the number:
 *
 *   · `production_policy_capacity` — the planner's own line rate, converted
 *     (units/day × 7 × utilization_cap_pct). Capacity is real.
 *   · `twice_demand_floor_1000`    — max(2·demand, 1000). The engine's way of
 *     saying it has no capacity figure, chosen so capacity NEVER binds.
 *
 * `overrides` matters and is not optional detail: the plant grid writes its
 * per-row capacity as a `node:<plant>::<product>` production patch, and the
 * engine resolves that patch per product (§4 D75). Passing the project default
 * alone would show every row the same number while the run used twelve.
 */
export function derivedProductionCapacity(
  products: Row[],
  outbound: Row[],
  defaults: Row,
  overrides: Row[] = [],
): Map<string, DerivedValue> {
  const ids = new Set<string>();
  for (const p of products) {
    const id = String(p.product_id ?? "");
    if (id) ids.add(id);
  }
  const ctx = buildReducerCtx(
    { materials: [], products, suppliers: [], inbound: [], outbound, bom: [], overrides },
    defaults,
  );
  return derivedFallbackDetails(CAPACITY_STEPS, ids, ctx);
}

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
