// "What capacity will this run use, and is it real?" — the pre-dispatch split
// (§4 D167 / WP 9.3).
//
// The distinction this suite exists to hold is the one the /policies gate
// cannot make: a product with no capacity figure is NOT a finding, because the
// engine resolves it. What it resolves to is `twice_demand_floor_1000` — the
// step the engine chose so capacity can never bind — so a run dispatched that
// way answers "could we have made it" with a yes it assumed. Sorting that
// product into the same bucket as one whose capacity the plant grid supplies
// would put the panel back where the product was before this package.

import { describe, expect, it } from "vitest";
import { capacityReadiness, NON_BINDING_STEP } from "../capacityReadiness";
import type { ProductRow, SupplierRow } from "@/hooks/useItemMasters";
import type { PolicyBundle } from "@/lib/policies/schemas";

const product = (id: string, capacity: number | null): ProductRow =>
  ({
    product_id: id, name: id, sell_price: null, production_capacity: capacity,
    fulfillment_mode: null, demand_distribution: null, demand_mean: null,
    demand_cv: null, demand_min: null, demand_max: null,
  });

const supplier = (id: string, capacity: number | null): SupplierRow =>
  ({ supplier_id: id, name: id, capacity_per_week: capacity, reliability_score: 1 });

const withPolicy = { production: { capacity_units_per_day: 100, utilization_cap_pct: 90 } };
const noPolicy = { production: {} };

const read = (
  products: ProductRow[], suppliers: SupplierRow[], defaults: Record<string, unknown>,
) =>
  capacityReadiness({
    products, suppliers, outbound: [],
    defaults: defaults as unknown as PolicyBundle,
    overrides: [],
  });

describe("capacityReadiness", () => {
  it("separates a master capacity from one the plant grid supplies", () => {
    const r = read([product("P1", 5000), product("P2", null)], [], withPolicy);
    expect(r.fromMaster).toEqual(["P1"]);
    expect(r.fromPolicy).toEqual(["P2"]);
    expect(r.nonBinding).toEqual([]);
  });

  it("names the products the engine will give a NON-BINDING default", () => {
    const r = read([product("P1", null)], [], noPolicy);
    expect(r.nonBinding).toEqual(["P1"]);
    expect(r.fromPolicy).toEqual([]);
    // The step itself is the registry's identifier, not a threshold this file
    // decides — if the engine renames it, the panel must fail loudly rather
    // than quietly reclassify every product as "from the plant grid".
    expect(NON_BINDING_STEP).toBe("twice_demand_floor_1000");
  });

  it("treats a zero master capacity as no capacity, the way the engine does", () => {
    // `project_map.py` tests `p.production_capacity and > 0`, so a stored 0 is
    // not a capacity of zero — it falls through the chain.
    const r = read([product("P1", 0)], [], noPolicy);
    expect(r.fromMaster).toEqual([]);
    expect(r.nonBinding).toEqual(["P1"]);
  });

  it("splits suppliers by whether they declare a FINITE capacity", () => {
    const r = read([], [supplier("S1", 500), supplier("S2", null)], noPolicy);
    expect(r.finiteSuppliers).toEqual(["S1"]);
    // Not "missing" — `empty_means` declares the blank as unlimited, and the
    // panel says so rather than counting it as a gap.
    expect(r.unlimitedSuppliers).toEqual(["S2"]);
  });

  it("is empty-safe: a project with no masters reports nothing rather than throwing", () => {
    const r = read([], [], noPolicy);
    expect(r).toEqual({
      fromMaster: [], fromPolicy: [], nonBinding: [],
      finiteSuppliers: [], unlimitedSuppliers: [],
    });
  });
});
