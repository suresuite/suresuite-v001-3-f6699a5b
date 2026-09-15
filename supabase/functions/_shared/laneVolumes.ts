// Lane volume normalization — the ETL's half of the unit contract.
//
// Like `grading.ts`, this is DEPENDENCY-FREE pure TypeScript so it is
// isomorphic: Deno bundles it into the `combine-project` edge function and the
// browser/vitest side imports it by relative path. Nothing here may reach for
// `npm:`, `Deno.*` or `@/`.
//
// D2 — `inbound_logistics.volume` and `outbound_logistics.volume` are RATES
// over each row's own `time_unit`, never bare quantities. `combine-project`
// read them raw at all eight of its read sites, so it summed and divided
// numbers that did not share a unit: a supplier quoting 52 000/year and one
// quoting 1 000/week — the same physical flow — produced sourcing shares of
// 98 % and 2 %. `sourcing_ratio` is a share, so the error is not a scaling
// factor that cancels; it changes which supplier the platform calls primary.
//
// The unit vocabulary itself is NOT redefined here. `rateToWeekly` comes from
// `grading.ts`, which mirrors `project_map.py::_rate_to_weekly` and is pinned
// to it by the validation-parity fixtures. One unit table, or the copies drift
// (invariant I3 — D10 is the standing example of that drift).

import { rateToWeekly } from "./grading.ts";

export interface LaneVolumeRow {
  volume?: unknown;
  time_unit?: string | null;
}

/**
 * A lane row's volume as units per WEEK — the platform's canonical rate.
 *
 * A missing or unparseable volume is 0. An absent or unrecognized `time_unit`
 * is treated as weekly, which is the same silent assumption the engine makes;
 * §15's "unrecognized time_unit" query is how you find the rows relying on it.
 */
export function weeklyVolume(row: LaneVolumeRow | null | undefined): number {
  const v = Number(row?.volume);
  return Number.isFinite(v) ? rateToWeekly(v, row?.time_unit) : 0;
}

/** Σ weekly volume per key — the denominator of a sourcing share. */
export function weeklyVolumeTotalsBy<T extends LaneVolumeRow>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    totals.set(key, (totals.get(key) ?? 0) + weeklyVolume(row));
  }
  return totals;
}

/**
 * One row's share of its key's total flow, in [0, 1].
 *
 * A zero (or missing) total means this row is the only claim on that key, so
 * the share is 1.0 — the ETL's long-standing convention, preserved verbatim.
 * Both arguments must already be weekly; passing a raw volume is the defect.
 */
export function volumeShare(weekly: number, total: number): number {
  return total > 0 ? weekly / total : 1.0;
}
