-- Fix integrated process network RPC with correct SQL syntax
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
  -- Ensure RLS helper functions use caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return node records (connection_type = 'node') followed by edge records
  RETURN QUERY
  WITH scd AS (
    SELECT *
    FROM public.supply_chain_data_multi_tier
    WHERE project_id = p_project_id
  ),
  locs AS (
    SELECT from_location AS loc, MIN(plant_name) AS plant_name
    FROM scd
    GROUP BY from_location
    UNION
    SELECT to_location AS loc, MIN(plant_name) AS plant_name
    FROM scd
    GROUP BY to_location
  ),
  node_features AS (
    SELECT 
      l.loc,
      l.plant_name,
      BOOL_OR(s.level = -1 AND s.to_location = l.loc) AS is_customer,
      BOOL_OR(s.level = 0 AND (s.from_location = l.loc OR s.to_location = l.loc)) AS is_product,
      BOOL_OR(s.level = 5 AND s.from_location = l.loc) AS is_supplier_from,
      BOOL_OR(s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)) AS is_material,
      CASE 
        WHEN COUNT(*) FILTER (WHERE s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)) > 0
        THEN ROUND(AVG(s.level) FILTER (WHERE s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)))::int
        ELSE NULL
      END AS material_level
    FROM scd s
    JOIN locs l ON s.from_location = l.loc OR s.to_location = l.loc
    GROUP BY l.loc, l.plant_name
  ),
  nodes AS (
    SELECT 
      l.loc AS node_id,
      l.loc AS node_name,
      CASE 
        WHEN nf.is_customer THEN 'customer'
        WHEN nf.is_product THEN 'product'
        WHEN nf.is_supplier_from THEN 'supplier'
        WHEN nf.is_material THEN 'material'
        ELSE 'material'
      END AS node_type,
      CASE 
        WHEN nf.is_customer THEN -1
        WHEN nf.is_product THEN 0
        WHEN nf.is_supplier_from THEN 6
        WHEN nf.is_material AND nf.material_level IS NOT NULL THEN nf.material_level
        WHEN nf.is_material THEN 1
        ELSE 1
      END AS level,
      l.plant_name
    FROM locs l
    JOIN node_features nf ON nf.loc = l.loc
  )
  -- Node records
  SELECT 
    p_project_id,
    n.plant_name,
    n.node_id,
    n.node_name,
    n.node_type,
    n.level,
    NULL::text,
    NULL::text,
    NULL::numeric,
    NULL::numeric,
    'derived'::text,
    'node'::text,
    TRUE,
    1.0::numeric
  FROM nodes n

  UNION ALL

  -- Edge records  
  SELECT 
    s.project_id,
    s.plant_name,
    s.from_location,
    s.from_location,
    CASE 
      WHEN s.level = -1 THEN 'customer'
      WHEN s.level = 0 THEN 'product'
      WHEN s.level BETWEEN 1 AND 4 THEN 'material'
      WHEN s.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END,
    s.level,
    s.from_location,
    s.to_location,
    s.material_consumption_rate,
    s.weighted,
    s.data_source,
    CASE 
      WHEN s.level = -1 THEN 'customer_connection'
      WHEN lower(s.data_source) = 'inbound' THEN 'inbound'
      WHEN lower(s.data_source) = 'bom' THEN 'bom'
      WHEN lower(s.data_source) = 'outbound' THEN 'outbound'
      ELSE 'edge'
    END,
    TRUE,
    1.0::numeric
  FROM scd s
  ORDER BY level, node_id;
END;
$$;