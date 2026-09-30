-- §4 D210 · ONE ACCOUNT, SEVERAL ORGANIZATIONS — AND ONE ACTIVE AT A TIME.
--
-- Every claim below is about what the database DOES when the browser calls as `anon`
-- (D155), which no source-level test can make.
--
-- §1 a super admin adds an account to a SECOND organization: two memberships, and the
--    active organization does not move; a repeated add is refused by name;
--    `list_my_organizations` lists both and marks exactly one current.
-- §2 the account switches: `organization_id` (what RLS reads, through
--    `get_current_user_org_id`) and the text copy follow; the switch is recorded as
--    `org.switch` naming the account; a switch into an organization it does not belong
--    to, or one whose period ended, is refused.
-- §3 the user limit counts MEMBERSHIPS: adding past it is refused with D207's words; a
--    switch INTO an organization at its limit — or over it after the limit was lowered —
--    is not refused, because it takes no seat.
-- §4 sign-in: an account whose ACTIVE organization's period ended signs in when another
--    of its organizations is current, and is switched to it (recorded on `auth.sign_in`);
--    when none is current it is refused.
-- §5 removal: removing a non-active membership leaves the active one; removing the
--    active one re-points to the remaining membership and renames the text copy;
--    removing the last leaves no organization.
-- §6 deleting an organization deletes the accounts that belong NOWHERE else and detaches
--    the ones that do; `admin_list_organizations` said which before the delete.
-- §7 a bare `DELETE FROM organizations` (its `ON DELETE SET NULL`) re-points an account
--    to its other organization rather than leaving it with none.
-- §8 the invariant, over every account this file made: `organization_id` is NULL exactly
--    when the account has no membership, and otherwise names one of them.

