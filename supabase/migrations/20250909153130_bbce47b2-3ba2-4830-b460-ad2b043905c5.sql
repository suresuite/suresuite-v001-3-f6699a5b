-- Fix level normalization and add performance indexes for process-level network
-- BOM levels 0-4 should become 1-5, inbound=0, outbound=6

-- Add indexes for performance on multi-tier supply chain data
CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_material_id 
ON public.supply_chain_data_multi_tier(material_id);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_higher_level_component_id 
ON public.supply_chain_data_multi_tier(higher_level_component_id);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_multi_tier_project_level 
ON public.supply_chain_data_multi_tier(project_id, level);

-- Add indexes on supply_chain_data for performance
CREATE INDEX IF NOT EXISTS idx_supply_chain_data_project_data_source 
ON public.supply_chain_data(project_id, data_source);

CREATE INDEX IF NOT EXISTS idx_supply_chain_data_from_to_locations 
ON public.supply_chain_data(project_id, from_location, to_location);

-- Update the RPC function to fix level normalization (BOM 0-4 → 1-5)
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
  RETURN QUERY
  WITH 
  -- Outbound data (Level 6 = Customers)
  outbound_data AS (
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
  ),
  
  -- BOM data (Original levels 0-4 become 1-5)
  bom_data AS (
    SELECT 
      scd.from_location as node_id,
      scd.from_location as node_name,
      'material' as node_type,
      CASE 
        WHEN scd.data_source = 'bom' AND scd.material_consumption_rate IS NOT NULL 
        THEN COALESCE((
          SELECT bml.level + 1 
          FROM public.bom_multi_level bml 
          WHERE bml.project_id = p_project_id 
            AND bml.material_id = scd.from_location 
          LIMIT 1
        ), 1)
        ELSE 1
      END as level,
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
      CASE 
        WHEN scd.data_source = 'bom' AND scd.material_consumption_rate IS NOT NULL 
        THEN COALESCE((
          SELECT bml.level + 1 
          FROM public.bom_multi_level bml 
          WHERE bml.project_id = p_project_id 
            AND bml.higher_level_component_id = scd.to_location 
          LIMIT 1
        ), 2)
        ELSE 2
      END as level,
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
  ),
  
  -- Inbound data (Level 0 = Suppliers)
  inbound_data AS (
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
      EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND (
            scd2.from_location = scd.to_location OR 
            similarity(scd2.from_location, scd.to_location) > 0.6
          )
      ) as is_connected,
      CASE 
        WHEN EXISTS(
          SELECT 1 FROM public.supply_chain_data scd2 
          WHERE scd2.project_id = p_project_id 
            AND scd2.data_source = 'bom'
            AND scd2.from_location = scd.to_location
        ) THEN 1.0
        ELSE COALESCE((
          SELECT MAX(similarity(scd2.from_location, scd.to_location))
          FROM public.supply_chain_data scd2 
          WHERE scd2.project_id = p_project_id 
            AND scd2.data_source = 'bom'
            AND similarity(scd2.from_location, scd.to_location) > 0.6
        ), 0.0)
      END as mapping_confidence,
      'inbound' as connection_type
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id 
      AND scd.data_source = 'inbound'
      
    UNION ALL
    
    -- Materials from inbound (Level 1, connecting to BOM)
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
      EXISTS(
        SELECT 1 FROM public.supply_chain_data scd2 
        WHERE scd2.project_id = p_project_id 
          AND scd2.data_source = 'bom'
          AND (
            scd2.from_location = scd.to_location OR 
            similarity(scd2.from_location, scd.to_location) > 0.6
          )
      ) as is_connected,
      CASE 
        WHEN EXISTS(
          SELECT 1 FROM public.supply_chain_data scd2 
          WHERE scd2.project_id = p_project_id 
            AND scd2.data_source = 'bom'
            AND scd2.from_location = scd.to_location
        ) THEN 1.0
        ELSE COALESCE((
          SELECT MAX(similarity(scd2.from_location, scd.to_location))
          FROM public.supply_chain_data scd2 
          WHERE scd2.project_id = p_project_id 
            AND scd2.data_source = 'bom'
            AND similarity(scd2.from_location, scd.to_location) > 0.6
        ), 0.0)
      END as mapping_confidence,
      'bridge' as connection_type
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id 
      AND scd.data_source = 'inbound'
  ),
  
  -- Combine all data
  all_data AS (
    SELECT * FROM outbound_data
    UNION ALL
    SELECT * FROM bom_data  
    UNION ALL
    SELECT * FROM inbound_data
  )
  
  SELECT DISTINCT
    ad.node_id,
    ad.node_name,
    ad.node_type,
    ad.level,
    ad.data_source,
    ad.from_location,
    ad.to_location,
    ad.material_consumption_rate,
    ad.sourcing_ratio,
    ad.weighted,
    ad.is_connected,
    ad.mapping_confidence,
    ad.connection_type
  FROM all_data ad
  ORDER BY ad.level, ad.node_id;
END;
$function$;