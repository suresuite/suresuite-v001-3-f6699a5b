-- §4 D210 · /admin/users/:userId SHOWS AN ACCOUNT'S ORGANIZATION, PROJECTS AND RIGHTS,
-- AND A SUPER ADMIN CAN CHANGE THEM THERE.
--
-- `20260930000004` adds `admin_get_user_memberships` and four verbs. What only a running
-- database can settle, every call made AS anon — the browser's role (D155):
--
--   §1 REFUSALS: a non-super-admin is refused the read and every verb.
--   §2 THE READ: the organization is named with the org role; the projects are exactly
--      the organization's, the owned one and the cross-organization membership — no
--      other — each with where access comes from, and the rights are the RESOLVER's
--      (an editor edits inputs, an analyst does not, the owner does).
--   §3 THE MODELER STAYS AN OWNER: demoting, expiring or removing the modeler's own
--      membership is refused, and the row is unchanged.
--   §4 EXPIRY: a past end date is refused; a lapsed membership is listed as expired and
--      resolves to no role.
--   §5 REMOVAL: a removed cross-organization membership drops the project from the read.
--   §6 ORG ROLE: set, shown, invalid refused.
--   §7 MOVE: moving the account changes which projects are visible and leaves exactly one
--      organization membership; "no organization" is refused.
--   §8 ATTRIBUTION: every change left an admin log row naming the super admin.

