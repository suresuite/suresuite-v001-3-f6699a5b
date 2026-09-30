-- §4 D230 · A PERSON'S RIGHTS ON A PROJECT ARE ONE ANSWER, AND IT IS THE ONE THE APP ACTS ON.
--
-- `20261001000003` adds `project_rights_for_user` and reads /profile's, /admin/projects' and
-- /admin/users/:userId's rights from it, and `get_my_project_rights` gives the signed-in
-- account the same answer for the browser's gates. What only a running database can settle,
-- every self-service call made AS anon — the browser's role (D155):
--
--   §1 THE PROJECT LAYER DECIDES: a Viewer member whose ACCOUNT is a modeler holds none of
--      the four project rights; the owner holds all four.
--   §2 THE UPLOAD GATE IS PART OF "EDIT INPUT DATA": an Editor member who neither owns the
--      project nor is an app admin is refused it (the role grants it, `resolved_capabilities`
--      says so, `may_land_uploads` says why); an Editor member who is an app admin holds it.
--   §3 A SUSPENDED ACCOUNT HOLDS NOTHING: not visible, no settings, no capability — while
--      `resolved_capabilities` still shows what its role would give.
--   §4 ONE ANSWER: for every active person, what the browser's gate reads
--      (`get_my_project_rights`) equals what /profile shows (`get_my_project_access`) and
--      what /admin/users/:userId shows (`admin_get_user_memberships`).
--   §5 REFUSAL: another tenant's project and an unknown one answer `forbidden` alike; a call
--      naming another user than the session is refused; a suspended account is refused.
--   §6 IN THE PROJECT (D231): the rights are the rights IN the project, whichever
--      organization the person is working in right now — a Viewer member of the project's
--      organization working in another one sees it (`working_in_project_org` false), the
--      owner working elsewhere still edits its settings, and a member with no project role
--      takes the organization layer from the PROJECT's organization, not the active one.
--   §7 THE ANALYST RUNS AND DOES NOTHING ELSE (D232): an analyst member's own gate holds Run
--      Simulations and refuses Edit Policies, Edit Input Data and Export.

