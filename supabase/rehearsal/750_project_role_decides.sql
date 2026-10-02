-- §4 D279 · WHERE A PERSON HOLDS A ROLE ON THE PROJECT, THE PROJECT ROLE DECIDES THE FOUR
-- PROJECT RIGHTS, AND AN EDITOR'S UPLOAD IS ACCEPTED LIKE THE OWNER'S.
--
-- `20261002000007` removes D276's account-role ceiling from `project_right_decide` and adds a
-- project-role branch to `has_project_access`. The case that was reported: a project's OWNER
-- whose account role is 'user' (Run Simulations only) and who administers the project's
-- organization held Run Simulations and not Edit Input Data, Edit Policies or Export. What only
-- a running database can settle:
--
--   §1 THE REPORTED CASE: a 'user'-account owner who is an organization admin holds all four,
--      each decided by `project_role`, and may land uploads.
--   §2 AN EDITOR: a 'user'-account Editor holds all four, even where the project's organization
--      switched Export off; the organization switch still decides for a member with no role.
--   §3 THE UPLOAD GATE: `has_project_access` is true for the owner and an Editor, false for an
--      Analyst, a Viewer, a lapsed Editor and an organization member with no role — and
--      `may_land_uploads` says the same for each, so the page and the upload agree.
--   §4 THE GATE STILL DECIDES SOMETHING: a modeler account with no project role is allowed
--      Edit Input Data by its account role and refused it by the gate (`upload_gate`).
--   §5 THE UPLOAD ITSELF: `ingest_land_file` lands an Editor's file and refuses an Analyst's.
--   §6 THE ROLES THAT GRANT LESS STILL GRANT LESS: an Analyst holds Run Simulations only, a
--      Viewer nothing — whatever their account role.

DO $d279$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- 'user' account, owns p, organization admin
  v_ued     uuid := gen_random_uuid();   -- 'user' account, editor on p
  v_ana     uuid := gen_random_uuid();   -- modeler account, analyst on p
  v_view    uuid := gen_random_uuid();   -- modeler account, viewer on p
  v_lapsed  uuid := gen_random_uuid();   -- 'user' account, editor on p until yesterday
  v_plain   uuid := gen_random_uuid();   -- modeler account, organization member, no project role
  v_p       uuid := gen_random_uuid();
  v_r       jsonb;
  v_landed  jsonb;
  v_rows    jsonb;
  v_who     uuid;
  v_label   text;
  v_want    boolean;
  t         text;