DO $d210$
DECLARE
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_super uuid := gen_random_uuid();
  v_user  uuid := gen_random_uuid();   -- the account under inspection, modeler of p1
  v_other uuid := gen_random_uuid();   -- owns p2 and p3
  v_p1    uuid := gen_random_uuid();   -- org A, owned by v_user
  v_p2    uuid := gen_random_uuid();   -- org A, owned by v_other
  v_p3    uuid := gen_random_uuid();   -- org B, owned by v_other
  v_out   jsonb;
  v_proj  jsonb;
  v_code  text;
  v_n     integer;
  v_fn    text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D210 Org A', 'd210-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D210 Org B', 'd210-b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id) VALUES
    (v_super, 'd210s@example.invalid', 'D210 Super', 'x', 'super_admin', 'D210 Org A', v_org_a),
    (v_user,  'd210u@example.invalid', 'D210 User',  'x', 'modeler',     'D210 Org A', v_org_a),
    (v_other, 'd210o@example.invalid', 'D210 Other', 'x', 'modeler',     'D210 Org B', v_org_b);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p1, 'D210 p1', v_user,  'D210P1', 'D210 Org A', v_org_a, 'single'),
    (v_p2, 'D210 p2', v_other, 'D210P2', 'D210 Org A', v_org_a, 'single'),
    (v_p3, 'D210 p3', v_other, 'D210P3', 'D210 Org B', v_org_b, 'single');

  -- The rehearsal base is schema, not seed: plant WP 2.2's project layer where it is
  -- missing, verbatim from `20260915000005`, so the rights asserted below are the
  -- resolver's and not four NULLs.
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

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · refusals ══
  FOREACH v_fn IN ARRAY ARRAY['read','org','org_role','member','remove'] LOOP
    v_code := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      CASE v_fn
        WHEN 'read'     THEN PERFORM public.admin_get_user_memberships(v_user, 'd210u@example.invalid', v_user);
        WHEN 'org'      THEN PERFORM public.admin_set_user_organization(v_user, 'd210u@example.invalid', v_user, v_org_b);
        WHEN 'org_role' THEN PERFORM public.admin_set_user_org_role(v_user, 'd210u@example.invalid', v_user, 'owner');
        WHEN 'member'   THEN PERFORM public.admin_set_project_member(v_user, 'd210u@example.invalid', v_user, v_p3, 'owner');
        WHEN 'remove'   THEN PERFORM public.admin_remove_project_member(v_user, 'd210u@example.invalid', v_other, v_p3);
      END CASE;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_code := SQLERRM;
    END;
    IF v_code IS DISTINCT FROM 'forbidden' THEN
      RAISE EXCEPTION 'D210/450 §1: a modeler calling % got %, expected forbidden', v_fn, COALESCE(v_code, 'success');
    END IF;
  END LOOP;

  -- ══ §2 · the read ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd210s@example.invalid', v_user, v_p2, 'editor', NULL, 'D210 editor');
  PERFORM public.admin_set_project_member(v_super, 'd210s@example.invalid', v_user, v_p3, 'analyst', now() + interval '7 days', NULL);
  v_out := public.admin_get_user_memberships(v_super, 'd210s@example.invalid', v_user);
  RESET ROLE;

  IF v_out -> 'organization' ->> 'name' IS DISTINCT FROM 'D210 Org A'
     OR v_out -> 'organization' ->> 'org_role' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D210/450 §2: organization read as %', v_out -> 'organization';
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out -> 'projects');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'D210/450 §2: % project(s) listed, expected p1, p2, p3', v_n;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p1::text;
  IF (v_proj ->> 'is_modeler')::boolean IS NOT TRUE OR v_proj ->> 'effective_role' IS DISTINCT FROM 'owner'
     OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'can_edit_project')::boolean IS NOT TRUE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D210/450 §2: the owned project read as %', v_proj;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p2::text;
  IF v_proj -> 'member' ->> 'project_role' IS DISTINCT FROM 'editor' OR v_proj ->> 'effective_role' IS DISTINCT FROM 'editor'
     OR v_proj -> 'member' ->> 'granted_by' IS DISTINCT FROM 'D210 Super'
     OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'can_edit_project')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D210/450 §2: the editor membership read as %', v_proj;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj ->> 'effective_role' IS DISTINCT FROM 'analyst' OR (v_proj ->> 'visible')::boolean IS NOT FALSE
     OR (v_proj ->> 'in_user_org')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D210/450 §2: the cross-organization analyst membership read as %', v_proj;
  END IF;
  IF jsonb_array_length(v_out -> 'project_capabilities') = 0 OR v_out -> 'role_matrix' -> 'viewer' IS NULL THEN
    RAISE EXCEPTION 'D210/450 §2: the role matrix is missing: %', v_out -> 'role_matrix';
  END IF;

  -- ══ §3 · the modeler stays a standing owner ══
  FOREACH v_fn IN ARRAY ARRAY['demote','expire','remove'] LOOP
    v_code := NULL;
    BEGIN
      CASE v_fn
        WHEN 'demote' THEN PERFORM public.admin_set_project_member(v_super, 'd210s@example.invalid', v_user, v_p1, 'viewer');
        WHEN 'expire' THEN PERFORM public.admin_set_project_member(v_super, 'd210s@example.invalid', v_user, v_p1, 'owner', now() + interval '1 day');
        WHEN 'remove' THEN PERFORM public.admin_remove_project_member(v_super, 'd210s@example.invalid', v_user, v_p1);
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      v_code := SQLERRM;
    END;
    IF v_code IS NULL OR v_code NOT LIKE 'this user owns the project%' THEN
      RAISE EXCEPTION 'D210/450 §3: % the modeler''s membership got %, expected a refusal', v_fn, COALESCE(v_code, 'success');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.project_members
                  WHERE project_id = v_p1 AND user_id = v_user AND project_role = 'owner' AND expires_at IS NULL) THEN
    RAISE EXCEPTION 'D210/450 §3: the modeler''s owner membership changed despite the refusals';
  END IF;

  -- ══ §4 · expiry ══
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_project_member(v_super, 'd210s@example.invalid', v_user, v_p2, 'viewer', now() - interval '1 day');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS NULL OR v_code NOT LIKE 'expires_at % is already in the past' THEN
    RAISE EXCEPTION 'D210/450 §4: a past end date got %, expected a refusal', COALESCE(v_code, 'success');
  END IF;
  UPDATE public.project_members SET expires_at = now() - interval '1 minute'
   WHERE project_id = v_p3 AND user_id = v_user;
  v_out := public.admin_get_user_memberships(v_super, 'd210s@example.invalid', v_user);
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj IS NULL OR (v_proj -> 'member' ->> 'expired')::boolean IS NOT TRUE OR v_proj ->> 'effective_role' IS NOT NULL THEN
    RAISE EXCEPTION 'D210/450 §4: a lapsed membership read as %', v_proj;
  END IF;

  -- ══ §5 · removal ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_project_member(v_super, 'd210s@example.invalid', v_user, v_p3);
  v_out := public.admin_get_user_memberships(v_super, 'd210s@example.invalid', v_user);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text) THEN
    RAISE EXCEPTION 'D210/450 §5: the removed cross-organization project is still listed';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_remove_project_member(v_super, 'd210s@example.invalid', v_user, v_p3);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'no membership to remove' THEN
    RAISE EXCEPTION 'D210/450 §5: removing a membership twice got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §6 · org role ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_user_org_role(v_super, 'd210s@example.invalid', v_user, 'admin');
  v_out := public.admin_get_user_memberships(v_super, 'd210s@example.invalid', v_user);
  RESET ROLE;
  IF v_out -> 'organization' ->> 'org_role' IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'D210/450 §6: org role read as % after setting admin', v_out -> 'organization' ->> 'org_role';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_org_role(v_super, 'd210s@example.invalid', v_user, 'overlord');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS NULL OR v_code NOT LIKE 'invalid organization role%' THEN
    RAISE EXCEPTION 'D210/450 §6: an invalid org role got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §7 · move ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_user_organization(v_super, 'd210s@example.invalid', v_user, v_org_b);
  v_out := public.admin_get_user_memberships(v_super, 'd210s@example.invalid', v_user);
  RESET ROLE;
  IF v_out -> 'organization' ->> 'id' IS DISTINCT FROM v_org_b::text THEN
    RAISE EXCEPTION 'D210/450 §7: after the move the organization reads %', v_out -> 'organization';
  END IF;
  SELECT count(*) INTO v_n FROM public.organization_members WHERE user_id = v_user;
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_user AND org_id = v_org_b) THEN
    RAISE EXCEPTION 'D210/450 §7: % organization membership row(s) after the move, expected one in org B', v_n;
  END IF;
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj IS NULL OR (v_proj ->> 'visible')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D210/450 §7: org B''s project is not visible after the move: %', v_proj;
  END IF;
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p2::text;
  IF v_proj IS NULL OR (v_proj ->> 'visible')::boolean IS NOT FALSE OR v_proj ->> 'effective_role' IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'D210/450 §7: org A''s project with a standing membership read as % after the move', v_proj;
  END IF;

  -- "In no organization" is not a state the verb writes: the text copy is NOT NULL and
  -- the D47 stamp would refill the uuid from it. Refused, and nothing moved.
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_organization(v_super, 'd210s@example.invalid', v_user, NULL);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'choose an organization to move this user to'
     OR (SELECT organization_id FROM public.approved_users WHERE id = v_user) IS DISTINCT FROM v_org_b THEN
    RAISE EXCEPTION 'D210/450 §7: moving to no organization got %', COALESCE(v_code, 'success');
  END IF;
  IF (SELECT organization FROM public.approved_users WHERE id = v_user) IS DISTINCT FROM 'D210 Org B' THEN
    RAISE EXCEPTION 'D210/450 §7: the text copy was not written with the uuid';
  END IF;

  -- ══ §8 · attribution ══
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE actor_user_id = v_super
     AND action IN ('project.member_set', 'project.member_remove', 'user.org_role_change', 'user.org_change');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'D210/450 §8: % admin log row(s) name the super admin, expected 5 (2 set, 1 remove, 1 org role, 1 move)', v_n;
  END IF;

  RAISE NOTICE 'D210/450: an account''s organization, projects and rights are read and changed only by a super admin, and the modeler stays an owner';
END $d210$;
