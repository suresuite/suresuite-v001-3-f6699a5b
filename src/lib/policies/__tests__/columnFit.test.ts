import { describe, expect, it } from "vitest";
import { COL_W_MAX, COL_W_MIN, fitColumns, foldNote, type FitCol } from "../columnFit";

const col = (key: string, w: number, extra: Partial<FitCol> = {}): FitCol => ({
  key,
  family: "sourcing",
  label: key,
  sub: "",
  w,
  kind: "int",
  ...extra,
});

// Mirrors the real 14-column Supplier stage (columnSpecs.ts::STAGE_TABLE_SPEC.supplier).
const SUPPLIER: FitCol[] = [
  col("primary_source", 64, { kind: "toggle", keep: true }),
  col("supply_share", 74, { kind: "num", dec: 2, keep: true }),
  col("material_price", 84, { kind: "num", dec: 2, keep: true }),
  col("material_cost", 96, { prio: 8 }),
  col("material_moq", 84, { prio: 5 }),
  col("capacity_per_week", 96, { prio: 4 }),
  col("reliability_score", 84, { prio: 3 }),
  col("type", 152, { family: "inventory", kind: "type", keep: true }),
  col("__inv_params", 184, { family: "inventory", kind: "vector", keep: true }),
  col("initial_on_hand", 88, { family: "inventory", prio: 6 }),
  col("safety_stock_days", 76, { family: "inventory", keep: true }),
  col("holding_cost_pct", 72, { family: "inventory", prio: 7 }),
  col("mode", 76, { family: "transport", kind: "text", quiet: true, prio: 2 }),
  col("cost_per_km", 72, { family: "transport", kind: "num", dec: 2, quiet: true, prio: 1 }),
];

const fit = (avail: number, over: Partial<Parameters<typeof fitColumns>[0]> = {}) =>
  fitColumns({ cols: SUPPLIER, avail, collapsedFamilies: {}, enabled: true, narrow: false, ...over });

describe("fitColumns", () => {
  it("folds nothing when everything fits", () => {
    const r = fit(2000);
    expect(r.folded).toHaveLength(0);
    expect(r.visible).toHaveLength(14);
    expect(r.fills).toBe(true); // slack exists → last col absorbs it
  });

  it("folds in priority order, lowest first", () => {
    const r = fit(900);
    expect(r.folded.map((c) => c.key)).toEqual(
      ["cost_per_km", "mode", "reliability_score", "capacity_per_week", "material_moq"].slice(
        0,
        r.folded.length,
      ),
    );
  });

  it("never folds a keep column while a non-keep one remains", () => {
    const r = fit(700);
    const keepFolded = r.folded.filter((c) => c.wasKeep);
    const nonKeepLeft = r.visible.filter((c) => !c.keep);
    expect(keepFolded.length === 0 || nonKeepLeft.length === 0).toBe(true);
  });

  it("compacts type and params before folding a decision field", () => {
    const r = fit(560);
    expect(r.visible.find((c) => c.key === "type")?.w).toBe(74);
    expect(r.visible.find((c) => c.key === "type")?.compact).toBe(true);
    expect(r.visible.find((c) => c.key === "__inv_params")?.w).toBe(148);
    expect(r.visible.find((c) => c.key === "__inv_params")?.paramW).toBe(42);
  });

  it("always fits — no stage is unfittable by construction", () => {
    for (const avail of [220, 300, 420, 555, 700, 900, 1400]) {
      const r = fit(avail);
      const total = r.visible.reduce((s, c) => s + c.w, 0);
      expect(total <= avail || r.visible.length === 3).toBe(true);
    }
  });

  it("never folds the identity toggle", () => {
    const r = fit(220);
    expect(r.folded.some((c) => c.kind === "toggle")).toBe(false);
  });

  it("marks last-resort folds so the drawer can say so", () => {
    const r = fit(300);
    expect(r.folded.some((c) => c.wasKeep)).toBe(true);
  });

  it("a collapsed family becomes exactly one summary column", () => {
    const r = fitColumns({
      cols: SUPPLIER,
      avail: 2000,
      collapsedFamilies: { sourcing: true },
      enabled: true,
      narrow: false,
    });
    const summary = r.visible.filter((c) => c.key === "__fold_sourcing");
    expect(summary).toHaveLength(1);
    expect(summary[0].foldedFamily).toBe(7);
    expect(r.visible.some((c) => c.key === "material_price")).toBe(false);
    expect(r.visible.filter((c) => c.family === "inventory")).toHaveLength(5);
  });

  it("collapsing a family frees width and brings folded columns back", () => {
    const before = fit(555).visible.length;
    const after = fitColumns({
      cols: SUPPLIER,
      avail: 555,
      collapsedFamilies: { transport: true },
      enabled: true,
      narrow: false,
    }).visible.length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("disabled fit returns every column and never fills", () => {
    const r = fit(400, { enabled: false });
    expect(r.visible).toHaveLength(14);
    expect(r.folded).toHaveLength(0);
    expect(r.fills).toBe(false);
  });
});

describe("fitColumns · user-dragged widths", () => {
  it("renders a dragged width and marks the column user-sized", () => {
    const r = fit(2000, { widths: { material_cost: 150 } });
    const c = r.visible.find((v) => v.key === "material_cost");
    expect(c?.w).toBe(150);
    expect(c?.userSized).toBe(true);
    expect(r.valueWidth).toBe(SUPPLIER.reduce((s, v) => s + v.w, 0) - 96 + 150);
  });

  it("clamps a dragged width to the allowed range", () => {
    const r = fit(4000, { widths: { material_cost: 1, material_moq: 99999 } });
    expect(r.visible.find((v) => v.key === "material_cost")?.w).toBe(COL_W_MIN);
    expect(r.visible.find((v) => v.key === "material_moq")?.w).toBe(COL_W_MAX);
  });

  it("folds with the dragged width, and never folds the dragged column first", () => {
    const wide = fit(1100, { widths: { cost_per_km: 300 } });
    const plain = fit(1100);
    expect(wide.folded.length).toBeGreaterThan(plain.folded.length);
    expect(wide.visible.some((c) => c.key === "cost_per_km")).toBe(true);
  });

  it("never compacts a column the user sized", () => {
    const r = fit(700, { widths: { type: 200 } });
    const type = r.visible.find((c) => c.key === "type");
    expect(type?.compact).toBeUndefined();
    expect(type?.w).toBe(200);
    // an unsized control on the same tight box still compacts
    expect(r.visible.find((c) => c.key === "__inv_params")?.w).toBe(148);
  });

  it("a user-sized non-decision column folding last does not claim a decision field folded", () => {
    const r = fit(200, { widths: { cost_per_km: 400 } });
    const dropped = r.folded.find((c) => c.key === "cost_per_km");
    expect(dropped).toBeDefined();
    expect(dropped?.wasKeep).toBeUndefined();
  });
});

describe("foldNote", () => {
  it("says nothing extra when nothing was folded", () => {
    expect(foldNote([])).toBe("widen the window, collapse a family, or show all columns");
  });

  it("names the count past four and warns when a decision field folded", () => {
    const folded: FitCol[] = [
      col("a", 10),
      col("b", 10),
      col("c", 10),
      col("d", 10),
      col("e", 10, { wasKeep: true }),
    ];
    const note = foldNote(folded);
    expect(note).toContain("+1 more");
    expect(note).toContain("decision fields folded too");
  });
});
