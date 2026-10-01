import { describe, expect, it } from "vitest";
import { durationHint, startHint } from "@/components/sim/DisruptionFields";
import { DISRUPTION_RULE } from "../disruptionEvents";

// The hints under the start-time and duration fields (WP 9.4 design review):
// a range while the event fits the run, a warning once it runs past the end.
describe("disruption field hints", () => {
  it("states the start-time range against the run", () => {
    expect(startHint(52)).toBe(`Week ${DISRUPTION_RULE.start_week_min}–52 of the run`);
    expect(startHint()).toBe(`From week ${DISRUPTION_RULE.start_week_min} of the run`);
  });
  it("states the duration range while the event ends inside the run", () => {
    const h = durationHint(20 * 7, 4 * 7, 52);
    expect(h.tone).toBe("muted");
    expect(h.text).toBe(`${DISRUPTION_RULE.duration_weeks_min}–${DISRUPTION_RULE.duration_weeks_max} weeks`);
  });
  it("warns, naming the last week, when the event runs past the end", () => {
    const h = durationHint(20 * 7, 40 * 7, 52);
    expect(h.tone).toBe("warn");
    expect(h.text).toBe("Ends in week 59, after the run ends in week 52.");
  });
});
