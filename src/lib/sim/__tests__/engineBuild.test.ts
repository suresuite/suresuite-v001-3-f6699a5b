import { describe, expect, it } from "vitest";

import { engineDifference, engineLabelText, parseCodeVersion } from "../engineBuild";

// PLAN.md §25 · WP 15.1 · §4 D293 — a run's code_version names its BUILD.
describe("engineBuild", () => {
  it("reads version and build from a WP 15.1 label, and only the version from an older one", () => {
    expect(parseCodeVersion("scsim-0.6.1+ce3483abda4e")).toEqual({ slug: "scsim", version: "0.6.1", build: "ce3483abda4e" });
    expect(parseCodeVersion("scsim-0.6.1")).toEqual({ slug: "scsim", version: "0.6.1", build: null });
    expect(parseCodeVersion("worker-legacy")).toEqual({ slug: "worker-legacy", version: null, build: null });
    expect(parseCodeVersion("")).toBeNull();
  });

  it("labels a run for a person", () => {
    expect(engineLabelText("scsim-0.6.1+ce3483abda4e")).toBe("0.6.1 (build ce3483abda4e)");
    expect(engineLabelText("scsim-0.6.1")).toBe("0.6.1 (build not recorded)");
    expect(engineLabelText(null)).toBe("unknown engine");
  });

  it("tells the three ways two engines differ apart", () => {
    expect(engineDifference("scsim-0.6.1+aaa", "scsim-0.6.1+aaa")).toBeNull();
    expect(engineDifference("scsim-0.6.0+aaa", "scsim-0.6.1+bbb")).toBe("engine versions differ (0.6.0 vs 0.6.1)");
    expect(engineDifference("scsim-0.6.1+aaa", "scsim-0.6.1+bbb")).toBe(
      "same engine version 0.6.1, different builds (aaa vs bbb)",
    );
    expect(engineDifference("scsim-0.6.1", "scsim-0.6.1+bbb")).toMatch(/predates build identity/);
    expect(engineDifference("worker-legacy", "scsim-0.6.1+bbb")).toBe("the engines differ (worker-legacy vs scsim-0.6.1+bbb)");
  });
});
