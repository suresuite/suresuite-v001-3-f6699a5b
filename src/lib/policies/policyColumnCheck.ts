// The /policies page, column by column: what each cell shows, where an edit is
// saved, what the simulation engine actually uses, and whether an edit changes
// a run. Rendered on the Data map view (`PolicyColumnCheck.tsx`).
//
// WHERE EACH FACT COMES FROM, so this file is not a second author of any:
//   - WHICH columns exist, their header label and sub-label: read from
//     `STAGE_TABLE_SPEC` / `COLUMN_FIT` / `shortLabelFor` — the grid's own spec.
//     `policyColumnCheck.test.ts` fails when a column is added to (or removed
//     from) the spec without its verdict here, so the page cannot go stale by
//     omission.
//   - WHAT the engine does with each field: `scsim/scsim/io/project_map.py`
//     (`_map_policies`, the product / material / arc loops). The verdicts below
//     restate that reader in words; the test pins the one mechanical part of it
//     (a column may only claim to reach the engine if it is master-backed or in
//     `SCSIM_VISIBLE_FIELDS`).
//   - The production counts: PLAN.md §15, audit 2026-09-29, run `36629798467`,
//     every project. They are dated because they are measurements, not rules.
//   - Each open problem cites its PLAN.md §4 D-row, which owns the evidence.
import { COLUMN_FIT, STAGE_TABLE_SPEC, shortLabelFor } from "./columnSpecs";
import type { StageKey } from "./stages";
import { PLANNING_UNIT, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";

/** Whether an edit made on /policies changes what the simulation runs. */
export type Verdict =
  /** An edit changes the run. */
  | "works"
  /** An edit changes the run only under the stated condition. */
  | "conditional"
  /** Read-only here; the value shown is NOT the value the engine uses. */
  | "differs"
  /** Stored and versioned, never read by the engine. */
  | "ignored"
  /** Shown disabled; nothing reads it yet. */
  | "disabled"
  /** Read-only and faithful, or a structural column with no value to edit. */
  | "info";

export interface ColumnCheck {
  /** What the cell displays, and where that value is read from. */
  shows: string;
  /** Where an edit is written ("—" when the cell is read-only). */
  savedTo: string;
  /** What the engine uses for this quantity, with its own default when blank. */
  engine: string;
  verdict: Verdict;
  /** The condition, and what production shows. */
  note?: string;
  /** What the column should be for the page and the run to agree. */
  shouldBe?: string;
  /** PLAN.md §4 rows that own the problem. */
  refs?: string[];
}

/** Production measurement the notes quote. */
export const MEASURED = {
  date: "2026-09-29",
  run: "36629798467",
  scope: "every project in production (10)",
} as const;

export const GRID_STAGES = ["supplier", "plant", "customer"] as const satisfies readonly StageKey[];
export type GridStage = (typeof GRID_STAGES)[number];

export const STAGE_TITLE: Record<GridStage, string> = {
  supplier: "Supplier stage — one row per supplier × material (override key supplier::material)",
  plant: "Plant stage — one row per finished product (override key plant::product)",
  customer: "Customer stage — one row per customer × product (override key customer::product)",
};

/** Where the stage's ROWS come from — the first thing a reader needs. */
export const STAGE_ROWS: Record<GridStage, string> = {
  supplier:
    "Rows: the stored lane graph (get_supply_chain_data, inbound lanes) enriched from inbound_logistics, " +
    "plus '(made in-house)', '(unassigned supplier)' and 'not in BOM' lines. The engine reads inbound_logistics " +
    "directly, never the stored graph — so a stale graph (§4 D187; Project 2 today) shows lanes the run does not use.",
  plant:
    "Rows: products that are a BOM parent in the stored graph AND ship outbound. The 'Focal plant' key is " +
    "projects.plant_name (§4 D202: Project AA's data sits on a different plant name). Everything from 'Policy type' " +
    "down appears only when the policy fulfillment strategy is MTS / ATO / CTO — a value the worker engine does not read (§4 D197).",
  customer:
    "Rows: outbound lanes of the stored graph. Fulfillment (backorder, allocation) is not per row — it is the " +
    "Fulfillment defaults card below the grid.",
};

/** The key (identity) columns, which are not in the column spec's `cols`. */
export const KEY_COLUMNS: Record<GridStage, Array<{ label: string; check: ColumnCheck }>> = {
  supplier: [
    {
      label: "Material (flat view)",
      check: { shows: "material id of the lane (inbound_logistics.material_id)", savedTo: "—", engine: "arc material_id", verdict: "info" },
    },
    {
      label: "Product / L0…Ln (BOM tree view)",
      check: {
        shows: "the BOM path, from the uploaded bom_multi_level rows",
        savedTo: "—",
        engine: "the engine flattens the same BOM (datamap._flatten_multi_level_bom)",
        verdict: "info",
        note: "Multi-level projects only; a single-level project keeps the flat view.",
      },
    },
    {
      label: "Qty / assy (BOM tree view)",
      check: {
        shows: "the edge rate from the STORED multi-tier graph; tooltip flow and demand from the same graph",
        savedTo: "—",
        engine: "bom consumption_rate (blank → 1.0); demand = products.demand_mean, else Σ weekly outbound",
        verdict: "differs",
        note:
          "The graph reads a blank rate as 0 (0 blank rates today) and builds flow from outbound volume only, " +
          "never demand_mean — all 6 Aumovio products differ.",
        shouldBe: "graph built by the engine's rules: rate default 1.0, demand_mean first",
        refs: ["D195", "D198"],
      },
    },
    {
      label: "Qty / assy (flat view, single-level BOM)",
      check: {
        shows:
          "bom_single_level.consumption_rate for each product that uses the material — one value, or the range and product count; every product is listed in the tooltip",
        savedTo: "— (read-only; change it in the BOM file)",
        engine: "the same rate (BomArc.consumption_rate); blank or 0 → 1.0",
        verdict: "info",
        note: "A blank or 0 rate shows the engine's 1, marked 'def'. A material outside the BOM shows '—'. Hidden when the project has no single-level BOM rows.",
      },
    },
    {
      label: "Supplier",
      check: { shows: "supplier id of the lane (inbound_logistics.supplier_id)", savedTo: "—", engine: "arc supplier_id", verdict: "info" },
    },
  ],
  plant: [
    {
      label: "Focal plant",
      check: {
        shows: "projects.plant_name",
        savedTo: "—",
        engine: "ignored (the engine is single-plant and merges plant names)",
        verdict: "info",
        note: "Project AA: record says 'Plant AA', data says 'Plant AA Rocherfort'.",
        refs: ["D202"],
      },
    },
    { label: "Product", check: { shows: "product id", savedTo: "—", engine: "product id", verdict: "info" } },
  ],
  customer: [
    { label: "Customer", check: { shows: "customer id (outbound lane)", savedTo: "—", engine: "customer id", verdict: "info" } },
    { label: "Product", check: { shows: "product id (outbound lane)", savedTo: "—", engine: "product id", verdict: "info" } },
  ],
};

const DROPPED_PER_ROW =
  "per-row value DROPPED — the engine reads this field only at the project-default scope";

/**
 * One verdict per grid column, keyed `<stage>:<field>`. The test requires the
 * key set to equal the spec's columns exactly.
 */
export const COLUMN_CHECK: Record<string, ColumnCheck> = {
  // ─────────────────────────────── supplier ───────────────────────────────
  "supplier:primary_source": {
    shows: "the grid's pick: highest weekly volume → lowest price → shortest lead time",
    savedTo: "override sourcing.primary_source",
    engine: "not read — the engine's primary link is the CHEAPEST (cost → lead time → supplier id)",
    verdict: "ignored",
    note:
      "866 stored. Engine ≠ grid on 27 of 35 multi-sourced materials in Project 2 and in Project AA. " +
      "The pre-run gate REQUIRES this selection, so it must be set even though the run ignores it.",
    shouldBe: "one rule for 'primary' — the engine's — shown read-only, or the engine reads this field",
    refs: ["D188"],
  },
  "supplier:supply_share": {
    shows: "override, 0–1 (column appears only when sourcing strategy = multi or ratios exist)",
    savedTo: "override sourcing.supply_share",
    engine: "P-S.2 proactive multi-sourcing weight, renormalized to 100 % per material",
    verdict: "conditional",
    note:
      "Only for a material with ≥ 2 suppliers. With no share set, P-S.2 splits EQUALLY over the cheapest " +
      "suppliers, not by lane volume. No project is on strategy = multi today, so the column is hidden everywhere.",
  },
  "supplier:material_price": {
    shows: "inbound_logistics.unit_price; a blank price shows the material's / project's AVERAGE (imputed)",
    savedTo: "— (read-only; change it in the inbound file)",
    engine: "inbound_logistics.unit_price; blank or ≤ 0 → 1.0",
    verdict: "differs",
    note: "30 blank prices (Project 2: 7, Project AA: 23) show an average and run at 1.0. 452 old price overrides are still stored and read by nothing.",
    shouldBe: "show the engine's value, a blank as 'default 1.0'",
    refs: ["D189"],
  },
  "supplier:material_cost": {
    shows: "materials.cost (item master)",
    savedTo: "materials.cost (master upsert)",
    engine: "materials.cost → volume-weighted inbound price → cheapest inbound price → 1.0",
    verdict: "works",
  },
  "supplier:material_moq": {
    shows: "materials.moq (item master)",
    savedTo: "materials.moq (master upsert)",
    engine: "materials.moq on every link of the material; blank → 0",
    verdict: "works",
  },
  "supplier:capacity_per_week": {
    shows: "suppliers.capacity_per_week (item master); blank shows ∞",
    savedTo: "suppliers.capacity_per_week (master upsert)",
    engine: "suppliers.capacity_per_week; blank = unlimited",
    verdict: "works",
  },
  "supplier:reliability_score": {
    shows: "suppliers.reliability_score (item master)",
    savedTo: "suppliers.reliability_score (master upsert)",
    engine: "passed to the engine, but read only by the backup-supplier 'reliability' selection rule, which the mapper never selects (always min_cost)",
    verdict: "ignored",
    shouldBe: "remove, or let the backup rule be chosen so this value matters",
  },
  "supplier:lead_time_days": {
    shows: "uploaded inbound lead_time, in weeks, NOT converted by lead_time_unit; a blank shows an AVERAGE (imputed)",
    savedTo: "— (read-only; change it in the inbound file)",
    engine: "lead_time × lead_time_unit → weeks, rounded, clamped 1–51; blank or 0 → 2 weeks",
    verdict: "differs",
    note: "284 blank lead times (Project 2: 134, Project AA: 150) show an average and run at 2 weeks. No lane stores a non-week unit today.",
    shouldBe: "show the engine's rounded weeks, a blank as 'default 2 wk'",
    refs: ["D189"],
  },
  "supplier:type": {
    shows: "override → project default → min_max",
    savedTo: "override inventory.type",
    engine: "per-material policy type (inventory_control.material_overrides); s_S / continuous_review run as min_max",
    verdict: "works",
    note: "853 stored.",
  },
  "supplier:__inv_params": {
    shows: "the Replenishment cell: only the parameters the row's policy type uses (rows below); an empty s / S shows a computed placeholder",
    savedTo: "the individual fields below",
    engine: "see the individual fields",
    verdict: "info",
    note:
      "The placeholder uses the grid's demand (the AVERAGE of a product's customer lanes, one BOM level, never demand_mean) " +
      "and the grid's lead time — not the engine's. An empty cell runs on the engine's own numbers, not the placeholder.",
    refs: ["D189"],
  },
  "supplier:basis": {
    shows: "override → days_of_supply",
    savedTo: "override inventory.basis",
    engine: "not read",
    verdict: "ignored",
    note: "495 stored.",
    shouldBe: "remove",
  },
  "supplier:reorder_point": {
    shows: "override, else the computed placeholder",
    savedTo: "override inventory.reorder_point",
    engine: "absolute reorder point s for that material",
    verdict: "works",
    note: "Types min_max and rop only.",
  },
  "supplier:order_up_to": {
    shows: "override, else the computed placeholder",
    savedTo: "override inventory.order_up_to",
    engine: "absolute order-up-to S for that material; dropped (formula S used) if S ≤ s",
    verdict: "works",
    note: "Types min_max, base_stock and periodic_review.",
  },
  "supplier:rop_q_quantity": {
    shows: "override",
    savedTo: "override inventory.rop_q_quantity",
    engine: "order quantity Q for that material, when > 0",
    verdict: "works",
    note: "Type rop only.",
  },
  "supplier:coverage_weeks": {
    shows: "override → project default → 8",
    savedTo: "override inventory.coverage_weeks",
    engine: "κ for that material; with NOTHING saved the engine uses its own 8 / 10 / 12-week strip, which rises during disruptions",
    verdict: "conditional",
    note: "Works once saved. κ is saved in no project today, so every run used the strip while the page said 8.",
    refs: ["D204"],
  },
  "supplier:review_period_days": {
    shows: "override → 1",
    savedTo: "override inventory.review_period_days",
    engine: "not read (only the frozen legacy engine read it)",
    verdict: "ignored",
    note: "Type periodic_review only.",
    shouldBe: "remove, or wire it into the periodic policy",
  },
  "supplier:initial_on_hand": {
    shows: "materials.initial_on_hand (item master)",
    savedTo: "materials.initial_on_hand (master upsert)",
    engine: "materials.initial_on_hand; blank → the engine's own starting stock",
    verdict: "works",
  },
  "supplier:safety_stock_days": {
    shows: "override → project default → 7",
    savedTo: "override inventory.safety_stock_days (per row)",
    engine: DROPPED_PER_ROW,
    verdict: "ignored",
    note: "340 stored per row, all ignored (the run log says so as a warning).",
    shouldBe: "a project-level control, or make the engine read it per material",
    refs: ["D204"],
  },
  "supplier:holding_cost_pct": {
    shows: "override → project default → 0.2",
    savedTo: "override inventory.holding_cost_pct (per row)",
    engine: "materials.holding_cost_pct (master) → project-default policy → 20 %/yr; the per-row value is DROPPED",
    verdict: "ignored",
    note: "817 stored per row, all ignored.",
    shouldBe: "a master-backed column on materials.holding_cost_pct",
    refs: ["D204"],
  },
  "supplier:mode": {
    shows: "disabled, 'pending'",
    savedTo: "override transport.mode",
    engine: "not read — waits for the planned transport policies (P-T.x)",
    verdict: "disabled",
  },
  "supplier:cost_per_km": {
    shows: "disabled, 'pending'",
    savedTo: "override transport.cost_per_km",
    engine: "not read — waits for the planned transport policies (P-T.x)",
    verdict: "disabled",
  },

  // ──────────────────────────────── plant ────────────────────────────────
  "plant:sell_price": {
    shows: "products.sell_price (item master)",
    savedTo: "products.sell_price (master upsert)",
    engine: "products.sell_price → demand-weighted outbound price → 1.0",
    verdict: "works",
  },
  "plant:production_capacity": {
    shows: "products.production_capacity, units / week (item master)",
    savedTo: "products.production_capacity (master upsert)",
    engine: "master → line capacity × 7 × utilization → max(2 × demand, 1000)",
    verdict: "works",
  },
  "plant:demand_mean": {
    shows: "products.demand_mean, units / week (item master)",
    savedTo: "products.demand_mean (master upsert)",
    engine: "products.demand_mean → Σ weekly outbound volume → 0",
    verdict: "works",
    note: "The run uses it; the network pages and the Supplier tree do not (they use outbound volume) — all 6 Aumovio products differ.",
    refs: ["D195"],
  },
  "plant:capacity_units_per_day": {
    shows: "override → 1000",
    savedTo: "override production.capacity_units_per_day",
    engine: "used ONLY when products.production_capacity is blank (the master wins, with a warning)",
    verdict: "conditional",
    note: "8 stored.",
  },
  "plant:utilization_cap_pct": {
    shows: "override → 85",
    savedTo: "override production.utilization_cap_pct",
    engine: "multiplies line capacity — only when products.production_capacity is blank",
    verdict: "conditional",
  },
  "plant:type": {
    shows: "override → project default",
    savedTo: "override inventory.type (plant row)",
    engine: "plant rows are DROPPED — the engine has no per-product stock policy",
    verdict: "ignored",
    shouldBe: "remove from the plant stage, or add a finished-goods policy to the engine",
  },
  "plant:__inv_params": {
    shows: "the Replenishment cell (rows below)",
    savedTo: "the individual fields below",
    engine: "plant rows are DROPPED",
    verdict: "ignored",
  },
  "plant:basis": { shows: "override", savedTo: "override inventory.basis", engine: "not read", verdict: "ignored" },
  "plant:reorder_point": { shows: "override → 50", savedTo: "override inventory.reorder_point (plant row)", engine: "plant rows are DROPPED", verdict: "ignored" },
  "plant:order_up_to": { shows: "override → 200", savedTo: "override inventory.order_up_to (plant row)", engine: "plant rows are DROPPED", verdict: "ignored" },
  "plant:rop_q_quantity": { shows: "override → 0", savedTo: "override inventory.rop_q_quantity (plant row)", engine: "plant rows are DROPPED", verdict: "ignored" },
  "plant:review_period_days": { shows: "override → 1", savedTo: "override inventory.review_period_days", engine: "not read", verdict: "ignored" },
  "plant:initial_on_hand": {
    shows: "override ('Initial FG')",
    savedTo: "override inventory.initial_on_hand",
    engine: "no reader — the engine keeps no finished-goods starting stock",
    verdict: "ignored",
    refs: ["D89"],
  },
  "plant:safety_stock_days": { shows: "override → 7", savedTo: "override inventory.safety_stock_days (plant row)", engine: DROPPED_PER_ROW, verdict: "ignored" },
  "plant:holding_cost_pct": { shows: "override → 0.2", savedTo: "override inventory.holding_cost_pct (plant row)", engine: DROPPED_PER_ROW, verdict: "ignored" },
  "plant:service_level_target": { shows: "override → 0.95", savedTo: "override inventory.service_level_target (plant row)", engine: DROPPED_PER_ROW, verdict: "ignored" },
  "plant:fg_safety_stock": {
    shows: "override → none",
    savedTo: "override inventory.fg_safety_stock (plant row)",
    engine: "per-row value DROPPED; the project default drives P-P.4, and only when an MTS product exists",
    verdict: "ignored",
    shouldBe: "a project-level control",
  },
  "plant:fg_service_level_target": { shows: "override → 0.95", savedTo: "override inventory.fg_service_level_target (plant row)", engine: DROPPED_PER_ROW, verdict: "ignored" },
  "plant:fg_safety_stock_days": { shows: "override → 2", savedTo: "override inventory.fg_safety_stock_days (plant row)", engine: DROPPED_PER_ROW, verdict: "ignored" },
  "plant:allocation_priority_weight": {
    shows: "override → 1 (column appears only when the recovery response includes 'allocate materials')",
    savedTo: "override production.allocation_priority_weight",
    engine: "P-P.9 per-product allocation priority",
    verdict: "conditional",
    note: "No project has 'allocate materials' set, and no control on /policies can set it any more.",
  },

  // ─────────────────────────────── customer ───────────────────────────────
  "customer:primary_source": {
    shows: "the grid's pick of serving firm",
    savedTo: "override fulfillment.primary_source",
    engine: "not read",
    verdict: "ignored",
    note: "12 stored. The pre-run gate requires one per customer × product.",
  },
  "customer:sourcing_firm": {
    shows: "the highest-volume serving firm",
    savedTo: "override fulfillment.sourcing_firm",
    engine: "not read (the engine is single-plant)",
    verdict: "ignored",
    note: "10 stored. The pre-run gate requires it.",
  },
};

/** Header label + sub-label exactly as the grid renders them. */
export function headerFor(stage: GridStage, field: string): { label: string; sub: string } {
  const spec = STAGE_TABLE_SPEC[stage].cols.find((c) => c.field === field);
  const fit = COLUMN_FIT[field];
  let label = shortLabelFor(stage, field, spec?.label ?? field);
  // The grid names the planning unit only on READ-ONLY day-stored columns,
  // whose values it converts (StagePolicyTable's `adaptLabel`); same rule here.
  if (spec?.readOnly && /days?$/.test(field)) label = label.replace(/\(days\)/g, `(${UNIT_LABEL_PLURAL[PLANNING_UNIT]})`);
  return { label, sub: fit?.sub ?? "" };
}

/** The grid's columns for one stage, in the grid's order, each with its verdict. */
export function stageColumnChecks(stage: GridStage) {
  return STAGE_TABLE_SPEC[stage].cols.map((c) => ({
    field: c.field,
    family: c.family,
    inVector: c.vectorGroup === "invParams",
    ...headerFor(stage, c.field),
    check: COLUMN_CHECK[`${stage}:${c.field}`],
  }));
}

/**
 * The Fulfillment defaults card (Customer stage) — the only project-default
 * card left on /policies. Keys are the card's fields; the test holds them
 * equal to the fields the card renders.
 */
export const FULFILLMENT_CARD_CHECK: Record<string, ColumnCheck> = {
  allocation: {
    shows: "saved value; never saved → 'priority'",
    savedTo: "policy_defaults.fulfillment (whole family on save)",
    engine: "P-C.2 customer allocation, with ≥ 2 customers; never saved → NO allocation rule",
    verdict: "conditional",
    note: "Never saved in 9 of 10 projects, so the page says 'priority' and the run has no rule.",
    refs: ["D204"],
  },
  backorder_allowed: {
    shows: "saved value; never saved → YES",
    savedTo: "policy_defaults.fulfillment",
    engine: "P-C.1 backorder; never saved → NO (lost sales)",
    verdict: "conditional",
    note: "Never saved in 9 of 10 projects: every run there simulated lost sales while this card said backorders are allowed.",
    shouldBe: "store the defaults the page shows, so page and run agree before the first save",
    refs: ["D204"],
  },
  max_backorder_days: {
    shows: "saved value; never saved → 14 (visible when backorder is on)",
    savedTo: "policy_defaults.fulfillment",
    engine: "backorder horizon in weeks (days ÷ 7, clamped 0–26); never saved → 14",
    verdict: "works",
  },
  backorder_cost_per_day: {
    shows: "saved value; never saved → 2 (visible when backorder is on)",
    savedTo: "policy_defaults.fulfillment",
    engine: "backorder penalty × 7 per week; never saved → 0",
    verdict: "conditional",
    note: "Agrees once the card is saved.",
    refs: ["D204"],
  },
};

/** Page-level controls outside the grid. */
export const PAGE_LEVEL_CHECK: Array<{ label: string; check: ColumnCheck }> = [
  {
    label: "Planning unit (day · week · month)",
    check: {
      shows: "fixed to week; day and month disabled",
      savedTo: "browser storage only",
      engine: "the engine always steps in weeks",
      verdict: "info",
    },
  },
  {
    label: "Fulfillment strategy (display only since presets were removed)",
    check: {
      shows: "policy_defaults.fulfillment_strategy — decides whether the Plant inventory columns appear",
      savedTo: "no control on /policies any more",
      engine: "worker: products.fulfillment_mode → projects.supply_chain_model → MTO. Browser engine: this value",
      verdict: "differs",
      note: "The policy value and projects.supply_chain_model disagree in 6 of 10 projects.",
      shouldBe: "one project default, the one the worker reads",
      refs: ["D197"],
    },
  },
  {
    label: "Apply prefill",
    check: {
      shows: "one bulk action per stage",
      savedTo: "overrides: uploaded values plus the grid's 'decided' primary supplier / sourcing firm",
      engine: "the primary selections it writes are required by the pre-run gate and read by nothing in the engine",
      verdict: "info",
      refs: ["D188"],
    },
  },
  {
    label: "Excel import / export (per stage)",
    check: {
      shows: "the stage's families as a workbook",
      savedTo: "policy_defaults (the stage's families) and overrides",
      engine: "same rules as the grid and the cards",
      verdict: "info",
      note: "The only way left on /policies to change the project-default inventory, sourcing and recovery families.",
    },
  },
];

/** Run & validate stage. */
export const RUN_VALIDATE_CHECK: Array<{ label: string; check: ColumnCheck }> = [
  { label: "Seed", check: { shows: "run form", savedTo: "the 'validation' scenario row", engine: "scenario seed; a seed of 0 runs as 42", verdict: "works" } },
  { label: "Replications", check: { shows: "run form", savedTo: "the 'validation' scenario row", engine: "scenario replications", verdict: "works" } },
  { label: "Horizon (days)", check: { shows: "run form", savedTo: "the 'validation' scenario row", engine: "scenario horizon", verdict: "works" } },
  {
    label: "Warm-up (days, method)",
    check: {
      shows: "run form",
      savedTo: "NOT written to the scenario",
      engine: "the scenario's own warm-up (auto)",
      verdict: "ignored",
    },
  },
  {
    label: "Demand model",
    check: {
      shows: "not shown",
      savedTo: "the validation scenario is created with Poisson (λ 50, never read)",
      engine: "a product with no demand_distribution runs the SCENARIO's kind — Poisson",
      verdict: "differs",
      note: "16 completed runs simulated Poisson, and nothing on the run form says which model the run used.",
      refs: ["D190"],
    },
  },
];

/** Engine inputs with NO column on /policies — so nothing reads as complete that is not. */
export const NO_COLUMN_CHECK: Array<{ label: string; check: ColumnCheck }> = [
  {
    label: "Demand distribution, CV, min, max (products)",
    check: {
      shows: "no column here — their status per project is on the 'Uploaded data → engine' tab",
      savedTo: "item-master editor or products upload",
      engine: "products.* → the scenario's demand model (Poisson for scenarios created in the app) → triangular / 0.30",
      verdict: "info",
      shouldBe: "Plant-stage columns backed by the products master",
      refs: ["D190"],
    },
  },
  {
    label: "Fulfillment mode per product (products.fulfillment_mode)",
    check: {
      shows: "no column",
      savedTo: "item-master editor or products upload",
      engine: "products.fulfillment_mode → projects.supply_chain_model → MTO",
      verdict: "info",
      shouldBe: "a Plant-stage master column",
      refs: ["D197"],
    },
  },
  {
    label: "Lead-time distribution and CV (materials)",
    check: {
      shows: "no column",
      savedTo: "item-master editor or materials upload",
      engine: "materials.lead_time_dist / lead_time_cv → deterministic / 0",
      verdict: "info",
      shouldBe: "Supplier-stage master columns",
    },
  },
  {
    label: "Customer priority and segment (customers)",
    check: {
      shows: "no column",
      savedTo: "customers upload only",
      engine: "used only under an allocation rule — which 9 of 10 projects never saved",
      verdict: "info",
    },
  },
  {
    label: "Project-default safety-stock method, safety-stock days, service level, κ, holding cost",
    check: {
      shows: "no card since presets were removed",
      savedTo: "Excel import or a version restore only",
      engine: "read at the project-default scope (the per-row cells are dropped)",
      verdict: "info",
      shouldBe: "a Supplier-stage defaults card",
      refs: ["D204"],
    },
  },
  {
    label: "Sourcing strategy, recovery responses, detection lag",
    check: {
      shows: "no card since presets were removed",
      savedTo: "Excel import or a version restore only",
      engine: "read at the project-default scope (backup supplier, expedite, early warning, allocate materials…)",
      verdict: "info",
      shouldBe: "a defaults card",
    },
  },
  {
    label: "SLA tier floors (fulfillment.tier_overrides)",
    check: {
      shows: "no control",
      savedTo: "—",
      engine: "used only under the sla_tier allocation rule",
      verdict: "info",
    },
  },
];