BEGIN
  -- ── the catalog the base lacks, as the migrations seed it ────────────────
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('simulation_lab', 'feature', 'Run Simulations', 220),
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
    ('owner',   'data_edit_inputs', true),  ('owner',   'data_edit_policies', true),
    ('owner',   'export', true),            ('owner',   'simulation_lab', true),
    ('editor',  'data_edit_inputs', true),  ('editor',  'data_edit_policies', true),
    ('editor',  'export', true),            ('editor',  'simulation_lab', true),
    ('analyst', 'data_edit_inputs', false), ('analyst', 'data_edit_policies', false),
    ('analyst', 'export', false),           ('analyst', 'simulation_lab', true),
    ('viewer',  'data_edit_inputs', false), ('viewer',  'data_edit_policies', false),
    ('viewer',  'export', false),           ('viewer',  'simulation_lab', false)
  ON CONFLICT (project_role, capability_key) DO NOTHING;
  -- Production's account defaults on these keys: 'user' runs simulations and nothing else.
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, k.key, r.role <> 'user' OR k.key = 'simulation_lab'
    FROM (VALUES ('super_admin'), ('admin'), ('modeler'), ('user')) r(role)
    CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies'), ('export'), ('simulation_lab')) k(key)
  ON CONFLICT (role, capability_key) DO NOTHING;
  UPDATE public.role_capabilities SET allowed = (role <> 'user' OR capability_key = 'simulation_lab')
   WHERE capability_key IN ('data_edit_inputs', 'data_edit_policies', 'export', 'simulation_lab');

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D279 Org', 'd279-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'd279o@example.invalid'), (v_ued, 'd279u@example.invalid'), (v_ana, 'd279a@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_owner,  'd279o@example.invalid', 'D279 Owner',  'x', 'user',    'D279 Org', v_org, true),
    (v_ued,    'd279u@example.invalid', 'D279 UserEd', 'x', 'user',    'D279 Org', v_org, true),
    (v_ana,    'd279a@example.invalid', 'D279 Ana',    'x', 'modeler', 'D279 Org', v_org, true),
    (v_view,   'd279v@example.invalid', 'D279 View',   'x', 'modeler', 'D279 Org', v_org, true),
    (v_lapsed, 'd279l@example.invalid', 'D279 Lapsed', 'x', 'user',    'D279 Org', v_org, true),
    (v_plain,  'd279p@example.invalid', 'D279 Plain',  'x', 'modeler', 'D279 Org', v_org, true);
  INSERT INTO public.organization_members (org_id, user_id, org_role) VALUES
    (v_org, v_owner, 'admin'), (v_org, v_ued, 'member'), (v_org, v_ana, 'member'),
    (v_org, v_view, 'member'), (v_org, v_lapsed, 'member'), (v_org, v_plain, 'member')
  ON CONFLICT (org_id, user_id) DO UPDATE SET org_role = EXCLUDED.org_role;
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D279 p', v_owner, 'D279P', 'D279 Org', v_org, 'single');
  INSERT INTO public.project_members (project_id, user_id, project_role, expires_at, rationale) VALUES
    (v_p, v_ued,    'editor',  NULL,                     'D279'),
    (v_p, v_ana,    'analyst', NULL,                     'D279'),
    (v_p, v_view,   'viewer',  NULL,                     'D279'),
    (v_p, v_lapsed, 'editor',  now() - interval '1 day', 'D279')
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET project_role = EXCLUDED.project_role, expires_at = EXCLUDED.expires_at;
  -- The project's organization switches Export off; it may decide only for people with no role.
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES (v_org, 'export', false)
  ON CONFLICT (org_id, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §1 the reported case ─────────────────────────────────────────────────
  v_r := public.project_rights_for_user(v_owner, v_p);
  IF public.effective_project_role(v_owner, v_p) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D279/750 §1: the owner resolved as %', public.effective_project_role(v_owner, v_p);
  END IF;
  IF v_r -> 'capabilities' IS DISTINCT FROM
       '{"export":true,"simulation_lab":true,"data_edit_inputs":true,"data_edit_policies":true}'::jsonb
     OR (v_r ->> 'may_land_uploads')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D279/750 §1: a user-account owner read as %', v_r;
  END IF;
  FOREACH t IN ARRAY ARRAY['simulation_lab', 'data_edit_inputs', 'data_edit_policies', 'export'] LOOP
    IF v_r -> 'decisions' -> t ->> 'decided_by' IS DISTINCT FROM 'project_role' THEN
      RAISE EXCEPTION 'D279/750 §1: the owner''s % was decided by %', t, v_r -> 'decisions' -> t ->> 'decided_by';
    END IF;
  END LOOP;

  -- ── §2 an Editor, and the organization switch ────────────────────────────
  v_r := public.project_rights_for_user(v_ued, v_p);
  IF v_r -> 'capabilities' IS DISTINCT FROM
       '{"export":true,"simulation_lab":true,"data_edit_inputs":true,"data_edit_policies":true}'::jsonb
     OR v_r -> 'decisions' -> 'export' ->> 'account_source' IS DISTINCT FROM 'organization'
     OR v_r -> 'decisions' -> 'export' ->> 'decided_by' IS DISTINCT FROM 'project_role' THEN
    RAISE EXCEPTION 'D279/750 §2: a user-account Editor read as %', v_r;
  END IF;
  v_r := public.project_rights_for_user(v_plain, v_p);
  IF (v_r -> 'capabilities' ->> 'export')::boolean IS NOT FALSE
     OR v_r -> 'decisions' -> 'export' ->> 'decided_by' IS DISTINCT FROM 'account_role'
     OR v_r -> 'decisions' -> 'export' ->> 'account_source' IS DISTINCT FROM 'organization'
     OR (v_r -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D279/750 §2: an organization member with no role read as %', v_r;
  END IF;

  -- ── §3 the upload gate, and the page's copy of it ────────────────────────
  FOR v_who, v_label, v_want IN
    SELECT * FROM (VALUES (v_owner, 'owner', true), (v_ued, 'editor', true), (v_ana, 'analyst', false),
                          (v_view, 'viewer', false), (v_lapsed, 'lapsed editor', false),
                          (v_plain, 'member with no role', false)) x(u, l, w)
  LOOP
    PERFORM set_config('app.current_user_id', v_who::text, true);
    IF public.has_project_access(v_p) IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'D279/750 §3: has_project_access for the % is %, want %', v_label, NOT v_want, v_want;
    END IF;
    PERFORM set_config('app.current_user_id', '', true);
    IF (public.project_rights_for_user(v_who, v_p) ->> 'may_land_uploads')::boolean IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'D279/750 §3: may_land_uploads for the % disagrees with the gate', v_label;
    END IF;
  END LOOP;

  -- ── §4 the gate still decides something ──────────────────────────────────
  v_r := public.project_rights_for_user(v_plain, v_p);
  IF (v_r -> 'resolved_capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_r -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     OR v_r -> 'decisions' -> 'data_edit_inputs' ->> 'decided_by' IS DISTINCT FROM 'upload_gate' THEN
    RAISE EXCEPTION 'D279/750 §4: a modeler account with no project role read as %', v_r;
  END IF;

  -- ── §5 the upload itself ─────────────────────────────────────────────────
  v_rows := jsonb_build_array(jsonb_build_object(
    'source_row_number', 2,
    'raw',      jsonb_build_object('supplier_id', 'SUP-1', 'material_id', 'MAT-1', 'volume', '10'),
    'parsed',   jsonb_build_object('supplier_id', 'SUP-1', 'material_id', 'MAT-1',
                                   'volume', 10, 'time_unit', 'week', 'lead_time', 2, 'unit_price', 3),
    'findings', '[]'::jsonb));
  v_landed := public.ingest_land_file(
    v_p, v_ued, 'csv', 'transactional', 'inbound_logistics',
    'd279.csv', 'ingest', 'project/d279/editor.csv', 'text/csv', 64,
    repeat('d', 64), v_rows);
  PERFORM set_config('app.current_user_id', '', true);
  IF (v_landed ->> 'rows_staged')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'D279/750 §5: an Editor''s landing staged %', v_landed;
  END IF;
  BEGIN
    PERFORM public.ingest_land_file(
      v_p, v_ana, 'csv', 'transactional', 'inbound_logistics',
      'd279.csv', 'ingest', 'project/d279/analyst.csv', 'text/csv', 64,
      repeat('e', 64), v_rows);
    RAISE EXCEPTION 'D279/750 §5: an Analyst landed a file';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §6 the roles that grant less ─────────────────────────────────────────
  v_r := public.project_rights_for_user(v_ana, v_p);
  IF v_r -> 'capabilities' IS DISTINCT FROM
       '{"export":false,"simulation_lab":true,"data_edit_inputs":false,"data_edit_policies":false}'::jsonb THEN
    RAISE EXCEPTION 'D279/750 §6: a modeler-account Analyst read as %', v_r -> 'capabilities';
  END IF;
  v_r := public.project_rights_for_user(v_view, v_p);
  IF EXISTS (SELECT 1 FROM jsonb_each(v_r -> 'capabilities') c WHERE (c.value #>> '{}')::boolean) THEN
    RAISE EXCEPTION 'D279/750 §6: a modeler-account Viewer read as %', v_r -> 'capabilities';
  END IF;

  RAISE NOTICE 'D279/750: an Owner or Editor holds the four project rights whatever their account role, and an Editor''s upload lands';
END $d279$;
