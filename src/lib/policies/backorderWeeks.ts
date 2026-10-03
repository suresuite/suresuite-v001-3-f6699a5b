/**
 * Max backorder DAYS → the whole WEEKS the engine uses — PLAN.md §24 WP 14.3.
 *
 * The rule is the mapper's (`project_map._backorder_weeks`: days ÷ 7, rounded
 * HALF UP, clamped 0–26), published through `registry.generated.json`
 * (`registry_export.backorder_rule`). The arithmetic below is necessarily a
 * second copy — the browser cannot run the mapper — so the export carries
 * examples COMPUTED BY the mapper and `backorderWeeks.test.ts` fails if this
 * copy disagrees with any of them.
 */
import registry from "@/lib/policies/registry.generated.json";

const R = registry.backorder;

export function backorderWeeks(days: number): number {
  const w = Math.floor(days / R.days_per_week + 0.5);
  return Math.max(R.min_weeks, Math.min(R.max_weeks, w));
}

/** The note a Customer row's max-backorder cell carries: the window the run
 *  will use, in whole weeks. Undefined for a value that is not a number. */
export function backorderWeeksNote(days: unknown): string | undefined {
  const n = typeof days === "number" ? days : Number(days);
  if (days === null || days === undefined || days === "" || !Number.isFinite(n)) return undefined;
  const w = backorderWeeks(n);
  return `= ${w} wk in the run (days ÷ 7, rounded half up).`;
}
