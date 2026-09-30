import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SCENARIO_ENGINE_DEFAULTS } from "@/hooks/useScenarios";
import { buildScenarioSeed, keepsValidatedWorld, uniqueName, worldOf } from "../scenarioSeed";

// The shape `_build_scenario_fingerprint` stores on a card (fingerprint v1).
const card = {
  fingerprint_version: 1,
  horizon_days: 365,
  time_step: "day",
  demand_model: { kind: "poisson", lambda: 50 },
};

describe("a new scenario starts in the validated world (§4 D219)", () => {
  it("copies the card's fingerprint fields exactly", () => {
    const w = worldOf({ horizon_days: 90, time_step: "day", demand_model: { kind: "poisson", lambda: 9 } }, card);
    const seed = buildScenarioSeed({ name: "S", world: w });
    expect(seed.horizon_days).toBe(365);
    expect(seed.time_step).toBe("day");
    expect(seed.demand_model).toEqual({ kind: "poisson", lambda: 50 });
    expect(keepsValidatedWorld(seed, w)).toBe(true);
  });

  it("never writes warm-up or replications — inheritance is the RPC's", () => {
    const seed = buildScenarioSeed({ name: "S", world: worldOf(null, card) });
    expect(seed).not.toHaveProperty("warmup_days");
    expect(seed).not.toHaveProperty("warmup_mode");
    expect(seed).not.toHaveProperty("replications");
    expect(seed).not.toHaveProperty("inherited_validation_id");
  });

  it("a changed horizon leaves the validated world, and says so", () => {
    const w = worldOf(null, card);
    const seed = buildScenarioSeed({ name: "S", world: w, horizon_days: 728 });
    expect(keepsValidatedWorld(seed, w)).toBe(false);
  });

  it("without a card, the baseline row; without either, the engine defaults", () => {
    const b = { horizon_days: 364, time_step: "day" as const, demand_model: { kind: "poisson", lambda: 7 } };
    expect(worldOf(b, null)).toMatchObject({ horizon_days: 364, source: "baseline" });
    expect(worldOf(null, null)).toMatchObject({
      horizon_days: SCENARIO_ENGINE_DEFAULTS.horizon_days,
      source: "defaults",
    });
  });

  it("shares the baseline's seed and CRN, and is always an experiment", () => {
    const seed = buildScenarioSeed({ name: "S", world: worldOf(null, card), baseline: { seed: 7, crn: true } });
    expect(seed.seed).toBe(7);
    expect(seed.crn).toBe(true);
    expect(seed.role).toBe("experiment");
  });
});

describe("uniqueName", () => {
  it("suffixes a taken name", () => {
    expect(uniqueName("Scenario 2", ["Scenario 1"])).toBe("Scenario 2");
    expect(uniqueName("Scenario 2", ["scenario 2"])).toBe("Scenario 2 (2)");
  });
});
