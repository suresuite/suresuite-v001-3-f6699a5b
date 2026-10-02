-- §4 D276 · ONE RULE FOR THE FOUR PROJECT RIGHTS; AN AGENT MAY NOT APPROVE WHAT ITS APPROVER
-- MAY NOT DO BY HAND; /admin/roles READS THE RULE ITSELF.
--
-- §4 D279 (`20261002000007`) REMOVED THE CEILING this file was written to prove: where a person
-- holds a role on the project, the project role decides, and an Editor passes the upload gate.
-- The assertions below are the rule as it stands after D279; `750` proves D279's own case.
--
-- `20261002000004` makes `project_right_decide` the one rule for the four project-scoped
-- rights and reads it from the resolver, the per-person explanation, the agent approval and
-- the /admin/roles matrix. What only a running database can settle:
--
--   §1 THE RULE: every branch of `project_right_decide`, including the order (super admin,
--      then a person override, then no project role, then grant AND account).
--   §2 THE PROJECT ROLE DECIDES (D279): a 'user' account (Export only) made Editor holds all
--      four, decided by `project_role`; a modeler Editor holds them; a modeler Viewer holds
--      none (decided by `project_role`).
--   §3 NO PROJECT ROLE: an organization member with no role takes the account's answer.
--   §4 OVERRIDES: a person override beats the project role; an organization override does
--      not reach a person who holds a project role (D279).
--   §5 THE AGENT GATE: a modeler Viewer holding agent_apply cannot approve a policy bundle;
--      a modeler Editor can; every artifact type the CHECK constraint allows is declared.
--   §6 /admin/roles: `get_role_access`'s effective matrix is the rule's answer, the capped
--      list is empty (D279), and a non-super actor is refused.
--   §7 THE PREVIEW: flipping an account-role switch moves no project member's right (D279) —
--      a project role decides for every holding it lists.
--   §8 THE SERVER: D275's policy writers read the same rights, so a 'user' account made Editor
--      may write a policy (D279) and a modeler Viewer may not.

DO $d276$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_org2    uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- modeler, owns p
  v_ued     uuid := gen_random_uuid();   -- 'user' account, editor on p
  v_med     uuid := gen_random_uuid();   -- modeler, editor on p
  v_mview   uuid := gen_random_uuid();   -- modeler, viewer on p
  v_plain   uuid := gen_random_uuid();   -- 'user' account, org member, no project role
  v_over    uuid := gen_random_uuid();   -- 'user' account, editor on p, person override
  v_o2ed    uuid := gen_random_uuid();   -- modeler, editor on p2 (org2 overrides export off)
  v_p       uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_prop    uuid;
  v_r       jsonb;
  v_d       jsonb;
  v_acc     jsonb;
  v_code    text;
  v_msg     text;
  v_allowed text[];
  t         text;
