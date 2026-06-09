-- Update: map supplier nodes (from_location with level = 5) to level 6 in RPC output
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
  
  -- Source edges and nodes from multi-tier table (no level filtering)
  -- 1) Emit source nodes (from_location). For supplier rows (level=5), return level=6
  RETURN QUERY
  SELECT
    scdmt.project_id,
    scdmt.plant_name,
    scdmt.from_location AS node_id,
    scdmt.from_location AS node_name,
    CASE 
      WHEN scdmt.level = -1 THEN 'customer'
      WHEN scdmt.level = 0 THEN 'product'
      WHEN scdmt.level BETWEEN 1 AND 4 THEN 'material'
      WHEN scdmt.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END AS node_type,
    CASE WHEN scdmt.level = 5 THEN 6 ELSE scdmt.level END AS level,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.material_consumption_rate,
    scdmt.weighted,
    scdmt.data_source,
    'edge' AS connection_type,
    true AS is_connected,
    1.0 AS mapping_confidence
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  
  UNION ALL
  
  -- 2) Emit destination nodes (to_location) with original level
  SELECT
    scdmt.project_id,
    scdmt.plant_name,
    scdmt.to_location AS node_id,
    scdmt.to_location AS node_name,
    CASE 
      WHEN scdmt.level = -1 THEN 'customer'
      WHEN scdmt.level = 0 THEN 'product'
      WHEN scdmt.level BETWEEN 1 AND 4 THEN 'material'
      WHEN scdmt.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END AS node_type,
    scdmt.level,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.material_consumption_rate,
    scdmt.weighted,
    scdmt.data_source,
    'edge' AS connection_type,
    true AS is_connected,
    1.0 AS mapping_confidence
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  
  ORDER BY level, node_id;
END;
$$;