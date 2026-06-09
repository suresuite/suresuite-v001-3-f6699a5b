-- Create function to get process-level network data from multi-level BOM
CREATE OR REPLACE FUNCTION public.get_process_level_network_data(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  material_id text,
  higher_level_component_id text,
  level integer,
  consumption_rate numeric,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return multi-level BOM data for the specified project
  RETURN QUERY
  SELECT
    bml.id,
    bml.project_id,
    bml.plant_name,
    bml.material_id,
    bml.higher_level_component_id,
    bml.level,
    bml.consumption_rate,
    bml.created_at,
    bml.updated_at
  FROM public.bom_multi_level bml
  WHERE bml.project_id = p_project_id
  ORDER BY bml.level, bml.material_id;
END;
$function$;