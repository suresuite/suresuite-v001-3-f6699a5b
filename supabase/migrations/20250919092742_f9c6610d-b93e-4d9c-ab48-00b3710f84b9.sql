-- Drop and recreate get_individual_scenario_results function to use only project_id filtering
DROP FUNCTION IF EXISTS public.get_individual_scenario_results(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_individual_scenario_results(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  simulation_id uuid,
  scenario_id uuid,
  scenario_name text,
  scenario_description text,
  scenario_effects jsonb,
  status text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  metrics jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Return individual scenario results for the given project only
  RETURN QUERY
  SELECT 
    sr.id as simulation_id,
    sp.id as scenario_id,
    sp.scenario_name,
    sp.description as scenario_description,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'effect_type', se.effect_type,
          'magnitude', se.magnitude,
          'unit', se.unit
        )
      ) FILTER (WHERE se.id IS NOT NULL),
      '[]'::jsonb
    ) as scenario_effects,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics
  FROM public.simulation_results sr
  CROSS JOIN LATERAL unnest(sr.scenario_ids) AS scenario_id_unnest(scenario_id)
  JOIN public.disruption_scenario_profiles sp ON sp.id = scenario_id_unnest.scenario_id
  LEFT JOIN public.disruption_scenario_effects se ON se.profile_id = sp.id
  WHERE sr.project_id = p_project_id
  GROUP BY sr.id, sp.id, sp.scenario_name, sp.description, sr.status, sr.started_at, sr.completed_at, sr.metrics
  ORDER BY sr.started_at DESC;
END;
$function$;