-- §4 D213 · THREE ACCESS LEVELS — PLATFORM, ORGANIZATION, PROJECT — READABLE FROM THE
-- PROJECT'S SIDE AND FROM THE ACCOUNT'S OWN, WITH NO RULE CHANGED.
--
-- Every claim below is about what the database DOES when the browser calls as `anon`
-- (D155), which no source-level test can make. The writes are D211's verbs, exercised
-- here only to put the reads in a known state.
--
-- §1 `admin_project_access` lists every member of the project's organization with all
--    three levels: the account tier, the role in the organization, the project role and
--    what `effective_project_role` resolves — and nobody outside it.
-- §2 a project role granted through D211's verb shows up as `member_role` and
--    `effective_role`.
-- §3 a role held by an account that has LEFT the project's organization is still listed,
--    with `in_project_org = false`.
-- §4 `list_my_project_roles` returns the projects of the account's ACTIVE organization
--    only, with the owner marked (`is_modeler`) and its role.
-- §5 `admin_project_access` refuses a caller who is not an active super admin.
-- §6 nothing reads anything new: an Admin-tier account with no project role still resolves
--    to NULL on the project, exactly as `rehearsal/240` pins (D66).

DO $levels480$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();   -- account tier admin, in Org A
  v_mod    uuid := gen_random_uuid();   -- modeler, owner of the project
  v_usr    uuid := gen_random_uuid();   -- user, in Org A and Org B
  v_out    uuid := gen_random_uuid();   -- user, Org B only
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_s  uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_proj_b uuid := gen_random_uuid();
  v_n      integer;
  v_m      integer;
  v_msg    text;
  v_row    record;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'M480 Org A', 'm480-org-a'),
    (v_org_b, 'M480 Org B', 'm480-org-b'),
    (v_org_s, 'M480 Home',  'm480-home');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super, 'M480 super',   'm480s@example.invalid', extensions.crypt('pw-s', extensions.gen_salt('bf')), 'super_admin', 'M480 Home',  v_org_s),
    (v_admin, 'M480 admin',   'm480a@example.invalid', extensions.crypt('pw-a', extensions.gen_salt('bf')), 'admin',       'M480 Org A', v_org_a),
    (v_mod,   'M480 modeler', 'm480m@example.invalid', extensions.crypt('pw-m', extensions.gen_salt('bf')), 'modeler',     'M480 Org A', v_org_a),
    (v_usr,   'M480 user',    'm480u@example.invalid', extensions.crypt('pw-u', extensions.gen_salt('bf')), 'user',        'M480 Org A', v_org_a),
    (v_out,   'M480 outside', 'm480o@example.invalid', extensions.crypt('pw-o', extensions.gen_salt('bf')), 'user',        'M480 Org B', v_org_b);
  INSERT INTO public.organization_members (org_id, user_id, org_role) VALUES (v_org_b, v_usr, 'member');

  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id) VALUES
    (v_proj,   'M480 project', v_mod, 'M480P', 'M480 Org A', v_org_a),
    (v_proj_b, 'M480 other',   v_out, 'M480P', 'M480 Org B', v_org_b);

  -- ══ §1 · everyone in the organization, at three levels ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*), count(*) FILTER (WHERE user_id = v_out) INTO v_n, v_m
    FROM public.admin_project_access(v_super, 'm480s@example.invalid', v_proj);
  RESET ROLE;
  IF v_n <> 3 OR v_m <> 0 THEN
    RAISE EXCEPTION 'M480 §1: admin_project_access lists % account(s) (% from outside), expected the 3 members of Org A', v_n, v_m;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm480s@example.invalid', v_proj) WHERE user_id = v_admin;
  IF v_row.account_role IS DISTINCT FROM 'admin' OR v_row.org_role IS DISTINCT FROM 'admin'
     OR v_row.in_project_org IS NOT TRUE OR v_row.member_role IS NOT NULL
     OR v_row.effective_role IS NOT NULL OR v_row.is_modeler THEN
    RAISE EXCEPTION 'M480 §1: the Admin-tier account reads %', to_jsonb(v_row);
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm480s@example.invalid', v_proj) WHERE user_id = v_mod;
  IF v_row.is_modeler IS NOT TRUE OR v_row.effective_role IS DISTINCT FROM 'owner' OR v_row.member_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'M480 §1: the owner reads %', to_jsonb(v_row);
  END IF;

  -- ══ §2 · a project role, granted through D211's verb ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'm480s@example.invalid', v_usr, v_proj, 'editor', NULL, 'runs the uploads');
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm480s@example.invalid', v_proj) WHERE user_id = v_usr;
  IF v_row.member_role IS DISTINCT FROM 'editor' OR v_row.effective_role IS DISTINCT FROM 'editor'
     OR v_row.org_role IS DISTINCT FROM 'member' OR v_row.account_role IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'M480 §2: after the grant the user reads %', to_jsonb(v_row);
  END IF;

  -- ══ §3 · a role outside the organization is reported, not dropped ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_org_member(v_super, 'm480s@example.invalid', v_usr, v_org_a);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm480s@example.invalid', v_proj) WHERE user_id = v_usr;
  IF v_row.user_id IS NULL OR v_row.in_project_org IS NOT FALSE OR v_row.org_role IS NOT NULL
     OR v_row.member_role IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'M480 §3: a role held outside the organization reads %', to_jsonb(v_row);
  END IF;

  -- ══ §4 · the account's own: its ACTIVE organization's projects only ══
  -- Leaving Org A moved the user's active organization to Org B (D210).
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*), count(*) FILTER (WHERE project_id = v_proj_b AND effective_role IS NULL AND NOT is_modeler)
    INTO v_n, v_m FROM public.list_my_project_roles(v_usr);
  RESET ROLE;
  IF v_n <> 1 OR v_m <> 1 THEN
    RAISE EXCEPTION 'M480 §4: list_my_project_roles for the user returned % row(s), % of them Org B''s project with no role', v_n, v_m;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.list_my_project_roles(v_mod)
   WHERE project_id = v_proj AND is_modeler AND effective_role = 'owner';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M480 §4: list_my_project_roles does not show the modeler as the owner of its project';
  END IF;

  -- ══ §5 · only a super admin reads the project's access ══
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_project_access(v_admin, 'm480a@example.invalid', v_proj);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'M480 §5: an Admin-tier account reading admin_project_access got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- ══ §6 · no rule moved ══
  IF public.project_role_rank(public.effective_project_role(v_admin, v_proj)) <> 0 THEN
    RAISE EXCEPTION 'M480 §6: the Admin-tier account resolves to % on a project it holds no role on — a rule moved',
      public.effective_project_role(v_admin, v_proj);
  END IF;
END $levels480$;
