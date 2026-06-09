-- Add deep_tier_enabled column to projects table
ALTER TABLE public.projects 
ADD COLUMN deep_tier_enabled boolean NOT NULL DEFAULT false;

-- Create tier2_suppliers table for tier-2 supplier relationships
CREATE TABLE public.tier2_suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  supplier_id text NOT NULL,
  upstream_supplier_id text NOT NULL,
  material_id text,
  relationship_type text,
  volume numeric,
  unit_price numeric,
  lead_time numeric,
  time_unit text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create tier3_suppliers table for tier-3 supplier relationships  
CREATE TABLE public.tier3_suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  supplier_id text NOT NULL,
  upstream_supplier_id text NOT NULL,
  material_id text,
  relationship_type text,
  volume numeric,
  unit_price numeric,
  lead_time numeric,
  time_unit text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS for tier2_suppliers
ALTER TABLE public.tier2_suppliers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tier2_suppliers
CREATE POLICY "Tier2: organization access view" 
ON public.tier2_suppliers 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Tier2: project access modify" 
ON public.tier2_suppliers 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier2_suppliers.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Enable RLS for tier3_suppliers
ALTER TABLE public.tier3_suppliers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tier3_suppliers
CREATE POLICY "Tier3: organization access view" 
ON public.tier3_suppliers 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Tier3: project access modify" 
ON public.tier3_suppliers 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = tier3_suppliers.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Update create_project function to include deep_tier_enabled parameter
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text, 
  p_user_id uuid, 
  p_user_email text, 
  p_user_name text, 
  p_simulation_start date DEFAULT NULL::date, 
  p_simulation_end date DEFAULT NULL::date,
  p_deep_tier_enabled boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Insert project with all parameters including deep tier
  INSERT INTO public.projects (
    name,
    plant_name,
    supply_chain_model,
    bom_level,
    modeler_id,
    modeler_name,
    simulation_start,
    simulation_end,
    deep_tier_enabled
  ) VALUES (
    p_name,
    p_plant,
    p_model,
    p_bom_level,
    p_user_id,
    p_user_name,
    p_simulation_start,
    p_simulation_end,
    COALESCE(p_deep_tier_enabled, false)
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

-- Update update_project function to include deep_tier_enabled parameter
CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid, 
  p_name text, 
  p_plant text, 
  p_model text, 
  p_bom_level text, 
  p_user_id uuid, 
  p_user_email text, 
  p_simulation_start date DEFAULT NULL::date, 
  p_simulation_end date DEFAULT NULL::date,
  p_deep_tier_enabled boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Update the project, including deep tier setting
  UPDATE public.projects 
  SET 
    name = p_name,
    plant_name = p_plant,
    supply_chain_model = p_model,
    bom_level = p_bom_level,
    simulation_start = p_simulation_start,
    simulation_end = p_simulation_end,
    deep_tier_enabled = COALESCE(p_deep_tier_enabled, false),
    updated_at = now()
  WHERE id = p_project_id;
  
  -- Check if any row was actually updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$;

-- Create bulk insert function for tier2_suppliers
CREATE OR REPLACE FUNCTION public.bulk_insert_tier2_suppliers(
  p_project_id uuid,
  p_data jsonb,
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
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
  row_data jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, modeler_id, plant_name INTO v_org, v_modeler, v_plant
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    INSERT INTO public.tier2_suppliers (
      project_id, plant_name, supplier_id, upstream_supplier_id, 
      material_id, relationship_type, volume, unit_price, lead_time, time_unit
    ) VALUES (
      p_project_id,
      v_plant,
      row_data->>'supplier_id',
      row_data->>'upstream_supplier_id',
      row_data->>'material_id',
      row_data->>'relationship_type',
      CASE WHEN row_data->>'volume' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'volume')::numeric ELSE NULL END,
      CASE WHEN row_data->>'unit_price' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'unit_price')::numeric ELSE NULL END,
      CASE WHEN row_data->>'lead_time' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'lead_time')::numeric ELSE NULL END,
      row_data->>'time_unit'
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- Create bulk insert function for tier3_suppliers
CREATE OR REPLACE FUNCTION public.bulk_insert_tier3_suppliers(
  p_project_id uuid,
  p_data jsonb,
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
  v_modeler uuid;
  v_role text;
  v_plant text;
  inserted_count integer := 0;
  row_data jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, modeler_id, plant_name INTO v_org, v_modeler, v_plant
  FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR row_data IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    INSERT INTO public.tier3_suppliers (
      project_id, plant_name, supplier_id, upstream_supplier_id, 
      material_id, relationship_type, volume, unit_price, lead_time, time_unit
    ) VALUES (
      p_project_id,
      v_plant,
      row_data->>'supplier_id',
      row_data->>'upstream_supplier_id',
      row_data->>'material_id',
      row_data->>'relationship_type',
      CASE WHEN row_data->>'volume' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'volume')::numeric ELSE NULL END,
      CASE WHEN row_data->>'unit_price' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'unit_price')::numeric ELSE NULL END,
      CASE WHEN row_data->>'lead_time' ~ '^[0-9]+\.?[0-9]*$' THEN (row_data->>'lead_time')::numeric ELSE NULL END,
      row_data->>'time_unit'
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;