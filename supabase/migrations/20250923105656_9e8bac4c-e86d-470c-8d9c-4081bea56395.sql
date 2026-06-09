-- Update create_project function to use current year defaults for simulation dates
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text, 
  p_user_id uuid, 
  p_user_email text, 
  p_user_name text, 
  p_simulation_start date DEFAULT NULL::date, 
  p_simulation_end date DEFAULT NULL::date,
  p_deep_tier_enabled boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
  current_year integer;
  default_start_date date;
  default_end_date date;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get current year and set default dates if not provided
  current_year := EXTRACT(YEAR FROM CURRENT_DATE);
  default_start_date := COALESCE(p_simulation_start, DATE(current_year || '-01-01'));
  default_end_date := COALESCE(p_simulation_end, DATE(current_year || '-12-31'));

  -- Insert project with all parameters including deep tier and default dates
  INSERT INTO public.projects (
    name, 
    plant_name, 
    supply_chain_model, 
    bom_level, 
    modeler_id, 
    modeler_name, 
    simulation_start, 
    simulation_end, 
    deep_tier_enabled
  ) VALUES (
    p_name, 
    p_plant, 
    p_model, 
    p_bom_level, 
    p_user_id, 
    p_user_name, 
    default_start_date, 
    default_end_date, 
    p_deep_tier_enabled
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;