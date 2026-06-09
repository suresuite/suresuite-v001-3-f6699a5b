-- Fix ambiguous column references in get_integrated_process_network_data function
DROP FUNCTION IF EXISTS public.get_integrated_process_network_data(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS TABLE(
  node_id text,
  node_name text,
  node_type text,
  level integer,
  data_source text,
  from_location text,
  to_location text,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  is_connected boolean,
  mapping_confidence numeric,
  connection_type text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  RETURN QUERY
  WITH multi_tier_data AS (
    -- Get all data from supply_chain_data_multi_tier
    SELECT 
      scmt.from_location,
      scmt.to_location,
      scmt.level,
      scmt.material_consumption_rate,
      scmt.sourcing_ratio,
      scmt.weighted,
      scmt.data_source
    FROM public.supply_chain_data_multi_tier scmt
    WHERE scmt.project_id = p_project_id
  ),
  all_nodes AS (
    -- Create nodes from both from_location and to_location
    SELECT DISTINCT
      mtd.from_location as node_id,
      mtd.from_location as node_name,
      CASE
        WHEN mtd.level = 0 THEN 'product'
        WHEN mtd.level BETWEEN 1 AND 4 THEN 'material'
        WHEN mtd.level = 5 THEN 'supplier'
        ELSE 'unknown'
      END as node_type,
      mtd.level,
      mtd.data_source,
      true as is_connected,
      1.0 as mapping_confidence
    FROM multi_tier_data mtd
    WHERE mtd.from_location IS NOT NULL
    
    UNION
    
    SELECT DISTINCT
      mtd.to_location as node_id,
      mtd.to_location as node_name,
      CASE
        WHEN mtd.level = 0 THEN 'product'
        WHEN mtd.level BETWEEN 1 AND 4 THEN 'material'
        WHEN mtd.level = 5 THEN 'supplier'
        ELSE 'unknown'
      END as node_type,
      mtd.level,
      mtd.data_source,
      true as is_connected,
      1.0 as mapping_confidence
    FROM multi_tier_data mtd
    WHERE mtd.to_location IS NOT NULL
  ),
  customer_nodes AS (
    -- Create customer nodes for outbound sink nodes (level -1)
    SELECT DISTINCT
      mtd.to_location as node_id,
      mtd.to_location as node_name,
      'customer' as node_type,
      -1 as level,
      'outbound' as data_source,
      true as is_connected,
      1.0 as mapping_confidence
    FROM multi_tier_data mtd
    WHERE mtd.level = 0  -- Outbound data
      AND mtd.to_location IS NOT NULL
      AND mtd.to_location NOT IN (
        SELECT DISTINCT mtd2.from_location 
        FROM multi_tier_data mtd2
        WHERE mtd2.from_location IS NOT NULL
      )  -- Only sink nodes (customers)
  ),
  all_unique_nodes AS (
    SELECT * FROM all_nodes
    UNION
    SELECT * FROM customer_nodes
  ),
  edge_data AS (
    -- Regular edges from multi-tier data
    SELECT 
      mtd.from_location,
      mtd.to_location,
      mtd.material_consumption_rate,
      mtd.sourcing_ratio,
      mtd.weighted,
      mtd.data_source as connection_type
    FROM multi_tier_data mtd
    WHERE mtd.from_location IS NOT NULL 
      AND mtd.to_location IS NOT NULL
    
    UNION ALL
    
    -- Customer edges (product to customer)
    SELECT 
      mtd.from_location,
      mtd.to_location,
      mtd.material_consumption_rate,
      mtd.sourcing_ratio,
      mtd.weighted,
      'customer_connection' as connection_type
    FROM multi_tier_data mtd
    WHERE mtd.level = 0  -- Outbound data
      AND mtd.from_location IS NOT NULL 
      AND mtd.to_location IS NOT NULL
      AND mtd.to_location NOT IN (
        SELECT DISTINCT mtd2.from_location 
        FROM multi_tier_data mtd2
        WHERE mtd2.from_location IS NOT NULL
      )  -- Only connections to sink nodes (customers)
  )
  
  -- Return node-only rows (for unique nodes)
  SELECT 
    an.node_id,
    an.node_name,
    an.node_type,
    an.level,
    an.data_source,
    NULL::text as from_location,
    NULL::text as to_location,
    NULL::numeric as material_consumption_rate,
    NULL::numeric as sourcing_ratio,
    NULL::numeric as weighted,
    an.is_connected,
    an.mapping_confidence,
    'node' as connection_type
  FROM all_unique_nodes an
  
  UNION ALL
  
  -- Return edge rows (for connections)
  SELECT 
    CONCAT(ed.from_location, '->', ed.to_location) as node_id,
    CONCAT(ed.from_location, ' -> ', ed.to_location) as node_name,
    'edge' as node_type,
    0 as level,
    ed.connection_type as data_source,
    ed.from_location,
    ed.to_location,
    ed.material_consumption_rate,
    ed.sourcing_ratio,
    ed.weighted,
    true as is_connected,
    1.0 as mapping_confidence,
    ed.connection_type
  FROM edge_data ed
  
  ORDER BY connection_type, level, node_id;
END;
$function$;