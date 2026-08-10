import { useMemo } from "react";
import { KpiStatTable as KpiStatTableView, type KpiStat } from "./resultTables";
import { TableBlock } from "@/components/shared";
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
    // L1: the table's name reads on the canvas, above the shell.
    <TableBlock name="KPI summary across replications" count={rows.length}>
      {rows.length === 0 ? (
        <div className="px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
          No completed replications yet
        </div>
      ) : (
        <KpiStatTableView rows={rows} primaryKpi={primaryKpi ?? ""} />
      )}
    </TableBlock>
  );
}
