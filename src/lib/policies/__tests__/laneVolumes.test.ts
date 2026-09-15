/**
 * Regression tests for D2 — `combine-project` never converted `volume` by
 * `time_unit` (docs/PLAN.md §4, closed by WP 0.2).
 *
 * The ETL read `row.volume` raw at all eight of its read sites, then summed and
 * divided those numbers as if they shared a unit. `sourcing_ratio` is a SHARE,
 * so the error does not cancel: it changes which supplier the platform reports
 * as primary, and `weighted` (propagated demand) carries the same distortion
 * into every downstream surface.
 *
 * These import the same module the edge function imports — the test cannot pass
 * against a copy of the logic.
 */
import { describe, expect, it } from "vitest";
import {
  volumeShare,
  weeklyVolume,
  weeklyVolumeTotalsBy,
} from "../../../../supabase/functions/_shared/laneVolumes.ts";
import { UNIT_DAYS } from "../../../../supabase/functions/_shared/grading.ts";

/** Two suppliers of the same material, quoting the SAME physical flow in
 *  different units: 1 000 units a week is 52 000 units a year (52.178…, using
 *  the engine's 365.25-day year). */
const WEEKLY_RATE = 1000;
const YEARLY_EQUIVALENT = (WEEKLY_RATE * UNIT_DAYS.year) / UNIT_DAYS.week;

const arcs = [
  { supplier_id: "SUP-WEEK", material_id: "MAT-1", volume: WEEKLY_RATE, time_unit: "week" },
  { supplier_id: "SUP-YEAR", material_id: "MAT-1", volume: YEARLY_EQUIVALENT, time_unit: "year" },
];

const sharesFor = (rows: typeof arcs) => {
  const totals = weeklyVolumeTotalsBy(rows, (r) => String(r.material_id));
  return rows.map((r) => volumeShare(weeklyVolume(r), totals.get(String(r.material_id)) ?? 0));
};

describe("D2 — sourcing shares are computed on a common unit", () => {
  it("two arcs of the same physical volume get the same share", () => {
    const [week, year] = sharesFor(arcs);
    expect(week).toBeCloseTo(0.5, 12);
    expect(year).toBeCloseTo(0.5, 12);
    expect(week).toBeCloseTo(year, 12);
  });

  it("the shares of a material sum to 1", () => {
    expect(sharesFor(arcs).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("without conversion the same data would name the wrong primary supplier", () => {
    // The pre-fix arithmetic, reproduced here ONLY to show what it did: the
    // yearly-quoting supplier took 98 % of the share for an identical flow, so
    // the policy grid's "highest volume wins" ranking picked it as primary.
    const rawTotal = arcs.reduce((s, r) => s + r.volume, 0);
    const rawShares = arcs.map((r) => r.volume / rawTotal);
    expect(rawShares[0]).toBeLessThan(0.03);
    expect(rawShares[1]).toBeGreaterThan(0.97);
    // The fix reverses that verdict — the two are equal, not 2 % vs 98 %.
    const [week, year] = sharesFor(arcs);
    expect(Math.abs(week - year)).toBeLessThan(1e-9);
  });
});

describe("D2 — weeklyVolume follows the engine's unit table", () => {
  it("normalizes each unit exactly as project_map.py does", () => {
    expect(weeklyVolume({ volume: 7, time_unit: "day" })).toBeCloseTo(49, 12);
    expect(weeklyVolume({ volume: 100, time_unit: "week" })).toBeCloseTo(100, 12);
    expect(weeklyVolume({ volume: UNIT_DAYS.month, time_unit: "month" })).toBeCloseTo(7, 12);
    expect(weeklyVolume({ volume: UNIT_DAYS.quarter, time_unit: "quarter" })).toBeCloseTo(7, 12);
    expect(weeklyVolume({ volume: UNIT_DAYS.year, time_unit: "year" })).toBeCloseTo(7, 12);
  });

  it("accepts every spelling the unit table knows, case- and space-insensitively", () => {
    expect(weeklyVolume({ volume: 30, time_unit: "Daily" })).toBeCloseTo(210, 12);
    expect(weeklyVolume({ volume: 30, time_unit: " YEARLY " })).toBeCloseTo((30 * 7) / 365.25, 12);
    expect(weeklyVolume({ volume: 30, time_unit: "wk" })).toBeCloseTo(30, 12);
  });

  it("treats an absent or unrecognized unit as weekly, like the engine", () => {
    expect(weeklyVolume({ volume: 42 })).toBe(42);
    expect(weeklyVolume({ volume: 42, time_unit: null })).toBe(42);
    expect(weeklyVolume({ volume: 42, time_unit: "fortnight" })).toBe(42);
  });

  it("is 0 for a missing or unparseable volume, never NaN", () => {
    expect(weeklyVolume({ time_unit: "week" })).toBe(0);
    expect(weeklyVolume({ volume: null, time_unit: "week" })).toBe(0);
    expect(weeklyVolume({ volume: "not a number", time_unit: "week" })).toBe(0);
    expect(weeklyVolume(undefined)).toBe(0);
  });

  it("the conversion can only grow a volume 7×, and only for day-quoted rows", () => {
    // supply_chain_data.weighted is numeric(16,6) — max 9 999 999 999.999999.
    // Every unit coarser than a day SHRINKS the stored magnitude, so the fix
    // reduces overflow risk everywhere except day-quoted rows, which need a
    // pre-existing weighted value above ~1.43e9 to newly overflow.
    const growth = Object.entries(UNIT_DAYS).map(([unit, days]) => ({ unit, factor: 7 / days }));
    expect(Math.max(...growth.map((g) => g.factor))).toBe(7);
    for (const { unit, factor } of growth) {
      if (!["day", "days", "d", "daily"].includes(unit)) {
        expect(factor, unit).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("D2 — volumeShare keeps the ETL's single-claimant convention", () => {
  it("a key with no measured flow gives its row the whole share", () => {
    expect(volumeShare(0, 0)).toBe(1.0);
  });

  it("never divides by a raw (unconverted) total", () => {
    // Both arguments are weekly by construction; this pins the contract that
    // callers convert BEFORE dividing, which is the whole of D2.
    expect(volumeShare(weeklyVolume(arcs[1]), weeklyVolumeTotalsBy(arcs, () => "k").get("k")!))
      .toBeCloseTo(0.5, 12);
  });
});
