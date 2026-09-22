-- §4 D170, second half · A PROJECT IS DELETED BEFORE ITS LANE SOURCES, SO NOTHING
-- REBUILDS IT ON THE WAY OUT.
--
-- `20260922000003` made the deletion one transaction and deployed it. It then took
-- 44 s on a project the size of production's largest (2 200 BOM and inbound rows,
-- 400 outbound, 1 400 deep-tier nodes), measured on the rehearsal database: each
-- source delete fired the D142 statement trigger, which rebuilt the project's lanes
-- and node list from the rows still left — 17.5 s, 12.9 s and 3.0 s for the three
-- source tables. The edge function calls it through PostgREST as `service_role`,
-- which sets no `statement_timeout` of its own and so runs under `authenticator`'s
-- 8 s (§15 run `35795239732` (8c)). Every project with real data would have been
-- cancelled part-way and rolled back, and only the empty ones could ever be deleted.
--
-- Same function, same signature, same authorization, same grants; ONE change of
-- order. `rehearsal/370` §6 pins the order from `prosrc`, because a timing
-- assertion would be a flaky one.

CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id    uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists  boolean;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
  v_user_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_project: this delete must name its actor'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT true, p.organization_id, p.modeler_id
    INTO v_exists, v_org_id, v_modeler
    FROM public.projects p
   WHERE p.id = p_project_id;
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'delete_project: project % not found', p_project_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_user_org
    FROM public.approved_users au WHERE au.id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'delete_project: % is not an approved user', p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
       v_modeler = p_user_id
    OR (v_role = 'admin' AND v_org_id IS NOT DISTINCT FROM v_user_org AND v_org_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'delete_project: % may not delete project % (only its owner or an admin of its organization may)',
      p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  -- 1) Disruption profiles and their children, and the legacy scenarios table.
  -- The disruption profile's children first: they reach the project only through
  -- the profile, and nothing rebuilds from them.
  DELETE FROM public.disruption_scenario_effects e USING public.disruption_scenario_profiles sp
   WHERE e.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_targets t USING public.disruption_scenario_profiles sp
   WHERE t.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_settings s USING public.disruption_scenario_profiles sp
   WHERE s.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_profiles WHERE project_id = p_project_id;
  DELETE FROM public.disruption_scenarios         WHERE project_id = p_project_id;

  -- THE PROJECT ROW GOES BEFORE ITS LANE SOURCES, and that order is the whole of
  -- this migration. Every source delete fires `auto_rebuild_supply_chain_lanes` (D142),
  -- which rebuilds the project's derived lanes and node list from what is left — so
  -- deleting the sources one by one while the project still existed rebuilt the
  -- project three times on the way to deleting it: 44 s for a project the size of
  -- production's largest, against the 8 s `statement_timeout` the service role
  -- inherits from `authenticator` (§15 run `35795239732` (8c)). With the row gone,
  -- the cascade (D117) removes the sources and the rebuild skips a project that no
  -- longer exists: the same deletion takes under half a second.
  DELETE FROM public.projects WHERE id = p_project_id;

  -- What the cascade cannot reach: tables with no foreign key to `projects`, and a
  -- sweep of the rest, which is a no-op when the cascade already removed them.
  DELETE FROM public.simulation_results WHERE project_id = p_project_id;
  DELETE FROM public.network_edges      WHERE project_id = p_project_id;
  DELETE FROM public.network_nodes      WHERE project_id = p_project_id;

  DELETE FROM public.inbound_logistics       WHERE project_id = p_project_id;
  DELETE FROM public.outbound_logistics      WHERE project_id = p_project_id;
  DELETE FROM public.bom_single_level        WHERE project_id = p_project_id;
  DELETE FROM public.bom_multi_level         WHERE project_id = p_project_id;
  DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;

  DELETE FROM public.supply_chain_data            WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;
  DELETE FROM public.node_list                    WHERE project_id = p_project_id;
END;
$$;

COMMENT ON FUNCTION public.delete_project(uuid, uuid, text) IS
  'D170 — deletes ONE project and everything scoped to it in a single transaction: '
  'all of it or none of it. The owner or an admin of the project''s organization '
  'may call it; the actor is set LOCAL so every audit row names them. '
  'The project row is deleted before its lane sources, so the D142 rebuild skips it '
  'instead of rebuilding a project on its way out (44 s -> 0.5 s). Logs are kept.';

REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(uuid, uuid, text) TO service_role;
