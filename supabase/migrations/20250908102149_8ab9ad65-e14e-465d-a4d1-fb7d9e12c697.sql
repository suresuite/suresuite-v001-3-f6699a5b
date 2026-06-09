-- Secure, RLS-aware bulk insert RPCs to prevent statement timeouts
-- Applies consistent auth/context across datasets, especially for Multi Level BOM projects

-- 1) Outbound Logistics (already added previously, but ensure idempotency)
CREATE OR REPLACE FUNCTION public.bulk_insert_outbound_logistics(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.outbound_logistics (
      customer_id,
      product_id,
      volume,
      time_unit,
      expected_lead_time,
      unit_price,
      plant_name,
      project_id
    ) VALUES (
      r->>'customer_id',
      r->>'product_id',
      CASE WHEN r ? 'volume' AND NULLIF(r->>'volume','') IS NOT NULL THEN (r->>'volume')::numeric ELSE NULL END,
      NULLIF(r->>'time_unit',''),
      CASE WHEN r ? 'expected_lead_time' AND NULLIF(r->>'expected_lead_time','') IS NOT NULL THEN (r->>'expected_lead_time')::numeric ELSE NULL END,
      CASE WHEN r ? 'unit_price' AND NULLIF(r->>'unit_price','') IS NOT NULL THEN (r->>'unit_price')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 2) Inbound Logistics
CREATE OR REPLACE FUNCTION public.bulk_insert_inbound_logistics(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.inbound_logistics (
      supplier_id,
      material_id,
      volume,
      time_unit,
      lead_time,
      unit_price,
      plant_name,
      project_id
    ) VALUES (
      r->>'supplier_id',
      r->>'material_id',
      CASE WHEN r ? 'volume' AND NULLIF(r->>'volume','') IS NOT NULL THEN (r->>'volume')::numeric ELSE NULL END,
      NULLIF(r->>'time_unit',''),
      CASE WHEN r ? 'lead_time' AND NULLIF(r->>'lead_time','') IS NOT NULL THEN (r->>'lead_time')::numeric ELSE NULL END,
      CASE WHEN r ? 'unit_price' AND NULLIF(r->>'unit_price','') IS NOT NULL THEN (r->>'unit_price')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 3) BOM Single Level
CREATE OR REPLACE FUNCTION public.bulk_insert_bom_single_level(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.bom_single_level (
      product_id,
      material_id,
      consumption_rate,
      plant_name,
      project_id
    ) VALUES (
      r->>'product_id',
      r->>'material_id',
      CASE WHEN r ? 'consumption_rate' AND NULLIF(r->>'consumption_rate','') IS NOT NULL THEN (r->>'consumption_rate')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 4) BOM Multi Level
CREATE OR REPLACE FUNCTION public.bulk_insert_bom_multi_level(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.bom_multi_level (
      material_id,
      level,
      higher_level_component_id,
      consumption_rate,
      plant_name,
      project_id
    ) VALUES (
      r->>'material_id',
      CASE WHEN r ? 'level' AND NULLIF(r->>'level','') IS NOT NULL THEN (r->>'level')::int ELSE 0 END,
      NULLIF(r->>'higher_level_component_id',''),
      CASE WHEN r ? 'consumption_rate' AND NULLIF(r->>'consumption_rate','') IS NOT NULL THEN (r->>'consumption_rate')::numeric ELSE NULL END,
      r->>'plant_name',
      (r->>'project_id')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

-- 5) Multi-tier supply chain (optional pathway used elsewhere)
CREATE OR REPLACE FUNCTION public.bulk_insert_multi_tier_supply_chain(p_rows jsonb, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.multi_tier_supply_chain (
      project_id,
      plant_name,
      from_firm_id,
      to_firm_id,
      to_firm_tier,
      to_firm_relationship
    ) VALUES (
      (r->>'project_id')::uuid,
      r->>'plant_name',
      r->>'from_firm_id',
      r->>'to_firm_id',
      CASE WHEN r ? 'to_firm_tier' AND NULLIF(r->>'to_firm_tier','') IS NOT NULL THEN (r->>'to_firm_tier')::int ELSE NULL END,
      NULLIF(r->>'to_firm_relationship','')
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;