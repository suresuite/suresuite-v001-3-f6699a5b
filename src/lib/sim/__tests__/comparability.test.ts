import { describe, expect, it } from "vitest";
import { comparabilityFailures, differingComponents, type ComparableSide } from "../comparability";

const ev = { target: "supplier:S1", target_type: "node", start_day: 140, duration_days: 28, magnitude_pct: 100 };
const side = (o: Partial<ComparableSide["run"]> = {}, sched: unknown[] = []): ComparableSide => ({
  scenario: { crn: true, seed: 42, disruption_schedule: sched },
  run: { policy_version_id: "v1", scenario_hash: "w1", code_version: "0.2.8", seed: 42, disruption_schedule: sched, ...o },
});

describe("§9.3 comparability knows disruptions are a component (§4 D219)", () => {
  it("baseline vs a stress run of the same model is a valid pair", () => {
    const base = side();
    const stress = side({ disruption_schedule: [ev] }, [ev]);
    expect(differingComponents(base, stress)).toEqual(["events"]);
    expect(comparabilityFailures(base, stress)).toEqual([]);
  });

  it("identical runs have nothing to compare", () => {
    expect(comparabilityFailures(side(), side())[0]).toMatch(/nothing to compare/);
  });

  it("policies and disruptions both differing is refused", () => {
    const f = comparabilityFailures(side(), side({ policy_version_id: "v2", disruption_schedule: [ev] }, [ev]));
    expect(f.join(" ")).toMatch(/policies AND events differ/);
  });

  it("schedule order and key order do not make a difference", () => {
    const e2 = { ...ev, target: "plant:P" };
    const reordered = { magnitude_pct: 100, duration_days: 28, start_day: 140, target_type: "node", target: "supplier:S1" };
    expect(differingComponents(side({ disruption_schedule: [ev, e2] }), side({ disruption_schedule: [e2, reordered] }))).toEqual([]);
  });

  it("the seed is read from the run, not the live scenario", () => {
    const a = side();
    const b = side({ seed: 7, disruption_schedule: [ev] });
    expect(comparabilityFailures(a, b).join(" ")).toMatch(/seed spec differs \(42 vs 7\)/);
  });
});
