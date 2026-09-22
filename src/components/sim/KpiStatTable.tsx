import { useMemo } from "react";
import { KpiStatTable as KpiStatTableView, type KpiStat } from "./resultTables";
import { TableBlock } from "@/components/shared";
import type { Replication } from "@/hooks/useSimulationRun";
import { buildKpiRows } from "@/lib/sim/kpiRows";

interface Props {
  reps: Replication[];
  /** The scenario's objective — its row is banded and rule-marked. */
  primaryKpi?: string;
  /** The run's engine, so rows computed before a fix are marked (audit WP 3). */
  codeVersion?: string | null;
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
export function KpiStatTable({ reps, primaryKpi, codeVersion }: Props) {
  const rows = useMemo<KpiStat[]>(() => buildKpiRows(reps, codeVersion), [reps, codeVersion]);

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
