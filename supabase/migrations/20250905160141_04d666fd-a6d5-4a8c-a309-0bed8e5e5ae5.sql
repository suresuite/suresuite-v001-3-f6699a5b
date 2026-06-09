-- Create bulk insert function for network summary data
CREATE OR REPLACE FUNCTION public.bulk_insert_network_summary(
  p_project_id uuid,
  p_plant_name text,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  r jsonb;
  inserted_count integer := 0;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
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

  -- Insert rows into network_summary table
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_summary (
      project_id,
      plant_name,
      nodes_count,
      edges_count,
      tiers_data
    ) VALUES (
      p_project_id,
      p_plant_name,
      CASE WHEN r ? 'nodes_count' AND NULLIF(r->>'nodes_count','') IS NOT NULL THEN (r->>'nodes_count')::int ELSE NULL END,
      CASE WHEN r ? 'edges_count' AND NULLIF(r->>'edges_count','') IS NOT NULL THEN (r->>'edges_count')::int ELSE NULL END,
      CASE WHEN r ? 'tiers_data' THEN r->'tiers_data' ELSE NULL END
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;