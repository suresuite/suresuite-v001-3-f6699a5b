/**
 * The Customer grid's demand cells follow what the engine reads (scsim
 * `core/context.py` row centre) — PLAN.md §24 WP 14.8, owner review:
 * - the mode is the one the run uses: `forecast` only when the row has an
 *   uploaded series, never the first option of an empty cell;
 * - each parameter shows only under a distribution that reads it;
 * - every Customer master cell reaches the engine (§4 D287: they were all
 *   badged "not simulated" because the badge asked the Supplier rows);
 * - the project line is the allocation rule only, and only with 2+ customers.
 */
import { describe, expect, it } from "vitest";
import { STAGE_TABLE_SPEC, rowDemandMode, type ColSpecCtx } from "../columnSpecs";
import { cellEngineRead } from "../cellEngineRead";
import { customerRuleFields } from "../projectRules";

const cols = STAGE_TABLE_SPEC.customer.cols;
const visible = (field: string, resolved: Record<string, unknown>) => {
  const c = cols.find((x) => x.field === field)!;
  return !c.visibleWhen || c.visibleWhen({ resolved } as ColSpecCtx);
};
const shown = (resolved: Record<string, unknown>) =>
  ["row_forecast", "row_demand_mean", "row_demand_variation", "row_demand_min", "row_demand_max"]
    .filter((f) => visible(f, resolved));

describe("demand mode is the one the run uses", () => {
  it("no series → model, whatever the empty cell would have shown", () => {
    expect(rowDemandMode({ resolved: { row_demand_mode: "model", has_forecast: false } })).toBe("model");
    expect(rowDemandMode({ resolved: {} })).toBe("model");
    expect(rowDemandMode({ resolved: { row_demand_mode: "forecast", has_forecast: true } })).toBe("forecast");
  });
});

describe("demand parameters follow the distribution", () => {
  const model = { row_demand_mode: "model", has_forecast: false };
  const fc = { row_demand_mode: "forecast", has_forecast: true };
  it("model mode", () => {
    expect(shown({ ...model, row_demand_distribution: "deterministic" })).toEqual(["row_demand_mean"]);
    expect(shown({ ...model, row_demand_distribution: "poisson" })).toEqual(["row_demand_mean"]);
    expect(shown({ ...model, row_demand_distribution: "normal" })).toEqual(["row_demand_mean", "row_demand_variation"]);
    expect(shown({ ...model, row_demand_distribution: "triangular_av" })).toEqual(["row_demand_mean", "row_demand_variation"]);
    expect(shown({ ...model, row_demand_distribution: "triangular" })).toEqual(["row_demand_mean", "row_demand_min", "row_demand_max"]);
    expect(shown({ ...model })).toEqual([]); // the product's distribution
  });
  it("forecast mode — the series is the mean", () => {
    expect(shown({ ...fc, row_demand_distribution: "normal" })).toEqual(["row_forecast", "row_demand_variation"]);
    expect(shown({ ...fc, row_demand_distribution: "poisson" })).toEqual(["row_forecast"]);
    expect(shown({ ...fc, row_demand_distribution: "triangular" }))
      .toEqual(["row_forecast", "row_demand_mean", "row_demand_min", "row_demand_max"]);
  });
});

describe("§4 D287 — every Customer master cell reaches the engine", () => {
  it("none is badged 'not simulated'", () => {
    const silent = cols.filter((c) => c.master && !cellEngineRead("customer", c).reaches).map((c) => c.field);
    expect(silent).toEqual([]);
  });
});

describe("the project line is the allocation rule, with 2+ customers only", () => {
  it("one customer → no line", () => {
    expect(customerRuleFields(1)).toEqual([]);
    expect(customerRuleFields(2).map((f) => f.field)).toEqual(["allocation"]);
  });
});
