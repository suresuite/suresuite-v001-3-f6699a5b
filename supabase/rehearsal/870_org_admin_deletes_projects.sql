-- §4 D304 · AN ORGANIZATION ADMIN OR OWNER MAY DELETE A PROJECT OF THAT ORGANIZATION AND THE
-- DATA INSIDE ONE, WHATEVER THE ACCOUNT ROLE.
--
-- `20261009000001` adds `project_org_admin` and re-creates `delete_project` and
-- `delete_project_dataset` with it as one more way through their checks. What only a running
-- database can settle:
--
--   §1 THE ANSWER: a 'user' account that is an ADMIN of Org A, working in A, is an
--      organization admin of A's project and not of B's; an OWNER is too; a MEMBER is not;
--      the same admin working in B is not one of A's project (the active organization is a
--      condition, as it is for an account admin).
--   §2 THE DATA: the admin empties a dataset of a project it did not create, through
--      `delete_project_dataset` as `anon`; the member is refused with `forbidden`, and so is
--      the admin on Org B's project.
--   §3 THE PROJECT: the owner deletes a project it did not create through `delete_project`
--      and the row is gone; the member and the admin-of-another-organization are refused with
--      `insufficient_privilege`, and the project survives each refusal.
--   §4 NOTHING NARROWED: the project's creator (a modeler) still deletes its own data.
--   §5 GRANTS: `project_org_admin` is not callable by PUBLIC, `anon` or `authenticated`.

DO $d304$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();   -- 'user' account; admin of A, member of B
  v_owner  uuid := gen_random_uuid();   -- 'user' account; owner of A
  v_member uuid := gen_random_uuid();   -- 'user' account; member of A
  v_maker  uuid := gen_random_uuid();   -- 'modeler' account in A; creates the projects
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_s  uuid := gen_random_uuid();
  v_p1     uuid := gen_random_uuid();   -- A, by the modeler
  v_p2     uuid := gen_random_uuid();   -- A, by the modeler
  v_q      uuid := gen_random_uuid();   -- B
  v_code   text;
  v_msg    text;
  v_n      integer;
  v_fn     text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D304 Org A', 'd304a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D304 Org B', 'd304b-' || substr(v_org_b::text, 1, 8)),
    (v_org_s, 'D304 Home',  'd304s-' || substr(v_org_s::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,  'd304s@example.invalid', 'D304 Super',  'x', 'super_admin', 'D304 Home',  v_org_s, true),
    (v_admin,  'd304a@example.invalid', 'D304 Admin',  'x', 'user',        'D304 Org A', v_org_a, true),
    (v_owner,  'd304o@example.invalid', 'D304 Owner',  'x', 'user',        'D304 Org A', v_org_a, true),
    (v_member, 'd304m@example.invalid', 'D304 Member', 'x', 'user',        'D304 Org A', v_org_a, true),
    (v_maker,  'd304k@example.invalid', 'D304 Maker',  'x', 'modeler',     'D304 Org A', v_org_a, true);
  PERFORM public.admin_set_user_org_role(v_super, 'd304s@example.invalid', v_admin, v_org_a, 'admin');
  PERFORM public.admin_set_user_org_role(v_super, 'd304s@example.invalid', v_owner, v_org_a, 'owner');
  PERFORM public.admin_add_org_member(v_super, 'd304s@example.invalid', v_admin, v_org_b, 'member');
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p1, 'D304 p1', v_maker, 'D304P', 'D304 Org A', v_org_a, 'single'),
    (v_p2, 'D304 p2', v_maker, 'D304P', 'D304 Org A', v_org_a, 'single'),
    (v_q,  'D304 q',  v_super, 'D304Q', 'D304 Org B', v_org_b, 'single');
  PERFORM set_config('app.current_user_id', '', true);

  IF (SELECT organization_id FROM public.approved_users WHERE id = v_admin) IS DISTINCT FROM v_org_a
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_admin AND org_id = v_org_a) IS DISTINCT FROM 'admin'
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_member AND org_id = v_org_a) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D304/870 setup: the memberships are not as assumed';
  END IF;

  -- ── §1 the answer ────────────────────────────────────────────────────────
  IF NOT public.project_org_admin(v_admin, v_p1) THEN
    RAISE EXCEPTION 'D304/870 §1: an admin of A, working in A, is not an organization admin of A''s project';
  END IF;
  IF public.project_org_admin(v_admin, v_q) THEN
    RAISE EXCEPTION 'D304/870 §1: an admin of A is an organization admin of B''s project';
  END IF;
  IF NOT public.project_org_admin(v_owner, v_p1) THEN
    RAISE EXCEPTION 'D304/870 §1: an owner of A is not an organization admin of A''s project';
  END IF;
  IF public.project_org_admin(v_member, v_p1) THEN
    RAISE EXCEPTION 'D304/870 §1: a member of A is an organization admin of A''s project';
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_admin);
  RESET ROLE;
  IF public.project_org_admin(v_admin, v_p1) THEN
    RAISE EXCEPTION 'D304/870 §1: an admin of A working in B still counts as an admin of A''s project';
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_a, v_admin);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §2 the data ──────────────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  v_n := public.delete_project_dataset(v_p1, 'network_nodes', v_admin, 'd304a@example.invalid');
  v_n := public.delete_project_dataset(v_p1, 'all', v_admin, 'd304a@example.invalid');
  RESET ROLE;

  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.delete_project_dataset(v_p1, 'all', v_member, 'd304m@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D304/870 §2: a member deleting a project''s data got %', COALESCE(v_msg, '(no error)');
  END IF;

  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.delete_project_dataset(v_q, 'all', v_admin, 'd304a@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D304/870 §2: an admin of A deleting B''s project''s data got %', COALESCE(v_msg, '(no error)');
  END IF;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §3 the project ───────────────────────────────────────────────────────
  v_code := NULL;
  BEGIN PERFORM public.delete_project(v_p2, v_member, 'd304m@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p2) THEN
    RAISE EXCEPTION 'D304/870 §3: a member deleting a project got % (project kept: %)',
      COALESCE(v_code, '(no error)'), EXISTS (SELECT 1 FROM public.projects WHERE id = v_p2);
  END IF;

  v_code := NULL;
  BEGIN PERFORM public.delete_project(v_q, v_admin, 'd304a@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_q) THEN
    RAISE EXCEPTION 'D304/870 §3: an admin of A deleting B''s project got % (project kept: %)',
      COALESCE(v_code, '(no error)'), EXISTS (SELECT 1 FROM public.projects WHERE id = v_q);
  END IF;

  PERFORM public.delete_project(v_p2, v_owner, 'd304o@example.invalid');
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_p2) THEN
    RAISE EXCEPTION 'D304/870 §3: the organization owner''s delete left the project in place';
  END IF;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §4 nothing narrowed ──────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  v_n := public.delete_project_dataset(v_p1, 'all', v_maker, 'd304k@example.invalid');
  RESET ROLE;
  PERFORM public.delete_project(v_p1, v_maker, 'd304k@example.invalid');
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_p1) THEN
    RAISE EXCEPTION 'D304/870 §4: the creator could no longer delete its own project';
  END IF;

  -- ── §5 grants ────────────────────────────────────────────────────────────
  v_fn := 'public.project_org_admin(uuid, uuid)';
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn::regprocedure AND a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0
                     OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))) THEN
    RAISE EXCEPTION 'D304/870 §5: % is executable by PUBLIC, anon or authenticated', v_fn;
  END IF;

  RAISE NOTICE 'D304/870: an organization admin or owner deletes projects and their data in the organization it works in';
END;
$d304$;
