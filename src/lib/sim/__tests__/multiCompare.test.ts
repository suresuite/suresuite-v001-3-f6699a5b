import { describe, expect, it } from "vitest";
import { compareRows } from "@/lib/sim/pairedCompare";
import { bestPerKpi, matrixKpis, rankChallengers, tally, tallyLine } from "@/lib/sim/multiCompare";

// One baseline against many scenarios: every cell is still the CRN-paired
// difference of one pair (§9.3), so these tests build each challenger's rows
// through `compareRows` exactly as the panel does.
const reps = (rows: Record<string, number>[]) =>
  rows.map((kpis, i) => ({ rep_index: i, status: "done", kpis: { ...kpis, model_rep: i } }));
const agg = (rows: Record<string, number>[]) =>
  Object.fromEntries(Object.keys(rows[0]).map((k) => [k, rows.reduce((s, r) => s + r[k], 0) / rows.length]));
const side = (rows: Record<string, number>[]) => ({ agg: agg(rows), reps: reps(rows) });

const swing = [0.7, 0.95, 0.6, 0.99, 0.75, 0.85];
const base = side(swing.map((f, i) => ({ fill_rate: f, max_backlog: 100 + i * 10, avg_fg_units: 50 })));
const challenger = (df: number, db: number, dInv: number, noise = 0) =>
  side(swing.map((f, i) => ({
    fill_rate: f + df + (i % 2 ? noise : -noise),
    max_backlog: 100 + i * 10 + db,
    avg_fg_units: 50 + dInv,
  })));
const rowsOf = (c: ReturnType<typeof side>) => compareRows(base.agg, c.agg, {}, {}, base.reps, c.reps);

describe("one baseline against many scenarios", () => {
  const better = { id: "better", rows: rowsOf(challenger(0.02, -5, 0)) };
  const worse = { id: "worse", rows: rowsOf(challenger(-0.01, 8, 10)) };
  const noisy = { id: "noisy", rows: rowsOf(challenger(0.03, 0, 0, 0.2)) };

  it("tallies each challenger by the paired test, never by the raw delta", () => {
    expect(tally(better.rows)).toEqual({ better: 2, worse: 0, changed: 0, notSeparated: 1, unpaired: 0 });
    // inventory has no "better": a separated change is counted as a change
    expect(tally(worse.rows)).toEqual({ better: 0, worse: 2, changed: 1, notSeparated: 0, unpaired: 0 });
    expect(tallyLine(tally(worse.rows))).toBe("2 worse · 1 changed");
    // the largest fill-rate delta of the three, and inside the noise
    expect(noisy.rows.find((r) => r.key === "fill_rate")!.better).toBeNull();
  });

  it("an unpaired row draws no direction and is counted as unpaired", () => {
    const c = challenger(0.02, -5, 0);
    const rows = compareRows(base.agg, c.agg, {}, {}, [], []);
    expect(tally(rows).unpaired).toBe(3);
    expect(tallyLine({ better: 0, worse: 0, changed: 0, notSeparated: 0, unpaired: 0 })).toBe("no shared KPIs");
  });

  it("ranks by one KPI in that KPI's own direction", () => {
    const order = (kpi: string | null) => rankChallengers([worse, noisy, better], kpi).map((c) => c.id);
    expect(order(null)).toEqual(["worse", "noisy", "better"]);
    expect(order("fill_rate")).toEqual(["noisy", "better", "worse"]);
    // lower backlog is better
    expect(order("max_backlog")).toEqual(["better", "noisy", "worse"]);
    // a challenger without the KPI goes last
    expect(rankChallengers([{ id: "none", rows: [] }, better], "fill_rate").map((c) => c.id)).toEqual(["better", "none"]);
  });

  it("names a best challenger per KPI only where one is separated-better", () => {
    const best = bestPerKpi([worse, noisy, better]);
    // noisy has the larger fill-rate mean gain, but it is not separated
    expect(best.get("fill_rate")).toBe("better");
    expect(best.get("max_backlog")).toBe("better");
    expect(best.has("avg_fg_units")).toBe(false);
  });

  it("the matrix rows are the KPIs any challenger shares with the baseline", () => {
    expect(matrixKpis([{ id: "x", rows: [] }, better]).map((k) => k.key)).toEqual([
      "fill_rate", "max_backlog", "avg_fg_units",
    ]);
  });
});
