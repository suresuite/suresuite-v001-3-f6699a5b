/**
 * Which fields of a stage row may the prefill persist as a policy override?
 *
 * Extracted from StagePolicyTable's `applyPrefill` so the rule is testable
 * without a DOM — the same reason `resolveEffective.ts` exists.
 *
 * The rule closes **D1**: the auto-seed used to persist the *effective* value of
 * every column, which for an unuploaded field meant freezing a constant the
 * user never supplied. `safety_stock_days` was the sharp edge — `useStageRows`
 * stamped `0` on every supplier row, the prefill wrote it as an override, and
 * the engine's own 7-day default (`project_map.py`) never got to apply. The
 * user saw a policy they never chose, marked "From project data".
 *
 * A field is persistable only when the row can say where its value came from:
 *
 * | source     | marker            | why it may be persisted                  |
 * |------------|-------------------|------------------------------------------|
 * | `edit`     | an unsaved draft  | the user typed it                        |
 * | `data`     | `__from_data`     | it came off an upload                    |
 * | `decision` | `__decided`       | the stage's routing choice (G16 gate)    |
 *
 * Everything else — invented constants, imputed averages, and bundle defaults
 * that are already the engine's answer — is left unwritten, so the engine's
 * default remains the engine's to choose.
 */

export type PrefillSource = "edit" | "data" | "decision";

/**
 * Why this row+field may be persisted, or `null` for "leave it to the default".
 * `draft` is the unsaved-edit value for this row+field, if any.
 */
export function prefillSourceFor(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): PrefillSource | null {
  if (draft !== undefined) return "edit";
  const fromData = (row.__from_data ?? {}) as Record<string, true>;
  if (fromData[field] === true) return "data";
  const decided = (row.__decided ?? {}) as Record<string, true>;
  if (decided[field] === true) return "decision";
  return null;
}

/** Convenience predicate for the prefill loop. */
export function isPrefillable(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): boolean {
  return prefillSourceFor(row, field, draft) !== null;
}
