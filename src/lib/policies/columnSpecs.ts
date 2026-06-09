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
  } = {},
): ColSpec => ({ field, family, label: lbl(field), ...opts });

// ---------- gating helpers — now read draft → row → effective → fallback ----------
const readField = (ctx: ColSpecCtx, field: string): unknown => {
  const d = ctx.draft?.[field];
  if (d !== undefined) return d;
  const r = ctx.row?.[field];
  if (r !== undefined && r !== null && r !== "") return r;
  const e = ctx.effective?.[field];
  if (e !== undefined) return e;
  return undefined;
};

const invType = (ctx: ColSpecCtx): string =>
  (readField(ctx, "type") as string) ?? "min_max";

const distOf = (ctx: ColSpecCtx, field: string): string =>
  (readField(ctx, field) as string) ?? "normal";

const plantNeedsInventory: ColSpec["visibleWhen"] = ({ fulfillmentStrategy }) =>
  fulfillmentStrategy === "make_to_stock" ||
  fulfillmentStrategy === "assemble_to_order" ||
  fulfillmentStrategy === "configure_to_order";

const plantNeedsProductionExtras: ColSpec["visibleWhen"] = ({ fulfillmentStrategy }) =>
  fulfillmentStrategy !== "engineer_to_order";

const ifInvType =
  (...types: string[]): ColSpec["visibleWhen"] =>
  (ctx) => types.includes(invType(ctx));

const ifDist =
  (field: string, ...dists: string[]): ColSpec["visibleWhen"] =>
  (ctx) => dists.includes(distOf(ctx, field));

const plantInvAnd =
  (gate: ColSpec["visibleWhen"]): ColSpec["visibleWhen"] =>
  (ctx) => plantNeedsInventory(ctx) && (gate ? gate(ctx) : true);

// ---------- distribution column groups (reusable across stages) ----------
function leadTimeDistCols(
  family: PolicyFamily,
  meanField: string,
  stdField: string,
  shapeField = "lead_time_shape",
  scaleField = "lead_time_scale",
  minField = "lead_time_min",
  modeField = "lead_time_mode",
  maxField = "lead_time_max",
  extraGate?: ColSpec["visibleWhen"],
): ColSpec[] {
  const gate = (inner: ColSpec["visibleWhen"]): ColSpec["visibleWhen"] =>
    (ctx) => (extraGate ? extraGate(ctx) : true) && (inner ? inner(ctx) : true);

  return [
    col("lead_time_distribution", family, { visibleWhen: gate(undefined) }),
    col(meanField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "normal", "lognormal")),
      defaultWhenMissing: 1,
    }),
    col(stdField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "normal", "lognormal")),
      defaultWhenMissing: 0.2,
    }),
    col(shapeField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "gamma")),
      defaultWhenMissing: 2,
    }),
    col(scaleField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "gamma")),
      defaultWhenMissing: 1,
    }),
    col(minField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "triangular")),
      defaultWhenMissing: 0,
    }),
    col(modeField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "triangular")),
      defaultWhenMissing: 1,
    }),
    col(maxField, family, {
      visibleWhen: gate(ifDist("lead_time_distribution", "triangular")),
      defaultWhenMissing: 2,
    }),
  ];
}

export const STAGE_TABLE_SPEC: Record<StageKey, StageTableSpec> = {
  // ----------------------------- SUPPLIER -----------------------------
  supplier: {
    scope: "node",
    keyCols: [
      { id: "material_id", label: "Material" },
      { id: "supplier_id", label: "Supplier" },
    ],
    cols: [
      col("primary_source", "sourcing"),
      col("share_pct", "sourcing", { readOnly: true }),
      col("material_price", "sourcing", { defaultWhenMissing: 0 }),
      col("ordering_cost", "inventory", { defaultWhenMissing: 0 }),
      col("moq", "inventory", { defaultWhenMissing: 0 }),
      col("supplier_capacity_per_day", "sourcing", { defaultWhenMissing: 999_999_999 }),

      col("type", "inventory"),
      col("min_stock", "inventory", { visibleWhen: ifInvType("min_max"), defaultWhenMissing: 0 }),
      col("max_stock", "inventory", { visibleWhen: ifInvType("min_max"), defaultWhenMissing: 0 }),
      col("reorder_point", "inventory", {
        visibleWhen: ifInvType("s_S", "rop", "continuous_review"),
        defaultWhenMissing: 0,
      }),
      col("order_up_to", "inventory", {
        visibleWhen: ifInvType("s_S", "base_stock", "periodic_review", "continuous_review"),
        defaultWhenMissing: 0,
      }),
      col("review_period_days", "inventory", {
        visibleWhen: ifInvType("periodic_review"),
        defaultWhenMissing: 7,
      }),
      col("safety_stock_days", "inventory", { defaultWhenMissing: 0 }),

      // transport — distribution-first, all variants
      ...leadTimeDistCols("transport", "lead_time_mean_days", "lead_time_std_days"),
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
    cols: [
      col("capacity_machine_per_day", "production", { defaultWhenMissing: 999_999_999 }),
      col("capacity_labor_per_day", "production", { defaultWhenMissing: 999_999_999 }),
      col("production_cost_per_unit", "production", { defaultWhenMissing: 0 }),

      // production lead time — distribution-first, ETO hides everything
      ...leadTimeDistCols(
        "production",
        "production_lead_time_mean_days",
        "production_lead_time_std_days",
        "production_lead_time_shape",
        "production_lead_time_scale",
        "production_lead_time_min",
        "production_lead_time_mode",
        "production_lead_time_max",
        plantNeedsProductionExtras,
      ),

      col("lot_policy", "production", { visibleWhen: plantNeedsInventory }),
      col("setup_time_hours", "production", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0 }),
      col("backorder_cost_per_day", "fulfillment", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0 }),

      col("type", "inventory", { visibleWhen: plantNeedsInventory }),
      col("min_stock", "inventory", { visibleWhen: plantInvAnd(ifInvType("min_max")), defaultWhenMissing: 0 }),
      col("max_stock", "inventory", { visibleWhen: plantInvAnd(ifInvType("min_max")), defaultWhenMissing: 0 }),
      col("reorder_point", "inventory", {
        visibleWhen: plantInvAnd(ifInvType("s_S", "rop", "continuous_review")),
        defaultWhenMissing: 0,
      }),
      col("order_up_to", "inventory", {
        visibleWhen: plantInvAnd(ifInvType("s_S", "base_stock", "periodic_review", "continuous_review")),
        defaultWhenMissing: 0,
      }),
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
    cols: [
      col("primary_source", "fulfillment"),
      col("sourcing_firm", "fulfillment"),
      col("price", "fulfillment", { defaultWhenMissing: 0 }),
      col("backorder_cost_per_day", "fulfillment", { defaultWhenMissing: 0 }),
      col("pattern", "demand"),
      col("mean_per_day", "demand", { defaultWhenMissing: 0 }),
      col("cv", "demand", { defaultWhenMissing: 0.3 }),
      col("delivery_window_days", "demand", { defaultWhenMissing: 3 }),
      col("priority_tier", "demand"),
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
