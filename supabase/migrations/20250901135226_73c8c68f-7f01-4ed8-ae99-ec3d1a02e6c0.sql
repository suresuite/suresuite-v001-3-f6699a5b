-- Create views for simulation results joined to scenarios and settings
CREATE OR REPLACE VIEW public.simulation_result_scenarios AS
SELECT
  sr.id AS simulation_id,
  sr.project_id,
  sr.plant_name,
  sr.status AS simulation_status,
  sr.started_at,
  sr.completed_at,
  sr.metrics,
  sr.result_data,
  sid.scenario_id,
  sp.scenario_name,
  sp.status AS scenario_status,
  sp.description AS scenario_description,
  sp.disruption_start,
  sp.disruption_end,
  sp.created_at AS scenario_created_at
FROM public.simulation_results sr
JOIN LATERAL unnest(sr.scenario_ids) AS sid(scenario_id) ON true
JOIN public.disruption_scenario_profiles sp ON sp.id = sid.scenario_id;

CREATE OR REPLACE VIEW public.simulation_results_with_settings AS
SELECT
  v.*, 
  COALESCE(s.settings, '{}'::jsonb) AS scenario_settings
FROM public.simulation_result_scenarios v
LEFT JOIN (
  SELECT dss.profile_id, jsonb_object_agg(dss.key, dss.value ORDER BY dss.key) AS settings
  FROM public.disruption_scenario_settings dss
  GROUP BY dss.profile_id
) s
ON s.profile_id = v.scenario_id;

-- Seed demo data: 1 project, 3 scenarios with settings, 3 linked simulation runs
DO $$
DECLARE
  proj_id uuid;
  s1 uuid;
  s2 uuid;
  s3 uuid;
