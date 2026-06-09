-- Create function to automatically update project completion status
CREATE OR REPLACE FUNCTION public.update_project_completion_status(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
  has_multi boolean := false;
  is_complete boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project details and validate access
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

  -- Check BOM dataset based on bom_level
  IF v_bom_level = 'single' THEN
    SELECT EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id) INTO has_bom;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id) INTO has_bom;
  END IF;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;
  SELECT EXISTS(SELECT 1 FROM public.multi_tier_supply_chain WHERE project_id = p_project_id) INTO has_multi;

  -- Determine if project is complete
  is_complete := has_bom AND has_inbound AND has_outbound AND has_multi;

  -- Update project completion status
  UPDATE public.projects 
  SET completed = is_complete, updated_at = now()
  WHERE id = p_project_id;

  RETURN is_complete;
END;
$function$;