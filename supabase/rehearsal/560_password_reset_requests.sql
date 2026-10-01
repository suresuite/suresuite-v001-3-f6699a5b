-- §4 D233 · FORGOTTEN PASSWORDS: THE PERSON ASKS, A SUPER ADMIN RESETS.
--
-- `20261001000006` adds `password_reset_requests`, `request_password_reset`, the super
-- admin's list and dismiss, and makes `admin_reset_user_password` close the request.
-- What only a running database can settle, every call made AS anon — the browser's
-- role (D155):
--
--   §1 THE SAME ANSWER: an active account, an unknown email, a suspended account and a
--      blank email all return without error; only the active account gets a row.
--   §2 ONE OPEN: asking again — in other case, with spaces — adds no row and no audit
--      row; the one audit row names the account as TARGET and no actor.
--   §3 NO SIDE DOOR: anon reads no rows of the table and cannot insert one.
--   §4 REFUSAL: a non-super-admin cannot list, dismiss or reset; the request stays open.
--   §5 THE LIST: the super admin sees the request with its email and organization.
--   §6 THE RESET RESOLVES IT: the new password verifies, a change is forced, the expiry
--      is `password_max_age()`, the request is `resolved` by the super admin, and the
--      admin audit row names it; the list is empty again.
--   §7 DISMISS: a later request can be dismissed, once; a second dismiss is refused.
--   §8 DELETE: deleting the account deletes its requests.
--   §9 GRANTS: anon and authenticated are EXPLICIT grantees; PUBLIC is not.

