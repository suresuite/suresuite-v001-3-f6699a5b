/**
 * The pre-run gate's demand-row findings — PLAN.md §24 WP 14.2. The vitest
 * mirror of `grading_test.ts`'s two WP 14.2 cases, run against the same shared
 * module the browser and the edge gate import, plus the gate wiring.
 */
import { describe, expect, it } from "vitest";
import { demandRowFindings, type Row } from "../../../../supabase/functions/_shared/grading";
import { gateDatasetFromSnapshot } from "../../../../supabase/functions/_shared/validationGate";

const outbound: Row[] = [
  { customer_id: "C1", product_id: "P1", demand_distribution: "normal", demand_mean: 40 },
  { customer_id: "C2", product_id: "P1", demand_distribution: "triangular", demand_mean: 10 },
  { customer_id: "C3", product_id: "P1" },
];

describe("demand per row — the pre-run gate", () => {
  it("blocks a distribution missing a parameter it needs", () => {
    const blocks = demandRowFindings(outbound).filter((f) => f.severity === "block");
    expect(blocks.flatMap((f) => f.rows).sort()).toEqual(["C1::P1", "C2::P1"]);
  });

  it("a Customer-row override completes the spec, as the engine reads it", () => {
    const f = demandRowFindings(outbound, [], [
      { scope: "node", target_key: "C1::P1", family: "demand", patch: { row_demand_variation: 0.2 } },
      { scope: "node", target_key: "C2::P1", family: "demand", patch: { row_demand_min: 5, row_demand_max: 20 } },
    ]);
    expect(f.filter((x) => x.severity === "block")).toEqual([]);
  });

  it("warns on a forecast shorter than the run and on a gap", () => {
    const forecasts: Row[] = [
      { customer_id: "C1", product_id: "P1", period_start: "2026-01-05", period_end: "2026-01-12", weekly_quantity: 50 },
      { customer_id: "C1", product_id: "P1", period_start: "2026-01-19", period_end: "2026-01-26", weekly_quantity: 50 },
    ];
    const f = demandRowFindings([{ customer_id: "C1", product_id: "P1", demand_distribution: "deterministic" }], forecasts, [], 52);
    expect(f.map((x) => x.severity)).toEqual(["warn", "warn"]);
    expect(f[0].rows).toEqual(["C1::P1 (3 of 52 wk)"]);
  });

  it("a frozen dataset version carries its forecast to the gate", () => {
    const ds = gateDatasetFromSnapshot(
      { inputs: { outbound: outbound, demand_forecasts: [{ customer_id: "C1", product_id: "P1" }] } },
      {},
    );
    expect(ds.demandForecasts).toHaveLength(1);
  });
});
