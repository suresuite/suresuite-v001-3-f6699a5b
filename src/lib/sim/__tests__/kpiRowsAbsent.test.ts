import { describe, expect, it } from "vitest";
import { buildKpiRows } from "@/lib/sim/kpiRows";
import type { Replication } from "@/hooks/useSimulationRun";

const rep = (i: number, kpis: Record<string, number | null>): Replication =>
  ({ id: `r${i}`, run_id: "run", rep_index: i, seed_used: 0, status: "done",
     kpis: kpis as Record<string, number>, time_series: {}, warmup_at: null,
     started_at: null, ended_at: null }) as Replication;

// Audit F-31: a measure the engine sends as null (NaN → null in the bridge) on
// every replication used to be dropped by `n > 0`, so the row vanished with no
// reason. `supplier_capacity_utilization` is NaN whenever no supplier declares a
// finite capacity — 60 of 60 in the project §15 measures.
describe("a KPI the engine could not measure keeps its row and says why", () => {
  const reps = [rep(0, { fill_rate: 0.9, supplier_capacity_utilization: null }),
                rep(1, { fill_rate: 0.8, supplier_capacity_utilization: null })];
  const rows = buildKpiRows(reps);

  it("the row is present with n = 0", () => {
    const row = rows.find((r) => r.key === "supplier_capacity_utilization");
    expect(row).toBeDefined();
    expect(row!.n).toBe(0);
    expect(row!.mean).toBe("not measured");
    expect(row!.ci).toMatch(/finite capacity/);
  });

  it("an unnamed measure gets the generic reason", () => {
    const r = buildKpiRows([rep(0, { some_new_key: null })]);
    expect(r[0].ci).toMatch(/no value on any replication/);
  });

  it("measured rows are unchanged", () => {
    const fr = rows.find((r) => r.key === "fill_rate")!;
    expect(fr.n).toBe(2);
    expect(fr.mean).not.toBe("not measured");
  });
});
