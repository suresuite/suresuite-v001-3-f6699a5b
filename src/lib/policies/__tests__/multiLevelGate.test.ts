/**
 * §4 D182 — the Simulation Lab's pre-run gate grades a MULTI-level BOM the way
 * the engine flattens it.
 *
 * The page rewrote every `bom_multi_level` row as `product_id =
 * higher_level_component_id` before `compileGateFindings`, so the shared
 * grader's own flatten (`normalizeBomRows`, the port of the engine's
 * `_flatten_multi_level_bom`) never ran: a sub-assembly directly under the
 * product was reported as a purchased material with no supplier, and a real
 * purchased material two levels down was never checked. The shape below is
 * `Project AA - ver3`'s top in miniature — DB366 (S14A) ← WP1 ← DSC71N ← leaves —
 * with `Project 2`'s defect: one leaf with no inbound lane.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileGateFindings } from "../validationService";
import { DEFAULT_BUNDLE } from "../schemas";

const bom = [
  { material_id: "WP1", higher_level_component_id: "DB366 (S14A)", level: 0, consumption_rate: 1 },
  { material_id: "DSC71N", higher_level_component_id: "WP1", level: 1, consumption_rate: 1 },
  { material_id: "ASNA2050DCJ3208", higher_level_component_id: "DSC71N", level: 2, consumption_rate: 8 },
  { material_id: "E532.14775.000.00", higher_level_component_id: "DSC71N", level: 2, consumption_rate: 1 },
];
const input = {
  defaults: DEFAULT_BUNDLE,
  products: [{ product_id: "DB366 (S14A)" }],
  materials: [{ material_id: "ASNA2050DCJ3208" }, { material_id: "E532.14775.000.00" }],
  suppliers: [{ supplier_id: "S1" }],
  inbound: [{ supplier_id: "S1", material_id: "ASNA2050DCJ3208", unit_price: 1, lead_time: 2, volume: 10, time_unit: "week" }],
  outbound: [{ product_id: "DB366 (S14A)", customer_id: "AAMC", volume: 100, time_unit: "year", unit_price: 10 }],
  bom,
};

const unsourced = (findings: ReturnType<typeof compileGateFindings>): string[] => {
  const f = findings.find((x) => x.field === "materials.supplier_link") as { rows?: unknown[] } | undefined;
  return ((f?.rows ?? []) as unknown[]).map(String).sort();
};

describe("multi-level BOM through the pre-run gate (D182)", () => {
  it("raw rows: the leaf with no lane blocks, and no sub-assembly is called unsourced", () => {
    expect(unsourced(compileGateFindings(input))).toEqual(["E532.14775.000.00"]);
  });

  it("the old parent→product rewrite gets it backwards: a sub-assembly blocks, the real leaf is never checked", () => {
    const rewritten = bom.map((r) => ({ ...r, product_id: r.higher_level_component_id }));
    expect(unsourced(compileGateFindings({ ...input, bom: rewritten }))).toEqual(["WP1"]);
  });

  it("the Simulation Lab hands the gate the RAW BOM rows, as RunValidateStage does", () => {
    const src = readFileSync(resolve(__dirname, "../../../pages/SimulationLab.tsx"), "utf8");
    expect(src).toMatch(/bom: itemMasters\.lanes\.bom,/);
    expect(/product_id: r\.higher_level_component_id/.test(src), "the parent→product rewrite is back (§4 D182)").toBe(false);
  });
});
