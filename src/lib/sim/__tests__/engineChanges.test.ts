import { describe, expect, it } from "vitest";

import { ENGINE_CHANGES } from "@/components/docs/generated/engineChangelog.generated";
import {
  CURRENT_ENGINE,
  RELEASE_REPORTS,
  changeFor,
  changesBetween,
  compareVersions,
  engineChangeSummary,
  engineDocHref,
  touchesPolicies,
} from "../engineChanges";
import { comparabilityFailures } from "../comparability";

// PLAN.md §25 · WP 15.6 · §4 D297 — every surface that names an engine reads the
// change record through these, so "the engine changed" can say WHAT changed.
describe("engineChanges", () => {
  it("orders versions semantically", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.6.1", "0.6.1")).toBe(0);
    expect([...ENGINE_CHANGES].map((e) => e.version)).toEqual(
      [...ENGINE_CHANGES].map((e) => e.version).sort((a, b) => compareVersions(b, a)),
    );
  });

  it("finds the entries between two versions, either way round", () => {
    expect(changesBetween("0.5.0", "0.6.1").map((e) => e.version)).toEqual(["0.6.1", "0.6.0"]);
    expect(changesBetween("0.6.1", "0.5.0").map((e) => e.version)).toEqual(["0.6.1", "0.6.0"]);
    expect(changesBetween("0.6.1", "0.6.1")).toEqual([]);
  });

  it("summarises what lies between two engines, and nothing for one version", () => {
    const s = engineChangeSummary("scsim-0.5.0", "scsim-0.6.1+ce3483abda4e");
    expect(s).toMatch(/^2 versions between them; .*0\.6\.1.*results for some projects/);
    expect(engineChangeSummary("scsim-0.6.1+aaaaaaaaaaaa", "scsim-0.6.1+bbbbbbbbbbbb")).toBeNull();
    expect(engineChangeSummary("worker-legacy", "scsim-0.6.1")).toBeNull();
  });

  it("links a run's engine to its entry in the manual", () => {
    expect(engineDocHref("scsim-0.6.1+ce3483abda4e")).toBe("/docs/engine-versions#v0-6-1");
    expect(engineDocHref("0.2.10")).toBe("/docs/engine-versions#v0-2-10");
    expect(engineDocHref("worker-legacy")).toBe("/docs/engine-versions");
  });

  it("names the entries that touch a model's policies", () => {
    expect(touchesPolicies(changesBetween("0.5.0", "0.6.1"), ["P-P.1"]).map((e) => e.version)).toEqual(["0.6.1", "0.6.0"]);
    expect(touchesPolicies(changesBetween("0.5.0", "0.6.1"), ["P-S.2"])).toEqual([]);
  });

  it("reads the committed release report for the running version", () => {
    expect(CURRENT_ENGINE.version).toBe(ENGINE_CHANGES[0].version);
    const r = RELEASE_REPORTS[CURRENT_ENGINE.version];
    expect(r?.version).toBe(CURRENT_ENGINE.version);
    expect(changeFor(r!.previous_version)).not.toBeNull();
  });

  it("a comparison across versions names what lies between them", () => {
    const side = (cv: string, policy: string) => ({
      scenario: { crn: true, seed: 42, disruption_schedule: [] },
      run: { policy_version_id: policy, dataset_version_id: "d", code_version: cv, seed: 42, disruption_schedule: [] },
    });
    const f = comparabilityFailures(side("scsim-0.5.0", "p1") as never, side("scsim-0.6.1+ce3483abda4e", "p2") as never);
    expect(f.join(" ")).toMatch(/engine versions differ \(0\.5\.0 vs 0\.6\.1\) — 2 versions between them;.*re-run one side/);
  });
});
