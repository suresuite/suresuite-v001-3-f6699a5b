import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissingStampColumn, runStamp } from "../../../../supabase/functions/_shared/runStamp.ts";

// Audit F-11. The dispatcher stamps what ran on the run row; the export binds it.
describe("the dispatcher stamps the seed and schedule that ran", () => {
  it("copies the scenario's seed and schedule", () => {
    const sch = [{ target: "supplier:s1", start_day: 140, duration_days: 14 }];
    expect(runStamp({ seed: 42, disruption_schedule: sch })).toEqual({ seed: 42, disruption_schedule: sch });
  });
  it("never invents a seed", () => {
    expect(runStamp({ seed: "42" }).seed).toBeNull();
    expect(runStamp({}).disruption_schedule).toEqual([]);
  });
  it("retries unstamped ONLY for the stamp's own missing columns", () => {
    expect(isMissingStampColumn({ code: "PGRST204",
      message: "Could not find the 'seed' column of 'simulation_runs' in the schema cache" })).toBe(true);
    expect(isMissingStampColumn({ code: "PGRST204",
      message: "Could not find the 'gate_skipped' column of 'simulation_runs' in the schema cache" })).toBe(false);
    expect(isMissingStampColumn({ code: "23503", message: "violates foreign key" })).toBe(false);
    expect(isMissingStampColumn(null)).toBe(false);
  });
  it("the insert carries the stamp first, and falls back only on that error", () => {
    const src = readFileSync(join(__dirname, "../../../../supabase/functions/_shared/dispatch.ts"), "utf8");
    expect(src).toMatch(/\.\.\.\(withStamp \? stamp : \{\}\)/);
    expect(src).toMatch(/await insertRun\(true\)/);
    expect(src).toMatch(/if \(runErr && isMissingStampColumn\(runErr\)\)/);
  });
});
