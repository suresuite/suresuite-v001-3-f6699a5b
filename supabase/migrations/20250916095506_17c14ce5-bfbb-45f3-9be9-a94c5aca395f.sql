-- Create a function to get scenario simulation results (simulations with scenarios)
CREATE OR REPLACE FUNCTION public.get_scenario_simulation_results(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  status text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  metrics jsonb,
  scenario_ids uuid[],
  job_type text,
  job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return scenario simulation results for the specified project
  RETURN QUERY
  SELECT
    sr.id,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics,
    COALESCE(sr.scenario_ids, sj.scenario_ids) as scenario_ids,
    sj.job_type::text as job_type,
    sj.id as job_id
  FROM public.simulation_results sr
  JOIN public.simulation_jobs sj ON sj.simulation_result_id = sr.id
  WHERE sr.project_id = p_project_id
    AND sj.job_type = 'scenarios'
    AND sj.project_id = p_project_id
    AND (COALESCE(sr.scenario_ids, sj.scenario_ids) IS NOT NULL)
    AND array_length(COALESCE(sr.scenario_ids, sj.scenario_ids), 1) > 0
  ORDER BY sr.created_at DESC;
END;
$function$;