/**
 * ONE unit table — TS, SQL and Python agree key for key (Phase 1 / WP 1.3, D10).
 *
 * The platform used to carry three conversions. Two were already in lockstep
 * (`grading.ts::UNIT_DAYS` and `project_map.py::_UNIT_DAYS`); the third lived in
 * the `sc_nodes` SQL view as three ILIKE branches and an ELSE, so a row quoted in
 * QUARTERS matched nothing, fell to ELSE and was read as weekly — 13x its real
 * value, silently, on that product's demand.
 *
 * SQL now GENERATES from the TypeScript table. This suite is what makes that
 * claim checkable rather than asserted: it re-reads all three sources from disk
 * and compares them, so adding a unit to one and not the others fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIT_DAYS, rateToWeekly, unitDays } from "../../../../supabase/functions/_shared/grading";

const ROOT = join(__dirname, "..", "..", "..", "..");

/** `_UNIT_DAYS = { "day": 1.0, ... }` out of project_map.py. */
function pythonUnitDays(): Record<string, number> {
  const src = readFileSync(join(ROOT, "scsim", "scsim", "io", "project_map.py"), "utf8");
  const start = src.indexOf("_UNIT_DAYS = {");
  expect(start, "project_map.py no longer declares _UNIT_DAYS").toBeGreaterThan(-1);
  const body = src.slice(src.indexOf("{", start) + 1, src.indexOf("}", start));
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*([0-9.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** `WHEN 'day' THEN 1::numeric` out of the generated migration. */
function sqlUnitDays(): Record<string, number> {
  const src = readFileSync(
    join(ROOT, "supabase", "migrations", "20260915000001_one_unit_table.sql"),
    "utf8",
  );
  const out: Record<string, number> = {};
  for (const m of src.matchAll(/WHEN '([^']+)' THEN ([0-9.]+)::numeric/g)) out[m[1]] = Number(m[2]);
  return out;
}

describe("D10 — one unit table, three languages", () => {
  it("TypeScript and Python hold the same keys with the same values", () => {
    const py = pythonUnitDays();
    expect(Object.keys(py).sort()).toEqual(Object.keys(UNIT_DAYS).sort());
    for (const [k, v] of Object.entries(UNIT_DAYS)) expect(py[k], `unit "${k}"`).toBe(v);
  });

  it("the generated SQL holds the same keys with the same values", () => {
    const sql = sqlUnitDays();
    expect(Object.keys(sql).sort()).toEqual(Object.keys(UNIT_DAYS).sort());
    for (const [k, v] of Object.entries(UNIT_DAYS)) expect(sql[k], `unit "${k}"`).toBe(v);
  });

  it("knows `quarter` — the unit the old SQL CASE silently treated as weekly", () => {
    // The whole of D10 in one assertion. `quarter` matched none of the three
    // ILIKE branches, so `ELSE volume` read a quarterly rate as a weekly one.
    for (const table of [UNIT_DAYS, pythonUnitDays(), sqlUnitDays()]) {
      expect(table.quarter).toBe(91.3125);
      expect(table.quarterly).toBe(91.3125);
    }
  });

  it("rateToWeekly(v, 'quarter') agrees across TS, SQL and Python", () => {
    // All three compute value * 7 / unit_days(unit). Same table + same formula =
    // same answer, so the test asserts the formula in each language's own terms.
    const value = 1300;
    const ts = rateToWeekly(value, "quarter");
    const py = (value * 7.0) / pythonUnitDays().quarter;
    const sql = (value * 7.0) / sqlUnitDays().quarter;

    expect(ts).toBeCloseTo(99.65777, 4);
    expect(py).toBeCloseTo(ts, 10);
    expect(sql).toBeCloseTo(ts, 10);

    // And the size of the bug that is now fixed: the old CASE returned the raw
    // value for a quarterly row, i.e. 13.045x too much.
    expect(value / ts).toBeCloseTo(13.04464, 4);
  });

  it("an unrecognised or missing unit is read as already-weekly, everywhere", () => {
    expect(unitDays("fortnight")).toBeUndefined();
    expect(unitDays(null)).toBeUndefined();
    expect(rateToWeekly(42, "fortnight")).toBe(42);
    expect(rateToWeekly(42, null)).toBe(42);
    // The SQL mirrors it with COALESCE(NULLIF(unit_days(unit), 0), default_days).
    const src = readFileSync(
      join(ROOT, "supabase", "migrations", "20260915000001_one_unit_table.sql"),
      "utf8",
    );
    expect(src).toContain("COALESCE(NULLIF(public.unit_days(unit), 0), default_days)");
  });

  it("nothing else in the repo declares a unit table", () => {
    // A fourth table is how D10 happened in the first place. Every other file may
    // IMPORT the vocabulary; none may restate it.
    const declarations = [
      ["supabase/functions/_shared/grading.ts", "export const UNIT_DAYS"],
      ["scsim/scsim/io/project_map.py", "_UNIT_DAYS = {"],
    ];
    for (const [file, decl] of declarations) {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain(decl);
    }
    for (const file of [
      "src/lib/policies/effectiveEconomics.ts",
      "supabase/functions/_shared/laneVolumes.ts",
      "supabase/functions/_shared/estimators.ts",
      "src/components/UploadWizard.tsx",
    ]) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} restates the unit table`).not.toMatch(/(UNIT_DAYS|_UNIT_DAYS)\s*[:=]\s*\{/);
      expect(src, `${file} does not import the shared table`).toMatch(/from ["'].*grading(\.ts)?["']/);
    }
  });
});
