-- Fix SECURITY DEFINER views by removing SECURITY DEFINER property
-- This addresses the security linter warnings about views with SECURITY DEFINER

-- Drop and recreate simulation_results_with_settings view without SECURITY DEFINER
DROP VIEW IF EXISTS public.simulation_results_with_settings;

CREATE VIEW public.simulation_results_with_settings AS
SELECT 
  sr.id AS simulation_id,
  sr.project_id,
  sr.plant_name,
  sr.status AS simulation_status,
  sr.started_at,
  sr.completed_at,
  sr.metrics,
  sr.result_data,
  dsp.id AS scenario_id,
  dsp.scenario_name,
  dsp.description AS scenario_description,
  dsp.status AS scenario_status,
  dsp.disruption_start,
  dsp.disruption_end,
  dsp.created_at AS scenario_created_at,
  (
    SELECT jsonb_object_agg(dss.key, dss.value)
    FROM public.disruption_scenario_settings dss
    WHERE dss.profile_id = dsp.id
  ) AS scenario_settings
FROM public.simulation_results sr
LEFT JOIN unnest(sr.scenario_ids) AS scenario_id ON true
LEFT JOIN public.disruption_scenario_profiles dsp ON dsp.id = scenario_id::uuid;

-- Drop and recreate simulation_result_scenarios view without SECURITY DEFINER  
DROP VIEW IF EXISTS public.simulation_result_scenarios;

CREATE VIEW public.simulation_result_scenarios AS
SELECT 
  sr.id AS simulation_id,
  sr.project_id,
  sr.plant_name,
  sr.status AS simulation_status,
  sr.started_at,
  sr.completed_at,
  sr.metrics,
  sr.result_data,
  dsp.id AS scenario_id,
  dsp.scenario_name,
  dsp.description AS scenario_description,
  dsp.status AS scenario_status,
  dsp.disruption_start,
  dsp.disruption_end,
  dsp.created_at AS scenario_created_at
FROM public.simulation_results sr
LEFT JOIN unnest(sr.scenario_ids) AS scenario_id ON true
LEFT JOIN public.disruption_scenario_profiles dsp ON dsp.id = scenario_id::uuid;