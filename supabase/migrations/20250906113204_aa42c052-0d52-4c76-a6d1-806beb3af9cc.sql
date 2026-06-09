-- Update the update_project function to handle deep_tier_enabled parameter

CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid, 
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text, 
  p_user_id uuid, 
  p_user_email text, 
  p_simulation_start date DEFAULT NULL::date, 
  p_simulation_end date DEFAULT NULL::date, 
  p_deep_tier_enabled boolean DEFAULT false
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Update the project, including simulation dates and deep tier setting
  UPDATE public.projects 
  SET 
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    simulation_start = p_simulation_start,
    simulation_end = p_simulation_end,
    deep_tier_enabled = p_deep_tier_enabled,
    updated_at = now()
  WHERE id = p_project_id;
  
  -- Check if any row was actually updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$;