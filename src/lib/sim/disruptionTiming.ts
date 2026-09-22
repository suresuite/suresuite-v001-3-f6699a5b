/**
 * Where a disruption falls against the warm-up, before the run (audit WP 3, F-03).
 * Kept out of the editor component so it is a plain module (react-refresh) and
 * testable without rendering. The engine's rule is `injector.resolve_events`;
 * the warm-up week comes from the mapper's own rule via `runWindow`.
 */
import { runWindow } from "@/lib/sim/runWindow";

/** Where a new disruption starts: four measured weeks after the warm-up, so
 *  TTR/TTS have a pre-disruption band. Days; 7-day ticks. */
export function defaultDisruptionStartDay(warmupDays?: number): number {
  return Math.round((warmupDays ?? 0) / 7) * 7 + 28;
}

/** What the engine does with a start inside a MANUAL warm-up (audit F-03).
 *  An AUTO warm-up is detected at run time, so no row can be judged here; the
 *  editor states the rule once instead (see `AUTO_WARMUP_RULE`). Engine:
 *  `injector.resolve_events`; the warm-up week is the mapper's own rule. */
export function warmupNote(
  startWeek: number, warmup?: { days: number; mode: string; horizonDays: number },
): string | null {
  if (!warmup || String(warmup.mode).toLowerCase() !== "manual") return null;
  const tw = runWindow({ horizon_days: warmup.horizonDays, warmup_days: warmup.days,
                         warmup_mode: "manual" }).warmupWeeks ?? 0;
  if (startWeek < tw) {
    return `Inside the ${tw} wk warm-up, which no KPI measures — the engine moves it to week ${tw} and cannot measure recovery for it.`;
  }
  if (startWeek === tw) {
    return "Starts on the first measured week — no pre-disruption week, so recovery (TTR/TTS) is not measured.";
  }
  return null;
}

export const AUTO_WARMUP_RULE =
  "The warm-up is detected at run time. A disruption starting inside it is moved to its end, " +
  "and the run's warnings say so; recovery (TTR/TTS) is then not measured for it.";
