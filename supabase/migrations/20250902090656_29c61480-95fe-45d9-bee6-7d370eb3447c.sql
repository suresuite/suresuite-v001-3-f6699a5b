-- Fix ambiguous column reference in get_simulation_results function
CREATE OR REPLACE FUNCTION public.get_simulation_results(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  status text,
  scenario_ids uuid[],
  started_at timestamptz,
  completed_at timestamptz,
  metrics jsonb,
  result_data jsonb,
  created_by uuid,
  organization text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (owner or admin in same org)
  SELECT p.organization, p.modeler_id INTO v_org, v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Return simulation results for the project with fully qualified column names
  RETURN QUERY
  SELECT sr.id, sr.project_id, sr.plant_name, sr.status, sr.scenario_ids, 
         sr.started_at, sr.completed_at, sr.metrics, sr.result_data, 
         sr.created_by, sr.organization, sr.created_at, sr.updated_at
  FROM public.simulation_results sr
  WHERE sr.project_id = p_project_id
  ORDER BY sr.created_at DESC;
END;
$function$;