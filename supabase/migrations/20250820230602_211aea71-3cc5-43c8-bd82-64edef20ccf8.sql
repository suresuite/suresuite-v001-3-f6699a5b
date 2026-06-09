-- Add bom_level column to projects table if it doesn't exist
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS bom_level text NOT NULL DEFAULT 'single';

-- Update create_project function to include p_bom_level parameter
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text,
  p_user_id uuid, 
  p_user_email text, 
  p_user_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Insert project with modeler name and bom_level
  INSERT INTO public.projects (name, plant_name, supply_chain_model, bom_level, modeler_id, modeler_name)
  VALUES (p_name, p_plant, p_model, p_bom_level, p_user_id, p_user_name)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$