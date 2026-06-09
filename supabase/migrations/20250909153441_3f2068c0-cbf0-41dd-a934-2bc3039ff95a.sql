-- Fix level normalization by dropping and recreating the function
-- Add performance indexes first

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

-- Drop and recreate the function with corrected level normalization
DROP FUNCTION IF EXISTS public.get_integrated_process_network_data(uuid, uuid, text);

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
  -- Simplified approach to avoid timeouts
  RETURN QUERY
  
  -- Outbound data (Customers = Level 6, Products = Level 5)
  SELECT 
    scd.to_location::text as node_id,
    scd.to_location::text as node_name,
    'customer'::text as node_type,
    6::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    true::boolean as is_connected,
    1.0::numeric as mapping_confidence,
    'outbound'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'outbound'
  
  UNION ALL
  
  -- Products from outbound (Level 5)
  SELECT 
    scd.from_location::text as node_id,
    scd.from_location::text as node_name,
    'product'::text as node_type,
    5::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    true::boolean as is_connected,
    1.0::numeric as mapping_confidence,
    'outbound'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'outbound'
  
  UNION ALL
  
  -- BOM data (Materials, levels 1-5 from original 0-4)
  SELECT 
    scd.from_location::text as node_id,
    scd.from_location::text as node_name,
    'material'::text as node_type,
    -- Get level from multi_tier table and add 1 to shift from 0-4 to 1-5
    COALESCE((
      SELECT (mt.level + 1)::integer 
      FROM public.supply_chain_data_multi_tier mt 
      WHERE mt.project_id = p_project_id 
        AND mt.from_location = scd.from_location 
      LIMIT 1
    ), 1)::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    true::boolean as is_connected,
    1.0::numeric as mapping_confidence,
    'bom'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'bom'
    
  UNION ALL
  
  -- Components from BOM (to_location)
  SELECT 
    scd.to_location::text as node_id,
    scd.to_location::text as node_name,
    'material'::text as node_type,
    -- Get level from multi_tier table and add 1, default to 2 for components
    COALESCE((
      SELECT (mt.level + 1)::integer 
      FROM public.supply_chain_data_multi_tier mt 
      WHERE mt.project_id = p_project_id 
        AND mt.to_location = scd.to_location 
      LIMIT 1
    ), 2)::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    true::boolean as is_connected,
    1.0::numeric as mapping_confidence,
    'bom'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'bom'
  
  UNION ALL
  
  -- Inbound data (Suppliers = Level 0)
  SELECT 
    scd.from_location::text as node_id,
    scd.from_location::text as node_name,
    'supplier'::text as node_type,
    0::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    -- Simple check for connection to BOM
    EXISTS(
      SELECT 1 FROM public.supply_chain_data scd2 
      WHERE scd2.project_id = p_project_id 
        AND scd2.data_source = 'bom'
        AND scd2.from_location = scd.to_location
    )::boolean as is_connected,
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND scd2.from_location = scd.to_location
      ) THEN 1.0::numeric
      ELSE 0.5::numeric
    END as mapping_confidence,
    'inbound'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'inbound'
    
  UNION ALL
  
  -- Materials from inbound (Level 1)
  SELECT 
    scd.to_location::text as node_id,
    scd.to_location::text as node_name,
    'material'::text as node_type,
    1::integer as level,
    scd.data_source::text,
    scd.from_location::text,
    scd.to_location::text,
    scd.material_consumption_rate::numeric,
    scd.sourcing_ratio::numeric,
    scd.weighted::numeric,
    -- Simple check for connection to BOM
    EXISTS(
      SELECT 1 FROM public.supply_chain_data scd2 
      WHERE scd2.project_id = p_project_id 
        AND scd2.data_source = 'bom'
        AND scd2.from_location = scd.to_location
    )::boolean as is_connected,
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND scd2.from_location = scd.to_location
      ) THEN 1.0::numeric
      ELSE 0.5::numeric
    END as mapping_confidence,
    'bridge'::text as connection_type
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id 
    AND scd.data_source = 'inbound'
  
  ORDER BY level, node_id;
END;
$function$;