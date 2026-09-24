// WP 0.1 — the silent policy override (D1) and the lying provenance dot (D16).
//
// Two rules are pinned here:
//   · the prefill persists only what the project data or the user said,
//   · a value the project data did not supply is `default`, never `data`.
//
// The third guard is structural: no hardcoded constant may be written onto a
// stage row for a field the column spec renders — that is what produced both
// defects, and a grep is the only thing that keeps it from coming back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrefillPersistable, resolveCell, rowHasSeedableField } from "../resolveEffective";
import { DEFAULT_BUNDLE, type PolicyFamily } from "../schemas";
import { STAGE_TABLE_SPEC, type ColSpec } from "../columnSpecs";
import type { OverrideRow } from "../resolve";

const emptyMasters = {
  materials: new Map<string, Record<string, unknown>>(),
  products: new Map<string, Record<string, unknown>>(),
  suppliers: new Map<string, Record<string, unknown>>(),
};
const emptyDerived = {
  materialCost: new Map<string, number>(),
  sellPrice: new Map<string, number>(),
  demandMean: new Map<string, number>(),
};

const supplierCol = (field: string): ColSpec => {
  const c = STAGE_TABLE_SPEC.supplier.cols.find((x) => x.field === field);
  if (!c) throw new Error(`no supplier column spec for ${field}`);
  return c;
};

const cell = (
  row: Record<string, unknown>,
  col: ColSpec,
  overrides: OverrideRow[] = [],
  draft?: unknown,
) =>
  resolveCell({
    rowKey: String(row.key),
    row,
    col,
    draft,
    families: ["sourcing", "inventory", "transport"] as PolicyFamily[],
    masterColByField: new Map(),
    masterRowById: emptyMasters,
    derived: emptyDerived,
    defaults: DEFAULT_BUNDLE,
    overrides,
    scope: "node",
    familyDefault: () => undefined,
  });

// A supplier row exactly as useStageRows builds it after WP 0.1: an uploaded
// price, a primary decided by the lane structure, and silence about everything
// else. No `safety_stock_days`.
const row = {
  key: "SUP-1::MAT-1",
  supplier_id: "SUP-1",
  material_id: "MAT-1",
  material_price: 12.5,
  primary_source: true,
  __from_data: { material_price: true, primary_source: true },
  __imputed: {},
};

describe("D1 — the prefill persists only what was actually said", () => {
  it("does not persist a field the project data is silent about", () => {
    expect(isPrefillPersistable(row, "safety_stock_days")).toBe(false);
    expect(isPrefillPersistable(row, "holding_cost_pct")).toBe(false);
    expect(isPrefillPersistable(row, "type")).toBe(false);
    expect(isPrefillPersistable(row, "supply_share")).toBe(false);
  });

  it("persists uploaded values and the data-decided routing fields", () => {
    expect(isPrefillPersistable(row, "material_price")).toBe(true);
    expect(isPrefillPersistable(row, "primary_source")).toBe(true);
  });

  it("persists an unsaved edit", () => {
    expect(isPrefillPersistable(row, "safety_stock_days", 14)).toBe(true);
  });

  it("never persists an imputed average, edited or not", () => {
    const imputedRow = { ...row, __from_data: {}, __imputed: { material_price: true } };
    expect(isPrefillPersistable(imputedRow, "material_price")).toBe(false);
    expect(isPrefillPersistable(imputedRow, "material_price", 9)).toBe(false);
  });

  it("leaves safety_stock_days resolving to the bundle's 7, not a persisted 0", () => {
    // project_map.py:783 defaults fixed_days_cover to 7.0; the bundle agrees.
    expect(DEFAULT_BUNDLE.inventory.safety_stock_days).toBe(7);
    expect(cell(row, supplierCol("safety_stock_days")).value).toBe(7);
  });
});

