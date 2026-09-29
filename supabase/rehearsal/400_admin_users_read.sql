-- Admin users · D205 — /admin/users LISTS the accounts, suspension is ENFORCED, and an
-- account's organization is authored ONCE.
--
-- Every claim below is about what the database DOES for a particular role, which no
-- source-level test can make.
--
-- §1 the defect, in production's shape: accounts exist, the GUC is blank, and `anon`
--    reading `v_admin_user_usage` gets NOTHING — the page's "No users yet."
-- §2 `admin_list_users` AS anon, for a super admin, returns every account, with the
--    organization NAME resolved through the uuid (a rename shows at once; the stale
--    text copy does not leak); a plain user and a SUSPENDED super admin are refused.
-- §3 sign-in: a suspended account with the right password gets no row and leaves an
--    `auth.sign_in_failed` naming the reason; reactivated, it signs in.
-- §4 the verbs cannot lock the platform out: no self-suspend, no self-demote; a second
--    super admin CAN be suspended and demoted, so the guard is not a blanket refusal;
--    with one active super admin left, nobody who passes the gate can remove it. (The
--    count guard's other job — two admins suspending EACH OTHER concurrently — needs two
--    sessions and is held by the row lock in `_lock_active_super_admins`, not asserted.)
-- §5 membership follows `organization_id`: a move leaves exactly one row, in the new
--    organization, with the backfill's role mapping; a row naming another organization
--    is refused; clearing the organization removes the row; `admin_list_organizations`
--    counts Members by the uuid, equal to the rows §2 lists.
-- §6 the Overview's figures are the tables' own counts, and its top users come from
--    this month's usage; `admin_usage_log_read` names each row's person.

