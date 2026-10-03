/**
 * κ is shown on a /policies row only where the run reads it — scsim P-P.1
 * sizes only the FORMULA order-up-to level S = E[D]·(T_s+κ) from it, so a row
 * that states S, an (R,Q) row (it orders Q; S = R + Q) and an MRP row (no
 * level) have no κ to show. An (R,Q) row with no Q needs input instead.
 */
import { describe, expect, it } from "vitest";
import { kappaIsRead } from "../registryPolicyTypes";
import { lineNeedsInput, rowNeedsLot } from "../stageGuards";
import { POLICY_PARAMS } from "@/components/policies/policyGridUi";

const has = (...fields: string[]) => (f: string) => fields.includes(f);

describe("kappaIsRead", () => {
  it("is read where S comes from the formula", () => {
    for (const t of ["min_max", "s_S", "continuous_review", "base_stock", "periodic_review"]) {
      expect(kappaIsRead(t, has()), t).toBe(true);
      expect(kappaIsRead(t, has("reorder_point", "review_period_days")), t).toBe(true);
    }
  });

  it("is not read when the row states S", () => {
    for (const t of ["min_max", "base_stock", "periodic_review"]) {
      expect(kappaIsRead(t, has("order_up_to")), t).toBe(false);
    }
  });

  it("(R,Q) never reads it, and has no κ cell", () => {
    for (const fields of [[], ["reorder_point"], ["rop_q_quantity"], ["order_up_to"]]) {
      expect(kappaIsRead("rop", has(...fields)), fields.join()).toBe(false);
    }
    expect(POLICY_PARAMS.rop.map((p) => p.field)).toEqual(["rop_q_quantity", "reorder_point"]);
  });

  it("an (R,Q) row with no Q needs input", () => {
    const resolve = (vals: Record<string, unknown>) => (_r: Record<string, unknown>, f: string) => vals[f];
    const row = { key: "node:S1::M1" };
    expect(rowNeedsLot(row, resolve({ type: "rop", rop_q_quantity: 0 }))).toBe(true);
    expect(rowNeedsLot(row, resolve({ type: "rop" }))).toBe(true);
    expect(rowNeedsLot(row, resolve({ type: "rop", rop_q_quantity: 500 }))).toBe(false);
    expect(rowNeedsLot(row, resolve({ type: "min_max", rop_q_quantity: 0 }))).toBe(false);
    expect(lineNeedsInput("supplier", row, [row], resolve({ type: "rop", rop_q_quantity: 0 }))).toBe(true);
    expect(lineNeedsInput("plant", row, [row], resolve({ type: "rop", rop_q_quantity: 0 }))).toBe(false);
  });

  it("MRP never reads it", () => {
    expect(kappaIsRead("mrp", has())).toBe(false);
  });
});
