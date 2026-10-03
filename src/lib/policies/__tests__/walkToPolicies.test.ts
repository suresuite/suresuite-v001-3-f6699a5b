/**
 * The run check sends a user to where a value is SET: /policies for every field
 * the page has a cell for (the item masters are the base layer, §8.3; a value
 * set on /policies is the one the run uses, §4 D204), the Project Manager for
 * the rest. Derived from the column spec, so a new master-backed column is
 * linked without a second list to update.
 */
import { describe, expect, it } from "vitest";
import { findingFieldLabel, policiesCellFor, STAGE_TABLE_SPEC } from "../columnSpecs";
import { fieldWalkToRoute } from "../dataMap";
import { compileRequiredDataFindings } from "../validationService";
import { DEFAULT_BUNDLE } from "../schemas";

describe("walk-to: /policies first", () => {
  it("every master-backed column is reachable from its dataset field", () => {
    for (const stage of ["supplier", "plant", "customer"] as const) {
      for (const c of STAGE_TABLE_SPEC[stage].cols) {
        if (!c.master) continue;
        expect(policiesCellFor(`${c.master.table}.${c.master.field}`)).toEqual({ stage, field: c.field });
        expect(fieldWalkToRoute(`${c.master.table}.${c.master.field}`, "p")).toBe(`/policies?stage=${stage}`);
      }
    }
  });

  it("the run check's own examples land on /policies", () => {
    expect(fieldWalkToRoute("materials.cost", "p")).toBe("/policies?stage=supplier");
    expect(fieldWalkToRoute("materials.moq", "p")).toBe("/policies?stage=supplier");
    expect(fieldWalkToRoute("materials.holding_cost_pct", "p")).toBe("/policies?stage=supplier");
    expect(fieldWalkToRoute("suppliers.capacity_per_week", "p")).toBe("/policies?stage=supplier");
    // Demand is authored on the Customer rows (§4 D286).
    expect(fieldWalkToRoute("products.demand_cv", "p")).toBe("/policies?stage=customer");
    expect(fieldWalkToRoute("products.demand_mean", "p")).toBe("/policies?stage=customer");
  });

  it("a field with no /policies cell still goes to the Project Manager", () => {
    expect(fieldWalkToRoute("inbound_logistics.unit_price", "p")).toBe("/project-manager?project=p");
    expect(fieldWalkToRoute("materials.supplier_link", "p")).toBe("/project-manager?project=p");
  });

  it("findings name the /policies column, not the table", () => {
    expect(findingFieldLabel("materials.holding_cost_pct")).toBe("Holding · Supplier stage");
    expect(findingFieldLabel("products.demand_cv")).toBe("Variation · Customer stage");
    expect(findingFieldLabel("inbound_logistics.unit_price")).toBe("inbound_logistics.unit_price");
  });
});

describe("the grader reads /policies before the master (§4 D204)", () => {
  const base = {
    defaults: DEFAULT_BUNDLE,
    materials: [{ material_id: "M1", cost: 2 }, { material_id: "M2", cost: 3 }],
    products: [{ product_id: "P1", sell_price: 10, demand_mean: 5, production_capacity: 50 }],
    suppliers: [{ supplier_id: "S1" }],
    inbound: [
      { supplier_id: "S1", material_id: "M1", unit_price: 2, lead_time: 1, volume: 1, time_unit: "week" },
      { supplier_id: "S1", material_id: "M2", unit_price: 3, lead_time: 1, volume: 1, time_unit: "week" },
    ],
    outbound: [{ product_id: "P1", customer_id: "C1", unit_price: 10, volume: 5, time_unit: "week" }],
    bom: [{ product_id: "P1", material_id: "M1", consumption_rate: 1 }, { product_id: "P1", material_id: "M2", consumption_rate: 1 }],
  };
  const holding = (overrides?: Record<string, unknown>[]) =>
    compileRequiredDataFindings({ ...base, overrides }).find((f) => f.field === "materials.holding_cost_pct");

  it("a Holding % set on a Supplier-stage row counts as set", () => {
    expect(holding()?.message).toMatch(/empty for 2 row/);
    const one = [{ scope: "node", target_key: "S1::M1", family: "inventory", patch: { holding_cost_pct: 0.25 } }];
    expect(holding(one)?.message).toMatch(/empty for 1 row/);
    const both = [...one, { scope: "node", target_key: "S1::M2", family: "inventory", patch: { holding_cost_pct: 0.3 } }];
    expect(holding(both)).toBeUndefined();
  });

  it("a null in the patch is no value, as the engine reads it", () => {
    const nul = [{ scope: "node", target_key: "S1::M1", family: "inventory", patch: { holding_cost_pct: null } }];
    expect(holding(nul)?.message).toMatch(/empty for 2 row/);
  });
});
