/**
 * The engine's own primary-supplier rule, as the Supplier grid suggests it
 * (§4 D188). Each case mirrors a branch of project_map.py's supplier-link loop
 * and scsim `primary_rank`; `scsim/tests/test_project_map.py` holds the engine
 * side of the same cases.
 */
import { describe, expect, it } from "vitest";
import {
  enginePrimarySupplier,
  engineSupplierLinks,
} from "../../../../supabase/functions/_shared/grading";

const lane = (s: string, m: string, price: unknown, lt: unknown, extra: Record<string, unknown> = {}) => ({
  supplier_id: s, material_id: m, unit_price: price, lead_time: lt, ...extra,
});

describe("enginePrimarySupplier", () => {
  it("picks the CHEAPEST link, not the highest-volume one (D188's fixture)", () => {
    const rows = [
      lane("A", "M1", 10, 2, { volume: 100, time_unit: "week" }),
      lane("B", "M1", 5, 2, { volume: 10, time_unit: "week" }),
    ];
    expect(enginePrimarySupplier(rows).get("M1")).toBe("B");
  });

  it("a blank or non-positive price is 1.0, as the engine defaults it", () => {
    expect(enginePrimarySupplier([lane("A", "M", 2, 2), lane("B", "M", null, 2)]).get("M")).toBe("B");
    expect(enginePrimarySupplier([lane("A", "M", 0.5, 2), lane("B", "M", -3, 2)]).get("M")).toBe("A");
  });

  it("ties on cost break on lead time in weeks — converted by lead_time_unit", () => {
    const rows = [lane("A", "M", 3, 2, { lead_time_unit: "week" }), lane("B", "M", 3, 7, { lead_time_unit: "day" })];
    expect(enginePrimarySupplier(rows).get("M")).toBe("B"); // 7 days = 1 week
  });

  it("lead time rounds half-to-even, clamps to 1–51, and blank is 2 weeks", () => {
    const links = engineSupplierLinks([
      lane("A", "M", 1, 2.5), lane("B", "M", 1, 3.5), lane("C", "M", 1, 0.2),
      lane("D", "M", 1, 90), lane("E", "M", 1, null),
    ]);
    expect(links.get("A::M")?.leadWeeks).toBe(2);
    expect(links.get("B::M")?.leadWeeks).toBe(4);
    expect(links.get("C::M")?.leadWeeks).toBe(1);
    expect(links.get("D::M")?.leadWeeks).toBe(51);
    expect(links.get("E::M")?.leadWeeks).toBe(2);
  });

  it("then supplier id by code point (Python's order, not the locale's)", () => {
    expect(enginePrimarySupplier([lane("b", "M", 1, 2), lane("Z", "M", 1, 2)]).get("M")).toBe("Z");
  });

  it("duplicate rows of one pair reduce to their cheapest", () => {
    const rows = [lane("A", "M", 9, 2), lane("A", "M", 1, 2), lane("B", "M", 2, 2)];
    expect(engineSupplierLinks(rows).get("A::M")?.cost).toBe(1);
    expect(enginePrimarySupplier(rows).get("M")).toBe("A");
  });
});
