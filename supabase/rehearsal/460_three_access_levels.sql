-- §4 D211 · THREE ACCESS LEVELS — PLATFORM, ORGANIZATION, PROJECT — MANAGEABLE AND
-- READABLE, WITH NO RULE CHANGED.
--
-- Every claim below is about what the database DOES when the browser calls as `anon`
-- (D155), which no source-level test can make.
--
-- §1 a project that changes modeler (`admin_transfer_project`) makes the new modeler an
--    owner; the previous modeler's row is left; the backfill's rule is the trigger's.
-- §2 `admin_set_org_member_role` changes the role IN PLACE: the membership count and
--    the account's ACTIVE organization do not move (remove-and-re-add would move it);
--    logged as `org.member_role`; a non-member is refused by name.
-- §3 `admin_set_project_member` gives and changes a project role, which
--    `effective_project_role` then returns; an account outside the project's
--    organization is refused (`not_in_organization`); an invalid role is refused.
-- §4 the owner guards: the creator cannot be demoted or removed (`creator_is_owner`);
--    the last owner cannot be removed (`last_owner`); a second owner can.
-- §5 the reads: `admin_project_access` lists every member of the project's organization
--    with all three levels, and a stale role (an account no longer in that
--    organization) with `in_project_org = false`; `admin_user_project_roles` agrees;
--    `list_my_project_roles` returns the ACTIVE organization's projects only.
-- §6 every verb refuses a caller who is not an active super admin.
-- §7 nothing reads anything new: the promotion's gate still refuses an organization-
--    level `admin` who holds no project role, exactly as `rehearsal/240` pins (D66).

