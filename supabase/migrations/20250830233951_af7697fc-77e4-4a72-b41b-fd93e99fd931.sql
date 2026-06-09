-- Create upload_node_list_data function for CSV uploads
CREATE OR REPLACE FUNCTION public.upload_node_list_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_rows jsonb
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
  row_item jsonb;
BEGIN
  -- Set user context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id, plant_name INTO v_org, v_modeler, v_plant
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

  -- Process each row
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    -- Upsert node list data
    INSERT INTO public.node_list (
      project_id,
      plant_name,
      node_id,
      description_text,
      location_text,
      longitude,
      latitude,
      created_by,
      organization
    ) VALUES (
      p_project_id,
      COALESCE((row_item->>'plant_name')::text, v_plant),
      (row_item->>'node_id')::text,
      NULLIF(trim(row_item->>'description_text'), ''),
      NULLIF(trim(row_item->>'location_text'), ''),
      CASE 
        WHEN trim(row_item->>'longitude') = '' OR trim(row_item->>'longitude') IS NULL 
        THEN NULL 
        ELSE (row_item->>'longitude')::numeric 
      END,
      CASE 
        WHEN trim(row_item->>'latitude') = '' OR trim(row_item->>'latitude') IS NULL 
        THEN NULL 
        ELSE (row_item->>'latitude')::numeric 
      END,
      p_user_id,
      v_org
    )
    ON CONFLICT (project_id, node_id) 
    DO UPDATE SET
      description_text = EXCLUDED.description_text,
      location_text = EXCLUDED.location_text,
      longitude = EXCLUDED.longitude,
      latitude = EXCLUDED.latitude,
      updated_at = now();

    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$function$;