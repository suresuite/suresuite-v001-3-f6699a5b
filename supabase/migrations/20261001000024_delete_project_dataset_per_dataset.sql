-- ============================================================================
-- Phase 11 / WP 11.6 · §4 D266
-- ONE DATASET AT A TIME: `delete_project_dataset` learns the deep tier and the
-- node list's uploaded fields.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- A project owner who uploaded the wrong deep-tier network could not replace it.
-- `bulk_insert_network_nodes` is a plain INSERT and `network_nodes_natural_key`
-- (project_id, uid) refuses every uid already stored; `bulk_insert_network_edges`
-- has no key, so a second upload sits BESIDE the first. The only function that
-- removed either table was `delete_project`, which removes everything. And no
-- surface reached `delete_project_dataset` at all (the "Delete all data" handler
-- in DataManager has no button).
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
-- The live definition (`20261001000017`), with new branches. The preamble —
-- `set_current_user_context` (the audit row names the caller), the organization
-- test, and owner-or-admin-or-super_admin — is unchanged, and so is the signature,
-- so CREATE OR REPLACE keeps the grants.
--
--   'network_nodes'     (alias 'deep_nodes')    DELETE network_nodes
--   'network_edges'     (alias 'deep_edges')    DELETE network_edges
--   'network_summary'   (alias 'deep_summary')  DELETE network_summary
--   'deep_tier'                                 all three; edges first
--   'node_list_uploads'                         clears description_text,
--        location_text, latitude, longitude — the four columns
--        `upload_node_list_data` writes. The ROWS stay: they are derived from the
--        lanes (`node_list_discover`), and deleting them would only have them
--        re-discovered without anything the user had uploaded.
--
-- No foreign key joins `network_edges` to `network_nodes`, so the order is
-- cosmetic; edges go first anyway, as `delete_project` does.
--
-- ── WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
--
-- 'all' is UNCHANGED. Two seed scripts call it and expect exactly the lane
-- sources gone; widening what an existing caller deletes is a separate decision.
--
-- Nothing downstream needs code: the lane sources' statement triggers rebuild
-- `supply_chain_data` and then `node_list` (`20260920000003`, `20260920000001`),
-- `graph_state_touch_del` moves the project's stored hashes (`20261001000007`),
-- and every table here carries its `audit_*_delete` trigger.
-- `supabase/rehearsal/690` proves the new branches.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_project_dataset(
  p_project_id uuid,
  p_dataset text,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  temp_count integer;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, bom_level, modeler_id
  INTO v_org, v_org_id, v_bom_level, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(p_dataset) = 'inbound' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'outbound' THEN
    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('multitier','multi_tier') THEN
    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'bom' THEN
    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    END IF;
  ELSIF lower(p_dataset) IN ('network_nodes','deep_nodes') THEN
    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_edges','deep_edges') THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_summary','deep_summary') THEN
    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'deep_tier' THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;

    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;
  ELSIF lower(p_dataset) = 'node_list_uploads' THEN
    UPDATE public.node_list
       SET description_text = NULL,
           location_text    = NULL,
           latitude         = NULL,
           longitude        = NULL,
           updated_at       = now()
     WHERE project_id = p_project_id
       AND (description_text IS NOT NULL OR location_text IS NOT NULL
            OR latitude IS NOT NULL OR longitude IS NOT NULL);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'all' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;

    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_dataset';
  END IF;

  RETURN deleted_count;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
