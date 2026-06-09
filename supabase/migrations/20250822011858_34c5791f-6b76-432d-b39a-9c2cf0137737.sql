-- Create secure RPC to fetch all datasets for a project with explicit context
CREATE OR REPLACE FUNCTION public.get_project_datasets(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_bom_level text;
  result jsonb;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, bom_level
  INTO v_org, v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF v_org <> public.get_current_user_org() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  result := jsonb_build_object(
    'bom_level', v_bom_level,
    'bom', CASE 
      WHEN v_bom_level = 'single' THEN COALESCE((
        SELECT jsonb_agg(to_jsonb(b.*)) FROM public.bom_single_level b WHERE b.project_id = p_project_id
      ), '[]'::jsonb)
      ELSE COALESCE((
        SELECT jsonb_agg(to_jsonb(bm.*)) FROM public.bom_multi_level bm WHERE bm.project_id = p_project_id
      ), '[]'::jsonb)
    END,
    'inbound', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*)) FROM public.inbound_logistics i WHERE i.project_id = p_project_id
    ), '[]'::jsonb),
    'outbound', COALESCE((
      SELECT jsonb_agg(to_jsonb(o.*)) FROM public.outbound_logistics o WHERE o.project_id = p_project_id
    ), '[]'::jsonb),
    'multiTier', COALESCE((
      SELECT jsonb_agg(to_jsonb(m.*)) FROM public.multi_tier_supply_chain m WHERE m.project_id = p_project_id
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$$;

-- Create secure RPC to delete datasets with owner-or-admin authorization
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
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  temp_count integer;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, bom_level, modeler_id
  INTO v_org, v_bom_level, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
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