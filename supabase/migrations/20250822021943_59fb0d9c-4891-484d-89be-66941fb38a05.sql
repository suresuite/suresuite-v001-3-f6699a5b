-- Add new columns to supply_chain_data table
ALTER TABLE public.supply_chain_data 
ADD COLUMN project_id uuid,
ADD COLUMN data_source text,
ADD COLUMN data_source_group text;

-- Add foreign key constraint for project_id
ALTER TABLE public.supply_chain_data
ADD CONSTRAINT fk_supply_chain_data_project_id 
FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- Create index for better performance
CREATE INDEX idx_supply_chain_data_project_id ON public.supply_chain_data(project_id);
CREATE INDEX idx_supply_chain_data_data_source ON public.supply_chain_data(data_source);

-- Drop existing RLS policies
DROP POLICY IF EXISTS "Users can update their own or org admin can update all" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Organization users can view supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Organization users can insert supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can delete their own or org admin can delete all" ON public.supply_chain_data;

-- Create new project-based RLS policies
CREATE POLICY "Supply chain data: project access view" 
ON public.supply_chain_data 
FOR SELECT 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND p.organization = get_current_user_org()
  )
);

CREATE POLICY "Supply chain data: project access insert" 
ON public.supply_chain_data 
FOR INSERT 
WITH CHECK (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND p.organization = get_current_user_org()
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

CREATE POLICY "Supply chain data: project access update" 
ON public.supply_chain_data 
FOR UPDATE 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND p.organization = get_current_user_org()
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

CREATE POLICY "Supply chain data: project access delete" 
ON public.supply_chain_data 
FOR DELETE 
USING (
  EXISTS(
    SELECT 1 FROM public.projects p 
    WHERE p.id = supply_chain_data.project_id 
    AND p.organization = get_current_user_org()
    AND (p.modeler_id = get_current_user_id() OR (SELECT get_current_approved_user.user_role FROM get_current_approved_user() get_current_approved_user(user_id, user_email, user_role) LIMIT 1) = 'admin')
  )
);

-- Create the ETL function to combine project data into supply_chain_data
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
      project_id, data_source, plant, from_location, to_location, 
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
      project_id, data_source, plant, from_location, to_location, 
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
    project_id, data_source, plant, from_location, to_location, 
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
    project_id, data_source, plant, from_location, to_location, 
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
    project_id, data_source, plant, from_location, to_location, 
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