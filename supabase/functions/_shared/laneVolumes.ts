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

import { rateToWeekly, unitDays } from "./grading.ts";

export interface LaneVolumeRow {
  volume?: unknown;
  time_unit?: string | null;
}

/**
 * The substitution a row's `time_unit` forced, or null when it forced none.
 *
 * D46's READER HALF (WP 3.3). The writer closed in WP 3.2 — `ingestValidate`
 * refuses a token `unitDays()` does not know and lands no value — but 27 such
 * tokens were already in tier 2 (`21`, `15`, `7`, `14`, …, 88 rows across six
 * projects), almost certainly lead-time day counts that landed one column left.
 * This resolver mapped every one of them to weekly WITHOUT SAYING SO, which is a
 * §5 T1 breach (a number whose source is a parse failure) and a T2 breach (the
 * substitution is invisible).
 *
 * THE DECISION, MADE RATHER THAN DEFERRED. An unrecognized token is still read
 * on the documented 7-day basis, and the substitution is REPORTED. The row is
 * not refused: blanking 88 rows of projects whose owners did not cause the defect
 * and cannot fix it without re-uploading would destroy data to punish a parser
 * that no longer exists. The population is closed and shrinking — nothing can add
 * to it since WP 3.2 — so the honest treatment is to keep computing and to say,
 * every time, that the number rests on an assumption.
 *
 * A MISSING unit is NOT this case and is not reported. "Absent means weekly" is
 * an explicit default, written into `20260915000001`, the sidecar and
 * `project_map.py`; T1 permits an explicit default and forbids only the fourth
 * option, which is a guess. An unrecognized token is the guess.
 */
export interface UnitSubstitution {
  /** The token as stored, so a person can find the row. */
  token: string;
  /** What it was read as instead. */
  assumed: string;
  reason: "unrecognized_time_unit";
}

export interface LaneVolumeResolution {
  weekly: number;
  substitution: UnitSubstitution | null;
}

/**
 * A lane row's volume as units per WEEK, WITH whatever assumption that took.
 *
 * Callers that can surface a finding should use this; `weeklyVolume` below is
 * the same computation for the arithmetic-only call sites.
 */
export function resolveWeeklyVolume(row: LaneVolumeRow | null | undefined): LaneVolumeResolution {
  const v = Number(row?.volume);
  if (!Number.isFinite(v)) return { weekly: 0, substitution: null };

  const raw = row?.time_unit;
  const token = raw == null ? "" : String(raw).trim();
  // Absent: the explicit default. Present but unknown to the one unit table: a
  // substitution, and the caller is told.
  const substitution: UnitSubstitution | null =
    token !== "" && unitDays(token) === undefined
      ? { token, assumed: "week", reason: "unrecognized_time_unit" }
      : null;

  return { weekly: rateToWeekly(v, raw), substitution };
}

/**
 * A lane row's volume as units per WEEK — the platform's canonical rate.
 *
 * A missing or unparseable volume is 0. An absent `time_unit` is weekly by the
 * contract's explicit default; an UNRECOGNIZED one is also read as weekly, and
 * `resolveWeeklyVolume` is how a caller learns that it was (D46).
 */
export function weeklyVolume(row: LaneVolumeRow | null | undefined): number {
  return resolveWeeklyVolume(row).weekly;
}

/**
 * Every substitution a set of lane rows forced, collapsed to one entry per
 * token with the number of rows relying on it — which is the shape a person can
 * act on ("19 rows say `21`"), rather than 19 identical messages.
 */
export function unitSubstitutions(
  rows: readonly LaneVolumeRow[],
): Array<UnitSubstitution & { rows: number }> {
  const seen = new Map<string, UnitSubstitution & { rows: number }>();
  for (const row of rows) {
    const { substitution } = resolveWeeklyVolume(row);
    if (!substitution) continue;
    const hit = seen.get(substitution.token);
    if (hit) hit.rows += 1;
    else seen.set(substitution.token, { ...substitution, rows: 1 });
  }
  return [...seen.values()].sort((a, b) => b.rows - a.rows || a.token.localeCompare(b.token));
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
