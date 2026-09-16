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
 * THE UUID PLANE, AND ONLY THE UUID PLANE, since Phase 3 / WP 3.0 (D29).
 *
 * WP 2.1 made this an OR — uuid, or the organization's DISPLAY NAME — and was
 * right to, at the time: the backfill had not been verified, and reading the
 * uuid first would have denied where the old text-only rule granted, inside the
 * package whose job was to stop revoking access. It named the condition for
 * removing the text half: §15 confirming the backfill.
 *
 * §15 has now run against production and the condition is met. 14 of 14
 * accounts carry `organization_id`, so every caller resolves on the uuid plane;
 * no account carries the `default_org` text or a blank one, so the text branch
 * admits nobody today. Removing it revokes nothing — measured, not assumed
 * (§16, run `35064364537`).
 *
 * What it DOES remove is the hole: `organizations.name` has no unique
 * constraint, so two real tenants may share a display name and the text branch
 * then hands one the other's data. Zero collisions today is latent, not closed;
 * nothing stops the next organization being called Company1.
 *
 * This must stay identical to the SQL predicate
 * `public.org_is_current_user_org` — `orgIdentity.test.ts` evaluates both over
 * the same truth table, and this function is the ENTIRE authorization on the
 * paths that run as the service role, where there is no RLS to fall back on.
 */
export function sameOrganization(a: OrgBearing, b: OrgBearing): boolean {
  return a.organization_id != null && b.organization_id != null &&
    a.organization_id === b.organization_id;
}
