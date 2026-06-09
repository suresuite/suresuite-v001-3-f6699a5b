-- Fix the get_integrated_process_network_data function to return all levels
CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  project_id uuid,
  plant_name text,
  node_id text,
  node_name text,
  node_type text,
  level integer,
  from_location text,
  to_location text,
  material_consumption_rate numeric,
  weighted numeric,
  data_source text,
  connection_type text,
  is_connected boolean,
  mapping_confidence numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return ALL data from supply_chain_data_multi_tier (no level filtering)
  RETURN QUERY
  SELECT
    scdmt.project_id,
    scdmt.plant_name,
    scdmt.node_id,
    scdmt.node_name,
    scdmt.node_type,
    scdmt.level,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.material_consumption_rate,
    scdmt.weighted,
    scdmt.data_source,
    scdmt.connection_type,
    scdmt.is_connected,
    scdmt.mapping_confidence
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  ORDER BY scdmt.level, scdmt.node_id;
END;
$$;