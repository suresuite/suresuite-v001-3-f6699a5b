import { FIELD_LABELS, type PolicyBundle, type PolicyFamily } from "./schemas";
import type { StageKey } from "./stages";

export interface ColSpecCtx {
  fulfillmentStrategy?: string;
  row?: Record<string, unknown>;
  draft?: Record<string, unknown>;
  /** Flattened effective bundle for this row (all families merged). */
  effective?: Record<string, unknown>;
}

export interface ColSpec {
  field: string;
  family: PolicyFamily;
  label: string;
  visibleWhen?: (ctx: ColSpecCtx) => boolean;
  defaultWhenMissing?: number | string | boolean;
  /** Read-only synthetic columns (e.g. allocation share). Rendered as a badge. */
  readOnly?: boolean;
  /** Formatter for read-only values (e.g. append "%" for share_pct). */
  format?: (n: number) => string;
  /**
   * Item-master-backed column: the value lives in the materials/products
   * table (row id taken from `idFrom`), edits save via the item-master
   * upsert RPCs — NOT as policy overrides. The engine reads these fields
   * from the masters first, with a logistics-derived fallback
   * (docs/data-simulation-mapping.md §4).
   */
  master?: { table: "materials" | "products" | "suppliers"; field: string; idFrom: string };
}

export interface StageTableSpec {
  scope: "node" | "edge";
  keyCols: { id: string; label: string }[];
  cols: ColSpec[];
  targetKey: (row: Record<string, unknown>) => string;
}

const lbl = (f: string) => FIELD_LABELS[f] ?? f;
const col = (
  field: string,
  family: PolicyFamily,
  opts: {
    visibleWhen?: ColSpec["visibleWhen"];
    defaultWhenMissing?: ColSpec["defaultWhenMissing"];
    readOnly?: boolean;
    format?: ColSpec["format"];
    master?: ColSpec["master"];
  } = {},
): ColSpec => ({ field, family, label: lbl(field), ...opts });

// ---------- gating helpers ----------
const plantNeedsInventory: ColSpec["visibleWhen"] = ({ fulfillmentStrategy }) =>
  fulfillmentStrategy === "make_to_stock" ||
  fulfillmentStrategy === "assemble_to_order" ||
  fulfillmentStrategy === "configure_to_order";

