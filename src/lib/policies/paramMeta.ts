// Per-parameter transparency catalog (Phase D / 6.B / policy-specification
// §II.6, §III, §IV). Answers, for any grid parameter: what IS this policy
// parameter, what does the engine DO with it, and does the engine consume it
// at all — the "no hidden heuristics" contract (§II.6).
//
// Sources, in precedence:
//   * curated `PARAM_META` — symbol · meaning · decision-rule formula · spec
//     ref, transcribed from the policy-specification tables (§III/§IV). This is
//     the authoritative "what the policy does".
//   * the Zod schema DEFAULT_BUNDLE — the registry-default value per field.
//   * fieldEngineStatus / the column's own flags — consumed ✅ vs stored-only 🧩.
//
// When 6.A migrates the grid to policy-type → dynamic params, this same catalog
// keys the side-sheet off the selected type's registry schema; the curated
// meanings/formulas stay the single source for the prose.

import { DEFAULT_BUNDLE, FIELD_LABELS, type PolicyFamily } from "./schemas";
import { fieldEngineStatus, type FieldEngineStatus } from "./fieldStatus";
import type { ColSpec } from "./columnSpecs";

export interface ParamOption {
  value: string;
  meaning: string;
}

/** Curated spec facts for one parameter (the prose the engine can't emit). */
export interface ParamMeta {
  /** Mathematical symbol in the §1 notation, e.g. "s", "S", "R", "Q", "SS". */
  symbol?: string;
  unit?: string;
  /** Human-readable range/enum, e.g. "0 ≤ s < S", "0–84 days", "0–1". */
  range?: string;
  /** What the parameter means (verbatim / faithful to the spec tables). */
  meaning: string;
  /** The decision-rule / equation the policy executes with this parameter. */
  formula?: string;
  /** Spec anchor, e.g. "§III.1". */
  specRef?: string;
  /** For enum parameters: what each choice does. */
  options?: ParamOption[];
}

/** Fully-resolved transparency for a grid column (meta + default + status). */
export interface ResolvedParamMeta extends ParamMeta {
  field: string;
  label: string;
  family: PolicyFamily;
  defaultValue?: unknown;
  engine: FieldEngineStatus;
  /** Master-data column (materials/products/suppliers), read by the engine. */
  isMaster: boolean;
}

