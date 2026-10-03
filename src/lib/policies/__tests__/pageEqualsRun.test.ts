/**
 * GATE `page-equals-run` — PLAN.md §23 WP 13.4, §4 D280.
 *
 * For a given dataset version and policy version, the value /policies displays in
 * a cell is the value the engine receives — or the cell says, at the point of
 * display, that the engine does not read it. There is no third state.
 *
 * `scripts/example_project/page_equals_run.json` is a fixture project that
 * exercises every source a master-backed cell can show (a /policies override, the
 * item master, a lane-derived value, the line-rate derivation, the engine's
 * declared default, a BOM-only material, a supplier with no master row). Its
 * `engine` block is what scsim's mapper gives each entity field — generated and
 * held current by `sim-worker/tests/test_page_equals_run.py`. This suite resolves
 * EVERY master-backed cell of every grid row through the page's own resolver
 * (`resolveCell`, the one both grid surfaces call) and requires ZERO differences,
 * in the value and in the source the cell claims. It also requires that every
 * other editable cell either reaches the engine on its stage or is badged "not
 * simulated" (`cellEngineRead`, generated from the mapper's declared scopes).
 *
 * MUTATION-TESTED (§16 · WP 13.4): ignoring overrides in the resolver, reading
 * the master before the override in the mapper, and dropping a declared scope
 * each turn this suite (or its engine half) red.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC, type ColSpec } from "../columnSpecs";
import { masterIdOf, resolveCell, type DerivedMaps, type MasterRowMaps } from "../resolveEffective";
import { customerRowMasters, type ForecastBucket } from "../customerRows";
import {
  derivedMaterialCost,
  derivedMaterialCostDetails,
  derivedProductionCapacity,
  demandWeightedSellPrice,
  weeklyDemand,
} from "../effectiveEconomics";
import { DEFAULT_BUNDLE, type PolicyBundle, type PolicyFamily } from "../schemas";
import type { OverrideRow } from "../resolve";
import { cellEngineRead } from "../cellEngineRead";
import { familiesForStage } from "../columnSpecs";

type Row = Record<string, unknown>;
const ROOT = join(__dirname, "..", "..", "..", "..");
const FX = JSON.parse(readFileSync(join(ROOT, "scripts", "example_project", "page_equals_run.json"), "utf8")) as {
  tables: Record<"suppliers" | "materials" | "products" | "inbound" | "outbound" | "bom" | "demand_forecasts" | "customers", Row[]>;
  plant: string;
  policy: { defaults: PolicyBundle; overrides: OverrideRow[] };
  engine: Record<string, Record<string, { source: string; value: number | string | null }>>;
};

const T = FX.tables;
const overrides = FX.policy.overrides;
const defaults = FX.policy.defaults;

const masters: MasterRowMaps = {
  materials: new Map(T.materials.map((m) => [String(m.material_id), m])),
  products: new Map(T.products.map((p) => [String(p.product_id), p])),
  suppliers: new Map(T.suppliers.map((s) => [String(s.supplier_id), s])),
  // PLAN.md §24 WP 14.2 — the Customer stage's base: the rows' own demand spec.
  outbound_logistics: customerRowMasters(T.outbound, (T.demand_forecasts ?? []) as unknown as ForecastBucket[]),
  // WP 14.3 — the base under a Customer row's priority and service target.
  customers: new Map((T.customers ?? []).map((c) => [String(c.customer_id), c])),
};
const derived: DerivedMaps = {
  materialCost: derivedMaterialCost(T.inbound),
  materialCostVia: derivedMaterialCostDetails(T.inbound),
  sellPrice: demandWeightedSellPrice(T.outbound),
  demandMean: weeklyDemand(T.outbound),
  productionCapacity: derivedProductionCapacity(T.products, T.outbound, defaults as unknown as Row, overrides as unknown as Row[]),
};

/** The grid's rows, keyed exactly as the stages key their overrides. */
const ROWS: Record<"supplier" | "plant" | "customer", Row[]> = {
  supplier: T.inbound.map((a) => ({ key: `${a.supplier_id}::${a.material_id}`, supplier_id: a.supplier_id, material_id: a.material_id })),
  plant: T.products.map((p) => ({ key: `${FX.plant}::${p.product_id}`, item_id: FX.plant, product_id: p.product_id })),
  customer: T.outbound.map((o) => ({ key: `${o.customer_id}::${o.product_id}`, customer_id: o.customer_id, product_id: o.product_id })),
};

/** The source a cell may claim for each engine source. */
const SAME_SOURCE: Record<string, string[]> = {
  override: ["override"],
  master: ["master", "contract"],
  lanes: ["derived"],
  derived: ["derived"],
  default: ["default", "contract"],
};

