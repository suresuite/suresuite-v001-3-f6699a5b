-- §4 D212 · TRANSFERRING A PROJECT TO ANOTHER ORGANIZATION AND NAMING A NEW OWNER MOVES
-- THE OWNERSHIP, NOT JUST THE COLUMN THAT DISPLAYS IT.
--
-- `20260930000006` rewrites `admin_transfer_project`. Before it, a transfer rewrote
-- `projects` and returned success while the new owner resolved to NO project role and the
-- previous owner, in another tenant, stayed a standing owner. What only a running
-- database can settle, the calls made AS anon — the browser's role (D155):
--
--   §1 REFUSED: a non-super-admin.
--   §2 REFUSED, AND NOTHING CHANGES: an owner outside the target organization (named, or
--      the current one kept), a suspended owner, a call that changes nothing, and a
--      target organization at its project limit (D207's trigger, still in the path).
--   §3 THE TRANSFER: the project moves; the new owner resolves to `owner`, the previous
--      owner to nothing; a member of the organization the project left loses the role, a
--      member who also belongs to the target keeps it; delegations granted by the
--      previous owner or held by someone outside the target are revoked, others kept;
--      the result says what it did.
--   §4 CHANGE OF OWNER IN PLACE: the same organization, a new owner — and the result says
--      when the owner is working in ANOTHER organization and must switch to see it.
--   §5 THE PICKER'S DIRECTORY: `admin_list_users_basic.org_ids` is every membership.
--   §6 ATTRIBUTION: one admin log row per transfer, naming the super admin.

DO $d212$
DECLARE
  v_org_a uuid := gen_random_uuid();   -- where the project starts
  v_org_b uuid := gen_random_uuid();   -- where it goes
  v_org_c uuid := gen_random_uuid();   -- full: project_limit 1, already holds one
  v_super uuid := gen_random_uuid();
  v_ua    uuid := gen_random_uuid();   -- owner (modeler) in A
  v_ea    uuid := gen_random_uuid();   -- editor on p, in A only
  v_eab   uuid := gen_random_uuid();   -- editor on p, in A (active) and B
  v_ub    uuid := gen_random_uuid();   -- in B only — the new owner
  v_uc    uuid := gen_random_uuid();   -- in C only
  v_us    uuid := gen_random_uuid();   -- in B, suspended
  v_p     uuid := gen_random_uuid();
  v_pc    uuid := gen_random_uuid();
  v_d1    uuid := gen_random_uuid();   -- ua → eab: granted by the previous owner
  v_d2    uuid := gen_random_uuid();   -- eab → ea: grantee outside B
  v_d3    uuid := gen_random_uuid();   -- eab → ub: survives
  v_out   jsonb;
  v_code  text;
  v_case  text;
  v_n     integer;
  v_row   record;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D212 Org A', 'd212-a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D212 Org B', 'd212-b-' || substr(v_org_b::text, 1, 8)),
    (v_org_c, 'D212 Org C', 'd212-c-' || substr(v_org_c::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super, 'd212s@example.invalid',   'D212 Super', 'x', 'super_admin', 'D212 Org A', v_org_a, true),
    (v_ua,    'd212ua@example.invalid',  'D212 UA',    'x', 'modeler',     'D212 Org A', v_org_a, true),
    (v_ea,    'd212ea@example.invalid',  'D212 EA',    'x', 'modeler',     'D212 Org A', v_org_a, true),
    (v_eab,   'd212eab@example.invalid', 'D212 EAB',   'x', 'modeler',     'D212 Org A', v_org_a, true),
    (v_ub,    'd212ub@example.invalid',  'D212 UB',    'x', 'modeler',     'D212 Org B', v_org_b, true),
    (v_uc,    'd212uc@example.invalid',  'D212 UC',    'x', 'modeler',     'D212 Org C', v_org_c, true),
    (v_us,    'd212us@example.invalid',  'D212 US',    'x', 'modeler',     'D212 Org B', v_org_b, false);
  INSERT INTO public.organization_members (org_id, user_id, org_role) VALUES (v_org_b, v_eab, 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p,  'D212 TRON', v_ua, 'D212P',  'D212 Org A', v_org_a, 'single'),
    (v_pc, 'D212 C',    v_uc, 'D212PC', 'D212 Org C', v_org_c, 'single');
  UPDATE public.organizations SET project_limit = 1 WHERE id = v_org_c;

  INSERT INTO public.project_members (project_id, user_id, project_role, rationale) VALUES
    (v_p, v_ea,  'editor', 'D212 editor in A'),
    (v_p, v_eab, 'editor', 'D212 editor in A and B');
  INSERT INTO public.delegation_grants (id, project_id, grantor_user_id, grantee_user_id, project_role, expires_at, rationale) VALUES
    (v_d1, v_p, v_ua,  v_eab, 'viewer',  now() + interval '7 days', 'D212 d1'),
    (v_d2, v_p, v_eab, v_ea,  'viewer',  now() + interval '7 days', 'D212 d2'),
    (v_d3, v_p, v_eab, v_ub,  'analyst', now() + interval '7 days', 'D212 d3');

  IF public.effective_project_role(v_ua, v_p) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D212/470 setup: the modeler is not an owner member (%)', public.effective_project_role(v_ua, v_p);
  END IF;

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · a non-super-admin is refused ══
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_transfer_project(v_ua, 'd212ua@example.invalid', v_p, v_org_b, v_ub);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D212/470 §1: the owner transferring their own project got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;

  -- ══ §2 · refusals change nothing ══
  FOREACH v_case IN ARRAY ARRAY['outsider','keep_outsider','suspended','nothing','full'] LOOP
    v_code := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      CASE v_case
        WHEN 'outsider'      THEN PERFORM public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_b, v_uc);
        WHEN 'keep_outsider' THEN PERFORM public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_b, NULL);
        WHEN 'suspended'     THEN PERFORM public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_b, v_us);
        WHEN 'nothing'       THEN PERFORM public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_a, v_ua);
        WHEN 'full'          THEN PERFORM public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_c, v_uc);
      END CASE;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_code := SQLERRM;
    END;
    IF v_code IS NULL
       OR (v_case IN ('outsider','keep_outsider') AND v_code NOT LIKE 'owner_not_in_organization:%')
       OR (v_case = 'suspended' AND v_code NOT LIKE 'owner_suspended:%')
       OR (v_case = 'nothing'   AND v_code NOT LIKE 'nothing_to_change:%')
       OR (v_case = 'full'      AND v_code NOT LIKE 'org_project_limit_reached:%') THEN
      RAISE EXCEPTION 'D212/470 §2: case % got %', v_case, COALESCE(v_code, 'success');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p AND organization_id = v_org_a AND modeler_id = v_ua)
       OR (SELECT count(*) FROM public.project_members WHERE project_id = v_p) <> 3
       OR (SELECT count(*) FROM public.delegation_grants WHERE project_id = v_p AND revoked_at IS NULL) <> 3 THEN
      RAISE EXCEPTION 'D212/470 §2: the refused case % changed the project or its roles', v_case;
    END IF;
  END LOOP;

  -- ══ §3 · the transfer ══
  SET LOCAL ROLE anon;
  v_out := public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_b, v_ub);
  RESET ROLE;

  SELECT * INTO v_row FROM public.projects WHERE id = v_p;
  IF v_row.organization_id IS DISTINCT FROM v_org_b OR v_row.organization IS DISTINCT FROM 'D212 Org B'
     OR v_row.modeler_id IS DISTINCT FROM v_ub OR v_row.modeler_name IS DISTINCT FROM 'D212 UB' THEN
    RAISE EXCEPTION 'D212/470 §3: the project row reads org % (%), owner % (%)',
      v_row.organization_id, v_row.organization, v_row.modeler_id, v_row.modeler_name;
  END IF;
  IF public.effective_project_role(v_ub, v_p) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D212/470 §3: the new owner resolves to %, expected owner', COALESCE(public.effective_project_role(v_ub, v_p), 'no role');
  END IF;
  IF public.effective_project_role(v_ua, v_p) IS NOT NULL THEN
    RAISE EXCEPTION 'D212/470 §3: the previous owner still resolves to %', public.effective_project_role(v_ua, v_p);
  END IF;
  IF public.effective_project_role(v_ea, v_p) IS NOT NULL THEN
    RAISE EXCEPTION 'D212/470 §3: a member of the organization the project left still resolves to %', public.effective_project_role(v_ea, v_p);
  END IF;
  IF public.effective_project_role(v_eab, v_p) IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'D212/470 §3: a member who also belongs to the target resolves to %, expected editor', public.effective_project_role(v_eab, v_p);
  END IF;
  IF (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d1) IS NULL
     OR (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d2) IS NULL
     OR (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d3) IS NOT NULL THEN
    RAISE EXCEPTION 'D212/470 §3: delegations read d1 %, d2 %, d3 % (expected revoked, revoked, live)',
      (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d1),
      (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d2),
      (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d3);
  END IF;
  IF (v_out ->> 'organization_changed')::boolean IS NOT TRUE OR (v_out ->> 'owner_changed')::boolean IS NOT TRUE
     OR (v_out ->> 'owner_active_org_is_target')::boolean IS NOT TRUE
     OR jsonb_array_length(v_out -> 'memberships_removed') <> 2
     OR jsonb_array_length(v_out -> 'delegations_revoked') <> 2
     OR v_out ->> 'previous_owner_id' IS DISTINCT FROM v_ua::text THEN
    RAISE EXCEPTION 'D212/470 §3: the result reads %', v_out;
  END IF;

  -- ══ §4 · a new owner in place, working in another organization ══
  SET LOCAL ROLE anon;
  v_out := public.admin_transfer_project(v_super, 'd212s@example.invalid', v_p, v_org_b, v_eab);
  RESET ROLE;
  IF (SELECT modeler_id FROM public.projects WHERE id = v_p) IS DISTINCT FROM v_eab
     OR (SELECT organization_id FROM public.projects WHERE id = v_p) IS DISTINCT FROM v_org_b
     OR public.effective_project_role(v_eab, v_p) IS DISTINCT FROM 'owner'
     OR public.effective_project_role(v_ub, v_p) IS DISTINCT FROM 'analyst' THEN
    RAISE EXCEPTION 'D212/470 §4: owner %, eab %, ub % (expected eab, owner, analyst by d3 only)',
      (SELECT modeler_id FROM public.projects WHERE id = v_p),
      public.effective_project_role(v_eab, v_p), public.effective_project_role(v_ub, v_p);
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_p AND user_id = v_ub) THEN
    RAISE EXCEPTION 'D212/470 §4: the previous owner kept a standing membership';
  END IF;
  IF (v_out ->> 'organization_changed')::boolean IS NOT FALSE
     OR (v_out ->> 'owner_active_org_is_target')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D212/470 §4: the result reads % (the owner is working in org A, not B)', v_out;
  END IF;
  IF (SELECT revoked_at FROM public.delegation_grants WHERE id = v_d3) IS NOT NULL THEN
    RAISE EXCEPTION 'D212/470 §4: a delegation the NEW owner granted was revoked';
  END IF;

  -- ══ §5 · the picker's directory ══
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.admin_list_users_basic(v_super, 'd212s@example.invalid') u
   WHERE u.id = v_eab AND u.organization_id = v_org_a AND u.org_ids @> ARRAY[v_org_a, v_org_b]
     AND cardinality(u.org_ids) = 2;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D212/470 §5: admin_list_users_basic does not list both of an account''s organizations';
  END IF;

  -- ══ §6 · attribution ══
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE actor_user_id = v_super AND action = 'project.transfer' AND target_id = v_p::text;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'D212/470 §6: % transfer log row(s) name the super admin, expected 2', v_n;
  END IF;

  RAISE NOTICE 'D212/470: a transfer moves the ownership with the project — the new owner resolves to owner, the previous owner and the organization it left lose their roles, and an owner outside the target is refused';
END $d212$;