describe("D16 — the provenance dot tells the truth", () => {
  it("marks an untracked value as default, not data", () => {
    // The pre-WP-0.1 shape: a constant sitting on the row, unrecorded.
    const legacy = { ...row, safety_stock_days: 0, __from_data: { material_price: true } };
    expect(cell(legacy, supplierCol("safety_stock_days")).provenance).toBe("default");
  });

  it("marks a tracked value as data", () => {
    expect(cell(row, supplierCol("material_price")).provenance).toBe("data");
    expect(cell(row, supplierCol("primary_source")).provenance).toBe("data");
  });

  it("marks an imputed value as imputed", () => {
    const imputedRow = { ...row, __from_data: {}, __imputed: { material_price: true } };
    expect(cell(imputedRow, supplierCol("material_price")).provenance).toBe("imputed");
  });

  it("marks a saved override as override", () => {
    const bare = { ...row, __from_data: {} };
    const ovr: OverrideRow[] = [
      { scope: "node", target_key: bare.key, family: "inventory", patch: { safety_stock_days: 21 } },
    ];
    const r = cell(bare, supplierCol("safety_stock_days"), ovr);
    expect(r.provenance).toBe("override");
    expect(r.value).toBe(21);
  });

  it("marks an unsaved edit as edited", () => {
    expect(cell(row, supplierCol("material_price"), [], 3).provenance).toBe("edited");
  });
});

describe("G16 — the auto-seed trigger sees routing decisions", () => {
  // The customer stage's rows carry NO `__from_data` at all: every persistable
  // field there is a routing decision in `__decided` (§4 D23 moved them out).
  // The auto-seed used to gate on `__from_data` alone, so on that stage it
  // could never fire — the grid showed a suggested primary sourcing firm that
  // never reached the saved bundle, which is the only place the pre-run gate
  // reads, and verification blocked a pair the page displayed as resolved.
  it("a customer row whose only persistable fields are decided routing is seedable", () => {
    const customerRow = {
      key: "C001::P001",
      customer_id: "C001",
      product_id: "P001",
      sourcing_firm: "Test Plant",
      primary_source: true,
      __from_data: {},
      __imputed: {},
      __decided: { sourcing_firm: true, primary_source: true },
    };
    expect(rowHasSeedableField(customerRow)).toBe(true);
  });

  it("a row with nothing persistable is not seedable", () => {
    expect(rowHasSeedableField({ key: "k", __from_data: {}, __imputed: {}, __decided: {} })).toBe(false);
    expect(rowHasSeedableField({ key: "k" })).toBe(false);
  });

  it("derives from prefillSourceFor — an imputed field never makes a row seedable", () => {
    const imputedOnly = {
      key: "k",
      __from_data: { material_price: true },
      __imputed: { material_price: true },
    };
    expect(rowHasSeedableField(imputedOnly)).toBe(false);
  });
});

describe("D1/D16 structural guard — no constants on stage rows", () => {
  // The gap-check grep, mechanized: every `field: <literal>` assigned in
  // useStageRows' row object literals, checked against the fields the column
  // specs render. A constant there is invisible to the user, indistinguishable
  // from uploaded data, and gets frozen as an override by the prefill.
  const src = readFileSync(new URL("../../../hooks/useStageRows.tsx", import.meta.url), "utf8");

  const specFields = new Set<string>();
  for (const spec of Object.values(STAGE_TABLE_SPEC))
    for (const c of spec.cols) specFields.add(c.field);

  it("assigns no literal constant to a column-spec field", () => {
    // `field: 123`, `field: "x"`, `field: true`, `field: 1_000` — literals only;
    // an identifier or expression (a resolved/computed value) is fine.
    const literal = /^\s*([a-z_][a-z0-9_]*)\s*:\s*(?:-?[\d_]+(?:\.\d+)?|"[^"]*"|'[^']*'|true|false)\s*,/gim;
    const offenders: string[] = [];
    for (const m of src.matchAll(literal)) {
      if (specFields.has(m[1])) offenders.push(m[1]);
    }
    expect(offenders).toEqual([]);
  });
});