// ── curated catalog, keyed by grid field name ───────────────────────────────
export const PARAM_META: Record<string, ParamMeta> = {
  // —— Sourcing (§IV.1) ——
  primary_source: {
    meaning:
      "The upstream source assigned to this row: on a supplier row, the supplier that receives the material's replenishment order (single sourcing, default = cheapest link); on a customer row, the plant/firm that fulfils the line.",
    formula: "w_{m,s*} = 1, all others 0  ⇒  O_{ℓ*} = O_m",
    specRef: "§IV.1.1 / §VI",
  },
  share_pct: {
    symbol: "w·100",
    unit: "%",
    range: "0–100",
    meaning:
      "This supplier×material row's share of the material's standing order — the realized split (read-only; derived from the sourcing policy).",
    formula: "O_ℓ = w_{m,s} · O_m,   Σ_s w_{m,s} = 1",
    specRef: "§IV.1.2",
  },
  supply_share: {
    symbol: "w_{m,s}",
    unit: "fraction",
    range: "0–1 (each ≥ min_share_pct)",
    meaning:
      "Fixed multi-sourcing share this supplier carries of the material's order (P-S.2). Shares across the material's suppliers sum to 1.",
    formula: "O_ℓ,t = w_{m,s} · O_{m,t}",
    specRef: "§IV.1.2",
  },
  material_price: {
    unit: "€ / unit",
    range: "≥ 0",
    meaning:
      "Purchase price paid to this supplier for the material — feeds the purchase-cost ledger and least-cost sourcing selection.",
    specRef: "§IV.1",
  },
  reliability_score: {
    symbol: "r_s",
    unit: "fraction",
    range: "0–1",
    meaning:
      "Supplier reliability. Drives reliability-ranked selection and the probability the supplier is disrupted; empty = perfectly reliable.",
    specRef: "§IV.1.4",
  },
  capacity_per_week: {
    symbol: "K_s",
    unit: "units / week",
    range: "≥ 0 (empty = unlimited)",
    meaning:
      "Finite weekly supplier capacity. A finite value enables partial capacity-reduction disruptions and capacity-proportional sourcing; empty means the supplier never constrains.",
    specRef: "§IV.3 / §IV.1.5",
  },

  // —— Inventory / replenishment (§III) ——
  basis: {
    symbol: "basis",
    meaning:
      "Policy Basis (§II.4) — how the level parameters (s, S, R) are interpreted. Days-of-supply sizes levels from mean demand over the lead time; forward-visible sums the customer's committed forward order book (WSC-2026 MTO, needs the P-C.6 forward_visibility customer policy).",
    specRef: "§II.4",
    options: [
      { value: "days_of_supply", meaning: "Levels = coverage × mean demand: s = D̄·L, S = D̄·(L+κ)." },
      { value: "forward_visible", meaning: "Levels sum the committed forward material demand over the coverage window (requires P-C.6)." },
    ],
  },
  reorder_point: {
    symbol: "s / R",
    unit: "units",
    range: "0 ≤ s < S",
    meaning:
      "Reorder point — when inventory position falls below it, a replenishment fires. Used by Min-max (s) and (R,Q) (R). Stored & versioned; consumed once the Quantity basis lands (§II.4).",
    formula: "order when IP_{i,t} < s",
    specRef: "§III.1 / §III.3",
  },
  order_up_to: {
    symbol: "S",
    unit: "units",
    range: "> s",
    meaning:
      "Order-up-to level — replenishment raises the inventory position back up to S. Used by Min-max, Base-stock and Periodic-review. Stored & versioned; consumed once the Quantity basis lands (§II.4).",
    formula: "O_{i,t} = ρ_t·(S − IP_{i,t})⁺",
    specRef: "§III.1 / §III.4 / §III.5",
  },
  rop_q_quantity: {
    symbol: "Q",
    unit: "units",
    range: "≥ MOQ",
    meaning:
      "Fixed lot size for the (R,Q) policy — each replenishment orders whole multiples of Q to clear the deficit below R. Floored to the material MOQ.",
    formula: "O_{i,t} = ρ_t·Q·⌈(R − IP_{i,t})⁺ / Q⌉",
    specRef: "§III.3",
  },
  review_period_days: {
    symbol: "T",
    unit: "days",
    range: "≥ 1",
    meaning:
      "Review period for the Periodic-review (T,S) policy — the position is topped up to S only every T days; between reviews it drifts down with demand.",
    formula: "O_{i,t} = 1[(t − t₀) mod T = 0]·(S − IP_{i,t})⁺",
    specRef: "§III.5",
  },
  type: {
    meaning:
      "The replenishment policy type for this item — it decides WHEN to reorder and HOW MUCH. Choosing a type sets which parameters matter (the target of 6.A's dynamic parameter cell).",
    specRef: "§III",
    options: [
      { value: "min_max", meaning: "(s,S): when position IP < s, order up to S. O = ρ·(S−IP)⁺·1[IP<s]." },
      { value: "base_stock", meaning: "(S): every review, top position back up to S. O = ρ·(S−IP)⁺." },
      { value: "rop", meaning: "(R,Q): when IP < R, order fixed lot(s) of Q. O = ρ·Q·⌈(R−IP)⁺/Q⌉." },
      { value: "periodic_review", meaning: "(T,S): every T weeks order up to S. O = 1[(t−t₀) mod T = 0]·(S−IP)⁺." },
    ],
  },
  safety_stock_method: {
    meaning:
      "How the safety-stock buffer is sized. The method overrides a manual safety-stock value.",
    specRef: "§IV.4",
    options: [
      { value: "fixed_days", meaning: "Buffer = safety_stock_days × mean daily demand." },
      { value: "service_level", meaning: "Buffer sized to hit the service-level target from demand/lead-time variability." },
      { value: "king_method", meaning: "King's method — buffer from lead-time and demand variance (σ over the protection window)." },
    ],
  },
  safety_stock_days: {
    symbol: "SS",
    unit: "days of cover",
    range: "0–84",
    meaning:
      "Safety buffer expressed as days of mean demand. Shifts both reorder and order-up-to levels up by SS (more average stock, higher service).",
    formula: "level += SS · D̄_i   (fixed_days basis)",
    specRef: "§III.2 / §IV.4",
  },
  service_level_target: {
    symbol: "α",
    unit: "fraction",
    range: "0–1",
    meaning:
      "Target cycle-service level. Under the service-level method it sizes safety stock to meet this no-stockout probability.",
    specRef: "§IV.4",
  },
  holding_cost_pct: {
    symbol: "cʰ",
    unit: "% / year",
    range: "≥ 0",
    meaning:
      "Annual inventory holding cost as a fraction of item value — the carrying-cost rate charged on average on-hand.",
    formula: "holding cost/week = cʰ · c_i · Ī_i / 52",
    specRef: "§III.14",
  },
  fg_safety_stock: {
    meaning:
      "Finished-goods safety-stock sizing method under make-to-stock (P-P.4): none, a service-level target, or fixed days of cover.",
    specRef: "§III.13 / §IV.4",
    options: [
      { value: "none", meaning: "No FG safety buffer — order-up-to sized from demand only." },
      { value: "service_level", meaning: "Size the FG buffer to the FG service-level target." },
      { value: "fixed_days", meaning: "FG buffer = fg_safety_stock_days × mean FG demand." },
    ],
  },
  fg_service_level_target: {
    symbol: "α^{FG}",
    unit: "fraction",
    range: "0–1",
    meaning: "Target service level for finished-goods safety-stock sizing (MTS).",
    specRef: "§IV.4",
  },
  fg_safety_stock_days: {
    symbol: "SS^{FG}",
    unit: "days of cover",
    range: "≥ 0",
    meaning: "Finished-goods safety buffer as days of mean FG demand (fixed-days sizing).",
    specRef: "§III.13",
  },

  // —— Production / capacity (§IV.2–IV.3) ——
  capacity_units_per_day: {
    symbol: "O_p",
    unit: "units / day",
    range: "> 0",
    meaning:
      "Base production capacity — the weekly build is clipped to this rate at execution.",
    formula: "g_{p,t} = min(x_{p,t}, cap_{p,t}, min_m ⌊I_{m,t}/b_{p,m}⌋)",
    specRef: "§IV.3.1",
  },
  allocation_priority_weight: {
    meaning:
      "This product's weight when scarce materials are allocated across products under the priority-weighted objective (P-P.9). Higher = served first.",
    formula: "max Σ_p weight_p · R_p[t]   s.t.  Σ_p R_p·r_{p,m} ≤ I_m",
    specRef: "§IV.2.d",
  },
  backorder_cost_per_day: {
    unit: "€ / unit / day",
    range: "≥ 0",
    meaning:
      "Penalty charged per unit of unmet demand per day it waits as a backorder — feeds the backorder-penalty cost line.",
    formula: "cost = backorder_cost_per_day · Σ_t B_t",
    specRef: "§VI",
  },

  // —— Fulfillment / customer (§VI, §III-D) ——
  sourcing_firm: {
    meaning: "Which firm supplies this customer — the fulfilment source for the line.",
    specRef: "§VI",
  },
  price: {
    unit: "€ / unit",
    range: "≥ 0",
    meaning:
      "Per-unit revenue for this customer×product (overrides the product price) — drives the revenue KPI.",
    specRef: "§III-D.5",
  },
  mean_per_day: {
    symbol: "D̄",
    unit: "units / day",
    range: "≥ 0",
    meaning:
      "Mean daily demand for this customer×product (read-only; derived from outbound order history). Demand is exogenous — set in the data, not here.",
    specRef: "§III-D",
  },
  delivery_window_days: {
    symbol: "ELT",
    unit: "days",
    range: "≥ 0",
    meaning:
      "Expected lead time / delivery window (read-only) — drives the on-time service-level KPI (share of orders received within the window).",
    specRef: "§III-D.5",
  },

  // —— Transport (§V) — stored, consumed when the P-T.x catalog lands ——
  mode: {
    meaning:
      "Transport mode for the lane (road/rail/sea/air/intermodal). Stored and versioned; consumed once the multimodal-lane catalog policy lands.",
    specRef: "§V",
  },
  cost_per_km: {
    unit: "€ / km",
    range: "≥ 0",
    meaning:
      "Per-kilometre transport cost for the lane. Stored today; consumed when the transport catalog policies land.",
    specRef: "§V",
  },

  // —— Item-master economics (read by the engine from the masters) ——
  material_cost: {
    symbol: "c_i",
    unit: "€ / unit",
    range: "≥ 0",
    meaning:
      "Unit cost of the material (item master). Feeds holding-cost and purchase-cost accounting; falls back to the cheapest inbound price when the master is empty.",
    specRef: "docs/data-simulation-mapping §4",
  },
  material_moq: {
    symbol: "Q^{min}_i",
    unit: "units",
    range: "≥ 0",
    meaning:
      "Minimum order quantity (item master). Every replenishment order is floored to this multiple.",
    formula: "O_{i,t} ← max(O_{i,t}, Q^{min}_i)  when O_{i,t} > 0",
    specRef: "§III.0",
  },
  sell_price: {
    symbol: "u_p",
    unit: "€ / unit",
    range: "≥ 0",
    meaning: "Product sell price (item master) — the revenue rate for units delivered.",
    specRef: "§IX",
  },
  production_capacity: {
    symbol: "O_p",
    unit: "units / week",
    range: "> 0",
    meaning:
      "Weekly production capacity (item master). Default = max(2·mean demand, 1000) when unset.",
    specRef: "§IV.3.1",
  },
  demand_mean: {
    symbol: "D̄_p",
    unit: "units / week",
    range: "≥ 0",
    meaning: "Mean weekly demand for the product (item master) — sizes MTS targets and default capacity.",
    specRef: "§III-D",
  },
  lead_time_mean_days: {
    symbol: "L",
    unit: "days",
    range: "≥ 0",
    meaning:
      "Mean replenishment lead time for the lane (read-only; from inbound data). Sets the pipeline delay and days-of-supply coverage windows.",
    specRef: "§II.4",
  },
};