DO $d219$
DECLARE
  v_org_a   uuid := gen_random_uuid();
  v_org_b   uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- org A, modeler of p
  v_editor  uuid := gen_random_uuid();   -- org A, modeler account, editor on p
  v_admin   uuid := gen_random_uuid();   -- org A, admin account, editor on p
  v_viewer  uuid := gen_random_uuid();   -- org A, modeler account, viewer on p
  v_off     uuid := gen_random_uuid();   -- org A, owner member on p, suspended
  v_out_b   uuid := gen_random_uuid();   -- org B, nothing on p
  v_p       uuid := gen_random_uuid();   -- org A
  v_people  jsonb;
  v_pers    jsonb;
  v_mine    jsonb;
  v_adm     jsonb;
  v_code    text;
  v_uid     uuid;
  v_plain_a uuid := gen_random_uuid();   -- org A member, account role 'user', no project role
  v_analyst uuid := gen_random_uuid();   -- org A, modeler account, analyst on p
  k         text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D230 Org A', 'd219-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D230 Org B', 'd219-b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,  'd219s@example.invalid', 'D230 Super',  'x', 'super_admin', 'D230 Org B', v_org_b, true),
    (v_owner,  'd219o@example.invalid', 'D230 Owner',  'x', 'modeler',     'D230 Org A', v_org_a, true),
    (v_editor, 'd219e@example.invalid', 'D230 Editor', 'x', 'modeler',     'D230 Org A', v_org_a, true),
    (v_admin,  'd219a@example.invalid', 'D230 Admin',  'x', 'admin',       'D230 Org A', v_org_a, true),
    (v_viewer, 'd219v@example.invalid', 'D230 Viewer', 'x', 'modeler',     'D230 Org A', v_org_a, true),
    (v_off,    'd219f@example.invalid', 'D230 Off',    'x', 'modeler',     'D230 Org A', v_org_a, true),
    (v_out_b,  'd219x@example.invalid', 'D230 OutB',   'x', 'modeler',     'D230 Org B', v_org_b, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D230 p', v_owner, 'D230P', 'D230 Org A', v_org_a, 'single');

  -- The rehearsal base is schema, not seed: plant WP 2.2's project layer where it is
  -- missing, as the migrations leave it (`20260915000005`, and D232's analyst row from
  -- `20261001000005` — a planted row must match what every later base will hold) (as `460`, `490` and `510` do).
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250),
    ('simulation_lab', 'feature', 'Run Simulations', 220)
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

  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd219s@example.invalid', v_editor, v_p, 'editor', NULL, 'D230 editor');
  PERFORM public.admin_set_project_member(v_super, 'd219s@example.invalid', v_admin,  v_p, 'editor', NULL, 'D230 admin editor');
  PERFORM public.admin_set_project_member(v_super, 'd219s@example.invalid', v_viewer, v_p, 'viewer', NULL, 'D230 viewer');
  PERFORM public.admin_set_project_member(v_super, 'd219s@example.invalid', v_off,    v_p, 'owner',  NULL, 'D230 suspended owner');
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  -- Suspended AFTER its membership, so the membership is the one the page lists.
  UPDATE public.approved_users SET is_active = false WHERE id = v_off;

  SET LOCAL ROLE anon;
  v_people := public.get_my_project_access(v_p, v_owner) -> 'people';
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · the project layer decides ══
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_viewer::text;
  IF v_pers ->> 'effective_role' IS DISTINCT FROM 'viewer' OR (v_pers ->> 'visible')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'export')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D230/550 §1: a Viewer member with a modeler account read as %', v_pers;
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_owner::text;
  IF (v_pers ->> 'can_edit_project')::boolean IS NOT TRUE OR (v_pers ->> 'may_land_uploads')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'export')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D230/550 §1: the owner read as %', v_pers;
  END IF;

  -- ══ §2 · the upload gate is part of "Edit Input Data" ══
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_editor::text;
  IF (v_pers -> 'resolved_capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_pers ->> 'may_land_uploads')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D230/550 §2: an Editor who neither owns the project nor is an app admin read as %', v_pers;
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_admin::text;
  IF (v_pers ->> 'may_land_uploads')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_pers ->> 'can_edit_project')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D230/550 §2: an Editor who is an app admin read as %', v_pers;
  END IF;

  -- ══ §3 · a suspended account holds nothing ══
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_off::text;
  IF v_pers IS NULL OR (v_pers ->> 'account_active')::boolean IS NOT FALSE
     OR (v_pers ->> 'visible')::boolean IS NOT FALSE OR (v_pers ->> 'can_edit_project')::boolean IS NOT FALSE
     OR (v_pers ->> 'may_land_uploads')::boolean IS NOT FALSE
     OR EXISTS (SELECT 1 FROM jsonb_each(v_pers -> 'capabilities') c WHERE (c.value #>> '{}')::boolean)
     OR (v_pers -> 'resolved_capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D230/550 §3: a suspended owner member read as %', v_pers;
  END IF;

  -- ══ §4 · one answer: the gate, /profile and /admin/users/:userId ══
  FOREACH v_uid IN ARRAY ARRAY[v_owner, v_editor, v_admin, v_viewer] LOOP
    SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_uid::text;
    SET LOCAL ROLE anon;
    v_mine := public.get_my_project_rights(v_p, v_uid);
    RESET ROLE;
    PERFORM set_config('app.current_user_id', '', true);
    SET LOCAL ROLE anon;
    SELECT p INTO v_adm
      FROM jsonb_array_elements(public.admin_get_user_memberships(v_super, 'd219s@example.invalid', v_uid) -> 'projects') p
     WHERE p ->> 'project_id' = v_p::text;
    RESET ROLE;
    PERFORM set_config('app.current_user_id', '', true);
    FOREACH k IN ARRAY ARRAY['visible', 'can_edit_project', 'may_land_uploads', 'capabilities', 'resolved_capabilities', 'effective_role'] LOOP
      IF v_mine -> k IS DISTINCT FROM v_pers -> k OR v_adm -> k IS DISTINCT FROM v_pers -> k THEN
        RAISE EXCEPTION 'D230/550 §4: % reads % three ways — gate %, /profile %, /admin/users %',
          v_pers ->> 'name', k, v_mine -> k, v_pers -> k, v_adm -> k;
      END IF;
    END LOOP;
  END LOOP;

  -- ══ §5 · refusal ══
  FOREACH v_uid IN ARRAY ARRAY[v_p, gen_random_uuid()] LOOP
    v_code := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      PERFORM public.get_my_project_rights(v_uid, v_out_b);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_code := SQLERRM;
    END;
    PERFORM set_config('app.current_user_id', '', true);
    IF v_code IS DISTINCT FROM 'forbidden' THEN
      RAISE EXCEPTION 'D230/550 §5: another tenant''s account reading % got %, expected forbidden',
        CASE WHEN v_uid = v_p THEN 'a project it holds nothing on' ELSE 'an unknown project' END,
        COALESCE(v_code, 'success');
    END IF;
  END LOOP;

  v_code := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', v_viewer::text, true);
    SET LOCAL ROLE anon;
    PERFORM public.get_my_project_rights(v_p, v_owner);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS NULL OR v_code NOT LIKE 'not_authenticated%' THEN
    RAISE EXCEPTION 'D230/550 §5: a session naming another user got %, expected not_authenticated', COALESCE(v_code, 'success');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.get_my_project_rights(v_p, v_off);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS DISTINCT FROM 'account_inactive' THEN
    RAISE EXCEPTION 'D230/550 §5: a suspended account got %, expected account_inactive', COALESCE(v_code, 'success');
  END IF;

  -- ══ §6 · the rights are the rights in the project (D231) ══
  -- Org A lets its members run simulations; org B does not. Both org-layer rows are this
  -- rehearsal's own, so the answer can only come from the organization the resolver reads.
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES
    (v_org_a, 'simulation_lab', true), (v_org_b, 'simulation_lab', false)
  ON CONFLICT (org_id, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_plain_a, 'd219p@example.invalid', 'D219 PlainA', 'x', 'user', 'D219 Org A', v_org_a, true);
  -- The Viewer, the owner and the plain member also belong to org B and work there now —
  -- Aliona's shape: a member of the project's organization, signed in to another.
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  FOREACH v_uid IN ARRAY ARRAY[v_viewer, v_owner, v_plain_a] LOOP
    PERFORM public.admin_add_org_member(v_super, 'd219s@example.invalid', v_uid, v_org_b, 'member');
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  UPDATE public.approved_users SET organization_id = v_org_b, organization = 'D219 Org B'
   WHERE id IN (v_viewer, v_owner, v_plain_a);

  SET LOCAL ROLE anon;
  v_people := public.admin_get_project_access(v_super, 'd219s@example.invalid', v_p) -> 'people';
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);

  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_viewer::text;
  IF (v_pers ->> 'active_in_project_org')::boolean IS NOT FALSE
     OR (v_pers ->> 'visible')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D231/550 §6: a Viewer member of the project''s organization working in another read as %', v_pers;
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_owner::text;
  IF (v_pers ->> 'visible')::boolean IS NOT TRUE OR (v_pers ->> 'can_edit_project')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D231/550 §6: the owner working in another organization read as %', v_pers;
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_people) p WHERE p ->> 'user_id' = v_plain_a::text;
  IF v_pers IS NULL OR v_pers ->> 'effective_role' IS NOT NULL
     OR (v_pers ->> 'visible')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D231/550 §6: a member with no project role working in org B read as % — the organization layer must be the project''s (org A allows it)', v_pers;
  END IF;
  -- And the gate the browser reads says the same for the account itself.
  SET LOCAL ROLE anon;
  v_mine := public.get_my_project_rights(v_p, v_owner);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF (v_mine ->> 'working_in_project_org')::boolean IS NOT FALSE OR (v_mine ->> 'can_edit_project')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D231/550 §6: the owner''s own gate, working in another organization, read as %', v_mine;
  END IF;

  -- ══ §7 · the analyst runs and does nothing else (D232) ══
  -- Where this rehearsal runs the migration, the rows planted above are ON CONFLICT DO NOTHING
  -- and the analyst's grants are the ones `20261001000005` wrote; where the migration is already
  -- in the base, the planted rows are the same values. A modeler ACCOUNT, so no role layer can
  -- hand the rights back.
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_analyst, 'd232a@example.invalid', 'D232 Analyst', 'x', 'modeler', 'D219 Org A', v_org_a, true);
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd219s@example.invalid', v_analyst, v_p, 'analyst', NULL, 'D232 analyst');
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  v_mine := public.get_my_project_rights(v_p, v_analyst);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_mine ->> 'effective_role' IS DISTINCT FROM 'analyst'
     OR (v_mine -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE
     OR (v_mine -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT FALSE
     OR (v_mine -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     OR (v_mine -> 'capabilities' ->> 'export')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D232/550 §7: an analyst''s own gate read as %', v_mine;
  END IF;
  SELECT r.caps INTO v_pers FROM (
    SELECT public.project_access_read(v_p) -> 'role_matrix' -> 'analyst' AS caps) r;
  IF (v_pers ->> 'simulation_lab')::boolean IS NOT TRUE OR (v_pers ->> 'data_edit_policies')::boolean IS NOT FALSE
     OR (v_pers ->> 'export')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D232/550 §7: the legend''s analyst row read as %', v_pers;
  END IF;

  RAISE NOTICE 'D230/550: one answer for a person''s rights on a project — the gate, /profile and /admin agree, and it is what the app applies';
END $d219$;
