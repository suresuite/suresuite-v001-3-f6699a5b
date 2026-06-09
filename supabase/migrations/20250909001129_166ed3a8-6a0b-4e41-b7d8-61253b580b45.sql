-- Update combine_project_into_supply_chain function with corrected logic
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
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id INTO v_org, v_modeler
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

  -- Build supply_chain_data (node-to-node "rollup" edges)
  
  -- 1) Outbound (Product → Customer): material_consumption_rate = volume, sourcing_ratio = 1.0
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    o.plant_name,
    'outbound',
    o.product_id,
    o.customer_id,
    COALESCE(o.volume, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(o.volume, 0) as weighted,
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- 2) BOM single-level (Material → Product): weighted = total_outbound_volume * consumption_rate
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    b.product_id,
    COALESCE(b.consumption_rate, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0) as weighted,
    p_user_id,
    v_org
  FROM public.bom_single_level b
  LEFT JOIN (
    SELECT plant_name, product_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, product_id
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name AND b.product_id = outbound_totals.product_id
  WHERE b.project_id = p_project_id;

  -- 3) BOM multi-level (Material → Higher-level component): with material_consumption_rate
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    COALESCE(b.consumption_rate, 0) as material_consumption_rate,
    1.0 as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0) as weighted,
    p_user_id,
    v_org
  FROM public.bom_multi_level b
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name
  WHERE b.project_id = p_project_id;

  -- 4) Inbound (Supplier → Material): sourcing_ratio = volume/total_volume_per_material
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    i.plant_name,
    'inbound',
    i.supplier_id,
    i.material_id,
    COALESCE(i.volume, 0) as material_consumption_rate,
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END as sourcing_ratio,
    COALESCE(outbound_totals.total_volume, 0) * 
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END as weighted,
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  LEFT JOIN (
    SELECT plant_name, material_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.inbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) material_totals ON i.plant_name = material_totals.plant_name AND i.material_id = material_totals.material_id
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON i.plant_name = outbound_totals.plant_name
  WHERE i.project_id = p_project_id;

  -- Build supply_chain_data_multi_tier (path-aware edges with levels)
  
  -- Level 0: Outbound (Product → Customer)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    o.plant_name,
    'outbound',
    o.product_id,
    o.customer_id,
    0,
    o.product_id,
    COALESCE(o.volume, 0),
    1.0,
    COALESCE(o.volume, 0),
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- Level 1: BOM single-level (Material → Product)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    b.product_id,
    1,
    b.product_id,
    COALESCE(b.consumption_rate, 0),
    1.0,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0),
    p_user_id,
    v_org
  FROM public.bom_single_level b
  LEFT JOIN (
    SELECT plant_name, product_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, product_id
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name AND b.product_id = outbound_totals.product_id
  WHERE b.project_id = p_project_id;

  -- Level 2: BOM multi-level (Material → Higher-level component)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    b.plant_name,
    'bom',
    b.material_id,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    2,
    COALESCE(b.higher_level_component_id, 'ROOT'),
    COALESCE(b.consumption_rate, 0),
    1.0,
    COALESCE(outbound_totals.total_volume, 0) * COALESCE(b.consumption_rate, 0),
    p_user_id,
    v_org
  FROM public.bom_multi_level b
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON b.plant_name = outbound_totals.plant_name
  WHERE b.project_id = p_project_id;

  -- Level ≥1: Inbound (Supplier → Material)
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, path_root, material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    i.plant_name,
    'inbound',
    i.supplier_id,
    i.material_id,
    GREATEST(1, COALESCE(bom_levels.max_level, 0) + 1),
    i.material_id,
    COALESCE(i.volume, 0),
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END,
    COALESCE(outbound_totals.total_volume, 0) * 
    CASE 
      WHEN COALESCE(material_totals.total_volume, 0) > 0 THEN 
        COALESCE(i.volume, 0) / material_totals.total_volume
      ELSE 1.0
    END,
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  LEFT JOIN (
    SELECT plant_name, material_id, MAX(level) as max_level
    FROM public.bom_multi_level
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) bom_levels ON i.plant_name = bom_levels.plant_name AND i.material_id = bom_levels.material_id
  LEFT JOIN (
    SELECT plant_name, material_id, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.inbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name, material_id
  ) material_totals ON i.plant_name = material_totals.plant_name AND i.material_id = material_totals.material_id
  LEFT JOIN (
    SELECT plant_name, SUM(COALESCE(volume, 0)) as total_volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
    GROUP BY plant_name
  ) outbound_totals ON i.plant_name = outbound_totals.plant_name
  WHERE i.project_id = p_project_id;

END;
$function$