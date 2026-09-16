// D20 · THE CEILING, AND THE ONE SENTENCE THAT REPORTS IT.
//
// Separate from `projectLanes.ts` because that file imports the Supabase
// browser client, and the rule a test most needs to reach — "a truncated read
// is reported in words a person sees" — must not need a DOM to check.

/** Explicit row ceiling for the fallback's direct reads.
 *
 * D20 was not the ceiling, it was the SILENCE: this function capped each lane
 * at 10 000 rows and returned the slice as though it were the project. Without
 * an explicit `.limit()` PostgREST applies its own `db-max-rows` (commonly
 * 1 000) and truncates without saying so, so removing the bound would make the
 * defect worse, not better. The bound stays, it is OURS, it matches the
 * grading gate's `GATE_ROW_CEILING` so the two reads of the same tables cannot
 * disagree about what "complete" means, and a table that comes back at exactly
 * the ceiling is reported through `truncated`. */
export const LANE_ROW_CEILING = 50_000;

/** The sentence a surface shows when a lane read was cut short. One wording,
 *  because the same partial read is rendered by the policy grid, the data map
 *  and the item-master editor, and three paraphrases of one fact is exactly
 *  what `single-source` (I1) forbids. */
export function laneTruncationNotice(lanes: { truncated: string[] }): string | null {
  if (!lanes.truncated.length) return null;
  return (
    `Partial data — ${lanes.truncated.join(", ")} hit the ${LANE_ROW_CEILING.toLocaleString()}-row read ceiling, ` +
    "so everything below was computed from a slice of this project, not all of it."
  );
}

