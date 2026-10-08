-- §4 D303 · AN ORGANIZATION ADMIN OR OWNER MAY CREATE A PROJECT IN THAT ORGANIZATION,
-- WHATEVER THE ACCOUNT ROLE.
--
-- `20261008000001` adds `project_creation_right` and re-creates `capabilities_for_user(uuid)`
-- with an organization-role grant on `/project-manager` and the rule's answer as
-- `project_creation`. What only a running database can settle:
--
--   §1 THE RULE: a 'user' account that is an ADMIN of Org A but working in Org B (its
--      default, where it is a member) is refused, naming Org B; switched to Org A it is
--      admitted BY ORGANIZATION ROLE, naming Org A. An OWNER is admitted the same way; a
--      MEMBER is not; a 'modeler' account is admitted by its account role, as before.
--   §2 THE PAGE: `get_my_capabilities` (the browser's read) opens `/project-manager` for the
--      admin in Org A and the owner, keeps it shut for the member and for the admin back in
--      Org B, and returns the rule's answer as `project_creation`, equal to the rule's own.
--   §3 OVERRIDES STILL DECIDE: an organization "off" on `/project-manager` closes the page
--      for the organization admin, and a person "on" opens it for the member — the grant
--      sits between the overrides and the account-role default, not above them.
--   §4 THE CREATE: the admin, working in Org A, creates a project through `create_project`
--      as `anon`; it lands in Org A and its creator is its `owner` (D61's trigger).
--   §5 GRANTS: `project_creation_right` is not callable by PUBLIC, `anon` or `authenticated`
--      (the default privileges would otherwise hand any client every account's roles).

DO $d303$
DECLARE
  v_super  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();   -- 'user' account; member of B (default), admin of A
  v_owner  uuid := gen_random_uuid();   -- 'user' account; owner of A
  v_member uuid := gen_random_uuid();   -- 'user' account; member of A
  v_model  uuid := gen_random_uuid();   -- 'modeler' account; member of A
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_org_s  uuid := gen_random_uuid();
  v_r      jsonb;
  v_caps   jsonb;
  v_p      uuid;
  v_fn     text;
  v_role   text;
BEGIN
  -- ── the catalog rows the base may lack, as `20260711000002` seeds them ───
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('/project-manager', 'page', 'Project Manager', 20)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability_key, allowed) VALUES
    ('super_admin', '/project-manager', true), ('admin', '/project-manager', true),
    ('modeler', '/project-manager', true),     ('user', '/project-manager', false)
  ON CONFLICT (role, capability_key) DO NOTHING;
  -- This rehearsal asserts against the seed; pin it where an earlier file planted others.
  UPDATE public.role_capabilities SET allowed = (role <> 'user')
   WHERE capability_key = '/project-manager';

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D303 Org A', 'd303a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D303 Org B', 'd303b-' || substr(v_org_b::text, 1, 8)),
    (v_org_s, 'D303 Home',  'd303s-' || substr(v_org_s::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,  'd303s@example.invalid', 'D303 Super',  'x', 'super_admin', 'D303 Home',  v_org_s, true),
    (v_admin,  'd303a@example.invalid', 'D303 Admin',  'x', 'user',        'D303 Org B', v_org_b, true),
    (v_owner,  'd303o@example.invalid', 'D303 Owner',  'x', 'user',        'D303 Org A', v_org_a, true),
    (v_member, 'd303m@example.invalid', 'D303 Member', 'x', 'user',        'D303 Org A', v_org_a, true),
    (v_model,  'd303d@example.invalid', 'D303 Model',  'x', 'modeler',     'D303 Org A', v_org_a, true);

  PERFORM public.admin_add_org_member(v_super, 'd303s@example.invalid', v_admin, v_org_a, 'admin');
  PERFORM public.admin_set_user_org_role(v_super, 'd303s@example.invalid', v_owner, v_org_a, 'owner');
  -- The browser's shape: no GUC.
  PERFORM set_config('app.current_user_id', '', true);

  IF (SELECT organization_id FROM public.approved_users WHERE id = v_admin) IS DISTINCT FROM v_org_b
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_admin AND org_id = v_org_a) IS DISTINCT FROM 'admin'
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_admin AND org_id = v_org_b) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D303/860 setup: the admin is not a member of B (active) and an admin of A';
  END IF;

  -- ── §1 the rule ──────────────────────────────────────────────────────────
  v_r := public.project_creation_right(v_admin);
  IF (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'none'
     OR v_r ->> 'organization_id' IS DISTINCT FROM v_org_b::text
     OR v_r ->> 'organization_name' IS DISTINCT FROM 'D303 Org B'
     OR v_r ->> 'org_role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D303/860 §1: an admin of A working in B (a member there) got %', v_r;
  END IF;

  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_a, v_admin);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  v_r := public.project_creation_right(v_admin);
  IF NOT (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'organization_role'
     OR v_r ->> 'organization_id' IS DISTINCT FROM v_org_a::text
     OR v_r ->> 'org_role' IS DISTINCT FROM 'admin' OR v_r ->> 'account_role' IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'D303/860 §1: the admin, working in A, got %', v_r;
  END IF;

  v_r := public.project_creation_right(v_owner);
  IF NOT (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'organization_role' THEN
    RAISE EXCEPTION 'D303/860 §1: an organization owner got %', v_r;
  END IF;
  v_r := public.project_creation_right(v_member);
  IF (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'D303/860 §1: an organization member with a user account got %', v_r;
  END IF;
  v_r := public.project_creation_right(v_model);
  IF NOT (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'account_role' THEN
    RAISE EXCEPTION 'D303/860 §1: a modeler account got %', v_r;
  END IF;
  v_r := public.project_creation_right(v_super);
  IF NOT (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'D303/860 §1: a super admin got %', v_r;
  END IF;
  v_r := public.project_creation_right(gen_random_uuid());
  IF (v_r ->> 'allowed')::boolean OR v_r ->> 'decided_by' IS DISTINCT FROM 'no_account' THEN
    RAISE EXCEPTION 'D303/860 §1: an unknown account got %', v_r;
  END IF;

  -- ── §2 the page, through the browser's read ──────────────────────────────
  SET LOCAL ROLE anon;
  v_caps := public.get_my_capabilities(v_admin);
  RESET ROLE;
  IF NOT COALESCE((v_caps -> 'pages' ->> '/project-manager')::boolean, false) THEN
    RAISE EXCEPTION 'D303/860 §2: /project-manager is shut for an organization admin (pages %)', v_caps -> 'pages';
  END IF;
  IF v_caps -> 'project_creation' IS DISTINCT FROM public.project_creation_right(v_admin) THEN
    RAISE EXCEPTION 'D303/860 §2: project_creation % is not the rule''s answer %',
      v_caps -> 'project_creation', public.project_creation_right(v_admin);
  END IF;
  IF NOT COALESCE((public.capabilities_for_user(v_owner) -> 'pages' ->> '/project-manager')::boolean, false) THEN
    RAISE EXCEPTION 'D303/860 §2: /project-manager is shut for an organization owner';
  END IF;
  IF COALESCE((public.capabilities_for_user(v_member) -> 'pages' ->> '/project-manager')::boolean, true)
     OR COALESCE((public.capabilities_for_user(v_member) -> 'project_creation' ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'D303/860 §2: an organization member with a user account was given the page or the right';
  END IF;
  IF NOT COALESCE((public.capabilities_for_user(v_model) -> 'pages' ->> '/project-manager')::boolean, false) THEN
    RAISE EXCEPTION 'D303/860 §2: a modeler account lost /project-manager';
  END IF;

  -- Back in B, where the admin is a member: the page shuts again.
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_admin);
  v_caps := public.get_my_capabilities(v_admin);
  PERFORM public.switch_my_organization(v_org_a, v_admin);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF COALESCE((v_caps -> 'pages' ->> '/project-manager')::boolean, true)
     OR COALESCE((v_caps -> 'project_creation' ->> 'allowed')::boolean, true) THEN
    RAISE EXCEPTION 'D303/860 §2: an admin of A working in B still holds the page or the right (%)', v_caps -> 'project_creation';
  END IF;

  -- ── §3 overrides still decide ────────────────────────────────────────────
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES (v_org_a, '/project-manager', false);
  IF COALESCE((public.capabilities_for_user(v_admin) -> 'pages' ->> '/project-manager')::boolean, true) THEN
    RAISE EXCEPTION 'D303/860 §3: an organization "off" did not close the page for its admin';
  END IF;
  DELETE FROM public.org_capabilities WHERE org_id = v_org_a AND capability_key = '/project-manager';
  INSERT INTO public.user_capabilities (user_id, capability_key, allowed) VALUES (v_member, '/project-manager', true);
  IF NOT COALESCE((public.capabilities_for_user(v_member) -> 'pages' ->> '/project-manager')::boolean, false) THEN
    RAISE EXCEPTION 'D303/860 §3: a person "on" did not open the page';
  END IF;
  DELETE FROM public.user_capabilities WHERE user_id = v_member AND capability_key = '/project-manager';

  -- ── §4 the create ────────────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  v_p := public.create_project(p_name => 'D303 by an organization admin', p_plant => 'D303 plant',
           p_model => 'Make-To-Order', p_bom_level => 'single', p_user_id => v_admin,
           p_user_email => 'd303a@example.invalid', p_user_name => 'D303 Admin');
  RESET ROLE;
  IF (SELECT organization_id FROM public.projects WHERE id = v_p) IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'D303/860 §4: the project landed in %, not the organization the admin works in',
      (SELECT organization_id FROM public.projects WHERE id = v_p);
  END IF;
  SELECT project_role INTO v_role FROM public.project_members WHERE project_id = v_p AND user_id = v_admin;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D303/860 §4: the creator holds project role %, expected owner', v_role;
  END IF;

  -- ── §5 grants ────────────────────────────────────────────────────────────
  v_fn := 'public.project_creation_right(uuid)';
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn::regprocedure AND a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0
                     OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))) THEN
    RAISE EXCEPTION 'D303/860 §5: % is executable by PUBLIC, anon or authenticated', v_fn;
  END IF;

  RAISE NOTICE 'D303/860: an organization admin or owner creates projects in the organization they work in';
END;
$d303$;