BEGIN
  -- Ensure a demo project exists (idempotent by name)
  IF NOT EXISTS (
    SELECT 1 FROM public.projects WHERE name = 'Demo Simulation Project'
  ) THEN
    INSERT INTO public.projects (
      name, plant_name, supply_chain_model, bom_level, modeler_id, modeler_name, simulation_start, simulation_end
    ) VALUES (
      'Demo Simulation Project', 'Plant A', 'Make-To-Order', 'single', gen_random_uuid(), 'Demo User', current_date, current_date + 30
    ) RETURNING id INTO proj_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE name = 'Demo Simulation Project' LIMIT 1;
  END IF;

  -- Scenario profiles (use valid enum values: draft, active, archived)
  IF NOT EXISTS (
    SELECT 1 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Alpha'
  ) THEN
    INSERT INTO public.disruption_scenario_profiles (
      project_id, plant_name, scenario_name, status, description, tags
    ) VALUES (
      proj_id, 'Plant A', 'Scenario Alpha', 'draft', 'Minor supplier delay test', ARRAY['demo','seed']
    ) RETURNING id INTO s1;
  ELSE
    SELECT id INTO s1 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Alpha' LIMIT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Beta'
  ) THEN
    INSERT INTO public.disruption_scenario_profiles (
      project_id, plant_name, scenario_name, status, description, tags
    ) VALUES (
      proj_id, 'Plant A', 'Scenario Beta', 'active', 'Capacity reduction stress test', ARRAY['demo','seed']
    ) RETURNING id INTO s2;
  ELSE
    SELECT id INTO s2 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Beta' LIMIT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Gamma'
  ) THEN
    INSERT INTO public.disruption_scenario_profiles (
      project_id, plant_name, scenario_name, status, description, tags
    ) VALUES (
      proj_id, 'Plant A', 'Scenario Gamma', 'archived', 'Historical event replay', ARRAY['demo','seed']
    ) RETURNING id INTO s3;
  ELSE
    SELECT id INTO s3 FROM public.disruption_scenario_profiles WHERE project_id = proj_id AND scenario_name = 'Scenario Gamma' LIMIT 1;
  END IF;

  -- Settings for each scenario (idempotent)
  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s1 AND key = 'capacity_reduction_percent') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s1, 'capacity_reduction_percent', to_jsonb(30));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s1 AND key = 'recovery_days') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s1, 'recovery_days', to_jsonb(7));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s2 AND key = 'capacity_reduction_percent') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s2, 'capacity_reduction_percent', to_jsonb(50));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s2 AND key = 'time_delay_days') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s2, 'time_delay_days', to_jsonb(5));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s3 AND key = 'capacity_reduction_percent') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s3, 'capacity_reduction_percent', to_jsonb(10));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = s3 AND key = 'time_delay_days') THEN
    INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
    VALUES (s3, 'time_delay_days', to_jsonb(1));
  END IF;

  -- Seed 3 simulation results (idempotent via seed_tag inside metrics JSON)
  IF NOT EXISTS (
    SELECT 1 FROM public.simulation_results WHERE metrics ? 'seed_tag' AND metrics->>'seed_tag' = 'demo_v1_run1'
  ) THEN
    INSERT INTO public.simulation_results (
      project_id, plant_name, status, scenario_ids, started_at, completed_at, metrics
    ) VALUES (
      proj_id, 'Plant A', 'completed', ARRAY[s1]::uuid[], now() - interval '2 days', now() - interval '2 days' + interval '2 hours',
      '{
        "seed_tag":"demo_v1_run1",
        "simulation_period":{"start_day":0,"end_day":7},
        "available_kpis":["fill_rate","revenue"],
        "baseline":{
          "fill_rate":[{"day":0,"value":0.96},{"day":7,"value":0.97}],
          "revenue":[{"day":0,"value":120000},{"day":7,"value":125000}]
        },
        "scenario":{
          "fill_rate":[{"day":0,"value":0.90},{"day":7,"value":0.95}],
          "revenue":[{"day":0,"value":110000},{"day":7,"value":120000}]
        }
      }'::jsonb
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.simulation_results WHERE metrics ? 'seed_tag' AND metrics->>'seed_tag' = 'demo_v1_run2'
  ) THEN
    INSERT INTO public.simulation_results (
      project_id, plant_name, status, scenario_ids, started_at, completed_at, metrics
    ) VALUES (
      proj_id, 'Plant A', 'completed', ARRAY[s1, s2]::uuid[], now() - interval '1 days', now() - interval '1 days' + interval '3 hours',
      '{
        "seed_tag":"demo_v1_run2",
        "simulation_period":{"start_day":0,"end_day":14},
        "available_kpis":["fill_rate","revenue","profit"],
        "baseline":{
          "fill_rate":[{"day":0,"value":0.95},{"day":14,"value":0.97}],
          "revenue":[{"day":0,"value":240000},{"day":14,"value":260000}],
          "profit":[{"day":0,"value":60000},{"day":14,"value":65000}]
        },
        "scenario":{
          "fill_rate":[{"day":0,"value":0.85},{"day":14,"value":0.93}],
          "revenue":[{"day":0,"value":210000},{"day":14,"value":245000}],
          "profit":[{"day":0,"value":50000},{"day":14,"value":58000}]
        }
      }'::jsonb
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.simulation_results WHERE metrics ? 'seed_tag' AND metrics->>'seed_tag' = 'demo_v1_run3'
  ) THEN
    INSERT INTO public.simulation_results (
      project_id, plant_name, status, scenario_ids, started_at, completed_at, metrics
    ) VALUES (
      proj_id, 'Plant A', 'completed', ARRAY[s3]::uuid[], now() - interval '12 hours', now() - interval '10 hours',
      '{
        "seed_tag":"demo_v1_run3",
        "simulation_period":{"start_day":0,"end_day":5},
        "available_kpis":["fill_rate","backlog"],
        "baseline":{
          "fill_rate":[{"day":0,"value":0.97},{"day":5,"value":0.98}],
          "backlog":[{"day":0,"value":120},{"day":5,"value":90}]
        },
        "scenario":{
          "fill_rate":[{"day":0,"value":0.92},{"day":5,"value":0.96}],
          "backlog":[{"day":0,"value":180},{"day":5,"value":110}]
        }
      }'::jsonb
    );
  END IF;
END$$;