-- Create a function that provides integrated process-level network data including all node types
CREATE OR REPLACE FUNCTION public.get_process_level_integrated_network_data(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS TABLE(
  node_id text,
  node_type text, -- 'supplier', 'material', 'product', 'customer'
  node_level integer, -- BOM level (NULL for suppliers/customers)
  parent_id text,
  consumption_rate numeric,
  flow_volume numeric,
  is_final_product boolean,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return integrated network data combining suppliers, BOM hierarchy, products, and customers
  RETURN QUERY
  WITH 
  -- Get customer demand for final products
  customer_demand AS (
    SELECT 
      o.product_id,
      o.customer_id,
      SUM(COALESCE(o.volume, 0)) as total_demand
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
    GROUP BY o.product_id, o.customer_id
  ),
  
  -- Get supplier supply for materials
  supplier_supply AS (
    SELECT 
      i.material_id,
      i.supplier_id,
      SUM(COALESCE(i.volume, 0)) as total_supply
    FROM public.inbound_logistics i
    WHERE i.project_id = p_project_id
    GROUP BY i.material_id, i.supplier_id
  ),
  
  -- Get BOM hierarchy with propagated demand
  bom_hierarchy AS (
    SELECT 
      bm.material_id,
      bm.higher_level_component_id,
      bm.level,
      bm.consumption_rate,
      -- Calculate demand propagation
      CASE 
        WHEN bm.higher_level_component_id IS NULL THEN -- Final products (Level 0)
          COALESCE(cd.total_demand, 0)
        ELSE 0 -- Will be calculated in recursive part
      END as propagated_demand
    FROM public.bom_multi_level bm
    LEFT JOIN customer_demand cd ON cd.product_id = bm.material_id AND bm.higher_level_component_id IS NULL
    WHERE bm.project_id = p_project_id
  )
  
  -- 1. Suppliers
  SELECT DISTINCT
    ss.supplier_id as node_id,
    'supplier'::text as node_type,
    NULL::integer as node_level,
    NULL::text as parent_id,
    NULL::numeric as consumption_rate,
    ss.total_supply as flow_volume,
    false as is_final_product,
    jsonb_build_object('supply_volume', ss.total_supply) as metadata
  FROM supplier_supply ss
  
  UNION ALL
  
  -- 2. Materials/Components from BOM
  SELECT 
    bh.material_id as node_id,
    'material'::text as node_type,
    bh.level as node_level,
    bh.higher_level_component_id as parent_id,
    bh.consumption_rate,
    bh.propagated_demand * COALESCE(bh.consumption_rate, 1) as flow_volume,
    (bh.higher_level_component_id IS NULL) as is_final_product,
    jsonb_build_object(
      'bom_level', bh.level,
      'consumption_rate', bh.consumption_rate,
      'is_root', (bh.higher_level_component_id IS NULL)
    ) as metadata
  FROM bom_hierarchy bh
  
  UNION ALL
  
  -- 3. Products (final products from BOM that have customer demand)
  SELECT DISTINCT
    cd.product_id as node_id,
    'product'::text as node_type,
    0 as node_level, -- Products are at level 0
    NULL::text as parent_id,
    NULL::numeric as consumption_rate,
    cd.total_demand as flow_volume,
    true as is_final_product,
    jsonb_build_object('customer_demand', cd.total_demand) as metadata
  FROM customer_demand cd
  
  UNION ALL
  
  -- 4. Customers
  SELECT DISTINCT
    cd.customer_id as node_id,
    'customer'::text as node_type,
    NULL::integer as node_level,
    cd.product_id as parent_id, -- Connected to products
    NULL::numeric as consumption_rate,
    cd.total_demand as flow_volume,
    false as is_final_product,
    jsonb_build_object('demand_volume', cd.total_demand) as metadata
  FROM customer_demand cd
  
  UNION ALL
  
  -- 5. Supplier → Material connections
  SELECT DISTINCT
    CONCAT('edge_', ss.supplier_id, '_', ss.material_id) as node_id,
    'edge'::text as node_type,
    NULL::integer as node_level,
    ss.supplier_id as parent_id,
    NULL::numeric as consumption_rate,
    ss.total_supply as flow_volume,
    false as is_final_product,
    jsonb_build_object(
      'edge_type', 'supply',
      'source', ss.supplier_id,
      'target', ss.material_id,
      'volume', ss.total_supply
    ) as metadata
  FROM supplier_supply ss
  
  ORDER BY node_type, node_level NULLS LAST, node_id;
END;
$$;