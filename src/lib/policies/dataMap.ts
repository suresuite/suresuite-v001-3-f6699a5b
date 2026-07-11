// Static encoding of the field-mapping contract in
// `docs/data-simulation-mapping.md` §4 — every column of the six datasets the
// sim worker reads (sim-worker/sim_worker/datamap.py:114-160) and how it lands
// in the scsim engine model (scsim/scsim/io/project_map.py). Uploaded columns
// the engine ignores are listed explicitly with engineField=null so nothing is
// silently dropped. Keep in lockstep with the doc and the mapper.

export type DataMapDataset =
  | "inbound_logistics"
  | "outbound_logistics"
  | "bom_single_level"
  | "materials"
  | "products"
  | "suppliers";

export const DATASET_LABEL: Record<DataMapDataset, string> = {
  inbound_logistics: "Inbound logistics (supplier → plant)",
  outbound_logistics: "Outbound logistics (plant → customer)",
  bom_single_level: "Bill of materials",
  materials: "Item master — materials",
  products: "Item master — products",
  suppliers: "Item master — suppliers",
};

/** Identifies which live status computation applies to a contract row. */
export type StatusKey =
  | "identity" // id columns — used to build the network graph
  | "inbound_unit_price"
  | "inbound_lead_time"
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
  | "supplier_capacity"
  | "supplier_reliability"
  | "name"; // display-only

export interface DataMapContractRow {
  dataset: DataMapDataset;
  /** Uploaded CSV / table column. */
  field: string;
  /** Engine-side destination ("—" when the engine does not read it). */
  engineField: string | null;
  /** Human-readable priority chain from docs/data-simulation-mapping.md §4. */
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
    field === "materials.supplier_link"
  ) {
    return base;
  }
  return base;
}

export const DATA_MAP_CONTRACT: DataMapContractRow[] = [
  // ── inbound_logistics ──────────────────────────────────────────────────
  { dataset: "inbound_logistics", field: "supplier_id", engineField: "SupplierLink.supplier_id", chain: "identity — builds the supplier→material sourcing arc", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "material_id", engineField: "SupplierLink.material_id", chain: "identity — builds the supplier→material sourcing arc", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "unit_price", engineField: "SupplierLink.cost (c_{m,s})", chain: "per arc → 1.0 (warn); also the fallback for materials.cost (cheapest wins)", statusKey: "inbound_unit_price" },
  { dataset: "inbound_logistics", field: "lead_time", engineField: "SupplierLink.lead_time_weeks", chain: "WEEKS as-is, clamp [1,51] → 2 weeks (warn); time_unit does not apply", statusKey: "inbound_lead_time" },
  { dataset: "inbound_logistics", field: "time_unit", engineField: "unit normalizer", chain: "volume period only (day/week/month/yearly…); unknown → week", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "volume", engineField: "sourcing share basis", chain: "per-lane volume; drives supplier share and primary suggestion", statusKey: "inbound_volume" },
  // ── outbound_logistics ─────────────────────────────────────────────────
  { dataset: "outbound_logistics", field: "customer_id", engineField: "CustomerLink.customer_id", chain: "identity — builds the product→customer arc", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "product_id", engineField: "CustomerLink.product_id", chain: "identity — builds the product→customer arc", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "unit_price", engineField: "Product.unit_price fallback", chain: "demand-weighted average per product when products.sell_price is empty", statusKey: "outbound_unit_price" },
  { dataset: "outbound_logistics", field: "volume", engineField: "Product.demand fallback", chain: "Σ weekly volume per product when products.demand_mean is empty", statusKey: "outbound_volume" },
  { dataset: "outbound_logistics", field: "time_unit", engineField: "unit normalizer", chain: "volume period only (day/week/month/yearly…); unknown → week", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "expected_lead_time", engineField: null, chain: "uploaded but not consumed — the engine does not model a customer delivery lead time", statusKey: "outbound_expected_lead_time" },
  // ── bom_single_level ───────────────────────────────────────────────────
  { dataset: "bom_single_level", field: "product_id", engineField: "BomLine.product_id", chain: "identity — links product to its components", statusKey: "identity" },
  { dataset: "bom_single_level", field: "material_id", engineField: "BomLine.material_id", chain: "identity — a BOM material without a supplier link fails the run", statusKey: "identity" },
  { dataset: "bom_single_level", field: "consumption_rate", engineField: "BomLine.consumption_rate", chain: "units of material per unit of product", statusKey: "bom_consumption_rate" },
  // ── materials master ───────────────────────────────────────────────────
  { dataset: "materials", field: "name", engineField: "Material.name", chain: "display only → id", statusKey: "name" },
  { dataset: "materials", field: "cost", engineField: "Material.cost (c_m)", chain: "master → cheapest inbound unit_price (info) → 1.0 (warn)", statusKey: "material_cost" },
  { dataset: "materials", field: "holding_cost_pct", engineField: "Material.holding_cost_rate", chain: "master → policy inventory.holding_cost_pct → 20% · ×100, clamp [5,50]", statusKey: "material_holding" },
  { dataset: "materials", field: "moq", engineField: "SupplierLink.moq", chain: "master → 0", statusKey: "material_moq" },
  { dataset: "materials", field: "initial_on_hand", engineField: "Material.initial_on_hand", chain: "master → engine warm-starts at S_m", statusKey: "material_initial_on_hand" },
  { dataset: "materials", field: "lead_time_dist / lead_time_cv", engineField: "SupplierLink.lead_time_dist/cv", chain: "master → deterministic, cv 0", statusKey: "material_lead_time_dist" },
  // ── products master ────────────────────────────────────────────────────
  { dataset: "products", field: "name", engineField: "Product.name", chain: "display only → id", statusKey: "name" },
  { dataset: "products", field: "sell_price", engineField: "Product.unit_price (u_p)", chain: "master → demand-weighted outbound unit_price (info) → 1.0 (warn)", statusKey: "product_sell_price" },
  { dataset: "products", field: "demand_mean", engineField: "Product.demand_mode (b_p)", chain: "master → Σ weekly outbound volume → 0 (warn: never ordered)", statusKey: "product_demand_mean" },
  { dataset: "products", field: "production_capacity", engineField: "Product.production_capacity (O_p)", chain: "master → policy capacity×7×util → max(2·demand, 1000) (warn: never binds)", statusKey: "product_capacity" },
  { dataset: "products", field: "fulfillment_mode", engineField: "Product.fulfillment_mode", chain: "master → projects.supply_chain_model → mto", statusKey: "product_fulfillment_mode" },
  { dataset: "products", field: "demand_distribution", engineField: "Product.demand_model", chain: "scenario demand_model.kind → master → triangular", statusKey: "product_demand_distribution" },
  { dataset: "products", field: "demand_cv", engineField: "demand variability", chain: "master → scenario demand_model.cv → 0.30", statusKey: "product_demand_cv" },
  // ── suppliers master ───────────────────────────────────────────────────
  { dataset: "suppliers", field: "name", engineField: "Supplier.name", chain: "display only → id", statusKey: "name" },
  { dataset: "suppliers", field: "capacity_per_week", engineField: "Supplier.capacity_per_week", chain: "master → unlimited (empty is a valid choice; finite enables capacity cuts)", statusKey: "supplier_capacity" },
  { dataset: "suppliers", field: "reliability_score", engineField: "Supplier.reliability_score", chain: "master → 1.0", statusKey: "supplier_reliability" },
];
