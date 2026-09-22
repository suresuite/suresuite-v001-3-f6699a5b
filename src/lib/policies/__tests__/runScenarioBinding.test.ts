import { describe, expect, it } from "vitest";
import { resolveRunScenarioBinding } from "@/lib/trust/runScenarioBinding";

// Audit F-11 / D-3. The workbook bound the seed read from the LIVE scenario row,
// so editing the seed after a run rebound the new seed to the old figures, and
// `reproducible` still computed true. The disruption schedule was not bound at
// all, although CLAUDE.md's I8 row said it was. What ran is now stamped on the
// run at dispatch; an older run falls back to the live row ONLY when that row
// provably has not changed since dispatch — the same guard sim-command's reuse
// check already uses — and otherwise binds nothing, with the reason.
const RUN_AT = "2026-09-22T10:00:00Z";
const schedule = [{ target: "supplier:s1", start_day: 140, duration_days: 14 }];

describe("the seed and schedule bound are the ones that ran", () => {
  it("a stamped run binds its own stamp, whatever the scenario says now", () => {
    const b = resolveRunScenarioBinding(
      { created_at: RUN_AT, seed: 42, disruption_schedule: schedule },
      { seed: 7, disruption_schedule: [], updated_at: "2026-09-22T11:00:00Z" },
    );
    expect(b.seed).toBe(42);
    expect(b.seedSource).toMatch(/simulation_runs\.seed/);
    expect(b.schedule).toEqual(schedule);
  });

  it("an unstamped run with an unchanged scenario binds the live row, saying why", () => {
    const b = resolveRunScenarioBinding(
      { created_at: RUN_AT },
      { seed: 42, disruption_schedule: schedule, updated_at: "2026-09-22T09:00:00Z" },
    );
    expect(b.seed).toBe(42);
    expect(b.seedSource).toMatch(/unchanged since/);
  });

  it("an unstamped run whose scenario was EDITED binds nothing, with the reason", () => {
    const b = resolveRunScenarioBinding(
      { created_at: RUN_AT },
      { seed: 7, disruption_schedule: [], updated_at: "2026-09-22T11:00:00Z" },
    );
    expect(b.seed).toBeNull();
    expect(b.schedule).toBeNull();
    expect(b.reason).toMatch(/edited after this run/);
  });

  it("no scenario row at all binds nothing", () => {
    expect(resolveRunScenarioBinding({ created_at: RUN_AT }, null).seed).toBeNull();
  });
});
