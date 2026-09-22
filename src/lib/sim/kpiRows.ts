import type { KpiStat } from "@/components/sim/resultTables";
import type { Replication } from "@/hooks/useSimulationRun";
import { KPI_ORDER, NOT_MEASURED_REASON, kpiDisplay } from "@/lib/sim/kpiDisplay";
import { summarize } from "@/lib/sim/stats";

/**
 * The rows, as a pure function so the table's honesty is testable
 * (`kpiRowsAbsent.test.ts`).
 *
 * A key the run CARRIES but that has no number on any replication is kept, with
 * the reason (audit F-31). It used to be dropped by `n > 0`, and the engine
 * sends NaN as null for a measurement that does not exist — a supplier
 * utilization when every supplier is unlimited — so the row vanished and the
 * reader could not tell "not measured" from "not computed".
 */
export function buildKpiRows(reps: Replication[]): KpiStat[] {
  const done = reps.filter((r) => r.status === "done");
  // Every key any completed replication carries. A disrupted run carries
  // `ttr_weeks` and an undisrupted one does not, so the union is the honest set
  // and `n` (below) says how many replications each measure actually came from.
  const keys = [...new Set(done.flatMap((r) => Object.keys(r.kpis ?? {})))].sort((a, b) => {
    const ia = KPI_ORDER.get(a);
    const ib = KPI_ORDER.get(b);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.localeCompare(b);
  });
  return keys.map((key) => {
    const kpi = kpiDisplay(key);
    const xs = done.map((r) => r.kpis[key]).filter((n): n is number => typeof n === "number");
    if (xs.length === 0) {
      return {
        key, label: kpi.label, mean: "not measured",
        ci: kpi.whenAbsent ?? NOT_MEASURED_REASON, std: "—", min: "—", max: "—", n: 0,
      };
    }
    const stat = summarize(xs);
    return {
      key,
      label: kpi.label,
      mean: kpi.format(stat.mean),
      ci: `± ${kpi.format(stat.ci95)}`,
      std: kpi.format(stat.std),
      min: kpi.format(stat.min),
      max: kpi.format(stat.max),
      n: stat.n,
    };
  });
}
