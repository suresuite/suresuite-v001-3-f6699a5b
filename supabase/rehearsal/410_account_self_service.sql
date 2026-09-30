-- Account · D206 — /PROFILE'S THREE RPCS WORK FOR A USER WHO EXISTS ONLY IN
-- `approved_users`, CALLING AS `anon`, AND THE PASSWORD POLICY IS WHAT THE PAGE SAYS.
--
-- Every claim here is about what the database DOES for the role the browser really
-- uses. The runner wraps this file in one transaction, so production's "the GUC is gone
-- by the next request" is reproduced by CLEARING it before each call, not by a commit.
--
-- §1 the defect's premise: with no session and no GUC, the user is unresolvable — the
--    state every request after the login request is in.
-- §2 get_my_profile, AS anon, naming the user: the row, the policy's age in days, and
--    `password_expired` on the server clock, both ways.
-- §3 change_own_password, AS anon: wrong current password refused, too short refused,
--    same password refused, and the success path clears the forced flag, moves the
--    expiry to now() + password_max_age(), returns it, and writes an access-plane row.
-- §4 update_own_profile, AS anon: NULL leaves a field, a blank clears it; the avatar
--    colour is one of the palette's tokens and anything else is refused (CHECK).
-- §5 refusals: an inactive account cannot change anything; an unknown user and a
--    session contradicting the named user are refused.
-- §6 the column default reads the policy function, and anon/authenticated are EXPLICIT
--    grantees of all three RPCs (DROP took the old grants; PUBLIC is revoked).

DO $d205$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_row      record;
  v_expires  timestamptz;
  v_code     text;
  v_n        integer;
