/**
 * Which seed and disruption schedule a run's reproducibility record may bind —
 * audit F-11 (and D-3: the I8 row claimed the schedule was bound; it was not).
 *
 * The workbook read `scenarios.seed` from the LIVE row, so editing the seed after
 * a run rebound the new seed to the old figures while `reproducible` still
 * computed true. The schedule was not bound at all. Since this package the
 * dispatcher STAMPS both on `simulation_runs` (`seed`, `disruption_schedule`).
 * A run older than that falls back to the live row only when the row provably has
 * not changed since dispatch (`scenarios.updated_at <= simulation_runs.created_at`)
 * — the guard sim-command's reuse check has always used for exactly this pair —
 * and otherwise binds nothing, with the reason. An unproven binding is worse
 * than a missing one: it makes `reproducible` true about a run nobody can repeat.
 */
export interface RunScenarioBinding {
  seed: number | null;
  schedule: unknown[] | null;
  seedSource: string;
  reason: string | null;
}

export function resolveRunScenarioBinding(
  run: { created_at?: string | null; seed?: number | null; disruption_schedule?: unknown[] | null },
  scenario: { seed?: number | null; disruption_schedule?: unknown[] | null; updated_at?: string | null } | null,
): RunScenarioBinding {
  if (typeof run.seed === "number") {
    return {
      seed: run.seed,
      schedule: Array.isArray(run.disruption_schedule) ? run.disruption_schedule : [],
      seedSource: "simulation_runs.seed (stamped at dispatch)",
      reason: null,
    };
  }
  if (!scenario) {
    return { seed: null, schedule: null, seedSource: "simulation_runs.seed", reason: "the run's scenario could not be read" };
  }
  const ranAt = run.created_at ? Date.parse(run.created_at) : NaN;
  const editedAt = scenario.updated_at ? Date.parse(scenario.updated_at) : NaN;
  if (Number.isFinite(ranAt) && Number.isFinite(editedAt) && editedAt <= ranAt && typeof scenario.seed === "number") {
    return {
      seed: scenario.seed,
      schedule: Array.isArray(scenario.disruption_schedule) ? scenario.disruption_schedule : [],
      seedSource: "scenarios.seed (row unchanged since the run was dispatched)",
      reason: null,
    };
  }
  return {
    seed: null,
    schedule: null,
    seedSource: "simulation_runs.seed",
    reason:
      "the run predates seed stamping and its scenario was edited after this run (or its edit " +
      "time is unknown), so the seed and disruption schedule that ran are not recorded",
  };
}

/** A short, stable fingerprint of a schedule for the record — the full schedule
 *  travels on the workbook's scenario sheet; this binds WHICH one. */
export function scheduleDigest(schedule: unknown[]): string {
  const s = JSON.stringify(schedule);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${schedule.length} event(s) · fnv1a ${h.toString(16).padStart(8, "0")}`;
}
