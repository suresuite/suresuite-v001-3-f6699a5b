-- EVERY USER MAY CREATE A PERSONAL, READ-ONLY KEY — `20261002000003`, Phase 12 / WP 12.7.
--
-- Each section calls the key RPCs as /developer does (`anon`, the user as a
-- parameter) and the gateway's resolver as the service role.
--
--   §1 A plain `user` mints a personal key with read scopes; it acts as them.
--   §2 …but not a write scope, and not an organization key.
--   §3 They LIST only their own keys — not a colleague's, not the org's — and the
--      usage read is scoped the same way.
--   §4 They REVOKE their own key, and nobody else's.
--   §5 They ROTATE their own read-only key; a write-scoped key they hold from when
--      they were a modeler cannot be rotated into a fresh write key.
--   §6 USE: the gateway grant cuts a non-manager's personal key to the read scopes,
--      and a manager's key keeps every scope it has.
--   §7 A manager is unchanged: an org key with a write scope; the org's keys listed.
--   §8 An inactive user, and a user with no organization, still get nothing.
--   §9 api_key_caller reports the standing /developer renders from.
--   §10 GRANTS: the grant resolver is the service role's alone; the caller RPC is the
--       browser's; the caller helper is nobody's but the definer's.

DO $d710$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_viewer  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_mod     uuid := gen_random_uuid();
  v_idle    uuid := gen_random_uuid();
  v_orphan  uuid := gen_random_uuid();
  v_vkey    uuid;
  v_okey    uuid;
  v_wkey    uuid;
  v_mkey    uuid;
  v_rot     uuid;
  v_n       integer;
  v_scopes  text[];
  v_actor   uuid;
  v_manage  boolean;
  v_refused boolean;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D710', 'd710-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, is_active) VALUES
    (v_viewer, 'D710 viewer',  'd710v@example.invalid', 'x', 'user',    'D710', v_org, true),
    (v_other,  'D710 other',   'd710o@example.invalid', 'x', 'user',    'D710', v_org, true),
    (v_mod,    'D710 modeler', 'd710m@example.invalid', 'x', 'modeler', 'D710', v_org, true),
    (v_idle,   'D710 idle',    'd710i@example.invalid', 'x', 'user',    'D710', v_org, false),
    (v_orphan, 'D710 orphan',  'd710n@example.invalid', 'x', 'user',    'D710 nowhere', NULL, true);

  -- §1
  SET LOCAL ROLE anon;
  SELECT id INTO v_vkey FROM public.create_api_key(v_viewer, 'd710v@example.invalid', 'my notebook',
    ARRAY['read:data','read:policies','read:runs'], 'test', NULL, NULL, NULL, 'personal');
  SELECT id INTO v_okey FROM public.create_api_key(v_other, 'd710o@example.invalid', 'theirs',
    ARRAY['read:data'], 'test', NULL, NULL, NULL, 'personal');
  RESET ROLE;
  IF v_vkey IS NULL THEN RAISE EXCEPTION '§1: a plain user could not mint a personal read key'; END IF;
  IF public.api_personal_key_actor(v_vkey) IS DISTINCT FROM v_viewer THEN
    RAISE EXCEPTION '§1: the viewer''s key does not act as the viewer';
  END IF;

  -- §2
  v_refused := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.create_api_key(v_viewer, 'd710v@example.invalid', 'writer',
      ARRAY['read:data','write:runs'], 'test', NULL, NULL, NULL, 'personal');
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM LIKE '%write:runs needs an admin or modeler role%';
  END;
  RESET ROLE;
  IF NOT v_refused THEN RAISE EXCEPTION '§2: a plain user minted a write scope'; END IF;
  v_refused := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.create_api_key(v_viewer, 'd710v@example.invalid', 'org',
      ARRAY['read:data'], 'test', NULL, NULL, NULL, 'org');
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM LIKE '%only an admin or modeler can create an organization key%';
  END;
  RESET ROLE;
  IF NOT v_refused THEN RAISE EXCEPTION '§2: a plain user minted an organization key'; END IF;

  -- the modeler's keys: one org key with a write scope, one personal write key
  SET LOCAL ROLE anon;
  SELECT id INTO v_mkey FROM public.create_api_key(v_mod, 'd710m@example.invalid', 'ci',
    ARRAY['read:data','write:runs'], 'test');
  SELECT id INTO v_wkey FROM public.create_api_key(v_mod, 'd710m@example.invalid', 'mine',
    ARRAY['read:data','write:runs'], 'test', NULL, NULL, NULL, 'personal');
  RESET ROLE;

  -- §3
  INSERT INTO public.api_request_logs (api_key_id, org_id, method, route, status)
  VALUES (v_vkey, v_org, 'GET', '/v1/projects', 200), (v_mkey, v_org, 'GET', '/v1/projects', 200);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.list_api_keys(v_viewer, 'd710v@example.invalid');
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION '§3: a plain user lists % keys (want only their own, 1)', v_n; END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.api_key_usage(v_viewer, 'd710v@example.invalid') u
   WHERE u.api_key_id <> v_vkey;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION '§3: a plain user reads the usage of % keys not theirs', v_n; END IF;

  -- §4
  v_refused := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.revoke_api_key(v_viewer, 'd710v@example.invalid', v_okey);
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM LIKE '%forbidden%';
  END;
  RESET ROLE;
  IF NOT v_refused THEN RAISE EXCEPTION '§4: a plain user revoked a colleague''s key'; END IF;
  v_refused := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.revoke_api_key(v_viewer, 'd710v@example.invalid', v_mkey);
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM LIKE '%forbidden%';
  END;
  RESET ROLE;
  IF NOT v_refused THEN RAISE EXCEPTION '§4: a plain user revoked the organization''s key'; END IF;
  SET LOCAL ROLE anon;
  PERFORM public.revoke_api_key(v_other, 'd710o@example.invalid', v_okey);
  RESET ROLE;
  IF (SELECT status FROM public.api_keys WHERE id = v_okey) <> 'revoked' THEN
    RAISE EXCEPTION '§4: a plain user could not revoke their own key';
  END IF;

  -- §5
  SET LOCAL ROLE anon;
  SELECT id INTO v_rot FROM public.rotate_api_key(v_viewer, 'd710v@example.invalid', v_vkey, 0);
  RESET ROLE;
  IF public.api_personal_key_actor(v_rot) IS DISTINCT FROM v_viewer THEN
    RAISE EXCEPTION '§5: the viewer''s rotated key does not act as them';
  END IF;
  UPDATE public.approved_users SET role = 'user' WHERE id = v_mod;      -- the modeler is demoted
  v_refused := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.rotate_api_key(v_mod, 'd710m@example.invalid', v_wkey, 0);
  EXCEPTION WHEN raise_exception THEN
    v_refused := SQLERRM LIKE '%revoke it and create a read-only key%';
  END;
  RESET ROLE;
  IF NOT v_refused THEN RAISE EXCEPTION '§5: a demoted user rotated a write key into a fresh write key'; END IF;

  -- §6 (the modeler is still demoted)
  SELECT g.actor_user_id, g.scopes INTO v_actor, v_scopes FROM public.api_personal_key_grant(v_wkey) g;
  IF v_actor IS DISTINCT FROM v_mod OR v_scopes IS DISTINCT FROM ARRAY['read:data']::text[] THEN
    RAISE EXCEPTION '§6: a demoted user''s write key is granted % as % (want read:data only)', v_scopes, v_actor;
  END IF;
  UPDATE public.approved_users SET role = 'modeler' WHERE id = v_mod;
  SELECT g.scopes INTO v_scopes FROM public.api_personal_key_grant(v_wkey) g;
  IF NOT (ARRAY['read:data','write:runs']::text[] <@ v_scopes) THEN
    RAISE EXCEPTION '§6: a modeler''s personal key lost its write scope (granted %)', v_scopes;
  END IF;
  UPDATE public.approved_users SET is_active = false WHERE id = v_viewer;
  SELECT count(*) INTO v_n FROM public.api_personal_key_grant(v_rot);
  IF v_n <> 0 THEN RAISE EXCEPTION '§6: an inactive owner''s key was granted scopes'; END IF;
  UPDATE public.approved_users SET is_active = true WHERE id = v_viewer;

  -- §7
  IF (SELECT scopes FROM public.api_keys WHERE id = v_mkey) <> ARRAY['read:data','write:runs']::text[] THEN
    RAISE EXCEPTION '§7: the modeler''s org key was not stored as asked';
  END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.list_api_keys(v_mod, 'd710m@example.invalid');
  RESET ROLE;
  IF v_n < 5 THEN RAISE EXCEPTION '§7: a modeler lists % of the organization''s 5 keys', v_n; END IF;

  -- §8
  FOREACH v_actor IN ARRAY ARRAY[v_idle, v_orphan] LOOP
    v_refused := false;
    BEGIN
      SET LOCAL ROLE anon;
      PERFORM public.create_api_key(v_actor, 'x@example.invalid', 'nope',
        ARRAY['read:data'], 'test', NULL, NULL, NULL, 'personal');
    EXCEPTION WHEN raise_exception THEN
      v_refused := SQLERRM LIKE '%forbidden%';
    END;
    RESET ROLE;
    IF NOT v_refused THEN RAISE EXCEPTION '§8: user % (inactive or without an organization) minted a key', v_actor; END IF;
  END LOOP;

  -- §9
  SET LOCAL ROLE anon;
  SELECT c.can_manage, c.self_service_scopes INTO v_manage, v_scopes
    FROM public.api_key_caller(v_viewer, 'd710v@example.invalid') c;
  RESET ROLE;
  IF v_manage OR NOT ('read:data' = ANY (v_scopes)) OR 'write:runs' = ANY (v_scopes) THEN
    RAISE EXCEPTION '§9: api_key_caller tells a viewer manage=% scopes=%', v_manage, v_scopes;
  END IF;
  SET LOCAL ROLE anon;
  SELECT c.can_manage INTO v_manage FROM public.api_key_caller(v_mod, 'd710m@example.invalid') c;
  RESET ROLE;
  IF NOT v_manage THEN RAISE EXCEPTION '§9: api_key_caller tells a modeler they cannot manage keys'; END IF;

  -- §10
  IF has_function_privilege('anon', 'public.api_personal_key_grant(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.api_personal_key_grant(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._api_key_caller(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '§10: a key resolver is callable by the browser roles';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.proname = 'api_key_caller' AND p.pronamespace = 'public'::regnamespace
     AND a.privilege_type = 'EXECUTE'
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
  IF v_n <> 2 THEN RAISE EXCEPTION '§10: api_key_caller carries % of 2 explicit browser-role grants', v_n; END IF;

  RAISE NOTICE 'rehearsal 710: personal keys for every user — 10 sections hold';
END
$d710$;
