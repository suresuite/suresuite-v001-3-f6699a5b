/**
 * /policies IS THE ONE SURFACE FOR ITEM-MASTER ECONOMICS.
 *
 * The item-master editor on /project-manager ("Item master — simulation
 * economics") was retired once every field it wrote had a column on the policy
 * grid. Before that the grid rendered 8 of the editor's 19 fields, so retiring it
 * early would have left 11 engine inputs with no on-screen way to see or change
 * them — including a material's own holding rate, which the engine reads BEFORE
 * the grid's Holding policy cell, so a stored value would have outranked every
 * edit a planner made there with nothing on screen saying so.
 *
 * The four blocks below are the four ways that could come back:
 *   1. an engine-read item-master column with no grid column (the gate);
 *   2. a text or enum master value read as a number and lost;
 *   3. an empty master value shown as a `0` nobody entered;
 *   4. the Holding policy cell claiming to apply while the master outranks it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC, type ColSpec } from "../columnSpecs";
import { masterValueFor, resolveCell, type MasterRowMaps } from "../resolveEffective";
import { engineChainFor } from "../dataMap";
import { DEFAULT_BUNDLE, type PolicyBundle } from "../schemas";

const ROOT = join(__dirname, "..", "..", "..", "..");
const contract = JSON.parse(
  readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8"),
) as {
  tables: Record<string, { columns: { name: string; grain?: string; engine?: { consumed_by?: string } }[] }>;
};

const MASTERS = ["materials", "products", "suppliers"] as const;

const colsOf = (stage: keyof typeof STAGE_TABLE_SPEC) => STAGE_TABLE_SPEC[stage].cols as ColSpec[];
const byField = (stage: keyof typeof STAGE_TABLE_SPEC, field: string) =>
  colsOf(stage).find((c) => c.field === field)!;

const masters = (m: Partial<Record<(typeof MASTERS)[number], [string, Record<string, unknown>][]>>) =>
  ({
    materials: new Map(m.materials ?? []),
    products: new Map(m.products ?? []),
    suppliers: new Map(m.suppliers ?? []),
  }) as MasterRowMaps;

function resolve(stage: keyof typeof STAGE_TABLE_SPEC, col: ColSpec, row: Record<string, unknown>, rows: MasterRowMaps) {
  const masterColByField = new Map(colsOf(stage).filter((c) => c.master).map((c) => [c.field, c]));
  return resolveCell({
    rowKey: "S1::M1",
    row,
    col,
    draft: undefined,
    families: [col.family],
    masterColByField,
    masterRowById: rows,
    derived: { materialCost: new Map(), sellPrice: new Map(), demandMean: new Map() },
    defaults: DEFAULT_BUNDLE as PolicyBundle,
    overrides: [],
    scope: "node",
    familyDefault: () => undefined,
  });
}

describe("every engine-read item-master column has a /policies column", () => {
  it("no item-master field the engine reads is left without a grid column", () => {
    // Identifiers are the row's key, not an economic; everything else the engine
    // consumes must be editable on the grid, because the grid is the only
    // on-screen surface left (the CSV item-master upload is the bulk path).
    const rendered = new Set(
      Object.values(STAGE_TABLE_SPEC).flatMap((s) =>
        (s.cols as ColSpec[]).filter((c) => c.master).map((c) => `${c.master!.table}.${c.master!.field}`),
      ),
    );
    const missing: string[] = [];
    for (const t of MASTERS) {
      for (const c of contract.tables[t].columns) {
        if (!c.engine?.consumed_by || c.grain === "identifier") continue;
        if (!rendered.has(`${t}.${c.name}`)) missing.push(`${t}.${c.name}`);
      }
    }
    expect(
      missing,
      "the engine reads these item-master columns and /policies renders no column " +
        "for them — with the item-master editor retired, nobody can see or change " +
        "them on screen. Add a `master:` column to the stage the entity belongs to.",
    ).toEqual([]);
  });

  it("every master pointer names a real column (the gate above cannot be satisfied by a typo)", () => {
    for (const s of Object.values(STAGE_TABLE_SPEC)) {
      for (const c of (s.cols as ColSpec[]).filter((x) => x.master)) {
        const names = contract.tables[c.master!.table].columns.map((x) => x.name);
        expect(names, `${c.field} → ${c.master!.table}.${c.master!.field}`).toContain(c.master!.field);
      }
    }
  });
});

describe("text and enum master values are read as themselves", () => {
  it("a lead-time distribution survives the read (it used to become NaN, then nothing)", () => {
    const col = byField("supplier", "material_lead_time_dist");
    const rows = masters({ materials: [["M1", { lead_time_dist: "lognormal" }]] });
    expect(masterValueFor(col, { material_id: "M1" }, rows)).toBe("lognormal");
    expect(resolve("supplier", col, { material_id: "M1" }, rows).provenance).toBe("master");
  });

  it("a name is read as text, and a blank one is unset", () => {
    const col = byField("supplier", "material_name");
    expect(masterValueFor(col, { material_id: "M1" }, masters({ materials: [["M1", { name: "Steel" }]] }))).toBe("Steel");
    expect(masterValueFor(col, { material_id: "M1" }, masters({ materials: [["M1", { name: "  " }]] }))).toBeUndefined();
  });

  it("every enum column offers only choices, and a default choice is never one of them", () => {
    for (const s of Object.values(STAGE_TABLE_SPEC)) {
      for (const c of (s.cols as ColSpec[]).filter((x) => x.master?.valueKind === "enum")) {
        expect(c.master!.options?.length ?? 0, c.field).toBeGreaterThan(1);
        expect(c.master!.options!.map((o) => o.value), c.field).not.toContain("__unset__");
      }
    }
  });
});

describe("an empty item-master value is not a zero", () => {
  it("an unset demand CV shows no number, and says what the engine does instead", () => {
    const col = byField("plant", "product_demand_cv");
    const r = resolve("plant", col, { product_id: "P1" }, masters({ products: [["P1", { demand_cv: null }]] }));
    expect(r.value, "an empty demand CV rendered as a number nobody entered").toBeUndefined();
    expect(r.placeholderTitle).toContain(engineChainFor("products", "demand_cv")!);
  });

  it("every kinded master column has a Data Map chain to explain its blank", () => {
    for (const s of Object.values(STAGE_TABLE_SPEC)) {
      for (const c of (s.cols as ColSpec[]).filter((x) => x.master?.valueKind)) {
        expect(engineChainFor(c.master!.table, c.master!.field), `${c.master!.table}.${c.master!.field}`).toBeTruthy();
      }
    }
  });
});

describe("the Holding policy cell says when the material's own rate outranks it", () => {
  const holding = byField("supplier", "holding_cost_pct");
  const row = { supplier_id: "S1", material_id: "M1" };

  it("superseded when the material master sets a holding rate", () => {
    const r = resolve("supplier", holding, row, masters({ materials: [["M1", { holding_cost_pct: 0.3 }]] }));
    expect(r.supersededBy?.field).toBe("materials.holding_cost_pct");
    expect(r.supersededBy?.note).toMatch(/Not applied on this row/);
  });

  it("applies when the material master leaves it empty", () => {
    const r = resolve("supplier", holding, row, masters({ materials: [["M1", { holding_cost_pct: null }]] }));
    expect(r.supersededBy).toBeUndefined();
  });

  it("the plant stage's Holding cell is never shadowed by a MATERIAL's rate", () => {
    // Plant rows are products; there is no materials column on that stage to
    // outrank it, and the lookup must stay silent rather than guess.
    const plantHolding = byField("plant", "holding_cost_pct");
    const r = resolve("plant", plantHolding, { item_id: "F", product_id: "M1" },
      masters({ materials: [["M1", { holding_cost_pct: 0.3 }]] }));
    expect(r.supersededBy).toBeUndefined();
  });
});
