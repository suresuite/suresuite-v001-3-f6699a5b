/**
 * κ is shown on a /policies row only where the run reads it — scsim P-P.1
 * sizes only the FORMULA order-up-to level S = E[D]·(T_s+κ) from it, so a row
 * that states S, an (R,Q) row with a lot (S = R + Q) and an MRP row (no level)
 * have no κ to show.
 */
import { describe, expect, it } from "vitest";
import { kappaIsRead } from "../registryPolicyTypes";

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

  it("(R,Q) reads it only with no lot", () => {
    expect(kappaIsRead("rop", has())).toBe(true);
    expect(kappaIsRead("rop", has("reorder_point"))).toBe(true);
    expect(kappaIsRead("rop", has("rop_q_quantity"))).toBe(false);
    // An S stored under an earlier type is not part of (R,Q) and changes nothing.
    expect(kappaIsRead("rop", has("order_up_to"))).toBe(true);
  });

  it("MRP never reads it", () => {
    expect(kappaIsRead("mrp", has())).toBe(false);
  });
});
