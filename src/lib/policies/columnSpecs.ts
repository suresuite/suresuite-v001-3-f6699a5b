import { FIELD_LABELS, type PolicyBundle, type PolicyFamily } from "./schemas";
import { fieldEngineStatus } from "./fieldStatus";
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
   * "Which gap in which policy" (G1 visibility): fields the engine does not
   * consume yet are shown DISABLED with the milestone of the catalog policy
   * that will consume them — never silently hidden or silently dropped.
   */
  engineStatus?: { state: "pending"; milestone: string };
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

/** A field a PLANNED engine policy will consume: visible, disabled, badged
 * with its milestone — replacing the old "hide the whole family" approach. */
const pendingCol = (field: string, family: PolicyFamily): ColSpec => {
  const st = fieldEngineStatus(family, field);
  return {
    field,
    family,
    label: lbl(field),
    readOnly: true,
    engineStatus: st.state === "pending" ? st : undefined,
  };
};

// ---------- gating helpers ----------
const plantNeedsInventory: ColSpec["visibleWhen"] = ({ fulfillmentStrategy }) =>
  fulfillmentStrategy === "make_to_stock" ||
  fulfillmentStrategy === "assemble_to_order" ||
  fulfillmentStrategy === "configure_to_order";

const multiSourcing: ColSpec["visibleWhen"] = ({ effective }) =>
  String(effective?.strategy ?? "") === "multi" ||
  Object.keys((effective?.ratios as Record<string, unknown>) ?? {}).length > 0;

const wantsMaterialAllocation: ColSpec["visibleWhen"] = ({ effective }) =>
  Array.isArray(effective?.response) &&
  (effective?.response as unknown[]).includes("allocate_materials");

const fgStockOn: ColSpec["visibleWhen"] = (ctx) =>
  plantNeedsInventory(ctx) && String(ctx.effective?.fg_safety_stock ?? "none") !== "none";

// 6.A — a level/lot parameter is editable only for the inventory Policy Types
// that use it (§II.3): picking a type changes which params show. The row's
// chosen type is `effective.type` (min_max | base_stock | rop | periodic_review).
const invTypeIn = (...types: string[]): ColSpec["visibleWhen"] =>
  ({ effective }) => types.includes(String(effective?.type ?? "min_max"));

// Plant inventory params only apply when the product carries finished-goods
// inventory (MTS/ATO/CTO) AND its type uses the param.
const plantInvType = (...types: string[]): ColSpec["visibleWhen"] =>
  (ctx) => plantNeedsInventory(ctx) && invTypeIn(...types)(ctx);

