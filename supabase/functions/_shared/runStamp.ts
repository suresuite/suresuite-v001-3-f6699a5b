// What a run is stamped with at dispatch — audit 2026-09-22 · WP 8 · F-11.
//
// Its own module, with no imports, so the browser-side tests can reach it
// without pulling in the Deno runtime `dispatch.ts` depends on.

/** The seed and disruption schedule a run is dispatched with (audit F-11). */
export function runStamp(scenario: Record<string, unknown>): {
  seed: number | null;
  disruption_schedule: unknown[];
} {
  return {
    seed: typeof scenario.seed === "number" ? scenario.seed : null,
    disruption_schedule: Array.isArray(scenario.disruption_schedule) ? scenario.disruption_schedule : [],
  };
}

/** PostgREST's "column not in the schema cache" — the stamp's migration has not
 *  landed yet. Only this error is retried unstamped; any other insert error is
 *  the dispatcher's to raise. */
export function isMissingStampColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST204" &&
    /'(seed|disruption_schedule)' column/.test(String(err.message ?? ""));
}
