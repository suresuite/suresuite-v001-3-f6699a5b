/**
 * D13 — one organization identity, in the edge-function plane.
 * (Phase 2 / WP 2.1 / PLAN.md §9.)
 *
 * The SQL half of this rule is `public.org_is_current_user_org(uuid, text)`. This
 * is the same rule for the callers that never go through a policy: the edge
 * functions run with the SERVICE ROLE, which bypasses RLS entirely, so the check
 * they make in TypeScript is the ONLY thing standing between a caller and another
 * tenant's project. Both of them compared `user.organization !== project.organization`
 * — a displayable, editable, non-unique string — which is the defect D13 names,
 * in the one plane where `grep get_current_user_org()` returns nothing and it
 * therefore went unrecorded until WP 2.1's gap check.
 *
 * KEEP THIS IN STEP WITH THE SQL PREDICATE. Two languages expressing one access
 * rule is an I1 violation the moment they disagree; they are written to match
 * statement for statement, and the text branch is removed from BOTH when §15
 * confirms the uuid backfill at 100 %.
 */

/** One side of the comparison: whatever carries an organization. */
export type OrgBearing = {
  organization?: string | null;
  organization_id?: string | null;
};

/**
 * Do these two rows belong to the same organization?
 *
 * The uuid plane decides whenever both sides carry one — it survives a rename,
 * because nothing about a uuid is displayable. The text plane is the fallback for
 * the rows WP 2.1's backfill could not match unambiguously; they are real, and
 * dropping the fallback would lock their owners out of their own projects.
 */
export function sameOrganization(a: OrgBearing, b: OrgBearing): boolean {
  // An OR, not a preference. Reading the uuid FIRST and stopping would be the
  // stricter rule, and it would also be a behaviour change that can DENY where
  // the old text-only check granted — two rows whose uuids were backfilled apart
  // but whose text still matches. A migration whose job is to stop revoking
  // access must not introduce a new way to revoke it. As an OR this is a
  // superset of the old check: the only pairs it newly admits are the ones whose
  // uuids agree, which is exactly the rename D13 is about.
  const byId = a.organization_id != null && b.organization_id != null &&
    a.organization_id === b.organization_id;
  const byText = a.organization != null && b.organization != null &&
    a.organization === b.organization;
  return byId || byText;
}
