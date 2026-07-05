// Frontend mirror of the engine's economics fallback chains.
//
// CONTRACT: this module must stay in lockstep with
// `scsim/scsim/io/project_map.py` (`from_project_data`) and
// `docs/data-simulation-mapping.md` §4 — it encodes the exact same reducers:
//
//   material cost   = materials.cost (>0)
//                     → cheapest inbound unit_price across supplier links
//                       (each arc's price defaulted to 1.0 when missing/≤0,
//                        project_map.py:276-294, 337-346)
//                     → 1.0
//   product price   = products.sell_price (>0)
//                     → demand-weighted average of outbound unit_price,
//                       weight = weekly volume rate, floor 1e-9
//                       (project_map.py:308-318, 362-371)
//                     → 1.0
//   demand mean     = products.demand_mean (>0)
//                     → Σ weekly outbound volume (project_map.py:373-379)
//                     → 0
//
// The engine works in weeks; time_unit vocabulary is ported verbatim from
// project_map.py `_UNIT_DAYS`.

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

export const ENGINE_DEFAULT_PRICE = 1.0;

// project_map.py `_UNIT_DAYS`, verbatim.
const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1, d: 1,
  week: 7, weeks: 7, wk: 7, w: 7,
  month: 30.4375, months: 30.4375, mo: 30.4375, m: 30.4375,
  year: 365.25, years: 365.25, yr: 365.25, y: 365.25,
};

function unitDays(unit: string | null | undefined): number | undefined {
  if (!unit) return undefined;
  return UNIT_DAYS[String(unit).trim().toLowerCase()];
}

/** project_map.py `_rate_to_weekly`: quantity per unit-period → per week. */
export function rateToWeekly(
  value: number,
  unit: string | null | undefined,
  defaultDays = 7,
): number {
  const days = unitDays(unit) ?? defaultDays;
  return (value * 7) / days;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cheapest inbound unit_price per material — the engine's fallback for
 * materials.cost. Matches project_map.py:276-294: every arc contributes,
 * with missing/≤0 prices defaulted to 1.0 *before* taking the min.
 */
export function cheapestInboundCost(inbound: InboundArc[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const arc of inbound) {
    const mat = String(arc.material_id ?? "");
    if (!mat) continue;
    let cost = num(arc.unit_price);
    if (cost <= 0) cost = ENGINE_DEFAULT_PRICE;
    out.set(mat, Math.min(out.get(mat) ?? cost, cost));
  }
  return out;
}

/**
 * Demand-weighted average outbound unit_price per product — the engine's
 * fallback for products.sell_price. Matches project_map.py:308-318: rows
 * with falsy unit_price are skipped; weight = weekly volume rate with a
 * 1e-9 floor.
 */
export function demandWeightedSellPrice(outbound: OutboundArc[]): Map<string, number> {
  const numer = new Map<string, number>();
  const denom = new Map<string, number>();
  for (const o of outbound) {
    const prod = String(o.product_id ?? "");
    if (!prod) continue;
    const price = num(o.unit_price);
    if (!price) continue; // engine: `if o.unit_price:` — falsy skipped
    const weekly = rateToWeekly(num(o.volume), o.time_unit);
    const wgt = Math.max(weekly, 1e-9);
    numer.set(prod, (numer.get(prod) ?? 0) + price * wgt);
    denom.set(prod, (denom.get(prod) ?? 0) + wgt);
  }
  const out = new Map<string, number>();
  for (const [prod, n] of numer) {
    const d = denom.get(prod) ?? 0;
    if (d > 0) out.set(prod, n / d);
  }
  return out;
}

/**
 * Σ weekly outbound volume per product — the engine's fallback for
 * products.demand_mean (project_map.py:310-311, 373-379).
 */
export function weeklyDemand(outbound: OutboundArc[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of outbound) {
    const prod = String(o.product_id ?? "");
    if (!prod) continue;
    const weekly = rateToWeekly(num(o.volume), o.time_unit);
    out.set(prod, (out.get(prod) ?? 0) + weekly);
  }
  return out;
}

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
  return { value: ENGINE_DEFAULT_PRICE, source: "engine-default" };
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
  return { value: ENGINE_DEFAULT_PRICE, source: "engine-default" };
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
