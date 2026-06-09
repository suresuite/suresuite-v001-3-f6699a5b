-- Drop and recreate the get_integrated_process_network_data function to fix level filtering
DROP FUNCTION IF EXISTS public.get_integrated_process_network_data(uuid, uuid, text);

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
    scdmt.from_location as node_id,           -- Use from_location as node_id
    scdmt.from_location as node_name,          -- Use from_location as node_name
    CASE 
      WHEN scdmt.level = -1 THEN 'customer'
      WHEN scdmt.level = 0 THEN 'product'
      WHEN scdmt.level >= 1 AND scdmt.level <= 4 THEN 'material'
      WHEN scdmt.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END as node_type,
    scdmt.level,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.material_consumption_rate,
    scdmt.weighted,
    scdmt.data_source,
    'edge' as connection_type,                 -- Mark as edge data
    true as is_connected,                      -- Default to connected
    1.0 as mapping_confidence                  -- Default confidence
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  
  UNION ALL
  
  -- Also return destination nodes
  SELECT
    scdmt.project_id,
    scdmt.plant_name,
    scdmt.to_location as node_id,
    scdmt.to_location as node_name,
    CASE 
      WHEN scdmt.level = -1 THEN 'customer'
      WHEN scdmt.level = 0 THEN 'product'
      WHEN scdmt.level >= 1 AND scdmt.level <= 4 THEN 'material'
      WHEN scdmt.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END as node_type,
    scdmt.level,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.material_consumption_rate,
    scdmt.weighted,
    scdmt.data_source,
    'edge' as connection_type,
    true as is_connected,
    1.0 as mapping_confidence
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  
  ORDER BY level, node_id;
END;
$$;