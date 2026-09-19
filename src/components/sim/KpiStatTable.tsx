import { useMemo } from "react";
import { KpiStatTable as KpiStatTableView, type KpiStat } from "./resultTables";
import { TableBlock } from "@/components/shared";
import type { Replication } from "@/hooks/useSimulationRun";
import { summarize } from "@/lib/sim/stats";
import { KPI_ORDER, kpiDisplay } from "@/lib/sim/kpiDisplay";

interface Props {
  reps: Replication[];
  /** The scenario's objective — its row is banded and rule-marked. */
  primaryKpi?: string;
}

/**
 * Cross-replication KPI summary. The math is unchanged — the formatting happens
 * here and the table only renders strings.
 *
 * ── DRIVEN BY WHAT THE RUN CARRIES, NOT BY THE CATALOG — §4 D113 ───────────
 *
 * This used to map over `KPI_DISPLAY` and look each key up on the replication rows,
 * so it could only ever show measures that list named. `KPI_DISPLAY` is the LEGACY
 * engine's vocabulary and the canonical engine emits a different set; the
 * intersection was TWO names, so eleven of thirteen rows could never appear —
 * including `cost_of_resilience` and every cost component. Nothing wrong was
 * displayed, because a row with no data is dropped rather than shown as zero, which
 * is why it survived a phase: this was measure LOSS, not a wrong number.
 *
 * It now reads the keys off the rows and looks the LABEL up. A measure the engine
 * adds appears the next time a run finishes, under its raw key until somebody names
 * it — visible and slightly ugly beats invisible and tidy, and
 * `runKpiVocabulary.test.ts` fails when a key the engine always emits has no label.
 *
 * The ORDER is the catalog's, then alphabetical for the rest, so two runs of the
 * same shape produce the same table and an unnamed measure does not jump around.
 */
export function KpiStatTable({ reps, primaryKpi }: Props) {
  const rows = useMemo<KpiStat[]>(() => {
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