DO $levels460$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();   -- account tier admin, in Org A
  v_mod    uuid := gen_random_uuid();   -- modeler, creator of the project
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
  v_role   text;
  v_row    record;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'M460 Org A', 'm460-org-a'),
    (v_org_b, 'M460 Org B', 'm460-org-b'),
    (v_org_s, 'M460 Home',  'm460-home');
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id) VALUES
    (v_super, 'M460 super',   'm460s@example.invalid', extensions.crypt('pw-s', extensions.gen_salt('bf')), 'super_admin', 'M460 Home',  v_org_s),
    (v_admin, 'M460 admin',   'm460a@example.invalid', extensions.crypt('pw-a', extensions.gen_salt('bf')), 'admin',       'M460 Org A', v_org_a),
    (v_mod,   'M460 modeler', 'm460m@example.invalid', extensions.crypt('pw-m', extensions.gen_salt('bf')), 'modeler',     'M460 Org A', v_org_a),
    (v_usr,   'M460 user',    'm460u@example.invalid', extensions.crypt('pw-u', extensions.gen_salt('bf')), 'user',        'M460 Org A', v_org_a),
    (v_out,   'M460 outside', 'm460o@example.invalid', extensions.crypt('pw-o', extensions.gen_salt('bf')), 'user',        'M460 Org B', v_org_b);
  INSERT INTO public.organization_members (org_id, user_id, org_role) VALUES (v_org_b, v_usr, 'member');

  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id) VALUES
    (v_proj,   'M460 project', v_mod, 'M460P', 'M460 Org A', v_org_a),
    (v_proj_b, 'M460 other',   v_out, 'M460P', 'M460 Org B', v_org_b);

  IF public.effective_project_role(v_mod, v_proj) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'M460 setup: the creator is not the project''s owner (D61) — %',
      public.effective_project_role(v_mod, v_proj);
  END IF;

  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · a new modeler becomes an owner ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_transfer_project(v_super, 'm460s@example.invalid', v_proj, v_org_a, v_usr);
  RESET ROLE;
  IF public.effective_project_role(v_usr, v_proj) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'M460 §1: the new modeler holds %, expected owner', public.effective_project_role(v_usr, v_proj);
  END IF;
  IF public.effective_project_role(v_mod, v_proj) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'M460 §1: the previous modeler''s row was touched (%)', public.effective_project_role(v_mod, v_proj);
  END IF;
  -- …and back, so the rest of the file reads with the modeler as creator.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_transfer_project(v_super, 'm460s@example.invalid', v_proj, v_org_a, v_mod);
  RESET ROLE;
  -- The user keeps the owner row the hand-over gave it; the rest of the file needs it
  -- as a plain user again, which a super admin can do because it is no longer creator.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_project_member(v_super, 'm460s@example.invalid', v_proj, v_usr);
  RESET ROLE;
  IF public.effective_project_role(v_usr, v_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'M460 §1: removing the former modeler''s owner row left %', public.effective_project_role(v_usr, v_proj);
  END IF;

  -- ══ §2 · an org role changed in place ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_org_member_role(v_super, 'm460s@example.invalid', v_usr, v_org_b, 'admin');
  RESET ROLE;
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_usr AND org_id = v_org_b) IS DISTINCT FROM 'admin'
     OR (SELECT count(*) FROM public.organization_members WHERE user_id = v_usr) <> 2
     OR (SELECT organization_id FROM public.approved_users WHERE id = v_usr) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'M460 §2: the role change did not land in place (role %, memberships %, active %)',
      (SELECT org_role FROM public.organization_members WHERE user_id = v_usr AND org_id = v_org_b),
      (SELECT count(*) FROM public.organization_members WHERE user_id = v_usr),
      (SELECT organization_id FROM public.approved_users WHERE id = v_usr);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'org.member_role' AND actor_user_id = v_super AND target_id = v_usr::text) THEN
    RAISE EXCEPTION 'M460 §2: the role change left no org.member_role row naming the super admin';
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_member_role(v_super, 'm460s@example.invalid', v_out, v_org_a, 'admin');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'not_a_member%' THEN
    RAISE EXCEPTION 'M460 §2: a role change for a non-member got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- ══ §3 · a project role, given and changed ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_usr, 'analyst', NULL);
  RESET ROLE;
  IF public.effective_project_role(v_usr, v_proj) IS DISTINCT FROM 'analyst' THEN
    RAISE EXCEPTION 'M460 §3: after the grant the resolver says %, expected analyst', public.effective_project_role(v_usr, v_proj);
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_usr, 'editor', 'runs the uploads');
  RESET ROLE;
  SELECT project_role, granted_by::text || '|' || rationale INTO v_role, v_msg
    FROM public.project_members WHERE project_id = v_proj AND user_id = v_usr;
  IF v_role IS DISTINCT FROM 'editor' OR v_msg IS DISTINCT FROM v_super::text || '|runs the uploads' THEN
    RAISE EXCEPTION 'M460 §3: the change stored % / %', v_role, v_msg;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'project.member_set' AND actor_user_id = v_super AND target_id = v_usr::text) THEN
    RAISE EXCEPTION 'M460 §3: the grant left no project.member_set row naming the super admin';
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_out, 'viewer', NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'not_in_organization%' THEN
    RAISE EXCEPTION 'M460 §3: a project role for an account outside the organization got %', COALESCE(v_msg, '(no error — granted)');
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_usr, 'admin', NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'invalid project role%' THEN
    RAISE EXCEPTION 'M460 §3: an org word used as a project role got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- ══ §4 · the owner guards ══
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_mod, 'viewer', NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'creator_is_owner%' THEN
    RAISE EXCEPTION 'M460 §4: demoting the creator got %', COALESCE(v_msg, '(no error — demoted)');
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_remove_project_member(v_super, 'm460s@example.invalid', v_proj, v_mod);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'creator_is_owner%' THEN
    RAISE EXCEPTION 'M460 §4: removing the creator got %', COALESCE(v_msg, '(no error — removed)');
  END IF;
  -- The last owner, where the creator holds no row (its modeler row was removed outright).
  DELETE FROM public.project_members WHERE project_id = v_proj_b;
  INSERT INTO public.project_members (project_id, user_id, project_role) VALUES (v_proj_b, v_usr, 'owner');
  UPDATE public.projects SET modeler_id = v_super WHERE id = v_proj_b;
  DELETE FROM public.project_members WHERE project_id = v_proj_b AND user_id = v_super;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_remove_project_member(v_super, 'm460s@example.invalid', v_proj_b, v_usr);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'last_owner%' THEN
    RAISE EXCEPTION 'M460 §4: removing the last owner got %', COALESCE(v_msg, '(no error — removed)');
  END IF;
  -- A second owner may go.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'm460s@example.invalid', v_proj, v_admin, 'owner', NULL);
  PERFORM public.admin_remove_project_member(v_super, 'm460s@example.invalid', v_proj, v_admin);
  RESET ROLE;
  IF public.effective_project_role(v_admin, v_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'M460 §4: a second owner could not be removed';
  END IF;

  -- ══ §5 · the reads ══
  -- Org A holds admin, modeler and user; the outsider has no standing. A stale role:
  -- the user leaves Org A while holding editor on its project.
  PERFORM set_config('app.current_user_id', '', true);
  SELECT count(*) INTO v_n FROM public.admin_project_access(v_super, 'm460s@example.invalid', v_proj);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'M460 §5: admin_project_access lists % account(s), expected the 3 members of Org A', v_n;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm460s@example.invalid', v_proj) WHERE user_id = v_admin;
  IF v_row.account_role <> 'admin' OR v_row.org_role <> 'admin' OR NOT v_row.in_project_org
     OR v_row.member_role IS NOT NULL OR v_row.effective_role IS NOT NULL OR v_row.is_creator THEN
    RAISE EXCEPTION 'M460 §5: the admin reads %', to_jsonb(v_row);
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm460s@example.invalid', v_proj) WHERE user_id = v_mod;
  IF NOT v_row.is_creator OR v_row.effective_role <> 'owner' THEN
    RAISE EXCEPTION 'M460 §5: the creator reads %', to_jsonb(v_row);
  END IF;

  DELETE FROM public.organization_members WHERE org_id = v_org_a AND user_id = v_usr;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_project_access(v_super, 'm460s@example.invalid', v_proj) WHERE user_id = v_usr;
  IF v_row.user_id IS NULL OR v_row.in_project_org OR v_row.member_role <> 'editor' THEN
    RAISE EXCEPTION 'M460 §5: a role held outside the organization reads %', to_jsonb(v_row);
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT * INTO v_row FROM public.admin_user_project_roles(v_super, 'm460s@example.invalid', v_usr) WHERE project_id = v_proj;
  IF v_row.project_id IS NULL OR v_row.in_project_org OR v_row.effective_role <> 'editor' THEN
    RAISE EXCEPTION 'M460 §5: admin_user_project_roles disagrees: %', to_jsonb(v_row);
  END IF;

  -- The account's own: the ACTIVE organization's projects, and no other tenant's.
  -- The user's active organization moved to Org B when it left Org A (D210).
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*), count(*) FILTER (WHERE project_id = v_proj_b AND effective_role = 'owner')
    INTO v_n, v_m FROM public.list_my_project_roles(v_usr);
  RESET ROLE;
  IF v_n <> 1 OR v_m <> 1 THEN
    RAISE EXCEPTION 'M460 §5: list_my_project_roles for the user returned % row(s) (% as owner of Org B''s project)', v_n, v_m;
  END IF;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.list_my_project_roles(v_mod) WHERE project_id = v_proj AND is_creator AND effective_role = 'owner';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'M460 §5: list_my_project_roles does not show the modeler as creator and owner';
  END IF;

  -- ══ §6 · a caller who is not a super admin ══
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_project_member(v_admin, 'm460a@example.invalid', v_proj, v_mod, 'viewer', NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'M460 §6: an organization admin setting a project role got %', COALESCE(v_msg, '(no error)');
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_project_access(v_mod, 'm460m@example.invalid', v_proj);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'M460 §6: a modeler reading admin_project_access got %', COALESCE(v_msg, '(no error)');
  END IF;
  v_msg := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_org_member_role(v_admin, 'm460a@example.invalid', v_mod, v_org_a, 'owner');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'M460 §6: an organization admin changing an org role got %', COALESCE(v_msg, '(no error)');
  END IF;

  -- ══ §7 · no rule moved ══
  -- The organization-level admin holds no project role, so the resolver — and with it
  -- the promotion's gate — still says NULL for it (D66, rehearsal/240).
  IF public.project_role_rank(public.effective_project_role(v_admin, v_proj)) <> 0 THEN
    RAISE EXCEPTION 'M460 §7: the organization admin resolves to % on a project it holds no role on — a rule moved',
      public.effective_project_role(v_admin, v_proj);
  END IF;
END $levels460$;
