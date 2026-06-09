-- Update the combine_project_into_supply_chain function to use plant_name instead of plant
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(p_project_id uuid, p_user_id uuid, p_user_email text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project details and validate access
  SELECT organization, bom_level, modeler_id, plant_name
  INTO v_org, v_bom_level, v_modeler, v_plant
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Clear existing supply chain data for this project
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;

  -- Insert BOM relationships
  IF v_bom_level = 'single' THEN
    INSERT INTO public.supply_chain_data (
      project_id, data_source, plant_name, from_location, to_location, 
      material_consumption_rate, sourcing_ratio, uploaded_by, organization
    )
    SELECT 
      p_project_id,
      'bom',
      b.plant_name,
      b.material_id,
      b.product_id,
      b.consumption_rate,
      1.0, -- Default sourcing ratio for BOM
      p_user_id,
      v_org
    FROM public.bom_single_level b
    WHERE b.project_id = p_project_id;
    
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
  ELSE
    INSERT INTO public.supply_chain_data (
      project_id, data_source, plant_name, from_location, to_location, 
      material_consumption_rate, sourcing_ratio, uploaded_by, organization
    )
    SELECT 
      p_project_id,
      'bom',
      b.plant_name,
      b.material_id,
      COALESCE(b.higher_level_component_id, 'ROOT'),
      b.consumption_rate,
      1.0, -- Default sourcing ratio for BOM
      p_user_id,
      v_org
    FROM public.bom_multi_level b
    WHERE b.project_id = p_project_id;
    
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
  END IF;

  -- Insert inbound logistics (supplier to plant)
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
    NULL, -- No consumption rate for inbound
    CASE WHEN SUM(i.volume) OVER (PARTITION BY i.material_id) > 0 
         THEN i.volume / SUM(i.volume) OVER (PARTITION BY i.material_id)
         ELSE 0 END, -- Calculate sourcing ratio
    i.volume * COALESCE(i.unit_price, 0), -- Weighted by value
    p_user_id,
    v_org
  FROM public.inbound_logistics i
  WHERE i.project_id = p_project_id;

  -- Insert outbound logistics (plant to customer)
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
    NULL, -- No consumption rate for outbound
    CASE WHEN SUM(o.volume) OVER (PARTITION BY o.product_id) > 0 
         THEN o.volume / SUM(o.volume) OVER (PARTITION BY o.product_id)
         ELSE 0 END, -- Calculate sourcing ratio
    o.volume * COALESCE(o.unit_price, 0), -- Weighted by value
    p_user_id,
    v_org
  FROM public.outbound_logistics o
  WHERE o.project_id = p_project_id;

  -- Insert multi-tier supply chain relationships
  INSERT INTO public.supply_chain_data (
    project_id, data_source, plant_name, from_location, to_location, 
    material_consumption_rate, sourcing_ratio, uploaded_by, organization
  )
  SELECT 
    p_project_id,
    'multi_tier',
    m.plant_name,
    m.from_firm_id,
    m.to_firm_id,
    NULL, -- No consumption rate for multi-tier
    1.0, -- Default sourcing ratio
    p_user_id,
    v_org
  FROM public.multi_tier_supply_chain m
  WHERE m.project_id = p_project_id;

  -- Return total count of inserted records
  SELECT COUNT(*) INTO inserted_count 
  FROM public.supply_chain_data 
  WHERE project_id = p_project_id;

  RETURN inserted_count;
END;
$function$;