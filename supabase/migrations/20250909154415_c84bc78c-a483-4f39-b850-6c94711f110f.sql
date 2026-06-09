-- Drop and recreate the function with correct BOM level mapping
DROP FUNCTION IF EXISTS public.get_integrated_process_network_data(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  material_id text,
  higher_level_component_id text,
  level integer,
  consumption_rate numeric,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  node_type text,
  visualization_level integer,
  from_location text,
  to_location text,
  sourcing_ratio numeric,
  weighted numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  RETURN QUERY
  WITH bom_levels AS (
    -- Get BOM levels from bom_multi_level table and map to visualization levels 1-5
    SELECT 
      bml.material_id as node_id,
      bml.level as bom_level,
      (bml.level + 1) as vis_level, -- Map BOM levels 0-4 to visualization levels 1-5
      'material' as node_type_calc
    FROM public.bom_multi_level bml
    WHERE bml.project_id = p_project_id
  ),
  all_nodes AS (
    -- Combine all nodes from supply chain data with proper level assignment
    SELECT DISTINCT
      gen_random_uuid() as node_id,
      scd.project_id,
      scd.plant_name,
      scd.from_location as material_id,
      NULL::text as higher_level_component_id,
      COALESCE(bl.bom_level, 
        CASE 
          WHEN scd.data_source = 'inbound' THEN -1  -- Suppliers get level -1, will map to 0
          WHEN scd.data_source = 'outbound' AND scd.from_location NOT IN (
            SELECT material_id FROM bom_multi_level WHERE project_id = p_project_id
          ) THEN 4  -- Products that aren't in BOM get level 4, will map to 5
          ELSE 0
        END
      ) as level,
      scd.material_consumption_rate as consumption_rate,
      scd.created_at,
      scd.updated_at,
      CASE
        WHEN scd.data_source = 'inbound' THEN 'supplier'
        WHEN scd.data_source = 'outbound' AND scd.from_location NOT IN (
          SELECT material_id FROM bom_multi_level WHERE project_id = p_project_id
        ) THEN 'product'
        ELSE COALESCE(bl.node_type_calc, 'material')
      END as node_type,
      CASE
        WHEN scd.data_source = 'inbound' THEN 0  -- Suppliers at level 0
        WHEN scd.data_source = 'outbound' AND scd.from_location NOT IN (
          SELECT material_id FROM bom_multi_level WHERE project_id = p_project_id
        ) THEN 5  -- Products at level 5
        ELSE COALESCE(bl.vis_level, 1)
      END as visualization_level,
      scd.from_location,
      scd.to_location,
      scd.sourcing_ratio,
      scd.weighted
    FROM public.supply_chain_data scd
    LEFT JOIN bom_levels bl ON bl.node_id = scd.from_location
    WHERE scd.project_id = p_project_id

    UNION

    SELECT DISTINCT
      gen_random_uuid() as node_id,
      scd.project_id,
      scd.plant_name,
      scd.to_location as material_id,
      NULL::text as higher_level_component_id,
      COALESCE(bl.bom_level,
        CASE 
          WHEN scd.data_source = 'inbound' THEN 0  -- Materials receiving from suppliers
          WHEN scd.data_source = 'outbound' THEN 5  -- Customers get level 5, will map to 6
          ELSE 0
        END
      ) as level,
      scd.material_consumption_rate as consumption_rate,
      scd.created_at,
      scd.updated_at,
      CASE
        WHEN scd.data_source = 'outbound' THEN 'customer'
        WHEN scd.data_source = 'inbound' THEN COALESCE(bl.node_type_calc, 'material')
        ELSE COALESCE(bl.node_type_calc, 'material')
      END as node_type,
      CASE
        WHEN scd.data_source = 'outbound' THEN 6  -- Customers at level 6
        WHEN scd.data_source = 'inbound' THEN COALESCE(bl.vis_level, 1)
        ELSE COALESCE(bl.vis_level, 1)
      END as visualization_level,
      scd.from_location,
      scd.to_location,
      scd.sourcing_ratio,
      scd.weighted
    FROM public.supply_chain_data scd
    LEFT JOIN bom_levels bl ON bl.node_id = scd.to_location
    WHERE scd.project_id = p_project_id
      AND scd.to_location NOT IN (
        SELECT from_location FROM public.supply_chain_data 
        WHERE project_id = p_project_id AND from_location IS NOT NULL
      )  -- Only include to_locations that aren't already from_locations
  ),
  bom_nodes AS (
    -- Add BOM hierarchy nodes with proper connections
    SELECT
      bml.id as node_id,
      bml.project_id,
      bml.plant_name,
      bml.material_id,
      bml.higher_level_component_id,
      bml.level,
      bml.consumption_rate,
      bml.created_at,
      bml.updated_at,
      'material' as node_type,
      (bml.level + 1) as visualization_level,
      bml.material_id as from_location,
      bml.higher_level_component_id as to_location,
      NULL::numeric as sourcing_ratio,
      bml.consumption_rate as weighted
    FROM public.bom_multi_level bml
    WHERE bml.project_id = p_project_id
      AND bml.higher_level_component_id IS NOT NULL
  )
  
  -- Return unified results
  SELECT 
    an.node_id,
    an.project_id,
    an.plant_name,
    an.material_id,
    an.higher_level_component_id,
    an.level,
    an.consumption_rate,
    an.created_at,
    an.updated_at,
    an.node_type,
    an.visualization_level,
    an.from_location,
    an.to_location,
    an.sourcing_ratio,
    an.weighted
  FROM all_nodes an
  
  UNION ALL
  
  SELECT 
    bn.node_id,
    bn.project_id,
    bn.plant_name,
    bn.material_id,
    bn.higher_level_component_id,
    bn.level,
    bn.consumption_rate,
    bn.created_at,
    bn.updated_at,
    bn.node_type,
    bn.visualization_level,
    bn.from_location,
    bn.to_location,
    bn.sourcing_ratio,
    bn.weighted
  FROM bom_nodes bn
  
  ORDER BY visualization_level, material_id;
END;
$function$;