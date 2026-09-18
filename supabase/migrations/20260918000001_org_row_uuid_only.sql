-- Phase 6 / WP 6.2 / §8.3 — THE LAST NAMED EXCEPTION TO `uuid-identity` (D47).
--
-- D29 removed the text branch from `org_is_current_user_org`, the predicate 59
-- project-scoped policies call. It did NOT touch `organizations`' own read
-- policy, which is a different object with a different reader, and that policy
-- still says:
--
--     id   = public.get_current_user_org_id(public.get_current_user_id())
--     OR name = public.get_current_user_org()
--     OR slug = public.get_current_user_org()
--
-- `get_current_user_org()` returns `approved_users.organization` — the caller's
-- organization NAME. The introspected schema says `organizations` has exactly
-- two constraints: `organizations_pkey` on `id` and `organizations_slug_key` on
-- `slug`. **`name` carries no unique constraint at all.** So two tenants holding
-- the same display name each read the other's organization row: name, slug,
-- status, and the whole `settings` jsonb. That is D29's collision, still open on
-- this one object, and `supabase/rehearsal/040` already proves the shape is real
-- for projects.
--
-- The `slug` branch is a smaller thing and still wrong: `slug` IS unique, so it
-- admits at most one row, but it compares the caller's NAME against another
-- organization's SLUG — so organization A whose slug is "initech" is readable by
-- every member of an organization literally named "initech". A text join key
-- either way (G1).
--
-- ── WHY THE POLICY REWRITE IS NOT THE WHOLE MIGRATION ───────────────────────
--
-- D29's own reasoning is the constraint on this one: "a package whose job is to
-- stop revoking access must not add a new way to revoke it." Making this policy
-- uuid-only does exactly that, for one population — a caller whose
-- `approved_users.organization_id` is NULL. Their uuid branch yields NULL, and
-- the `name` branch was what granted them their own organization row.
--
-- §15 measured 14 of 14 accounts carrying `organization_id`, which is what let
-- D29 proceed. **But nothing KEEPS that true.** `approved_users.organization_id`
-- is nullable with no default, no trigger stamps it, and the backfill was a
-- one-off. A measurement is not an invariant: the fifteenth account, inserted by
-- any path that does not know to supply the uuid, arrives NULL — already unable
-- to read any project (D29 shipped that), and this policy would additionally
-- take its own organization row away.
--
-- So the stamping trigger below is not scope creep; it is the thing that makes
-- the rewrite safe. Same move as D61, where `project_members` had one writer
-- that ran once and a trigger closed it.
--
-- AMBIGUITY IS LEFT UNRESOLVED, DELIBERATELY. When two organizations share the
-- display name the trigger is resolving, it stamps NOTHING and leaves the column
-- NULL. Picking one would be guessing, and guessing between two same-named
-- tenants is the exact defect this migration closes — arriving through the write
-- path instead of the read path.

-- ── 1 · the organization row is read by uuid ────────────────────────────────

DROP POLICY IF EXISTS "orgs: members read own" ON public.organizations;
CREATE POLICY "orgs: members read own" ON public.organizations FOR SELECT
  USING (
    id = public.get_current_user_org_id(public.get_current_user_id())
  );

COMMENT ON TABLE public.organizations IS
  'Tenant root. Read by uuid only since WP 6.2 (§4 D47): `name` carries no '
  'unique constraint, so an OR over the display name let two same-named tenants '
  'read each other''s row. `orgs: super admin full` is unchanged and still grants '
  'platform admins full access.';

-- ── 2 · and the uuid plane stays populated ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.approved_users_stamp_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matches integer;
  v_id      uuid;
BEGIN
  -- Only ever FILLS a blank. It never corrects a uuid somebody supplied, because
  -- the uuid is the authority and the text is the stale copy (D13).
  IF NEW.organization_id IS NOT NULL OR NEW.organization IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_matches
  FROM public.organizations o
  WHERE o.name = NEW.organization;

  IF v_matches = 1 THEN
    SELECT o.id INTO v_id
    FROM public.organizations o
    WHERE o.name = NEW.organization;
    NEW.organization_id := v_id;
  ELSIF v_matches > 1 THEN
    -- Two tenants share this display name. Stamping either one would grant this
    -- account access to a tenant nobody put it in. Leaving NULL denies rather
    -- than mis-grants, which is the right way round.
    RAISE LOG 'approved_users.organization_id left NULL: % organizations share the display name %',
      v_matches, NEW.organization;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approved_users_stamp_org_id ON public.approved_users;
CREATE TRIGGER trg_approved_users_stamp_org_id
  BEFORE INSERT OR UPDATE OF organization, organization_id ON public.approved_users
  FOR EACH ROW
  EXECUTE FUNCTION public.approved_users_stamp_organization_id();

COMMENT ON FUNCTION public.approved_users_stamp_organization_id() IS
  'Fills `approved_users.organization_id` from the organization display name when '
  'it is blank (§4 D47). The §15 backfill measured 14 of 14 accounts carrying it, '
  'and nothing kept that true — a measurement is not an invariant. Refuses to '
  'guess when two organizations share the name: leaves NULL, which denies rather '
  'than mis-grants.';