DO $admin400$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_super2 uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_rows   integer;
  v_n      integer;
  v_code   text;
  v_out    jsonb;
  r        record;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'A400 Org A', 'a400-org-a'),
    (v_org_b, 'A400 Org B', 'a400-org-b');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super,  'A400 super',  'a400s@example.invalid',  extensions.crypt('right-pw-1', extensions.gen_salt('bf')), 'super_admin', 'A400 Org A', v_org_a),
    (v_super2, 'A400 super2', 'a400s2@example.invalid', extensions.crypt('right-pw-3', extensions.gen_salt('bf')), 'super_admin', 'A400 Org A', v_org_a),
    (v_user,   'A400 user',   'a400u@example.invalid',  extensions.crypt('right-pw-2', extensions.gen_salt('bf')), 'user',        'A400 Org A', v_org_a);

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the defect: anon reads the view and gets NOTHING ══
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_rows FROM public.v_admin_user_usage;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rows := 0;   -- no grant at all is the same answer for the page: nothing to list
  END;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'A400 §1: anon read % row(s) from v_admin_user_usage — D205''s premise is wrong, re-measure', v_rows;
  END IF;

  -- ══ §2 · the list, AS anon ══
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_rows FROM public.admin_list_users(v_super, 'a400s@example.invalid');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.approved_users;
  IF v_rows <> v_n THEN
    RAISE EXCEPTION 'A400 §2: admin_list_users returned % of % accounts', v_rows, v_n;
  END IF;

  -- A rename shows through the uuid; the text copy stays stale and is NOT what is shown.
  UPDATE public.organizations SET name = 'A400 Org A renamed' WHERE id = v_org_a;
  SELECT * INTO r FROM public.admin_list_users(v_super, 'a400s@example.invalid') WHERE user_id = v_user;
  IF r.organization IS DISTINCT FROM 'A400 Org A renamed' OR r.organization_id IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'A400 §2: organization shown as % (%), expected the renamed name through the uuid', r.organization, r.organization_id;
  END IF;
  IF r.org_role IS DISTINCT FROM 'member' OR r.is_active IS DISTINCT FROM true OR r.role <> 'user' THEN
    RAISE EXCEPTION 'A400 §2: row fields wrong: role %, org_role %, active %', r.role, r.org_role, r.is_active;
  END IF;

  -- A plain user is refused, not emptied.
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_list_users(v_user, 'a400u@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'A400 §2: a plain user listing accounts got %, expected forbidden', COALESCE(v_code, 'the list');
  END IF;

  -- A SUSPENDED super admin is refused too — the gate reads is_active now.
  UPDATE public.approved_users SET is_active = false WHERE id = v_super2;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_list_users(v_super2, 'a400s2@example.invalid');
  EXCEPTION WHEN OTHERS THEN
    v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'A400 §2: a suspended super admin got %, expected forbidden', COALESCE(v_code, 'the list');
  END IF;
  UPDATE public.approved_users SET is_active = true WHERE id = v_super2;

  -- ══ §3 · sign-in refuses a suspended account ══
  PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_user, false);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_rows FROM public.authenticate_approved_user('a400u@example.invalid', 'right-pw-2');
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'A400 §3: a SUSPENDED account signed in with the right password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE plane = 'access' AND action = 'auth.sign_in_failed'
                    AND target_id = v_user::text AND actor_user_id IS NULL
                    AND after ->> 'reason' = 'account suspended') THEN
    RAISE EXCEPTION 'A400 §3: the refused sign-in of a suspended account left no record naming why';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs
              WHERE action = 'auth.sign_in' AND actor_user_id = v_user) THEN
    RAISE EXCEPTION 'A400 §3: a suspended account was recorded as signed in';
  END IF;
  PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_user, true);
  SELECT count(*) INTO v_rows FROM public.authenticate_approved_user('a400u@example.invalid', 'right-pw-2');
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'A400 §3: a reactivated account could not sign in (% rows)', v_rows;
  END IF;

  -- ══ §4 · the verbs cannot lock the platform out ══
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_super, false);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code IS NULL OR v_code NOT LIKE '%your own account%' THEN
    RAISE EXCEPTION 'A400 §4: self-suspension got %', COALESCE(v_code, 'through');
  END IF;

  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_role(v_super, 'a400s@example.invalid', v_super, 'user');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code IS NULL OR v_code NOT LIKE '%your own super_admin role%' THEN
    RAISE EXCEPTION 'A400 §4: self-demotion got %', COALESCE(v_code, 'through');
  END IF;

  -- With a second active super admin, one may suspend and restore the other — the
  -- guard is not a blanket refusal.
  PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_super2, false);
  PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_super2, true);
  PERFORM public.admin_set_user_role(v_super, 'a400s@example.invalid', v_super2, 'admin');
  PERFORM public.admin_set_user_role(v_super, 'a400s@example.invalid', v_super2, 'super_admin');

  -- Leave exactly two active super admins, and have one retire the other.
  UPDATE public.approved_users SET is_active = false
   WHERE role = 'super_admin' AND id NOT IN (v_super, v_super2);
  PERFORM public.admin_set_user_active(v_super2, 'a400s2@example.invalid', v_super, false);
  IF public._active_super_admin_count() <> 1 THEN
    RAISE EXCEPTION 'A400 §4: expected one active super admin, have %', public._active_super_admin_count();
  END IF;

  -- The last one cannot leave: the only actor who passes the gate IS the last one.
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_active(v_super2, 'a400s2@example.invalid', v_super2, false);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'A400 §4: the last active super admin suspended themselves';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_role(v_super2, 'a400s2@example.invalid', v_super2, 'admin');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'A400 §4: the last active super admin demoted themselves';
  END IF;

  -- …and the suspended one cannot act at all, not even to remove the last.
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_active(v_super, 'a400s@example.invalid', v_super2, false);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'A400 §4: a suspended super admin acting got %', COALESCE(v_code, 'through');
  END IF;
  IF public._active_super_admin_count() <> 1 THEN
    RAISE EXCEPTION 'A400 §4: the platform lost its last active super admin';
  END IF;
  PERFORM public.admin_set_user_active(v_super2, 'a400s2@example.invalid', v_super, true);

  -- ══ §5 · membership follows organization_id ══
  UPDATE public.approved_users SET organization_id = v_org_b WHERE id = v_user;
  SELECT count(*) INTO v_n FROM public.organization_members WHERE user_id = v_user;
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.organization_members
                              WHERE user_id = v_user AND org_id = v_org_b AND org_role = 'member') THEN
    RAISE EXCEPTION 'A400 §5: after a move the account has % membership row(s), expected one in the new org', v_n;
  END IF;

  -- The backfill's role mapping on a move: an app `admin` is an org `admin`.
  UPDATE public.approved_users SET role = 'admin' WHERE id = v_user;
  UPDATE public.approved_users SET organization_id = v_org_a WHERE id = v_user;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE user_id = v_user AND org_id = v_org_a AND org_role = 'admin') THEN
    RAISE EXCEPTION 'A400 §5: an app admin moved into an org is not its org admin';
  END IF;
  UPDATE public.approved_users SET role = 'user' WHERE id = v_user;

  -- A membership naming another organization is refused.
  v_code := NULL;
  BEGIN
    INSERT INTO public.organization_members (org_id, user_id) VALUES (v_org_b, v_user);
  EXCEPTION WHEN check_violation THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION 'A400 §5: a membership row in an org the account is not in was accepted';
  END IF;

  -- The admin RPCs still work through the rule (they insert the row that already exists).
  PERFORM public.admin_update_user(v_super2, 'a400s2@example.invalid', v_user, 'A400 user', v_org_b);
  SELECT count(*) INTO v_n FROM public.organization_members WHERE user_id = v_user;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A400 §5: admin_update_user left % membership rows', v_n;
  END IF;

  -- Members counted by the uuid equal what the list shows under that org.
  SELECT members INTO v_n FROM public.admin_list_organizations(v_super2, 'a400s2@example.invalid') WHERE id = v_org_b;
  SELECT count(*) INTO v_rows FROM public.admin_list_users(v_super2, 'a400s2@example.invalid') WHERE organization_id = v_org_b;
  IF v_n <> v_rows OR v_n <> 1 THEN
    RAISE EXCEPTION 'A400 §5: Organizations says % member(s), Users lists %', v_n, v_rows;
  END IF;

  -- Clearing the organization removes the row.
  -- `organization` is NOT NULL with the `'default_org'` sentinel, which names no
  -- organization, so the stamping trigger leaves the uuid NULL.
  UPDATE public.approved_users SET organization = 'default_org', organization_id = NULL WHERE id = v_user;
  IF (SELECT organization_id FROM public.approved_users WHERE id = v_user) IS NOT NULL THEN
    RAISE EXCEPTION 'A400 §5: the organization could not be cleared';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'A400 §5: an account with no organization still holds a membership row';
  END IF;

  -- ══ §6 · the Overview and the usage log ══
  INSERT INTO public.ai_usage_logs (user_id, org_id, model_code, total_tokens, cost_usd, status)
  VALUES (v_user, v_org_b, 'a400-model', 10, 1.25, 'success'),
         (v_user, v_org_b, 'a400-model', 20, 0.75, 'success');

  SET LOCAL ROLE anon;
  v_out := public.admin_platform_overview(v_super2, 'a400s2@example.invalid');
  RESET ROLE;
  IF (v_out ->> 'users')::int <> (SELECT count(*) FROM public.approved_users)
     OR (v_out ->> 'organizations')::int <> (SELECT count(*) FROM public.organizations)
     OR (v_out ->> 'projects')::int <> (SELECT count(*) FROM public.projects)
     OR (v_out ->> 'requests')::int <> (SELECT count(*) FROM public.ai_usage_logs) THEN
    RAISE EXCEPTION 'A400 §6: overview counts disagree with the tables: %', v_out;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'top_users') t
                  WHERE (t ->> 'user_id')::uuid = v_user AND t ->> 'label' = 'A400 user'
                    AND (t ->> 'requests')::int = 2 AND (t ->> 'cost')::numeric = 2.00) THEN
    RAISE EXCEPTION 'A400 §6: top_users does not carry the month''s usage: %', v_out -> 'top_users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'top_orgs') t
                  WHERE (t ->> 'org_id')::uuid = v_org_b AND t ->> 'label' = 'A400 Org B') THEN
    RAISE EXCEPTION 'A400 §6: top_orgs does not name the org: %', v_out -> 'top_orgs';
  END IF;

  SELECT count(*) INTO v_n FROM public.admin_usage_log_read(v_super2, 'a400s2@example.invalid', 500)
   WHERE user_id = v_user AND user_name = 'A400 user';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'A400 §6: the usage log named % of 2 rows', v_n;
  END IF;

  SELECT mtd_requests INTO v_n FROM public.admin_list_users(v_super2, 'a400s2@example.invalid') WHERE user_id = v_user;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'A400 §6: the Users page says % requests MTD, the log holds 2', v_n;
  END IF;

  RAISE NOTICE 'A400: list as anon, uuid-resolved org, suspension enforced, lock-out guards, one membership, overview — all held';
END
$admin400$;
