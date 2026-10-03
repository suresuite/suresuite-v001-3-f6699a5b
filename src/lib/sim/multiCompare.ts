/**
 * One baseline against many scenarios — §9.3, applied once per challenger.
 *
 * §9.3 defines comparability for a PAIR, and that does not change here: a
 * many-scenario comparison is a set of paired experiments that share their A
 * side, each one tested on its own by `comparabilityFailures` and each cell the
 * CRN-paired difference `compareRows` already computes. Nothing is compared
 * challenger-to-challenger — two stress scenarios usually differ from each other
 * in the same component they differ from the baseline in, but nothing proves
 * it, so the matrix only ever reads "B − baseline".
 *
 * What this module adds is what a reader of ten columns needs that a reader of
 * one does not: a per-challenger tally, an order (rank by one KPI, direction-
 * aware), the best separated improvement per KPI, and the KPI rows the matrix
 * shows. All pure, so the desktop matrix and the phone list read one answer.
 */
import { kpiDisplay } from "@/lib/sim/kpiDisplay";
import type { CompareRow } from "@/components/sim/resultTables";

export interface Tally {
  /** separated, and better by the KPI's own direction */
  better: number;
  /** separated, and worse */
  worse: number;
  /** separated, on a KPI with no "better" (a descriptor such as inventory) */
  changed: number;
  /** paired, and the interval spans 0 */
  notSeparated: number;
  /** no replication rows on one side — no direction is drawn */
  unpaired: number;
}

export function tally(rows: CompareRow[]): Tally {
  const t: Tally = { better: 0, worse: 0, changed: 0, notSeparated: 0, unpaired: 0 };
  for (const r of rows) {
    if (r.basis === "unpaired") t.unpaired++;
    else if (r.better === true) t.better++;
    else if (r.better === false) t.worse++;
    else if (!r.overlap) t.changed++;
    else t.notSeparated++;
  }
  return t;
}

/** The tally in words, zero parts omitted. */
export function tallyLine(t: Tally): string {
  const parts = [
    t.better && `${t.better} better`,
    t.worse && `${t.worse} worse`,
    t.changed && `${t.changed} changed`,
    t.notSeparated && `${t.notSeparated} within noise`,
    t.unpaired && `${t.unpaired} unpaired`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no shared KPIs";
}

export interface ChallengerRows {
  id: string;
  rows: CompareRow[];
}

/**
 * Challengers ordered by their delta on `kpi`, best first by the KPI's own
 * direction (a descriptor ranks by size of change). A challenger without the
 * KPI goes last. `kpi` null keeps the input order. Stable.
 */
export function rankChallengers<T extends ChallengerRows>(list: T[], kpi: string | null): T[] {
  if (!kpi) return list;
  const dir = kpiDisplay(kpi).higherIsBetter;
  const score = (c: T) => {
    const r = c.rows.find((x) => x.key === kpi);
    if (!r) return -Infinity;
    return dir === null ? Math.abs(r.deltaValue) : dir ? r.deltaValue : -r.deltaValue;
  };
  return list
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((x, y) => (y.s === x.s ? x.i - y.i : y.s - x.s))
    .map((x) => x.c);
}

/**
 * Per KPI, the challenger whose SEPARATED improvement is largest — the only
 * kind of "best" the paired test licenses. A KPI where no challenger is
 * separated-better has no entry: noise gets no winner (audit F-14).
 */
export function bestPerKpi(list: ChallengerRows[]): Map<string, string> {
  const best = new Map<string, { id: string; gain: number }>();
  for (const c of list) {
    for (const r of c.rows) {
      if (r.better !== true) continue;
      const gain = Math.abs(r.deltaValue);
      const cur = best.get(r.key);
      if (!cur || gain > cur.gain) best.set(r.key, { id: c.id, gain });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.id]));
}

/** The matrix's rows: every KPI at least one challenger shares with the
 *  baseline, in the order the challengers' rows give them. */
export function matrixKpis(list: ChallengerRows[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const c of list) for (const r of c.rows) if (!seen.has(r.key)) seen.set(r.key, r.label);
  return [...seen].map(([key, label]) => ({ key, label }));
}
