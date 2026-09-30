import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import registry from "@/lib/policies/registry.generated.json";
import { STRESS_PRESETS } from "@/components/docs/generated/policy.generated";
import {
  DISRUPTION_RULE,
  PLANT_TARGET,
  addBlockedReason,
  effectLabel,
  judgeTarget,
  newEvent,
  supplierTarget,
  targetChoices,
} from "../disruptionEvents";
import { disruptionWeeks } from "../runWindow";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("one disruption-event model (WP 9.4 slice 6 · §4 D224)", () => {
  it("reads the mapper's exported rule", () => {
    const d = (registry as unknown as { disruption: typeof DISRUPTION_RULE }).disruption;
    expect(DISRUPTION_RULE).toEqual(d);
    expect(DISRUPTION_RULE.supported_target_kinds).toEqual(["supplier", "plant"]);
  });

  it("agrees with the derived stress-preset classification on every event", () => {
    // `chains.mjs` applies the mapper's rule to each preset; judgeTarget applies
    // the shared one. They must never disagree about what the engine skips.
    for (const p of STRESS_PRESETS) {
      for (const e of p.events) {
        // "Skipped" is the claim both sides make; the shared rule also says WHY
        // (a kind the engine cannot disrupt, or no such supplier in the project).
        const { target, reason } = judgeTarget(e.target, []);
        if (e.resolves === "unsupported") expect(reason, e.target).not.toBeNull();
        if (e.resolves === "plant") expect(target.kind, e.target).toBe("plant");
        if (target.kind === "unsupported") expect(e.resolves, e.target).toBe("unsupported");
      }
    }
  });

  it("offers only targets the engine can disrupt", () => {
    const ids = ["S2", "S1"];
    const choices = targetChoices(ids);
    expect(choices.map((c) => c.value)).toEqual([PLANT_TARGET, supplierTarget("S1"), supplierTarget("S2")]);
    for (const c of choices) expect(judgeTarget(c.value, ids).reason).toBeNull();
  });

  it("a new event is a whole-week full outage after the warm-up", () => {
    const e = newEvent("node:plant", 105);
    expect(e.start_day % 7).toBe(0);
    expect(e.duration_days % 7).toBe(0);
    expect(effectLabel(e.magnitude_pct)).toBe("Full outage");
    expect(effectLabel(30)).toBe("Cut by 30%");
  });

  it("stops at the engine's cap and says so", () => {
    const five = Array.from({ length: DISRUPTION_RULE.event_cap }, () => newEvent("node:plant"));
    expect(addBlockedReason(five.slice(1))).toBeNull();
    expect(addBlockedReason(five)).toMatch(/at most 5 events/);
  });

  it("the week bounds come from the rule, not a literal (§4 D224)", () => {
    expect(disruptionWeeks(0, 400 * 7).durationWeeks).toBe(DISRUPTION_RULE.duration_weeks_max);
    const src = readFileSync(join(ROOT, "src/lib/sim/runWindow.ts"), "utf8");
    expect(src).not.toMatch(/clamp\([^)]*,\s*1,\s*52\)/);
  });
});
