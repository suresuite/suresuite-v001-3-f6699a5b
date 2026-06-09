-- Update combine_project_into_supply_chain to compute quantity-only weights
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
    -- Single-level: material -> product
    WITH product_output AS (
      SELECT o.product_id, o.plant_name, COALESCE(SUM(o.volume), 0) AS total_volume
      FROM public.outbound_logistics o
      WHERE o.project_id = p_project_id AND o.product_id IS NOT NULL
      GROUP BY o.product_id, o.plant_name
    )
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
      COALESCE(b.consumption_rate, 0) * COALESCE(po.total_volume, 0)
    FROM public.bom_single_level b
    LEFT JOIN product_output po
      ON po.product_id = b.product_id AND po.plant_name = b.plant_name
    WHERE b.project_id = p_project_id
      AND b.product_id IS NOT NULL
      AND b.material_id IS NOT NULL;
  ELSE
    -- Multi-level BOM: material -> higher_level_component
    -- Compute edge flows as (consumption_rate * parent_required_qty), where
    -- parent_required_qty is derived recursively from product outbound volumes.
    WITH product_output AS (
      SELECT o.product_id, o.plant_name, COALESCE(SUM(o.volume), 0) AS total_volume
      FROM public.outbound_logistics o
      WHERE o.project_id = p_project_id AND o.product_id IS NOT NULL
      GROUP BY o.product_id, o.plant_name
    ),
    edges AS (
      SELECT 
        bm.project_id,
        bm.plant_name,
        bm.higher_level_component_id AS parent_id,
        bm.material_id AS child_id,
        COALESCE(bm.consumption_rate, 0) AS rate
      FROM public.bom_multi_level bm
      WHERE bm.project_id = p_project_id
        AND bm.higher_level_component_id IS NOT NULL
        AND bm.material_id IS NOT NULL
    ),
    RECURSIVE flow AS (
      -- Seed with product total output
      SELECT 
        po.plant_name,
        po.product_id AS node_id,
        po.total_volume AS qty
      FROM product_output po
      UNION ALL
      -- Propagate quantities down the BOM graph (parent -> child)
      SELECT 
        e.plant_name,
        e.child_id AS node_id,
        (e.rate * f.qty) AS qty
      FROM flow f
      JOIN edges e
        ON e.plant_name = f.plant_name
       AND e.parent_id = f.node_id
    ),
    node_qty AS (
      SELECT plant_name, node_id, SUM(qty) AS qty
      FROM flow
      GROUP BY plant_name, node_id
    ),
    edge_flow AS (
      SELECT 
        e.project_id,
        e.plant_name,
        e.child_id,
        e.parent_id,
        e.rate,
        SUM(e.rate * COALESCE(nq.qty, 0)) AS weighted
      FROM edges e
      LEFT JOIN node_qty nq
        ON nq.plant_name = e.plant_name
       AND nq.node_id = e.parent_id
      GROUP BY e.project_id, e.plant_name, e.child_id, e.parent_id, e.rate
    )
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, data_source_group,
      from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
    )
    SELECT
      ef.project_id,
      ef.plant_name,
      'bom',
      'bom',
      ef.child_id,
      ef.parent_id,
      ef.rate,
      NULL,
      COALESCE(ef.weighted, 0)
    FROM edge_flow ef;

    -- Also populate multi-tier helper table as before (weights not required there)
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