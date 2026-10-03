import { FIELD_LABELS, type PolicyBundle, type PolicyFamily } from "./schemas";
import { fieldEngineStatus } from "./fieldStatus";
import type { StageKey } from "./stages";
import type { FitCol } from "./columnFit";
import { emptyMeansFor } from "./registryAccess";

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
  master?: {
    /**
     * `outbound_logistics` (PLAN.md §24 WP 14.2) is the customer × product row's
     * own demand spec — the base under the Customer stage's demand cells, joined
     * on a COMPOSITE `idFrom` (`customer_id::product_id`), as the engine keys it.
     * `customers` (WP 14.3) is the base under a row's priority and service
     * target — per CUSTOMER, so `idFrom` is `customer_id`; the override is per row.
     */
    table: "materials" | "products" | "suppliers" | "outbound_logistics" | "customers";
    field: string;
    /** The stage row's id field — or several joined by `::` for a composite key. */
    idFrom: string;
    /**
     * What an EMPTY master column MEANS, when empty means something (§4 D17).
     *
     * Most master columns are simply unset when null. A few carry a declared
     * semantic: `suppliers.capacity_per_week` is `NULL = ∞` per
     * `item_master.sql:44`, and the engine's own field map says the same
     * ("master → unlimited", `dataMap.ts:134`). Without this the resolver
     * substituted `0` — the exact inverse of the meaning — with provenance
     * `default`, which has no dot, so nothing on screen said a substitution had
     * happened at all.
     *
     * Authored HERE, next to the pointer, because that is the one place a
     * reader looks to find out what this column is (`single-source`, I1).
     */
    nullMeans?: { token: string; title: string };
  };
  /**
   * Type-specific inventory level/lot params (reorder point, order-up-to, lot Q,
   * review period, basis) are not rendered as their own columns. Instead they are
   * grouped into a single per-row "Replenishment parameters" vector cell that
   * shows only the params the row's chosen policy type needs (§II.3). Tagged cols
   * are excluded from the header union; their value/default/save wiring is reused
   * inside the vector cell. The per-type selection is the registry-driven
   * `inventoryParamsForType` (registryPolicyTypes), which mirrors these `visibleWhen`
   * gates — kept here so prefill only persists type-relevant params.
   */
  vectorGroup?: "invParams";
  /** A render-only anchor column with no stored field (holds the vector cell). */
  synthetic?: boolean;
}

export interface StageTableSpec {
  scope: "node" | "edge";
  keyCols: { id: string; label: string }[];
  cols: ColSpec[];
  targetKey: (row: Record<string, unknown>) => string;
}

const lbl = (f: string) => FIELD_LABELS[f] ?? f;

/** `master.nullMeans` from the engine's own `empty_means` declaration.
 *  `undefined` when the registry declares none, which keeps the "—" placeholder
 *  — a column whose blank has no declared meaning must not be given one here. */
