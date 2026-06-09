-- Fix the bulk_insert_network_summary function by removing potential schema conflicts
-- Drop and recreate the function to ensure clean state
DROP FUNCTION IF EXISTS public.bulk_insert_network_summary(uuid, text, uuid, text, jsonb);

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
  SELECT p.organization, p.modeler_id INTO v_org, v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT au.role::text INTO v_role 
  FROM public.approved_users au 
  WHERE au.id = p_user_id 
  LIMIT 1;

  IF v_org <> (SELECT au.organization FROM public.approved_users au WHERE au.id = p_user_id LIMIT 1)
     OR NOT (v_modeler = p_user_id OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert rows into network_summary table
  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.network_summary (
      project_id,
      plant_name,
      nodes_count,
      edges_count,
      tiers_data,
      created_by,
      uploaded_by,
      organization
    ) VALUES (
      p_project_id,
      p_plant_name,
      CASE WHEN r ? 'nodes_count' AND NULLIF(r->>'nodes_count','') IS NOT NULL THEN (r->>'nodes_count')::int ELSE NULL END,
      CASE WHEN r ? 'edges_count' AND NULLIF(r->>'edges_count','') IS NOT NULL THEN (r->>'edges_count')::int ELSE NULL END,
      CASE WHEN r ? 'tiers_data' THEN r->'tiers_data' ELSE NULL END,
      p_user_id,
      p_user_id,
      v_org
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;