import { describe, expect, it } from "vitest";
import { meanCI, studentTCdf, studentTQuantile, welchTTest } from "../validationStats";
import {
  adoptionDecision,
  buildProtocol,
  protocolLine,
  protocolProblems,
  warmupAcrossKpis,
} from "../validatedModel";

// WP 10.3 · §4 D244 — Run & Validate's statistics, made as strong as the model they produce.

describe("Student-t, not z, at the n a replication study has", () => {
  it("matches tabulated quantiles", () => {
    expect(studentTQuantile(0.975, 4)).toBeCloseTo(2.776, 3);
    expect(studentTQuantile(0.975, 9)).toBeCloseTo(2.262, 3);
    expect(studentTQuantile(0.995, 29)).toBeCloseTo(2.756, 3);
    expect(studentTQuantile(0.95, 1)).toBeCloseTo(6.314, 3);
    expect(studentTQuantile(0.975, 1e6)).toBeCloseTo(1.96, 2);
  });
  it("the CDF is the quantile's inverse", () => {
    for (const df of [2, 5, 30]) {
      expect(studentTCdf(studentTQuantile(0.9, df), df)).toBeCloseTo(0.9, 6);
    }
  });
  it("meanCI's half-width at n = 5 is t₀.₉₇₅,₄ · s/√n, wider than z would give", () => {
    const xs = [10, 12, 9, 11, 13];
    const { mean, half } = meanCI(xs, 0.95);
    const s = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / 4);
    expect(half).toBeCloseTo((2.776 * s) / Math.sqrt(5), 2);
    expect(half).toBeGreaterThan((1.96 * s) / Math.sqrt(5));
  });
  it("Welch's p-value uses the t distribution", () => {
    const r = welchTTest([1, 2, 3, 4], [3, 4, 5, 6]);
    // two-sided p for t = -2.191, df = 6 is 0.071 (normal would say 0.028)
    expect(r.p).toBeCloseTo(0.071, 2);
  });
});

describe("warm-up is the MAXIMUM detected week over the selected KPIs", () => {
  const rising = (n: number, until: number) =>
    Array.from({ length: n }, (_, t) => (t < until ? t / until : 1));
  it("each KPI's week is kept and the adopted week is the largest", () => {
    const r = warmupAcrossKpis(
      { fill_rate: [rising(80, 10), rising(80, 10)], max_backlog: [rising(80, 30), rising(80, 30)] },
      "mser5",
    );
    expect(r.perKpi.fill_rate).not.toBeNull();
    expect(r.perKpi.max_backlog).not.toBeNull();
    expect(r.adoptedWeek).toBe(Math.max(r.perKpi.fill_rate!, r.perKpi.max_backlog!));
    expect(r.perKpi.max_backlog!).toBeGreaterThanOrEqual(r.perKpi.fill_rate!);
  });
  it("a KPI with no weekly series is SAID to have none, not counted as week 0", () => {
    const r = warmupAcrossKpis({ fill_rate: [rising(60, 10)], cost_total: [] }, "welch");
    expect(r.perKpi.cost_total).toBeNull();
    expect(r.withoutSeries).toEqual(["cost_total"]);
  });
});

describe("the adoption rule (D244: one passing KPI used to be enough)", () => {
  const pass = (kpi: string) => ({ kpi, n: 30, pass: true });
  const fail = (kpi: string) => ({ kpi, n: 30, pass: false });
  it("every selected KPI must have run and passed", () => {
    expect(adoptionDecision({ selectedKpis: ["fill_rate", "max_backlog"], tests: [pass("fill_rate"), fail("max_backlog")], faceStatement: "" }).ready).toBe(false);
    expect(adoptionDecision({ selectedKpis: ["fill_rate", "max_backlog"], tests: [pass("fill_rate")], faceStatement: "" }).ready).toBe(false);
    const ok = adoptionDecision({ selectedKpis: ["fill_rate", "max_backlog"], tests: [pass("fill_rate"), pass("max_backlog")], faceStatement: "" });
    expect(ok).toMatchObject({ ready: true, basis: "statistical" });
  });
  it("without tests, only a recorded face-validation statement adopts", () => {
    expect(adoptionDecision({ selectedKpis: ["fill_rate"], tests: [], faceStatement: "   " }).ready).toBe(false);
    expect(adoptionDecision({ selectedKpis: ["fill_rate"], tests: [], faceStatement: "Reviewed with ops." }))
      .toMatchObject({ ready: true, basis: "face" });
  });
  it("a failing test is not overridden by a statement", () => {
    expect(adoptionDecision({ selectedKpis: ["fill_rate"], tests: [fail("fill_rate")], faceStatement: "trust me" }).ready).toBe(false);
  });
});

describe("the protocol", () => {
  const p = buildProtocol({
    replications: 30, rootSeed: 42, crn: true, warmupWeek: 12, horizonWeeks: 156,
    ciLevel: 0.95, ciHalfwidthTarget: 0.05, stoppingRule: "fixed_horizon",
  });
  it("is complete, with the window derived as horizon − warm-up", () => {
    expect(p.analysis_window_weeks).toBe(144);
    expect(protocolProblems(p)).toEqual([]);
  });
  it("reads in one line", () => {
    expect(protocolLine(p)).toBe("30 replications · 156 weeks · results from wk 12");
  });
  it("refuses what the database refuses", () => {
    expect(protocolProblems({ ...p, replications: 500 })).not.toEqual([]);
    expect(protocolProblems({ ...p, analysis_window_weeks: 150 })).not.toEqual([]);
    expect(protocolProblems({ ...p, stopping_rule: "ci_halfwidth", ci_halfwidth_target: null })).not.toEqual([]);
  });
});
