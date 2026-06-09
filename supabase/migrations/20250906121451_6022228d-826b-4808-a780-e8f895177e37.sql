-- Add get_project_dataset_status RPC function that includes deep tier checks
CREATE OR REPLACE FUNCTION public.get_project_dataset_status(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_bom_level text;
  v_deep_tier_enabled boolean;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
  has_deep_tier_nodes boolean := false;
  has_deep_tier_edges boolean := false;
  has_deep_tier_summary boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info
  SELECT organization, bom_level, deep_tier_enabled
  INTO v_org, v_bom_level, v_deep_tier_enabled
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF v_org <> public.get_current_user_org() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Check BOM data (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;

  -- Check deep tier datasets if enabled
  IF v_deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = p_project_id) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = p_project_id) INTO has_deep_tier_edges;
    SELECT EXISTS(SELECT 1 FROM public.network_summary WHERE project_id = p_project_id) INTO has_deep_tier_summary;
  END IF;

  RETURN jsonb_build_object(
    'bom_level', v_bom_level,
    'deep_tier_enabled', v_deep_tier_enabled,
    'has_bom', has_bom,
    'has_inbound', has_inbound,
    'has_outbound', has_outbound,
    'has_deep_tier_nodes', has_deep_tier_nodes,
    'has_deep_tier_edges', has_deep_tier_edges,
    'has_deep_tier_summary', has_deep_tier_summary,
    'completed', CASE 
      WHEN v_deep_tier_enabled THEN 
        (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges AND has_deep_tier_summary)
      ELSE 
        (has_bom AND has_inbound AND has_outbound)
    END
  );
END;
$function$;

-- Update the existing update_project_completion_status RPC to match the trigger logic
CREATE OR REPLACE FUNCTION public.update_project_completion_status(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  has_bom BOOLEAN; 
  has_inbound BOOLEAN; 
  has_outbound BOOLEAN; 
  has_deep_tier_nodes BOOLEAN;
  has_deep_tier_edges BOOLEAN;
  has_deep_tier_summary BOOLEAN;
  deep_tier_enabled BOOLEAN;
  final_completed BOOLEAN;
  v_org text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info and check authorization
  SELECT organization, deep_tier_enabled INTO v_org, deep_tier_enabled
  FROM public.projects 
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF v_org <> public.get_current_user_org() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;

  -- If deep tier is enabled, check for deep tier datasets
  IF deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = p_project_id) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = p_project_id) INTO has_deep_tier_edges;
    SELECT EXISTS(SELECT 1 FROM public.network_summary WHERE project_id = p_project_id) INTO has_deep_tier_summary;
    
    -- Update completion status including deep tier requirements
    final_completed := (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges AND has_deep_tier_summary);
  ELSE
    -- Update completion status without deep tier requirements
    final_completed := (has_bom AND has_inbound AND has_outbound);
  END IF;

  UPDATE public.projects 
  SET completed = final_completed, 
      updated_at = now() 
  WHERE id = p_project_id;

  RETURN final_completed;
END;
$function$;