/**
 * The validated baseline — the one scenario per project that Run & Validate
 * (/policies) runs its validation into (WP 9.4 slice 4, §4 D225).
 *
 * It is identified by `scenarios.role`, never by its name: the name is a
 * display string anyone could change, and finding the row by it orphaned the
 * validation the first time somebody renamed it. The name below is only what a
 * NEW baseline is called, plus a fallback for the window between this code
 * shipping and `20261001000001_scenario_role.sql` deploying on merge, when rows
 * carry no role yet.
 */

/** What a new baseline is called. Display only — never a lookup key once `role` exists. */
export const VALIDATION_SCENARIO_NAME = "Policy validation (auto)";

export type ScenarioRole = "experiment" | "validation_baseline";

interface RoleBearing {
  role?: ScenarioRole | string | null;
  name?: string | null;
}

/** True for the project's validated baseline. */
export function isValidationBaseline(s: RoleBearing | null | undefined): boolean {
  if (!s) return false;
  if (s.role) return s.role === "validation_baseline";
  // No role column yet (pre-deploy): the name is the only signal there is.
  return s.name === VALIDATION_SCENARIO_NAME;
}

/**
 * The project's baseline among its scenarios. When the column exists, only a
 * row whose role says so qualifies; the name fallback applies only while NO
 * row carries a role at all.
 */
export function findValidationBaseline<T extends RoleBearing>(scenarios: readonly T[]): T | null {
  const anyRole = scenarios.some((s) => !!s.role);
  if (anyRole) return scenarios.find((s) => s.role === "validation_baseline") ?? null;
  return scenarios.find((s) => s.name === VALIDATION_SCENARIO_NAME) ?? null;
}

/** Why the Lab will not edit or run the baseline, in one line. */
export const BASELINE_READONLY_REASON =
  "The validated baseline is set and run in Policies › Run & Validate. Start a new scenario from it to change anything.";
