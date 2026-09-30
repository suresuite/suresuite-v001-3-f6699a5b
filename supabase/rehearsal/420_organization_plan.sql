-- Organization plan · D207 — each ORGANIZATION is valid for 1 week, 1 month, 1 quarter
-- or 1 year and may have 1, 2, 3 or 5 users and projects (or unlimited; D218 widened
-- the list to 10, 20, 50 and 100 as well — `520` asserts it), and the
-- DATABASE enforces all three; every member reads the plan through `get_my_profile`.
--
-- Every claim is about what the database does for the role the browser uses (`anon`,
-- no session, no GUC). The runner wraps this file in one transaction, so `now()` is the
-- same instant throughout: an ended period is reproduced by moving `access_valid_from`
-- into the past, never by waiting.
--
-- §1 the period: the admin verb, AS anon, stamps the start on the server clock and the
--    trigger derives the end from `org_access_period_interval()` for all four periods;
--    a caller cannot write the end; CHECKs refuse an off-list period or limit and a
--    period without a start; a plain user cannot call the verbs; NULL clears both.
-- §2 sign-in: a member of an organization whose period ended gets NO ROW with the right
--    password and leaves `auth.sign_in_failed` naming the reason; the instant of the end
--    is already ended; a super admin in the same organization still signs in; renewed,
--    the member signs in; suspension is still reported as suspension.
-- §3 the user limit, on every writer: `admin_create_user` AS anon up to the limit and
--    refused past it; a MOVE into a full organization is refused; an update that does
--    not change the organization is not counted; lowering the limit removes nobody.
-- §4 the project limit, on every writer: `create_project` AS anon up to the limit and
--    refused past it; unlimited is unlimited; lowering it deletes nothing and refuses
--    the next; a move into a full organization is refused; an organization whose period
--    ended cannot be given a project.
-- §5 the reads: `admin_list_organizations` carries the plan and the counts the limits
--    are measured by; `get_my_profile` carries the member's organization's plan, with
--    `access_expired` false for an exempt super admin and true for a member.
-- §6 `admin_create_organization` takes all three choices; the old 4-argument signature
--    is gone; anon/authenticated are EXPLICIT grantees of every function this calls.

