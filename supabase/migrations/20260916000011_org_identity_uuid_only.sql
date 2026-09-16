-- Phase 3 / WP 3.0 / §8.3 — THE TEXT BRANCH GOES (D29).
--
-- `org_is_current_user_org(_org_id, _org_name)` has been an OR since WP 2.1:
-- match the caller's organization uuid, OR match the organization's DISPLAY
-- NAME. `organizations.name` carries no unique constraint (only `slug` does),
-- so two real tenants may hold the same display name and the text branch then
-- admits one to the other's projects. WP 2.1 kept it deliberately and said why:
-- reading the uuid first would DENY where the old text-only rule granted, and a
-- package whose job is to stop revoking access must not add a new way to revoke
-- it. The condition it named was §15 confirming the backfill.
--
-- ── §15 HAS NOW CONFIRMED IT, AND THE NUMBERS ARE THE WHOLE ARGUMENT ────────
--
-- Run `35064364537`, against production:
--
--   · **14 of 14** `approved_users` carry `organization_id`. Every caller
--     resolves on the uuid plane, so no reader depends on the text branch to be
--     recognized.
--   · **9 of 10** projects carry `organization_id`. The tenth is
--     `4f314330-6f55-48b7-a654-8784e2778508`, "Demo Simulation Project", whose
--     org TEXT is `default_org` — the column's DEFAULT, matching none of the
--     three organizations (Company1, Company2, DMRG) — and whose `modeler_id`
--     resolves to no `approved_users` row. It belongs to no tenant and no
--     person. A migration must not guess which of the three should get it, and
--     this one does not.
--   · **0 accounts** carry the `default_org` text and **0** carry a blank one.
--     So nobody could reach that project through the text branch either.
--     REMOVING THE BRANCH REVOKES NOTHING FROM ANYBODY — which is the exact
--     condition WP 2.1 set, measured rather than assumed.
--   · **0** organization-name collisions across 3 organizations, so the hole is
--     latent today. Latent is not closed: nothing stops the fourth organization
--     from being called Company1.
--
-- ── WHAT CHANGES AND WHAT DOES NOT ──────────────────────────────────────────
--
-- The SIGNATURE is unchanged, on purpose. Fifty-nine policies call this function
-- with two arguments; changing the signature would rewrite every one of them and
-- put the whole RLS surface back through the introspector for a two-line
-- semantic change. `_org_name` stays in the parameter list, unused, and the
-- comment below says so — an argument whose absence of use is documented is
-- better than a policy rewrite nobody asked for. WP 3.1 or a later governance
-- package may drop the parameter when it is already touching the policies.
--
-- `get_current_user_org()` is NOT dropped. It is still what
-- `set_project_defaults` stamps, still what the `organizations` policy reads,
-- and `orgIdentity.test.ts` pins its continued existence.
--
-- THE DEMO PROJECT. After this, `4f314330-…` is reachable by no ordinary user —
-- which is already true today, for the reason above. It stays visible to the
-- service role and to a super admin, which is where a decision about it belongs.
-- Assigning it to an organization is a TENANCY decision with no evidence behind
-- it, and §16 records it as exactly that rather than burying a guess in SQL.

CREATE OR REPLACE FUNCTION public.org_is_current_user_org(_org_id uuid, _org_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- The uuid plane, and only the uuid plane. A displayable name is never a join
  -- key (`uuid-identity`, §2.1 G1).
  SELECT COALESCE(_org_id = public.get_current_user_org_id(public.get_current_user_id()), false);
$$;

COMMENT ON FUNCTION public.org_is_current_user_org(uuid, text) IS
  'Is this organization the caller''s? UUID only, since Phase 3 / WP 3.0 (D29): '
  'organizations.name is not unique, so matching on it admitted one tenant to '
  'another whenever two display names collided. `_org_name` is retained in the '
  'signature and deliberately unused — 59 policies pass it, and rewriting them '
  'for a two-line semantic change is a larger diff than the change. §15 run '
  '35064364537 measured that removing the text branch revokes nothing: 14 of 14 '
  'users carry organization_id and no account carries the default_org text.';
