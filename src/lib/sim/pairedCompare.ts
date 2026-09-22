/**
 * The CRN-paired difference between two runs, per KPI — audit F-14.
 *
 * `CompareScenariosPanel` refuses a comparison unless both runs are CRN-paired,
 * and then compared the two RUN MEANS with overlapping error bars — discarding
 * the pairing it had just required. Under common random numbers replication i
 * of A and replication i of B saw the same world, so the right quantity is the
 * mean of the per-replication differences, with a t-interval on THOSE: the
 * common swing cancels, and a policy better in every replication is separated
 * even when the two runs' own intervals overlap. `pairedT` in `stats.ts` has
 * computed this statistic all along and had no caller.
 *
 * Replications are paired by their CRN cell (`kpis.model_rep`, `kpis.event_rep`),
 * falling back to `rep_index` — never by array position or by run order.
 */
import { mean, std, tCritical95 } from "@/lib/sim/stats";
import { kpiDisplay, signedDelta } from "@/lib/sim/kpiDisplay";
import type { CompareRow } from "@/components/sim/resultTables";

interface RepLike {
  rep_index: number;
  status: string;
  kpis: Record<string, number | null | undefined>;
}

export interface PairedDifference {
  /** mean of B − A over paired replications */
  mean: number;
  sd: number;
  /** 95% t half-width on the mean difference */
  halfWidth: number;
  n: number;
  /** the interval excludes 0 — only then may a direction be drawn */
  separated: boolean;
}

// The CRN cell is (model_rep, event_rep): with stochastic disruptions each model
// seed carries several event replications, and keying by model_rep alone would
// let them overwrite each other. `rep_index` is a sequence number whose meaning
// depends on the run's grid, so it is only the fallback for rows with no key.
const keyOf = (r: RepLike) => {
  const m = r.kpis?.model_rep;
  const e = r.kpis?.event_rep;
  return typeof m === "number" ? `m${m}:e${typeof e === "number" ? e : 0}` : `i${r.rep_index}`;
};

export function pairedDifference(a: RepLike[], b: RepLike[], kpi: string): PairedDifference | null {
  const byKey = new Map<string, number>();
  for (const r of a) {
    const v = r.kpis?.[kpi];
    if (r.status === "done" && typeof v === "number" && Number.isFinite(v)) byKey.set(keyOf(r), v);
  }
  const diffs: number[] = [];
  for (const r of b) {
    const v = r.kpis?.[kpi];
    const va = byKey.get(keyOf(r));
    if (r.status === "done" && typeof v === "number" && Number.isFinite(v) && va !== undefined) {
      diffs.push(v - va);
    }
  }
  if (diffs.length < 2) return null;
  const m = mean(diffs);
  const sd = std(diffs);
  const halfWidth = (tCritical95(diffs.length - 1) * sd) / Math.sqrt(diffs.length);
  return { mean: m, sd, halfWidth, n: diffs.length, separated: Math.abs(m) > halfWidth };
}

/**
 * The Compare table's rows. The delta and the direction come from the PAIRED
 * difference when both runs' replication rows are present; otherwise the row
 * says `unpaired` and draws no direction at all, because a run-level mean
 * difference with overlapping error bars cannot say which run was better.
 * `better` is non-null only when the paired interval excludes 0 — the old
 * `|delta| > 1e-9` drew a winner out of noise.
 */
export function compareRows(
  kA: Record<string, unknown>, kB: Record<string, unknown>,
  ciA: Record<string, number>, ciB: Record<string, number>,
  repsA: RepLike[], repsB: RepLike[],
): CompareRow[] {
  return Object.keys(kA)
    .filter((key) => typeof kA[key] === "number" && typeof kB[key] === "number")
    .map((key) => {
      const d = kpiDisplay(key);
      const va = kA[key] as number, vb = kB[key] as number;
      const p = pairedDifference(repsA, repsB, key);
      const delta = p ? p.mean : vb - va;
      const separated = p?.separated ?? false;
      return {
        key,
        label: d.label,
        a: d.format(va),
        aci: `± ${d.format(ciA[key] ?? 0)}`,
        b: d.format(vb),
        bci: `± ${d.format(ciB[key] ?? 0)}`,
        delta: p ? `${signedDelta(delta, d.format)} ± ${d.format(p.halfWidth)}` : signedDelta(delta, d.format),
        basis: p ? "paired" : "unpaired",
        better:
          !separated || d.higherIsBetter === null ? null : d.higherIsBetter ? delta > 0 : delta < 0,
        overlap: !separated,
      };
    });
}