DO $d207$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_a1     uuid := gen_random_uuid();
  v_b1     uuid := gen_random_uuid();
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_n  uuid;
  v_u      uuid;
  v_until  timestamptz;
  v_from   timestamptz;
  v_p1     uuid;
  v_n      integer;
  v_msg    text;
  v_period text;
  r        record;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D207 Org A', 'd207-org-a'),
    (v_org_b, 'D207 Org B', 'd207-org-b');

  -- An organization that existed before D207 has no period and no limits.
  SELECT * INTO r FROM public.organizations WHERE id = v_org_a;
  IF r.access_period IS NOT NULL OR r.access_valid_until IS NOT NULL
     OR r.project_limit IS NOT NULL OR r.user_limit IS NOT NULL THEN
    RAISE EXCEPTION 'D207/420 §1: a new organization defaulted to a plan — existing organizations must keep their behaviour';
  END IF;

  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, force_password_change, password_expires_at) VALUES
    (v_super, 'D207 super', 'd207s@example.invalid', extensions.crypt('pw-super-1', extensions.gen_salt('bf')), 'super_admin', 'D207 Org A', v_org_a, false, now() + interval '30 days'),
    (v_a1,    'D207 a1',    'd207a1@example.invalid', extensions.crypt('pw-a1-1', extensions.gen_salt('bf')),   'user',        'D207 Org A', v_org_a, false, now() + interval '30 days'),
    (v_b1,    'D207 b1',    'd207b1@example.invalid', extensions.crypt('pw-b1-1', extensions.gen_salt('bf')),   'modeler',     'D207 Org B', v_org_b, false, now() + interval '30 days');

  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the period ══
  FOR v_period IN SELECT unnest(ARRAY['week', 'month', 'quarter', 'year']) LOOP
    SET LOCAL ROLE anon;
    v_until := public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_a, v_period);
    RESET ROLE;
    SELECT access_valid_from INTO v_from FROM public.organizations WHERE id = v_org_a;
    IF v_from IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'D207/420 §1: % started at %, not the server clock %', v_period, v_from, now();
    END IF;
    -- Parenthesised: PL/pgSQL ends an IF condition at the first bare THEN.
    IF v_until IS DISTINCT FROM now() + (CASE v_period
                                           WHEN 'week'    THEN interval '7 days'
                                           WHEN 'month'   THEN interval '1 month'
                                           WHEN 'quarter' THEN interval '3 months'
                                           WHEN 'year'    THEN interval '1 year' END) THEN
      RAISE EXCEPTION 'D207/420 §1: % ends at %, which is not its length from now', v_period, v_until;
    END IF;
    IF v_until IS DISTINCT FROM (SELECT access_valid_until FROM public.organizations WHERE id = v_org_a) THEN
      RAISE EXCEPTION 'D207/420 §1: the verb returned % and the row says otherwise', v_until;
    END IF;
  END LOOP;

  UPDATE public.organizations SET access_valid_until = now() + interval '100 years' WHERE id = v_org_a;
  IF (SELECT access_valid_until FROM public.organizations WHERE id = v_org_a) <> now() + interval '1 year' THEN
    RAISE EXCEPTION 'D207/420 §1: a direct write of access_valid_until was kept — it must be derived';
  END IF;

  BEGIN
    UPDATE public.organizations SET access_period = 'decade' WHERE id = v_org_a;
    RAISE EXCEPTION 'D207/420 §1: access_period ''decade'' was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.organizations SET project_limit = 4 WHERE id = v_org_a;
    RAISE EXCEPTION 'D207/420 §1: project_limit 4 was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    -- 7, not 10: D218 (`20260930000012`) made 10 a valid choice; `520` owns the list.
    UPDATE public.organizations SET user_limit = 7 WHERE id = v_org_a;
    RAISE EXCEPTION 'D207/420 §1: user_limit 7 was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.organizations SET access_valid_from = NULL WHERE id = v_org_a;
    RAISE EXCEPTION 'D207/420 §1: a period without a start was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_a, 'fortnight');
    RESET ROLE;
    RAISE EXCEPTION 'D207/420 §1: the verb accepted period ''fortnight''';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'invalid access period%' THEN RAISE; END IF;
  END;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_limits(v_a1, 'd207a1@example.invalid', v_org_a, NULL, NULL);
    RESET ROLE;
    RAISE EXCEPTION 'D207/420 §1: a plain user set their organization''s limits';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'forbidden' THEN RAISE; END IF;
  END;

  SET LOCAL ROLE anon;
  v_until := public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_a, NULL);
  RESET ROLE;
  SELECT * INTO r FROM public.organizations WHERE id = v_org_a;
  IF v_until IS NOT NULL OR r.access_period IS NOT NULL OR r.access_valid_from IS NOT NULL OR r.access_valid_until IS NOT NULL THEN
    RAISE EXCEPTION 'D207/420 §1: "no expiry" left period % from % until %', r.access_period, r.access_valid_from, r.access_valid_until;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs WHERE action = 'org.access_period' AND target_id = v_org_a::text;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'D207/420 §1: % org.access_period audit rows for 5 changes', v_n;
  END IF;

  -- ══ §2 · sign-in ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_a, 'week');
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207a1@example.invalid', 'pw-a1-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D207/420 §2: a member of a current organization did not sign in';
  END IF;

  -- The week ended one second ago.
  UPDATE public.organizations SET access_valid_from = now() - interval '7 days' - interval '1 second' WHERE id = v_org_a;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207a1@example.invalid', 'pw-a1-1');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D207/420 §2: a member of an ended organization signed in with the right password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'auth.sign_in_failed' AND target_id = v_a1::text
                    AND after ->> 'reason' = 'organization access period ended') THEN
    RAISE EXCEPTION 'D207/420 §2: the refusal left no auth.sign_in_failed naming the ended period';
  END IF;

  -- The instant of the end is already ended.
  UPDATE public.organizations SET access_valid_from = now() - interval '7 days' WHERE id = v_org_a;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207a1@example.invalid', 'pw-a1-1');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D207/420 §2: a period whose end is exactly now signed a member in';
  END IF;

  -- A super admin in the same organization is not locked out.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207s@example.invalid', 'pw-super-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D207/420 §2: a super admin was locked out by their organization''s period';
  END IF;

  -- The other organization is untouched.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207b1@example.invalid', 'pw-b1-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D207/420 §2: another organization''s member was refused';
  END IF;

  -- §5 read, while it has ended: expired for the member, exempt for the super admin.
  -- Each request is its own transaction in production: the admin verb's GUC is gone.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM public.get_my_profile(v_a1);
  RESET ROLE;
  IF NOT r.access_expired OR r.access_exempt THEN
    RAISE EXCEPTION 'D207/420 §5: get_my_profile said expired % exempt % for a member of an ended organization', r.access_expired, r.access_exempt;
  END IF;
  -- Each request is its own transaction in production: the admin verb's GUC is gone.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM public.get_my_profile(v_super);
  RESET ROLE;
  IF r.access_expired OR NOT r.access_exempt OR r.access_valid_until IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'D207/420 §5: get_my_profile said expired % exempt % until % for the super admin', r.access_expired, r.access_exempt, r.access_valid_until;
  END IF;

  -- Renewed — the same period, from now — the member signs in.
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_a, 'week');
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207a1@example.invalid', 'pw-a1-1');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D207/420 §2: a member of a renewed organization did not sign in';
  END IF;

  -- Suspension is still reported as suspension.
  UPDATE public.approved_users SET is_active = false WHERE id = v_b1;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('d207b1@example.invalid', 'pw-b1-1');
  RESET ROLE;
  IF v_n <> 0 OR NOT EXISTS (SELECT 1 FROM public.audit_logs
                              WHERE action = 'auth.sign_in_failed' AND target_id = v_b1::text
                                AND after ->> 'reason' = 'account suspended') THEN
    RAISE EXCEPTION 'D207/420 §2: a suspended account was not refused as suspended';
  END IF;
  UPDATE public.approved_users SET is_active = true WHERE id = v_b1;

  -- ══ §3 · the user limit ══  (Org A holds the super admin and a1: two accounts.)
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, NULL, 3);
  v_u := public.admin_create_user(v_super, 'd207s@example.invalid', 'D207 a2', 'd207a2@example.invalid',
           'pw-a2-12345', 'user', v_org_a);
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_create_user(v_super, 'd207s@example.invalid', 'D207 a3', 'd207a3@example.invalid',
              'pw-a3-12345', 'user', v_org_a);
    RESET ROLE;
    RAISE EXCEPTION 'D207/420 §3: a fourth account was created under a user limit of 3';
  EXCEPTION WHEN check_violation THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'org_user_limit_reached: D207 Org A may have 3 user(s) and already has 3%' THEN
      RAISE EXCEPTION 'D207/420 §3: refused with the wrong words: %', v_msg;
    END IF;
  END;
  -- A move into the full organization is refused, through the admin verb.
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_update_user(v_super, 'd207s@example.invalid', v_b1, 'D207 b1', v_org_a);
    RESET ROLE;
    RAISE EXCEPTION 'D207/420 §3: an account was moved into a full organization';
  EXCEPTION WHEN check_violation THEN RESET ROLE;
  END;
  -- An update that keeps the organization is not counted; lowering removes nobody.
  UPDATE public.approved_users SET name = 'D207 a2 renamed' WHERE id = v_u;
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, NULL, 1);
  RESET ROLE;
  IF (SELECT count(*) FROM public.approved_users WHERE organization_id = v_org_a) <> 3 THEN
    RAISE EXCEPTION 'D207/420 §3: lowering the user limit changed the organization''s accounts';
  END IF;
  -- Unlimited is unlimited.
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, NULL, NULL);
  PERFORM public.admin_create_user(v_super, 'd207s@example.invalid', 'D207 a3', 'd207a3@example.invalid',
            'pw-a3-12345', 'user', v_org_a);
  RESET ROLE;

  -- ══ §4 · the project limit ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, 2, NULL);
  v_p1 := public.create_project(p_name => 'D207 one', p_plant => 'D207 plant', p_model => 'Make-To-Order',
            p_bom_level => 'single', p_user_id => v_a1, p_user_email => 'd207a1@example.invalid',
            p_user_name => 'D207 a1', p_data_type => 'curated');
  PERFORM public.create_project(p_name => 'D207 two', p_plant => 'D207 plant', p_model => 'Make-To-Order',
            p_bom_level => 'single', p_user_id => v_u, p_user_email => 'd207a2@example.invalid',
            p_user_name => 'D207 a2', p_data_type => 'curated');
  RESET ROLE;
  IF (SELECT count(*) FROM public.projects WHERE organization_id = v_org_a) <> 2 THEN
    RAISE EXCEPTION 'D207/420 §4: create_project did not stamp the organization, or the limit refused below it';
  END IF;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.create_project(p_name => 'D207 three', p_plant => 'D207 plant', p_model => 'Make-To-Order',
              p_bom_level => 'single', p_user_id => v_a1, p_user_email => 'd207a1@example.invalid',
              p_user_name => 'D207 a1', p_data_type => 'curated');
    RESET ROLE;
    RAISE EXCEPTION 'D207/420 §4: a third project was created under a limit of 2';
  EXCEPTION WHEN check_violation THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'org_project_limit_reached: D207 Org A may hold 2 project(s) and already holds 2%' THEN
      RAISE EXCEPTION 'D207/420 §4: refused with the wrong words: %', v_msg;
    END IF;
  END;
  -- An update that keeps the organization is not counted.
  UPDATE public.projects SET name = 'D207 one renamed' WHERE id = v_p1;
  -- Unlimited is unlimited; lowering deletes nothing and refuses the next.
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, NULL, NULL);
  PERFORM public.create_project(p_name => 'D207 three', p_plant => 'D207 plant', p_model => 'Make-To-Order',
            p_bom_level => 'single', p_user_id => v_a1, p_user_email => 'd207a1@example.invalid',
            p_user_name => 'D207 a1', p_data_type => 'curated');
  PERFORM public.admin_set_org_limits(v_super, 'd207s@example.invalid', v_org_a, 1, NULL);
  RESET ROLE;
  IF (SELECT count(*) FROM public.projects WHERE organization_id = v_org_a) <> 3 THEN
    RAISE EXCEPTION 'D207/420 §4: lowering the project limit changed the organization''s projects';
  END IF;
  BEGIN
    INSERT INTO public.projects (name, plant_name, modeler_id, modeler_name, organization, organization_id)
    VALUES ('D207 four', 'D207 plant', v_a1, 'D207 a1', 'D207 Org A', v_org_a);
    RAISE EXCEPTION 'D207/420 §4: an organization over its limit was given another project';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- A move into a full organization is refused.
  INSERT INTO public.projects (name, plant_name, modeler_id, modeler_name, organization, organization_id)
  VALUES ('D207 b-one', 'D207 plant', v_b1, 'D207 b1', 'D207 Org B', v_org_b);
  BEGIN
    UPDATE public.projects SET organization_id = v_org_a WHERE name = 'D207 b-one';
    RAISE EXCEPTION 'D207/420 §4: a project was moved into a full organization';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- An organization whose period ended cannot be given a project, whatever its limit.
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_access_period(v_super, 'd207s@example.invalid', v_org_b, 'month');
  RESET ROLE;
  UPDATE public.organizations SET access_valid_from = now() - interval '2 months' WHERE id = v_org_b;
  BEGIN
    INSERT INTO public.projects (name, plant_name, modeler_id, modeler_name, organization, organization_id)
    VALUES ('D207 b-two', 'D207 plant', v_b1, 'D207 b1', 'D207 Org B', v_org_b);
    RAISE EXCEPTION 'D207/420 §4: an organization whose period ended was given a project';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'org_access_ended:%' THEN RAISE; END IF;
  END;

  -- ══ §5 · the reads ══
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM public.admin_list_organizations(v_super, 'd207s@example.invalid') WHERE id = v_org_a;
  RESET ROLE;
  IF r.access_period IS DISTINCT FROM 'week' OR r.access_expired
     OR r.access_valid_until IS DISTINCT FROM now() + interval '7 days'
     OR r.project_limit IS DISTINCT FROM 1 OR r.user_limit IS NOT NULL
     OR r.members <> 4 OR r.projects <> 3 THEN
    RAISE EXCEPTION 'D207/420 §5: admin_list_organizations said period % until % expired % limits %/% members % projects %',
      r.access_period, r.access_valid_until, r.access_expired, r.project_limit, r.user_limit, r.members, r.projects;
  END IF;
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM public.admin_list_organizations(v_super, 'd207s@example.invalid') WHERE id = v_org_b;
  RESET ROLE;
  IF NOT r.access_expired THEN
    RAISE EXCEPTION 'D207/420 §5: admin_list_organizations did not report an ended period as expired';
  END IF;

  -- Each request is its own transaction in production: the admin verb's GUC is gone.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM public.get_my_profile(v_a1);
  RESET ROLE;
  IF r.access_period IS DISTINCT FROM 'week' OR r.access_expired OR r.access_exempt
     OR r.access_valid_from IS DISTINCT FROM now()
     OR r.project_limit IS DISTINCT FROM 1 OR r.projects_used <> 3
     OR r.user_limit IS NOT NULL OR r.users_used <> 4 THEN
    RAISE EXCEPTION 'D207/420 §5: get_my_profile said period % from % expired % limits %/% used %/%',
      r.access_period, r.access_valid_from, r.access_expired, r.project_limit, r.user_limit, r.projects_used, r.users_used;
  END IF;

  -- ══ §6 · creation takes all three choices ══
  SET LOCAL ROLE anon;
  v_org_n := public.admin_create_organization(v_super, 'd207s@example.invalid', 'D207 New', NULL, 'quarter', 5, 2);
  RESET ROLE;
  SELECT * INTO r FROM public.organizations WHERE id = v_org_n;
  IF r.access_period IS DISTINCT FROM 'quarter' OR r.access_valid_until IS DISTINCT FROM now() + interval '3 months'
     OR r.project_limit IS DISTINCT FROM 5 OR r.user_limit IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'D207/420 §6: admin_create_organization stored period % until % limits %/%',
      r.access_period, r.access_valid_until, r.project_limit, r.user_limit;
  END IF;
  IF to_regprocedure('public.admin_create_organization(uuid, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'D207/420 §6: the 4-argument admin_create_organization still exists — a second way to create an organization that never asks';
  END IF;
END $d207$;

DO $d207grants$
DECLARE
  v_fn   text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_set_org_access_period(uuid, text, uuid, text)',
    'public.admin_set_org_limits(uuid, text, uuid, integer, integer)',
    'public.admin_create_organization(uuid, text, text, text, text, integer, integer)',
    'public.admin_list_organizations(uuid, text)',
    'public.get_my_profile(uuid)'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
         WHERE p.oid = v_fn::regprocedure AND x.grantee = v_role::regrole
           AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'D207/420 §6: % is not an EXPLICIT grantee of %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = v_fn::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'D207/420 §6: PUBLIC still holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;
END $d207grants$;