BEGIN
  -- ── the catalog the base lacks, as the migrations seed it ────────────────
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('simulation_lab', 'feature', 'Run Simulations', 220),
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250),
    ('agent_proposals', 'feature', 'Agent Proposals', 260),
    ('agent_apply', 'feature', 'Agent Apply', 270)
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
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, k.key, r.role <> 'user' OR k.key IN ('export', 'agent_proposals')
    FROM (VALUES ('super_admin'), ('admin'), ('modeler'), ('user')) r(role)
    CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies'), ('export'), ('simulation_lab'),
                       ('agent_proposals'), ('agent_apply')) k(key)
  ON CONFLICT (role, capability_key) DO NOTHING;
  -- This rehearsal asserts the seed's values; pin them where an earlier file planted others.
  UPDATE public.role_capabilities SET allowed = (role <> 'user' OR capability_key IN ('export', 'agent_proposals'))
   WHERE capability_key IN ('data_edit_inputs', 'data_edit_policies', 'export', 'simulation_lab',
                            'agent_proposals', 'agent_apply');

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org,  'D276 Org',  'd276-' || substr(v_org::text, 1, 8)),
    (v_org2, 'D276 Org2', 'd276b-' || substr(v_org2::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super, 'd276s@example.invalid', 'D276 Super',  'x', 'super_admin', 'D276 Org',  v_org,  true),
    (v_owner, 'd276o@example.invalid', 'D276 Owner',  'x', 'modeler',     'D276 Org',  v_org,  true),
    (v_ued,   'd276u@example.invalid', 'D276 UserEd', 'x', 'user',        'D276 Org',  v_org,  true),
    (v_med,   'd276m@example.invalid', 'D276 ModEd',  'x', 'modeler',     'D276 Org',  v_org,  true),
    (v_mview, 'd276v@example.invalid', 'D276 ModVw',  'x', 'modeler',     'D276 Org',  v_org,  true),
    (v_plain, 'd276p@example.invalid', 'D276 Plain',  'x', 'user',        'D276 Org',  v_org,  true),
    (v_over,  'd276x@example.invalid', 'D276 Over',   'x', 'user',        'D276 Org',  v_org,  true),
    (v_o2ed,  'd276e@example.invalid', 'D276 Org2Ed', 'x', 'modeler',     'D276 Org2', v_org2, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p,  'D276 p',  v_owner, 'D276P',  'D276 Org',  v_org,  'single'),
    (v_p2, 'D276 p2', v_owner, 'D276P2', 'D276 Org2', v_org2, 'single');

  PERFORM public.admin_set_project_member(v_super, 'd276s@example.invalid', v_ued,   v_p,  'editor', NULL, 'D276');
  PERFORM public.admin_set_project_member(v_super, 'd276s@example.invalid', v_med,   v_p,  'editor', NULL, 'D276');
  PERFORM public.admin_set_project_member(v_super, 'd276s@example.invalid', v_mview, v_p,  'viewer', NULL, 'D276');
  PERFORM public.admin_set_project_member(v_super, 'd276s@example.invalid', v_over,  v_p,  'editor', NULL, 'D276');
  PERFORM public.admin_set_project_member(v_super, 'd276s@example.invalid', v_o2ed,  v_p2, 'editor', NULL, 'D276');
  INSERT INTO public.user_capabilities (user_id, capability_key, allowed) VALUES (v_over, 'simulation_lab', true);
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES (v_org2, 'export', false);
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §1 the rule ──────────────────────────────────────────────────────────
  FOR v_r IN SELECT * FROM (VALUES
      (jsonb_build_object('a', public.project_right_decide(true,  false, 'viewer', false, false), 'want', '{"allowed":true,"decided_by":"super_admin"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, true,  'viewer', false, false), 'want', '{"allowed":true,"decided_by":"person_override"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, false, 'owner',  true,  true),  'want', '{"allowed":false,"decided_by":"person_override"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, NULL,  NULL,     NULL,  true),  'want', '{"allowed":true,"decided_by":"account_role"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, NULL,  NULL,     NULL,  false), 'want', '{"allowed":false,"decided_by":"account_role"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, NULL,  'viewer', false, true),  'want', '{"allowed":false,"decided_by":"project_role"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, NULL,  'editor', true,  false), 'want', '{"allowed":true,"decided_by":"project_role"}'::jsonb)),
      (jsonb_build_object('a', public.project_right_decide(false, NULL,  'editor', true,  true),  'want', '{"allowed":true,"decided_by":"project_role"}'::jsonb))
    ) AS c(x) LOOP
    IF v_r -> 'a' IS DISTINCT FROM v_r -> 'want' THEN
      RAISE EXCEPTION 'D276/720 §1: the rule answered % where % was owed', v_r -> 'a', v_r -> 'want';
    END IF;
  END LOOP;

  -- ── §2 the project role decides (D279) ───────────────────────────────────
  v_r := public.project_rights_for_user(v_ued, v_p);
  IF v_r -> 'capabilities' IS DISTINCT FROM
       '{"export":true,"simulation_lab":true,"data_edit_inputs":true,"data_edit_policies":true}'::jsonb
     OR v_r -> 'decisions' -> 'simulation_lab' ->> 'decided_by' IS DISTINCT FROM 'project_role'
     OR (v_r -> 'decisions' -> 'simulation_lab' ->> 'account_allows')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D276/720 §2: a user-account Editor read as %', v_r;
  END IF;
  -- The resolver itself, not only the projection of it.
  IF (public.capabilities_for_user(v_ued, v_p) -> 'features' ->> 'data_edit_policies')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D276/720 §2: capabilities_for_user still lets the account role cap an Editor';
  END IF;
  v_r := public.project_rights_for_user(v_med, v_p);
  IF (v_r -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE
     OR (v_r -> 'capabilities' ->> 'data_edit_policies')::boolean IS NOT TRUE
     OR (v_r -> 'capabilities' ->> 'data_edit_inputs')::boolean IS NOT TRUE
     OR (v_r ->> 'may_land_uploads')::boolean IS NOT TRUE
     OR v_r -> 'decisions' -> 'data_edit_inputs' ->> 'decided_by' IS DISTINCT FROM 'project_role' THEN
    RAISE EXCEPTION 'D276/720 §2: a modeler Editor read as %', v_r;
  END IF;
  v_r := public.project_rights_for_user(v_mview, v_p);
  IF v_r -> 'capabilities' @> '{"simulation_lab":true}' OR v_r -> 'capabilities' @> '{"export":true}'
     OR v_r -> 'decisions' -> 'simulation_lab' ->> 'decided_by' IS DISTINCT FROM 'project_role' THEN
    RAISE EXCEPTION 'D276/720 §2: a modeler Viewer read as %', v_r;
  END IF;

  -- ── §3 no project role ───────────────────────────────────────────────────
  v_r := public.project_rights_for_user(v_plain, v_p);
  IF (v_r -> 'capabilities' ->> 'export')::boolean IS NOT TRUE
     OR (v_r -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT FALSE
     OR v_r -> 'decisions' -> 'export' ->> 'decided_by' IS DISTINCT FROM 'account_role' THEN
    RAISE EXCEPTION 'D276/720 §3: an organization member with no role read as %', v_r;
  END IF;

  -- ── §4 overrides ─────────────────────────────────────────────────────────
  v_r := public.project_rights_for_user(v_over, v_p);
  IF (v_r -> 'capabilities' ->> 'simulation_lab')::boolean IS NOT TRUE
     OR v_r -> 'decisions' -> 'simulation_lab' ->> 'decided_by' IS DISTINCT FROM 'person_override' THEN
    RAISE EXCEPTION 'D276/720 §4: a person override did not decide: %', v_r;
  END IF;
  v_r := public.project_rights_for_user(v_o2ed, v_p2);
  IF (v_r -> 'capabilities' ->> 'export')::boolean IS NOT TRUE
     OR v_r -> 'decisions' -> 'export' ->> 'decided_by' IS DISTINCT FROM 'project_role'
     OR v_r -> 'decisions' -> 'export' ->> 'account_source' IS DISTINCT FROM 'organization'
     OR (v_r -> 'decisions' -> 'export' ->> 'account_allows')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'D276/720 §4: an organization override still capped an Editor: %', v_r;
  END IF;

  -- ── §5 the agent gate ────────────────────────────────────────────────────
  SELECT array_agg(m[1]) INTO v_allowed
    FROM pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
   WHERE c.conname = 'proposals_artifact_type_check';
  FOREACH t IN ARRAY v_allowed LOOP
    IF NOT (public.agent_artifact_project_rights() ? t) THEN
      RAISE EXCEPTION 'D276/720 §5: artifact type % declares no project right', t;
    END IF;
  END LOOP;
  IF public.agent_project_right_refusal(v_med, v_p, 'not_an_artifact') IS NULL THEN
    RAISE EXCEPTION 'D276/720 §5: an undeclared artifact type was not refused';
  END IF;

  INSERT INTO public.proposals (project_id, agent_id, artifact_type, title, payload, provenance, idempotency_key, status)
  VALUES (v_p, 'policy-configurator', 'policy_bundle_diff', 'D276 bundle', '{}'::jsonb, 'deterministic',
          'd276-' || gen_random_uuid(), 'proposed')
  RETURNING id INTO v_prop;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.review_agent_proposal(v_prop, 'approve', v_mview, 'd276v@example.invalid', NULL);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_code := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_code IS NULL OR v_msg NOT LIKE 'forbidden: approving this proposal needs Edit Policies%' THEN
    RAISE EXCEPTION 'D276/720 §5: a modeler Viewer approved a policy bundle (%: %)', v_code, v_msg;
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.review_agent_proposal(v_prop, 'approve', v_med, 'd276m@example.invalid', NULL);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF (SELECT status FROM public.proposals WHERE id = v_prop) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'D276/720 §5: a modeler Editor could not approve a policy bundle';
  END IF;

  -- ── §6 /admin/roles ──────────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  v_acc := public.get_role_access(v_super, 'd276s@example.invalid');
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  FOR t IN SELECT jsonb_array_elements_text(v_acc -> 'project_scoped') LOOP
    v_d := v_acc -> 'effective' -> 'user' -> 'editor' -> t;
    IF v_d IS DISTINCT FROM public.project_right_decide(false, NULL, 'editor',
         (SELECT allowed FROM public.project_role_capabilities WHERE project_role = 'editor' AND capability_key = t),
         (SELECT allowed FROM public.role_capabilities WHERE role = 'user' AND capability_key = t)) THEN
      RAISE EXCEPTION 'D276/720 §6: the effective matrix says % for user×editor×%', v_d, t;
    END IF;
  END LOOP;
  IF v_acc -> 'effective' -> 'user' -> 'editor' -> 'simulation_lab' IS DISTINCT FROM '{"allowed":true,"decided_by":"project_role"}'::jsonb
     OR (v_acc -> 'effective' -> 'super_admin' -> 'viewer' -> 'export' ->> 'allowed')::boolean IS NOT TRUE
     OR jsonb_array_length(v_acc -> 'project_scoped') <> 4 THEN
    RAISE EXCEPTION 'D276/720 §6: the effective matrix read as %', v_acc -> 'effective';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_acc -> 'capped') c
              WHERE c ->> 'user_id' IN (v_ued::text, v_med::text, v_mview::text, v_over::text, v_o2ed::text, v_owner::text)) THEN
    RAISE EXCEPTION 'D276/720 §6: D279 left a capped membership: %', v_acc -> 'capped';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_acc -> 'person_overrides') o WHERE o ->> 'user_id' = v_over::text)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_acc -> 'org_overrides') o WHERE o ->> 'org_id' = v_org2::text)
     OR (v_acc -> 'agent_rights' ->> 'policy_bundle_diff') IS DISTINCT FROM 'data_edit_policies' THEN
    RAISE EXCEPTION 'D276/720 §6: overrides or agent map missing: %', v_acc;
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.get_role_access(v_med, 'd276m@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D276/720 §6: a modeler read /admin/roles (%)', v_code;
  END IF;

  -- ── §7 the preview ───────────────────────────────────────────────────────
  SET LOCAL ROLE anon;
  v_r := public.admin_preview_role_capability(v_super, 'd276s@example.invalid', 'user', 'simulation_lab', true);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF (v_r ->> 'project_scoped')::boolean IS NOT TRUE
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'changes') c
                 WHERE c ->> 'user_id' IN (v_ued::text, v_over::text)) THEN
    RAISE EXCEPTION 'D276/720 §7: turning Run Simulations on for user accounts previewed as %', v_r;
  END IF;
  SET LOCAL ROLE anon;
  v_r := public.admin_preview_role_capability(v_super, 'd276s@example.invalid', 'modeler', 'export', false);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'changes') c WHERE c ->> 'user_id' = v_med::text)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'changes') c WHERE c ->> 'user_id' = v_o2ed::text)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'changes') c WHERE c ->> 'user_id' = v_mview::text) THEN
    RAISE EXCEPTION 'D276/720 §7: turning Export off for modelers previewed as %', v_r;
  END IF;
  IF (SELECT allowed FROM public.role_capabilities WHERE role = 'modeler' AND capability_key = 'export') IS NOT TRUE THEN
    RAISE EXCEPTION 'D276/720 §7: the preview wrote';
  END IF;

  -- ── §8 the server's policy writers read the same rule (D275, D279) ────────
  v_code := NULL;
  BEGIN
    PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d276": "modeler viewer"}'::jsonb, _actor_user_id => v_mview);
  EXCEPTION WHEN insufficient_privilege THEN v_code := SQLERRM;
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_code IS NULL OR v_code NOT LIKE 'forbidden:%' THEN
    RAISE EXCEPTION 'D276/720 §8: a modeler Viewer wrote a policy (%)', v_code;
  END IF;
  PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d276": "user editor"}'::jsonb, _actor_user_id => v_ued);
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d276": "modeler editor"}'::jsonb, _actor_user_id => v_med);
  PERFORM set_config('app.current_user_id', '', true);

  RAISE NOTICE 'D276/720: one rule — the project role decides where held (D279) — agents ask the same right, and /admin/roles reads the rule';
END $d276$;
