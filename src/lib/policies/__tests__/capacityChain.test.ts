// The `products.production_capacity` chain is ONE rule with three readers, and
// the display layer was not one of them (§4 D165).
//
// `resolveEffective.ts::derivedValueFor` ended on
// `return undefined; // production_capacity has no logistics-derived fallback`
// — true of the LOGISTICS tables and false of the engine. `project_map.py` has
// always built a weekly capacity from the plant grid's units/day × 7 ×
// utilization, `base_data_requirements` has declared that chain
// machine-readably since the reducer library existed, and the shared grader has
// walked it. Only the grid could not see it, so the one plant cell the run was
// CERTAIN to put a number in was the one cell that showed nothing.
//
// This suite pins the display layer TO the grader — row for row, value for
// value — rather than to numbers typed here, which is what §4 D163 established
// is the only version of this test worth having.

import { describe, expect, it } from "vitest";
import registry from "../registry.generated.json";
import bridge from "../../../../supabase/functions/_shared/engineBridge.json";
import {
  gradeManifest,
  type BridgeTables,
  type GradingDataset,
  type RegistryPayload,
  type Row,
} from "../../../../supabase/functions/_shared/grading.ts";
import { derivedProductionCapacity, reducerLabel } from "../effectiveEconomics";
import { emptyMeansFor, policyBundleKeys, shadowedBy } from "../registryAccess";
import { isScsimVisible } from "../schemas";
import { STAGE_TABLE_SPEC } from "../columnSpecs";
import { resolveCell, substitutionNote, type DerivedMaps } from "../resolveEffective";
import type { PolicyBundle } from "../schemas";

const REG = registry as unknown as RegistryPayload;
const BRIDGE = bridge as unknown as BridgeTables;

const lane = (product: string, volume: number | null, timeUnit = "week"): Row => ({
  product_id: product, customer_id: "C1", unit_price: 5, volume, time_unit: timeUnit,
});

/** The grader's own resolution of products.production_capacity, same rows. */
function graderValues(
  products: Row[], outbound: Row[], defaults: Row, overrides: Row[] = [],
): Map<string, { value: number; via: string; grade: string }> {
  const dataset: GradingDataset = {
    materials: [], products, suppliers: [], inbound: [], outbound, bom: [], overrides,
  };
  const graded = gradeManifest(dataset, defaults, REG, BRIDGE)
    .find((g) => g.field === "products.production_capacity")!;
  return new Map(
    graded.resolved.map((r) => [r.id, { value: r.value!, via: r.via, grade: r.grade }]),
  );
}

