/**
 * P-P.4's FG safety buffer is added only for an MTS product on base-stock whose
 * S is EMPTY — the engine's `mts_mask & ~fg_typed` (p_p4_fg_safety_stock.py,
 * core/context.py). The /policies line that sets it shows only while such a row
 * exists, so this rule is the line's whole reason to appear.
 */
import { describe, expect, it } from "vitest";
import { fgBufferAppliesToRow, rowFulfillmentMode, STAGE_TABLE_SPEC } from "../columnSpecs";

const ctx = (resolved: Record<string, unknown>, project: "mts" | "mto" = "mto") => ({
  resolved,
  projectFulfillmentMode: project,
});

describe("FG safety buffer — read only for a derived target", () => {
  it("an MTS base-stock row with an empty S gets the buffer", () => {
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mts" }))).toBe(true);
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mts", fg_policy: "base_stock", fg_base_stock: null }))).toBe(true);
  });

  it("a typed target gets nothing on top", () => {
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mts", fg_base_stock: 300 }))).toBe(false);
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mts", fg_policy: "min_max" }))).toBe(false);
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mts", fg_policy: "days_of_cover" }))).toBe(false);
  });

  it("an MTO product holds no FG stock, so no buffer", () => {
    expect(fgBufferAppliesToRow(ctx({ fulfillment_mode: "mto" }))).toBe(false);
    expect(fgBufferAppliesToRow(ctx({}))).toBe(false);
  });

  it("an empty switch follows the project's model, as the engine does", () => {
    expect(rowFulfillmentMode(ctx({}, "mts"))).toBe("mts");
    expect(fgBufferAppliesToRow(ctx({}, "mts"))).toBe(true);
  });
});

describe("demand is authored on the Customer stage only (§4 D286)", () => {
  it("the Plant grid carries no demand cell", () => {
    const fields = STAGE_TABLE_SPEC.plant.cols.map((c) => c.field);
    expect(fields).not.toContain("demand_mean");
    expect(fields).not.toContain("demand_cv");
  });
});
