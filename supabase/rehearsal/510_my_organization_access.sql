-- §4 D217 · /profile SHOWS AN ACCOUNT WHO ELSE IS IN ITS ORGANIZATION AND ON ITS PROJECTS.
--
-- `20260930000011` lifts D215's read into `project_access_read` and adds two self-service
-- reads, `get_my_organization_access` and `get_my_project_access`. What only a running
-- database can settle, every call made AS anon — the browser's role (D155):
--
--   §1 REFUSAL: a project in another tenant the reader holds nothing on, and an unknown
--      project, answer alike (`forbidden`); a call naming another user than the session
--      is refused; an inactive account is refused.
--   §2 ORGANIZATION: exactly the active organization's members, each with its default
--      organization BY NAME (D216), the reader marked; exactly its projects, with the
--      reader's own role and the count of role holders.
--   §3 ONE ANSWER: a member of the project's organization reads the project, and reads
--      EXACTLY what /admin/projects reads for it — the same function, byte for byte.
--   §4 ROLE WITHOUT ORGANIZATION: an account in another organization that holds a role on
--      the project may read it; its default organization is named.

DO $d217$
DECLARE
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_owner  uuid := gen_random_uuid();   -- org A, modeler of p
  v_plain  uuid := gen_random_uuid();   -- org A, no project role
  v_view_b uuid := gen_random_uuid();   -- org B, viewer on p, default org B
  v_out_b  uuid := gen_random_uuid();   -- org B, nothing on p
  v_off    uuid := gen_random_uuid();   -- org A, suspended
  v_p      uuid := gen_random_uuid();   -- org A
  v_q      uuid := gen_random_uuid();   -- org B
  v_out    jsonb;
  v_adm    jsonb;
  v_pers   jsonb;
  v_code   text;
  v_n      integer;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D217 Org A', 'd217-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D217 Org B', 'd217-b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,  'd217s@example.invalid', 'D217 Super',  'x', 'super_admin', 'D217 Org B', v_org_b, true),
    (v_owner,  'd217o@example.invalid', 'D217 Owner',  'x', 'modeler',     'D217 Org A', v_org_a, true),
    (v_plain,  'd217p@example.invalid', 'D217 Plain',  'x', 'modeler',     'D217 Org A', v_org_a, true),
    (v_view_b, 'd217v@example.invalid', 'D217 ViewB',  'x', 'modeler',     'D217 Org B', v_org_b, true),
    (v_out_b,  'd217x@example.invalid', 'D217 OutB',   'x', 'modeler',     'D217 Org B', v_org_b, true),
    (v_off,    'd217f@example.invalid', 'D217 Off',    'x', 'modeler',     'D217 Org A', v_org_a, false);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D217 p', v_owner, 'D217P', 'D217 Org A', v_org_a, 'single'),
    (v_q, 'D217 q', v_view_b, 'D217Q', 'D217 Org B', v_org_b, 'single');
  -- The rehearsal base is schema, not seed: plant WP 2.2's project layer where it is
  -- missing, as the migrations leave it (`20260915000005`, and D232's analyst row from
  -- `20261001000005` — a planted row must match what every later base will hold) (as `460` and `490` do).
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
    ('owner', 'data_edit_inputs', true),    ('owner', 'data_edit_policies', true),
    ('editor', 'data_edit_inputs', true),   ('editor', 'data_edit_policies', true),
    ('analyst', 'data_edit_inputs', false), ('analyst', 'data_edit_policies', false),
    ('viewer', 'data_edit_inputs', false),  ('viewer', 'data_edit_policies', false)
  ON CONFLICT (project_role, capability_key) DO NOTHING;

  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd217s@example.invalid', v_view_b, v_p, 'viewer', NULL, 'D217 viewer');
  RESET ROLE;
  UPDATE public.organization_members SET is_default = false WHERE user_id = v_view_b;
  UPDATE public.organization_members SET is_default = true WHERE user_id = v_view_b AND org_id = v_org_b;
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · refusal ══
  FOREACH v_pers IN ARRAY ARRAY[to_jsonb(v_p), to_jsonb(gen_random_uuid())] LOOP
    v_code := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      PERFORM public.get_my_project_access((v_pers #>> '{}')::uuid, v_out_b);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_code := SQLERRM;
    END;
    IF v_code IS DISTINCT FROM 'forbidden' THEN
      RAISE EXCEPTION 'D217/510 §1: another tenant''s account reading % got %, expected forbidden',
        CASE WHEN (v_pers #>> '{}')::uuid = v_p THEN 'a project it holds nothing on' ELSE 'an unknown project' END,
        COALESCE(v_code, 'success');
    END IF;
  END LOOP;

  v_code := NULL;
  BEGIN
    PERFORM set_config('app.current_user_id', v_out_b::text, true);
    SET LOCAL ROLE anon;
    PERFORM public.get_my_organization_access(v_owner);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS NULL OR v_code NOT LIKE 'not_authenticated%' THEN
    RAISE EXCEPTION 'D217/510 §1: a session naming another user got %, expected not_authenticated', COALESCE(v_code, 'success');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.get_my_organization_access(v_off);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS DISTINCT FROM 'account_inactive' THEN
    RAISE EXCEPTION 'D217/510 §1: a suspended account got %, expected account_inactive', COALESCE(v_code, 'success');
  END IF;

  -- ══ §2 · organization ══
  SET LOCAL ROLE anon;
  v_out := public.get_my_organization_access(v_plain);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);

  IF v_out -> 'organization' ->> 'id' IS DISTINCT FROM v_org_a::text
     OR v_out -> 'organization' ->> 'name' IS DISTINCT FROM 'D217 Org A' THEN
    RAISE EXCEPTION 'D217/510 §2: the organization read as %', v_out -> 'organization';
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out -> 'members') m
   WHERE (m ->> 'user_id')::uuid IN (v_owner, v_plain, v_off);
  IF v_n <> 3 OR jsonb_array_length(v_out -> 'members') <> 3 THEN
    RAISE EXCEPTION 'D217/510 §2: % members listed (% expected ones), expected exactly Org A''s three: %',
      jsonb_array_length(v_out -> 'members'), v_n, v_out -> 'members';
  END IF;
  SELECT m INTO v_pers FROM jsonb_array_elements(v_out -> 'members') m WHERE m ->> 'user_id' = v_plain::text;
  IF (v_pers ->> 'is_you')::boolean IS NOT TRUE OR (v_pers ->> 'working_here')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D217/510 §2: the reader read as %', v_pers;
  END IF;
  SELECT m INTO v_pers FROM jsonb_array_elements(v_out -> 'members') m WHERE m ->> 'user_id' = v_off::text;
  IF (v_pers ->> 'account_active')::boolean IS NOT FALSE OR (v_pers ->> 'is_you')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D217/510 §2: the suspended member read as %', v_pers;
  END IF;
  IF jsonb_array_length(v_out -> 'projects') <> 1 OR v_out -> 'projects' -> 0 ->> 'project_id' IS DISTINCT FROM v_p::text
     OR v_out -> 'projects' -> 0 ->> 'owner_name' IS DISTINCT FROM 'D217 Owner'
     OR v_out -> 'projects' -> 0 ->> 'my_role' IS NOT NULL
     OR (v_out -> 'projects' -> 0 ->> 'role_holders')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'D217/510 §2: expected Org A''s one project, no role for the reader, two role holders: %', v_out -> 'projects';
  END IF;

  -- ══ §3 · one answer ══
  SET LOCAL ROLE anon;
  v_out := public.get_my_project_access(v_p, v_plain);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  v_adm := public.admin_get_project_access(v_super, 'd217s@example.invalid', v_p);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_out IS DISTINCT FROM v_adm THEN
    RAISE EXCEPTION 'D217/510 §3: /profile and /admin/projects read the project differently: % / %', v_out, v_adm;
  END IF;

  -- ══ §4 · role without organization; the default organization is named ══
  SET LOCAL ROLE anon;
  v_out := public.get_my_project_access(v_p, v_view_b);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_view_b::text;
  IF v_pers ->> 'effective_role' IS DISTINCT FROM 'viewer'
     OR v_pers ->> 'default_org_name' IS DISTINCT FROM 'D217 Org B'
     OR v_pers ->> 'default_org_id' IS DISTINCT FROM v_org_b::text THEN
    RAISE EXCEPTION 'D217/510 §4: the cross-organization viewer read as %', v_pers;
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_plain::text;
  IF v_pers IS NULL OR v_pers ->> 'default_org_name' IS NOT NULL THEN
    RAISE EXCEPTION 'D217/510 §4: an account with no default organization read as %', v_pers;
  END IF;

  RAISE NOTICE 'D217/510: an account reads its organization''s people and its projects'' access, and nothing another tenant''s';
END $d217$;
