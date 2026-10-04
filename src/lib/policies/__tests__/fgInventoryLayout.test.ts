/**
 * FG INVENTORY, laid out like the Supplier stage's inventory band — PLAN.md §25
 * WP 15.6, §4 D293.
 *
 * The Plant row: the MTS/MTO switch, the FG policy as the policy TYPE, ONE
 * "Replenishment parameters" cell holding only the levels the policy reads, then
 * the opening stock. The levels are master-backed cells still (their value and
 * source come from the one resolver — `pageEqualsRun.test.ts` compares them), so
 * what this suite pins is the LAYOUT and that the cell's parameter list and the
 * levels' own gates are one rule, not two.
 */
import { describe, expect, it } from "vitest";
import {
  FG_POLICY_PARAMS,
  STAGE_TABLE_SPEC,
  fgVectorParamCols,
  fitColsForStage,
  headerColsUnion,
  isFgDependentCol,
  shortLabelFor,
} from "../columnSpecs";

const mts = (fg_policy?: string) => ({ resolved: { fulfillment_mode: "mts", fg_policy }, projectFulfillmentMode: "mto" as const });

describe("§25 WP 15.6 — the FG inventory band", () => {
  it("reads 'FG inventory', never 'FG stock'", () => {
    const fit = fitColsForStage("plant", [mts("min_max")]);
    const band = fit.filter((c) => c.bandLabel).map((c) => c.bandLabel);
    expect(new Set(band)).toEqual(new Set(["FG inventory"]));
    expect(shortLabelFor("plant", "fulfillment_mode", "")).toBe("FG inventory");
    const sw = STAGE_TABLE_SPEC.plant.cols.find((c) => c.field === "fulfillment_mode")!;
    expect(sw.label).toBe("FG inventory");
  });

  it("is switch → policy type → one Replenishment cell → opening stock", () => {
    const fields = headerColsUnion("plant", [mts("min_max")]).map((c) => c.field);
    const fg = fields.filter((f) => ["fulfillment_mode", "fg_policy", "__fg_inv_params", "fg_initial_on_hand",
      "fg_reorder_point", "fg_base_stock", "fg_cover_days"].includes(f));
    expect(fg).toEqual(["fulfillment_mode", "fg_policy", "__fg_inv_params", "fg_initial_on_hand"]);
  });

  it("the cell's parameters are the levels each FG policy's own gate shows", () => {
    const levels = fgVectorParamCols("plant");
    expect(levels.map((c) => c.field)).toEqual(["fg_reorder_point", "fg_base_stock", "fg_cover_days"]);
    for (const policy of ["base_stock", "min_max", "days_of_cover"]) {
      const gated = levels.filter((c) => c.visibleWhen?.(mts(policy))).map((c) => c.field);
      expect(FG_POLICY_PARAMS[policy].map((p) => p.field), policy).toEqual(gated);
    }
    // An empty policy runs base-stock, as the engine does.
    expect(levels.filter((c) => c.visibleWhen?.(mts(undefined))).map((c) => c.field)).toEqual(["fg_base_stock"]);
  });

  it("an MTO row shows none of it — the cell joins the one 'made to order' sentence", () => {
    const cell = STAGE_TABLE_SPEC.plant.cols.find((c) => c.field === "__fg_inv_params")!;
    expect(isFgDependentCol(cell)).toBe(true);
    expect(cell.visibleWhen?.({ resolved: { fulfillment_mode: "mto" }, projectFulfillmentMode: "mto" })).toBe(false);
  });

  it("adds no safety-stock or holding-cost cell — the engine reads neither per product", () => {
    const fields = STAGE_TABLE_SPEC.plant.cols.map((c) => c.field);
    for (const f of ["fg_safety_stock_days", "safety_stock_days", "holding_cost_pct", "fg_holding_cost_pct"]) {
      expect(fields).not.toContain(f);
    }
  });
});
