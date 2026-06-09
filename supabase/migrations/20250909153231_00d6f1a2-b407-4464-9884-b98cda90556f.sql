-- Fix level normalization and add performance indexes for process-level network
-- Use correct column names from actual database schema

-- Add indexes for performance on multi-tier supply chain data
CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_from_location 
ON public.supply_chain_data_multi_tier(from_location);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_to_location 
ON public.supply_chain_data_multi_tier(to_location);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_project_level 
ON public.supply_chain_data_multi_tier(project_id, level);

-- Add indexes on supply_chain_data for performance
CREATE INDEX IF NOT EXISTS idx_supply_chain_data_project_data_source 
ON public.supply_chain_data(project_id, data_source);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_from_to_locations 
ON public.supply_chain_data(project_id, from_location, to_location);

-- Update the RPC function to fix level normalization and reduce complexity
CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(p_project_id uuid, p_user_id uuid, p_user_email text)
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
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return integrated process network data with corrected level normalization
  -- Simplified approach to avoid complex fuzzy matching that causes timeouts
  RETURN QUERY
  
  -- Outbound data (Customers = Level 6, Products = Level 5)
  SELECT 
    scd.to_location as node_id,
    scd.to_location as node_name,
    'customer' as node_type,
    6 as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    true as is_connected,
    1.0 as mapping_confidence,
    'outbound' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'outbound'
  
  UNION ALL
  
  -- Products from outbound (Level 5)
  SELECT 
    scd.from_location as node_id,
    scd.from_location as node_name,
    'product' as node_type,
    5 as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    true as is_connected,
    1.0 as mapping_confidence,
    'outbound' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'outbound'
  
  UNION ALL
  
  -- BOM data (Materials and Components, levels 1-5 from original 0-4)
  SELECT 
    scd.from_location as node_id,
    scd.from_location as node_name,
    'material' as node_type,
    -- Get level from multi_tier table and add 1 to shift from 0-4 to 1-5
    COALESCE((
      SELECT mt.level + 1 
      FROM public.supply_chain_data_multi_tier mt 
      WHERE mt.project_id = p_project_id 
        AND mt.from_location = scd.from_location 
      LIMIT 1
    ), 1) as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    true as is_connected,
    1.0 as mapping_confidence,
    'bom' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'bom'
    
  UNION ALL
  
  -- Components from BOM (to_location)
  SELECT 
    scd.to_location as node_id,
    scd.to_location as node_name,
    'material' as node_type,
    -- Get level from multi_tier table and add 1, default to 2 for components
    COALESCE((
      SELECT mt.level + 1 
      FROM public.supply_chain_data_multi_tier mt 
      WHERE mt.project_id = p_project_id 
        AND mt.to_location = scd.to_location 
      LIMIT 1
    ), 2) as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    true as is_connected,
    1.0 as mapping_confidence,
    'bom' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'bom'
  
  UNION ALL
  
  -- Inbound data (Suppliers = Level 0)
  SELECT 
    scd.from_location as node_id,
    scd.from_location as node_name,
    'supplier' as node_type,
    0 as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    -- Simple check for connection to BOM without fuzzy matching
    EXISTS(
      SELECT 1 FROM public.supply_chain_data scd2 
      WHERE scd2.project_id = p_project_id 
        AND scd2.data_source = 'bom'
        AND scd2.from_location = scd.to_location
    ) as is_connected,
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND scd2.from_location = scd.to_location
      ) THEN 1.0
      ELSE 0.5
    END as mapping_confidence,
    'inbound' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'inbound'
    
  UNION ALL
  
  -- Materials from inbound (Level 1, potential connection to BOM)
  SELECT 
    scd.to_location as node_id,
    scd.to_location as node_name,
    'material' as node_type,
    1 as level,
    scd.data_source,
    scd.from_location,
    scd.to_location,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    -- Simple check for connection to BOM
    EXISTS(
      SELECT 1 FROM public.supply_chain_data scd2 
      WHERE scd2.project_id = p_project_id 
        AND scd2.data_source = 'bom'
        AND scd2.from_location = scd.to_location
    ) as is_connected,
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND scd2.from_location = scd.to_location
      ) THEN 1.0
      ELSE 0.5
    END as mapping_confidence,
    'bridge' as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'inbound'
  
  ORDER BY level, node_id;
END;
$function$;