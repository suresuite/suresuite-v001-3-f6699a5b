/**
 * A Supplier row's lead-time SHAPE, chosen like demand — PLAN.md §25 WP 15.3,
 * §4 D291, blueprint P-S.6.
 *
 * The page-equals-run fixture proves value AND source for every lane cell. These
 * are the grid-side facts it cannot carry: which parameter cells a row SHOWS for
 * each shape (`leadTimeParamFor`, one helper — `single-source`), that a bounded
 * row's Lead time is its bounds' mean and is not an input, that a shape typed on
 * the row (a draft) moves those gates before it is saved, and that the TS mirror
 * of the link build plans a bounded lane on its mean, as the engine does.
 */
import { describe, expect, it } from "vitest";
import { STAGE_TABLE_SPEC, visibleColsForRow, type ColSpec } from "../columnSpecs";
import { resolveCell, rowGateCtx, rowBoundedLeadTime, type MasterRowMaps, type DerivedMaps } from "../resolveEffective";
import { laneSpreadFromMaterials, supplierLaneMasters } from "../supplierLanes";
import type { OverrideRow } from "../resolve";
import { DEFAULT_BUNDLE, type PolicyFamily } from "../schemas";
import { familiesForStage } from "../columnSpecs";
import { engineSupplierLinks } from "../../../../supabase/functions/_shared/grading";

type Row = Record<string, unknown>;

const inbound: Row[] = [
  { supplier_id: "S1", material_id: "M1", unit_price: 2, lead_time: 3, lead_time_unit: "week" },
  { supplier_id: "S2", material_id: "M1", unit_price: 3, lead_time: 28, lead_time_unit: "day",
    lead_time_dist: "triangular", lead_time_min: 14, lead_time_mode: 21, lead_time_max: 49 },
  { supplier_id: "S3", material_id: "M2", unit_price: 4, lead_time: 2, lead_time_unit: "week" },
];
const materials: Row[] = [{ material_id: "M2", lead_time_dist: "lognormal", lead_time_cv: 1.4 }];

const spec = STAGE_TABLE_SPEC.supplier;
const masterCols = spec.cols.filter((c) => c.master);
const masterColByField = new Map<string, ColSpec>(masterCols.map((c) => [c.field, c]));
const masters: MasterRowMaps = {
  materials: new Map(materials.map((m) => [String(m.material_id), m])),
  products: new Map(),
  suppliers: new Map(),
  inbound_logistics: supplierLaneMasters(inbound),
};
const derived: DerivedMaps = {
  materialCost: new Map(), sellPrice: new Map(), demandMean: new Map(),
  laneSpread: laneSpreadFromMaterials(inbound, materials),
};
const families = familiesForStage("supplier") as PolicyFamily[];
const rowOf = (s: string, m: string) => ({ key: `${s}::${m}`, supplier_id: s, material_id: m });
const gate = (s: string, m: string, overrides: OverrideRow[] = [], draft?: Row) =>
  rowGateCtx({
    rowKey: `${s}::${m}`, row: rowOf(s, m), draft, projectFulfillmentMode: "mto", families,
    masterColByField, masterRowById: masters, derived, defaults: DEFAULT_BUNDLE, overrides, scope: "node",
  });
const shapeCols = (s: string, m: string, overrides: OverrideRow[] = [], draft?: Row) =>
  visibleColsForRow("supplier", gate(s, m, overrides, draft))
    .map((c) => c.field)
    .filter((f) => f.startsWith("lane_lead_time_"));
const sourcing = (target_key: string, patch: Row): OverrideRow =>
  ({ scope: "node", target_key, family: "sourcing", patch });

