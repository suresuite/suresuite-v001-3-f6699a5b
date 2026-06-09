-- Update RPCs to accept and persist simulation dates
-- Drop old signatures to avoid ambiguity
DROP FUNCTION IF EXISTS public.create_project(text, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.update_project(uuid, text, text, text, text, uuid, text);

-- Create updated create_project with simulation dates (defaults allow old calls)
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text,
  p_simulation_start date DEFAULT NULL,
  p_simulation_end date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Insert project with modeler name, bom_level, and optional simulation dates
  INSERT INTO public.projects (
    name,
    plant_name,
    supply_chain_model,
    bom_level,
    modeler_id,
    modeler_name,
    simulation_start,
    simulation_end
  ) VALUES (
    p_name,
    p_plant,
    p_model,
    p_bom_level,
    p_user_id,
    p_user_name,
    p_simulation_start,
    p_simulation_end
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Create updated update_project with simulation dates
CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid,
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text,
  p_simulation_start date DEFAULT NULL,
  p_simulation_end date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Update the project, including simulation dates
  UPDATE public.projects 
  SET 
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    simulation_start = p_simulation_start,
    simulation_end = p_simulation_end,
    updated_at = now()
  WHERE id = p_project_id;
  
  -- Check if any row was actually updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$$;