/**
 * Every duration the Lab shows, in the one planning unit (WP 9.4 slice 1).
 *
 * The planning unit is fixed to week (`PLANNING_UNIT`, useTimeUnit.ts) because
 * the engine steps in weeks: `run_window.days_per_tick` is the mapper's own
 * export. Days stay the stored truth — `horizon_days`, `warmup_days`, an
 * event's `start_day` — and this module is the one place a stored day count
 * becomes the week a user reads, so the rail, the scenario row, the setup
 * footers, the phone rows and Run & Validate cannot each round differently.
 *
 * A stored value that is not a whole number of weeks reads "≈N wk" rather than
 * being rewritten: `horizon_days` is hashed into the model card's fingerprint,
 * so silently snapping 365 → 364 would turn every validated scenario stale.
 */
import registry from "@/lib/policies/registry.generated.json";
import { DAYS_PER_UNIT, PLANNING_UNIT } from "@/hooks/useTimeUnit";
import { pyRound } from "./runWindow";

const R = registry.run_window;

/** Days per engine tick — the week the engine simulates. */
export const DAYS_PER_WEEK: number = R.days_per_tick;

/** The horizon range the mapper accepts, in weeks (it clamps outside it). */
export const HORIZON_WEEKS = { min: R.horizon_weeks_floor, max: R.horizon_weeks_ceiling } as const;

/** Stored days → the whole weeks the engine runs (the mapper's `round`). */
export function engineWeeks(days: number): number {
  return pyRound((Number(days) || 0) / DAYS_PER_WEEK);
}

/** True when a stored day count is exactly a whole number of weeks. */
export function isWholeWeeks(days: number): boolean {
  return Number.isFinite(days) && Number(days) % DAYS_PER_WEEK === 0;
}

/** "52 wk", or "≈52 wk" when the stored days are not a whole number of weeks. */
export function formatDuration(days: number): string {
  const w = engineWeeks(days);
  return `${isWholeWeeks(days) ? "" : "≈"}${w} wk`;
}

/** The run week an event starting on `startDay` lands in ("wk 17"). */
export function formatWeek(startDay: number): string {
  return `wk ${Math.max(1, engineWeeks(startDay))}`;
}

/**
 * A week count a user typed → the days to store. Keeps the stored value when
 * the week it already rounds to is unchanged, so opening and blurring a field
 * never moves a fingerprinted number; otherwise writes whole weeks.
 */
export function editWeeks(currentDays: number, weeks: number): number {
  const w = Math.round(Number(weeks) || 0);
  if (engineWeeks(currentDays) === w) return currentDays;
  return w * DAYS_PER_WEEK;
}

/**
 * The planning unit and the engine tick are one number today — pinned by
 * `planningTime.test.ts`, which is the line that must fail first if unit
 * selection ever returns.
 */
export const PLANNING_UNIT_IS_ENGINE_TICK = DAYS_PER_UNIT[PLANNING_UNIT] === DAYS_PER_WEEK;
