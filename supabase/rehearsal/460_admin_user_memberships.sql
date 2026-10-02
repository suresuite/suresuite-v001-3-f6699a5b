-- §4 D211 · /admin/users/:userId SHOWS AN ACCOUNT'S ORGANIZATIONS, PROJECTS AND RIGHTS,
-- AND A SUPER ADMIN CAN CHANGE THEM THERE.
--
-- `20260930000005` adds `admin_get_user_memberships` and three verbs, on D210's model
-- (several organizations, one ACTIVE). What only a running database can settle, the
-- calls made AS anon — the browser's role (D155):
--
--   §1 REFUSALS: a non-super-admin is refused the read and every verb.
--   §2 THE READ: the one organization is named, active, with its org role; the projects
--      are exactly the organization's, the owned one and the cross-organization
--      membership — no other — each with where access comes from, and the rights are
--      the RESOLVER's (an editor's role grants inputs and the upload gate refuses them unless it owns
--      the project or is an app admin — D230; an analyst runs and edits nothing — D232; the
--      owner does).
--   §3 THE MODELER STAYS AN OWNER: demoting, expiring or removing the modeler's own
--      membership is refused, and the row is unchanged.
--   §4 EXPIRY: a past end date is refused; a lapsed membership is listed as expired and
--      resolves to no role.
--   §5 REMOVAL: a removed cross-organization membership drops the project from the read.
--   §6 A SECOND ORGANIZATION (D210): once the account also belongs to org B, org B's
--      project is listed as a member organization's, and — since D231 — its rights are the
--      rights IN that project: visible whichever organization the account is working in,
--      with `in_active_org` saying where it is right now; after the switch it is in it, and
--      the project it owns in org A keeps its owner's rights.
--   §7 ORG ROLE: set per organization, each independently; invalid and non-member refused.
--   §8 ATTRIBUTION: every change left an admin log row naming the super admin.