export const STAGE_TABLE_SPEC: Record<StageKey, StageTableSpec> = {
  // ----------------------------- SUPPLIER -----------------------------
  supplier: {
    scope: "node",
    keyCols: [
      { id: "material_id", label: "Material" },
      { id: "supplier_id", label: "Supplier" },
    ],
    // scsim alignment: only fields the engine consumes (plus master-data
    // columns describing the supplier × material row itself). Absolute stock
    // levels, review period, MOQ, ordering cost and the entire transport
    // family are not read by scsim and are hidden. Transport lead times come
    // from network edge attributes.
    cols: [
      col("primary_source", "sourcing"),
      col("share_pct", "sourcing", { readOnly: true, format: (n) => `${n}%` }),
      col("material_price", "sourcing", { defaultWhenMissing: 0 }),
      col("lead_time_mean_days", "sourcing", { readOnly: true, format: (n) => `${n} d` }),
      col("material_cost", "sourcing", {
        master: { table: "materials", field: "cost", idFrom: "material_id" },
      }),
      col("material_moq", "sourcing", {
        master: { table: "materials", field: "moq", idFrom: "material_id" },
      }),
      // Engine-real supplier attributes (suppliers master): finite capacity
      // enables partial capacity-reduction disruptions; empty = unlimited.
      col("capacity_per_week", "sourcing", {
        master: { table: "suppliers", field: "capacity_per_week", idFrom: "supplier_id" },
      }),
      col("reliability_score", "sourcing", {
        master: { table: "suppliers", field: "reliability_score", idFrom: "supplier_id" },
      }),

      col("type", "inventory"),
      col("safety_stock_days", "inventory", { defaultWhenMissing: 0 }),
      col("holding_cost_pct", "inventory", { defaultWhenMissing: 0.2 }),
    ],
    targetKey: (r) => `${r.supplier_id}::${r.material_id ?? ""}`,
  },

  // ----------------------------- PLANT -----------------------------
  plant: {
    scope: "node",
    keyCols: [
      { id: "item_id", label: "Focal plant" },
      { id: "product_id", label: "Product" },
    ],
    // scsim alignment: lot sizing, setup, scheduling, machine/labor capacity
    // and production lead-time distributions are not consumed by the engine.
    cols: [
      col("sell_price", "production", {
        master: { table: "products", field: "sell_price", idFrom: "product_id" },
      }),
      col("production_capacity", "production", {
        master: { table: "products", field: "production_capacity", idFrom: "product_id" },
      }),
      col("demand_mean", "production", {
        master: { table: "products", field: "demand_mean", idFrom: "product_id" },
      }),
      col("capacity_units_per_day", "production", { defaultWhenMissing: 1000 }),
      col("backorder_cost_per_day", "fulfillment", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0 }),

      col("type", "inventory", { visibleWhen: plantNeedsInventory }),
      col("safety_stock_days", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0 }),
      col("holding_cost_pct", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0.2 }),
      col("service_level_target", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0.95 }),
    ],
    targetKey: (r) => `${r.item_id}::${r.product_id ?? ""}`,
  },

  // ----------------------------- CUSTOMER -----------------------------
  customer: {
    scope: "node",
    keyCols: [
      { id: "customer_id", label: "Customer" },
      { id: "product_id", label: "Product" },
    ],
    // scsim alignment: demand-shape fields are not consumed by the engine
    // (demand comes from product/graph data); only fulfillment settings remain.
    cols: [
      col("primary_source", "fulfillment"),
      col("sourcing_firm", "fulfillment"),
      col("price", "fulfillment", { defaultWhenMissing: 0 }),
      col("mean_per_day", "fulfillment", { readOnly: true, format: (n) => `${Math.round(n * 100) / 100}/d` }),
      col("delivery_window_days", "fulfillment", { readOnly: true, format: (n) => `${n} d` }),
      col("backorder_cost_per_day", "fulfillment", { defaultWhenMissing: 0 }),
    ],
    targetKey: (r) => `${r.customer_id}::${r.product_id ?? ""}`,
  },
  run_validate: { scope: "node", keyCols: [], cols: [], targetKey: () => "" },
};

export function specFor(stage: StageKey): StageTableSpec {
  return STAGE_TABLE_SPEC[stage];
}

export function familiesForStage(stage: StageKey): PolicyFamily[] {
  const fams = new Set<PolicyFamily>();
  for (const c of STAGE_TABLE_SPEC[stage].cols) fams.add(c.family);
  return Array.from(fams);
}

/** No-row col visibility — used as a fallback only. Prefer `headerColsUnion`. */
export function visibleCols(
  stage: StageKey,
  ctx: { fulfillmentStrategy?: string },
): ColSpec[] {
  return STAGE_TABLE_SPEC[stage].cols.filter(
    (c) => !c.visibleWhen || c.visibleWhen(ctx),
  );
}

export function visibleColsForRow(
  stage: StageKey,
  ctx: ColSpecCtx,
): ColSpec[] {
  return STAGE_TABLE_SPEC[stage].cols.filter(
    (c) => !c.visibleWhen || c.visibleWhen(ctx),
  );
}

/** Flatten a PolicyBundle into a single { field: value } map across families. */
export function flattenBundle(bundle: PolicyBundle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const fam of Object.keys(bundle) as PolicyFamily[]) {
    const f = (bundle as unknown as Record<PolicyFamily, Record<string, unknown>>)[fam];
    if (!f) continue;
    for (const [k, v] of Object.entries(f)) {
      // first-wins so distribution-named fields don't clash across families.
      if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

/**
 * Header = union of per-row visible cols (so adaptive columns appear as soon
 * as a single row needs them). Preserves declared order from the stage spec.
 */
export function headerColsUnion(
  stage: StageKey,
  rowsCtx: ColSpecCtx[],
): ColSpec[] {
  if (rowsCtx.length === 0) return visibleCols(stage, {});
  const want = new Set<string>();
  for (const ctx of rowsCtx) {
    for (const c of visibleColsForRow(stage, ctx)) want.add(c.field);
  }
  return STAGE_TABLE_SPEC[stage].cols.filter((c) => want.has(c.field));
}