const registryNullMeans = (
  field: string,
): { token: string; title: string } | undefined => {
  const em = emptyMeansFor(field);
  return em ? { token: em.token, title: em.meaning } : undefined;
};
const col = (
  field: string,
  family: PolicyFamily,
  opts: {
    label?: string;
    visibleWhen?: ColSpec["visibleWhen"];
    defaultWhenMissing?: ColSpec["defaultWhenMissing"];
    readOnly?: boolean;
    format?: ColSpec["format"];
    master?: ColSpec["master"];
    vectorGroup?: ColSpec["vectorGroup"];
    synthetic?: ColSpec["synthetic"];
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

/** WP 14.3 — a Customer row's per-row inputs are shown under the project rule
 *  that reads them (the rule is one per project, decision 4). */
const ruleIs =
  (...rules: string[]): ColSpec["visibleWhen"] =>
  ({ effective }) =>
    rules.includes(String(effective?.allocation ?? ""));
/** A row's window and cost matter only when the row backorders. */
const rowBackorders: ColSpec["visibleWhen"] = ({ effective, draft }) =>
  (draft?.backorder_allowed ?? effective?.backorder_allowed) === true;
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
      // §4 D18, AND THE DEFECT IS WORSE THAN THE ROW RECORDED.
      //
      // "Displayed prominently; consumed nowhere" understates it. The cell is
      // SEEDED FROM `inbound_logistics.unit_price` (`useStageRows`'s
      // `resolveField(prov, "material_price", enrich.unit_price, …)`), which IS a
      // declared engine requirement and IS what the engine reads
      // (`project_map.py` takes `arc.unit_price` directly). So the number on
      // screen was right, the cell was editable, the edit was stored as a policy
      // override and hashed into `policy_hash` — and the engine went on reading
      // the uploaded value. A user correcting a price got no error, no warning
      // and no effect, and because the cell was seeded with the REAL value they
      // had nothing to compare against.
      //
      // WHY NOT THE ROW'S OTHER OPTION. §4 D18 offers "map it to
      // `materials.cost`", and that is wrong: `materials.cost` is the material's
      // own cost per unit, this is the price paid to THIS supplier for it, and
      // the grid already renders the first as `material_cost` beside this one.
      // Mapping them together would merge two quantities to make one chain
      // resolve.
      //
      // WHY NOT MASTER-BACK IT ON `inbound_logistics`. That is the right end
      // state and it is not a reader change: `master` is typed to the three item
      // masters with a single-column `idFrom`, and an arc needs the composite
      // (supplier_id, material_id) plus a write path that does not exist. The
      // upload does — `inbound_logistics` is landable dataset #1 — so READ-ONLY
      // plus "change it in the inbound file" is the honest affordance today, and
      // it is the same answer WP 6.2 gave `customers`: when an engine field has
      // no way in, the way in is the upload, not a cell that pretends.
      //
      // `defaultWhenMissing: 0` is GONE and was already dead: the Zod sourcing
      // bundle declares `material_price: z.number().min(0).default(0)`, a parsed
      // bundle always has the key, and `bundleVal` is checked before this table
      // (the WP 0.1 gap check's second divergence). A second default table that
      // only ever speaks when it disagrees by accident.
      col("material_price", "sourcing", { readOnly: true }),
      col("material_cost", "sourcing", {
        master: { table: "materials", field: "cost", idFrom: "material_id" },
      }),
      col("material_moq", "sourcing", {
        master: { table: "materials", field: "moq", idFrom: "material_id" },
      }),
      // Engine-real supplier attributes (suppliers master): finite capacity
      // enables partial capacity-reduction disruptions; empty = unlimited.
      col("capacity_per_week", "sourcing", {
        master: {
          table: "suppliers", field: "capacity_per_week", idFrom: "supplier_id",
          // `item_master.sql:44` — "NULL = ∞; finite enables partial capacity
          // cuts". Measured at 60 of 60 suppliers null in the §15 project, every
          // one of which the grid used to report as a capacity of zero.
          //
          // READ FROM THE ENGINE SINCE WP 9.3 (§4 D167). The token and the
          // sentence were written out here, which made this file the only
          // machine-readable statement of a fact about the ENGINE — the
          // registry said "unlimited" in prose one field over and no surface
          // could read it. `suppliers.capacity_per_week` now declares an
          // `empty_means` and this is the reader.
          nullMeans: registryNullMeans("suppliers.capacity_per_week"),
        },
      }),
      col("reliability_score", "sourcing", {
        master: { table: "suppliers", field: "reliability_score", idFrom: "supplier_id" },
      }),

      // Policy Type → dynamic parameters (§II.1–II.3). The type drives which
      // level/lot params below are editable; the params' schemas come from the
      // engine registry (registryPolicyTypes / inventory_control). s, S and R,Q
      // are stored + versioned now and consumed once the Quantity basis lands
      // (§II.4) — the info button (6.B) discloses this per parameter.
      // The effective inbound lead time (weeks in the engine, shown in days
      // like every other duration cell) — the T_s of the level formulas
      // s = E[D]·T_s and S = E[D]·(T_s+κ). Read-only: the engine reads it
      // from the uploaded inbound lane, so an editable copy here would be a
      // second author for one fact (the same reason the transport band keeps
      // no lead-time column, see the note below).
      col("lead_time_days", "sourcing", { readOnly: true, label: "Lead time (days)" }),
      col("type", "inventory"),
      // Type-specific level/lot params render inside this one dynamic vector cell
      // (§II.3) — only the params the chosen type needs; the discrete gated
      // columns below feed it (vectorGroup) and are hidden from the header.
      col("__inv_params", "inventory", { synthetic: true, label: "Replenishment parameters" }),
      col("basis", "inventory", { vectorGroup: "invParams" }),
      col("reorder_point", "inventory", { visibleWhen: invTypeIn("min_max", "rop"), vectorGroup: "invParams" }),
      col("order_up_to", "inventory", { visibleWhen: invTypeIn("min_max", "base_stock", "periodic_review"), vectorGroup: "invParams" }),
      col("rop_q_quantity", "inventory", { visibleWhen: invTypeIn("rop"), vectorGroup: "invParams" }),
      // κ — order-up-to cover beyond lead time. Reaches the engine per
      // material via inventory_control.material_overrides; empty = the
      // engine's own 8/10/12 strip.
      col("coverage_weeks", "inventory", { vectorGroup: "invParams" }),
      col("review_period_days", "inventory", { visibleWhen: invTypeIn("periodic_review"), defaultWhenMissing: 1, vectorGroup: "invParams" }),
      col("initial_on_hand", "inventory", {
        master: { table: "materials", field: "initial_on_hand", idFrom: "material_id" },
      }),
      // 7 = the engine's own default (project_map.py) and the schema's (D1).
      // A grid default that disagrees with the engine is a silent override
      // waiting to happen — the three copies must read the same number.
      col("safety_stock_days", "inventory", { defaultWhenMissing: 7 }),
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
      // Demand variability — P-P.3 sizes safety stock from it and the run's
      // demand draw spreads by it. Editable HERE so the run check's "has no
      // products.demand_cv" points at a cell on /policies rather than at the
      // Item Master editor (blueprint §8.3: masters are the base layer, set
      // from this page).
      col("demand_cv", "production", {
        master: { table: "products", field: "demand_cv", idFrom: "product_id" },
      }),
      // ONE CAPACITY PER ROW (§23 WP 13.4). The plant row's capacity is the
      // `production_capacity` cell above — an override over the master. The line
      // rate and utilization below are the DERIVATION the engine falls back to when
      // neither carries a value; while they were editable here too, a planner had
      // two capacities on one row that shadowed each other (§4 D167's strike-
      // through said which one lost). They are shown, read-only, so the derived
      // number is followable; the project-wide line rate is set on the Defaults
      // card, and a saved per-row value is still read and still shown.
      col("capacity_units_per_day", "production", { defaultWhenMissing: 1000, readOnly: true }),
      // THE OTHER HALF OF THE ARITHMETIC, AND IT HAD NO COLUMN (§4 D167). The
      // engine builds a product's weekly capacity as units/day × 7 ×
      // utilization_cap_pct, and the grid rendered the first factor and hid the
      // second — so a planner saw 1 000/day become 5 950/week with nothing on
      // screen holding the 0.85. `defaultWhenMissing` is deliberately absent:
      // the Zod bundle declares 85 and `bundleVal` is read first, so a second
      // number here could only ever speak by disagreeing (the WP 0.1 gap
      // check's second divergence).
      col("utilization_cap_pct", "production", { readOnly: true }),
      // THE FG INVENTORY POLICY, MTS (PLAN.md §24 WP 14.4, ADR 0002 decision 3):
      // base-stock fills to S, min-max fills to S only below s, days of cover
      // fills to D/7 × the projected weekly demand. A typed level IS the target —
      // P-P.4's buffer is never added on top of it. Over the `products` master,
      // edits are Plant-row overrides (§23 WP 13.1).
      col("fg_policy", "production", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "fg_policy", idFrom: "product_id" },
      }),
      col("fg_base_stock", "production", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "fg_base_stock", idFrom: "product_id" },
      }),
      col("fg_reorder_point", "production", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "fg_reorder_point", idFrom: "product_id" },
      }),
      col("fg_cover_days", "production", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "fg_cover_days", idFrom: "product_id" },
      }),
      // Fulfillment (backorder, allocation, service level) is a customer-stage
      // concern only — the engine reads it from the project fulfillment default,
      // never from a plant node — so no fulfillment column is offered here.

      // Policy Type → dynamic parameters for finished goods (§II.1–II.3, §III.13).
      // Type-specific level/lot params render in the one dynamic vector cell.
      col("type", "inventory", { visibleWhen: plantNeedsInventory }),
      col("__inv_params", "inventory", { synthetic: true, label: "Replenishment parameters", visibleWhen: plantNeedsInventory }),
      col("basis", "inventory", { visibleWhen: plantNeedsInventory, vectorGroup: "invParams" }),
      col("reorder_point", "inventory", { visibleWhen: plantInvType("min_max", "rop"), defaultWhenMissing: 50, vectorGroup: "invParams" }),
      col("order_up_to", "inventory", { visibleWhen: plantInvType("min_max", "base_stock", "periodic_review"), defaultWhenMissing: 200, vectorGroup: "invParams" }),
      col("rop_q_quantity", "inventory", { visibleWhen: plantInvType("rop"), defaultWhenMissing: 0, vectorGroup: "invParams" }),
      col("review_period_days", "inventory", { visibleWhen: plantInvType("periodic_review"), defaultWhenMissing: 1, vectorGroup: "invParams" }),
      // FG OPENING STOCK IS A REAL CELL SINCE PLAN.md §24 WP 14.4 (§4 D89's
      // remainder, engine RFC 4). Until then this was `initial_on_hand` with no
      // `master:` block — its pointer had named `products.initial_on_hand`, a
      // column that did not exist, and no scsim reader existed either. Engine
      // 0.5.0 starts an MTS product at `fg_initial_on_hand`, and the column
      // followed the capability in RFC 4's own order, so the pointer is real now.
      col("fg_initial_on_hand", "production", {
        visibleWhen: plantNeedsInventory,
        master: { table: "products", field: "fg_initial_on_hand", idFrom: "product_id" },
      }),
      col("safety_stock_days", "inventory", { visibleWhen: plantNeedsInventory, defaultWhenMissing: 7 }),
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
    // DEMAND PER ROW (PLAN.md §24 WP 14.2, ADR 0002 decision 2). The row's own
    // demand spec: its base is the uploaded `outbound_logistics` row (and the
    // row's forecast series), an edit is a policy OVERRIDE on this row's key —
    // the engine reads override → data → the product's distribution × share,
    // exactly the order every master-backed cell follows (§23 WP 13.1). The
    // forecast series itself is uploaded in Project manager and shown read-only.
    //
    // FULFILLMENT PER ROW (PLAN.md §24 WP 14.3, ADR 0002 decisions 4–5). The
    // allocation RULE is one per project and stays on the Customer allocation
    // card; a row carries its own backorder setting, window and cost (an empty
    // cell is the project's), and the per-row inputs the project's rule reads —
    // priority (priority, sla_tier), price (revenue_max), service target
    // (sla_tier) — each shown only under the rule that reads it. Priority and
    // target sit over the customer's master values, price over the outbound
    // row's unit price. The firm-routing choice for a lane stays per row too.
    cols: [
      col("primary_source", "fulfillment"),
      col("sourcing_firm", "fulfillment"),
      // An OVERRIDE-ONLY choice, not a master column: the mode is derived from
      // the data (a row with an uploaded series plans on it), so there is no
      // column to point at. Empty = the engine's rule; `model` sets an uploaded
      // series aside, and the Forecast cell beside it says whether there is one.
      col("row_demand_mode", "demand"),
      col("row_forecast", "demand", { readOnly: true }),
      col("row_demand_distribution", "demand", {
        master: { table: "outbound_logistics", field: "demand_distribution", idFrom: "customer_id::product_id" },
      }),
      col("row_demand_mean", "demand", {
        master: { table: "outbound_logistics", field: "demand_mean", idFrom: "customer_id::product_id" },
      }),
      // Read BY THE DISTRIBUTION: a CV for normal, the ± fraction for
      // triangularAV. The cell's title says which, for the row's distribution.
      col("row_demand_variation", "demand", {
        master: { table: "outbound_logistics", field: "demand_variation", idFrom: "customer_id::product_id" },
      }),
      col("row_demand_min", "demand", {
        master: { table: "outbound_logistics", field: "demand_min", idFrom: "customer_id::product_id" },
      }),
      col("row_demand_max", "demand", {
        master: { table: "outbound_logistics", field: "demand_max", idFrom: "customer_id::product_id" },
      }),
      // WP 14.3 — backorder per row. Empty = the project's setting.
      col("backorder_allowed", "fulfillment"),
      col("max_backorder_days", "fulfillment", { visibleWhen: rowBackorders }),
      col("backorder_cost_per_day", "fulfillment", { visibleWhen: rowBackorders }),
      col("row_priority", "fulfillment", {
        visibleWhen: ruleIs("priority", "sla_tier"),
        master: { table: "customers", field: "priority_weight", idFrom: "customer_id" },
      }),
      col("price", "fulfillment", {
        visibleWhen: ruleIs("revenue_max"),
        master: { table: "outbound_logistics", field: "unit_price", idFrom: "customer_id::product_id" },
      }),
      col("sla_fill_floor_pct", "fulfillment", {
        visibleWhen: ruleIs("sla_tier"),
        master: { table: "customers", field: "sla_fill_floor_pct", idFrom: "customer_id" },
      }),
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

/** No-row col visibility — used as a fallback only. Prefer `headerColsUnion`.
 * Vectorized inventory params are excluded — they render inside the vector cell. */
export function visibleCols(
  stage: StageKey,
  ctx: { fulfillmentStrategy?: string },
): ColSpec[] {
  return dedupeByField(
    STAGE_TABLE_SPEC[stage].cols.filter(
      (c) => !c.vectorGroup && (!c.visibleWhen || c.visibleWhen(ctx)),
    ),
  );
}

export function visibleColsForRow(
  stage: StageKey,
  ctx: ColSpecCtx,
): ColSpec[] {
  return STAGE_TABLE_SPEC[stage].cols.filter(
    (c) => !c.vectorGroup && (!c.visibleWhen || c.visibleWhen(ctx)),
  );
}

/** The type-specific inventory params grouped into the "Replenishment parameters"
 * vector cell for a stage (in declared order). The cell renders the subset the
 * row's chosen type needs via `inventoryParamsForType`. */
export function vectorParamCols(stage: StageKey): ColSpec[] {
  return STAGE_TABLE_SPEC[stage].cols.filter((c) => c.vectorGroup === "invParams");
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
  return dedupeByField(
    STAGE_TABLE_SPEC[stage].cols.filter((c) => !c.vectorGroup && want.has(c.field)),
  );
}

// ---------------------------------------------------------------------------
// Presentation layer for the column-fit grid (columnFit.ts). Joined to
// STAGE_TABLE_SPEC by `field` — never a parallel schema. STAGE_TABLE_SPEC
// keeps carrying engine truth (visibleWhen, master, vectorGroup, engineStatus);
// this only adds render/fit metadata: width, priority, alignment, decimals.
// ---------------------------------------------------------------------------

/** Presentation metadata per field. Join to ColSpec by `field`. */
export const COLUMN_FIT: Record<string, Omit<FitCol, "key" | "family" | "label">> = {
  // ---- supplier · sourcing
  primary_source: { sub: "one per mat.", w: 64, kind: "toggle", keep: true, filterable: false, align: "center" },
  supply_share: { sub: "0–1", w: 74, kind: "num", dec: 2, keep: true },
  material_price: { sub: "€ / unit · inbound file", w: 116, kind: "num", dec: 2, unit: "€", keep: true },
  material_cost: { sub: "€ / unit · master", w: 96, kind: "num", dec: 2, unit: "€", prio: 8 },
  material_moq: { sub: "units · master", w: 84, kind: "int", prio: 5 },
  capacity_per_week: { sub: "units / wk · master", w: 96, kind: "int", prio: 4 },
  reliability_score: { sub: "0–1 · master", w: 84, kind: "num", dec: 2, prio: 3 },
  // ---- inventory (shared by supplier + plant)
  type: { sub: "s,S · S · R,Q · T,S", w: 152, kind: "type", keep: true, filterable: false, align: "left" },
  __inv_params: { sub: "levels & lot sizes", w: 184, kind: "vector", keep: true, filterable: false, align: "left" },
  initial_on_hand: { sub: "units", w: 88, kind: "int", prio: 6 },
  safety_stock_days: { sub: "days · 0–84", w: 76, kind: "int", unit: "d", keep: true },
  holding_cost_pct: { sub: "frac / yr", w: 72, kind: "num", dec: 2, prio: 7 },
  service_level_target: { sub: "0–1", w: 84, kind: "num", dec: 2, prio: 7 },
  // ---- supplier · transport (engine-pending)
  mode: { sub: "pending", w: 76, kind: "text", quiet: true, prio: 2 },
  cost_per_km: { sub: "pending", w: 72, kind: "num", dec: 2, quiet: true, prio: 1 },
  // ---- plant · production
  sell_price: { sub: "€ / unit · master", w: 92, kind: "num", dec: 2, unit: "€", keep: true },
  production_capacity: { sub: "units / wk · master", w: 100, kind: "int", prio: 5 },
  demand_mean: { sub: "units / wk · master", w: 100, kind: "int", prio: 4 },
  demand_cv: { sub: "σ / mean · master", w: 80, kind: "num", dec: 2, prio: 3 },
  capacity_units_per_day: { sub: "units / day", w: 96, kind: "int", keep: true },
  utilization_cap_pct: { sub: "% of line capacity", w: 84, kind: "int", unit: "%", prio: 6 },
  allocation_priority_weight: { sub: "weight", w: 76, kind: "num", dec: 2, prio: 9 },
  // ---- plant · finished goods
  fg_safety_stock: { sub: "sizing · P-P.4", w: 132, kind: "chip", keep: true, filterable: false, align: "left" },
  fg_service_level_target: { sub: "0–1 · when sized", w: 88, kind: "num", dec: 2, prio: 2 },
  fg_safety_stock_days: { sub: "days · when sized", w: 78, kind: "int", unit: "d", prio: 1 },
  // ---- customer · fulfillment
  sourcing_firm: { sub: "serving node", w: 168, kind: "text", keep: true, align: "left" },
  // ---- customer · demand per row (WP 14.2)
  row_demand_mode: { sub: "forecast · model", w: 92, kind: "text", keep: true, align: "left" },
  row_forecast: { sub: "uploaded series", w: 168, kind: "text", align: "left", prio: 6 },
  row_demand_distribution: { sub: "per row", w: 112, kind: "text", keep: true, align: "left" },
  row_demand_mean: { sub: "units / wk", w: 88, kind: "num", dec: 1, keep: true },
  row_demand_variation: { sub: "CV (normal) · ± (triangularAV)", w: 96, kind: "num", dec: 2, prio: 5 },
  row_demand_min: { sub: "units / wk · triangular", w: 84, kind: "num", dec: 1, prio: 4 },
  row_demand_max: { sub: "units / wk · triangular", w: 84, kind: "num", dec: 1, prio: 4 },
  // ---- plant · FG policy (WP 14.4)
  fg_policy: { sub: "base · min-max · cover", w: 120, kind: "text", keep: true, align: "left" },
  fg_base_stock: { sub: "S · units", w: 84, kind: "int", prio: 5 },
  fg_reorder_point: { sub: "s · units · min-max", w: 88, kind: "int", prio: 4 },
  fg_cover_days: { sub: "D · days · cover", w: 84, kind: "num", dec: 1, prio: 4 },
  fg_initial_on_hand: { sub: "units · opening", w: 88, kind: "int", prio: 6 },
  // ---- customer · fulfillment per row (WP 14.3)
  backorder_allowed: { sub: "this row waits", w: 76, kind: "toggle", keep: true, filterable: false, align: "center" },
  max_backorder_days: { sub: "days → whole wk", w: 84, kind: "int", unit: "d", prio: 6 },
  backorder_cost_per_day: { sub: "€ / unit / day", w: 92, kind: "num", dec: 2, unit: "€", prio: 5 },
  row_priority: { sub: "weight · priority, sla_tier", w: 88, kind: "num", dec: 2, prio: 6 },
  price: { sub: "€ / unit · revenue_max", w: 92, kind: "num", dec: 2, unit: "€", prio: 6 },
  sla_fill_floor_pct: { sub: "% · sla_tier", w: 84, kind: "num", dec: 1, unit: "%", prio: 6 },
};

/** Fallback so a new engine field renders sanely before it gets metadata. */
const FIT_FALLBACK: Omit<FitCol, "key" | "family" | "label"> = { sub: "", w: 96, kind: "text", prio: 50 };

/**
 * `FIELD_LABELS` values are sentences ("Supplier capacity (units/wk)",
 * "Safety stock (days, 0–84)") — fine for a form, but wrapped the grid header
 * into three ragged lines. The noun stays on line one here; everything
 * parenthetical already lives in `COLUMN_FIT[field].sub` above. This is a
 * display-only map — `FIELD_LABELS` is untouched (still used by Excel export).
 */
export const SHORT_LABEL: Record<string, string> = {
  supply_share: "Share",
  material_price: "Price",
  material_cost: "Cost",
  material_moq: "MOQ",
  capacity_per_week: "Capacity",
  reliability_score: "Reliability",
  type: "Policy type",
  __inv_params: "Replenishment",
  initial_on_hand: "Initial stock",
  safety_stock_days: "Safety stock",
  holding_cost_pct: "Holding",
  service_level_target: "Service level",
  cost_per_km: "Cost / km",
  sell_price: "Sell price",
  production_capacity: "Prod. capacity",
  demand_mean: "Demand mean",
  demand_cv: "Demand CV",
  capacity_units_per_day: "Line capacity",
  utilization_cap_pct: "Utilization cap",
  allocation_priority_weight: "Allocation wt.",
  fg_safety_stock: "FG safety stock",
  fg_service_level_target: "FG service",
  fg_safety_stock_days: "FG days",
  sourcing_firm: "Sourcing firm",
  row_demand_mode: "Demand mode",
  row_forecast: "Forecast",
  row_demand_distribution: "Distribution",
  row_demand_mean: "Mean",
  row_demand_variation: "Variation",
  row_demand_min: "Min",
  row_demand_max: "Max",
  fg_policy: "FG policy",
  fg_base_stock: "FG S",
  fg_reorder_point: "FG s",
  fg_cover_days: "FG cover",
  fg_initial_on_hand: "Initial FG",
  backorder_allowed: "Backorder",
  max_backorder_days: "Max backorder",
  backorder_cost_per_day: "Backorder cost",
  row_priority: "Priority",
  price: "Price",
  sla_fill_floor_pct: "Service target",
};

/** Per-stage label overrides — same field, different meaning by context. */
const STAGE_LABEL_OVERRIDE: Partial<Record<StageKey, Record<string, string>>> = {
  // (`plant.initial_on_hand` → "Initial FG" left with the column in WP 14.4.)
};

export function shortLabelFor(stage: StageKey, field: string, fallback: string): string {
  return STAGE_LABEL_OVERRIDE[stage]?.[field] ?? SHORT_LABEL[field] ?? fallback;
}

/**
 * Header columns (§ headerColsUnion) with fit/render metadata joined on.
 * `key` is the ColSpec field verbatim (including "__inv_params") so it maps
 * 1:1 back to the spec used by StagePolicyTable's save/prefill/gating logic.
 */
export function fitColsForStage(stage: StageKey, rowsCtx: ColSpecCtx[]): FitCol[] {
  return headerColsUnion(stage, rowsCtx).map((c) => ({
    key: c.field,
    family: c.family,
    label: shortLabelFor(stage, c.field, c.label),
    ...FIT_FALLBACK,
    ...(COLUMN_FIT[c.field] ?? {}),
  }));
}

/**
 * The /policies cell where a `dataset.column` value is entered, or null.
 *
 * The item masters are the BASE layer and /policies is where a value is set
 * (blueprint §8.3): a master-backed column saves into its master row, and
 * `materials.holding_cost_pct` is a Supplier-stage override the engine reads
 * BEFORE the master (§4 D204). The run check's walk-to links use this, so a
 * finding about a field the page can set points at the page rather than at the
 * Item Master editor. Derived from the column spec, so a new master-backed
 * column is linked without anyone remembering to.
 */
const POLICIES_OVERRIDE_CELLS: Record<string, { stage: StageKey; field: string }> = {
  "materials.holding_cost_pct": { stage: "supplier", field: "holding_cost_pct" },
};

export function policiesCellFor(datasetField: string): { stage: StageKey; field: string } | null {
  if (POLICIES_OVERRIDE_CELLS[datasetField]) return POLICIES_OVERRIDE_CELLS[datasetField];
  for (const stage of ["supplier", "plant", "customer"] as const) {
    for (const c of STAGE_TABLE_SPEC[stage].cols) {
      if (c.master && `${c.master.table}.${c.master.field}` === datasetField) {
        return { stage, field: c.field };
      }
    }
  }
  return null;
}

const STAGE_NAME: Record<StageKey, string> = {
  supplier: "Supplier",
  plant: "Plant",
  customer: "Customer",
  run_validate: "Run & Validate",
};

/**
 * How a finding names a field: by its /policies column when the page can set
 * it ("Material cost · Supplier stage"), else by `dataset.column`. The raw
 * field still travels on the finding for the mono sub-line, so nothing is lost.
 */
export function findingFieldLabel(datasetField: string): string {
  const cell = policiesCellFor(datasetField);
  if (!cell) return datasetField;
  return `${shortLabelFor(cell.stage, cell.field, cell.field)} · ${STAGE_NAME[cell.stage]} stage`;
}