describe("the products.production_capacity chain", () => {
  const products = [{ product_id: "P1", production_capacity: null, demand_mean: null }];

  it("derives the weekly capacity from the plant policy's daily line rate", () => {
    // 1 000/day × 7 × 85% — the engine's own arithmetic, in project_map.py.
    const defaults = { production: { capacity_units_per_day: 1000, utilization_cap_pct: 85 } };
    const got = derivedProductionCapacity(products, [], defaults)!.get("P1")!;
    expect(got.value).toBeCloseTo(5950, 10);
    expect(got.via).toBe("production_policy_capacity");
    expect(got.grade).toBe("info");
  });

  it("honours a per-product override the way the engine resolves it (§4 D75)", () => {
    const defaults = { production: { capacity_units_per_day: 1000, utilization_cap_pct: 85 } };
    const overrides = [{
      scope: "node", family: "production", target_key: "PlantA::P1",
      patch: { capacity_units_per_day: 200 },
    }];
    // The patch merges ONTO the default, so the 85% cap still applies: 200×7×0.85.
    const got = derivedProductionCapacity(products, [], defaults, overrides)!.get("P1")!;
    expect(got.value).toBeCloseTo(1190, 10);
  });

  it("falls to the engine's max(2·demand, 1000) floor when no policy sets one", () => {
    // 600/wk of demand ⇒ 1 200, which clears the 1 000 floor.
    const got = derivedProductionCapacity(products, [lane("P1", 600)], {})!.get("P1")!;
    expect(got.value).toBe(1200);
    expect(got.via).toBe("twice_demand_floor_1000");
    // `warn`, and that is the whole point of carrying the step: this number is
    // the engine declaring that capacity WILL NOT BIND, not a capacity.
    expect(got.grade).toBe("warn");
  });

  it("never leaves a product unresolved — the last step always answers", () => {
    // No policy, no demand: the floor is 1 000 and the cell must show it,
    // because the run certainly will use it.
    const got = derivedProductionCapacity(products, [], {})!.get("P1")!;
    expect(got.value).toBe(1000);
    expect(got.via).toBe("twice_demand_floor_1000");
  });

  it("resolves ROW FOR ROW what the shared grader resolves", () => {
    const defaults = { production: { capacity_units_per_day: 400, utilization_cap_pct: 90 } };
    const rows: Row[] = [
      { product_id: "P1", production_capacity: null, demand_mean: null },
      { product_id: "P2", production_capacity: null, demand_mean: 900 },
      { product_id: "P3", production_capacity: 7777, demand_mean: null },
    ];
    const outbound = [lane("P1", 100), lane("P2", 50)];
    const overrides = [{
      scope: "node", family: "production", target_key: "P2",
      patch: { capacity_units_per_day: 0 },
    }];
    const mine = derivedProductionCapacity(rows, outbound, defaults, overrides);
    const theirs = graderValues(rows, outbound, defaults, overrides);
    for (const [id, g] of theirs) {
      expect(mine.get(id)?.value, id).toBeCloseTo(g.value, 10);
      expect(mine.get(id)?.via, id).toBe(g.via);
      expect(mine.get(id)?.grade, id).toBe(g.grade);
    }
    // P3 has a master value, so the grader never resolved it and neither does
    // the display: a set master is not a fallback.
    expect(theirs.has("P3")).toBe(false);
  });

  it("still carries the ORDER the registry declares, not one written here", () => {
    const steps = REG.base_data_requirements
      .find((r) => r.field === "products.production_capacity")!.fallback_spec!;
    expect(steps.map((s) => s.reducer)).toEqual([
      "production_policy_capacity", "twice_demand_floor_1000",
    ]);
  });
});

describe("what the cell SAYS about a capacity it did not get from you", () => {
  const spec = STAGE_TABLE_SPEC.plant;
  const capacityCol = spec.cols.find((c) => c.field === "production_capacity")!;
  const lineCapCol = spec.cols.find((c) => c.field === "capacity_units_per_day")!;
  const masterColByField = new Map(spec.cols.filter((c) => c.master).map((c) => [c.field, c]));
  const row = { key: "PlantA::P1", item_id: "PlantA", product_id: "P1" };
  const defaults = {
    production: { capacity_units_per_day: 1000, utilization_cap_pct: 85 },
  } as unknown as PolicyBundle;

  const cellFor = (col: typeof capacityCol, master: Record<string, unknown>) =>
    resolveCell({
      rowKey: row.key,
      row,
      col,
      families: ["production", "inventory", "recovery"] as never,
      masterColByField,
      masterRowById: {
        materials: new Map(), suppliers: new Map(),
        products: new Map([["P1", master]]),
      },
      derived: {
        materialCost: new Map(), sellPrice: new Map(), demandMean: new Map(),
        productionCapacity: derivedProductionCapacity(
          [{ product_id: "P1", production_capacity: master.production_capacity ?? null }],
          [],
          defaults as unknown as Row,
        ),
      } as DerivedMaps,
      defaults,
      overrides: [],
      scope: "node",
      familyDefault: () => undefined,
    });

  it("names the step, not just the fact that a step answered", () => {
    const cell = cellFor(capacityCol, { product_id: "P1", production_capacity: null });
    expect(cell.provenance).toBe("derived");
    expect(cell.value).toBeCloseTo(5950, 10);
    expect(cell.derivedVia?.via).toBe("production_policy_capacity");
    expect(substitutionNote(cell)).toContain(reducerLabel("production_policy_capacity"));
  });

  it("says a non-binding default is the engine giving up, not a capacity", () => {
    const noPolicy = { production: {} } as unknown as PolicyBundle;
    const cell = resolveCell({
      rowKey: row.key, row, col: capacityCol,
      families: ["production"] as never,
      masterColByField,
      masterRowById: {
        materials: new Map(), suppliers: new Map(),
        products: new Map([["P1", { product_id: "P1", production_capacity: null }]]),
      },
      derived: {
        materialCost: new Map(), sellPrice: new Map(), demandMean: new Map(),
        productionCapacity: derivedProductionCapacity(
          [{ product_id: "P1", production_capacity: null }], [], {},
        ),
      } as DerivedMaps,
      defaults: noPolicy, overrides: [], scope: "node", familyDefault: () => undefined,
    });
    expect(cell.derivedVia?.grade).toBe("warn");
    expect(substitutionNote(cell)).toMatch(/never binds/);
  });

  it("marks the line-capacity cell the engine will NOT read", () => {
    // The master shadows the grid entry entirely — the engine warns about it and
    // the grid used to say nothing at all.
    const shadowed = cellFor(lineCapCol, { product_id: "P1", production_capacity: 4000 });
    expect(shadowed.supersededBy?.field).toBe("products.production_capacity");
    expect(substitutionNote(shadowed)).toMatch(/Not applied on this row/);

    // …and leaves it alone when the master is empty, because then it IS what
    // the run reads. A permanent warning would be the same lie in reverse.
    const live = cellFor(lineCapCol, { product_id: "P1", production_capacity: null });
    expect(live.supersededBy).toBeUndefined();
  });

  it("shadows `utilization_cap_pct` too — the two capacity cells go together", () => {
    const utilCol = spec.cols.find((c) => c.field === "utilization_cap_pct")!;
    const shadowed = cellFor(utilCol, { product_id: "P1", production_capacity: 4000 });
    expect(shadowed.supersededBy?.field).toBe("products.production_capacity");
  });
});

