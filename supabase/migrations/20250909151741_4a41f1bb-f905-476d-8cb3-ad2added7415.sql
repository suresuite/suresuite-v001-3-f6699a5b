-- Fix the integrated process network RPC to properly normalize levels and improve material mapping
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
) AS $$
BEGIN
  -- Ensure RLS helper functions have the caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return multi-tier supply chain data with normalized levels and improved mapping
  RETURN QUERY
  WITH normalized_data AS (
    SELECT
      scd.id,
      scd.project_id,
      scd.plant_name,
      scd.from_location,
      scd.to_location,
      COALESCE(scd.data_source, 'multi_tier') AS data_source,
      -- Normalize levels for proper left-to-right flow:
      -- Inbound (suppliers): 0, BOM levels 1-4, Outbound (customers): 5-6
      CASE 
        WHEN scd.data_source = 'inbound' THEN 0
        WHEN scd.data_source = 'bom' AND scd.level = 4 THEN 1
        WHEN scd.data_source = 'bom' AND scd.level = 3 THEN 2
        WHEN scd.data_source = 'bom' AND scd.level = 2 THEN 3
        WHEN scd.data_source = 'bom' AND scd.level = 1 THEN 4
        WHEN scd.data_source = 'outbound' THEN 5
        ELSE COALESCE(scd.level, 0)
      END AS normalized_level,
      scd.material_consumption_rate,
      scd.sourcing_ratio,
      scd.weighted,
      -- Check if inbound materials connect to BOM materials (fuzzy matching)
      CASE 
        WHEN scd.data_source = 'inbound' THEN
          EXISTS(
            SELECT 1 FROM public.supply_chain_data_multi_tier bom
            WHERE bom.project_id = scd.project_id 
              AND bom.data_source = 'bom'
              AND (
                bom.from_location = scd.to_location 
                OR bom.from_location ILIKE '%' || scd.to_location || '%'
                OR scd.to_location ILIKE '%' || bom.from_location || '%'
              )
          )
        WHEN scd.data_source = 'bom' THEN
          EXISTS(
            SELECT 1 FROM public.supply_chain_data_multi_tier inb
            WHERE inb.project_id = scd.project_id 
              AND inb.data_source = 'inbound'
              AND (
                inb.to_location = scd.from_location 
                OR inb.to_location ILIKE '%' || scd.from_location || '%'
                OR scd.from_location ILIKE '%' || inb.to_location || '%'
              )
          ) AND
          EXISTS(
            SELECT 1 FROM public.supply_chain_data_multi_tier out
            WHERE out.project_id = scd.project_id 
              AND out.data_source = 'outbound'
              AND (
                out.from_location = scd.to_location 
                OR out.from_location ILIKE '%' || scd.to_location || '%'
                OR scd.to_location ILIKE '%' || out.from_location || '%'
              )
          )
        WHEN scd.data_source = 'outbound' THEN
          EXISTS(
            SELECT 1 FROM public.supply_chain_data_multi_tier bom
            WHERE bom.project_id = scd.project_id 
              AND bom.data_source = 'bom'
              AND (
                bom.to_location = scd.from_location 
                OR bom.to_location ILIKE '%' || scd.from_location || '%'
                OR scd.from_location ILIKE '%' || bom.to_location || '%'
              )
          )
        ELSE true
      END AS is_connected,
      -- Calculate mapping confidence based on exact vs fuzzy matches
      CASE 
        WHEN scd.data_source = 'inbound' THEN
          CASE 
            WHEN EXISTS(
              SELECT 1 FROM public.supply_chain_data_multi_tier bom
              WHERE bom.project_id = scd.project_id 
                AND bom.data_source = 'bom'
                AND bom.from_location = scd.to_location
            ) THEN 1.0
            WHEN EXISTS(
              SELECT 1 FROM public.supply_chain_data_multi_tier bom
              WHERE bom.project_id = scd.project_id 
                AND bom.data_source = 'bom'
                AND (
                  bom.from_location ILIKE '%' || scd.to_location || '%'
                  OR scd.to_location ILIKE '%' || bom.from_location || '%'
                )
            ) THEN 0.7
            ELSE 0.0
          END
        ELSE 1.0
      END AS mapping_confidence
    FROM public.supply_chain_data_multi_tier scd
    JOIN public.projects p ON p.id = scd.project_id
    WHERE scd.project_id = p_project_id
      AND p.organization = public.get_current_user_org()
  ),
  -- Add bridge connections where we can infer missing links
  bridge_connections AS (
    SELECT 
      gen_random_uuid() AS id,
      p_project_id AS project_id,
      inb.plant_name,
      inb.to_location AS from_location,
      bom.from_location AS to_location,
      'bridge' AS data_source,
      0 AS normalized_level, -- Bridge at supplier level
      NULL::numeric AS material_consumption_rate,
      NULL::numeric AS sourcing_ratio,
      NULL::numeric AS weighted,
      true AS is_connected,
      0.8::numeric AS mapping_confidence
    FROM public.supply_chain_data_multi_tier inb
    JOIN public.supply_chain_data_multi_tier bom ON (
      bom.project_id = inb.project_id 
      AND bom.data_source = 'bom'
      AND (
        bom.from_location ILIKE '%' || inb.to_location || '%'
        OR inb.to_location ILIKE '%' || bom.from_location || '%'
      )
      AND bom.from_location != inb.to_location -- Only fuzzy matches
    )
    WHERE inb.project_id = p_project_id
      AND inb.data_source = 'inbound'
      -- Only create bridge if no exact match exists
      AND NOT EXISTS(
        SELECT 1 FROM public.supply_chain_data_multi_tier exact
        WHERE exact.project_id = inb.project_id
          AND exact.data_source = 'bom'
          AND exact.from_location = inb.to_location
      )
  )
  -- Combine normalized data with bridge connections
  SELECT 
    nd.id, nd.project_id, nd.plant_name, nd.from_location, nd.to_location,
    nd.data_source, nd.normalized_level, nd.material_consumption_rate,
    nd.sourcing_ratio, nd.weighted, nd.is_connected, nd.mapping_confidence
  FROM normalized_data nd
  
  UNION ALL
  
  SELECT 
    bc.id, bc.project_id, bc.plant_name, bc.from_location, bc.to_location,
    bc.data_source, bc.normalized_level, bc.material_consumption_rate,
    bc.sourcing_ratio, bc.weighted, bc.is_connected, bc.mapping_confidence
  FROM bridge_connections bc
  
  ORDER BY normalized_level NULLS LAST, data_source, from_location;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';