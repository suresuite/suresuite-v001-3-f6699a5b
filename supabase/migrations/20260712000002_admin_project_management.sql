-- Admin project & organization management RPCs — powers the super-admin
-- /admin/projects and /admin/organizations pages.
--
-- Why the pages were near-empty: the browser talks to PostgREST as anon with
-- custom app auth, and set_current_user_context is transaction-local, so bare
-- `.from('projects').select(...)` / `.from('organizations').select(...)` reads
-- never carry the super-admin context and RLS filters almost everything out.
-- 20260711000003 already moved admin *mutations* behind SECURITY DEFINER RPCs
-- for this exact reason; this migration extends the same pattern to the admin
-- *reads* and adds the project management verbs (copy, rename, metadata edit,
-- transfer across organizations, delete). Every function re-establishes
-- context from the explicit (p_actor_id, p_actor_email) pair, gates on
-- is_super_admin via _assert_super_admin, and logs mutations with
-- log_admin_action.

-- ── reads ─────────────────────────────────────────────────────────────────────

-- All organizations with member/project/cost rollups.
CREATE OR REPLACE FUNCTION public.admin_list_organizations(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, name text, slug text, status text, created_at timestamptz,
  members bigint, projects bigint, cost_mtd numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.status, o.created_at,
         (SELECT count(*) FROM public.organization_members m WHERE m.org_id = o.id),
         (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id),
         COALESCE((SELECT sum(l.cost_usd) FROM public.ai_usage_logs l
                    WHERE l.org_id = o.id
                      AND l.created_at >= date_trunc('month', now())), 0)
  FROM public.organizations o
  ORDER BY o.name;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_organizations(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations(uuid, text) TO anon, authenticated;

-- Every project across every organization, with owner + org resolved.
CREATE OR REPLACE FUNCTION public.admin_list_projects(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, name text, organization_id uuid, organization text,
  modeler_id uuid, owner_name text, owner_email text,
  plant_name text, supply_chain_model text, bom_level text, data_type text,
  completed boolean, simulation_start date, simulation_end date,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT p.id, p.name, p.organization_id,
         COALESCE(o.name, p.organization),
         p.modeler_id,
         COALESCE(u.name, p.modeler_name),
         u.email,
         p.plant_name, p.supply_chain_model, p.bom_level, p.data_type,
         p.completed, p.simulation_start, p.simulation_end,
         p.created_at, p.updated_at
  FROM public.projects p
  LEFT JOIN public.organizations o ON o.id = p.organization_id
  LEFT JOIN public.approved_users u ON u.id = p.modeler_id
  ORDER BY p.updated_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_projects(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_projects(uuid, text) TO anon, authenticated;

-- Minimal user directory for owner pickers (copy / transfer dialogs).
CREATE OR REPLACE FUNCTION public.admin_list_users_basic(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (id uuid, name text, email text, role text, organization_id uuid, is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT u.id, u.name, u.email, u.role::text, u.organization_id, u.is_active
  FROM public.approved_users u
  ORDER BY COALESCE(u.name, u.email);
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_users_basic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users_basic(uuid, text) TO anon, authenticated;

-- ── project verbs ─────────────────────────────────────────────────────────────

-- Rename a project.
CREATE OR REPLACE FUNCTION public.admin_rename_project(
  p_actor_id uuid, p_actor_email text, p_project_id uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'name required'; END IF;
  SELECT to_jsonb(p) INTO v_before FROM public.projects p WHERE p.id = p_project_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  BEGIN
    UPDATE public.projects SET name = btrim(p_name), updated_at = now() WHERE id = p_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the owner already has a project named "%" for this plant', btrim(p_name);
  END;
  PERFORM public.log_admin_action('project.rename', 'projects', p_project_id::text,
    v_before, jsonb_build_object('name', btrim(p_name)));
END; $$;
REVOKE ALL ON FUNCTION public.admin_rename_project(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rename_project(uuid, text, uuid, text) TO anon, authenticated;

-- Edit a project's model metadata. NULL keeps the current value for the text /
-- boolean fields; the simulation dates are always applied as sent so they can
-- be cleared.
CREATE OR REPLACE FUNCTION public.admin_update_project_meta(
  p_actor_id uuid, p_actor_email text, p_project_id uuid,
  p_plant text, p_model text, p_bom_level text, p_data_type text,
  p_simulation_start date, p_simulation_end date, p_completed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT to_jsonb(p) INTO v_before FROM public.projects p WHERE p.id = p_project_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  IF p_model IS NOT NULL AND p_model NOT IN ('Make-To-Stock','Make-To-Order') THEN
    RAISE EXCEPTION 'invalid supply chain model %', p_model;
  END IF;
  IF p_data_type IS NOT NULL AND p_data_type NOT IN ('curated','uncurated') THEN
    RAISE EXCEPTION 'invalid data type %', p_data_type;
  END IF;
  UPDATE public.projects SET
    plant_name         = COALESCE(NULLIF(btrim(coalesce(p_plant, '')), ''), plant_name),
    supply_chain_model = COALESCE(p_model, supply_chain_model),
    bom_level          = COALESCE(p_bom_level, bom_level),
    data_type          = COALESCE(p_data_type, data_type),
    simulation_start   = p_simulation_start,
    simulation_end     = p_simulation_end,
    completed          = COALESCE(p_completed, completed),
    updated_at         = now()
  WHERE id = p_project_id;
  PERFORM public.log_admin_action('project.update_meta', 'projects', p_project_id::text,
    v_before, jsonb_build_object(
      'plant_name', p_plant, 'supply_chain_model', p_model, 'bom_level', p_bom_level,
      'data_type', p_data_type, 'simulation_start', p_simulation_start,
      'simulation_end', p_simulation_end, 'completed', p_completed));
END; $$;
REVOKE ALL ON FUNCTION public.admin_update_project_meta(uuid, text, uuid, text, text, text, text, date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_project_meta(uuid, text, uuid, text, text, text, text, date, date, boolean) TO anon, authenticated;

-- Transfer a project to another organization, optionally handing ownership to
-- a (typically target-org) user. The old owner keeps visibility only if they
-- remain the modeler.
CREATE OR REPLACE FUNCTION public.admin_transfer_project(
  p_actor_id uuid, p_actor_email text, p_project_id uuid,
  p_org_id uuid, p_new_owner_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_org_name text; v_owner_name text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT to_jsonb(p) INTO v_before FROM public.projects p WHERE p.id = p_project_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;
  IF v_org_name IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;
  IF p_new_owner_id IS NOT NULL THEN
    SELECT COALESCE(name, email) INTO v_owner_name FROM public.approved_users WHERE id = p_new_owner_id;
    IF v_owner_name IS NULL THEN RAISE EXCEPTION 'new owner not found'; END IF;
  END IF;
  BEGIN
    UPDATE public.projects SET
      organization_id = p_org_id,
      organization    = v_org_name,
      modeler_id      = COALESCE(p_new_owner_id, modeler_id),
      modeler_name    = COALESCE(v_owner_name, modeler_name),
      updated_at      = now()
    WHERE id = p_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the new owner already has a project with this name for this plant';
  END;
  PERFORM public.log_admin_action('project.transfer', 'projects', p_project_id::text,
    v_before, jsonb_build_object('org_id', p_org_id, 'org_name', v_org_name,
                                 'new_owner_id', p_new_owner_id));
END; $$;
REVOKE ALL ON FUNCTION public.admin_transfer_project(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transfer_project(uuid, text, uuid, uuid, uuid) TO anon, authenticated;

-- Deep-copy a project: the project row plus its model data (item master,
-- logistics, BOM, deep-tier, network layout, policy configuration). Version
-- history, simulation runs, caches and logs are deliberately NOT copied — the
-- copy starts with a clean audit trail. The table list is an allowlist checked
-- against information_schema, so environments missing a table (or a table
-- missing project_id) are skipped rather than erroring.
CREATE OR REPLACE FUNCTION public.admin_copy_project(
  p_actor_id uuid, p_actor_email text, p_project_id uuid, p_new_name text,
  p_target_org_id uuid DEFAULT NULL, p_new_owner_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src public.projects%ROWTYPE;
  v_new_id uuid;
  v_org_id uuid; v_org_name text;
  v_owner_id uuid; v_owner_name text;
  v_tbl text; v_cols text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN RAISE EXCEPTION 'name required'; END IF;
  SELECT * INTO v_src FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;

  v_org_id := COALESCE(p_target_org_id, v_src.organization_id);
  IF p_target_org_id IS NOT NULL THEN
    SELECT name INTO v_org_name FROM public.organizations WHERE id = p_target_org_id;
    IF v_org_name IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;
  ELSE
    v_org_name := v_src.organization;
  END IF;

  v_owner_id := COALESCE(p_new_owner_id, v_src.modeler_id);
  IF p_new_owner_id IS NOT NULL THEN
    SELECT COALESCE(name, email) INTO v_owner_name FROM public.approved_users WHERE id = p_new_owner_id;
    IF v_owner_name IS NULL THEN RAISE EXCEPTION 'new owner not found'; END IF;
  ELSE
    v_owner_name := v_src.modeler_name;
  END IF;

  BEGIN
    INSERT INTO public.projects
      (name, modeler_id, modeler_name, plant_name, supply_chain_model, bom_level,
       data_type, completed, simulation_start, simulation_end,
       plant_latitude, plant_longitude, plant_location_text, deep_tier_enabled,
       organization, organization_id)
    VALUES
      (btrim(p_new_name), v_owner_id, v_owner_name, v_src.plant_name,
       v_src.supply_chain_model, v_src.bom_level, v_src.data_type, v_src.completed,
       v_src.simulation_start, v_src.simulation_end,
       v_src.plant_latitude, v_src.plant_longitude, v_src.plant_location_text,
       v_src.deep_tier_enabled, COALESCE(v_org_name, 'default_org'), v_org_id)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the owner already has a project named "%" for plant "%"',
      btrim(p_new_name), v_src.plant_name;
  END;

  FOREACH v_tbl IN ARRAY ARRAY[
    'suppliers','materials','products',
    'inbound_logistics','outbound_logistics',
    'bom_single_level','bom_multi_level',
    'multi_tier_supply_chain','tier2_suppliers','tier3_suppliers',
    'node_list','network_nodes','network_edges','network_summary',
    'policy_defaults','policy_overrides']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = v_tbl
                      AND column_name = 'project_id') THEN
      CONTINUE;
    END IF;
    SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_tbl
      AND column_name NOT IN ('id', 'project_id')
      AND is_generated = 'NEVER';
    IF v_cols IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'INSERT INTO public.%I (project_id, %s) SELECT $1, %s FROM public.%I WHERE project_id = $2',
      v_tbl, v_cols, v_cols, v_tbl)
    USING v_new_id, p_project_id;
  END LOOP;

  PERFORM public.log_admin_action('project.copy', 'projects', v_new_id::text,
    jsonb_build_object('source_project_id', p_project_id),
    jsonb_build_object('name', btrim(p_new_name), 'org_id', v_org_id, 'owner_id', v_owner_id));
  RETURN v_new_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_copy_project(uuid, text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_copy_project(uuid, text, uuid, text, uuid, uuid) TO anon, authenticated;

-- Delete a project (children cascade). The old UI's bare
-- `.from('projects').delete()` silently no-oped for the same RLS/context
-- reason the reads returned nothing.
CREATE OR REPLACE FUNCTION public.admin_delete_project(
  p_actor_id uuid, p_actor_email text, p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT to_jsonb(p) INTO v_before FROM public.projects p WHERE p.id = p_project_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  DELETE FROM public.projects WHERE id = p_project_id;
  PERFORM public.log_admin_action('project.delete', 'projects', p_project_id::text, v_before, NULL);
END; $$;
REVOKE ALL ON FUNCTION public.admin_delete_project(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_project(uuid, text, uuid) TO anon, authenticated;
