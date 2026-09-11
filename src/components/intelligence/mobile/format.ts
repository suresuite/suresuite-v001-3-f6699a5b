/** Small formatting helpers shared across the SC Intelligences mobile screens. */

/** "2h", "3d" — the root's Open-section elapsed mark (§5.2). */
export function formatElapsed(fromMs: number, nowMs: number = Date.now()): string {
  const ms = Math.max(0, nowMs - fromMs);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** A version transition label ("v12 → v13") from a 1-based ordinal — the
 *  handoff's numbering convention for a project's saved policy versions,
 *  since `PolicyVersion` carries no numeric field of its own. `versions` is
 *  expected newest-first (as `usePolicies` returns it). */
export function versionOrdinal(versions: Array<{ id: string }>, versionId: string | null): number | null {
  if (!versionId) return null;
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx === -1) return null;
  // Oldest = v1: the last element of a newest-first list.
  return versions.length - idx;
}
