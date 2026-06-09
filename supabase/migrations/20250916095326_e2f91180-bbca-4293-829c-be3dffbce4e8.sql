-- Create a function to get baseline simulation results
CREATE OR REPLACE FUNCTION public.get_baseline_simulation_results(
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
  job_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return baseline simulation results for the specified project
  RETURN QUERY
  SELECT
    sr.id,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics,
    sj.job_type::text as job_type
  FROM public.simulation_results sr
  JOIN public.simulation_jobs sj ON sj.simulation_result_id = sr.id
  WHERE sr.project_id = p_project_id
    AND sj.job_type = 'baseline'
    AND sj.project_id = p_project_id
  ORDER BY sr.created_at DESC
  LIMIT 1;
END;
$function$;