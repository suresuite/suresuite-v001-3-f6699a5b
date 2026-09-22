/**
 * What the engine actually MEASURES, before the run — audit 2026-09-22, F-02/F-22.
 *
 * The Run-window card printed `horizon − warm-up` days as "measured" while the
 * engine measured a fixed window after warm-up: at the shipped defaults it said
 * 987 days and the engine measured 364. The decision (PLAN.md §16 · audit WP 2)
 * keeps the engine's window and makes the card print IT.
 *
 * The rule's constants come from the engine through `registry.generated.json`
 * (`scsim/scsim/io/registry_export.py :: run_window_rule`), never from this
 * file. The arithmetic below is necessarily a second copy — the browser cannot
 * run the mapper — so the export also carries examples COMPUTED BY the mapper,
 * and `runWindow.test.ts` fails if this copy disagrees with any of them.
 */
import registry from "@/lib/policies/registry.generated.json";

const R = registry.run_window;

/** Python's `round()` — half to even. Integer days never land on .5 weeks,
 *  but the mapper's rule is the rule, not an approximation of it. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface RunWindow {
  horizonWeeks: number;
  /** the configured analysis window after warm-up, in weeks */
  windowWeeks: number;
  /** null under auto warm-up: the engine detects it at run time */
  warmupWeeks: number | null;
  /** weeks measured, `min(t_w + window, horizon) − t_w`; null under auto */
  measuredWeeks: number | null;
  /** the horizon was raised or lowered to the engine's bounds */
  horizonBounded: boolean;
}

export function runWindow(s: {
  horizon_days: number;
  warmup_days: number;
  warmup_mode: string;
}): RunWindow {
  const rawHorizon = pyRound(s.horizon_days / R.days_per_tick);
  const horizonWeeks = clamp(rawHorizon, R.horizon_weeks_floor, R.horizon_weeks_ceiling);
  const room = Math.max(R.analysis_window_min_weeks, horizonWeeks - R.analysis_window_tail_weeks);
  const windowWeeks = clamp(
    R.analysis_window_weeks,
    R.analysis_window_min_weeks,
    Math.min(R.analysis_window_max_weeks, room),
  );
  const manual = String(s.warmup_mode).toLowerCase() === "manual";
  const warmupWeeks = manual
    ? clamp(pyRound(s.warmup_days / R.days_per_tick), 0, Math.floor(horizonWeeks / 2))
    : null;
  const measuredWeeks =
    warmupWeeks === null ? null : Math.min(warmupWeeks + windowWeeks, horizonWeeks) - warmupWeeks;
  return { horizonWeeks, windowWeeks, warmupWeeks, measuredWeeks, horizonBounded: rawHorizon !== horizonWeeks };
}

/** The card's footer: what the engine measures, not `horizon − warm-up`. */
export function runWindowFooter(s: { horizon_days: number; warmup_days: number; warmup_mode: string }): string {
  const w = runWindow(s);
  const tick = R.days_per_tick;
  const measured = w.measuredWeeks ?? w.windowWeeks;
  const head =
    w.warmupWeeks === null
      ? `engine measures ${measured} wk (${measured * tick} d) after the detected warm-up`
      : `engine measures ${measured} wk (${measured * tick} d) after a ${w.warmupWeeks} wk warm-up`;
  const horizon = w.horizonBounded
    ? ` · horizon run as ${w.horizonWeeks} wk (engine range ${R.horizon_weeks_floor}–${R.horizon_weeks_ceiling})`
    : "";
  const rest =
    w.warmupWeeks === null
      ? ""
      : ` · ${(w.horizonWeeks - w.warmupWeeks - measured) * tick} d simulated, not measured`;
  return head + horizon + rest;
}

/** A disruption authored in days, as the engine will run it. */
export function disruptionWeeks(startDay: number, durationDays: number): {
  startWeek: number;
  durationWeeks: number;
} {
  const tick = R.days_per_tick;
  return {
    startWeek: Math.max(1, pyRound(startDay / tick)),
    durationWeeks: clamp(pyRound(durationDays / tick), 1, 52),
  };
}
