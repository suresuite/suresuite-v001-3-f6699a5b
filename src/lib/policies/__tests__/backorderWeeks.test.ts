/**
 * PLAN.md §24 WP 14.3 — the Customer table shows each row's backorder window in
 * the weeks the ENGINE uses. The examples are computed by the mapper
 * (`registry_export.backorder_rule`), so this copy of the rule cannot drift.
 */
import { describe, expect, it } from "vitest";
import registry from "@/lib/policies/registry.generated.json";
import { backorderWeeks, backorderWeeksNote } from "../backorderWeeks";

describe("max backorder days → weeks", () => {
  it("reproduces every example the mapper computed", () => {
    const examples = registry.backorder.examples;
    expect(examples.length).toBeGreaterThanOrEqual(8);
    for (const { days, weeks } of examples) expect(backorderWeeks(days), `${days} d`).toBe(weeks);
  });

  it("rounds half up — the plan's table: 3 → 0, 4 → 1, 10 → 1, 11 → 2, 14 → 2", () => {
    expect([3, 4, 10, 11, 14].map(backorderWeeks)).toEqual([0, 1, 1, 2, 2]);
  });

  it("says the weeks on the cell, and nothing for an empty one", () => {
    expect(backorderWeeksNote(10)).toMatch(/^= 1 wk/);
    expect(backorderWeeksNote(undefined)).toBeUndefined();
    expect(backorderWeeksNote("")).toBeUndefined();
  });
});