describe("§25 WP 15.3 — the parameters follow the shape", () => {
  it("a triangular row shows min, mode and max and nothing else", () => {
    expect(shapeCols("S2", "M1")).toEqual([
      "lane_lead_time_dist", "lane_lead_time_min_weeks", "lane_lead_time_mode_weeks", "lane_lead_time_max_weeks",
    ]);
  });

  it("a deterministic row shows only the shape", () => {
    expect(shapeCols("S1", "M1")).toEqual(["lane_lead_time_dist"]);
  });

  it("a uniform row shows min and max; a normal row shows the CV", () => {
    expect(shapeCols("S1", "M1", [sourcing("S1::M1", { lane_lead_time_dist: "uniform" })]))
      .toEqual(["lane_lead_time_dist", "lane_lead_time_min_weeks", "lane_lead_time_max_weeks"]);
    expect(shapeCols("S1", "M1", [], { lane_lead_time_dist: "normal" }))
      .toEqual(["lane_lead_time_dist", "lane_lead_time_cv"]);
  });

  it("a lane with no shape of its own follows its material's, shown as derived", () => {
    expect(shapeCols("S3", "M2")).toEqual(["lane_lead_time_dist", "lane_lead_time_cv"]);
    const cvCol = masterColByField.get("lane_lead_time_cv")!;
    const cell = resolveCell({
      rowKey: "S3::M2", row: rowOf("S3", "M2"), col: cvCol, families, masterColByField,
      masterRowById: masters, derived, defaults: DEFAULT_BUNDLE, overrides: [], scope: "node",
      familyDefault: () => undefined,
    });
    // The material says 1.4; the engine bounds a CV at 1 and uses 1 (§4 D294).
    expect(cell.value).toBe(1);
    expect(cell.provenance).toBe("derived");
  });
});

describe("§25.2 rule 3 — a bounded row plans on its bounds' mean", () => {
  const ltCol = masterColByField.get("lead_time_weeks")!;
  const ltCell = (s: string, m: string, overrides: OverrideRow[] = [], draft?: Row) =>
    resolveCell({
      rowKey: `${s}::${m}`, row: rowOf(s, m), col: ltCol, families, masterColByField,
      masterRowById: masters, derived, defaults: DEFAULT_BUNDLE, overrides, scope: "node",
      familyDefault: () => undefined, gate: gate(s, m, overrides, draft),
    });

  it("the uploaded triangular lane (14 / 21 / 49 days) plans on 4 weeks, derived", () => {
    const c = ltCell("S2", "M1");
    expect(c.value).toBe(4);
    expect(c.provenance).toBe("derived");
    expect(c.derivedVia?.via).toBe("lead_time_bounds_mean");
  });

  it("a row lead time is not read on a bounded row", () => {
    expect(ltCell("S2", "M1", [sourcing("S2::M1", { lead_time_weeks: 9 })]).value).toBe(4);
  });

  it("typing a uniform shape and bounds on a row moves the cell before the save", () => {
    const draft = { lane_lead_time_dist: "uniform", lane_lead_time_min_weeks: 2, lane_lead_time_max_weeks: 7 };
    expect(rowBoundedLeadTime(gate("S1", "M1", [], draft))).toBe(4); // (2 + 7) / 2 = 4.5 → 4, half to even
    expect(ltCell("S1", "M1", [], draft).value).toBe(4);
  });

  it("incomplete or disordered bounds are not a bounded row (the engine runs it deterministic)", () => {
    expect(rowBoundedLeadTime(gate("S1", "M1", [], { lane_lead_time_dist: "triangular", lane_lead_time_min_weeks: 2 }))).toBeUndefined();
    expect(rowBoundedLeadTime(gate("S1", "M1", [], { lane_lead_time_dist: "uniform", lane_lead_time_min_weeks: 8, lane_lead_time_max_weeks: 2 }))).toBeUndefined();
  });

  it("the TS link build plans the uploaded bounded lane on its mean, as the mapper does", () => {
    const link = engineSupplierLinks(inbound).get("S2::M1")!;
    expect(link.leadWeeks).toBe(4);
    expect(link.leadSource).toBe("derived");
    expect(link.spread).toEqual({ dist: "triangular", cv: null, min: 2, mode: 3, max: 7 });
  });
});
