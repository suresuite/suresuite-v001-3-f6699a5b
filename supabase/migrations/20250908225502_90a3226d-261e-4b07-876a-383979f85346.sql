-- Update combine_project_into_supply_chain function with correct logic
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(p_project_id uuid, p_user_id uuid, p_user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_bom_level text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id, bom_level INTO v_org, v_modeler, v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Clear existing combined data for this project
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- 1. Process Outbound data (Product → Customer)
  WITH outbound_totals AS (
    SELECT 
      plant_name,
      product_id,
      SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics 
    WHERE project_id = p_project_id
    GROUP BY plant_name, product_id
  )
  INSERT INTO public.supply_chain_data (
    project_id, data_source, plant_name, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    'outbound',
    o.plant_name,
    o.product_id,
    o.customer_id,
    COALESCE(o.volume, 0),
    1.0,
    ot.total_volume,
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  JOIN outbound_totals ot ON (o.plant_name = ot.plant_name AND o.product_id = ot.product_id)
  WHERE o.project_id = p_project_id;

  -- 2. Process BOM data based on level
  IF v_bom_level = 'single' THEN
    -- Single-level BOM (Material → Product)
    WITH product_totals AS (
      SELECT 
        plant_name,
        product_id,
        SUM(COALESCE(volume, 0)) as total_volume
      FROM public.outbound_logistics 
      WHERE project_id = p_project_id
      GROUP BY plant_name, product_id
    )
    INSERT INTO public.supply_chain_data (
      project_id, data_source, plant_name, from_location, to_location,
      material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
    )
    SELECT 
      p_project_id,
      'bom',
      b.plant_name,
      b.material_id,
      b.product_id,
      COALESCE(b.consumption_rate, 0),
      1.0,
      COALESCE(pt.total_volume * b.consumption_rate, 0),
      p_user_id,
      v_org
    FROM public.bom_single_level b
    LEFT JOIN product_totals pt ON (b.plant_name = pt.plant_name AND b.product_id = pt.product_id)
    WHERE b.project_id = p_project_id;
  ELSE
    -- Multi-level BOM (Material → Higher-level component)
    WITH product_totals AS (
      SELECT 
        plant_name,
        product_id,
        SUM(COALESCE(volume, 0)) as total_volume
      FROM public.outbound_logistics 
      WHERE project_id = p_project_id
      GROUP BY plant_name, product_id
    )
    INSERT INTO public.supply_chain_data (
      project_id, data_source, plant_name, from_location, to_location,
      material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
    )
    SELECT 
      p_project_id,
      'bom',
      b.plant_name,
      b.material_id,
      COALESCE(b.higher_level_component_id, 'ROOT'),
      COALESCE(b.consumption_rate, 0),
      1.0,
      COALESCE(pt.total_volume * b.consumption_rate, 0),
      p_user_id,
      v_org
    FROM public.bom_multi_level b
    LEFT JOIN product_totals pt ON (b.plant_name = pt.plant_name)
    WHERE b.project_id = p_project_id;
  END IF;

  -- 3. Process Inbound data (Supplier → Material)
  WITH inbound_shares AS (
    SELECT 
      i.plant_name,
      i.material_id,
      i.supplier_id,
      i.volume,
      COALESCE(i.volume, 0) / NULLIF(SUM(COALESCE(i.volume, 0)) OVER (PARTITION BY i.plant_name, i.material_id), 0) AS share
    FROM public.inbound_logistics i
    WHERE i.project_id = p_project_id
  ),
  material_demand AS (
    SELECT 
      scd.plant_name,
      scd.to_location as material_id,
      SUM(COALESCE(scd.weighted, 0)) as total_demand
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id 
      AND scd.data_source = 'bom'
    GROUP BY scd.plant_name, scd.to_location
  )
  INSERT INTO public.supply_chain_data (
    project_id, data_source, plant_name, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    'inbound',
    i.plant_name,
    i.supplier_id,
    i.material_id,
    COALESCE(i.volume, 0),
    COALESCE(i.share, 0),
    COALESCE(md.total_demand * i.share, 0),
    p_user_id,
    v_org
  FROM inbound_shares i
  LEFT JOIN material_demand md ON (i.plant_name = md.plant_name AND i.material_id = md.material_id);

  -- 4. Build multi-tier supply chain paths
  WITH RECURSIVE supply_paths AS (
    -- Start from outbound (products to customers)
    SELECT 
      project_id,
      plant_name,
      from_location,
      to_location,
      material_consumption_rate,
      sourcing_ratio,
      weighted,
      data_source,
      from_location as path_root,
      1 as level
    FROM public.supply_chain_data scd1
    WHERE scd1.project_id = p_project_id
      AND scd1.data_source = 'outbound'

    UNION ALL

    -- Recursively expand through BOM and inbound
    SELECT 
      scd2.project_id,
      scd2.plant_name,
      scd2.from_location,
      scd2.to_location,
      scd2.material_consumption_rate,
      scd2.sourcing_ratio,
      scd2.weighted,
      scd2.data_source,
      sp.path_root,
      sp.level + 1
    FROM public.supply_chain_data scd2
    INNER JOIN supply_paths sp ON (
      scd2.to_location = sp.from_location 
      AND scd2.project_id = sp.project_id
      AND scd2.plant_name = sp.plant_name
    )
    WHERE scd2.data_source IN ('bom', 'inbound')
      AND sp.level < 10  -- Prevent infinite recursion
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted,
    data_source, path_root, level, uploaded_by, organization
  )
  SELECT 
    project_id,
    plant_name,
    from_location,
    to_location,
    material_consumption_rate,
    sourcing_ratio,
    weighted,
    data_source,
    path_root,
    level,
    p_user_id,
    v_org
  FROM supply_paths;

END;
$function$;