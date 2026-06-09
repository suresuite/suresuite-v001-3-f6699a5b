-- Fix integrated process network RPC to emit proper node records and correct supplier level mapping
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

  -- Use supply_chain_data_multi_tier as the canonical integrated dataset
  WITH scd AS (
    SELECT *
    FROM public.supply_chain_data_multi_tier
    WHERE project_id = p_project_id
  ),
  -- All unique locations appearing either as from or to
  locs AS (
    SELECT from_location AS loc, MIN(plant_name) AS plant_name
    FROM scd
    GROUP BY from_location
    UNION
    SELECT to_location AS loc, MIN(plant_name) AS plant_name
    FROM scd
    GROUP BY to_location
  ),
  -- Derive node attributes from their appearances in edges
  node_features AS (
    SELECT 
      l.loc,
      l.plant_name,
      -- flags to classify node type
      BOOL_OR(s.level = -1 AND s.to_location = l.loc) AS is_customer,
      BOOL_OR(s.level = 0 AND (s.from_location = l.loc OR s.to_location = l.loc)) AS is_product,
      BOOL_OR(s.level = 5 AND s.from_location = l.loc) AS is_supplier_from, -- supplier when it appears as source with level 5
      -- any material level appearances (1..4)
      BOOL_OR(s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)) AS is_material,
      -- compute a representative material level (avg of 1..4 if present)
      CASE 
        WHEN COUNT(*) FILTER (WHERE s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)) > 0
        THEN ROUND(AVG(s.level) FILTER (WHERE s.level BETWEEN 1 AND 4 AND (s.from_location = l.loc OR s.to_location = l.loc)))::int
        ELSE NULL
      END AS material_level
    FROM scd s
    JOIN locs l ON s.from_location = l.loc OR s.to_location = l.loc
    GROUP BY l.loc, l.plant_name
  ),
  -- Normalize node type and level based on priority
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
        WHEN nf.is_supplier_from THEN 6 -- map supplier from level 5 to 6 for leftmost layer
        WHEN nf.is_material AND nf.material_level IS NOT NULL THEN nf.material_level
        WHEN nf.is_material THEN 1
        ELSE 1
      END AS level,
      l.plant_name
    FROM locs l
    JOIN node_features nf ON nf.loc = l.loc
  )

  -- 1) Emit one row per node (connection_type = 'node')
  RETURN QUERY
  SELECT 
    p_project_id AS project_id,
    n.plant_name,
    n.node_id,
    n.node_name,
    n.node_type,
    n.level,
    NULL::text AS from_location,
    NULL::text AS to_location,
    NULL::numeric AS material_consumption_rate,
    NULL::numeric AS weighted,
    'derived'::text AS data_source,
    'node'::text AS connection_type,
    TRUE AS is_connected,
    1.0::numeric AS mapping_confidence
  FROM nodes n

  UNION ALL

  -- 2) Emit edges with connection_type inferred from data_source, and preserve original level
  SELECT 
    s.project_id,
    s.plant_name,
    -- reuse from_location as node_id for compatibility; consumers treat this row as an edge
    s.from_location AS node_id,
    s.from_location AS node_name,
    CASE 
      WHEN s.level = -1 THEN 'customer'
      WHEN s.level = 0 THEN 'product'
      WHEN s.level BETWEEN 1 AND 4 THEN 'material'
      WHEN s.level = 5 THEN 'supplier'
      ELSE 'unknown'
    END AS node_type,
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
    END AS connection_type,
    TRUE AS is_connected,
    1.0::numeric AS mapping_confidence
  FROM scd s
  ORDER BY level, node_id;
END;
$$;