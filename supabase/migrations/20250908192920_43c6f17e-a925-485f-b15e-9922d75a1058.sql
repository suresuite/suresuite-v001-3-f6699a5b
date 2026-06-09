-- Drop and recreate combine_project_into_supply_chain to fix SQL syntax error
BEGIN;

DROP FUNCTION IF EXISTS public.combine_project_into_supply_chain(uuid, uuid, text);

CREATE FUNCTION public.combine_project_into_supply_chain(
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

  -- Insert inbound logistics: supplier -> material
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
  )
  SELECT
    i.project_id, i.plant_name, 'inbound', 'logistics',
    i.supplier_id, i.material_id, NULL, NULL, NULL
  FROM public.inbound_logistics i
  WHERE i.project_id = p_project_id;

  -- Insert outbound logistics: product -> customer
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
  )
  SELECT
    o.project_id, o.plant_name, 'outbound', 'logistics',
    o.product_id, o.customer_id, NULL, NULL, NULL
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- Insert BOM relations based on level
  IF v_bom_level = 'single' THEN
    -- Single-level: material -> product
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, data_source_group,
      from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
    )
    SELECT
      b.project_id, b.plant_name, 'bom', 'bom',
      b.material_id, b.product_id, b.consumption_rate, NULL, NULL
    FROM public.bom_single_level b
    WHERE b.project_id = p_project_id;
  ELSE
    -- Multi-level: material -> higher_level_component
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, data_source_group,
      from_location, to_location, material_consumption_rate, sourcing_ratio, weighted
    )
    SELECT
      bm.project_id, bm.plant_name, 'bom', 'bom',
      bm.material_id, bm.higher_level_component_id, bm.consumption_rate, NULL, NULL
    FROM public.bom_multi_level bm
    WHERE bm.project_id = p_project_id;

    -- Also populate multi-tier table with level and path information
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
    WHERE bm.project_id = p_project_id;
  END IF;

END;
$$;

COMMIT;