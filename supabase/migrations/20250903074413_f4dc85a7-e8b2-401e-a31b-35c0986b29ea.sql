
-- 1) Only check BOM + Inbound + Outbound in dataset status
CREATE OR REPLACE FUNCTION public.get_project_dataset_status(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bom_level text;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
BEGIN
  SELECT bom_level INTO v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_bom_level = 'single' THEN
    SELECT EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id)
    INTO has_bom;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id)
    INTO has_bom;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id)
  INTO has_inbound;

  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id)
  INTO has_outbound;

  RETURN jsonb_build_object(
    'bom', has_bom,
    'inbound', has_inbound,
    'outbound', has_outbound
  );
END;
$function$;

-- 2) Trigger helper: set completed = BOM AND Inbound AND Outbound (no multi-tier)
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  has_bom BOOLEAN; 
  has_inbound BOOLEAN; 
  has_outbound BOOLEAN; 
  pid UUID;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);

  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;

  -- Update completion status without multi-tier requirement
  UPDATE public.projects 
  SET completed = (has_bom AND has_inbound AND has_outbound), 
      updated_at = now() 
  WHERE id = pid;

  RETURN NULL;
END;
$function$;

-- 3) RPC variant: same completion logic (no multi-tier)
CREATE OR REPLACE FUNCTION public.update_project_completion_status(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  has_bom boolean := false;
  has_inbound boolean := false;
  has_outbound boolean := false;
  is_complete boolean := false;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project details and validate access
  SELECT organization, bom_level, modeler_id
  INTO v_org, v_bom_level, v_modeler
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

  -- Check BOM dataset based on bom_level
  IF v_bom_level = 'single' THEN
    SELECT EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = p_project_id) INTO has_bom;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = p_project_id) INTO has_bom;
  END IF;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = p_project_id) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = p_project_id) INTO has_outbound;

  -- Determine if project is complete (no multi-tier)
  is_complete := has_bom AND has_inbound AND has_outbound;

  -- Update project completion status
  UPDATE public.projects 
  SET completed = is_complete, updated_at = now()
  WHERE id = p_project_id;

  RETURN is_complete;
END;
$function$;

-- 4) Stop inserting multi-tier data into supply_chain_data during combine
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
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

  -- Return total count of inserted records
  SELECT COUNT(*) INTO inserted_count 
  FROM public.supply_chain_data 
  WHERE project_id = p_project_id;

  RETURN inserted_count;
END;
$function$;
