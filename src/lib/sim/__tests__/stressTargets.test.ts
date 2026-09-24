/**
 * §4 D172 — the launch-time resolution that keeps a stress preset honest.
 *
 * `supplier:primary` must resolve to the supplier carrying the largest share
 * of WEEKLY inbound volume — the same normalization the lane ETL applies
 * (one unit table, D10) — and a project that cannot name one must get a
 * refusal, never a schedule whose event the engine will silently drop.
 */
import { describe, expect, it } from "vitest";
import {
  RESOLVABLE_PLACEHOLDER,
  resolvePrimarySupplier,
  resolveStressSchedule,
  type StressEvent,
} from "../stressTargets";

const ev = (target: string): StressEvent => ({
  target, target_type: "node", start_day: 120, duration_days: 14, magnitude_pct: 100,
});

describe("resolvePrimarySupplier", () => {
  it("picks the largest supplier by WEEKLY volume, not by the raw number", () => {
    // 52 000/year ≈ 996.6/week — the D2 example: the raw number is larger,
    // the weekly rate is smaller than 1 000/week.
    const r = resolvePrimarySupplier([
      { supplier_id: "YEARLY", volume: 52_000, time_unit: "yearly" },
      { supplier_id: "WEEKLY", volume: 1_000, time_unit: "week" },
    ]);
    expect("primary" in r && r.primary.supplierId).toBe("WEEKLY");
  });

  it("sums a supplier's lanes and reports the share of the total", () => {
    const r = resolvePrimarySupplier([
      { supplier_id: "A", volume: 30, time_unit: "week" },
      { supplier_id: "A", volume: 30, time_unit: "week" },
      { supplier_id: "B", volume: 40, time_unit: "week" },
    ]);
    if (!("primary" in r)) throw new Error(r.error);
    expect(r.primary.supplierId).toBe("A");
    expect(r.primary.sharePct).toBeCloseTo(60, 5);
    expect(r.candidates).toBe(2);
  });

  it("refuses with a reason when there are no usable lanes", () => {
    const r = resolvePrimarySupplier([{ supplier_id: "", volume: 10, time_unit: "week" }]);
    expect("error" in r && r.error).toMatch(/no inbound lanes/);
  });

  it("refuses with a reason when every lane is zero-volume", () => {
    const r = resolvePrimarySupplier([{ supplier_id: "S1", volume: 0, time_unit: "week" }]);
    expect("error" in r && r.error).toMatch(/zero volume/);
  });
});

describe("resolveStressSchedule", () => {
  const rows = [
    { supplier_id: "S1", volume: 100, time_unit: "week" },
    { supplier_id: "S2", volume: 25, time_unit: "week" },
  ];

  it("replaces only the placeholder, and says what it did", () => {
    const r = resolveStressSchedule([ev(RESOLVABLE_PLACEHOLDER), ev("node:plant")], rows);
    if ("error" in r) throw new Error(r.error);
    expect(r.schedule.map((e) => e.target)).toEqual(["supplier:S1", "node:plant"]);
    expect(r.note).toMatch(/resolved at launch to S1 \(80% of weekly inbound volume\)/);
  });

  it("passes a placeholder-free schedule through untouched, with no note", () => {
    const r = resolveStressSchedule([ev("node:plant")], []);
    if ("error" in r) throw new Error(r.error);
    expect(r.schedule).toEqual([ev("node:plant")]);
    expect(r.note).toBeNull();
  });

  it("relays the resolver's refusal instead of emitting the placeholder", () => {
    const r = resolveStressSchedule([ev(RESOLVABLE_PLACEHOLDER)], []);
    expect("error" in r).toBe(true);
  });
});
