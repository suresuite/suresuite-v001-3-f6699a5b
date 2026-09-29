-- Audit · D185, D186 — THE AUDIT LOG CAN BE READ, RECORDS SIGN-INS, AND IS TAMPER-EVIDENT.
--
-- Every claim below is about what the database DOES for a particular role or after a
-- particular write, which no source-level test can make.
--
-- §1 D185's premise, in production's shape: rows exist, `anon` reads `audit_logs`
--    directly with RLS on and gets NOTHING. RLS is enabled here and restored after,
--    because a base with RLS off would pass §1 for the wrong reason (§16 · WP 4.1 · E).
-- §2 the read, called AS anon for a super admin, returns the window's rows; the window
--    and the plane filter each exclude what they should; a non-super-admin is refused.
-- §3 a tier-2 write is attributed to its actor AND names the project it touched, and the
--    summary counts it for that person.
-- §4 sign-ins: a right password writes `auth.sign_in` once (throttled), a wrong one for a
--    registered address writes `auth.sign_in_failed` naming the ACCOUNT as target and no
--    actor, an unknown address writes nothing — and the login's own answer is unchanged.
-- §5 write-once: UPDATE, DELETE and TRUNCATE are refused; an INSERT cannot pre-seal or
--    back-date a row.
-- §6 the chain: every row is sealed and verifies; an edited row, a deleted row and a
--    re-linked row are each named by the verify — with the guard DISABLED first, because
--    that is the only way anybody can reach them, and it is exactly the case the chain
--    exists for.

