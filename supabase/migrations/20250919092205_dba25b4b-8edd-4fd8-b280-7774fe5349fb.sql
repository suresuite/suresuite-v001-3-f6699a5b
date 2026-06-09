-- Drop and recreate get_baseline_simulation_results function to use only project_id filtering
DROP FUNCTION IF EXISTS public.get_baseline_simulation_results(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_baseline_simulation_results(p_project_id uuid, p_user_id uuid, p_user_email text)
 RETURNS TABLE(id uuid, project_id uuid, plant_name text, status text, scenario_ids uuid[], started_at timestamp with time zone, completed_at timestamp with time zone, metrics jsonb, result_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, created_by uuid, organization text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Return baseline simulation results (no scenarios) for the given project only
  RETURN QUERY
  SELECT
    sr.id,
    sr.project_id,
    sr.plant_name,
    sr.status,
    sr.scenario_ids,
    sr.started_at,
    sr.completed_at,
    sr.metrics,
    sr.result_data,
    sr.created_at,
    sr.updated_at,
    sr.created_by,
    sr.organization
  FROM public.simulation_results sr
  WHERE sr.project_id = p_project_id
    AND (sr.scenario_ids IS NULL OR array_length(sr.scenario_ids, 1) = 0)
  ORDER BY sr.created_at DESC;
END;
$function$