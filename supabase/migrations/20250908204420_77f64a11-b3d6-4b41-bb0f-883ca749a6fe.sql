-- Enhance combine_project_into_supply_chain to propagate outbound demand through multi-level BOM using recursive CTE
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_bom_level text;
  v_plant text;
BEGIN
  -- Ensure RLS helper functions use caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and fetch config
  SELECT organization, plant_name, bom_level
    INTO v_org, v_plant, v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Clear previous combined data for this project
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- Inbound logistics: supplier -> material, weighted by volume only
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
  )
  SELECT
    i.project_id, i.plant_name, 'inbound', 'logistics',
    i.supplier_id, i.material_id, NULL, NULL, COALESCE(i.volume, 0)
  FROM public.inbound_logistics i
  WHERE i.project_id = p_project_id
    AND i.supplier_id IS NOT NULL
    AND i.material_id IS NOT NULL;

  -- Outbound logistics: product -> customer, weighted by volume only
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
  )
  SELECT
    o.project_id, o.plant_name, 'outbound', 'logistics',
    o.product_id, o.customer_id, NULL, NULL, COALESCE(o.volume, 0)
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id
    AND o.product_id IS NOT NULL
    AND o.customer_id IS NOT NULL;

  -- BOM relations
  IF v_bom_level = 'single' THEN
    -- Single-level: material -> product; weight = consumption_rate * total outbound volume of product at the plant
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, data_source_group,
      from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
    )
    SELECT
      b.project_id,
      b.plant_name,
      'bom',
      'bom',
      b.material_id,
      b.product_id,
      b.consumption_rate,
      NULL,
      COALESCE(b.consumption_rate, 0) * COALESCE(
        (SELECT SUM(o.volume)
         FROM public.outbound_logistics o 
         WHERE o.project_id = b.project_id 
           AND o.product_id = b.product_id 
           AND o.plant_name = b.plant_name), 
        0
      )
    FROM public.bom_single_level b
    WHERE b.project_id = p_project_id
      AND b.product_id IS NOT NULL
      AND b.material_id IS NOT NULL;
  ELSE
    -- Multi-level BOM: propagate outbound product demand down the BOM hierarchy using a recursive CTE
    WITH product_demand AS (
      SELECT o.plant_name, o.product_id AS item_id, SUM(COALESCE(o.volume,0)) AS demand
      FROM public.outbound_logistics o
      WHERE o.project_id = p_project_id
      GROUP BY o.plant_name, o.product_id
    ),
    bom AS (
      SELECT bm.plant_name, bm.higher_level_component_id AS parent, bm.material_id AS child, COALESCE(bm.consumption_rate,0) AS cons_rate
      FROM public.bom_multi_level bm
      WHERE bm.project_id = p_project_id
    ),
    rec AS (
      -- Start from demanded products; depth 0
      SELECT s.plant_name, s.item_id AS node, s.demand::numeric AS required_qty, NULL::text AS parent_node, NULL::text AS child_node, NULL::numeric AS edge_flow, 0 AS depth
      FROM product_demand s
      UNION ALL
      -- For each parent node, compute child requirement and record the edge flow
      SELECT r.plant_name,
             b.child AS node,
             r.required_qty * b.cons_rate AS required_qty,
             b.parent AS parent_node,
             b.child AS child_node,
             r.required_qty * b.cons_rate AS edge_flow,
             r.depth + 1 AS depth
      FROM rec r
      JOIN bom b ON b.parent = r.node AND b.plant_name = r.plant_name
      WHERE r.depth < 50 -- guard against accidental cycles
    ),
    edge_agg AS (
      SELECT plant_name, parent_node AS parent, child_node AS child, SUM(edge_flow) AS total_flow
      FROM rec
      WHERE parent_node IS NOT NULL AND child_node IS NOT NULL
      GROUP BY plant_name, parent, child
    )
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, data_source_group,
      from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
    )
    SELECT
      p_project_id,
      e.plant_name,
      'bom',
      'bom',
      e.child,
      e.parent,
      bm.consumption_rate,
      NULL,
      COALESCE(e.total_flow, 0)
    FROM edge_agg e
    JOIN public.bom_multi_level bm
      ON bm.project_id = p_project_id
     AND bm.plant_name = e.plant_name
     AND bm.material_id = e.child
     AND bm.higher_level_component_id = e.parent;

    -- Also populate multi-tier helper table for analytics/visualization consistency
    INSERT INTO public.supply_chain_data_multi_tier (
      project_id, plant_name, data_source,
      from_location, to_location, material_consumption_rate, 
      sourcing_ratio, weighted, level, path_root
    )
    SELECT
      bm.project_id, bm.plant_name, 'bom',
      bm.material_id, bm.higher_level_component_id, bm.consumption_rate,
      NULL, NULL, bm.level,
      CASE WHEN bm.level = 1 THEN bm.higher_level_component_id ELSE NULL END
    FROM public.bom_multi_level bm
    WHERE bm.project_id = p_project_id
      AND bm.higher_level_component_id IS NOT NULL
      AND bm.material_id IS NOT NULL;
  END IF;

END;
$$;