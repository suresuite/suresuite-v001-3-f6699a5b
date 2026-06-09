-- Enhance multi-tier rebuild: include material_consumption_rate and accurate levels
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (same org AND project owner or admin)
  SELECT organization, modeler_id
    INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Clear previous combined data
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- 1) Aggregated: outbound Product -> Customer (weighted by volume)
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, weighted, uploaded_by, organization
  )
  SELECT 
    o.project_id,
    o.plant_name,
    'outbound',
    'outbound',
    o.product_id,
    o.customer_id,
    COALESCE(o.volume, 0),
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- 2) Aggregated: inbound Supplier -> Material (weighted by inbound volume)
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, weighted, uploaded_by, organization
  )
  SELECT 
    i.project_id,
    i.plant_name,
    'inbound',
    'inbound',
    i.supplier_id,
    i.material_id,
    COALESCE(i.volume, 0),
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  WHERE i.project_id = p_project_id;

  -- 3) Aggregated: Single-level BOM Material -> Product
  -- Weight = consumption_rate * total outbound demand for that product (per plant)
  WITH product_demand AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      SUM(COALESCE(o.volume, 0)) AS demand
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
    GROUP BY o.project_id, o.plant_name, o.product_id
  )
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, material_consumption_rate, weighted, uploaded_by, organization
  )
  SELECT 
    b.project_id,
    b.plant_name,
    'bom',
    'bom',
    b.material_id,
    b.product_id,
    b.consumption_rate,
    COALESCE(pd.demand, 0) * COALESCE(b.consumption_rate, 0),
    p_user_id,
    v_org
  FROM public.bom_single_level b
  JOIN product_demand pd
    ON pd.project_id = b.project_id
   AND pd.plant_name = b.plant_name
   AND pd.product_id = b.product_id
  WHERE b.project_id = p_project_id;

  -- 4) Aggregated: Multi-level BOM via recursion (child -> parent flows)
  -- Seed by total product demand per plant/product across all customers
  WITH RECURSIVE prod_dem AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      SUM(COALESCE(o.volume,0)) AS demand
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
    GROUP BY o.project_id, o.plant_name, o.product_id
  ), bom_expand AS (
    -- Seed: product as parent with required qty equal to demand
    SELECT 
      pd.project_id,
      pd.plant_name,
      pd.product_id AS parent_id,
      NULL::text AS child_id,
      pd.demand AS required_qty,
      0 AS depth
    FROM prod_dem pd

    UNION ALL

    -- Recurse down the BOM (multi-level)
    SELECT 
      bm.project_id,
      bm.plant_name,
      bm.higher_level_component_id AS parent_id,
      bm.material_id AS child_id,
      (COALESCE(r.required_qty,0) * COALESCE(bm.consumption_rate,0)) AS required_qty,
      r.depth + 1 AS depth
    FROM public.bom_multi_level bm
    JOIN bom_expand r
      ON r.project_id = bm.project_id
     AND r.plant_name = bm.plant_name
     AND r.parent_id = bm.higher_level_component_id
    WHERE bm.project_id = p_project_id
      AND r.depth < 50
  ), flows AS (
    SELECT 
      project_id,
      plant_name,
      child_id,
      parent_id,
      SUM(required_qty) AS flow
    FROM bom_expand
    WHERE child_id IS NOT NULL AND parent_id IS NOT NULL
    GROUP BY project_id, plant_name, child_id, parent_id
  )
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, weighted, uploaded_by, organization
  )
  SELECT 
    f.project_id,
    f.plant_name,
    'bom',
    'bom',
    f.child_id,
    f.parent_id,
    f.flow,
    p_user_id,
    v_org
  FROM flows f
  WHERE f.project_id = p_project_id;

  -- =======================
  -- Build multi-tier path-level data
  -- =======================

  -- 5) Product -> Customer edges (level 0)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source,
    from_location, to_location, weighted, level, path_root, organization, uploaded_by
  )
  SELECT 
    o.project_id,
    o.plant_name,
    'outbound',
    o.product_id,
    o.customer_id,
    COALESCE(o.volume,0) AS weighted,
    0 AS level,
    (o.product_id || '::' || o.customer_id) AS path_root,
    v_org,
    p_user_id
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- 6) Single-level BOM edges per product-customer pair (level 1)
  WITH shares AS (
    SELECT 
      i.project_id,
      i.plant_name,
      i.material_id,
      i.supplier_id,
      COALESCE(i.volume,0) AS vol,
      SUM(COALESCE(i.volume,0)) OVER (
        PARTITION BY i.project_id, i.plant_name, i.material_id
      ) AS total_vol
    FROM public.inbound_logistics i
    WHERE i.project_id = p_project_id
  ), share_calc AS (
    SELECT 
      s.project_id,
      s.plant_name,
      s.material_id,
      s.supplier_id,
      CASE WHEN s.total_vol > 0 THEN s.vol / s.total_vol ELSE 0 END AS share
    FROM shares s
  ), outbound_pairs AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      o.customer_id,
      COALESCE(o.volume,0) AS demand,
      (o.product_id || '::' || o.customer_id) AS path_root
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source,
    from_location, to_location, material_consumption_rate, weighted, level, path_root, organization, uploaded_by
  )
  SELECT 
    b.project_id,
    b.plant_name,
    'bom',
    b.material_id,
    b.product_id,
    b.consumption_rate,
    (op.demand * COALESCE(b.consumption_rate,0)) AS weighted,
    1 AS level,
    op.path_root,
    v_org,
    p_user_id
  FROM outbound_pairs op
  JOIN public.bom_single_level b
    ON b.project_id = op.project_id
   AND b.plant_name = op.plant_name
   AND b.product_id = op.product_id;

  -- 7) Supplier -> Material per single-level pair (level 2)
  WITH shares AS (
    SELECT 
      i.project_id,
      i.plant_name,
      i.material_id,
      i.supplier_id,
      COALESCE(i.volume,0) AS vol,
      SUM(COALESCE(i.volume,0)) OVER (
        PARTITION BY i.project_id, i.plant_name, i.material_id
      ) AS total_vol
    FROM public.inbound_logistics i
    WHERE i.project_id = p_project_id
  ), share_calc AS (
    SELECT 
      s.project_id,
      s.plant_name,
      s.material_id,
      s.supplier_id,
      CASE WHEN s.total_vol > 0 THEN s.vol / s.total_vol ELSE 0 END AS share
    FROM shares s
  ), outbound_pairs AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      o.customer_id,
      COALESCE(o.volume,0) AS demand,
      (o.product_id || '::' || o.customer_id) AS path_root
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source,
    from_location, to_location, sourcing_ratio, weighted, level, path_root, organization, uploaded_by
  )
  SELECT 
    sc.project_id,
    sc.plant_name,
    'inbound',
    sc.supplier_id,
    b.material_id,
    sc.share,
    (op.demand * COALESCE(b.consumption_rate,0) * sc.share) AS weighted,
    2 AS level,
    op.path_root,
    v_org,
    p_user_id
  FROM outbound_pairs op
  JOIN public.bom_single_level b
    ON b.project_id = op.project_id
   AND b.plant_name = op.plant_name
   AND b.product_id = op.product_id
  JOIN share_calc sc
    ON sc.project_id = b.project_id
   AND sc.plant_name = b.plant_name
   AND sc.material_id = b.material_id;

  -- 8a) Multi-level BOM per product-customer pair (levels >= 1) - BOM edges per path with consumption_rate and level
  WITH RECURSIVE op AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      o.customer_id,
      COALESCE(o.volume,0) AS demand,
      (o.product_id || '::' || o.customer_id) AS path_root
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
  ), rec AS (
    -- seed as parent node at depth 0 with required qty = customer demand for product
    SELECT 
      op.project_id,
      op.plant_name,
      op.product_id AS parent_id,
      NULL::text AS child_id,
      op.customer_id,
      op.demand AS required_qty,
      op.path_root,
      0 AS depth
    FROM op

    UNION ALL

    SELECT 
      bm.project_id,
      bm.plant_name,
      bm.higher_level_component_id AS parent_id,
      bm.material_id AS child_id,
      r.customer_id,
      (COALESCE(r.required_qty,0) * COALESCE(bm.consumption_rate,0)) AS required_qty,
      r.path_root,
      r.depth + 1 AS depth
    FROM public.bom_multi_level bm
    JOIN rec r
      ON r.project_id = bm.project_id
     AND r.plant_name = bm.plant_name
     AND r.parent_id = bm.higher_level_component_id
    WHERE r.depth < 50
  ), bom_edges AS (
    SELECT 
      project_id,
      plant_name,
      child_id,
      parent_id,
      path_root,
      SUM(required_qty) AS flow
    FROM rec
    WHERE child_id IS NOT NULL AND parent_id IS NOT NULL
    GROUP BY project_id, plant_name, child_id, parent_id, path_root
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source,
    from_location, to_location, material_consumption_rate, weighted, level, path_root, organization, uploaded_by
  )
  SELECT 
    be.project_id,
    be.plant_name,
    'bom',
    be.child_id,
    be.parent_id,
    bm.consumption_rate,
    be.flow,
    bm.level,
    be.path_root,
    v_org,
    p_user_id
  FROM bom_edges be
  JOIN public.bom_multi_level bm
    ON bm.project_id = be.project_id
   AND bm.plant_name = be.plant_name
   AND bm.material_id = be.child_id
   AND bm.higher_level_component_id = be.parent_id;

  -- 8b) Supplier -> Material edges per path using inbound shares; level = bom level + 1 (or depth+1 fallback)
  WITH RECURSIVE op AS (
    SELECT 
      o.project_id,
      o.plant_name,
      o.product_id,
      o.customer_id,
      COALESCE(o.volume,0) AS demand,
      (o.product_id || '::' || o.customer_id) AS path_root
    FROM public.outbound_logistics o
    WHERE o.project_id = p_project_id
  ), rec AS (
    SELECT 
      op.project_id,
      op.plant_name,
      op.product_id AS parent_id,
      NULL::text AS child_id,
      op.customer_id,
      op.demand AS required_qty,
      op.path_root,
      0 AS depth
    FROM op

    UNION ALL

    SELECT 
      bm.project_id,
      bm.plant_name,
      bm.higher_level_component_id AS parent_id,
      bm.material_id AS child_id,
      r.customer_id,
      (COALESCE(r.required_qty,0) * COALESCE(bm.consumption_rate,0)) AS required_qty,
      r.path_root,
      r.depth + 1 AS depth
    FROM public.bom_multi_level bm
    JOIN rec r
      ON r.project_id = bm.project_id
     AND r.plant_name = bm.plant_name
     AND r.parent_id = bm.higher_level_component_id
    WHERE r.depth < 50
  ), bom_edges AS (
    SELECT 
      project_id,
      plant_name,
      child_id,
      parent_id,
      path_root,
      SUM(required_qty) AS flow
    FROM rec
    WHERE child_id IS NOT NULL AND parent_id IS NOT NULL
    GROUP BY project_id, plant_name, child_id, parent_id, path_root
  ), child_levels AS (
    SELECT 
      project_id,
      plant_name,
      child_id,
      parent_id,
      path_root,
      MIN(depth) AS min_depth
    FROM rec
    WHERE child_id IS NOT NULL AND parent_id IS NOT NULL
    GROUP BY project_id, plant_name, child_id, parent_id, path_root
  ), shares AS (
    SELECT 
      i.project_id,
      i.plant_name,
      i.material_id,
      i.supplier_id,
      COALESCE(i.volume,0) AS vol,
      SUM(COALESCE(i.volume,0)) OVER (
        PARTITION BY i.project_id, i.plant_name, i.material_id
      ) AS total_vol
    FROM public.inbound_logistics i
    WHERE i.project_id = p_project_id
  ), share_calc AS (
    SELECT 
      s.project_id,
      s.plant_name,
      s.material_id,
      s.supplier_id,
      CASE WHEN s.total_vol > 0 THEN s.vol / s.total_vol ELSE 0 END AS share
    FROM shares s
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source,
    from_location, to_location, sourcing_ratio, weighted, level, path_root, organization, uploaded_by
  )
  SELECT 
    sc.project_id,
    sc.plant_name,
    'inbound',
    sc.supplier_id,
    be.child_id,
    sc.share,
    (be.flow * sc.share) AS weighted,
    COALESCE(bm.level + 1, cl.min_depth + 1, 2) AS level,
    be.path_root,
    v_org,
    p_user_id
  FROM bom_edges be
  JOIN share_calc sc
    ON sc.project_id = be.project_id
   AND sc.plant_name = be.plant_name
   AND sc.material_id = be.child_id
  LEFT JOIN public.bom_multi_level bm
    ON bm.project_id = be.project_id
   AND bm.plant_name = be.plant_name
   AND bm.material_id = be.child_id
   AND bm.higher_level_component_id = be.parent_id
  LEFT JOIN child_levels cl
    ON cl.project_id = be.project_id
   AND cl.plant_name = be.plant_name
   AND cl.child_id = be.child_id
   AND cl.parent_id = be.parent_id
   AND cl.path_root = be.path_root;

END;
$$;