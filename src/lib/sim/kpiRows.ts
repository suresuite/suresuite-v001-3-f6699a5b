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
/** The engine release that stopped substituting a 100% TTR baseline and
 *  averaging censored recoveries (`scsim/scsim/__init__.py`, audit WP 3). */
export const RECOVERY_FIX_ENGINE = "0.2.4";

/** Per-replication flags the engine emits beside the recovery measures. They
 *  annotate the TTR/TTS rows and are not KPIs of their own. */
const RECOVERY_FLAGS = new Set(["recovery_measurable", "ttr_censored", "tts_censored"]);
const RECOVERY_KEYS = ["ttr_weeks", "tts_weeks", "pre_disruption_fill_rate"] as const;
const CENSOR_FLAG: Record<string, string> = { ttr_weeks: "ttr_censored", tts_weeks: "tts_censored" };
const CENSOR_WORDS: Record<string, string> = {
  ttr_weeks: "never recovered inside the window",
  tts_weeks: "never left the band (survived the whole window)",
};

function versionBefore(codeVersion: string | null | undefined, fix: string): boolean {
  const m = /^scsim-(\d+)\.(\d+)\.(\d+)/.exec(codeVersion ?? "");
  if (!m) return false;
  const [a, b] = [m.slice(1).map(Number), fix.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Beside every measured mean when the run stopped by the sequential-CI rule
 *  (audit F-13): the interval is a plain t-interval over a sample whose size was
 *  chosen by watching that interval, so it is narrower than its nominal level. */
export const SEQUENTIAL_NOTE =
  "sequential stopping: replications were added until this interval was narrow enough, " +
  "so it understates the uncertainty";

export function buildKpiRows(
  reps: Replication[], codeVersion?: string | null, stoppingRule?: string | null,
): KpiStat[] {
  const done = reps.filter((r) => r.status === "done");
  const flagged = done.some((r) => "recovery_measurable" in (r.kpis ?? {}));
  const preFix = versionBefore(codeVersion, RECOVERY_FIX_ENGINE);
  // Every key any completed replication carries. A disrupted run carries
  // `ttr_weeks` and an undisrupted one does not, so the union is the honest set
  // and `n` (below) says how many replications each measure actually came from.
  const present = done.flatMap((r) => Object.keys(r.kpis ?? {})).filter((k) => !RECOVERY_FLAGS.has(k));
  // A run that measured recovery keeps all three rows even when every
  // replication was censored or unmeasurable — the row says why.
  const keys = [...new Set(flagged ? [...present, ...RECOVERY_KEYS] : present)].sort((a, b) => {
    const ia = KPI_ORDER.get(a);
    const ib = KPI_ORDER.get(b);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.localeCompare(b);
  });
  const recoveryNote = (key: string): string | undefined => {
    if (preFix && (RECOVERY_KEYS as readonly string[]).includes(key)) {
      return `computed before scsim-${RECOVERY_FIX_ENGINE}: may rest on a substituted 100% ` +
        "baseline and average never-recovered replications as if measured — re-run to trust it";
    }
    if (!flagged || !(RECOVERY_KEYS as readonly string[]).includes(key)) return undefined;
    const total = done.length;
    const parts: string[] = [];
    const flag = CENSOR_FLAG[key];
    const censored = flag ? done.filter((r) => r.kpis?.[flag] === 1).length : 0;
    if (censored) parts.push(`${censored} of ${total} ${CENSOR_WORDS[key]}`);
    const unmeasurable = done.filter((r) => r.kpis?.recovery_measurable === 0).length;
    if (unmeasurable) parts.push(`${unmeasurable} of ${total} had no pre-disruption week to measure against`);
    return parts.length ? `not in the mean: ${parts.join("; ")}` : undefined;
  };

  return keys.map((key) => {
    const kpi = kpiDisplay(key);
    const xs = done.map((r) => r.kpis[key]).filter((n): n is number => typeof n === "number");
    const recovery = recoveryNote(key);
    const note = stoppingRule === "sequential_ci"
      ? [recovery, SEQUENTIAL_NOTE].filter(Boolean).join("; ")
      : recovery;
    if (xs.length === 0) {
      return {
        key, label: kpi.label, mean: "not measured",
        ci: kpi.whenAbsent ?? NOT_MEASURED_REASON, std: "—", min: "—", max: "—", n: 0, note,
      };
    }
    const stat = summarize(xs);
    return {
      note,
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
