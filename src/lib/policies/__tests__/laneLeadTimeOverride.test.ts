/**
 * The Supplier row's lead time is an OVERRIDE of its lane (owner request
 * 2026-10-03, PLAN.md §16 · *Supplier-row lead time*).
 *
 * The uploaded `inbound_logistics.lead_time` is what the cell suggests; a value
 * typed on the row is saved as `sourcing.lead_time_weeks` on
 * `node:<supplier>::<material>` and is what the engine reads for THAT link
 * (`project_map.py`'s arc loop, `test_project_map.py` for the engine half,
 * `pageEqualsRun.test.ts` for page = run over the shared fixture). These are the
 * grid-side facts the fixture cannot carry on its own: the key is per LANE, not
 * per material or supplier; a blank lane is the engine's 2 weeks; a typed value
 * is rounded as the engine rounds; the pre-run grader counts an override as set;
 * and an override moves the engine's cost-tie primary the way the mapper does.
 */
import { describe, expect, it } from "vitest";
import { STAGE_TABLE_SPEC, type ColSpec } from "../columnSpecs";
import { entityOverride, masterOverrideRule } from "../masterOverrides";
import { resolveCell, type MasterRowMaps } from "../resolveEffective";
import { supplierLaneMasters } from "../supplierLanes";
import type { OverrideRow } from "../resolve";
import { DEFAULT_BUNDLE, type PolicyFamily } from "../schemas";
import { familiesForStage } from "../columnSpecs";
import {
  enginePrimarySupplier,
  engineWholeWeeks,
  gradeManifest,
} from "../../../../supabase/functions/_shared/grading";
import registry from "../../../../supabase/functions/_shared/registry.generated.json";

type Row = Record<string, unknown>;

const inbound: Row[] = [
  { supplier_id: "S1", material_id: "M1", unit_price: 2, lead_time: 3, lead_time_unit: "week", volume: 10, time_unit: "week" },
  { supplier_id: "S2", material_id: "M1", unit_price: 2, lead_time: 4, lead_time_unit: "week", volume: 10, time_unit: "week" },
  { supplier_id: "S2", material_id: "M2", unit_price: 5, lead_time: null, volume: 10, time_unit: "week" },
];
const override = (target_key: string, lead_time_weeks: unknown): OverrideRow =>
  ({ scope: "node", target_key, family: "sourcing", patch: { lead_time_weeks } });

const col = STAGE_TABLE_SPEC.supplier.cols.find((c) => c.field === "lead_time_weeks") as ColSpec;
const masters: MasterRowMaps = {
  materials: new Map(),
  products: new Map(),
  suppliers: new Map(),
  inbound_logistics: supplierLaneMasters(inbound),
};
const cell = (supplier_id: string, material_id: string, overrides: OverrideRow[], draft?: unknown) =>
  resolveCell({
    rowKey: `${supplier_id}::${material_id}`,
    row: { key: `${supplier_id}::${material_id}`, supplier_id, material_id },
    col,
    draft,
    families: familiesForStage("supplier") as PolicyFamily[],
    masterColByField: new Map([[col.field, col]]),
    masterRowById: masters,
    derived: { materialCost: new Map(), sellPrice: new Map(), demandMean: new Map() },
    defaults: DEFAULT_BUNDLE,
    overrides,
    scope: "node",
    familyDefault: () => undefined,
  });

describe("the lead-time cell is an editable override of the lane", () => {
  it("is no longer read-only, and its rule is the engine's, per LANE", () => {
    expect(col.readOnly).toBeFalsy();
    const rule = masterOverrideRule("sourcing", "lead_time_weeks", "supplier")!;
    expect(rule).toMatchObject({ master: "inbound_logistics.lead_time", entity: "lane", emptyDefault: 2 });
    // One supplier's lane override never reaches another lane of the material
    // or another material of the supplier.
    const ovs = [override("S2::M1", 6)];
    expect(entityOverride(ovs, rule, "S2::M1")?.value).toBe(6);
    expect(entityOverride(ovs, rule, "S1::M1")).toBeUndefined();
    expect(entityOverride(ovs, rule, "S2::M2")).toBeUndefined();
  });

  it("shows the upload, the override, or the engine's 2 weeks — each with its source", () => {
    expect(cell("S1", "M1", [])).toMatchObject({ value: 3, provenance: "master" });
    expect(cell("S2", "M1", [override("S2::M1", 6)])).toMatchObject({ value: 6, provenance: "override", base: 4 });
    // A blank lane is the engine's default, not an average of the other lanes.
    expect(cell("S2", "M2", [])).toMatchObject({ value: 2, provenance: "default" });
    expect(cell("S2", "M2", [override("S2::M2", 9)])).toMatchObject({ value: 9, provenance: "override" });
    // An unusable override is ignored by the engine, so the cell shows the lane.
    expect(cell("S1", "M1", [override("S1::M1", 0)])).toMatchObject({ value: 3, provenance: "master" });
  });

  it("rounds a typed value at entry exactly as the mapper rounds it", () => {
    expect(col.round).toBe(engineWholeWeeks);
    expect([2.5, 3.5, 0.2, 80, 6].map(engineWholeWeeks)).toEqual([2, 4, 1, 51, 6]);
  });
});

describe("the rest of the platform reads the override too", () => {
  it("the pre-run grader counts an overridden blank lane as set", () => {
    const ds = { materials: [], products: [], suppliers: [], inbound, outbound: [], bom: [] };
    const lead = (overrides?: OverrideRow[]) =>
      gradeManifest({ ...ds, overrides } as never, {}, registry as never, {} as never)
        .find((g) => g.field === "inbound_logistics.lead_time")!;
    expect(lead().set).not.toContain("S2→M2");
    expect(lead([override("S2::M2", 3)]).set).toContain("S2→M2");
  });

  it("an override moves the engine's primary on a cost tie, as the mapper's primary_rank does", () => {
    // S1 and S2 tie on cost for M1; the shorter lead time wins.
    expect(enginePrimarySupplier(inbound).get("M1")).toBe("S1");
    expect(enginePrimarySupplier(inbound, new Map([["S2::M1", 1]])).get("M1")).toBe("S2");
  });
});
