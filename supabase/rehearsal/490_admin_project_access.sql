-- §4 D215 · /admin/projects SHOWS WHO IS ON A PROJECT AND WHAT EACH OF THEM MAY DO.
--
-- `20260930000008` adds `admin_get_project_access`, the per-project reading of D211's
-- `admin_get_user_memberships`. What only a running database can settle, the calls made
-- AS anon — the browser's role (D155):
--
--   §1 REFUSAL: a non-super-admin is refused the read; an unknown project is named.
--   §2 WHO: exactly the owner, the members (of any organization), and the members of the
--      project's organization without a role — nobody from another organization who
--      holds nothing on it — the owner first.
--   §3 WHAT: each person's source and rights — the owner edits, an editor's role grants
--      inputs that the upload gate refuses it (D230) and not the project's settings, a cross-organization viewer is recorded but does
--      not see it, an organization member with no role sees it and holds no role.
--   §4 ONE ANSWER: for every person listed, the effective role, visibility, settings
--      right and capabilities equal what /admin/users/:userId reads for the same project.
--   §5 DELEGATION AND EXPIRY: a live delegation is listed and resolves; a revoked one
--      brings nobody in; a lapsed membership is listed as expired and resolves to nothing.

DO $d215$
DECLARE
  v_org_a  uuid := gen_random_uuid();
  v_org_b  uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_owner  uuid := gen_random_uuid();   -- org A, modeler of p
  v_editor uuid := gen_random_uuid();   -- org A, editor on p
  v_plain  uuid := gen_random_uuid();   -- org A, no project role
  v_view_b uuid := gen_random_uuid();   -- org B, viewer on p
  v_out_b  uuid := gen_random_uuid();   -- org B, nothing on p
  v_p      uuid := gen_random_uuid();   -- org A
  v_out    jsonb;
  v_mine   jsonb;
  v_pers   jsonb;
  v_proj   jsonb;
  v_code   text;
  v_n      integer;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D215 Org A', 'd215-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D215 Org B', 'd215-b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id) VALUES
    (v_super,  'd215s@example.invalid', 'D215 Super',  'x', 'super_admin', 'D215 Org A', v_org_a),
    (v_owner,  'd215o@example.invalid', 'D215 Owner',  'x', 'modeler',     'D215 Org A', v_org_a),
    (v_editor, 'd215e@example.invalid', 'D215 Editor', 'x', 'modeler',     'D215 Org A', v_org_a),
    (v_plain,  'd215p@example.invalid', 'D215 Plain',  'x', 'modeler',     'D215 Org A', v_org_a),
    (v_view_b, 'd215v@example.invalid', 'D215 ViewB',  'x', 'modeler',     'D215 Org B', v_org_b),
    (v_out_b,  'd215x@example.invalid', 'D215 OutB',   'x', 'modeler',     'D215 Org B', v_org_b);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D215 p', v_owner, 'D215P', 'D215 Org A', v_org_a, 'single');

  -- The rehearsal base is schema, not seed: plant WP 2.2's project layer where it is
  -- missing, verbatim from `20260915000005` (as `460` does).
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250),
    ('simulation_lab', 'feature', 'Simulation Lab', 260)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
    ('owner', 'data_edit_inputs', true),    ('owner', 'data_edit_policies', true),
    ('editor', 'data_edit_inputs', true),   ('editor', 'data_edit_policies', true),
    ('analyst', 'data_edit_inputs', false), ('analyst', 'data_edit_policies', true),
    ('viewer', 'data_edit_inputs', false),  ('viewer', 'data_edit_policies', false)
  ON CONFLICT (project_role, capability_key) DO NOTHING;

  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · refusal ══
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_get_project_access(v_owner, 'd215o@example.invalid', v_p);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D215/490 §1: the project''s own owner calling the read got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_get_project_access(v_super, 'd215s@example.invalid', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'project not found' THEN
    RAISE EXCEPTION 'D215/490 §1: an unknown project got %, expected project not found', COALESCE(v_code, 'success');
  END IF;

  -- ══ §2 · who ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd215s@example.invalid', v_editor, v_p, 'editor', NULL, 'D215 editor');
  PERFORM public.admin_set_project_member(v_super, 'd215s@example.invalid', v_view_b, v_p, 'viewer', now() + interval '7 days', NULL);
  v_out := public.admin_get_project_access(v_super, 'd215s@example.invalid', v_p);
  RESET ROLE;

  IF v_out ->> 'organization_name' IS DISTINCT FROM 'D215 Org A' OR v_out ->> 'modeler_id' IS DISTINCT FROM v_owner::text THEN
    RAISE EXCEPTION 'D215/490 §2: the project read as %', v_out - 'people';
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out -> 'people') p
   WHERE (p ->> 'user_id')::uuid IN (v_super, v_owner, v_editor, v_plain, v_view_b);
  IF v_n <> 5 OR jsonb_array_length(v_out -> 'people') <> 5 THEN
    RAISE EXCEPTION 'D215/490 §2: % people listed (% expected ones), expected exactly the super admin (org A), owner, editor, plain and org B viewer: %',
      jsonb_array_length(v_out -> 'people'), v_n, v_out -> 'people';
  END IF;
  IF v_out -> 'people' -> 0 ->> 'user_id' IS DISTINCT FROM v_owner::text THEN
    RAISE EXCEPTION 'D215/490 §2: the owner is not listed first: %', v_out -> 'people' -> 0;
  END IF;

  -- ══ §3 · what ══
  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_owner::text;
  IF (v_pers ->> 'is_modeler')::boolean IS NOT TRUE OR v_pers ->> 'effective_role' IS DISTINCT FROM 'owner'
     OR (v_pers ->> 'visible')::boolean IS NOT TRUE OR (v_pers ->> 'can_edit_project')::boolean IS NOT TRUE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D215/490 §3: the owner read as %', v_pers;
  END IF;

  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_editor::text;
  IF v_pers -> 'member' ->> 'project_role' IS DISTINCT FROM 'editor' OR v_pers ->> 'effective_role' IS DISTINCT FROM 'editor'
     OR v_pers -> 'member' ->> 'granted_by' IS DISTINCT FROM 'D215 Super'
     OR v_pers -> 'member' ->> 'rationale' IS DISTINCT FROM 'D215 editor'
     OR (v_pers ->> 'visible')::boolean IS NOT TRUE OR (v_pers ->> 'can_edit_project')::boolean IS NOT FALSE
     -- D230: the role grants inputs, the upload gate (owner or app admin) refuses them.
     OR (v_pers -> 'resolved_capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_pers ->> 'may_land_uploads')::boolean IS NOT FALSE
     OR (v_pers -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D215/490 §3: the editor read as %', v_pers;
  END IF;

  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_view_b::text;
  IF v_pers ->> 'effective_role' IS DISTINCT FROM 'viewer' OR (v_pers ->> 'visible')::boolean IS NOT FALSE
     OR (v_pers ->> 'in_project_org')::boolean IS NOT FALSE OR v_pers ->> 'org_role' IS NOT NULL
     OR (v_pers -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D215/490 §3: the cross-organization viewer read as %', v_pers;
  END IF;

  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_plain::text;
  IF v_pers ->> 'effective_role' IS NOT NULL OR v_pers -> 'member' <> 'null'::jsonb
     OR (v_pers ->> 'visible')::boolean IS NOT TRUE OR (v_pers ->> 'in_project_org')::boolean IS NOT TRUE
     OR v_pers ->> 'org_role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D215/490 §3: the organization member with no role read as %', v_pers;
  END IF;

  -- ══ §4 · one answer: the per-user page reads the same rights ══
  FOR v_pers IN SELECT p FROM jsonb_array_elements(v_out -> 'people') p LOOP
    v_mine := public.admin_get_user_memberships(v_super, 'd215s@example.invalid', (v_pers ->> 'user_id')::uuid);
    SELECT p INTO v_proj FROM jsonb_array_elements(v_mine -> 'projects') p WHERE p ->> 'project_id' = v_p::text;
    IF v_proj IS NULL
       OR v_proj -> 'effective_role'   IS DISTINCT FROM v_pers -> 'effective_role'
       OR v_proj -> 'visible'          IS DISTINCT FROM v_pers -> 'visible'
       OR v_proj -> 'can_edit_project' IS DISTINCT FROM v_pers -> 'can_edit_project'
       OR v_proj -> 'capabilities'     IS DISTINCT FROM v_pers -> 'capabilities'
       OR v_proj -> 'member'           IS DISTINCT FROM v_pers -> 'member'
       OR v_proj -> 'is_modeler'       IS DISTINCT FROM v_pers -> 'is_modeler' THEN
      RAISE EXCEPTION 'D215/490 §4: % reads differently on the two admin pages: per-project % / per-user %',
        v_pers ->> 'name', v_pers, v_proj;
    END IF;
  END LOOP;

  -- ══ §5 · delegation and expiry ══
  INSERT INTO public.delegation_grants (project_id, grantor_user_id, grantee_user_id, project_role, expires_at, rationale)
  VALUES (v_p, v_owner, v_plain, 'analyst', now() + interval '3 days', 'D215 live');
  INSERT INTO public.delegation_grants (project_id, grantor_user_id, grantee_user_id, project_role, expires_at, rationale, revoked_at)
  VALUES (v_p, v_owner, v_out_b, 'viewer', now() + interval '3 days', 'D215 revoked', now());
  UPDATE public.project_members SET expires_at = now() - interval '1 minute'
   WHERE project_id = v_p AND user_id = v_view_b;

  SET LOCAL ROLE anon;
  v_out := public.admin_get_project_access(v_super, 'd215s@example.invalid', v_p);
  RESET ROLE;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_plain::text;
  IF v_pers ->> 'effective_role' IS DISTINCT FROM 'analyst' OR jsonb_array_length(v_pers -> 'delegations') <> 1
     OR v_pers -> 'delegations' -> 0 ->> 'grantor' IS DISTINCT FROM 'D215 Owner' THEN
    RAISE EXCEPTION 'D215/490 §5: the delegate read as %', v_pers;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_out_b::text) THEN
    RAISE EXCEPTION 'D215/490 §5: a revoked delegation brought its grantee into the list';
  END IF;
  SELECT p INTO v_pers FROM jsonb_array_elements(v_out -> 'people') p WHERE p ->> 'user_id' = v_view_b::text;
  IF v_pers IS NULL OR (v_pers -> 'member' ->> 'expired')::boolean IS NOT TRUE OR v_pers ->> 'effective_role' IS NOT NULL THEN
    RAISE EXCEPTION 'D215/490 §5: a lapsed membership read as %', v_pers;
  END IF;

  RAISE NOTICE 'D215/490: a project''s people and their rights are read only by a super admin, and agree with the per-user page';
END $d215$;
