-- Create a function to get individual scenario results (one row per scenario in a simulation)
CREATE OR REPLACE FUNCTION public.get_individual_scenario_results(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  simulation_id uuid,
  scenario_id uuid,
  status text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  metrics jsonb,
  job_type text,
  scenario_name text,
  scenario_description text,
  scenario_effects jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return individual scenario results by expanding simulation results with multiple scenarios
  RETURN QUERY
  SELECT
    sr.id as simulation_id,
    scenario_id::uuid as scenario_id,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics,
    sj.job_type::text as job_type,
    sp.scenario_name,
    sp.description as scenario_description,
    jsonb_agg(
      jsonb_build_object(
        'effect_type', se.effect_type,
        'magnitude', se.magnitude,
        'unit', se.unit
      )
    ) as scenario_effects
  FROM public.simulation_results sr
  JOIN public.simulation_jobs sj ON sj.simulation_result_id = sr.id
  CROSS JOIN LATERAL unnest(COALESCE(sr.scenario_ids, sj.scenario_ids)) as scenario_id
  LEFT JOIN public.disruption_scenario_profiles sp ON sp.id = scenario_id::uuid
  LEFT JOIN public.disruption_scenario_effects se ON se.profile_id = sp.id
  WHERE sr.project_id = p_project_id
    AND sj.job_type = 'scenarios'
    AND sj.project_id = p_project_id
    AND (COALESCE(sr.scenario_ids, sj.scenario_ids) IS NOT NULL)
    AND array_length(COALESCE(sr.scenario_ids, sj.scenario_ids), 1) > 0
  GROUP BY sr.id, scenario_id::uuid, sr.status, sr.started_at, sr.completed_at, sr.metrics, sj.job_type, sp.scenario_name, sp.description
  ORDER BY sr.created_at DESC, sp.scenario_name;
END;
$function$;