import { describe, expect, it, vi } from "vitest";

// The defaults live beside the hook, which imports the client; no network here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import registry from "@/lib/policies/registry.generated.json";
import { SCENARIO_ENGINE_DEFAULTS } from "@/hooks/useScenarios";
import {
  DAYS_PER_WEEK,
  HORIZON_WEEKS,
  PLANNING_UNIT_IS_ENGINE_TICK,
  editWeeks,
  engineWeeks,
  formatDuration,
  formatWeek,
} from "../planningTime";

describe("one planning unit (WP 9.4 slice 1)", () => {
  it("the planning unit is the engine tick", () => {
    expect(PLANNING_UNIT_IS_ENGINE_TICK).toBe(true);
    expect(DAYS_PER_WEEK).toBe(registry.run_window.days_per_tick);
  });

  it("a whole number of weeks reads plainly; anything else says it is approximate", () => {
    expect(formatDuration(364)).toBe("52 wk");
    expect(formatDuration(365)).toBe("≈52 wk");
    expect(formatDuration(0)).toBe("0 wk");
  });

  it("rounds as the mapper does (half to even)", () => {
    expect(engineWeeks(3.5 * 7)).toBe(4);
    expect(engineWeeks(2.5 * 7)).toBe(2);
  });

  it("an event's week is never before week 1", () => {
    expect(formatWeek(0)).toBe("wk 1");
    expect(formatWeek(120)).toBe("wk 17");
  });

  it("editing keeps a fingerprinted value when its week is unchanged", () => {
    // 365 d is a validated card's horizon; typing 52 back must not move it.
    expect(editWeeks(365, 52)).toBe(365);
    expect(editWeeks(365, 53)).toBe(371);
    expect(editWeeks(90, 52)).toBe(364);
  });
});

describe("the default horizon is a run the engine makes (§4 D220)", () => {
  it("equals the engine's floor in days", () => {
    expect(SCENARIO_ENGINE_DEFAULTS.horizon_days).toBe(HORIZON_WEEKS.min * DAYS_PER_WEEK);
  });
});