DO $audit390$
DECLARE
  v_super   uuid := gen_random_uuid();
  v_user    uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_out     jsonb;
  v_rows    integer;
  v_rls_was boolean;
  v_code    text;
  v_id      uuid;
  v_seq     bigint;
  v_auth    record;
  v_n       integer;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.approved_users (id, name, email, password_hash, role) VALUES
    (v_super, 'A390 super', 'a390s@example.invalid', extensions.crypt('right-pw-1', extensions.gen_salt('bf')), 'super_admin'),
    (v_user,  'A390 user',  'a390u@example.invalid', extensions.crypt('right-pw-2', extensions.gen_salt('bf')), 'user');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'A390 project', v_user, 'A390P');

  -- One admin-plane row, the way an /admin RPC writes it.
  PERFORM set_config('app.current_user_id', v_super::text, true);
  PERFORM public.log_admin_action('org.update', 'organizations', gen_random_uuid()::text,
                                  '{"name":"old"}'::jsonb, '{"name":"new"}'::jsonb);

  -- One data-plane row: a tier-2 write by the ordinary user.
  PERFORM set_config('app.current_user_id', v_user::text, true);
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_project, 'A390-S1');
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the defect: anon reads the table directly and gets NOTHING ══
  SELECT relrowsecurity INTO v_rls_was FROM pg_class WHERE oid = 'public.audit_logs'::regclass;
  ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_rows FROM public.audit_logs;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rows := 0;   -- no grant at all is the same answer for the page: nothing to show
  END;
  IF NOT v_rls_was THEN
    ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
  END IF;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'A390 §1: anon read % audit row(s) directly — D185''s premise is wrong, re-measure', v_rows;
  END IF;

  -- ══ §2 · the read, AS anon ══
  SET LOCAL ROLE anon;
  v_out := public.admin_audit_log_read(v_super, 'a390s@example.invalid', now() - interval '1 day');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'rows') e
                  WHERE e ->> 'action' = 'org.update' AND e ->> 'plane' = 'admin'
                    AND (e ->> 'actor_user_id')::uuid = v_super
                    AND e ->> 'actor_name' = 'A390 super') THEN
    RAISE EXCEPTION 'A390 §2: the admin row is not in the read, or not named: %', v_out -> 'rows';
  END IF;
  IF (v_out ->> 'total')::int <> jsonb_array_length(v_out -> 'rows') THEN
    RAISE EXCEPTION 'A390 §2: total % but % rows returned under the limit', v_out ->> 'total', jsonb_array_length(v_out -> 'rows');
  END IF;

  -- The plane filter.
  v_out := public.admin_audit_log_read(v_super, 'a390s@example.invalid', now() - interval '1 day', 'admin');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'rows') e WHERE e ->> 'plane' <> 'admin') THEN
    RAISE EXCEPTION 'A390 §2: plane=admin returned another plane';
  END IF;

  -- The window: everything here was written at now(), so a window opening after it is empty.
  v_out := public.admin_audit_log_read(v_super, 'a390s@example.invalid', now() + interval '1 second');
  IF (v_out ->> 'total')::int <> 0 THEN
    RAISE EXCEPTION 'A390 §2: a window opening after every row still returned %', v_out ->> 'total';
  END IF;

  -- The limit truncates rows, never the summary.
  v_out := public.admin_audit_log_read(v_super, 'a390s@example.invalid', now() - interval '1 day', NULL, 1);
  IF jsonb_array_length(v_out -> 'rows') <> 1 OR (v_out ->> 'total')::int < 2 THEN
    RAISE EXCEPTION 'A390 §2: limit 1 returned % rows of total %', jsonb_array_length(v_out -> 'rows'), v_out ->> 'total';
  END IF;
  IF (SELECT sum((a ->> 'total')::int) FROM jsonb_array_elements(v_out -> 'by_actor') a) <> (v_out ->> 'total')::int THEN
    RAISE EXCEPTION 'A390 §2: by_actor does not sum to the window total — the summary was computed on the page';
  END IF;

  -- A reader who is not a super admin is refused, not emptied.
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_audit_log_read(v_user, 'a390u@example.invalid', now() - interval '1 day');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'A390 §2: a plain user reading the audit log got %, expected forbidden', COALESCE(v_code, 'the log');
  END IF;

  -- ══ §3 · the data plane names its actor and its project ══
  v_out := public.admin_audit_log_read(v_super, 'a390s@example.invalid', now() - interval '1 day', 'data');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'rows') e
                  WHERE e ->> 'target_type' = 'suppliers' AND e ->> 'action' = 'insert'
                    AND (e ->> 'actor_user_id')::uuid = v_user
                    AND (e -> 'projects' -> 0 ->> 'id')::uuid = v_project
                    AND e -> 'projects' -> 0 ->> 'name' = 'A390 project') THEN
    RAISE EXCEPTION 'A390 §3: the supplier write is not attributed to its actor and project: %', v_out -> 'rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'by_actor') a
                  WHERE (a ->> 'actor_user_id')::uuid = v_user
                    AND (a ->> 'data_writes')::int >= 1 AND (a ->> 'rows_written')::int >= 1) THEN
    RAISE EXCEPTION 'A390 §3: the summary does not count the user''s write: %', v_out -> 'by_actor';
  END IF;

  -- ══ §4 · sign-ins ══
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('A390U@example.invalid', 'right-pw-2');
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A390 §4: a right password returned % rows — the login itself changed', v_n;
  END IF;
  SELECT * INTO v_auth FROM public.authenticate_approved_user('a390u@example.invalid', 'right-pw-2');
  IF v_auth.user_id IS DISTINCT FROM v_user OR v_auth.user_role IS DISTINCT FROM 'user'
     OR v_auth.user_name IS DISTINCT FROM 'A390 user' THEN
    RAISE EXCEPTION 'A390 §4: the login returned %, expected the user''s id, name and role', v_auth;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'auth.sign_in' AND actor_user_id = v_user AND plane = 'access';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A390 §4: two sign-ins inside a minute wrote % rows, expected 1 (throttle)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.authenticate_approved_user('a390u@example.invalid', 'wrong');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A390 §4: a wrong password returned % rows', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'auth.sign_in_failed' AND target_id = v_user::text
                    AND actor_user_id IS NULL) THEN
    RAISE EXCEPTION 'A390 §4: a wrong password for a registered address left no row naming the account';
  END IF;

  SELECT count(*) INTO v_rows FROM public.audit_logs;
  PERFORM * FROM public.authenticate_approved_user('nobody-a390@example.invalid', 'x');
  IF (SELECT count(*) FROM public.audit_logs) <> v_rows THEN
    RAISE EXCEPTION 'A390 §4: an unknown address wrote an audit row — anyone could grow the log';
  END IF;

  -- ══ §5 · write-once ══
  SELECT id INTO v_id FROM public.audit_logs WHERE actor_user_id = v_super AND action = 'org.update';

  v_code := NULL;
  BEGIN UPDATE public.audit_logs SET action = 'org.forged' WHERE id = v_id;
  EXCEPTION WHEN restrict_violation THEN v_code := SQLSTATE; END;
  IF v_code IS NULL THEN RAISE EXCEPTION 'A390 §5: an UPDATE of an audit row was allowed'; END IF;

  v_code := NULL;
  BEGIN UPDATE public.audit_logs SET seq = NULL, prev_hash = NULL, row_hash = NULL WHERE id = v_id;
  EXCEPTION WHEN restrict_violation THEN v_code := SQLSTATE; END;
  IF v_code IS NULL THEN RAISE EXCEPTION 'A390 §5: un-sealing an audit row was allowed'; END IF;

  v_code := NULL;
  BEGIN DELETE FROM public.audit_logs WHERE id = v_id;
  EXCEPTION WHEN restrict_violation THEN v_code := SQLSTATE; END;
  IF v_code IS NULL THEN RAISE EXCEPTION 'A390 §5: a DELETE of an audit row was allowed'; END IF;

  v_code := NULL;
  BEGIN TRUNCATE public.audit_logs;
  EXCEPTION WHEN restrict_violation THEN v_code := SQLSTATE; END;
  IF v_code IS NULL THEN RAISE EXCEPTION 'A390 §5: TRUNCATE of the audit log was allowed'; END IF;

  -- The actor key is gone: deleting a person who acted must not rewrite the log.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.audit_logs'::regclass AND contype = 'f') THEN
    RAISE EXCEPTION 'A390 §5: audit_logs still has a foreign key — ON DELETE SET NULL would edit a sealed row';
  END IF;

  INSERT INTO public.audit_logs (plane, action, seq, prev_hash, row_hash, created_at)
  VALUES ('admin', 'a390.forged', 999999, 'x', 'y', '2001-01-01')
  RETURNING id INTO v_id;
  IF EXISTS (SELECT 1 FROM public.audit_logs
              WHERE id = v_id AND (created_at < now() OR prev_hash = 'x' OR seq = 999999)) THEN
    RAISE EXCEPTION 'A390 §5: an INSERT kept its own seal or back-dated itself';
  END IF;

  -- ══ §6 · the chain ══
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE seq IS NULL) THEN
    RAISE EXCEPTION 'A390 §6: % row(s) left unsealed after their own insert',
      (SELECT count(*) FROM public.audit_logs WHERE seq IS NULL);
  END IF;
  v_out := public.admin_audit_log_verify(v_super, 'a390s@example.invalid');
  IF NOT (v_out ->> 'ok')::boolean
     OR (v_out ->> 'checked')::bigint <> (SELECT count(*) FROM public.audit_logs)
     OR v_out ->> 'head_hash' IS DISTINCT FROM (SELECT row_hash FROM public.audit_logs ORDER BY seq DESC LIMIT 1) THEN
    RAISE EXCEPTION 'A390 §6: an untouched chain did not verify: %', v_out;
  END IF;

  -- Only a table owner can reach a sealed row, by switching the guard off.
  ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_guard_change;

  -- (a) an edited row
  SELECT id, seq INTO v_id, v_seq FROM public.audit_logs WHERE actor_user_id = v_super AND action = 'org.update';
  UPDATE public.audit_logs SET after = '{"name":"tampered"}'::jsonb WHERE id = v_id;
  v_out := public.admin_audit_log_verify(v_super, 'a390s@example.invalid');
  IF (v_out ->> 'ok')::boolean OR (v_out -> 'first_break' ->> 'seq')::bigint <> v_seq
     OR v_out -> 'first_break' ->> 'reason' NOT LIKE '%edited%' THEN
    RAISE EXCEPTION 'A390 §6a: an edited row was not named: %', v_out;
  END IF;
  UPDATE public.audit_logs SET after = '{"name":"new"}'::jsonb WHERE id = v_id;
  IF NOT (public.admin_audit_log_verify(v_super, 'a390s@example.invalid') ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'A390 §6a: restoring the content did not restore the chain';
  END IF;

  -- (b) a row re-linked to hide what came before it
  UPDATE public.audit_logs SET prev_hash = repeat('f', 64) WHERE id = v_id;
  v_out := public.admin_audit_log_verify(v_super, 'a390s@example.invalid');
  IF (v_out ->> 'ok')::boolean OR (v_out -> 'first_break' ->> 'seq')::bigint <> v_seq THEN
    RAISE EXCEPTION 'A390 §6b: a broken link was not named: %', v_out;
  END IF;

  -- (c) a deleted row, in the middle
  SELECT (v_out -> 'first_break' ->> 'seq')::bigint INTO v_seq;   -- keep the number for the message
  DELETE FROM public.audit_logs WHERE id = v_id;
  v_out := public.admin_audit_log_verify(v_super, 'a390s@example.invalid');
  IF (v_out ->> 'ok')::boolean OR v_out -> 'first_break' ->> 'reason' NOT LIKE '%missing%' THEN
    RAISE EXCEPTION 'A390 §6c: a deleted row was not named: %', v_out;
  END IF;

  ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_guard_change;

  RAISE NOTICE 'A390: read as anon, window/plane/limit, attribution, sign-ins, write-once and chain — all held';
END
$audit390$;