export const STAGE_TABLE_SPEC: Record<StageKey, StageTableSpec> = {
  // ----------------------------- SUPPLIER -----------------------------
  supplier: {
    scope: "node",
    keyCols: [
      { id: "material_id", label: "Material" },
      { id: "supplier_id", label: "Supplier" },
    ],
    // scsim alignment: editable fields the engine consumes (plus master-data
    // columns describing the supplier × material row itself). Fields awaiting
    // a planned catalog policy (transport family) are shown DISABLED with
    // their milestone badge — never silently hidden (G1 visibility).
    cols: [
      col("primary_source", "sourcing"),
      // P-S.2 standing split: this row's share of its material (0–1).
      col("supply_share", "sourcing", { visibleWhen: multiSourcing, defaultWhenMissing: 0 }),
      col("material_price", "sourcing", { defaultWhenMissing: 0 }),
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

      // Policy Type → dynamic parameters (§II.1–II.3). The type drives which
      // level/lot params below are editable; the params' schemas come from the
      // engine registry (registryPolicyTypes / inventory_control). s, S and R,Q
      // are stored + versioned now and consumed once the Quantity basis lands
      // (§II.4) — the info button (6.B) discloses this per parameter.
      col("type", "inventory"),
      col("basis", "inventory"),
      col("reorder_point", "inventory", { visibleWhen: invTypeIn("min_max", "rop"), defaultWhenMissing: 50 }),
      col("order_up_to", "inventory", { visibleWhen: invTypeIn("min_max", "base_stock", "periodic_review"), defaultWhenMissing: 200 }),
      col("rop_q_quantity", "inventory", { visibleWhen: invTypeIn("rop"), defaultWhenMissing: 0 }),
      col("review_period_days", "inventory", { visibleWhen: invTypeIn("periodic_review"), defaultWhenMissing: 1 }),
      col("initial_on_hand", "inventory", {
        master: { table: "materials", field: "initial_on_hand", idFrom: "material_id" },
      }),
      col("safety_stock_days", "inventory", { defaultWhenMissing: 0 }),
      col("holding_cost_pct", "inventory", { defaultWhenMissing: 0.2 }),

      // Transport family: stored + versioned today, consumed when the P-T.x
      // catalog policies land — visible-disabled with the milestone badge.
      // (Lead time is not restated here — the engine reads inbound lead time
      // via the sourcing arc, so a transport lead-time column would duplicate it.)
      pendingCol("mode", "transport"),
      pendingCol("cost_per_km", "transport"),
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
      // Fulfillment (backorder, allocation, service level) is a customer-stage
      // concern only — the engine reads it from the project fulfillment default,
      // never from a plant node — so no fulfillment column is offered here.

      // Policy Type → dynamic parameters for finished goods (§II.1–II.3, §III.13).
      col("type", "inventory", { visibleWhen: plantNeedsInventory }),
      col("basis", "inventory", { visibleWhen: plantNeedsInventory }),
      col("reorder_point", "inventory", { visibleWhen: plantInvType("min_max", "rop"), defaultWhenMissing: 50 }),
      col("order_up_to", "inventory", { visibleWhen: plantInvType("min_max", "base_stock", "periodic_review"), defaultWhenMissing: 200 }),
      col("rop_q_quantity", "inventory", { visibleWhen: plantInvType("rop"), defaultWhenMissing: 0 }),
      col("review_period_days", "inventory", { visibleWhen: plantInvType("periodic_review"), defaultWhenMissing: 1 }),
      col("initial_on_hand", "inventory", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "initial_on_hand", idFrom: "product_id" },
      }),
      col("safety_stock_days", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0 }),
      col("holding_cost_pct", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0.2 }),
      col("service_level_target", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 0.95 }),

      // P-P.4 finished-goods safety stock (MTS): sizing + its parameter.
      col("fg_safety_stock", "inventory", { visibleWhen: plantNeedsInventory }),
      col("fg_service_level_target", "inventory", { visibleWhen: fgStockOn, defaultWhenMissing: 0.95 }),
      col("fg_safety_stock_days", "inventory", { visibleWhen: fgStockOn, defaultWhenMissing: 2 }),
      // P-P.9 per-product allocation priority (recovery response opt-in).
      col("allocation_priority_weight", "production", { visibleWhen: wantsMaterialAllocation, defaultWhenMissing: 1 }),
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
    // (demand comes from product/graph data), and the fulfillment family
    // (allocation, backorder, service level) is consumed at the PROJECT default
    // scope only — never per customer×product — so those are edited in the
    // fulfillment defaults card, not per-row here. What remains per-row is the
    // firm-routing choice for a customer×product lane.
    cols: [
      col("primary_source", "fulfillment"),
      col("sourcing_firm", "fulfillment"),
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

/** Drop later cols that repeat an already-seen `field` (first declaration wins).
 * Cell values are keyed by field, so two cols sharing a field would render the
 * same value twice with duplicate React keys — this guarantees one col per field. */
function dedupeByField(cols: ColSpec[]): ColSpec[] {
  const seen = new Set<string>();
  const out: ColSpec[] = [];
  for (const c of cols) {
    if (seen.has(c.field)) continue;
    seen.add(c.field);
    out.push(c);
  }
  return out;
}

/** No-row col visibility — used as a fallback only. Prefer `headerColsUnion`. */
export function visibleCols(
  stage: StageKey,
  ctx: { fulfillmentStrategy?: string },
): ColSpec[] {
  return dedupeByField(
    STAGE_TABLE_SPEC[stage].cols.filter((c) => !c.visibleWhen || c.visibleWhen(ctx)),
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
  return dedupeByField(STAGE_TABLE_SPEC[stage].cols.filter((c) => want.has(c.field)));
}
