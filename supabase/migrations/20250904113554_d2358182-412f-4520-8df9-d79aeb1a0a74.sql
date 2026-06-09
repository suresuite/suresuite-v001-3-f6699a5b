-- Harden numeric casts in bulk_insert_network_nodes to ignore non-numeric strings
CREATE OR REPLACE FUNCTION public.bulk_insert_network_nodes(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;

  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows; treat uncritical fields as NULL if missing/empty or invalid
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_nodes (
      project_id,
      plant_name,
      uid,
      depth,
      name,
      country,
      industry,
      website,
      traded_as,
      number_of_employees,
      revenue,
      lat,
      long,
      is_seed
    ) VALUES (
      p_project_id,
      p_plant_name,
      r->>'uid',
      CASE 
        WHEN r ? 'depth' AND (r->>'depth') ~ '^[-]?\d+$' THEN (r->>'depth')::int 
        ELSE NULL 
      END,
      NULLIF(r->>'name',''),
      NULLIF(r->>'country',''),
      NULLIF(r->>'industry',''),
      NULLIF(r->>'website',''),
      NULLIF(r->>'traded_as',''),
      CASE 
        WHEN r ? 'number_of_employees' AND (r->>'number_of_employees') ~ '^[-]?\d+$' THEN (r->>'number_of_employees')::int 
        ELSE NULL 
      END,
      CASE 
        WHEN r ? 'revenue' AND (r->>'revenue') ~ '^[-]?\d+(\.\d+)?$' THEN (r->>'revenue')::numeric 
        ELSE NULL 
      END,
      CASE 
        WHEN r ? 'lat' AND (r->>'lat') ~ '^[-]?\d+(\.\d+)?$' THEN (r->>'lat')::numeric 
        ELSE NULL 
      END,
      CASE 
        WHEN r ? 'long' AND (r->>'long') ~ '^[-]?\d+(\.\d+)?$' THEN (r->>'long')::numeric 
        ELSE NULL 
      END,
      CASE 
        WHEN r ? 'is_seed' THEN COALESCE((r->>'is_seed')::boolean, false) 
        ELSE false 
      END
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;