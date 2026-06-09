-- Add modeler_name column to projects table
ALTER TABLE public.projects 
ADD COLUMN modeler_name text;

-- Update the create_project function to accept and store modeler name
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text, 
  p_plant text, 
  p_model text, 
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

  -- Insert project with modeler name
  INSERT INTO public.projects (name, plant_name, supply_chain_model, modeler_id, modeler_name)
  VALUES (p_name, p_plant, p_model, p_user_id, p_user_name)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;