BEGIN
  INSERT INTO public.approved_users
    (id, name, email, password_hash, role, force_password_change, password_expires_at)
  VALUES
    (v_user, 'D206 user', 'd205u@example.invalid',
     extensions.crypt('first-password', extensions.gen_salt('bf')), 'user',
     true, now() - interval '1 day'),
    (v_inactive, 'D206 inactive', 'd205i@example.invalid',
     extensions.crypt('first-password', extensions.gen_salt('bf')), 'user',
     false, now() + interval '30 days');
  UPDATE public.approved_users SET is_active = false WHERE id = v_inactive;

  -- ══ §1 · no session, no GUC: nobody ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  IF public.get_current_user_id() IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'D206/410 §1: anon with no GUC resolved a user — the premise of D206 is wrong, re-measure before trusting this fix';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM * FROM public.get_my_profile();
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RESET ROLE;
  IF v_code IS DISTINCT FROM '28000' THEN
    RAISE EXCEPTION 'D206/410 §1: get_my_profile() with nobody named ended with SQLSTATE %, expected 28000', COALESCE(v_code, '(none — it returned a row)');
  END IF;

  -- ══ §2 · the read, as anon, naming the user ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.get_my_profile(v_user);
  RESET ROLE;
  IF v_row.id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'D206/410 §2: get_my_profile(v_user) returned %, expected the named user', v_row.id;
  END IF;
  IF v_row.force_password_change IS NOT TRUE THEN
    RAISE EXCEPTION 'D206/410 §2: force_password_change did not reach the reader';
  END IF;
  IF v_row.password_expired IS NOT TRUE THEN
    RAISE EXCEPTION 'D206/410 §2: a password that expired yesterday reads password_expired = %', v_row.password_expired;
  END IF;
  IF v_row.password_max_age_days IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'D206/410 §2: password_max_age_days is %, expected 90', v_row.password_max_age_days;
  END IF;

  -- ══ §3 · the password change, as anon ══
  PERFORM set_config('app.current_user_id', '', true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.change_own_password('not-the-password', 'second-password', v_user);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'invalid_current_password' THEN
    RAISE EXCEPTION 'D206/410 §3: a wrong current password ended with "%", expected invalid_current_password', COALESCE(v_code, '(none — it changed the password)');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.change_own_password('first-password', 'short', v_user);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'password_too_short' THEN
    RAISE EXCEPTION 'D206/410 §3: a 5-character password ended with "%", expected password_too_short', COALESCE(v_code, '(none)');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.change_own_password('first-password', 'first-password', v_user);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'password_unchanged' THEN
    RAISE EXCEPTION 'D206/410 §3: re-using the current password ended with "%", expected password_unchanged — a forced change would reset the clock and change nothing', COALESCE(v_code, '(none)');
  END IF;

  SET LOCAL ROLE anon;
  v_expires := public.change_own_password('first-password', 'second-password', v_user);
  RESET ROLE;

  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.password_hash <> extensions.crypt('second-password', v_row.password_hash) THEN
    RAISE EXCEPTION 'D206/410 §3: the new password does not verify against the stored hash';
  END IF;
  IF v_row.force_password_change THEN
    RAISE EXCEPTION 'D206/410 §3: force_password_change is still set after a successful change';
  END IF;
  IF v_row.password_expires_at IS DISTINCT FROM now() + public.password_max_age()
     OR v_expires IS DISTINCT FROM v_row.password_expires_at THEN
    RAISE EXCEPTION 'D206/410 §3: expiry stored % / returned %, expected now() + password_max_age() = %',
      v_row.password_expires_at, v_expires, now() + public.password_max_age();
  END IF;
  IF v_row.password_changed_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'D206/410 §3: password_changed_at is %, expected now()', v_row.password_changed_at;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'access' AND action = 'auth.password_changed' AND actor_user_id = v_user;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D206/410 §3: % auth.password_changed row(s) for the user, expected 1', v_n;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.get_my_profile(v_user);
  RESET ROLE;
  IF v_row.password_expired OR v_row.force_password_change THEN
    RAISE EXCEPTION 'D206/410 §3: after the change the reader still sees expired=% forced=%', v_row.password_expired, v_row.force_password_change;
  END IF;

  -- ══ §4 · the profile write: NULL leaves, blank clears ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile('  Dee  ', '+49 30 1234', NULL, v_user);
  PERFORM public.update_own_profile(NULL, NULL, 'teal', v_user);
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.display_name IS DISTINCT FROM 'Dee' OR v_row.phone IS DISTINCT FROM '+49 30 1234'
     OR v_row.avatar_color IS DISTINCT FROM 'teal' THEN
    RAISE EXCEPTION 'D206/410 §4: after two writes the row reads name=% phone=% colour=% — NULL must leave a field unchanged',
      v_row.display_name, v_row.phone, v_row.avatar_color;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.get_my_profile(v_user);
  RESET ROLE;
  IF v_row.avatar_color IS DISTINCT FROM 'teal' THEN
    RAISE EXCEPTION 'D206/410 §4: get_my_profile reads avatar_color %, expected teal', v_row.avatar_color;
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.update_own_profile(NULL, NULL, '#ff0000', v_user);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION 'D206/410 §4: a colour outside the palette ended with SQLSTATE %, expected 23514 (check_violation)', COALESCE(v_code, '(none — it was stored)');
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(NULL, '', '', v_user);
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.phone IS NOT NULL OR v_row.avatar_color IS NOT NULL OR v_row.display_name IS DISTINCT FROM 'Dee' THEN
    RAISE EXCEPTION 'D206/410 §4: a blank phone and colour left phone=% colour=% name=% — a blank must clear only its own field',
      v_row.phone, v_row.avatar_color, v_row.display_name;
  END IF;

  -- ══ §5 · refusals ══
  PERFORM set_config('app.current_user_id', '', true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.change_own_password('first-password', 'second-password', v_inactive);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'account_inactive' THEN
    RAISE EXCEPTION 'D206/410 §5: an inactive account''s password change ended with "%", expected account_inactive', COALESCE(v_code, '(none — it changed)');
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.update_own_profile('x', NULL, NULL, v_inactive);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'account_inactive' THEN
    RAISE EXCEPTION 'D206/410 §5: an inactive account''s profile write ended with "%", expected account_inactive', COALESCE(v_code, '(none — it wrote)');
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT * INTO v_row FROM public.get_my_profile(v_inactive);
  RESET ROLE;
  IF v_row.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'D206/410 §5: get_my_profile must still READ an inactive account (the login refuses it), got is_active=%', v_row.is_active;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM * FROM public.get_my_profile(gen_random_uuid());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '28000' THEN
    RAISE EXCEPTION 'D206/410 §5: an unknown user ended with SQLSTATE %, expected 28000', COALESCE(v_code, '(none)');
  END IF;

  -- A session (here: the GUC branch of get_current_user_id) that names somebody else.
  PERFORM set_config('app.current_user_id', v_inactive::text, true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM * FROM public.get_my_profile(v_user);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLSTATE;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'D206/410 §5: a named user contradicting the session ended with SQLSTATE %, expected 42501', COALESCE(v_code, '(none — it answered for one of them)');
  END IF;

  RAISE NOTICE 'D206/410: an approved-users-only user, calling as anon, reads their account, changes their password under the policy and edits their profile; inactive, unknown and contradicted callers are refused';
END $d205$;

-- ══ §6 · the default and the grants ══
DO $d205grants$
DECLARE
  v_fn      text;
  v_role    text;
  v_default text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.approved_users'::regclass AND a.attname = 'password_expires_at';
  IF v_default IS NULL OR v_default NOT LIKE '%password_max_age()%' THEN
    RAISE EXCEPTION 'D206/410 §6: approved_users.password_expires_at defaults to %, not through password_max_age()', COALESCE(v_default, '(nothing)');
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_my_profile(uuid)',
    'public.update_own_profile(text, text, text, uuid)',
    'public.change_own_password(text, text, uuid)'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
         WHERE p.oid = v_fn::regprocedure AND x.grantee = v_role::regrole
           AND x.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'D206/410 §6: % is not an EXPLICIT grantee of %', v_role, v_fn;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = v_fn::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'D206/410 §6: PUBLIC still holds EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.account_self_resolve(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D206/410 §6: anon can call account_self_resolve directly';
  END IF;
END $d205grants$;
