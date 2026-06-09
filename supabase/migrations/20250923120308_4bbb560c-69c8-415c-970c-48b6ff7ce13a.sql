-- Add data_type column to projects table
ALTER TABLE public.projects 
ADD COLUMN data_type text NOT NULL DEFAULT 'curated' CHECK (data_type IN ('curated', 'uncurated'));

-- Update create_project function to include data_type parameter
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
  p_data_type text DEFAULT 'curated'::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Insert project with data_type
  INSERT INTO public.projects (
    name,
    plant_name,
    supply_chain_model,
    bom_level,
    modeler_id,
    modeler_name,
    simulation_start,
    simulation_end,
    data_type
  ) VALUES (
    p_name,
    p_plant,
    p_model,
    p_bom_level,
    p_user_id,
    p_user_name,
    p_simulation_start,
    p_simulation_end,
    COALESCE(p_data_type, 'curated')
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

-- Update update_project function to include data_type parameter
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
  p_data_type text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Update the project, including data_type if provided
  UPDATE public.projects 
  SET 
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    simulation_start = p_simulation_start,
    simulation_end = p_simulation_end,
    data_type = COALESCE(p_data_type, data_type),
    updated_at = now()
  WHERE id = p_project_id;
  
  -- Check if any row was actually updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$;