function cells() {
  const out: Array<{ where: string; engine: { source: string; value: number | string | null }; cell: ReturnType<typeof resolveCell> }> = [];
  for (const stage of ["supplier", "plant", "customer"] as const) {
    const cols = STAGE_TABLE_SPEC[stage].cols.filter((c) => c.master);
    const masterColByField = new Map<string, ColSpec>(cols.map((c) => [c.field, c]));
    for (const row of ROWS[stage]) {
      for (const col of cols) {
        // The engine reports a Customer cell per ROW, whatever its master's
        // grain (WP 14.3: a row's priority sits over its customer's value).
        const id = stage === "customer" ? String(row.key) : masterIdOf(col, row);
        const engine = FX.engine[`${col.master!.table}.${col.master!.field}`]?.[id];
        const cell = resolveCell({
          rowKey: String(row.key), row, col, families: familiesForStage(stage) as PolicyFamily[],
          masterColByField, masterRowById: masters, derived, defaults, overrides,
          scope: "node", familyDefault: () => undefined,
        });
        out.push({ where: `${stage} ${row.key} ${col.field}`, engine, cell });
      }
    }
  }
  return out;
}

describe("gate page-equals-run — the fixture is the page's world", () => {
  it("the fixture's policy defaults are the page's DEFAULT_BUNDLE (a version stores them, §4 D204 a)", () => {
    expect(defaults).toEqual(JSON.parse(JSON.stringify(DEFAULT_BUNDLE)));
  });

  it("every master-backed cell has an engine answer to be compared with", () => {
    const missing = cells().filter((c) => !c.engine).map((c) => c.where);
    expect(missing).toEqual([]);
    expect(cells().length).toBeGreaterThanOrEqual(25);
  });
});

describe("gate page-equals-run — zero differing cells", () => {
  it("every master-backed cell shows the value the engine receives, from the source the engine used", () => {
    const differs: string[] = [];
    for (const { where, engine, cell } of cells()) {
      // An ENUM master (the Customer row's distribution, WP 14.2) shows a token.
      const shown = typeof cell.value === "number" || typeof cell.value === "string" ? cell.value : undefined;
      // An empty cell may show the declared RULE instead of a number — "unlimited",
      // "the engine's own opening stock", "the scenario's CV, else 0.30" — when the
      // engine fell through to its default (or an empty master column). That is the
      // cell saying, at the point of display, what the engine does (T1: a named
      // rule); any other empty-looking cell is a difference.
      const saysTheRule =
        shown === undefined && !!cell.placeholder && cell.provenance === "contract" &&
        (engine.value === null || engine.source === "default");
      const valueOk =
        saysTheRule ||
        (engine.value !== null && shown !== undefined &&
          (typeof engine.value === "string"
            ? shown === engine.value
            : typeof shown === "number" && Math.abs(shown - engine.value) < 1e-9));
      const sourceOk = saysTheRule || (SAME_SOURCE[engine.source] ?? []).includes(cell.provenance);
      if (!valueOk || !sourceOk) {
        differs.push(`${where}: page ${String(shown ?? cell.placeholder)} (${cell.provenance}) · engine ${engine.value} (${engine.source})`);
      }
    }
    expect(differs, "these cells show something the run does not use").toEqual([]);
  });

  it("every other editable cell reaches the engine on its stage, or says it does not", () => {
    const silent: string[] = [];
    for (const stage of ["supplier", "plant", "customer"] as const) {
      for (const col of STAGE_TABLE_SPEC[stage].cols) {
        if (col.master || col.synthetic) continue;
        const read = cellEngineRead(stage, col);
        // A cell either reaches the engine or carries the sentence that says it
        // does not — the badge is generated from this answer, so a cell with
        // neither cannot exist.
        if (!read.reaches && !(read as { note?: string }).note) silent.push(`${stage}.${col.field}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it("the D204 (b) cells are badged, and the cells the engine reads are not", () => {
    const badge = (stage: "supplier" | "plant", field: string) => {
      const col = STAGE_TABLE_SPEC[stage].cols.find((c) => c.field === field)!;
      return cellEngineRead(stage, col).reaches === false;
    };
    expect(badge("supplier", "basis")).toBe(true);
    expect(badge("supplier", "review_period_days")).toBe(true);
    // The Plant stage no longer carries the inventory family at all: every one
    // of those cells was badged "not simulated", because the engine reads none
    // of them from a Plant row. P-P.4 is the project line above the grid.
    const plantFields = new Set(STAGE_TABLE_SPEC.plant.cols.map((c) => c.field));
    for (const f of ["type", "__inv_params", "basis", "reorder_point", "order_up_to", "rop_q_quantity",
      "review_period_days", "safety_stock_days", "holding_cost_pct", "service_level_target",
      "fg_safety_stock", "fg_service_level_target", "fg_safety_stock_days"]) {
      expect(plantFields.has(f), `plant.${f} is back on the Plant grid`).toBe(false);
    }
    // Every Plant cell that is left reaches the engine on a Plant row.
    for (const c of STAGE_TABLE_SPEC.plant.cols) {
      if (c.readOnly) continue;
      expect(cellEngineRead("plant", c).reaches, `plant.${c.field}`).toBe(true);
    }
    for (const f of ["type", "reorder_point", "order_up_to", "rop_q_quantity", "coverage_weeks", "safety_stock_days", "holding_cost_pct", "primary_source"]) {
      expect(badge("supplier", f), `supplier.${f}`).toBe(false);
    }
  });
});
