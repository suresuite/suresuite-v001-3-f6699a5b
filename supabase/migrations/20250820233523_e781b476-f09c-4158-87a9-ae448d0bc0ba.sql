-- Update the update_project function to include p_bom_level parameter
CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid, 
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text,
  p_user_id uuid, 
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Update the project (RLS policies will ensure proper authorization)
  UPDATE public.projects 
  SET 
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    updated_at = now()
  WHERE id = p_project_id;
  
  -- Check if any row was actually updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$