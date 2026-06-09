-- Create RPC function to get integrated process-level network data
-- This combines inbound logistics, BOM multi-level, and outbound logistics with material mapping

CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  from_location text,
  to_location text,
  data_source text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  is_connected boolean,
  mapping_confidence numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  RETURN QUERY
  WITH 
  -- Get inbound logistics data (suppliers -> materials, level 0)
  inbound_data AS (
    SELECT 
      il.id,
      il.project_id,
      il.plant_name,
      il.supplier_id as from_location,
      il.material_id as to_location,
      'inbound'::text as data_source,
      0 as level,
      il.volume as material_consumption_rate,
      1.0::numeric as sourcing_ratio,
      il.volume as weighted,
      true as is_connected,
      1.0::numeric as mapping_confidence
    FROM public.inbound_logistics il
    WHERE il.project_id = p_project_id
  ),
  
  -- Get BOM multi-level data (materials -> components, levels 1-4)  
  bom_data AS (
    SELECT 
      bml.id,
      bml.project_id,
      bml.plant_name,
      bml.material_id as from_location,
      bml.higher_level_component_id as to_location,
      'bom'::text as data_source,
      bml.level,
      bml.consumption_rate as material_consumption_rate,
      1.0::numeric as sourcing_ratio,
      bml.consumption_rate as weighted,
      true as is_connected,
      1.0::numeric as mapping_confidence
    FROM public.bom_multi_level bml
    WHERE bml.project_id = p_project_id
    AND bml.higher_level_component_id IS NOT NULL
  ),
  
  -- Get outbound logistics data (products -> customers, level 5-6)
  outbound_data AS (
    SELECT 
      ol.id,
      ol.project_id,
      ol.plant_name,
      ol.product_id as from_location,
      ol.customer_id as to_location,
      'outbound'::text as data_source,
      5 as level,
      ol.volume as material_consumption_rate,
      1.0::numeric as sourcing_ratio,
      ol.volume as weighted,
      true as is_connected,
      1.0::numeric as mapping_confidence
    FROM public.outbound_logistics ol
    WHERE ol.project_id = p_project_id
  ),
  
  -- Material mapping: Connect inbound materials to BOM materials using fuzzy matching
  material_mapping AS (
    SELECT DISTINCT
      i.to_location as inbound_material,
      b.from_location as bom_material,
      CASE 
        -- Exact match
        WHEN LOWER(TRIM(i.to_location)) = LOWER(TRIM(b.from_location)) THEN 1.0
        -- High similarity (contains or similar)
        WHEN LOWER(TRIM(i.to_location)) LIKE '%' || LOWER(TRIM(b.from_location)) || '%' 
             OR LOWER(TRIM(b.from_location)) LIKE '%' || LOWER(TRIM(i.to_location)) || '%' THEN 0.8
        -- Partial match (first 3+ chars match)
        WHEN LENGTH(TRIM(i.to_location)) >= 3 AND LENGTH(TRIM(b.from_location)) >= 3
             AND LOWER(LEFT(TRIM(i.to_location), 3)) = LOWER(LEFT(TRIM(b.from_location), 3)) THEN 0.6
        ELSE 0.0
      END as confidence
    FROM inbound_data i
    CROSS JOIN bom_data b
    WHERE CASE 
      -- Exact match
      WHEN LOWER(TRIM(i.to_location)) = LOWER(TRIM(b.from_location)) THEN 1.0
      -- High similarity  
      WHEN LOWER(TRIM(i.to_location)) LIKE '%' || LOWER(TRIM(b.from_location)) || '%' 
           OR LOWER(TRIM(b.from_location)) LIKE '%' || LOWER(TRIM(i.to_location)) || '%' THEN 0.8
      -- Partial match
      WHEN LENGTH(TRIM(i.to_location)) >= 3 AND LENGTH(TRIM(b.from_location)) >= 3
           AND LOWER(LEFT(TRIM(i.to_location), 3)) = LOWER(LEFT(TRIM(b.from_location), 3)) THEN 0.6
      ELSE 0.0
    END > 0.5  -- Only include matches with >50% confidence
  ),
  
  -- Create bridging connections between inbound and BOM data
  inbound_bom_bridges AS (
    SELECT 
      gen_random_uuid() as id,
      p_project_id as project_id,
      i.plant_name,
      i.to_location as from_location,  -- inbound material
      mm.bom_material as to_location,   -- BOM material
      'bridge'::text as data_source,
      0 as level,  -- Bridge level
      i.material_consumption_rate,
      1.0::numeric as sourcing_ratio,
      i.weighted,
      true as is_connected,
      mm.confidence as mapping_confidence
    FROM inbound_data i
    JOIN material_mapping mm ON i.to_location = mm.inbound_material
  )
  
  -- Combine all data sources
  SELECT * FROM inbound_data
  UNION ALL
  SELECT * FROM bom_data  
  UNION ALL
  SELECT * FROM outbound_data
  UNION ALL
  SELECT * FROM inbound_bom_bridges;
  
END;
$function$;