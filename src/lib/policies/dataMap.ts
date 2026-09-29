// Static encoding of how every column the simulation worker reads reaches the
// scsim engine — the "Uploaded data → engine" tab of /policies → Data map.
//
// THE READER IS THE AUTHORITY. The tables and columns are the ones
// `sim-worker/sim_worker/datamap.py::load_project_data` fetches (`rows(...)`),
// and every chain below restates what `scsim/scsim/io/project_map.py` does with
// them. `dataMapContract.test.ts` fails when the worker reads a table or an
// explicitly selected column this contract does not list, and when a field the
// engine registry declares a data requirement for is missing here. Uploaded
// columns the engine ignores are listed with engineField=null so nothing is
// silently dropped. Reconciled with the engine on 2026-09-29 (PLAN.md §16 ·
// *Audit 2026-09-29*, the Data map addendum).

export type DataMapDataset =
  | "inbound_logistics"
  | "outbound_logistics"
  | "bom_single_level"
  | "bom_multi_level"
  | "materials"
  | "products"
  | "suppliers"
  | "customers";

export const DATASET_LABEL: Record<DataMapDataset, string> = {
  inbound_logistics: "Inbound logistics (supplier → plant)",
  outbound_logistics: "Outbound logistics (plant → customer)",
  bom_single_level: "Bill of materials — single level (read only when bom_multi_level has no rows)",
  bom_multi_level: "Bill of materials — multi level (the engine uses it whenever it has rows)",
  materials: "Item master — materials",
  products: "Item master — products",
  suppliers: "Item master — suppliers",
  customers: "Item master — customers",
};

/** Identifies which live status computation applies to a contract row. */
export type StatusKey =
  | "identity" // id columns — used to build the network graph
  | "inbound_unit_price"
  | "inbound_lead_time"
  | "inbound_lead_time_unit"
  | "inbound_volume"
  | "outbound_unit_price"
  | "outbound_volume"
  | "outbound_expected_lead_time" // unused by engine
  | "bom_consumption_rate"
  | "material_cost"
  | "material_holding"
  | "material_moq"
  | "material_initial_on_hand"
  | "material_lead_time_dist"
  | "product_sell_price"
  | "product_demand_mean"
  | "product_capacity"
  | "product_fulfillment_mode"
  | "product_demand_distribution"
  | "product_demand_cv"
  | "product_demand_min"
  | "product_demand_max"
  | "supplier_capacity"
  | "supplier_reliability"
  | "customer_segment"
  | "customer_priority"
  | "customer_sla_floor"
  | "bom_level_column"
  | "name"; // display-only

export interface DataMapContractRow {
  dataset: DataMapDataset;
  /** Uploaded CSV / table column. */
  field: string;
  /** Engine-side destination ("—" when the engine does not read it). */
  engineField: string | null;
  /** The engine's resolution chain, in words (project_map.py is the authority). */
  chain: string;
  statusKey: StatusKey;
}

/**
 * Walk-to link for a `dataset.column` manifest field (§6.3 rule 3 / §8.2):
 * the /project-manager route that opens the editor closest to the gap.
 * Item-master datasets deep-open the Item Master editor on the right tab;
 * lane/BOM datasets (fixed by re-upload or the supplier-assignment RPC)
 * expand the project's data card. `materials.supplier_link` is the synthetic
 * unsourced-BOM field — its fix lives on the inbound lanes, not the master.
 */
export function fieldWalkToRoute(
  field: string,
  projectId: string | null | undefined,
): string | null {
  if (!projectId) return null;
  const dataset = field.split(".")[0];
  const column = field.split(".")[1] ?? "";
  const base = `/project-manager?project=${projectId}`;
  if (
    (dataset === "materials" || dataset === "products" || dataset === "suppliers") &&
    column !== "supplier_link"
  ) {
    return `${base}&item_master=${dataset}`;
  }
  if (
    dataset === "inbound_logistics" ||
    dataset === "outbound_logistics" ||
    dataset === "bom_single_level" ||
    dataset === "bom_multi_level" ||
    field === "materials.supplier_link"
  ) {
    return base;
  }
  return base;
}

