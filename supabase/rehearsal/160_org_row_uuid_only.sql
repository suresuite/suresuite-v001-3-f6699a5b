-- D47 · the ORGANIZATION ROW itself, not just the projects under it.
--
-- `supabase/rehearsal/040` proves `org_is_current_user_org` is uuid-only, and
-- that predicate governs 59 project-scoped policies. `organizations`' own read
-- policy is a different object with a different reader and D29 did not touch it:
-- it kept `OR name = get_current_user_org() OR slug = get_current_user_org()`.
--
-- `organizations.name` has no unique constraint — only `slug` does — so two
-- tenants sharing a display name each read the other's row: name, slug, status
-- and the whole `settings` jsonb. Same instrument as 040, one table over.
--
-- §5 AND §6 ARE THE HALF THAT IS NOT ABOUT READING. Making the policy uuid-only
-- is a new denial for any caller whose `organization_id` is NULL, and nothing
-- kept that column populated — the backfill ran once. The trigger is what makes
-- the rewrite safe, so it is proved here rather than assumed, including the case
-- where it must REFUSE to guess.

DO $d47$
DECLARE
  v_org_a  uuid := '00000000-0000-4000-8000-0000000d4700';
  v_org_b  uuid := '00000000-0000-4000-8000-0000000d4701';
  v_user   uuid := '00000000-0000-4000-8000-0000000d4702';
  v_fresh  uuid := '00000000-0000-4000-8000-0000000d4703';
  v_ambig  uuid := '00000000-0000-4000-8000-0000000d4704';
  v_admin  uuid := '00000000-0000-4000-8000-0000000d4705';
  v_seen   integer;
  v_got    uuid;
BEGIN
  -- TWO organizations, ONE display name. Legal today — `name` has no unique
  -- constraint — and the whole defect. `slug` differs because it must.
  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org_a, 'Initech', 'initech-a'),
         (v_org_b, 'Initech', 'initech-b');

  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
  VALUES (v_user, 'd47@example.invalid', 'D47', 'x', 'Initech', v_org_a);

  PERFORM set_config('app.current_user_id', v_user::text, true);

  -- ── 1 · the caller reads their OWN organization row ──────────────────────
  --
  -- First, because every other assertion here is about denial and a fix that
  -- denies everything would pass all of them.

  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_a) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'D47 §1 — the caller cannot read their OWN organization row. That is a '
      'revocation, not a fix, and D29''s own note forbids it.';
  END IF;

  -- ── 2 · THE CASE. The other tenant with the same display name. ───────────

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_b) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'D47 §2 — a DIFFERENT organization with the same display name is readable. '
      'The `name` branch is alive, and with it the whole `settings` jsonb of a '
      'tenant this caller has nothing to do with.';
  END IF;

  -- and exactly one row is visible, which catches a policy that grants broadly
  -- for some reason other than the name branch.
  SELECT count(*) INTO v_seen FROM public.organizations;
  IF v_seen <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'D47 §2 — the caller sees % organization row(s), expected exactly 1.', v_seen;
  END IF;
  RESET ROLE;

  -- ── 3 · a RENAME must not change the answer (D13, still true) ────────────

  UPDATE public.organizations SET name = 'Initech Holdings' WHERE id = v_org_a;
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_a) THEN
    RESET ROLE;
    RAISE EXCEPTION 'D47 §3 — renaming the organization stopped its own member reading it. D13 has regressed.';
  END IF;
  RESET ROLE;
  UPDATE public.organizations SET name = 'Initech' WHERE id = v_org_a;

  -- ── 4 · the SLUG branch is gone too ──────────────────────────────────────
  --
  -- Smaller than the name branch and still a text join key: `slug` is unique, so
  -- it admits at most one row, but it compared the caller's NAME against another
  -- organization's SLUG. A tenant whose slug is another tenant's name was
  -- readable by every member of that other tenant.

  UPDATE public.organizations SET slug = 'Initech' WHERE id = v_org_b;
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_b) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'D47 §4 — an organization whose SLUG equals the caller''s organization NAME '
      'is readable. The slug branch is alive.';
  END IF;
  RESET ROLE;
  UPDATE public.organizations SET slug = 'initech-b' WHERE id = v_org_b;

  -- ── 5 · the uuid plane stays populated, so §1 keeps being true ───────────
  --
  -- The rewrite denies anyone whose `organization_id` is NULL. Nothing kept that
  -- column filled: it is nullable, has no default, and the backfill ran once.

  INSERT INTO public.approved_users (id, email, name, password_hash, organization)
  VALUES (v_fresh, 'd47-fresh@example.invalid', 'Fresh', 'x', 'Megacorp');
  -- (no organization for 'Megacorp' exists yet, so this one stays NULL)
  SELECT organization_id INTO v_got FROM public.approved_users WHERE id = v_fresh;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'D47 §5 — an unknown organization name was stamped to %, which is a guess.', v_got;
  END IF;

  INSERT INTO public.organizations (id, name, slug)
  VALUES ('00000000-0000-4000-8000-0000000d4706', 'Megacorp', 'megacorp');
  UPDATE public.approved_users SET organization = 'Megacorp' WHERE id = v_fresh;

  SELECT organization_id INTO v_got FROM public.approved_users WHERE id = v_fresh;
  IF v_got IS DISTINCT FROM '00000000-0000-4000-8000-0000000d4706'::uuid THEN
    RAISE EXCEPTION
      'D47 §5 — `organization_id` was not stamped (got %). Without this, the '
      'fifteenth account to arrive without a uuid loses its own organization row, '
      'which is the revocation D29''s note forbids.', v_got;
  END IF;

  -- ── 6 · and it REFUSES TO GUESS when the name is ambiguous ───────────────
  --
  -- 'Initech' is two organizations. Stamping either would grant this account a
  -- tenant nobody put it in — the same defect as §2, arriving through the WRITE
  -- path. NULL denies; a guess mis-grants.

  INSERT INTO public.approved_users (id, email, name, password_hash, organization)
  VALUES (v_ambig, 'd47-ambig@example.invalid', 'Ambiguous', 'x', 'Initech');
  SELECT organization_id INTO v_got FROM public.approved_users WHERE id = v_ambig;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION
      'D47 §6 — two organizations are called Initech and the trigger picked % '
      'anyway. Guessing between same-named tenants is the defect this migration '
      'closes, not a convenience.', v_got;
  END IF;

  -- ── 7 · the super-admin policy is untouched ──────────────────────────────
  --
  -- `orgs: super admin full` is a SEPARATE policy and this migration does not
  -- name it. Asserted because "I only changed one policy" is exactly the claim
  -- that is worth checking against a database.

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organizations'
      AND policyname = 'orgs: super admin full'
  ) THEN
    RAISE EXCEPTION 'D47 §7 — the super-admin policy on `organizations` is gone.';
  END IF;

  RAISE NOTICE 'D47 · 160_org_row_uuid_only · all sections passed';
END $d47$;