DO $d211$
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
    (v_org_a, 'D211 Org A', 'd211-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D211 Org B', 'd211-b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id) VALUES
    (v_super, 'd211s@example.invalid', 'D211 Super', 'x', 'super_admin', 'D211 Org A', v_org_a),
    (v_user,  'd211u@example.invalid', 'D211 User',  'x', 'modeler',     'D211 Org A', v_org_a),
    (v_other, 'd211o@example.invalid', 'D211 Other', 'x', 'modeler',     'D211 Org B', v_org_b);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p1, 'D211 p1', v_user,  'D211P1', 'D211 Org A', v_org_a, 'single'),
    (v_p2, 'D211 p2', v_other, 'D211P2', 'D211 Org A', v_org_a, 'single'),
    (v_p3, 'D211 p3', v_other, 'D211P3', 'D211 Org B', v_org_b, 'single');

  -- The rehearsal base is schema, not seed: plant WP 2.2's project layer where it is
  -- missing, as the migrations leave it (`20260915000005`, and D232's analyst row from
  -- `20261001000005` — a planted row must match what every later base will hold), so the
  -- rights asserted below are the resolver's and not four NULLs.
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250),
    ('simulation_lab', 'feature', 'Simulation Lab', 260)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
    ('owner', 'data_edit_inputs', true),    ('owner', 'data_edit_policies', true),
    ('editor', 'data_edit_inputs', true),   ('editor', 'data_edit_policies', true),
    ('analyst', 'data_edit_inputs', false), ('analyst', 'data_edit_policies', false),
    ('analyst', 'export', false),           ('analyst', 'simulation_lab', true),
    ('viewer', 'data_edit_inputs', false),  ('viewer', 'data_edit_policies', false)
  ON CONFLICT (project_role, capability_key) DO NOTHING;
  -- D273 — the account role is now the CEILING the project role grants within, so the base
  -- also needs the account layer the migrations seed (`20260711000002`: modeler, admin and
  -- super admin hold all four; a 'user' account Export only; `20260915000005` copies
  -- data_editing into the two edit keys). Without it every right reads false.
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, k.key, r.role <> 'user' OR k.key = 'export'
    FROM (VALUES ('super_admin'), ('admin'), ('modeler'), ('user')) r(role)
    CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies'), ('export'), ('simulation_lab')) k(key)
  ON CONFLICT (role, capability_key) DO NOTHING;

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · refusals ══
  FOREACH v_fn IN ARRAY ARRAY['read','org_role','member','remove'] LOOP
    v_code := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      CASE v_fn
        WHEN 'read'     THEN PERFORM public.admin_get_user_memberships(v_user, 'd211u@example.invalid', v_user);
        WHEN 'org_role' THEN PERFORM public.admin_set_user_org_role(v_user, 'd211u@example.invalid', v_user, v_org_a, 'owner');
        WHEN 'member'   THEN PERFORM public.admin_set_project_member(v_user, 'd211u@example.invalid', v_user, v_p3, 'owner');
        WHEN 'remove'   THEN PERFORM public.admin_remove_project_member(v_user, 'd211u@example.invalid', v_other, v_p3);
      END CASE;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_code := SQLERRM;
    END;
    IF v_code IS DISTINCT FROM 'forbidden' THEN
      RAISE EXCEPTION 'D211/460 §1: a modeler calling % got %, expected forbidden', v_fn, COALESCE(v_code, 'success');
    END IF;
  END LOOP;

  -- ══ §2 · the read ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd211s@example.invalid', v_user, v_p2, 'editor', NULL, 'D211 editor');
  PERFORM public.admin_set_project_member(v_super, 'd211s@example.invalid', v_user, v_p3, 'analyst', now() + interval '7 days', NULL);
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  RESET ROLE;

  IF jsonb_array_length(v_out -> 'organizations') IS DISTINCT FROM 1
     OR v_out -> 'organizations' -> 0 ->> 'name' IS DISTINCT FROM 'D211 Org A'
     OR v_out -> 'organizations' -> 0 ->> 'org_role' IS DISTINCT FROM 'member'
     OR (v_out -> 'organizations' -> 0 ->> 'is_active')::boolean IS NOT TRUE
     OR v_out ->> 'active_organization_id' IS DISTINCT FROM v_org_a::text THEN
    RAISE EXCEPTION 'D211/460 §2: organizations read as % (active %)', v_out -> 'organizations', v_out ->> 'active_organization_id';
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_out -> 'projects');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'D211/460 §2: % project(s) listed, expected p1, p2, p3', v_n;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p1::text;
  IF (v_proj ->> 'is_modeler')::boolean IS NOT TRUE OR v_proj ->> 'effective_role' IS DISTINCT FROM 'owner'
     OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'can_edit_project')::boolean IS NOT TRUE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D211/460 §2: the owned project read as %', v_proj;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p2::text;
  IF v_proj -> 'member' ->> 'project_role' IS DISTINCT FROM 'editor' OR v_proj ->> 'effective_role' IS DISTINCT FROM 'editor'
     OR v_proj -> 'member' ->> 'granted_by' IS DISTINCT FROM 'D211 Super'
     OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'can_edit_project')::boolean IS NOT FALSE
     -- D230: the role grants inputs, the upload gate (owner or app admin) refuses them.
     OR (v_proj -> 'resolved_capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_proj ->> 'may_land_uploads')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D211/460 §2: the editor membership read as %', v_proj;
  END IF;

  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj ->> 'effective_role' IS DISTINCT FROM 'analyst' OR (v_proj ->> 'visible')::boolean IS NOT FALSE
     OR (v_proj ->> 'in_member_org')::boolean IS NOT FALSE OR (v_proj ->> 'in_active_org')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT FALSE
     -- D232: the analyst runs simulations and edits nothing, policies included.
     OR (v_proj -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT FALSE
     OR (v_proj -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D211/460 §2: the cross-organization analyst membership read as %', v_proj;
  END IF;
  IF jsonb_array_length(v_out -> 'project_capabilities') = 0 OR v_out -> 'role_matrix' -> 'viewer' IS NULL THEN
    RAISE EXCEPTION 'D211/460 §2: the role matrix is missing: %', v_out -> 'role_matrix';
  END IF;

  -- ══ §3 · the modeler stays a standing owner ══
  FOREACH v_fn IN ARRAY ARRAY['demote','expire','remove'] LOOP
    v_code := NULL;
    BEGIN
      CASE v_fn
        WHEN 'demote' THEN PERFORM public.admin_set_project_member(v_super, 'd211s@example.invalid', v_user, v_p1, 'viewer');
        WHEN 'expire' THEN PERFORM public.admin_set_project_member(v_super, 'd211s@example.invalid', v_user, v_p1, 'owner', now() + interval '1 day');
        WHEN 'remove' THEN PERFORM public.admin_remove_project_member(v_super, 'd211s@example.invalid', v_user, v_p1);
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      v_code := SQLERRM;
    END;
    IF v_code IS NULL OR v_code NOT LIKE 'this user owns the project%' THEN
      RAISE EXCEPTION 'D211/460 §3: % the modeler''s membership got %, expected a refusal', v_fn, COALESCE(v_code, 'success');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.project_members
                  WHERE project_id = v_p1 AND user_id = v_user AND project_role = 'owner' AND expires_at IS NULL) THEN
    RAISE EXCEPTION 'D211/460 §3: the modeler''s owner membership changed despite the refusals';
  END IF;

  -- ══ §4 · expiry ══
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_project_member(v_super, 'd211s@example.invalid', v_user, v_p2, 'viewer', now() - interval '1 day');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS NULL OR v_code NOT LIKE 'expires_at % is already in the past' THEN
    RAISE EXCEPTION 'D211/460 §4: a past end date got %, expected a refusal', COALESCE(v_code, 'success');
  END IF;
  UPDATE public.project_members SET expires_at = now() - interval '1 minute'
   WHERE project_id = v_p3 AND user_id = v_user;
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj IS NULL OR (v_proj -> 'member' ->> 'expired')::boolean IS NOT TRUE OR v_proj ->> 'effective_role' IS NOT NULL THEN
    RAISE EXCEPTION 'D211/460 §4: a lapsed membership read as %', v_proj;
  END IF;

  -- ══ §5 · removal ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_remove_project_member(v_super, 'd211s@example.invalid', v_user, v_p3);
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text) THEN
    RAISE EXCEPTION 'D211/460 §5: the removed cross-organization project is still listed';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_remove_project_member(v_super, 'd211s@example.invalid', v_user, v_p3);
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'no membership to remove' THEN
    RAISE EXCEPTION 'D211/460 §5: removing a membership twice got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §6 · a second organization: listed; its rights are the rights in the project (D231) ══
  PERFORM public.admin_add_org_member(v_super, 'd211s@example.invalid', v_user, v_org_b, 'member');
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  IF jsonb_array_length(v_out -> 'organizations') IS DISTINCT FROM 2
     OR v_out ->> 'active_organization_id' IS DISTINCT FROM v_org_a::text THEN
    RAISE EXCEPTION 'D211/460 §6: after joining org B the organizations read % (active %)', v_out -> 'organizations', v_out ->> 'active_organization_id';
  END IF;
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj IS NULL OR (v_proj ->> 'in_member_org')::boolean IS NOT TRUE OR (v_proj ->> 'in_active_org')::boolean IS NOT FALSE
     OR (v_proj ->> 'visible')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D211/460 §6: org B''s project before the switch read as %', v_proj;
  END IF;

  -- The account's own act, in the browser's shape: no session actor left over from the
  -- admin calls above (the self-service resolver refuses a session naming someone else).
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.switch_my_organization(v_org_b, v_user);
  RESET ROLE;
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p3::text;
  IF v_proj IS NULL OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'in_active_org')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D211/460 §6: org B''s project after the switch read as %', v_proj;
  END IF;
  SELECT p INTO v_proj FROM jsonb_array_elements(v_out -> 'projects') p WHERE p ->> 'project_id' = v_p1::text;
  IF v_proj IS NULL OR (v_proj ->> 'visible')::boolean IS NOT TRUE OR (v_proj ->> 'can_edit_project')::boolean IS NOT TRUE
     OR (v_proj ->> 'in_active_org')::boolean IS NOT FALSE
     OR (v_proj ->> 'in_member_org')::boolean IS NOT TRUE OR v_proj ->> 'effective_role' IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D211/460 §6: org A''s owned project after switching away read as %', v_proj;
  END IF;

  -- ══ §7 · org role, per organization ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_user_org_role(v_super, 'd211s@example.invalid', v_user, v_org_a, 'admin');
  PERFORM public.admin_set_user_org_role(v_super, 'd211s@example.invalid', v_user, v_org_b, 'owner');
  v_out := public.admin_get_user_memberships(v_super, 'd211s@example.invalid', v_user);
  RESET ROLE;
  IF (SELECT o ->> 'org_role' FROM jsonb_array_elements(v_out -> 'organizations') o WHERE o ->> 'id' = v_org_a::text) IS DISTINCT FROM 'admin'
     OR (SELECT o ->> 'org_role' FROM jsonb_array_elements(v_out -> 'organizations') o WHERE o ->> 'id' = v_org_b::text) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D211/460 §7: org roles read as %', v_out -> 'organizations';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_org_role(v_super, 'd211s@example.invalid', v_user, v_org_a, 'overlord');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS NULL OR v_code NOT LIKE 'invalid organization role%' THEN
    RAISE EXCEPTION 'D211/460 §7: an invalid org role got %', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM public.admin_set_user_org_role(v_super, 'd211s@example.invalid', v_other, v_org_a, 'owner');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS NULL OR v_code NOT LIKE 'not_a_member%'
     OR EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_other AND org_id = v_org_a) THEN
    RAISE EXCEPTION 'D211/460 §7: an org role in an organization the account is not in got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §8 · attribution ══
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE actor_user_id = v_super
     AND action IN ('project.member_set', 'project.member_remove', 'user.org_role_change');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'D211/460 §8: % admin log row(s) name the super admin, expected 5 (2 set, 1 remove, 2 org roles)', v_n;
  END IF;

  RAISE NOTICE 'D211/460: an account''s organizations, projects and rights are read and changed only by a super admin, visibility follows the active organization, and the modeler stays an owner';
END $d211$;
