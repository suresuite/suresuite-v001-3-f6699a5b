-- Create lightweight RPC to get dataset counts instead of full data
CREATE OR REPLACE FUNCTION public.get_project_dataset_counts(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_bom_level text;
  v_deep_tier_enabled boolean;
  bom_count integer := 0;
  inbound_count integer := 0;
  outbound_count integer := 0;
  multi_tier_count integer := 0;
  result jsonb;
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

  -- Get BOM count (either single or multi-level)
  IF v_bom_level = 'single' THEN
    SELECT COUNT(*) INTO bom_count FROM public.bom_single_level WHERE project_id = p_project_id;
  ELSE
    SELECT COUNT(*) INTO bom_count FROM public.bom_multi_level WHERE project_id = p_project_id;
  END IF;

  -- Get other dataset counts
  SELECT COUNT(*) INTO inbound_count FROM public.inbound_logistics WHERE project_id = p_project_id;
  SELECT COUNT(*) INTO outbound_count FROM public.outbound_logistics WHERE project_id = p_project_id;
  SELECT COUNT(*) INTO multi_tier_count FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;

  result := jsonb_build_object(
    'bom_level', v_bom_level,
    'deep_tier_enabled', COALESCE(v_deep_tier_enabled, false),
    'bom_count', bom_count,
    'inbound_count', inbound_count,
    'outbound_count', outbound_count,
    'multi_tier_count', multi_tier_count,
    'total_records', bom_count + inbound_count + outbound_count + multi_tier_count
  );

  RETURN result;
END;
$function$;