import { describe, expect, it } from "vitest";
import registry from "@/lib/policies/registry.generated.json";
import { disruptionWeeks, runWindow, runWindowFooter } from "../runWindow";

// The examples are computed by the Python mapper at export time
// (`registry_export.py :: _run_window_examples`). This is the gate that keeps the
// browser's copy of the rule equal to the engine's.
describe("runWindow reproduces the engine mapper", () => {
  for (const ex of registry.run_window.examples) {
    it(`${ex.horizon_days} d horizon · ${ex.warmup_mode} ${ex.warmup_days} d warm-up`, () => {
      const w = runWindow(ex);
      expect(w.horizonWeeks).toBe(ex.horizon_weeks);
      expect(w.windowWeeks).toBe(ex.analysis_window_weeks);
      expect(w.warmupWeeks).toBe(ex.warmup_weeks);
      expect(w.measuredWeeks).toBe(ex.measured_weeks);
    });
  }
  for (const ex of registry.run_window.disruption_examples) {
    it(`disruption ${ex.start_day} d + ${ex.duration_days} d`, () => {
      expect(disruptionWeeks(ex.start_day, ex.duration_days)).toEqual({
        startWeek: ex.start_week,
        durationWeeks: ex.duration_weeks,
      });
    });
  }
});

describe("the Run-window footer states the engine's window (F-02)", () => {
  it("at the shipped defaults it says 364 d measured, not 987", () => {
    const f = runWindowFooter({ horizon_days: 1092, warmup_days: 105, warmup_mode: "manual" });
    expect(f).toContain("52 wk (364 d)");
    expect(f).not.toContain("987");
    expect(f).toContain("623 d simulated, not measured");
  });
  it("under auto warm-up it does not invent a warm-up length", () => {
    const f = runWindowFooter({ horizon_days: 1092, warmup_days: 105, warmup_mode: "auto" });
    expect(f).toContain("after the detected warm-up");
  });
  it("says when the horizon is bounded", () => {
    expect(runWindowFooter({ horizon_days: 4000, warmup_days: 0, warmup_mode: "manual" }))
      .toContain("horizon run as 520 wk");
  });
});
