// The project's CURRENT policy version — WP 10.2 · PLAN.md §4 D241, D242.
//
// A policy version is its content. The version "in force" is therefore not a
// choice a page remembers (it was React state initialised to null on every page,
// so a freshly opened Lab had none and read every validated model as
// unvalidated); it is a FACT derived from the live `policy_hash`: the saved
// version with that hash, or — when the live policies match no saved version —
// "unsaved edits". /policies and /simulation-lab read it through `usePolicies`,
// so the two pages cannot disagree.
//
// When several rows share the hash (versions saved before WP 10.2 deduplicated),
// the OLDEST is the version, matching `snapshot_policy`, which returns the
// oldest row of a content on every call.

export interface VersionLike {
  id: string;
  policy_hash: string | null;
  created_at: string;
  version_no?: number | null;
}

export function currentPolicyVersion<V extends VersionLike>(
  versions: readonly V[],
  currentHash: string | null,
): V | null {
  if (!currentHash) return null;
  let best: V | null = null;
  for (const v of versions) {
    if (v.policy_hash !== currentHash) continue;
    if (
      best === null ||
      v.created_at < best.created_at ||
      (v.created_at === best.created_at && v.id < best.id)
    ) {
      best = v;
    }
  }
  return best;
}

/** "Policy v4" — the per-project content number, or the short hash before it exists. */
export function policyVersionTag(v: VersionLike | null | undefined): string | null {
  if (!v) return null;
  if (typeof v.version_no === "number") return `Policy v${v.version_no}`;
  return v.policy_hash ? `Policy ${v.policy_hash.slice(0, 7)}` : null;
}
