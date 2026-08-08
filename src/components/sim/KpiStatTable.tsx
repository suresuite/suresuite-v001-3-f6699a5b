import { useMemo } from "react";
import { KpiStatTable as KpiStatTableView, type KpiStat } from "./resultTables";
import type { Replication } from "@/hooks/useSimulationRun";
import { summarize } from "@/lib/sim/stats";
import { KPI_DISPLAY } from "@/lib/sim/kpiDisplay";

interface Props {
  reps: Replication[];
  /** The scenario's objective — its row is banded and rule-marked. */
  primaryKpi?: string;
}

/** Cross-replication KPI summary. The math is unchanged — the formatting now
 *  happens here and the table only renders strings. */
export function KpiStatTable({ reps, primaryKpi }: Props) {
  const rows = useMemo<KpiStat[]>(() => {
    const done = reps.filter((r) => r.status === "done");
    return KPI_DISPLAY.map((kpi) => {
      const xs = done.map((r) => r.kpis[kpi.key]).filter((n): n is number => typeof n === "number");
      const stat = summarize(xs);
      return {
        key: kpi.key,
        label: kpi.label,
        mean: kpi.format(stat.mean),
        ci: `± ${kpi.format(stat.ci95)}`,
        std: kpi.format(stat.std),
        min: kpi.format(stat.min),
        max: kpi.format(stat.max),
        n: stat.n,
      };
    }).filter((row) => row.n > 0);
  }, [reps]);

  return (
    <section className="overflow-hidden rounded-sm border border-[#e0e0e3] bg-white">
      <div className="flex items-center gap-[9px] border-b border-[#e0e0e3] px-3 py-[9px]">
        <span className="text-[13.5px] font-semibold tracking-[-0.011em] text-[#18181b]">
          KPI summary across replications
        </span>
        <span className="ml-auto text-[11.5px] tabular-nums text-[#52525b]">
          {rows.length} {rows.length === 1 ? "KPI" : "KPIs"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-[10px] text-[12.5px] text-[#71717a]">
          No completed replications yet
        </div>
      ) : (
        <KpiStatTableView rows={rows} primaryKpi={primaryKpi ?? ""} />
      )}
    </section>
  );
}
