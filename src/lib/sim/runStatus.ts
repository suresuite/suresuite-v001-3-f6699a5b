/**
 * What the results header says about a run — audit 2026-09-22, WP 4.
 *
 * F-07: the header never read `run.status`; a failed or cancelled run's partial
 * replications rendered under the green "Monte Carlo result · N replications".
 * F-18: which engine produced the figures was shown on mobile only.
 * F-30: nothing noticed a run whose worker died — it read "running" forever.
 *
 * `showAggregates` is false for a run that is NOT a result (failed, cancelled):
 * its replications may exist, but a mean over the ones that happened to finish
 * before a crash or a cancel is not the answer to the question the run asked.
 */
import type { SimulationRun } from "@/hooks/useSimulationRun";

/** A run whose row has not moved for this long is flagged. The worker bumps
 *  `rep_count_done` after EVERY replication, which touches `updated_at`, so ten
 *  minutes of silence is ten minutes without a finished replication — or, while
 *  queued, without the worker picking the run up at all. */
export const STALE_AFTER_MINUTES = 10;

export interface ResultsHeader {
  tone: "ok" | "warn" | "bad" | "pending";
  text: string;
  showAggregates: boolean;
}

type RunLike = Pick<SimulationRun, "status" | "code_version" | "rep_count_done" | "rep_count_target" | "error_message"> & {
  updated_at?: string | null;
};

export function resultsHeader(run: RunLike, now: number = Date.now()): ResultsHeader {
  const done = run.rep_count_done ?? 0;
  const target = run.rep_count_target ?? 0;
  const engine = run.code_version ? ` · ${run.code_version}` : "";
  switch (run.status) {
    case "done":
      return { tone: "ok", text: `Monte Carlo result · ${done} replications${engine}`, showAggregates: true };
    case "failed":
      return {
        tone: "bad",
        text: `Failed — ${run.error_message?.trim() || "the run did not finish, and recorded no reason"}. Not a result.`,
        showAggregates: false,
      };
    case "cancelled":
      return {
        tone: "warn",
        text: `Cancelled — ${done} of ${target} replications ran before the cancel; not a result.`,
        showAggregates: false,
      };
    default: {
      const since = run.updated_at ? Date.parse(run.updated_at) : NaN;
      const idleMin = Number.isFinite(since) ? Math.floor((now - since) / 60_000) : 0;
      if (idleMin > STALE_AFTER_MINUTES) {
        return {
          tone: "warn",
          text: `No progress for ${idleMin} min — ${done} of ${target} replications; the worker may have stopped.`,
          showAggregates: done > 0,
        };
      }
      return run.status === "queued"
        ? { tone: "pending", text: "Queued — waiting for the simulation worker.", showAggregates: false }
        : {
            tone: "pending",
            text: `Running — ${done} of ${target} replications so far; figures are partial.`,
            showAggregates: true,
          };
    }
  }
}
