-- Organization plan · more limit options · D218 — an organization's project limit and
-- user limit may each be 1, 2, 3, 5, 10, 20, 50 or 100, or NULL for unlimited
-- (`20260930000012`; D207's `420` covers what the limits COUNT and how they are enforced).
--
-- Every claim is about what the database does for the role the browser uses (`anon`).
--
-- §1 the CHECKs accept every value on the list for both columns and refuse values off
--    it (4, 7, 25, 1000, 0, -1).
-- §2 `admin_set_org_limits` AS anon stores every new value, and refuses an off-list one
--    with its own words, not a constraint name.
-- §3 `admin_create_organization` AS anon stores the new values and refuses an off-list one.
-- §4 a wider limit is ENFORCED, not only stored: under a project limit of 10 the tenth
--    project is created and the eleventh is refused with the trigger's words.
-- §5 `CREATE OR REPLACE` kept the grants: anon/authenticated are EXPLICIT grantees of
--    both verbs and PUBLIC is not.

DO $d218$
DECLARE
  v_super uuid := gen_random_uuid();
  v_a1    uuid := gen_random_uuid();
  v_org   uuid := gen_random_uuid();
  v_org_n uuid;
  v_limit integer;
  v_bad   integer;
  v_i     integer;
  v_msg   text;
  r       record;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D218 Org', 'd218-org');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, force_password_change, password_expires_at) VALUES
    (v_super, 'D218 super', 'd218s@example.invalid', extensions.crypt('pw-super-1', extensions.gen_salt('bf')), 'super_admin', 'D218 Org', v_org, false, now() + interval '30 days'),
    (v_a1,    'D218 a1',    'd218a1@example.invalid', extensions.crypt('pw-a1-1', extensions.gen_salt('bf')),   'user',        'D218 Org', v_org, false, now() + interval '30 days');
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the CHECKs ══
  FOREACH v_limit IN ARRAY ARRAY[1, 2, 3, 5, 10, 20, 50, 100] LOOP
    UPDATE public.organizations SET project_limit = v_limit, user_limit = v_limit WHERE id = v_org;
  END LOOP;
  UPDATE public.organizations SET project_limit = NULL, user_limit = NULL WHERE id = v_org;
  FOREACH v_bad IN ARRAY ARRAY[4, 7, 25, 1000, 0, -1] LOOP
    BEGIN
      UPDATE public.organizations SET project_limit = v_bad WHERE id = v_org;
      RAISE EXCEPTION 'D218/520 §1: project_limit % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      UPDATE public.organizations SET user_limit = v_bad WHERE id = v_org;
      RAISE EXCEPTION 'D218/520 §1: user_limit % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;

  -- ══ §2 · admin_set_org_limits ══
  FOREACH v_limit IN ARRAY ARRAY[10, 20, 50, 100] LOOP
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_limits(v_super, 'd218s@example.invalid', v_org, v_limit, v_limit);
    RESET ROLE;
    SELECT project_limit, user_limit INTO r FROM public.organizations WHERE id = v_org;
    IF r.project_limit IS DISTINCT FROM v_limit OR r.user_limit IS DISTINCT FROM v_limit THEN
      RAISE EXCEPTION 'D218/520 §2: set % and %, stored %/%', v_limit, v_limit, r.project_limit, r.user_limit;
    END IF;
  END LOOP;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_limits(v_super, 'd218s@example.invalid', v_org, 25, NULL);
    RESET ROLE;
    RAISE EXCEPTION 'D218/520 §2: the verb accepted project limit 25';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'invalid project limit 25%' THEN RAISE; END IF;
  END;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_limits(v_super, 'd218s@example.invalid', v_org, NULL, 1000);
    RESET ROLE;
    RAISE EXCEPTION 'D218/520 §2: the verb accepted user limit 1000';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'invalid user limit 1000%' THEN RAISE; END IF;
  END;

  -- ══ §3 · admin_create_organization ══
  SET LOCAL ROLE anon;
  v_org_n := public.admin_create_organization(v_super, 'd218s@example.invalid', 'D218 New', NULL, 'year', 50, 100);
  RESET ROLE;
  SELECT project_limit, user_limit INTO r FROM public.organizations WHERE id = v_org_n;
  IF r.project_limit IS DISTINCT FROM 50 OR r.user_limit IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'D218/520 §3: created with 50/100, stored %/%', r.project_limit, r.user_limit;
  END IF;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_create_organization(v_super, 'd218s@example.invalid', 'D218 Bad', NULL, NULL, NULL, 25);
    RESET ROLE;
    RAISE EXCEPTION 'D218/520 §3: admin_create_organization accepted user limit 25';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'invalid user limit 25%' THEN RAISE; END IF;
  END;

  -- ══ §4 · a limit of 10 is enforced ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_limits(v_super, 'd218s@example.invalid', v_org, 10, NULL);
  FOR v_i IN 1..10 LOOP
    PERFORM public.create_project(p_name => 'D218 project ' || v_i, p_plant => 'D218 plant', p_model => 'Make-To-Order',
              p_bom_level => 'single', p_user_id => v_a1, p_user_email => 'd218a1@example.invalid',
              p_user_name => 'D218 a1', p_data_type => 'curated');
  END LOOP;
  RESET ROLE;
  IF (SELECT count(*) FROM public.projects WHERE organization_id = v_org) <> 10 THEN
    RAISE EXCEPTION 'D218/520 §4: a limit of 10 did not admit ten projects';
  END IF;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.create_project(p_name => 'D218 project 11', p_plant => 'D218 plant', p_model => 'Make-To-Order',
              p_bom_level => 'single', p_user_id => v_a1, p_user_email => 'd218a1@example.invalid',
              p_user_name => 'D218 a1', p_data_type => 'curated');
    RESET ROLE;
    RAISE EXCEPTION 'D218/520 §4: an eleventh project was created under a limit of 10';
  EXCEPTION WHEN check_violation THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'org_project_limit_reached: D218 Org may hold 10 project(s) and already holds 10%' THEN
      RAISE EXCEPTION 'D218/520 §4: refused with the wrong words: %', v_msg;
    END IF;
  END;
END $d218$;

DO $d218grants$
DECLARE
  v_fn   text;
  v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_set_org_limits(uuid, text, uuid, integer, integer)',
    'public.admin_create_organization(uuid, text, text, text, text, integer, integer)'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
         WHERE p.oid = v_fn::regprocedure AND x.grantee = v_role::regrole
           AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'D218/520 §5: % is not an EXPLICIT grantee of %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = v_fn::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'D218/520 §5: PUBLIC still holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;
END $d218grants$;