export const DATA_MAP_CONTRACT: DataMapContractRow[] = [
  // ── inbound_logistics ──────────────────────────────────────────────────
  { dataset: "inbound_logistics", field: "supplier_id", engineField: "SupplierLink.supplier_id", chain: "identity — builds the supplier→material sourcing link", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "material_id", engineField: "SupplierLink.material_id", chain: "identity — builds the supplier→material sourcing link; a link for a material nothing consumes is dropped", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "unit_price", engineField: "SupplierLink.cost (c_{m,s})", chain: "per link; blank or ≤ 0 → 1.0 (warn). The cheapest link is the material's PRIMARY source. Also the fallback for materials.cost", statusKey: "inbound_unit_price" },
  { dataset: "inbound_logistics", field: "lead_time", engineField: "SupplierLink.lead_time_weeks", chain: "converted to weeks by lead_time_unit, rounded, clamped [1, 51]; blank or 0 → 2 weeks (warn)", statusKey: "inbound_lead_time" },
  { dataset: "inbound_logistics", field: "lead_time_unit", engineField: "lead-time unit", chain: "the unit of lead_time (day / week / month …); blank → weeks. Uploads promoted since WP 3.3 are already in weeks", statusKey: "inbound_lead_time_unit" },
  { dataset: "inbound_logistics", field: "time_unit", engineField: "volume unit", chain: "the period of volume only (day / week / month / year …); unknown → week", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "volume", engineField: "weight of the materials.cost fallback", chain: "only weights the volume-weighted price when materials.cost is blank. It does NOT pick the primary (the cheapest link does) and does NOT split orders (P-S.2 without shares splits equally)", statusKey: "inbound_volume" },
  // ── outbound_logistics ─────────────────────────────────────────────────
  { dataset: "outbound_logistics", field: "customer_id", engineField: "Customer / demand split", chain: "identity — builds the product→customer link", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "product_id", engineField: "Product demand", chain: "identity — builds the product→customer link", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "unit_price", engineField: "Product.unit_price fallback", chain: "demand-weighted average per product when products.sell_price is blank", statusKey: "outbound_unit_price" },
  { dataset: "outbound_logistics", field: "volume", engineField: "Product demand fallback", chain: "Σ weekly volume per product when products.demand_mean is blank. The network pages and the Supplier tree ALWAYS use this sum, even when demand_mean is set (§4 D195)", statusKey: "outbound_volume" },
  { dataset: "outbound_logistics", field: "time_unit", engineField: "volume unit", chain: "the period of volume only (day / week / month / year …); unknown → week", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "expected_lead_time", engineField: null, chain: "uploaded but not read — the engine does not model a customer delivery lead time", statusKey: "outbound_expected_lead_time" },
  // ── bom_multi_level (preferred when it has rows) ─────────────────────────
  { dataset: "bom_multi_level", field: "material_id", engineField: "BomLine.material_id (after flattening)", chain: "child of the edge; the tree is flattened to finished product → purchased material, rates multiplied along each path", statusKey: "identity" },
  { dataset: "bom_multi_level", field: "higher_level_component_id", engineField: "flattening", chain: "parent of the edge; a row with a blank parent is dropped by the engine", statusKey: "identity" },
  { dataset: "bom_multi_level", field: "level", engineField: null, chain: "not read — the engine derives structure from the parent links, not from this number", statusKey: "bom_level_column" },
  { dataset: "bom_multi_level", field: "consumption_rate", engineField: "BomLine.consumption_rate (product of the path)", chain: "units of child per unit of parent; blank or 0 → 1.0", statusKey: "bom_consumption_rate" },
  // ── bom_single_level (only when bom_multi_level has no rows) ─────────────
  { dataset: "bom_single_level", field: "product_id", engineField: "BomLine.product_id", chain: "identity — links product to its components", statusKey: "identity" },
  { dataset: "bom_single_level", field: "material_id", engineField: "BomLine.material_id", chain: "identity — a BOM material with no supplier link blocks the run", statusKey: "identity" },
  { dataset: "bom_single_level", field: "consumption_rate", engineField: "BomLine.consumption_rate", chain: "units of material per unit of product; blank or 0 → 1.0", statusKey: "bom_consumption_rate" },
  // ── materials master ───────────────────────────────────────────────────
  { dataset: "materials", field: "name", engineField: "Material.name", chain: "display only → id", statusKey: "name" },
  { dataset: "materials", field: "cost", engineField: "Material.cost (c_m)", chain: "master → volume-weighted inbound unit_price (info) → cheapest inbound price (info) → 1.0 (warn)", statusKey: "material_cost" },
  { dataset: "materials", field: "holding_cost_pct", engineField: "Material.holding_cost_rate", chain: "master → the PROJECT-DEFAULT policy inventory.holding_cost_pct → 20 %/yr · fraction ×100, clamp [5, 50]. The Supplier grid's per-row Holding cell is not read (§4 D204)", statusKey: "material_holding" },
  { dataset: "materials", field: "moq", engineField: "SupplierLink.moq", chain: "master → 0", statusKey: "material_moq" },
  { dataset: "materials", field: "initial_on_hand", engineField: "Material.initial_on_hand", chain: "master → the engine starts at its own base stock", statusKey: "material_initial_on_hand" },
  { dataset: "materials", field: "lead_time_dist / lead_time_cv", engineField: "SupplierLink.lead_time_dist/cv", chain: "master → deterministic, cv 0", statusKey: "material_lead_time_dist" },
  // ── products master ────────────────────────────────────────────────────
  { dataset: "products", field: "name", engineField: "Product.name", chain: "display only → id", statusKey: "name" },
  { dataset: "products", field: "sell_price", engineField: "Product.unit_price (u_p)", chain: "master → demand-weighted outbound unit_price (info) → 1.0 (warn)", statusKey: "product_sell_price" },
  { dataset: "products", field: "demand_mean", engineField: "Product.demand_mode (b_p)", chain: "master → Σ weekly outbound volume → 0 (warn: never ordered)", statusKey: "product_demand_mean" },
  { dataset: "products", field: "production_capacity", engineField: "Product.production_capacity (O_p)", chain: "master (units/week) → Plant grid line capacity/day × 7 × utilization → max(2·demand, 1000) (warn: never binds)", statusKey: "product_capacity" },
  { dataset: "products", field: "fulfillment_mode", engineField: "Product.fulfillment_mode", chain: "master → projects.supply_chain_model → MTO. The Policies page's fulfillment strategy is NOT read by the server engine (§4 D197)", statusKey: "product_fulfillment_mode" },
  { dataset: "products", field: "demand_distribution", engineField: "Product demand model", chain: "master → the SCENARIO's demand_model.kind (scenarios created in the app are Poisson) → triangular", statusKey: "product_demand_distribution" },
  { dataset: "products", field: "demand_cv", engineField: "demand variability", chain: "master → scenario demand_model.cv → 0.30. Has no effect under Poisson, whose variance equals its mean", statusKey: "product_demand_cv" },
  { dataset: "products", field: "demand_min", engineField: "Product.demand_min (a_p)", chain: "master (explicit bound) → demand_mean·(1−cv). Triangular only", statusKey: "product_demand_min" },
  { dataset: "products", field: "demand_max", engineField: "Product.demand_max (c_p)", chain: "master (explicit bound, e.g. historical max) → demand_mean·(1+cv). Triangular only", statusKey: "product_demand_max" },
  // ── suppliers master ───────────────────────────────────────────────────
  { dataset: "suppliers", field: "name", engineField: "Supplier.name", chain: "display only → id", statusKey: "name" },
  { dataset: "suppliers", field: "capacity_per_week", engineField: "Supplier.capacity_per_week", chain: "master → unlimited (empty is a valid choice; finite enables capacity cuts)", statusKey: "supplier_capacity" },
  { dataset: "suppliers", field: "reliability_score", engineField: "Supplier.reliability_score", chain: "master → 1.0 — passed to the engine but read only by the backup-supplier 'reliability' rule, which the mapper never selects: no effect today", statusKey: "supplier_reliability" },
  // ── customers master ───────────────────────────────────────────────────
  { dataset: "customers", field: "customer_id", engineField: "Customer.id", chain: "identity — matched to outbound_logistics.customer_id", statusKey: "identity" },
  { dataset: "customers", field: "name", engineField: "Customer.name", chain: "display only → id", statusKey: "name" },
  { dataset: "customers", field: "segment", engineField: "Customer.segment", chain: "master → 'default'. Read only by the sla_tier customer-allocation rule (Fulfillment card)", statusKey: "customer_segment" },
  { dataset: "customers", field: "priority_weight", engineField: "Customer.priority_weight", chain: "master → 1.0. Read only by the priority customer-allocation rule (Fulfillment card), with ≥ 2 customers", statusKey: "customer_priority" },
  { dataset: "customers", field: "sla_fill_floor_pct", engineField: null, chain: "uploaded but not read — the engine's Customer has no field for it", statusKey: "customer_sla_floor" },
];