DO $d233$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();   -- an org admin, not a super admin
  v_user   uuid := gen_random_uuid();   -- forgot their password
  v_gone   uuid := gen_random_uuid();   -- suspended
  v_req    uuid;
  v_req2   uuid;
  v_n      integer;
  v_code   text;
  v_row    record;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'PWR Org', 'pwr-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super, 'pwr-s@example.invalid', 'Pwr Super', 'x', 'super_admin', 'PWR Org', v_org, true),
    (v_admin, 'pwr-a@example.invalid', 'Pwr Admin', 'x', 'admin',       'PWR Org', v_org, true),
    (v_user,  'pwr-u@example.invalid', 'Pwr User',  'x', 'user',        'PWR Org', v_org, true),
    (v_gone,  'pwr-g@example.invalid', 'Pwr Gone',  'x', 'user',        'PWR Org', v_org, false);

  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the same answer ══
  SET LOCAL ROLE anon;
  PERFORM public.request_password_reset('pwr-u@example.invalid');
  PERFORM public.request_password_reset('pwr-nobody@example.invalid');
  PERFORM public.request_password_reset('pwr-g@example.invalid');
  PERFORM public.request_password_reset('   ');
  PERFORM public.request_password_reset(NULL);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.password_reset_requests WHERE user_id = v_user AND status = 'open';
  IF v_n <> 1 THEN RAISE EXCEPTION 'D233/560 §1: % open requests for the active account, expected 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.password_reset_requests WHERE user_id = v_gone;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D233/560 §1: a suspended account got a request'; END IF;
  SELECT id INTO v_req FROM public.password_reset_requests WHERE user_id = v_user AND status = 'open';

  -- ══ §2 · one open ══
  SET LOCAL ROLE anon;
  PERFORM public.request_password_reset('  PWR-U@Example.Invalid ');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.password_reset_requests WHERE user_id = v_user;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D233/560 §2: asking again made % rows, expected 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'access' AND action = 'auth.password_reset_requested'
     AND target_id = v_user::text AND actor_user_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D233/560 §2: % request audit rows, expected 1 with no actor', v_n; END IF;

  -- ══ §3 · no side door ══
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.password_reset_requests;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
  END;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D233/560 §3: anon read % rows directly', v_n; END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.password_reset_requests (user_id, status) VALUES (v_gone, 'open');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLSTATE;
  END;
  IF v_code IS NULL THEN RAISE EXCEPTION 'D233/560 §3: anon inserted a request directly'; END IF;

  -- ══ §4 · refusal ══
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.admin_list_password_reset_requests(v_admin, 'pwr-a@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D233/560 §4: an org admin listing got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_dismiss_password_reset_request(v_admin, 'pwr-a@example.invalid', v_req);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D233/560 §4: an org admin dismissing got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_reset_user_password(v_admin, 'pwr-a@example.invalid', v_user, 'Temp-Pass-1234');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D233/560 §4: an org admin resetting got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  SELECT status INTO v_code FROM public.password_reset_requests WHERE id = v_req;
  IF v_code <> 'open' THEN RAISE EXCEPTION 'D233/560 §4: a refused call moved the request to %', v_code; END IF;

  -- ══ §5 · the list ══
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.admin_list_password_reset_requests(v_super, 'pwr-s@example.invalid')
   WHERE user_id = v_user;
  RESET ROLE;
  IF v_row.id IS DISTINCT FROM v_req OR v_row.email <> 'pwr-u@example.invalid' OR v_row.organization <> 'PWR Org' THEN
    RAISE EXCEPTION 'D233/560 §5: the list returned %', to_jsonb(v_row);
  END IF;

  -- ══ §6 · the reset resolves it ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_reset_user_password(v_super, 'pwr-s@example.invalid', v_user, 'Temp-Pass-1234');
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.password_hash <> extensions.crypt('Temp-Pass-1234', v_row.password_hash) THEN
    RAISE EXCEPTION 'D233/560 §6: the temporary password does not verify';
  END IF;
  IF v_row.force_password_change IS NOT TRUE THEN
    RAISE EXCEPTION 'D233/560 §6: the reset did not force a change';
  END IF;
  IF abs(extract(epoch FROM (v_row.password_expires_at - (now() + public.password_max_age())))) > 5 THEN
    RAISE EXCEPTION 'D233/560 §6: expiry % is not now() + password_max_age()', v_row.password_expires_at;
  END IF;
  SELECT * INTO v_row FROM public.password_reset_requests WHERE id = v_req;
  IF v_row.status <> 'resolved' OR v_row.closed_by IS DISTINCT FROM v_super OR v_row.closed_at IS NULL THEN
    RAISE EXCEPTION 'D233/560 §6: the request is %', to_jsonb(v_row);
  END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'user.reset_password' AND target_id = v_user::text AND actor_user_id = v_super
     AND after ->> 'resolved_request_id' = v_req::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D233/560 §6: % reset audit rows naming the request, expected 1', v_n; END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.admin_list_password_reset_requests(v_super, 'pwr-s@example.invalid')
   WHERE user_id = v_user;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D233/560 §6: a resolved request is still listed'; END IF;

  -- ══ §7 · dismiss ══
  SET LOCAL ROLE anon;
  PERFORM public.request_password_reset('pwr-u@example.invalid');
  RESET ROLE;
  SELECT id INTO v_req2 FROM public.password_reset_requests WHERE user_id = v_user AND status = 'open';
  IF v_req2 IS NULL OR v_req2 = v_req THEN
    RAISE EXCEPTION 'D233/560 §7: asking after a resolved request opened no new one';
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.admin_dismiss_password_reset_request(v_super, 'pwr-s@example.invalid', v_req2);
  RESET ROLE;
  SELECT status INTO v_code FROM public.password_reset_requests WHERE id = v_req2;
  IF v_code <> 'dismissed' THEN RAISE EXCEPTION 'D233/560 §7: dismiss left it %', v_code; END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'user.reset_request_dismissed' AND target_id = v_user::text AND actor_user_id = v_super;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D233/560 §7: % dismiss audit rows, expected 1', v_n; END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_dismiss_password_reset_request(v_super, 'pwr-s@example.invalid', v_req2);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'request not found or already closed' THEN
    RAISE EXCEPTION 'D233/560 §7: a second dismiss got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §8 · delete ══
  DELETE FROM public.approved_users WHERE id = v_user;
  SELECT count(*) INTO v_n FROM public.password_reset_requests WHERE user_id = v_user;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D233/560 §8: % requests outlived their account', v_n; END IF;

  RAISE NOTICE 'D233/560: a request is a note, the reset is the super admin''s, and it closes the note';
END $d233$;

DO $d233grants$
DECLARE v_fn text; v_role text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.request_password_reset(text)',
    'public.admin_list_password_reset_requests(uuid, text)',
    'public.admin_dismiss_password_reset_request(uuid, text, uuid)',
    'public.admin_reset_user_password(uuid, text, uuid, text)'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
         WHERE p.oid = v_fn::regprocedure AND x.grantee = v_role::regrole
           AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'D233/560 §9: % is not an EXPLICIT grantee of %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = v_fn::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'D233/560 §9: PUBLIC still holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;
END $d233grants$;