DO $multi450$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_u1     uuid := gen_random_uuid();   -- the account that belongs to several
  v_u2     uuid := gen_random_uuid();   -- a second member of Org A
  v_u3     uuid := gen_random_uuid();   -- belongs to Org D only
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_c  uuid := gen_random_uuid();
  v_org_d  uuid := gen_random_uuid();
  v_org_e  uuid := gen_random_uuid();
  v_org_s  uuid := gen_random_uuid();   -- the super admin's own
  v_n      integer;
  v_cur    integer;
  v_msg    text;
  v_name   text;
  v_org    uuid;
  v_out    jsonb;
  v_ended  boolean;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'M450 Org A', 'm450-org-a'),
    (v_org_b, 'M450 Org B', 'm450-org-b'),
    (v_org_c, 'M450 Org C', 'm450-org-c'),
    (v_org_d, 'M450 Org D', 'm450-org-d'),
    (v_org_e, 'M450 Org E', 'm450-org-e'),
    (v_org_s, 'M450 Home',  'm450-home');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super, 'M450 super', 'm450s@example.invalid',  extensions.crypt('pw-super-1', extensions.gen_salt('bf')), 'super_admin', 'M450 Home',  v_org_s),
    (v_u1,    'M450 one',   'm450u1@example.invalid', extensions.crypt('pw-u1-1',    extensions.gen_salt('bf')), 'user',        'M450 Org A', v_org_a),
    (v_u2,    'M450 two',   'm450u2@example.invalid', extensions.crypt('pw-u2-1',    extensions.gen_salt('bf')), 'user',        'M450 Org A', v_org_a),
    (v_u3,    'M450 three', 'm450u3@example.invalid', extensions.crypt('pw-u3-1',    extensions.gen_salt('bf')), 'user',        'M450 Org D', v_org_d);

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · a second membership ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_b, NULL);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.organization_members WHERE user_id = v_u1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'M450 §1: an account added to a second organization holds % membership(s), expected 2', v_n;
  END IF;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M450 §1: adding a membership moved the account''s active organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'org.member_add' AND actor_user_id = v_super AND target_id = v_u1::text) THEN
    RAISE EXCEPTION 'M450 §1: the add left no org.member_add row naming the super admin';
  END IF;

  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_b, NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'already_a_member%' THEN
    RAISE EXCEPTION 'M450 §1: a repeated add got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- Each request is its own transaction in production: the admin verb's GUC is gone.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*), count(*) FILTER (WHERE is_current) INTO v_n, v_cur
    FROM public.list_my_organizations(v_u1);
  SELECT org_id INTO v_org FROM public.list_my_organizations(v_u1) WHERE is_current;
  RESET ROLE;
  IF v_n <> 2 OR v_cur <> 1 OR v_org IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M450 §1: list_my_organizations returned % row(s), % current (%), expected 2 with Org A current', v_n, v_cur, v_org;
  END IF;

  -- ══ §2 · the switch ══
  SET LOCAL ROLE anon;
  v_name := public.switch_my_organization(v_org_b, v_u1);
  RESET ROLE;
  IF v_name IS DISTINCT FROM 'M450 Org B'
     OR public.get_current_user_org_id(v_u1) IS DISTINCT FROM v_org_b
     OR (SELECT organization FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM 'M450 Org B' THEN
    RAISE EXCEPTION 'M450 §2: after the switch RLS resolves %, the text copy says %, the verb returned %',
      public.get_current_user_org_id(v_u1),
      (SELECT organization FROM public.approved_users WHERE id = v_u1), v_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE plane = 'access' AND action = 'org.switch' AND actor_user_id = v_u1
                    AND before ->> 'organization_id' = v_org_a::text
                    AND after  ->> 'organization_id' = v_org_b::text) THEN
    RAISE EXCEPTION 'M450 §2: the switch left no org.switch row naming the account and both organizations';
  END IF;
  IF (SELECT count(*) FROM public.organization_members WHERE user_id = v_u1) <> 2 THEN
    RAISE EXCEPTION 'M450 §2: switching changed the account''s memberships';
  END IF;

  -- Not a member: refused.
  PERFORM set_config('app.current_user_id', '', true);
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.switch_my_organization(v_org_c, v_u1);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'not_a_member%' THEN
    RAISE EXCEPTION 'M450 §2: a switch into an organization the account is not in got %', COALESCE(v_msg, '(no error — it switched)');
  END IF;
  IF public.get_current_user_org_id(v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M450 §2: a refused switch moved the account';
  END IF;

  -- An ended period: refused for a member; a super admin is exempt (D207 §3).
  UPDATE public.organizations
     SET access_period = 'week', access_valid_from = now() - interval '7 days' - interval '1 second'
   WHERE id = v_org_a;
  PERFORM set_config('app.current_user_id', '', true);
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.switch_my_organization(v_org_a, v_u1);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'org_access_ended%' THEN
    RAISE EXCEPTION 'M450 §2: a switch into an ended organization got %', COALESCE(v_msg, '(no error — it switched)');
  END IF;
  SET LOCAL ROLE anon;
  SELECT access_expired INTO v_ended FROM public.list_my_organizations(v_u1) WHERE org_id = v_org_a;
  RESET ROLE;
  IF v_ended IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M450 §2: list_my_organizations did not say Org A has ended (%)', v_ended;
  END IF;
  UPDATE public.organizations SET access_period = NULL, access_valid_from = NULL WHERE id = v_org_a;

  -- ══ §3 · the user limit counts memberships ══
  -- Org C holds one account (u2, added); its limit is 1: u1 cannot be added.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u2, v_org_c, 'owner');
  PERFORM public.admin_set_org_limits(v_super, 'm450s@example.invalid', v_org_c, NULL, 1);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE user_id = v_u2 AND org_id = v_org_c AND org_role = 'owner') THEN
    RAISE EXCEPTION 'M450 §3: admin_add_org_member did not record the role it was given';
  END IF;
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_c, NULL);
    RESET ROLE;
  EXCEPTION WHEN check_violation THEN RESET ROLE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'org_user_limit_reached: M450 Org C may have 1 user(s) and already has 1%' THEN
    RAISE EXCEPTION 'M450 §3: an add past the user limit got %', COALESCE(v_msg, '(no error — it was added)');
  END IF;
  -- …and neither can a direct write of the active organization (the D205 path).
  v_msg := NULL;
  BEGIN
    UPDATE public.approved_users SET organization_id = v_org_c WHERE id = v_u1;
  EXCEPTION WHEN check_violation THEN v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'org_user_limit_reached%' THEN
    RAISE EXCEPTION 'M450 §3: setting the active organization past its user limit got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- Org B holds u1 alone; at a limit of 1 u1 still switches INTO it: no new seat.
  -- Org A holds u1 and u2; lowered to 1 it is OVER its limit, and u1 still switches back.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'm450s@example.invalid', v_org_a, NULL, 1);
  PERFORM public.admin_set_org_limits(v_super, 'm450s@example.invalid', v_org_b, NULL, 1);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_a, v_u1);
  PERFORM public.switch_my_organization(v_org_b, v_u1);
  PERFORM public.switch_my_organization(v_org_a, v_u1);
  RESET ROLE;
  IF public.get_current_user_org_id(v_u1) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M450 §3: a switch between organizations at (or over) their limits did not land';
  END IF;
  UPDATE public.organizations SET user_limit = NULL WHERE id IN (v_org_a, v_org_b, v_org_c);

  -- The figures a limit is measured by are the membership rows, on both reads.
  PERFORM set_config('app.current_user_id', '', true);
  SELECT members INTO v_n FROM public.admin_list_organizations(v_super, 'm450s@example.invalid') WHERE id = v_org_b;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M450 §3: Org B lists % member(s), expected 1 (u1, whose active organization is A)', v_n;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT users_used INTO v_n FROM public.get_my_profile(v_u2);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'M450 §3: get_my_profile counts % user(s) in Org A, expected its 2 memberships', v_n;
  END IF;

  -- ══ §4 · sign-in when the ACTIVE organization's period has ended ══
  UPDATE public.organizations
     SET access_period = 'week', access_valid_from = now() - interval '7 days' - interval '1 second'
   WHERE id = v_org_a;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m450u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M450 §4: an account with a current second organization was refused at sign-in';
  END IF;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M450 §4: signing in did not switch the account to its current organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE plane = 'access' AND action = 'auth.sign_in' AND actor_user_id = v_u1
                    AND after ->> 'switched_to_organization' = v_org_b::text) THEN
    RAISE EXCEPTION 'M450 §4: the sign-in row does not record the switch';
  END IF;
  -- u2 belongs to A (ended) and C (current), and is active in A: switched to C.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m450u2@example.invalid', 'pw-u2-1');
  RESET ROLE;
  IF v_n <> 1 OR (SELECT organization_id FROM public.approved_users WHERE id = v_u2) IS DISTINCT FROM v_org_c THEN
    RAISE EXCEPTION 'M450 §4: u2 was not signed in and switched to Org C';
  END IF;
  -- Every organization ended: refused, as D207 refuses.
  UPDATE public.organizations
     SET access_period = 'week', access_valid_from = now() - interval '7 days' - interval '1 second'
   WHERE id = v_org_b;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m450u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'M450 §4: an account none of whose organizations is current signed in';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'auth.sign_in_failed' AND target_id = v_u1::text
                    AND after ->> 'reason' = 'organization access period ended') THEN
    RAISE EXCEPTION 'M450 §4: the refusal left no auth.sign_in_failed naming the ended period';
  END IF;
  UPDATE public.organizations SET access_period = NULL, access_valid_from = NULL WHERE id IN (v_org_a, v_org_b);

  -- ══ §5 · removal ══  (u1: A and B, active B.)
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_a);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M450 §5: removing a membership that is not active moved the account';
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_a, NULL);
  PERFORM public.admin_remove_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_b);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a
     OR (SELECT organization FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM 'M450 Org A' THEN
    RAISE EXCEPTION 'M450 §5: removing the active membership did not re-point to Org A (active %, text %)',
      (SELECT organization_id FROM public.approved_users WHERE id = v_u1),
      (SELECT organization FROM public.approved_users WHERE id = v_u1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'org.member_remove' AND actor_user_id = v_super AND target_id = v_u1::text) THEN
    RAISE EXCEPTION 'M450 §5: the removal left no org.member_remove row naming the super admin';
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_remove_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_b);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'not_a_member%' THEN
    RAISE EXCEPTION 'M450 §5: removing a membership that does not exist got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- ══ §6 · deleting an organization: delete the only-here accounts, detach the rest ══
  -- Org D: u3 (only there) and u1 (also in A), with u1 active in D.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_d, NULL);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_d, v_u1);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT jsonb_build_object('members', members, 'only_here', members_only_here) INTO v_out
    FROM public.admin_list_organizations(v_super, 'm450s@example.invalid') WHERE id = v_org_d;
  IF v_out IS DISTINCT FROM '{"members": 2, "only_here": 1}'::jsonb THEN
    RAISE EXCEPTION 'M450 §6: before the delete Org D reads %, expected 2 members, 1 only here', v_out;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  v_out := public.admin_delete_organization(v_super, 'm450s@example.invalid', v_org_d, 'm450-org-d');
  RESET ROLE;
  IF (v_out ->> 'users')::int <> 1 OR (v_out ->> 'detached')::int <> 1 THEN
    RAISE EXCEPTION 'M450 §6: the delete reported %, expected 1 deleted and 1 detached', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_u3) THEN
    RAISE EXCEPTION 'M450 §6: an account that belonged only to the deleted organization survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_u1)
     OR (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a
     OR (SELECT organization FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM 'M450 Org A' THEN
    RAISE EXCEPTION 'M450 §6: an account that also belongs to Org A was deleted, or not re-pointed to it';
  END IF;

  -- ══ §7 · a bare organization delete re-points through ON DELETE SET NULL ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_e, NULL);
  RESET ROLE;
  UPDATE public.approved_users SET organization_id = v_org_e WHERE id = v_u1;
  DELETE FROM public.organizations WHERE id = v_org_e;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M450 §7: after its active organization was deleted outright the account holds %, expected Org A',
      (SELECT organization_id FROM public.approved_users WHERE id = v_u1);
  END IF;

  -- The last membership removed: no organization at all.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_a);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS NOT NULL THEN
    RAISE EXCEPTION 'M450 §7: an account with no membership left still has an active organization';
  END IF;
  -- …and a first membership is its active organization again.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm450s@example.invalid', v_u1, v_org_b, NULL);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M450 §7: a first membership did not become the active organization';
  END IF;

  -- ══ §8 · the invariant ══
  SELECT count(*) INTO v_n
    FROM public.approved_users au
   WHERE au.id IN (v_super, v_u1, v_u2)
     AND (   (au.organization_id IS NULL
              AND EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = au.id))
          OR (au.organization_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.organization_members m
                               WHERE m.user_id = au.id AND m.org_id = au.organization_id)));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'M450 §8: % account(s) hold an active organization that is not one of their memberships, or none while they have one', v_n;
  END IF;
END $multi450$;
