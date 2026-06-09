-- Drop existing function and recreate with proper return type
DROP FUNCTION IF EXISTS public.update_project_completion_status(uuid,uuid,text);

-- Create RPC function to update project completion status  
CREATE OR REPLACE FUNCTION public.update_project_completion_status(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS jsonb
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
  is_complete boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info and validate access
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
    is_complete := has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges;
  ELSE
    is_complete := has_bom AND has_inbound AND has_outbound;
  END IF;

  -- Update project completion status
  UPDATE public.projects 
  SET completed = is_complete, updated_at = now()
  WHERE id = p_project_id;

  -- Return status
  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'completed', is_complete,
    'bom_level', v_bom_level,
    'deep_tier_enabled', v_deep_tier_enabled,
    'datasets', jsonb_build_object(
      'has_bom', has_bom,
      'has_inbound', has_inbound,
      'has_outbound', has_outbound,
      'has_deep_tier_nodes', has_deep_tier_nodes,
      'has_deep_tier_edges', has_deep_tier_edges
    )
  );
END;
$function$;