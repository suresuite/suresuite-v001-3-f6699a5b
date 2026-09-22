import { describe, expect, it } from "vitest";
import { buildKpiRows, RECOVERY_FIX_ENGINE } from "@/lib/sim/kpiRows";
import type { Replication } from "@/hooks/useSimulationRun";

const rep = (i: number, kpis: Record<string, number>): Replication =>
  ({ id: `r${i}`, run_id: "run", rep_index: i, seed_used: 0, status: "done", kpis,
     time_series: {}, warmup_at: null, started_at: null, ended_at: null }) as Replication;

// Audit WP 3 (F-04/F-05). The engine now emits a recovery measure only when it
// was measured, plus flags; the table must not show the flags as KPIs and must
// say beside TTR how many replications never recovered.
describe("recovery measures in the KPI table", () => {
  const reps = [
    rep(0, { fill_rate: 0.9, recovery_measurable: 1, pre_disruption_fill_rate: 0.95,
             ttr_weeks: 4, tts_weeks: 1, ttr_censored: 0, tts_censored: 0 }),
    rep(1, { fill_rate: 0.8, recovery_measurable: 1, pre_disruption_fill_rate: 0.95,
             tts_weeks: 0, ttr_censored: 1, tts_censored: 0 }),
    rep(2, { fill_rate: 0.85, recovery_measurable: 0 }),
  ];
  const rows = buildKpiRows(reps, "scsim-0.2.4");
  const byKey = (k: string) => rows.find((r) => r.key === k);

  it("the flags are not rows of their own", () => {
    for (const k of ["ttr_censored", "tts_censored", "recovery_measurable"]) {
      expect(byKey(k)).toBeUndefined();
    }
  });

  it("TTR says how many never recovered and how many could not be measured", () => {
    const ttr = byKey("ttr_weeks")!;
    expect(ttr.n).toBe(1);
    expect(ttr.note).toMatch(/1 of 3 never recovered inside the window/);
    expect(ttr.note).toMatch(/1 of 3 had no pre-disruption week/);
  });

  it("an all-censored TTR keeps its row rather than vanishing", () => {
    const r = buildKpiRows([rep(0, { recovery_measurable: 1, ttr_censored: 1, tts_weeks: 0,
                                     tts_censored: 0, pre_disruption_fill_rate: 0.9 })], "scsim-0.2.4");
    const ttr = r.find((x) => x.key === "ttr_weeks")!;
    expect(ttr.mean).toBe("not measured");
    expect(ttr.note).toMatch(/1 of 1 never recovered/);
  });

  it("a run from an engine before the fix is marked, not trusted", () => {
    const old = buildKpiRows([rep(0, { ttr_weeks: 52, tts_weeks: 0, pre_disruption_fill_rate: 1 })],
                             "scsim-0.2.3");
    for (const k of ["ttr_weeks", "tts_weeks", "pre_disruption_fill_rate"]) {
      expect(old.find((x) => x.key === k)!.note).toMatch(/before scsim-0\.2\.4/);
    }
    expect(RECOVERY_FIX_ENGINE).toBe("0.2.4");
  });
});
