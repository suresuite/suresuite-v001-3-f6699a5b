-- Create helper RPC to insert simulation_results within RLS context
CREATE OR REPLACE FUNCTION public.create_simulation_result(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text,
  p_scenario_ids uuid[],
  p_status text DEFAULT 'running',
  p_started_at timestamptz DEFAULT now(),
  p_metrics jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  new_id uuid;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (owner or admin in same org)
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert simulation result (triggers/policies will enforce org & created_by)
  INSERT INTO public.simulation_results (
    project_id, plant_name, status, scenario_ids, started_at, created_by, organization, metrics
  ) VALUES (
    p_project_id, p_plant_name, COALESCE(p_status, 'running'), p_scenario_ids, COALESCE(p_started_at, now()),
    p_user_id, v_org, p_metrics
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;