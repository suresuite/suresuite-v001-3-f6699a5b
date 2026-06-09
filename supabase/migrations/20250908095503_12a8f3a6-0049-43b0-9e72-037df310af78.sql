-- Fix bulk_insert_outbound_logistics function to include proper authorization
-- This prevents timeouts in projects with Multi Level BOM settings

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
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project_id from the first row to validate authorization
  SELECT (value->>'project_id')::uuid INTO v_project_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id_required';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = v_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows with proper authorization context
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
      r->>'time_unit',
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