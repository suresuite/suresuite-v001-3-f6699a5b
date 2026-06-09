-- Create RPC function to fetch supply chain data multi-tier with proper RLS context
CREATE OR REPLACE FUNCTION public.get_supply_chain_data_multi_tier(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  data_source text,
  from_location text,
  to_location text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  path_root text,
  organization text,
  uploaded_by uuid,
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
  
  -- Return multi-tier supply chain data for the specified project
  RETURN QUERY
  SELECT
    scd.id,
    scd.project_id,
    scd.plant_name,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.level,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    scd.path_root,
    scd.organization,
    scd.uploaded_by,
    scd.created_at,
    scd.updated_at
  FROM public.supply_chain_data_multi_tier scd
  WHERE scd.project_id = p_project_id
  ORDER BY scd.level, scd.from_location, scd.to_location;
END;
$function$