import type { PolicyBundle } from "./schemas";
import type { OverrideRow } from "./resolve";
import { effectivePolicy } from "./resolve";
import type { StageKey } from "./stages";
import type { StageRow } from "@/hooks/useStageRows";
import type { MaterialRow, ProductRow } from "@/hooks/useItemMasters";

export type Severity = "block" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  stage: StageKey;
  rowKey?: string;
  field?: string;
  message: string;
  hint?: string;
}

interface VerifyInput {
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: string;
  supplierRows: StageRow[];
  plantRows: StageRow[];
  customerRows: StageRow[];
  /** Optional — when omitted, the time-unit check is skipped. */
  timeUnit?: "day" | "week" | "month" | null;
  /**
   * Item-master economics the engine actually reads (Phase A / G4 / §8.3).
   * When omitted (e.g. the write RPCs haven't reached the DB yet) the
   * item-master checks are skipped rather than producing false blockers.
   */
  materials?: MaterialRow[];
  products?: ProductRow[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pre-run validation for the /policies "Run & Validate" stage.
 *
 * Two kinds of check:
 *   1. Structural/topology checks on the sourcing graph (a material must have a
 *      supplier, exactly one primary, etc.) — these mirror hard errors the
 *      mapper raises.
 *   2. Data-completeness checks on the economics the scsim engine actually
 *      reads — the item masters (materials.cost, products.sell_price/
 *      demand_mean/production_capacity). Each is graded against the engine's
 *      real fallback chain (scsim/scsim/io/project_map.py): a field resolves
 *      to a meaningless *constant* → block; it resolves via a logistics
 *      fallback → warn; the master is set → clean.
 *
 * It deliberately no longer checks policy-override fields the engine ignores
 * (transport.lead_time_mean_days, sourcing.material_price, production
 * capacities, absolute reorder points) — that was gap G6: passing validation
 * while the run silently defaulted every economic input.
 */
export function verifyProjectPolicies(input: VerifyInput): Finding[] {
  const out: Finding[] = [];
  const {
    defaults, overrides,
    supplierRows, plantRows, customerRows, timeUnit,
    materials, products,
  } = input;

  if (timeUnit === null) {
    out.push({
      id: "time-unit-missing",
      severity: "block",
      stage: "run_validate",
      message: "Planning time unit is not set.",
      hint: "Pick day / week / month at the top of the policies page.",
    });
  }

  // ---------- Suppliers: sourcing topology ----------
  if (supplierRows.length === 0) {
    out.push({
      id: "no-suppliers",
      severity: "block",
      stage: "supplier",
      message: "No supplier rows for this project.",
      hint: "Upload inbound logistics in Data Manager.",
    });
  }
  // Exactly one primary supplier per material; every material sourced.
  const primariesByMat = new Map<string, number>();
  const materialsMissingSupplier = new Set<string>();
  // Per-material inbound price — the engine's fallback for materials.cost.
  const inboundPriceByMat = new Map<string, number>();
  for (const r of supplierRows) {
    const mat = String(r.material_id ?? "");
    if (mat) {
      inboundPriceByMat.set(mat, Math.max(inboundPriceByMat.get(mat) ?? 0, num((r as Record<string, unknown>).material_price)));
    }
    if ((r as Record<string, unknown>).__needs_supplier || r.supplier_id === "(unassigned supplier)") {
      if (mat) materialsMissingSupplier.add(mat);
      out.push({
        id: `s-nosup-${r.material_id}`,
        severity: "block",
        stage: "supplier",
        rowKey: String(r.key),
        message: `Material "${r.material_id}" has no supplier — assign one.`,
        hint: "Every material must be sourced from at least one supplier.",
      });
      continue;
    }
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    if ((eff.sourcing as Record<string, unknown>).primary_source === true) {
      primariesByMat.set(mat, (primariesByMat.get(mat) ?? 0) + 1);
    }
  }
  for (const [mat, count] of primariesByMat) {
    if (count > 1) {
      out.push({
        id: `s-prim-${mat}`,
        severity: "block",
        stage: "supplier",
        message: `Material "${mat}" has ${count} suppliers marked primary — pick exactly one.`,
      });
    }
  }
  const mats = new Set(supplierRows.map((r) => String(r.material_id ?? "")));
  for (const m of mats) {
    if (materialsMissingSupplier.has(m)) continue;
    if (!primariesByMat.has(m) && m !== "(no material data)" && m !== "") {
      out.push({
        id: `s-noprim-${m}`,
        severity: "block",
        stage: "supplier",
        message: `Material "${m}" has no primary supplier — select one.`,
      });
    }
  }

  // ---------- Customers: fulfillment topology ----------
  // Per-product outbound price + volume — the engine's fallbacks for
  // products.sell_price and products.demand_mean respectively.
  const outboundPriceByProd = new Map<string, number>();
  const outboundVolByProd = new Map<string, number>();
  const primariesByCP = new Map<string, number>();
  const cpSeen = new Set<string>();
  for (const r of customerRows) {
    const prod = String(r.product_id ?? "");
    if (prod) {
      outboundPriceByProd.set(prod, Math.max(outboundPriceByProd.get(prod) ?? 0, num((r as Record<string, unknown>).price)));
      outboundVolByProd.set(prod, (outboundVolByProd.get(prod) ?? 0) + num((r as Record<string, unknown>).mean_per_day));
    }
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    const cp = `${r.customer_id}::${r.product_id}`;
    cpSeen.add(cp);
    if ((eff.fulfillment as Record<string, unknown>).primary_source === true) {
      primariesByCP.set(cp, (primariesByCP.get(cp) ?? 0) + 1);
    }
  }
  for (const cp of cpSeen) {
    const n = primariesByCP.get(cp) ?? 0;
    if (n !== 1) {
      out.push({
        id: `c-prim-${cp}`,
        severity: "block",
        stage: "customer",
        message:
          n === 0
            ? `Customer/product "${cp}" has no primary sourcing firm — select one.`
            : `Customer/product "${cp}" has ${n} primary firms — pick exactly one.`,
      });
    }
  }

  // ---------- Item-master economics (the fields the engine reads) ----------
  // Materials: cost → master, else cheapest inbound price, else 1.0.
  for (const m of materials ?? []) {
    if (num(m.cost) > 0) continue;
    const mid = String(m.material_id);
    const fb = inboundPriceByMat.get(mid) ?? 0;
    out.push(
      fb > 0
        ? {
            id: `im-cost-${mid}`, severity: "warn", stage: "supplier", rowKey: mid, field: "cost",
            message: `Material "${mid}" has no master cost — the engine will use its inbound price (≈${round2(fb)}).`,
            hint: "Set a cost in the Item Master editor to make supply cost explicit.",
          }
        : {
            id: `im-cost-${mid}`, severity: "block", stage: "supplier", rowKey: mid, field: "cost",
            message: `Material "${mid}" has no cost in the item master or inbound logistics — the engine would default it to 1.0.`,
            hint: "Set a cost in the Item Master editor (coin icon on the project card).",
          },
    );
  }
  // Products: sell_price → master, else outbound price, else 1.0; demand_mean →
  // master, else Σ outbound volume, else 0; production_capacity → master, else
  // a constant default (never binds, so recommended only).
  for (const p of products ?? []) {
    const pid = String(p.product_id);
    if (num(p.sell_price) <= 0) {
      const fb = outboundPriceByProd.get(pid) ?? 0;
      out.push(
        fb > 0
          ? {
              id: `im-price-${pid}`, severity: "warn", stage: "plant", rowKey: pid, field: "sell_price",
              message: `Product "${pid}" has no master sell price — the engine will use its outbound price (≈${round2(fb)}).`,
              hint: "Set a sell price in the Item Master editor to make revenue explicit.",
            }
          : {
              id: `im-price-${pid}`, severity: "block", stage: "plant", rowKey: pid, field: "sell_price",
              message: `Product "${pid}" has no sell price in the item master or outbound logistics — the engine would default it to 1.0 and revenue KPIs would be meaningless.`,
              hint: "Set a sell price in the Item Master editor.",
            },
      );
    }
    if (num(p.demand_mean) <= 0) {
      const fb = outboundVolByProd.get(pid) ?? 0;
      out.push(
        fb > 0
          ? {
              id: `im-demand-${pid}`, severity: "warn", stage: "plant", rowKey: pid, field: "demand_mean",
              message: `Product "${pid}" has no master demand mean — the engine will derive demand from its outbound volume.`,
              hint: "Set a demand mean in the Item Master editor to control it directly.",
            }
          : {
              id: `im-demand-${pid}`, severity: "block", stage: "plant", rowKey: pid, field: "demand_mean",
              message: `Product "${pid}" has no demand in the item master or outbound logistics — it will never be ordered (zero demand).`,
              hint: "Set a demand mean in the Item Master editor, or add outbound logistics.",
            },
      );
    }
    if (num(p.production_capacity) <= 0) {
      out.push({
        id: `im-cap-${pid}`, severity: "warn", stage: "plant", rowKey: pid, field: "production_capacity",
        message: `Product "${pid}" has no production capacity — the engine will assume an effectively unlimited plant.`,
        hint: "Set a capacity in the Item Master editor if this product's plant is capacity-constrained.",
      });
    }
  }

  // ---------- Orphan overrides ----------
  const validKeys = new Set([
    ...supplierRows.map((r) => r.key),
    ...plantRows.map((r) => r.key),
    ...customerRows.map((r) => r.key),
  ]);
  for (const o of overrides) {
    if (!validKeys.has(o.target_key)) {
      out.push({
        id: `orphan-${o.target_key}-${o.family}`,
        severity: "info",
        stage: "supplier",
        rowKey: o.target_key,
        message: `Orphan override on "${o.target_key}" (${o.family}) — row no longer in data.`,
      });
    }
  }

  return out;
}
