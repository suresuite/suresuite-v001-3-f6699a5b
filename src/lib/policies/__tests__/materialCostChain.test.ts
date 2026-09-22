// The `materials.cost` fallback chain is ONE rule with three readers (§4 D163).
//
// The engine walks it in `project_map.py`, the shared grader walks it from the
// registry's `fallback_spec`, and the display layer walks it again to answer
// "what number will the run use" beside an empty master cell. The engine half
// is pinned by scsim/tests/test_project_map.py and the grader half by
// supabase/functions/_shared/grading_test.ts; this suite pins the third — and,
// more importantly, pins the display layer TO the grader rather than to a
// value someone typed here.
//
// The previous display layer hard-coded `cheapestInboundCost` as *the*
// fallback. It was correct for as long as the engine had one data-derived
// step, and wrong the day it gained a second, with nothing to notice.

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
import { derivedMaterialCost } from "../effectiveEconomics";

const REG = registry as unknown as RegistryPayload;
const BRIDGE = bridge as unknown as BridgeTables;

const arc = (supplier: string, material: string, price: number | null, volume: number | null,
             timeUnit = "week"): Row => ({
  supplier_id: supplier, material_id: material, unit_price: price,
  lead_time: 2, time_unit: timeUnit, volume,
});

/** The grader's own resolution of materials.cost, for the same rows. */
function graderValues(inbound: Row[], materials: Row[]): Map<string, number> {
  const dataset: GradingDataset = {
    materials, products: [], suppliers: [], inbound, outbound: [], bom: [],
  };
  const graded = gradeManifest(dataset, {}, REG, BRIDGE)
    .find((g) => g.field === "materials.cost")!;
  return new Map(graded.resolved.map((r) => [r.id, r.value!]));
}

describe("the materials.cost chain", () => {
  const materials = [{ material_id: "M1", cost: null }];

  it("values a multi-sourced material at the volume-weighted lane price", () => {
    const inbound = [arc("S1", "M1", 10, 300), arc("S2", "M1", 6, 100)];
    // (10×300 + 6×100) / 400 — the cheapest quote is 6.
    expect(derivedMaterialCost(inbound).get("M1")).toBeCloseTo(9, 10);
  });

  it("normalizes each lane's volume to a weekly rate before weighting", () => {
    // 13.035/month is ≈2.9978/week (a month is 30.4375 days), against 1/week:
    // ≈(10×3 + 2×1) / 4 = 8. Taking the volumes raw would give 9.43, so the
    // two decimals here are far from the answer this test is excluding.
    const inbound = [arc("S1", "M1", 10, 13.035, "month"), arc("S2", "M1", 2, 1)];
    expect(derivedMaterialCost(inbound).get("M1")).toBeCloseTo(8, 2);
  });

  it("falls back to the cheapest quote when no lane carries a volume", () => {
    const inbound = [arc("S1", "M1", 10, null), arc("S2", "M1", 6, null)];
    expect(derivedMaterialCost(inbound).get("M1")).toBe(6);
  });

  it("gives a volume-less lane no weight rather than an epsilon one", () => {
    const inbound = [arc("S1", "M1", 10, 300), arc("S2", "M1", 6, 0)];
    expect(derivedMaterialCost(inbound).get("M1")).toBe(10);
  });

  it("floors a missing arc price at 1.0, as the engine does, before weighting", () => {
    const inbound = [arc("S1", "M1", null, 100), arc("S2", "M1", 3, 100)];
    expect(derivedMaterialCost(inbound).get("M1")).toBeCloseTo(2, 10);
  });

  it("leaves a material with no inbound lane to the terminal default", () => {
    // The neutral constant is the engine giving up, not a derived value: it
    // belongs to the run's warn finding, never to the "what will it use" map.
    expect(derivedMaterialCost([]).has("M1")).toBe(false);
  });

  it("resolves to exactly what the shared grader resolves, row for row", () => {
    // The gate that matters: two surfaces, one chain. A display that answers
    // differently from the grader is showing a number the run will not use.
    const inbound = [
      arc("S1", "M1", 10, 300), arc("S2", "M1", 6, 100),  // weighted
      arc("S1", "M2", 4, null), arc("S2", "M2", 7, null), // cheapest
      arc("S1", "M3", null, 50),                          // floored price
    ];
    const mats = [
      { material_id: "M1", cost: null },
      { material_id: "M2", cost: null },
      { material_id: "M3", cost: null },
      { material_id: "M4", cost: 12 }, // master set — no fallback at all
    ];
    const display = derivedMaterialCost(inbound);
    const grader = graderValues(inbound, mats);
    expect([...grader.keys()].sort()).toEqual(["M1", "M2", "M3"]);
    for (const [id, value] of grader) {
      expect(display.get(id), `${id} display vs grader`).toBeCloseTo(value, 10);
    }
    expect(display.has("M4")).toBe(false);
  });

  it("reads the chain's ORDER from the registry rather than restating it", () => {
    // If a step is added, reordered or renamed engine-side, the display layer
    // must follow by construction. The registry is the only place the order is
    // written; this asserts the snapshot still carries it.
    const spec = REG.base_data_requirements
      .find((r) => r.field === "materials.cost")!.fallback_spec!;
    expect(spec.map((s) => s.reducer)).toEqual([
      "volume_weighted_inbound_price", "cheapest_inbound_price", null,
    ]);
    expect(spec[2].constant).toBe(1);
  });
});
