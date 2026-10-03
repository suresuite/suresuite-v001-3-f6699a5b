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

import { policiesCellFor } from "./columnSpecs";

export type DataMapDataset =
  | "inbound_logistics"
  | "outbound_logistics"
  | "bom_single_level"
  | "bom_multi_level"
  | "materials"
  | "products"
  | "suppliers"
  | "customers"
  | "demand_forecasts";

export const DATASET_LABEL: Record<DataMapDataset, string> = {
  inbound_logistics: "Inbound logistics (supplier → plant)",
  outbound_logistics: "Outbound logistics (plant → customer)",
  bom_single_level: "Bill of materials — single level (read only when bom_multi_level has no rows)",
  bom_multi_level: "Bill of materials — multi level (the engine uses it whenever it has rows)",
  materials: "Item master — materials",
  products: "Item master — products",
  suppliers: "Item master — suppliers",
  customers: "Item master — customers",
  demand_forecasts: "Demand forecast (customer × product, per week or month)",
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
  | "outbound_demand_spec" // WP 14.2 — the row's own demand distribution / mean / variation / bounds
  | "forecast_series" // WP 14.2 — the per-row forecast buckets
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
  | "product_identity" // product ids, and which are sub-assemblies
  | "plant_ignored" // plant_name — the engine does not read it
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
 * the route that opens the editor closest to the gap — the /policies stage
 * when the field has a cell there (`policiesCellFor`), else /project-manager.
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
  // A field /policies can set goes to /policies: the value entered there is
  // the one the run uses, over the item master (§4 D204).
  const cell = policiesCellFor(field);
  if (cell) return `/policies?stage=${cell.stage}`;
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
  { dataset: "inbound_logistics", field: "material_id", engineField: "SupplierLink.material_id", chain: "identity — builds the supplier→material sourcing link. A link whose material is in neither the materials master nor the BOM is dropped. A BOM material with no link at all stops the run (materials with no supplier link)", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "unit_price", engineField: "SupplierLink.cost (c_{m,s})", chain: "per link; blank or ≤ 0 → 1.0 (warn). The cheapest link is the material's PRIMARY source. Also the fallback for materials.cost", statusKey: "inbound_unit_price" },
  { dataset: "inbound_logistics", field: "lead_time", engineField: "SupplierLink.lead_time_weeks", chain: "converted to weeks by lead_time_unit, rounded, clamped [1, 51]; blank or 0 → 2 weeks (warn)", statusKey: "inbound_lead_time" },
  { dataset: "inbound_logistics", field: "lead_time_unit", engineField: "lead-time unit", chain: "the unit of lead_time (day / week / month …); blank → weeks. Uploads promoted since WP 3.3 are already in weeks", statusKey: "inbound_lead_time_unit" },
  { dataset: "inbound_logistics", field: "time_unit", engineField: "volume unit", chain: "the period of volume only (day / week / month / year …); unknown → week", statusKey: "identity" },
  { dataset: "inbound_logistics", field: "plant_name", engineField: null, chain: "not read — the engine merges every plant name into one plant. The network pages and the Supplier tree do NOT — they join on plant, so a row on a different plant name is a separate island there (§4 D202)", statusKey: "plant_ignored" },
  { dataset: "inbound_logistics", field: "volume", engineField: "weight of the materials.cost fallback", chain: "only weights the volume-weighted price when materials.cost is blank. It does NOT pick the primary (the Supplier stage's saved primary does, else the cheapest link) and does NOT split orders (P-S.2 without shares splits equally)", statusKey: "inbound_volume" },
  // ── outbound_logistics ─────────────────────────────────────────────────
  { dataset: "outbound_logistics", field: "customer_id", engineField: "Customer / demand split", chain: "identity — builds the product→customer link", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "product_id", engineField: "Product demand", chain: "identity — builds the product→customer link", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "unit_price", engineField: "Product.unit_price fallback", chain: "demand-weighted average per product when products.sell_price is blank", statusKey: "outbound_unit_price" },
  { dataset: "outbound_logistics", field: "volume", engineField: "Product demand fallback + CustomerLink.share", chain: "two uses: (1) Σ weekly volume per product when products.demand_mean is blank; (2) ALWAYS splits each product's demand across its customers in proportion to weekly volume (a lane with 0 volume gets no share). The network pages and the Supplier tree always use the sum, even when demand_mean is set (§4 D195)", statusKey: "outbound_volume" },
  { dataset: "outbound_logistics", field: "time_unit", engineField: "volume unit", chain: "the period of volume only (day / week / month / year …); unknown → week", statusKey: "identity" },
  { dataset: "outbound_logistics", field: "plant_name", engineField: null, chain: "not read — the engine merges every plant name into one plant. The network pages and the Supplier tree do NOT — they join on plant, so a row on a different plant name is a separate island there (§4 D202)", statusKey: "plant_ignored" },
  { dataset: "outbound_logistics", field: "demand_distribution", engineField: "CustomerLink.demand_model", chain: "the row's own distribution (deterministic, normal, triangular, triangular_av, poisson); blank → the product's distribution scaled by the row's volume share (PLAN.md §24 WP 14.2)", statusKey: "outbound_demand_spec" },
  { dataset: "outbound_logistics", field: "demand_mean", engineField: "CustomerLink.demand_mean", chain: "the row's mean per time_unit, weekly after promotion (the mode for triangular); a /policies Customer-row override wins", statusKey: "outbound_demand_spec" },
  { dataset: "outbound_logistics", field: "demand_variation", engineField: "CustomerLink.demand_variation", chain: "read by the distribution: CV for normal, ± fraction for triangular_av; a /policies Customer-row override wins", statusKey: "outbound_demand_spec" },
  { dataset: "outbound_logistics", field: "demand_min", engineField: "CustomerLink.demand_min", chain: "triangular only: the lower bound, weekly after promotion", statusKey: "outbound_demand_spec" },
  { dataset: "outbound_logistics", field: "demand_max", engineField: "CustomerLink.demand_max", chain: "triangular only: the upper bound, weekly after promotion", statusKey: "outbound_demand_spec" },
  { dataset: "outbound_logistics", field: "expected_lead_time", engineField: null, chain: "uploaded but not read — the engine does not model a customer delivery lead time", statusKey: "outbound_expected_lead_time" },
  // ── bom_multi_level (preferred when it has rows) ─────────────────────────
  { dataset: "bom_multi_level", field: "material_id", engineField: "BomLine.material_id (after flattening)", chain: "child of the edge; the tree is flattened to finished product → purchased material, rates multiplied along each path", statusKey: "identity" },
  { dataset: "bom_multi_level", field: "higher_level_component_id", engineField: "flattening", chain: "parent of the edge; a row with a blank parent is dropped by the engine", statusKey: "identity" },
  { dataset: "bom_multi_level", field: "level", engineField: "fetched, not used", chain: "the worker fetches it but never uses it — the flatten derives structure from the parent links, not from this number, so a wrong level changes nothing in the run", statusKey: "bom_level_column" },
  { dataset: "bom_multi_level", field: "consumption_rate", engineField: "BomLine.consumption_rate (product of the path)", chain: "units of child per unit of parent; blank or 0 → 1.0", statusKey: "bom_consumption_rate" },
  { dataset: "bom_multi_level", field: "plant_name", engineField: null, chain: "not read — the engine merges every plant name into one plant. The network pages and the Supplier tree do NOT — they join on plant, so a row on a different plant name is a separate island there (§4 D202)", statusKey: "plant_ignored" },
  // ── bom_single_level (only when bom_multi_level has no rows) ─────────────
  { dataset: "bom_single_level", field: "product_id", engineField: "BomLine.product_id", chain: "identity — links product to its components", statusKey: "identity" },
  { dataset: "bom_single_level", field: "material_id", engineField: "BomLine.material_id", chain: "identity — a BOM material with no supplier link blocks the run", statusKey: "identity" },
  { dataset: "bom_single_level", field: "consumption_rate", engineField: "BomLine.consumption_rate", chain: "units of material per unit of product; blank or 0 → 1.0 (shown on the Supplier grid as Qty / assy)", statusKey: "bom_consumption_rate" },
  { dataset: "bom_single_level", field: "plant_name", engineField: null, chain: "not read — the engine merges every plant name into one plant. The network pages and the Supplier tree do NOT — they join on plant, so a row on a different plant name is a separate island there (§4 D202)", statusKey: "plant_ignored" },
  // ── materials master ───────────────────────────────────────────────────
  { dataset: "materials", field: "material_id", engineField: "Material.id", chain: "identity — every master row is a material; a BOM material with no master row is still simulated, from its BOM and inbound lanes, with engine defaults for holding cost, MOQ and lead-time distribution", statusKey: "identity" },
  { dataset: "materials", field: "name", engineField: "Material.name", chain: "display only → id", statusKey: "name" },
  { dataset: "materials", field: "cost", engineField: "Material.cost (c_m)", chain: "master (when > 0; a 0 counts as blank) → volume-weighted inbound unit_price (info) → cheapest inbound price (info) → 1.0 (warn)", statusKey: "material_cost" },
  { dataset: "materials", field: "holding_cost_pct", engineField: "Material.holding_cost_rate", chain: "the Supplier stage's per-row Holding (/policies) → master → the PROJECT-DEFAULT policy inventory.holding_cost_pct → 20 %/yr · fraction ×100, clamp [5, 50]. A value set on /policies beats the master (§4 D204)", statusKey: "material_holding" },
  { dataset: "materials", field: "moq", engineField: "SupplierLink.moq", chain: "master → 0", statusKey: "material_moq" },
  { dataset: "materials", field: "initial_on_hand", engineField: "Material.initial_on_hand", chain: "master → the engine starts at its own base stock: coverage weeks (κ) × expected demand, plus safety stock, on hand; the lead-time demand starts in transit", statusKey: "material_initial_on_hand" },
  { dataset: "materials", field: "lead_time_dist / lead_time_cv", engineField: "SupplierLink.lead_time_dist/cv", chain: "master → deterministic, cv 0", statusKey: "material_lead_time_dist" },
  // ── products master ────────────────────────────────────────────────────
  { dataset: "products", field: "product_id", engineField: "Product.id", chain: "identity. A product that another product's BOM consumes is a SUB-ASSEMBLY: the engine models it through its components and excludes it from the product list — its sell price, demand and capacity are not used (warned; §4 D174)", statusKey: "product_identity" },
  { dataset: "products", field: "name", engineField: "Product.name", chain: "display only → id", statusKey: "name" },
  { dataset: "products", field: "sell_price", engineField: "Product.unit_price (u_p)", chain: "master (when > 0; a 0 counts as blank) → demand-weighted outbound unit_price (info) → 1.0 (warn)", statusKey: "product_sell_price" },
  { dataset: "products", field: "demand_mean", engineField: "Product.demand_mode (b_p)", chain: "master (when > 0; a 0 counts as blank) → Σ weekly outbound volume → 0 (warn: never ordered)", statusKey: "product_demand_mean" },
  { dataset: "products", field: "production_capacity", engineField: "Product.production_capacity (O_p)", chain: "master (units/week, when > 0) → Plant grid line capacity/day × 7 × utilization → max(2·demand, 1000) (warn: never binds)", statusKey: "product_capacity" },
  { dataset: "products", field: "fulfillment_mode", engineField: "Product.fulfillment_mode", chain: "master → projects.supply_chain_model → MTO. The Policies page's fulfillment strategy is NOT read by the server engine (§4 D197)", statusKey: "product_fulfillment_mode" },
  { dataset: "products", field: "demand_distribution", engineField: "Product demand model", chain: "master → the SCENARIO's demand_model.kind (scenarios created in the app are Poisson) → triangular. The engine models triangular, poisson, negbin and deterministic; any other value runs as triangular (warned)", statusKey: "product_demand_distribution" },
  { dataset: "products", field: "demand_cv", engineField: "demand variability", chain: "master → scenario demand_model.cv → 0.30. Sets the spread under triangular and the dispersion under negbin; no effect under poisson (variance = mean) or deterministic", statusKey: "product_demand_cv" },
  { dataset: "products", field: "demand_min", engineField: "Product.demand_min (a_p)", chain: "master (explicit bound) → demand_mean·(1−cv). Triangular only", statusKey: "product_demand_min" },
  { dataset: "products", field: "demand_max", engineField: "Product.demand_max (c_p)", chain: "master (explicit bound, e.g. historical max) → demand_mean·(1+cv). Triangular only", statusKey: "product_demand_max" },
  // ── suppliers master ───────────────────────────────────────────────────
  { dataset: "suppliers", field: "supplier_id", engineField: "Supplier.id", chain: "identity — matched to inbound_logistics.supplier_id; a supplier on an inbound lane with no master row is simulated with the defaults below", statusKey: "identity" },
  { dataset: "suppliers", field: "name", engineField: "Supplier.name", chain: "display only → id", statusKey: "name" },
  { dataset: "suppliers", field: "capacity_per_week", engineField: "Supplier.capacity_per_week", chain: "master → unlimited (empty is a valid choice; a finite value enables partial capacity-cut disruptions). Must be > 0: the upload refuses 0 and the engine rejects it, failing the run", statusKey: "supplier_capacity" },
  { dataset: "suppliers", field: "reliability_score", engineField: "Supplier.reliability_score", chain: "master → 1.0 — passed to the engine but read only by the backup-supplier 'reliability' rule, which the mapper never selects: no effect today", statusKey: "supplier_reliability" },
  // ── customers master ───────────────────────────────────────────────────
  // ── demand_forecasts (PLAN.md §24 WP 14.2) ─────────────────────────────
  { dataset: "demand_forecasts", field: "customer_id", engineField: "CustomerLink (the row)", chain: "identity — the bucket belongs to this customer × product row; a forecast for a row no outbound lane names still becomes that row's demand", statusKey: "forecast_series" },
  { dataset: "demand_forecasts", field: "product_id", engineField: "CustomerLink (the row)", chain: "identity — with customer_id, the row the series belongs to", statusKey: "forecast_series" },
  { dataset: "demand_forecasts", field: "period_start", engineField: "the simulated week", chain: "the project's earliest period_start is week 0; week w is the seven days 7·w days later", statusKey: "forecast_series" },
  { dataset: "demand_forecasts", field: "period_end", engineField: "the simulated week", chain: "computed at promotion: start + 1 week or + 1 calendar month (exclusive)", statusKey: "forecast_series" },
  { dataset: "demand_forecasts", field: "weekly_quantity", engineField: "CustomerLink.forecast", chain: "computed at promotion: the bucket's quantity spread evenly over its own days (decision 7); each simulated week sums the days it shares with a bucket", statusKey: "forecast_series" },
  { dataset: "customers", field: "customer_id", engineField: "Customer.id", chain: "identity — matched to outbound_logistics.customer_id. A customers row for an id on no outbound lane has no demand and is ignored (info); an outbound customer with no row keeps the defaults", statusKey: "identity" },
  { dataset: "customers", field: "name", engineField: "Customer.name", chain: "display only → id", statusKey: "name" },
  { dataset: "customers", field: "segment", engineField: "Customer.segment", chain: "master → 'default'. Read only by the sla_tier customer-allocation rule (Fulfillment card)", statusKey: "customer_segment" },
  { dataset: "customers", field: "priority_weight", engineField: "Customer.priority_weight", chain: "master → 1.0. Read only by the priority customer-allocation rule (Fulfillment card), with ≥ 2 customers", statusKey: "customer_priority" },
  { dataset: "customers", field: "sla_fill_floor_pct", engineField: null, chain: "uploaded but not read — the engine's Customer has no field for it", statusKey: "customer_sla_floor" },
];