const FAMILY_OF = DEFAULT_BUNDLE as unknown as Record<PolicyFamily, Record<string, unknown>>;

/** Schema default for a field, if the family bundle declares one. */
function schemaDefault(family: PolicyFamily, field: string): unknown {
  return FAMILY_OF[family]?.[field];
}

/** Consumed ✅ vs stored-only 🧩 for a grid column. Master columns and derived
 *  read-only columns are engine inputs; a pending column is stored-only; a
 *  plain policy field defers to SCSIM_VISIBLE_FIELDS. */
function columnEngineStatus(col: Pick<ColSpec, "family" | "field" | "master" | "engineStatus" | "readOnly">): FieldEngineStatus {
  if (col.engineStatus) return col.engineStatus; // explicitly pending
  if (col.master || col.readOnly) return { state: "reaches-engine" };
  return fieldEngineStatus(col.family, col.field);
}

/** Resolve full transparency for a grid column. */
export function resolveParamMeta(
  col: Pick<ColSpec, "family" | "field" | "label" | "master" | "engineStatus" | "readOnly" | "defaultWhenMissing">,
): ResolvedParamMeta {
  const meta = PARAM_META[col.field];
  const defaultValue = schemaDefault(col.family, col.field) ?? col.defaultWhenMissing;
  return {
    field: col.field,
    label: col.label ?? FIELD_LABELS[col.field] ?? col.field,
    family: col.family,
    symbol: meta?.symbol,
    unit: meta?.unit,
    range: meta?.range,
    meaning: meta?.meaning ?? "No spec description for this parameter yet.",
    formula: meta?.formula,
    specRef: meta?.specRef,
    options: meta?.options,
    defaultValue,
    engine: columnEngineStatus(col),
    isMaster: !!col.master,
  };
}
