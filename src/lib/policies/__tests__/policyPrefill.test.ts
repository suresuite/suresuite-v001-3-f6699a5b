/**
 * Regression tests for D1 (the silent policy override) and D16 (a provenance
 * dot claiming more than it knows) — docs/PLAN.md §4, closed by WP 0.1.
 *
 * The defect these pin down: `useStageRows` stamped constants no upload carried
 * onto every supplier row (`safety_stock_days: 0` among them). The grid showed
 * them with the green "From project data" dot, and the /policies auto-seed
 * persisted them as policy overrides — so the engine's own 7-day safety-stock
 * default could never apply to a project the user had merely opened.
 */
import { describe, expect, it } from "vitest";
import { isPrefillable, prefillSourceFor } from "../prefillSelect";
import { resolveCell, type DerivedMaps, type MasterRowMaps } from "../resolveEffective";
import { specFor } from "../columnSpecs";
import { DEFAULT_BUNDLE, type PolicyBundle, type PolicyFamily } from "../schemas";
import type { OverrideRow } from "../resolve";

const SUPPLIER_FAMILIES: PolicyFamily[] = ["sourcing", "inventory", "transport"];

/** A supplier row as `useStageRows` now emits it: an uploaded price, a routing
 *  decision derived from the uploaded volumes, and nothing else. */
const supplierRow = (over: Record<string, unknown> = {}) => ({
  key: "SUP-1::MAT-1",
  supplier_id: "SUP-1",
  material_id: "MAT-1",
  material_price: 12.5,
  primary_source: true,
  __from_data: { material_price: true } as Record<string, true>,
  __imputed: {} as Record<string, true>,
  __decided: { primary_source: true } as Record<string, true>,
  ...over,
});

const emptyMasters = (): MasterRowMaps => ({
  materials: new Map(),
  products: new Map(),
  suppliers: new Map(),
});
const emptyDerived = (): DerivedMaps => ({
  materialCost: new Map(),
  sellPrice: new Map(),
  demandMean: new Map(),
});

function cellFor(field: string, row: Record<string, unknown>, overrides: OverrideRow[] = [], draft?: unknown) {
  const col = specFor("supplier").cols.find((c) => c.field === field);
  if (!col) throw new Error(`no supplier column ${field}`);
  const defaults = DEFAULT_BUNDLE as PolicyBundle;
  return resolveCell({
    rowKey: String(row.key),
    row,
    col,
    draft,
    families: SUPPLIER_FAMILIES,
    masterColByField: new Map(),
    masterRowById: emptyMasters(),
    derived: emptyDerived(),
    defaults,
    overrides,
    scope: "node",
    familyDefault: (f, fam) => ((defaults[fam] ?? {}) as Record<string, unknown>)[f],
  });
}

describe("D1 — the prefill persists only what the row can source", () => {
  it("does NOT persist a field the upload never carried", () => {
    // The exact defect: `safety_stock_days` is not in `__from_data`, so the
    // auto-seed must write no override for it and the engine's default stands.
    expect(prefillSourceFor(supplierRow(), "safety_stock_days")).toBeNull();
    expect(isPrefillable(supplierRow(), "safety_stock_days")).toBe(false);
  });

  it("persists an uploaded value", () => {
    expect(prefillSourceFor(supplierRow(), "material_price")).toBe("data");
  });

  it("persists the stage's routing decision, so the pre-run gate still passes", () => {
    // G16: the gate requires a persisted primary supplier per material. The
    // decision is derived from uploaded volumes, so it survives the D1 fix.
    expect(prefillSourceFor(supplierRow(), "primary_source")).toBe("decision");
  });

  it("does NOT persist an imputed average, but DOES persist an edit of one", () => {
    const row = supplierRow({
      material_price: 9,
      __from_data: {},
      __imputed: { material_price: true },
    });
    expect(prefillSourceFor(row, "material_price")).toBeNull();
    expect(prefillSourceFor(row, "material_price", 11)).toBe("edit");
  });

  it("persists an unsaved edit of any field, sourced or not", () => {
    expect(prefillSourceFor(supplierRow(), "safety_stock_days", 14)).toBe("edit");
  });

  it("treats an explicit false/0/empty-string edit as an edit, not as absent", () => {
    expect(prefillSourceFor(supplierRow(), "primary_source", false)).toBe("edit");
    expect(prefillSourceFor(supplierRow(), "safety_stock_days", 0)).toBe("edit");
    expect(prefillSourceFor(supplierRow(), "basis", "")).toBe("edit");
  });

  it("tolerates a row with no provenance maps at all", () => {
    expect(prefillSourceFor({ key: "k" }, "safety_stock_days")).toBeNull();
  });
});

describe("D16 — the provenance dot claims no more than it knows", () => {
  it("shows an unuploaded field as `default`, not `data`", () => {
    const cell = cellFor("safety_stock_days", supplierRow());
    expect(cell.provenance).toBe("default");
  });

  it("resolves an unuploaded safety stock to the ENGINE's default, not to 0", () => {
    // project_map.py uses 7.0 when the policy omits it; the grid must agree,
    // or the user is looking at a number the simulation will not use.
    const cell = cellFor("safety_stock_days", supplierRow());
    expect(cell.value).toBe(7);
  });

  it("still shows an uploaded value as `data`", () => {
    expect(cellFor("material_price", supplierRow()).provenance).toBe("data");
    expect(cellFor("material_price", supplierRow()).value).toBe(12.5);
  });

  it("shows a derived routing choice as `suggested`, never as `data`", () => {
    expect(cellFor("primary_source", supplierRow()).provenance).toBe("suggested");
  });

  it("a saved override outranks the suggestion", () => {
    const cell = cellFor("primary_source", supplierRow(), [
      { scope: "node", target_key: "SUP-1::MAT-1", family: "sourcing", patch: { primary_source: true } },
    ]);
    expect(cell.provenance).toBe("override");
  });

  it("an unsaved edit outranks everything", () => {
    expect(cellFor("material_price", supplierRow(), [], 99).provenance).toBe("edited");
  });

  it("an imputed average keeps its own dot", () => {
    const row = supplierRow({ __from_data: {}, __imputed: { material_price: true } });
    expect(cellFor("material_price", row).provenance).toBe("imputed");
  });
});

describe("D1 — the three copies of the safety-stock default agree", () => {
  it("the grid's defaultWhenMissing equals the policy schema's default", () => {
    // The schema default mirrors project_map.py's 7.0. A grid default that
    // disagrees is a silent override waiting to be persisted.
    const schemaDefault = (DEFAULT_BUNDLE.inventory as Record<string, unknown>).safety_stock_days;
    expect(schemaDefault).toBe(7);
    for (const stage of ["supplier", "plant"] as const) {
      const col = specFor(stage).cols.find((c) => c.field === "safety_stock_days");
      expect(col?.defaultWhenMissing, `${stage} stage`).toBe(schemaDefault);
    }
  });
});