describe("the declarations the surfaces read", () => {
  it("reads `∞` for an empty supplier capacity from the ENGINE, not from the grid", () => {
    const declared = emptyMeansFor("suppliers.capacity_per_week");
    expect(declared?.token).toBe("∞");
    const col = STAGE_TABLE_SPEC.supplier.cols.find((c) => c.field === "capacity_per_week")!;
    expect(col.master?.nullMeans?.token).toBe(declared!.token);
    expect(col.master?.nullMeans?.title).toBe(declared!.meaning);
  });

  it("declares the shadow machine-readably, for both capacity keys", () => {
    expect(shadowedBy("capacity_units_per_day")).toBe("products.production_capacity");
    expect(shadowedBy("utilization_cap_pct")).toBe("products.production_capacity");
    // A key nothing shadows must answer undefined rather than a falsy string —
    // the grid tests truthiness.
    expect(shadowedBy("safety_stock_days")).toBeUndefined();
  });

  it("every declared bundle key is a field the grid says reaches the engine", () => {
    // `utilization_cap_pct` was READ by the mapper and absent from
    // `SCSIM_VISIBLE_FIELDS`, so the moment it got a column it would have
    // rendered with a `stored-only` badge — the grid telling a planner the
    // engine ignores the number it is about to multiply the capacity by.
    const unclaimed = policyBundleKeys()
      .filter((k) => !isScsimVisible(k.family as never, k.key))
      .map((k) => `${k.family}.${k.key}`);
    expect(
      unclaimed,
      "these keys are declared as reaching the engine and SCSIM_VISIBLE_FIELDS " +
        "does not list them, so the grid would badge them `stored-only` (§4 D165)",
    ).toEqual([]);
  });

  it("every reducer the registry names has a sentence a planner can read", () => {
    const named = new Set<string>();
    for (const r of REG.base_data_requirements) {
      for (const s of r.fallback_spec ?? []) if (s.reducer) named.add(s.reducer);
    }
    for (const p of REG.policies) {
      for (const r of p.data_requirements ?? []) {
        for (const s of r.fallback_spec ?? []) if (s.reducer) named.add(s.reducer);
      }
    }
    const raw = [...named].filter((r) => reducerLabel(r) === r);
    expect(
      raw,
      "these reducers would reach a screen as a bare snake_case token — give " +
        "them a `REDUCER_LABEL` entry (effectiveEconomics.ts)",
    ).toEqual([]);
  });
});
