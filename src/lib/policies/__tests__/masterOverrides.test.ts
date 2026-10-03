/**
 * PLAN.md §23 WP 13.1 · §4 D280, D281 — a master-backed /policies cell is an
 * OVERRIDE, resolved the way the engine resolves it, and saved as full patches.
 *
 * The exit test's grid half reads `scripts/example_project/policies_edit_cost.json`,
 * the same fixture `sim-worker/tests/test_policies_override.py` hands the engine:
 * a cost edited on the Supplier row S1::M1 is saved as exactly those override
 * rows (and no master write — `policiesNeverWriteMasters.test.ts`), and the
 * engine uses it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC, type ColSpec } from "../columnSpecs";
import {
  entityOverride,
  isUsableOverride,
  masterOverrideRule,
  masterOverrideRules,
  planEntityOverride,
  planPatch,
  settlePlan,
  type SavePlan,
} from "../masterOverrides";
import { resolveCell } from "../resolveEffective";
import type { OverrideRow } from "../resolve";
import type { PolicyBundle } from "../schemas";

const ROOT = join(__dirname, "..", "..", "..", "..");
const FX = JSON.parse(
  readFileSync(join(ROOT, "scripts", "example_project", "policies_edit_cost.json"), "utf8"),
) as {
  edit: { row_key: string; material_id: string; field: string; value: number };
  grid_rows: Array<{ key: string; supplier_id: string; material_id: string }>;
  saved_before: OverrideRow[];
  upserts_after_save: OverrideRow[];
  engine_reads: { material: string; cost: number; master_cost: number };
};

const col = (stage: "supplier" | "plant", field: string): ColSpec =>
  STAGE_TABLE_SPEC[stage].cols.find((c) => c.field === field)!;
const node = (target_key: string, family: OverrideRow["family"], patch: Record<string, unknown>): OverrideRow =>
  ({ scope: "node", target_key, family, patch });

describe("the rule is the engine's declaration", () => {
  it("every master-backed grid column has exactly one engine override rule, on its own stage", () => {
    const seen: string[] = [];
    // The Customer stage joined in PLAN.md §24 WP 14.2 (the row's demand spec).
    for (const stage of ["supplier", "plant", "customer"] as const) {
      for (const c of STAGE_TABLE_SPEC[stage].cols) {
        if (!c.master) continue;
        const rule = masterOverrideRule(c.family, c.field);
        expect(rule, `${stage}.${c.field} is master-backed and the engine declares no override for it`).toBeDefined();
        expect(rule!.master).toBe(`${c.master.table}.${c.master.field}`);
        expect(rule!.rows).toBe(stage);
        seen.push(rule!.key);
      }
    }
    expect(seen.sort()).toEqual(masterOverrideRules().map((r) => r.key).sort());
  });

  it("a value outside the declared domain is not one the engine uses", () => {
    expect(isUsableOverride(0, "positive")).toBe(false);
    expect(isUsableOverride(0, "nonnegative")).toBe(true);
    expect(isUsableOverride(1.2, "fraction")).toBe(false);
    expect(isUsableOverride("x", "nonnegative")).toBe(false);
    expect(isUsableOverride(-1, "nonnegative")).toBe(false);
  });
});

describe("resolution mirrors the mapper (`_supplier_row_values`, `_supplier_values`, `_composite_patches`)", () => {
  const cost = masterOverrideRule("sourcing", "material_cost")!;
  const cap = masterOverrideRule("sourcing", "capacity_per_week")!;
  const price = masterOverrideRule("production", "sell_price")!;

  it("a material's value: sorted key order, FIRST non-null wins", () => {
    const ov = [node("S3::M1", "sourcing", { material_cost: 11 }), node("S1::M1", "sourcing", { material_cost: 9 })];
    expect(entityOverride(ov, cost, "M1")).toMatchObject({ value: 9, targetKey: "S1::M1", usable: true });
    expect(entityOverride(ov, cost, "M2")).toBeUndefined();
  });

  it("a supplier's value is read off any of its rows, first wins", () => {
    const ov = [node("S1::M2", "sourcing", { capacity_per_week: 300 }), node("S1::M1", "sourcing", { capacity_per_week: 100 })];
    expect(entityOverride(ov, cap, "S1")?.value).toBe(100);
  });

  it("a product's value: composite beats bare, and the LAST composite wins", () => {
    const ov = [
      node("P1", "production", { sell_price: 5 }),
      node("Plant A::P1", "production", { sell_price: 7 }),
      node("Plant B::P1", "production", { sell_price: 8 }),
    ];
    expect(entityOverride(ov, price, "P1", new Set(["P1"]))?.value).toBe(8);
  });

  it("an unusable value is found and flagged, so the cell can say the run ignores it", () => {
    const r = entityOverride([node("S1::M1", "sourcing", { material_cost: 0 })], cost, "M1");
    expect(r).toMatchObject({ value: 0, usable: false });
  });
});

describe("§23 WP 13.1 exit test, grid half — a cost edited on /policies is an override", () => {
  it("the save is exactly the fixture's override rows: the edited row carries it, the sibling loses it", () => {
    const rule = masterOverrideRule("sourcing", FX.edit.field)!;
    const plan: SavePlan = new Map();
    planEntityOverride({
      plan,
      overrides: FX.saved_before,
      rule,
      editedKey: FX.edit.row_key,
      rowKeysOfEntity: FX.grid_rows.filter((r) => r.material_id === FX.edit.material_id).map((r) => r.key),
      value: FX.edit.value,
    });
    const { upserts, deletes } = settlePlan(plan, "node");
    expect(upserts).toEqual(FX.upserts_after_save);
    expect(deletes).toEqual([]);
  });

  it("the cell then shows the override, with the master underneath it untouched", () => {
    const rows = new Map<string, OverrideRow>();
    for (const r of [...FX.saved_before, ...FX.upserts_after_save]) rows.set(`${r.target_key}|${r.family}`, r);
    const after = [...rows.values()];
    const c = col("supplier", "material_cost");
    const masters = { materials: new Map([["M1", { material_id: "M1", cost: FX.engine_reads.master_cost }]]), products: new Map(), suppliers: new Map() };
    for (const key of ["S1::M1", "S3::M1"]) {
      const cell = resolveCell({
        rowKey: key,
        row: { key, supplier_id: key.split("::")[0], material_id: "M1" },
        col: c,
        families: ["sourcing"],
        masterColByField: new Map([[c.field, c]]),
        masterRowById: masters,
        derived: { materialCost: new Map(), sellPrice: new Map(), demandMean: new Map() },
        defaults: {} as PolicyBundle,
        overrides: after,
        scope: "node",
        familyDefault: () => undefined,
      });
      expect(cell.value, key).toBe(FX.engine_reads.cost);
      expect(cell.provenance, key).toBe("override");
      expect(cell.base).toBe(FX.engine_reads.master_cost);
      expect(cell.baseSource).toBe("master");
    }
    expect(masters.materials.get("M1")!.cost).toBe(FX.engine_reads.master_cost);
  });

  it("reset to master removes the key from every row of the entity, and an emptied row is deleted", () => {
    const rule = masterOverrideRule("sourcing", "material_cost")!;
    const plan: SavePlan = new Map();
    planEntityOverride({
      plan,
      overrides: [node("S1::M1", "sourcing", { material_cost: 12.5 }), node("S3::M1", "sourcing", { material_cost: 11, primary_source: true })],
      rule,
      editedKey: "S1::M1",
      rowKeysOfEntity: ["S1::M1", "S3::M1"],
      value: null,
    });
    const { upserts, deletes } = settlePlan(plan, "node");
    expect(upserts).toEqual([node("S3::M1", "sourcing", { primary_source: true })]);
    expect(deletes).toEqual([{ scope: "node", target_key: "S1::M1", family: "sourcing" }]);
  });
});

describe("§4 D281 — a save sends the FULL patch, never only the drafted fields", () => {
  it("planPatch starts from the saved patch, so one edited cell keeps the row's other saved values", () => {
    const plan: SavePlan = new Map();
    const saved = [node("S1::M1", "inventory", { type: "rop", rop_q_quantity: 40 })];
    planPatch(plan, saved, "node", "S1::M1", "inventory").holding_cost_pct = 0.3;
    expect(settlePlan(plan, "node").upserts).toEqual([
      node("S1::M1", "inventory", { type: "rop", rop_q_quantity: 40, holding_cost_pct: 0.3 }),
    ]);
  });
});
