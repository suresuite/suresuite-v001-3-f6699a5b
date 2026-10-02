-- §4 D275 · A POLICY WRITE THAT NAMES ITS ACTOR NEEDS EDIT POLICIES — ON THE SERVER.
--
-- `20261002000003` makes the eight policy writers call `assert_may_edit_policies`, which reads
-- `project_rights_for_user` (D230). What only a running database can settle, every call made
-- AS anon — the browser's role (D155):
--
--   §1 THE ANALYST IS REFUSED, EVERY WRITER: each of the eight raises `forbidden`
--      (insufficient_privilege) for an analyst member, and no policy value moves.
--   §2 A VIEWER AND AN UNKNOWN ACTOR ARE REFUSED TOO: no answer from the resolver is not a grant.
--   §3 THE EDITOR AND THE OWNER STILL WRITE: the same calls succeed and the value lands.
--   §4 RUNNING STAYS OPEN: the analyst may still save a policy VERSION (`snapshot_policy`),
--      which a run binds to and which changes no value (D230 decision 5).
--   §5 NO ACTOR, NO CHANGE: a call that names nobody (the API-key path, D28) still writes.

DO $d273$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- modeler of p
  v_editor  uuid := gen_random_uuid();   -- modeler account, editor on p
  v_analyst uuid := gen_random_uuid();   -- modeler account, analyst on p
  v_viewer  uuid := gen_random_uuid();   -- modeler account, viewer on p
  v_ghost   uuid := gen_random_uuid();   -- not an approved user at all
  v_p       uuid := gen_random_uuid();
  v_version uuid;
  v_v2      uuid;
  v_who     uuid;
  v_call    text;
  v_refused text[];
  v_val     jsonb;
  v_n       bigint;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D275 Org', 'd273-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,   'd273s@example.invalid', 'D275 Super',   'x', 'super_admin', 'D275 Org', v_org, true),
    (v_owner,   'd273o@example.invalid', 'D275 Owner',   'x', 'modeler',     'D275 Org', v_org, true),
    (v_editor,  'd273e@example.invalid', 'D275 Editor',  'x', 'modeler',     'D275 Org', v_org, true),
    (v_analyst, 'd273a@example.invalid', 'D275 Analyst', 'x', 'modeler',     'D275 Org', v_org, true),
    (v_viewer,  'd273v@example.invalid', 'D275 Viewer',  'x', 'modeler',     'D275 Org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D275 p', v_owner, 'D275P', 'D275 Org', v_org, 'single');

  -- The rehearsal base is schema, not seed: plant the project layer where it is missing, as
  -- the migrations leave it (`20260915000005`, D232's analyst row from `20261001000005`), as
  -- `550` does. ON CONFLICT DO NOTHING, so a base that has the rows keeps its own.
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
  -- D276 — the account role is now the CEILING the project role grants within, so the base
  -- also needs the account layer the migrations seed (`20260711000002`: modeler, admin and
  -- super admin hold all four; a 'user' account Export only; `20260915000005` copies
  -- data_editing into the two edit keys). Without it every right reads false.
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, k.key, r.role <> 'user' OR k.key = 'export'
    FROM (VALUES ('super_admin'), ('admin'), ('modeler'), ('user')) r(role)
    CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies'), ('export'), ('simulation_lab')) k(key)
  ON CONFLICT (role, capability_key) DO NOTHING;

  SET LOCAL ROLE anon;
  PERFORM public.admin_set_project_member(v_super, 'd273s@example.invalid', v_editor,  v_p, 'editor',  NULL, 'D275 editor');
  PERFORM public.admin_set_project_member(v_super, 'd273s@example.invalid', v_analyst, v_p, 'analyst', NULL, 'D275 analyst');
  PERFORM public.admin_set_project_member(v_super, 'd273s@example.invalid', v_viewer,  v_p, 'viewer',  NULL, 'D275 viewer');
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);

  -- A known starting value, and a version to restore / annotate / delete. Written with no
  -- actor (§5's path), as the owner would have left it.
  PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d273": "start"}'::jsonb);
  PERFORM public.bulk_upsert_policy_overrides(v_p, jsonb_build_array(jsonb_build_object(
    'scope', 'node', 'target_key', 'N1', 'family', 'sourcing', 'patch', '{"d273": "start"}'::jsonb)));
  v_version := public.snapshot_policy(v_p, 'D275 base', v_owner);
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1–§2 · every writer refuses the analyst, the viewer and an unknown actor ══
  FOREACH v_who IN ARRAY ARRAY[v_analyst, v_viewer, v_ghost] LOOP
    v_refused := ARRAY[]::text[];
    FOREACH v_call IN ARRAY ARRAY[
      'save_policy_defaults', 'bulk_upsert_policy_overrides', 'delete_policy_override',
      'clear_policy_preset', 'restore_policy_version', 'update_policy_version_notes',
      'delete_policy_version', 'apply_policy_bundle'] LOOP
      BEGIN
        SET LOCAL ROLE anon;
        CASE v_call
          WHEN 'save_policy_defaults' THEN
            PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d273": "changed"}'::jsonb, _actor_user_id => v_who);
          WHEN 'bulk_upsert_policy_overrides' THEN
            PERFORM public.bulk_upsert_policy_overrides(v_p, jsonb_build_array(jsonb_build_object(
              'scope', 'node', 'target_key', 'N1', 'family', 'sourcing', 'patch', '{"d273": "changed"}'::jsonb)), v_who);
          WHEN 'delete_policy_override' THEN
            PERFORM public.delete_policy_override(v_p, 'node', 'N1', 'sourcing', v_who);
          WHEN 'clear_policy_preset' THEN
            PERFORM public.clear_policy_preset(v_p, v_who);
          WHEN 'restore_policy_version' THEN
            PERFORM public.restore_policy_version(v_version, v_who);
          WHEN 'update_policy_version_notes' THEN
            PERFORM public.update_policy_version_notes(v_version, 'changed', v_who);
          WHEN 'delete_policy_version' THEN
            PERFORM public.delete_policy_version(v_version, v_who);
          WHEN 'apply_policy_bundle' THEN
            PERFORM public.apply_policy_bundle(v_p, '{"inventory": {"d273": "changed"}}'::jsonb,
              p_user_id => v_who);
        END CASE;
        RESET ROLE;
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        v_refused := v_refused || v_call;
      END;
    END LOOP;
    PERFORM set_config('app.current_user_id', '', true);
    IF cardinality(v_refused) <> 8 THEN
      RAISE EXCEPTION 'D275/710 §1–§2: actor % (analyst %, viewer %, ghost %) was refused only by % — every policy writer must refuse it',
        v_who, v_analyst, v_viewer, v_ghost, v_refused;
    END IF;
  END LOOP;

  SELECT inventory INTO v_val FROM public.policy_defaults WHERE project_id = v_p;
  IF v_val ->> 'd273' IS DISTINCT FROM 'start' THEN
    RAISE EXCEPTION 'D275/710 §1: a refused write moved the defaults to %', v_val;
  END IF;
  SELECT patch INTO v_val FROM public.policy_overrides
   WHERE project_id = v_p AND scope = 'node' AND target_key = 'N1' AND family = 'sourcing';
  IF v_val ->> 'd273' IS DISTINCT FROM 'start' THEN
    RAISE EXCEPTION 'D275/710 §1: a refused write moved the override to %', v_val;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_versions WHERE id = v_version AND notes IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D275/710 §1: a refused write annotated or deleted the version';
  END IF;

  -- ══ §3 · the editor and the owner still write ══
  SET LOCAL ROLE anon;
  PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d273": "editor"}'::jsonb, _actor_user_id => v_editor);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT inventory INTO v_val FROM public.policy_defaults WHERE project_id = v_p;
  IF v_val ->> 'd273' IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'D275/710 §3: the editor''s write did not land (defaults %)', v_val;
  END IF;
  SET LOCAL ROLE anon;
  PERFORM public.bulk_upsert_policy_overrides(v_p, jsonb_build_array(jsonb_build_object(
    'scope', 'node', 'target_key', 'N1', 'family', 'sourcing', 'patch', '{"d273": "owner"}'::jsonb)), v_owner);
  PERFORM public.update_policy_version_notes(v_version, 'owner note', v_owner);
  PERFORM public.restore_policy_version(v_version, v_editor);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  SELECT inventory INTO v_val FROM public.policy_defaults WHERE project_id = v_p;
  IF v_val ->> 'd273' IS DISTINCT FROM 'start' THEN
    RAISE EXCEPTION 'D275/710 §3: the editor''s restore did not land (defaults %)', v_val;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_versions WHERE id = v_version AND notes = 'owner note';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D275/710 §3: the owner''s note did not land';
  END IF;

  -- ══ §4 · the analyst may still save a version on the way to a run ══
  SET LOCAL ROLE anon;
  v_v2 := public.snapshot_policy(v_p, 'D275 analyst run', v_analyst);
  RESET ROLE;
  PERFORM set_config('app.current_user_id', '', true);
  IF v_v2 IS NULL THEN
    RAISE EXCEPTION 'D275/710 §4: the analyst could not save a policy version for a run';
  END IF;

  -- ══ §5 · no actor, no change ══
  SET LOCAL ROLE anon;
  PERFORM public.save_policy_defaults(v_p, 'inventory', '{"d273": "unnamed"}'::jsonb);
  RESET ROLE;
  SELECT inventory INTO v_val FROM public.policy_defaults WHERE project_id = v_p;
  IF v_val ->> 'd273' IS DISTINCT FROM 'unnamed' THEN
    RAISE EXCEPTION 'D275/710 §5: a write naming no actor was refused or lost (defaults %)', v_val;
  END IF;

  RAISE NOTICE 'D275/710: every policy writer refuses an actor without Edit Policies; editors, owners, runs and the API path are unchanged';
END $d273$;
