-- Remove tier2_suppliers and tier3_suppliers references from delete_project RPC
CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 1) Disruption scenarios and children
  DELETE FROM public.disruption_scenario_effects e USING public.disruption_scenario_profiles sp
  WHERE e.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_targets t USING public.disruption_scenario_profiles sp
  WHERE t.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_settings s USING public.disruption_scenario_profiles sp
  WHERE s.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_profiles sp WHERE sp.project_id = p_project_id;

  -- 2) Simulation results
  DELETE FROM public.simulation_results sr WHERE sr.project_id = p_project_id;

  -- 3) Deep-tier network data (nodes/edges only)
  DELETE FROM public.network_edges ne WHERE ne.project_id = p_project_id;
  DELETE FROM public.network_nodes nn WHERE nn.project_id = p_project_id;

  -- 4) Node list
  DELETE FROM public.node_list nl WHERE nl.project_id = p_project_id;

  -- 5) Combined supply chain data
  DELETE FROM public.supply_chain_data scd WHERE scd.project_id = p_project_id;
  DELETE FROM public.node_list nl2 WHERE nl2.project_id = p_project_id;

  -- 6) Inbound/Outbound logistics
  DELETE FROM public.inbound_logistics i WHERE i.project_id = p_project_id;
  DELETE FROM public.outbound_logistics o WHERE o.project_id = p_project_id;

  -- 7) BOM datasets
  DELETE FROM public.bom_single_level b1 WHERE b1.project_id = p_project_id;
  DELETE FROM public.bom_multi_level b2 WHERE b2.project_id = p_project_id;

  -- 8) Finally the project
  DELETE FROM public.projects p WHERE p.id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or access denied'; END IF;
END;
$$;