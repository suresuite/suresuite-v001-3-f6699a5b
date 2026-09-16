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
  resolveWeeklyVolume,
  unitSubstitutions,
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

/**
 * D46's READER HALF (WP 3.3) — an unrecognized `time_unit` is still read as
 * weekly, and is no longer read SILENTLY.
 *
 * The writer closed in WP 3.2: `ingestValidate` refuses a token `unitDays()`
 * does not know and lands no value. But §15 found 27 such tokens already in tier
 * 2 — `21`, `15`, `16`, `7`, `14`, `9`, `4` and twenty more, 88 rows across six
 * projects — and this resolver mapped every one of them to weekly with no
 * finding anywhere. A number whose source is a parse failure, displayed as data:
 * §5 T1 has no fourth option, and T2 says the substitution must be visible at
 * the point of display.
 *
 * THE DECISION, and it is a decision rather than a deferral. The row is NOT
 * refused — blanking 88 rows of projects whose owners did not cause the defect
 * and cannot fix it without re-uploading would destroy data to punish a parser
 * that no longer exists — and the substitution is REPORTED, per token, with the
 * number of rows relying on it.
 */
describe("D46 — an unrecognized time_unit is reported, not assumed", () => {
  it("still computes, on the documented 7-day basis", () => {
    // Unchanged behaviour. The number a user already sees does not move; what
    // changes is that they are now told what it rests on.
    expect(resolveWeeklyVolume({ volume: 10, time_unit: "21" }).weekly).toBe(10);
  });

  it("names the token and what it was read as", () => {
    const { substitution } = resolveWeeklyVolume({ volume: 10, time_unit: "21" });
    expect(substitution).toEqual({ token: "21", assumed: "week", reason: "unrecognized_time_unit" });
  });

  it("reports every token §15 actually found in production", () => {
    // The real ones, from §15 run 35146894995. Each is almost certainly a lead
    // time in days that landed one column left — the D6 field-shift signature
    // arriving by a route the quote-character sweep does not see.
    for (const token of ["21", "15", "16", "7", "14", "9", "4"]) {
      expect(resolveWeeklyVolume({ volume: 1, time_unit: token }).substitution?.token).toBe(token);
    }
  });

  it("does NOT report an ABSENT unit — that is an explicit default, not a guess", () => {
    // "Absent means weekly" is written into 20260915000001, the sidecar and
    // project_map.py. T1 permits an explicit default; it forbids a guess. §15
    // counts 16 rows with a null time_unit and they are not a defect.
    for (const row of [{ volume: 5 }, { volume: 5, time_unit: null }, { volume: 5, time_unit: "  " }]) {
      expect(resolveWeeklyVolume(row).substitution).toBeNull();
    }
  });

  it("does not report a unit the one unit table knows, in any of its spellings", () => {
    for (const token of Object.keys(UNIT_DAYS)) {
      expect(resolveWeeklyVolume({ volume: 1, time_unit: token }).substitution).toBeNull();
    }
    // including the spellings a user actually types
    for (const token of [" Week ", "WEEKS", "Monthly"]) {
      expect(resolveWeeklyVolume({ volume: 1, time_unit: token }).substitution).toBeNull();
    }
  });

  it("collapses to one entry per token with a row count", () => {
    // 19 identical messages are not a finding a person can act on; "19 rows say
    // 21" is. Ordered by row count so the worst is first.
    const rows = [
      ...Array(3).fill({ volume: 1, time_unit: "21" }),
      { volume: 1, time_unit: "15" },
      { volume: 1, time_unit: "week" },
      { volume: 1 },
    ];
    expect(unitSubstitutions(rows)).toEqual([
      { token: "21", assumed: "week", reason: "unrecognized_time_unit", rows: 3 },
      { token: "15", assumed: "week", reason: "unrecognized_time_unit", rows: 1 },
    ]);
  });

  it("weeklyVolume is unchanged for every caller that does not want the finding", () => {
    // The arithmetic call sites keep their signature; the resolver is additive.
    for (const row of [{ volume: 10, time_unit: "month" }, { volume: 10, time_unit: "21" }, { volume: 10 }]) {
      expect(weeklyVolume(row)).toBe(resolveWeeklyVolume(row).weekly);
    }
  });
});
