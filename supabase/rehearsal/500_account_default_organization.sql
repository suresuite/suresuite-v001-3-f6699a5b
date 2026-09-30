-- §4 D216 · AN ACCOUNT'S DEFAULT ORGANIZATION — WHERE EVERY SIGN-IN LANDS.
--
-- Every claim below is about what the database DOES when the browser calls as `anon`
-- (D155), which no source-level test can make.
--
-- §1 the verb: only an active super admin sets it; an organization the account does not
--    belong to is refused; setting a second default moves it (never two); the partial
--    unique index refuses two by hand; it is logged as `org.default_set`; it does NOT
--    move the active organization.
-- §2 the account switches away and signs in again: it lands in its default, and the
--    `auth.sign_in` row says so with reason `default organization`; signing in while
--    already there keeps it there. The switch itself still works (D210 unchanged).
-- §3 the default's period has ended: sign-in keeps a current active organization; when
--    the active one has ended too, D210's earliest-current fallback applies.
-- §4 leaving the ACTIVE organization re-points to the default, not to the earliest.
-- §5 the three reads agree on which one is the default.
-- §6 removing the default membership leaves no default; a NULL clears it; an account
--    with no default signs in where it last worked (the behaviour before D216).

DO $default500$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_u1     uuid := gen_random_uuid();
  v_u2     uuid := gen_random_uuid();   -- not a super admin
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_h  uuid := gen_random_uuid();   -- the one that becomes the default
  v_org_s  uuid := gen_random_uuid();
  v_n      integer;
  v_msg    text;
  v_out    jsonb;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'M500 Org A', 'm500-org-a'),
    (v_org_b, 'M500 Org B', 'm500-org-b'),
    (v_org_h, 'M500 Home',  'm500-home'),
    (v_org_s, 'M500 Super', 'm500-super');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super, 'M500 super', 'm500s@example.invalid',  extensions.crypt('pw-super-1', extensions.gen_salt('bf')), 'super_admin', 'M500 Super', v_org_s),
    (v_u1,    'M500 one',   'm500u1@example.invalid', extensions.crypt('pw-u1-1',    extensions.gen_salt('bf')), 'user',        'M500 Org A', v_org_a),
    (v_u2,    'M500 two',   'm500u2@example.invalid', extensions.crypt('pw-u2-1',    extensions.gen_salt('bf')), 'admin',       'M500 Org A', v_org_a);

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm500s@example.invalid', v_u1, v_org_b, NULL);
  PERFORM public.admin_add_org_member(v_super, 'm500s@example.invalid', v_u1, v_org_h, NULL);
  RESET ROLE;
  -- One transaction stamps every membership with the same `joined_at`; make the DEFAULT
  -- the LATEST joined, so "the earliest" and "the default" are different answers (§4).
  UPDATE public.organization_members SET joined_at = now() - interval '3 days' WHERE user_id = v_u1 AND org_id = v_org_a;
  UPDATE public.organization_members SET joined_at = now() - interval '2 days' WHERE user_id = v_u1 AND org_id = v_org_b;
  UPDATE public.organization_members SET joined_at = now() - interval '1 day'  WHERE user_id = v_u1 AND org_id = v_org_h;

  -- ══ §1 · the verb ══
  PERFORM set_config('app.current_user_id', '', true);
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_default_org(v_u2, 'm500u2@example.invalid', v_u1, v_org_h);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'M500 §1: an app admin who is not a super admin set a default organization';
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_default_org(v_super, 'm500s@example.invalid', v_u1, v_org_s);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'not_a_member%' THEN
    RAISE EXCEPTION 'M500 §1: a default outside the account''s organizations got %', COALESCE(v_msg, '(no error — it was set)');
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_default_org(v_super, 'm500s@example.invalid', v_u1, v_org_b);
  PERFORM public.admin_set_default_org(v_super, 'm500s@example.invalid', v_u1, v_org_h);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.organization_members WHERE user_id = v_u1 AND is_default;
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.organization_members
                              WHERE user_id = v_u1 AND org_id = v_org_h AND is_default) THEN
    RAISE EXCEPTION 'M500 §1: after setting B then Home, % default(s), expected exactly Home', v_n;
  END IF;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M500 §1: setting the default moved the active organization';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'org.default_set' AND actor_user_id = v_super AND target_id = v_u1::text
                    AND before ->> 'default_org_id' = v_org_b::text
                    AND after  ->> 'default_org_id' = v_org_h::text) THEN
    RAISE EXCEPTION 'M500 §1: the second set left no org.default_set row naming the super admin, B and Home';
  END IF;

  v_msg := NULL;
  BEGIN
    UPDATE public.organization_members SET is_default = true WHERE user_id = v_u1 AND org_id = v_org_a;
  EXCEPTION WHEN unique_violation THEN v_msg := 'refused'; END;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'M500 §1: an account held two default organizations — the partial unique index is missing';
  END IF;

  -- ══ §2 · sign-in lands in the default ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_u1);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M500 §2: an account with a default could not switch away from it';
  END IF;
  -- The account's FIRST sign-in in this file, so its `auth.sign_in` row is written here
  -- (the log keeps one per account per minute, and is append-only).
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m500u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M500 §2: the account was refused at sign-in';
  END IF;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_h
     OR (SELECT organization FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM 'M500 Home' THEN
    RAISE EXCEPTION 'M500 §2: signing in left the account in %, expected its default (Home)',
      (SELECT organization FROM public.approved_users WHERE id = v_u1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE plane = 'access' AND action = 'auth.sign_in' AND actor_user_id = v_u1
                    AND after ->> 'switched_to_organization' = v_org_h::text
                    AND after ->> 'reason' = 'default organization') THEN
    RAISE EXCEPTION 'M500 §2: the sign-in row does not record the move to the default';
  END IF;
  -- Already in the default: it stays.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m500u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 OR (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_h THEN
    RAISE EXCEPTION 'M500 §2: a sign-in already in the default moved the account or was refused';
  END IF;

  -- ══ §3 · the default's period has ended ══
  UPDATE public.organizations
     SET access_period = 'week', access_valid_from = now() - interval '7 days' - interval '1 second'
   WHERE id = v_org_h;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  -- A switch INTO an ended organization is refused (D210), so move to A while Home is
  -- ended by the one path that can: sign-in's own fallback.
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m500u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 OR (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M500 §3: with the default AND the active one ended, sign-in did not fall back to the earliest current (A): %, % row(s)',
      (SELECT organization FROM public.approved_users WHERE id = v_u1), v_n;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_u1);
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m500u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 OR (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M500 §3: with the default ended, sign-in did not keep the current active organization (B)';
  END IF;
  UPDATE public.organizations SET access_period = NULL, access_valid_from = NULL WHERE id = v_org_h;

  -- ══ §4 · leaving the ACTIVE organization re-points to the default ══  (active B)
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_org_member(v_super, 'm500s@example.invalid', v_u1, v_org_b);
  RESET ROLE;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_h THEN
    RAISE EXCEPTION 'M500 §4: leaving the active organization re-pointed to %, expected the default (Home) over the earliest (A)',
      (SELECT organization FROM public.approved_users WHERE id = v_u1);
  END IF;

  -- ══ §5 · the three reads agree ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.list_my_organizations(v_u1) WHERE is_default AND org_id = v_org_h;
  RESET ROLE;
  IF v_n <> 1 OR (SELECT count(*) FROM public.list_my_organizations(v_u1) WHERE is_default) <> 1 THEN
    RAISE EXCEPTION 'M500 §5: list_my_organizations does not mark exactly Home as the default';
  END IF;
  SET LOCAL ROLE anon;
  v_out := public.admin_get_user_memberships(v_super, 'm500s@example.invalid', v_u1);
  RESET ROLE;
  IF v_out ->> 'default_organization_id' IS DISTINCT FROM v_org_h::text
     OR (SELECT count(*) FROM jsonb_array_elements(v_out -> 'organizations') e
          WHERE (e ->> 'is_default')::boolean AND e ->> 'id' = v_org_h::text) <> 1 THEN
    RAISE EXCEPTION 'M500 §5: admin_get_user_memberships does not name Home as the default: %', v_out -> 'organizations';
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n
    FROM public.admin_list_users(v_super, 'm500s@example.invalid') u,
         jsonb_array_elements(u.memberships) e
   WHERE u.user_id = v_u1 AND (e ->> 'is_default')::boolean AND e ->> 'org_id' = v_org_h::text;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M500 §5: admin_list_users does not mark Home as the default membership';
  END IF;

  -- ══ §6 · no default ══
  -- Removing the default membership removes the default with it.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_add_org_member(v_super, 'm500s@example.invalid', v_u1, v_org_b, NULL);
  PERFORM public.admin_remove_org_member(v_super, 'm500s@example.invalid', v_u1, v_org_h);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_u1 AND is_default) THEN
    RAISE EXCEPTION 'M500 §6: removing the default membership left a default';
  END IF;
  -- A NULL clears it.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_default_org(v_super, 'm500s@example.invalid', v_u1, v_org_a);
  PERFORM public.admin_set_default_org(v_super, 'm500s@example.invalid', v_u1, NULL);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_u1 AND is_default) THEN
    RAISE EXCEPTION 'M500 §6: a NULL default did not clear it';
  END IF;
  -- With no default, sign-in keeps where the account last worked (before D216).
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_u1);
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('m500u1@example.invalid', 'pw-u1-1');
  RESET ROLE;
  IF v_n <> 1 OR (SELECT organization_id FROM public.approved_users WHERE id = v_u1) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'M500 §6: an account with no default was moved at sign-in';
  END IF;
END $default500$;
