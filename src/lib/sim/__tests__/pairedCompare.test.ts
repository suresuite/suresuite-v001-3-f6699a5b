import { describe, expect, it } from "vitest";
import { pairedDifference } from "@/lib/sim/pairedCompare";
import { pairedT } from "@/lib/sim/stats";

const reps = (vals: number[], key = "fill_rate", seedBase = 0) =>
  vals.map((v, i) => ({ rep_index: i, status: "done", kpis: { [key]: v, model_rep: seedBase + i } }));

// Audit F-14. The Compare panel REQUIRED CRN pairing and then compared run-level
// means with overlapping error bars, discarding the pairing — so a policy that
// is better in every single replication could read "overlapping", and the arrow
// was drawn on any |delta| > 1e-9, so noise got a winner.
describe("paired per-replication difference", () => {
  // Every replication of B is exactly 0.01 better, on top of a large common
  // random swing. Unpaired intervals overlap; the paired one is tight.
  const common = [0.70, 0.95, 0.60, 0.99, 0.75, 0.85, 0.65, 0.90];
  const A = reps(common);
  const B = reps(common.map((v) => v + 0.01));

  it("pairs by replication and finds the consistent gain", () => {
    const d = pairedDifference(A, B, "fill_rate")!;
    expect(d.n).toBe(8);
    expect(d.mean).toBeCloseTo(0.01, 12);
    expect(d.halfWidth).toBeCloseTo(0, 12);
    expect(d.separated).toBe(true);
  });

  it("agrees with pairedT, which had no caller", () => {
    const noisy = reps(common.map((v, i) => v + 0.01 + (i % 2 ? 0.004 : -0.004)));
    const d = pairedDifference(A, noisy, "fill_rate")!;
    const { t, df } = pairedT(noisy.map((r) => r.kpis.fill_rate), common);
    expect(df).toBe(d.n - 1);
    expect(t).toBeCloseTo(d.mean / (d.sd / Math.sqrt(d.n)), 9);
  });

  it("noise gets no winner: a difference whose CI spans 0 is not separated", () => {
    const B2 = reps(common.map((v, i) => v + (i % 2 ? 0.03 : -0.02)));
    const d = pairedDifference(A, B2, "fill_rate")!;
    // a real, nonzero mean (+0.005) whose interval still spans 0 — the case the
    // old |delta| > 1e-9 rule drew an arrow for
    expect(d.mean).toBeCloseTo(0.005, 12);
    expect(d.separated).toBe(false);
  });

  it("pairs by the replication's seed, not by array position", () => {
    const Bshuffled = [...B].reverse();
    expect(pairedDifference(A, Bshuffled, "fill_rate")!.mean).toBeCloseTo(0.01, 12);
  });

  it("pairs by the CRN cell (model_rep, event_rep), not by rep_index", () => {
    // Stochastic events: each model seed carries two event replications, and the
    // two runs happened to number their rows differently.
    const cell = (i: number, mr: number, er: number, v: number) =>
      ({ rep_index: i, status: "done", kpis: { fill_rate: v, model_rep: mr, event_rep: er } });
    const A2 = [cell(0, 0, 0, 0.5), cell(1, 0, 1, 0.9), cell(2, 1, 0, 0.6), cell(3, 1, 1, 0.8)];
    const B2 = [cell(0, 1, 1, 0.81), cell(1, 1, 0, 0.61), cell(2, 0, 1, 0.91), cell(3, 0, 0, 0.51)];
    const d = pairedDifference(A2, B2, "fill_rate")!;
    expect(d.n).toBe(4);
    expect(d.mean).toBeCloseTo(0.01, 12);
    expect(d.separated).toBe(true);
  });

  it("returns null when fewer than two replications pair", () => {
    expect(pairedDifference(A.slice(0, 1), B.slice(0, 1), "fill_rate")).toBeNull();
    expect(pairedDifference(A, reps([0.9, 0.9], "revenue"), "fill_rate")).toBeNull();
  });
});

import { compareRows } from "@/lib/sim/pairedCompare";

describe("the Compare table reads the paired test, not the overlap", () => {
  const common = [0.70, 0.95, 0.60, 0.99, 0.75, 0.85, 0.65, 0.90];
  const A = reps(common);
  const B = reps(common.map((v) => v + 0.01));
  const aggA = { fill_rate: 0.799 }, aggB = { fill_rate: 0.809 };
  const ci = { fill_rate: 0.1 };

  it("a consistent paired gain is separated and gets a direction, although the run CIs overlap", () => {
    const [r] = compareRows(aggA, aggB, ci, ci, A, B);
    expect(r.basis).toBe("paired");
    expect(r.overlap).toBe(false);
    expect(r.better).toBe(true);
  });

  it("without replication rows there is no direction and it says unpaired", () => {
    const [r] = compareRows(aggA, aggB, ci, ci, [], []);
    expect(r.basis).toBe("unpaired");
    expect(r.better).toBeNull();
  });

  it("a paired difference that spans 0 draws no arrow", () => {
    const B2 = reps(common.map((v, i) => v + (i % 2 ? 0.03 : -0.02)));
    const [r] = compareRows(aggA, aggB, ci, ci, A, B2);
    expect(r.better).toBeNull();
    expect(r.overlap).toBe(true);
  });
});
