-- D29 · two tenants may share a display name, and the predicate must refuse.
--
-- `organizations.name` carries no unique constraint (only `slug` does). While
-- `org_is_current_user_org` was an OR over uuid and NAME, a second organization
-- called "Company1" would have read the first one's projects. §15 measured zero
-- collisions in production, which makes the hole latent — and latent is what
-- this file exists to keep it from becoming, since nothing stops the next
-- organization being called Company1 either.
--
-- WP 2.1 verified D13 the same way, against a real database, and §16 records
-- that as the most valuable thing it did. Same instrument, opposite direction:
-- that entry proved the text branch was needed, this one proves it is not.

DO $d29$
DECLARE
  v_org_a   uuid := '00000000-0000-4000-8000-0000000d2900';
  v_org_b   uuid := '00000000-0000-4000-8000-0000000d2901';
  v_user    uuid := '00000000-0000-4000-8000-0000000d2902';
  v_proj_a  uuid := '00000000-0000-4000-8000-0000000d2903';
  v_proj_b  uuid := '00000000-0000-4000-8000-0000000d2904';
  v_proj_nul uuid := '00000000-0000-4000-8000-0000000d2905';
BEGIN
  -- TWO organizations, ONE display name. Legal today, and the whole defect.
  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org_a, 'Initech', 'initech-a'),
         (v_org_b, 'Initech', 'initech-b');

  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
  VALUES (v_user, 'd29@example.invalid', 'D29', 'x', 'Initech', v_org_a);

  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
  VALUES (v_proj_a, 'Theirs',  v_user, 'P', 'Initech', v_org_a),
         (v_proj_b, 'Others',  v_user, 'P', 'Initech', v_org_b),
         -- D27's shape: the text is right, the uuid was never stamped.
         (v_proj_nul, 'Unstamped', v_user, 'P', 'Initech', NULL);

  PERFORM set_config('app.current_user_id', v_user::text, true);

  -- 1 · the caller's own organization, by uuid
  IF NOT public.org_is_current_user_org(v_org_a, 'Initech') THEN
    RAISE EXCEPTION 'D29: the predicate refuses the caller''s OWN organization — this is a revocation, not a fix';
  END IF;

  -- 2 · a RENAME must not change the answer. D13, still true: the name the
  --     project carries is stale and the uuid decides.
  IF NOT public.org_is_current_user_org(v_org_a, 'Initech Holdings') THEN
    RAISE EXCEPTION 'D29: a renamed organization stopped matching — D13 has regressed';
  END IF;

  -- 3 · THE CASE. Another tenant, same display name.
  IF public.org_is_current_user_org(v_org_b, 'Initech') THEN
    RAISE EXCEPTION 'D29: a DIFFERENT organization with the same display name still matches — the text branch is alive';
  END IF;

  -- 4 · an un-stamped row matches nobody now. In production this is one
  --     project, "Demo Simulation Project", which no account could reach
  --     anyway: no account carries its `default_org` text (§15).
  IF public.org_is_current_user_org(NULL, 'Initech') THEN
    RAISE EXCEPTION 'D29: a NULL organization_id still matches on text';
  END IF;

  -- 5 · and the RLS that depends on it agrees. The predicate is only worth
  --     testing through a policy, because a policy is where it is used.
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_proj_b) THEN
    RESET ROLE;
    RAISE EXCEPTION 'D29: a project of the OTHER same-named organization is readable through RLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_proj_a) THEN
    RESET ROLE;
    RAISE EXCEPTION 'D29: the caller cannot read their OWN organization''s project — this is a revocation';
  END IF;
  RESET ROLE;

  RAISE NOTICE 'D29: the predicate is uuid-only — a rename still matches, a shared display name does not';
END $d29$;
