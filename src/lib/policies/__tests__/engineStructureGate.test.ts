/**
 * §4 D174 — the pre-run gate says "the engine will refuse this" BEFORE the
 * dispatch, for both of the engine's structural hard failures.
 *
 * The acceptance audit (2026-09-23) dispatched two projects the gate had
 * passed and watched the engine kill both runs with a raw
 * `pydantic.ValidationError` stored as the run's error message:
 * `materials with no qualified supplier: ['M4']` (a master material with no
 * inbound lane, which the existing BOM-scoped sweep could not see) and
 * `products with empty BoM: ['SA1']` (a sub-assembly in the products master).
 * The first is now a block finding over ALL master materials; the second is a
 * block over finished products only — a product CONSUMED by another product
 * is a sub-assembly, which the mapper models through the BOM (its exclusion
 * is `from_project_data`'s, warned there), so it is exempt here.
 */
import { describe, expect, it } from "vitest";
import {
  flattenFindings,
  gradeManifest,
  type GradingDataset,
  type RegistryPayload,
  type BridgeTables,
} from "../../../../supabase/functions/_shared/grading";
import registry from "../../../../supabase/functions/_shared/registry.generated.json";
import bridge from "../../../../supabase/functions/_shared/engineBridge.json";

const reg = registry as unknown as RegistryPayload;
const br = bridge as unknown as BridgeTables;

function blocks(dataset: GradingDataset) {
  return flattenFindings(gradeManifest(dataset, {}, reg, br)).filter(
    (f) => f.severity === "block",
  );
}

const base: GradingDataset = {
  materials: [{ material_id: "RAW", cost: 2, holding_cost_pct: 0.2 }],
  products: [{ product_id: "FP", sell_price: 10, demand_mean: 5, production_capacity: 50 }],
  suppliers: [{ supplier_id: "SUP", capacity_per_week: 100 }],
  inbound: [{ supplier_id: "SUP", material_id: "RAW", unit_price: 2, lead_time: 1, volume: 10, time_unit: "week" }],
  outbound: [{ product_id: "FP", customer_id: "C", unit_price: 10, volume: 5, time_unit: "week" }],
  bom: [{ material_id: "RAW", higher_level_component_id: "FP", consumption_rate: 1 }],
  overrides: [],
};

describe("engine structural hard failures reach the gate (D174)", () => {
  it("a well-formed project produces no structural block", () => {
    expect(blocks(base).map((f) => f.field)).toEqual([]);
  });

  it("a master material with no inbound lane blocks, named", () => {
    const d = { ...base, materials: [...base.materials, { material_id: "ORPHAN" }] };
    const hit = blocks(d).find((f) => f.field === "materials.supplier_link");
    expect(hit?.rows).toEqual(["ORPHAN"]);
    expect(hit?.message).toMatch(/no inbound lane/);
  });

  it("a finished product with no BOM blocks, named", () => {
    const d = { ...base, products: [...base.products, { product_id: "GHOST", demand_mean: 1 }] };
    const hit = blocks(d).find((f) => f.field === "products.bom");
    expect(hit?.rows).toEqual(["GHOST"]);
  });

  it("a sub-assembly (a product consumed by another product) is exempt from the empty-BOM block", () => {
    const d = {
      ...base,
      products: [...base.products, { product_id: "SUB" }],
      bom: [
        { material_id: "SUB", higher_level_component_id: "FP", consumption_rate: 1 },
        { material_id: "RAW", higher_level_component_id: "SUB", consumption_rate: 2 },
      ],
    };
    expect(blocks(d).filter((f) => f.field === "products.bom")).toEqual([]);
  });

  it("a D171 root row (product as its own parentless level-0 row) is not read as consumption", () => {
    const d = {
      ...base,
      // the poisoned upload shape: the finished product itself at level 0 with
      // a blank parent — must NOT make FP count as "consumed" (a sub-assembly),
      // or a BOM-less FP would slip past the empty-BOM block.
      products: [{ product_id: "FP", sell_price: 10, demand_mean: 5 }],
      bom: [{ material_id: "FP", higher_level_component_id: null, level: 0, consumption_rate: 1 }],
    };
    const hit = blocks(d).find((f) => f.field === "products.bom");
    expect(hit?.rows).toEqual(["FP"]);
  });
});
