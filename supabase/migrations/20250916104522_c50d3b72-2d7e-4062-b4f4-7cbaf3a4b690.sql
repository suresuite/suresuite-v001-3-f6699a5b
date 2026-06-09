-- Drop existing functions first, then recreate with proper organization access control

-- Drop existing functions
DROP FUNCTION IF EXISTS public.get_individual_scenario_results(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_scenario_simulation_results(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_baseline_simulation_results(uuid, uuid, text);

-- Recreate get_individual_scenario_results function with organization access control
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
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Enforce organization access control
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = p_project_id 
    AND p.organization = public.get_current_user_org()
  ) THEN
    RAISE EXCEPTION 'Access denied: project not found or not in your organization';
  END IF;
  
  -- Return individual scenario results with organization access control
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
  JOIN public.projects proj ON proj.id = sr.project_id
  CROSS JOIN LATERAL unnest(sr.scenario_ids) AS scenario_id_unnest(scenario_id)
  JOIN public.disruption_scenario_profiles sp ON sp.id = scenario_id_unnest.scenario_id
  LEFT JOIN public.disruption_scenario_effects se ON se.profile_id = sp.id
  WHERE sr.project_id = p_project_id
    AND proj.organization = public.get_current_user_org()
  GROUP BY sr.id, sp.id, sp.scenario_name, sp.description, sr.status, sr.started_at, sr.completed_at, sr.metrics
  ORDER BY sr.started_at DESC;
END;
$function$;

-- Recreate get_scenario_simulation_results function with organization access control
CREATE OR REPLACE FUNCTION public.get_scenario_simulation_results(p_project_id uuid, p_user_id uuid, p_user_email text)
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
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Enforce organization access control
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = p_project_id 
    AND p.organization = public.get_current_user_org()
  ) THEN
    RAISE EXCEPTION 'Access denied: project not found or not in your organization';
  END IF;
  
  -- Return scenario simulation results with organization access control
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
  JOIN public.projects proj ON proj.id = sr.project_id
  CROSS JOIN LATERAL unnest(sr.scenario_ids) AS scenario_id_unnest(scenario_id)
  JOIN public.disruption_scenario_profiles sp ON sp.id = scenario_id_unnest.scenario_id
  LEFT JOIN public.disruption_scenario_effects se ON se.profile_id = sp.id
  WHERE sr.project_id = p_project_id
    AND proj.organization = public.get_current_user_org()
    AND array_length(sr.scenario_ids, 1) > 0
  GROUP BY sr.id, sp.id, sp.scenario_name, sp.description, sr.status, sr.started_at, sr.completed_at, sr.metrics
  ORDER BY sr.started_at DESC;
END;
$function$;

-- Recreate get_baseline_simulation_results function with organization access control
CREATE OR REPLACE FUNCTION public.get_baseline_simulation_results(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  simulation_id uuid,
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
  -- Set user context for RLS policies  
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Enforce organization access control
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = p_project_id 
    AND p.organization = public.get_current_user_org()
  ) THEN
    RAISE EXCEPTION 'Access denied: project not found or not in your organization';
  END IF;
  
  -- Return baseline simulation results with organization access control
  RETURN QUERY
  SELECT 
    sr.id as simulation_id,
    sr.status,
    sr.started_at,
    sr.completed_at,
    sr.metrics
  FROM public.simulation_results sr
  JOIN public.projects proj ON proj.id = sr.project_id
  WHERE sr.project_id = p_project_id
    AND proj.organization = public.get_current_user_org()
    AND (sr.scenario_ids IS NULL OR array_length(sr.scenario_ids, 1) = 0)
  ORDER BY sr.started_at DESC;
END;
$function$;