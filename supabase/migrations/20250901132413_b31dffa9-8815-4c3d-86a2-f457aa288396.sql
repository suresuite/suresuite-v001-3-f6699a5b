-- Connect simulation_results with disruption_scenario_settings and seed synthetic data
BEGIN;

-- 1) Create helper view to explode scenario_ids per simulation result
DROP VIEW IF EXISTS public.simulation_result_scenarios;
CREATE VIEW public.simulation_result_scenarios AS
SELECT 
  sr.id AS simulation_result_id,
  sr.project_id,
  sr.plant_name,
  sr.status,
  sr.started_at,
  sr.completed_at,
  sid::uuid AS profile_id,
  dsp.scenario_name
FROM public.simulation_results sr
JOIN LATERAL unnest(sr.scenario_ids) AS sid ON true
LEFT JOIN public.disruption_scenario_profiles dsp ON dsp.id = sid::uuid;

-- 2) Create aggregated view with settings by scenario and a combined settings map
DROP VIEW IF EXISTS public.simulation_results_with_settings;
CREATE VIEW public.simulation_results_with_settings AS
SELECT 
  sr.id AS simulation_result_id,
  sr.project_id,
  sr.plant_name,
  sr.status,
  sr.started_at,
  sr.completed_at,
  sr.scenario_ids,
  (
    SELECT jsonb_object_agg(per.sid::text, per.settings) 
    FROM (
      SELECT sid::uuid AS sid, COALESCE(jsonb_object_agg(s.key, s.value ORDER BY s.key), '{}'::jsonb) AS settings
      FROM unnest(sr.scenario_ids) AS sid
      LEFT JOIN public.disruption_scenario_settings s ON s.profile_id = sid::uuid
      GROUP BY sid
    ) per
  ) AS settings_by_scenario,
  (
    SELECT COALESCE(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    FROM unnest(sr.scenario_ids) AS sid
    JOIN public.disruption_scenario_settings s ON s.profile_id = sid::uuid
  ) AS combined_settings
FROM public.simulation_results sr;

-- 3) Seed demo data: one demo project, three profiles with settings, and three simulation results
-- Create a demo project
WITH demo_project AS (
  INSERT INTO public.projects (id, name, plant_name, modeler_id, supply_chain_model, bom_level)
  VALUES (gen_random_uuid(), 'Demo Project - Simulation Linking', 'Demo Plant', gen_random_uuid(), 'Make-To-Order', 'single')
  RETURNING id
),
profiles AS (
  INSERT INTO public.disruption_scenario_profiles (
    project_id, plant_name, scenario_name, status, description, tags, disruption_start, disruption_end
  ) VALUES
    ((SELECT id FROM demo_project), 'Demo Plant', 'Supplier Factory Fire', 'active', 'Fire at supplier factory causing capacity drop', ARRAY['capacity','supplier'], current_date - 5, current_date + 9),
    ((SELECT id FROM demo_project), 'Demo Plant', 'Port Strike Disruption', 'draft', 'Strike at main port causing delays', ARRAY['logistics','delay'], current_date - 2, current_date + 12),
    ((SELECT id FROM demo_project), 'Demo Plant', 'Cyber Attack on Systems', 'paused', 'System outage impacting planning systems', ARRAY['it','risk'], current_date - 1, current_date + 7)
  RETURNING id, scenario_name
),
p1 AS (SELECT id FROM profiles WHERE scenario_name = 'Supplier Factory Fire'),
p2 AS (SELECT id FROM profiles WHERE scenario_name = 'Port Strike Disruption'),
p3 AS (SELECT id FROM profiles WHERE scenario_name = 'Cyber Attack on Systems')
INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
VALUES
  ((SELECT id FROM p1), 'service_level_target', '"95%"'::jsonb),
  ((SELECT id FROM p1), 'inventory_policy', '"safety_stock"'::jsonb),
  ((SELECT id FROM p1), 'transport_capacity_buffer', '0.2'::jsonb),
  ((SELECT id FROM p1), 'recovery_strategy', '"alternate_supplier"'::jsonb),
  ((SELECT id FROM p1), 'simulation_horizon_days', '14'::jsonb),

  ((SELECT id FROM p2), 'service_level_target', '"92%"'::jsonb),
  ((SELECT id FROM p2), 'inventory_policy', '"reorder_point"'::jsonb),
  ((SELECT id FROM p2), 'transport_capacity_buffer', '0.1'::jsonb),
  ((SELECT id FROM p2), 'recovery_strategy', '"expedite_shipping"'::jsonb),
  ((SELECT id FROM p2), 'simulation_horizon_days', '10'::jsonb),

  ((SELECT id FROM p3), 'service_level_target', '"90%"'::jsonb),
  ((SELECT id FROM p3), 'inventory_policy', '"just_in_time"'::jsonb),
  ((SELECT id FROM p3), 'transport_capacity_buffer', '0.05'::jsonb),
  ((SELECT id FROM p3), 'recovery_strategy', '"manual_override"'::jsonb),
  ((SELECT id FROM p3), 'simulation_horizon_days', '7'::jsonb);

-- Insert simulation results linked to the above profiles
INSERT INTO public.simulation_results (project_id, plant_name, status, started_at, completed_at, scenario_ids, metrics)
VALUES
(
  (SELECT id FROM demo_project), 'Demo Plant', 'completed', now() - interval '1 day', now(),
  ARRAY[(SELECT id FROM p1)],
  jsonb_build_object(
    'baseline', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.97),
        jsonb_build_object('day',2,'value',0.97),
        jsonb_build_object('day',3,'value',0.96),
        jsonb_build_object('day',4,'value',0.96),
        jsonb_build_object('day',5,'value',0.97)
      ),
      'revenue', jsonb_build_array(
        jsonb_build_object('day',1,'value',100000),
        jsonb_build_object('day',2,'value',102500),
        jsonb_build_object('day',3,'value',101000),
        jsonb_build_object('day',4,'value',103500),
        jsonb_build_object('day',5,'value',104000)
      ),
      'profit', jsonb_build_array(
        jsonb_build_object('day',1,'value',25000),
        jsonb_build_object('day',2,'value',25500),
        jsonb_build_object('day',3,'value',25200),
        jsonb_build_object('day',4,'value',26000),
        jsonb_build_object('day',5,'value',26200)
      ),
      'delivery_on_time', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.96),
        jsonb_build_object('day',2,'value',0.96),
        jsonb_build_object('day',3,'value',0.95),
        jsonb_build_object('day',4,'value',0.95),
        jsonb_build_object('day',5,'value',0.96)
      ),
      'backlog', jsonb_build_array(
        jsonb_build_object('day',1,'value',120),
        jsonb_build_object('day',2,'value',110),
        jsonb_build_object('day',3,'value',105),
        jsonb_build_object('day',4,'value',100),
        jsonb_build_object('day',5,'value',95)
      ),
      'resilience_cost', jsonb_build_array(
        jsonb_build_object('day',1,'value',0),
        jsonb_build_object('day',2,'value',0),
        jsonb_build_object('day',3,'value',0),
        jsonb_build_object('day',4,'value',0),
        jsonb_build_object('day',5,'value',0)
      )
    ),
    'scenario', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.88),
        jsonb_build_object('day',2,'value',0.89),
        jsonb_build_object('day',3,'value',0.9),
        jsonb_build_object('day',4,'value',0.92),
        jsonb_build_object('day',5,'value',0.94)
      ),
      'revenue', jsonb_build_array(
        jsonb_build_object('day',1,'value',85000),
        jsonb_build_object('day',2,'value',88000),
        jsonb_build_object('day',3,'value',90000),
        jsonb_build_object('day',4,'value',93000),
        jsonb_build_object('day',5,'value',96000)
      ),
      'profit', jsonb_build_array(
        jsonb_build_object('day',1,'value',18000),
        jsonb_build_object('day',2,'value',19000),
        jsonb_build_object('day',3,'value',20500),
        jsonb_build_object('day',4,'value',22000),
        jsonb_build_object('day',5,'value',23500)
      ),
      'delivery_on_time', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.85),
        jsonb_build_object('day',2,'value',0.86),
        jsonb_build_object('day',3,'value',0.88),
        jsonb_build_object('day',4,'value',0.9),
        jsonb_build_object('day',5,'value',0.92)
      ),
      'backlog', jsonb_build_array(
        jsonb_build_object('day',1,'value',220),
        jsonb_build_object('day',2,'value',210),
        jsonb_build_object('day',3,'value',200),
        jsonb_build_object('day',4,'value',180),
        jsonb_build_object('day',5,'value',160)
      ),
      'resilience_cost', jsonb_build_array(
        jsonb_build_object('day',1,'value',2000),
        jsonb_build_object('day',2,'value',1500),
        jsonb_build_object('day',3,'value',1200),
        jsonb_build_object('day',4,'value',900),
        jsonb_build_object('day',5,'value',600)
      )
    ),
    'simulation_period', jsonb_build_object('start_day',1,'end_day',5),
    'available_kpis', jsonb_build_array('fill_rate','revenue','profit','delivery_on_time','backlog','resilience_cost')
  )
),
(
  (SELECT id FROM demo_project), 'Demo Plant', 'running', now() - interval '2 hours', NULL,
  ARRAY[(SELECT id FROM p2)],
  jsonb_build_object(
    'baseline', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.97),
        jsonb_build_object('day',2,'value',0.97),
        jsonb_build_object('day',3,'value',0.96)
      ),
      'revenue', jsonb_build_array(
        jsonb_build_object('day',1,'value',100000),
        jsonb_build_object('day',2,'value',102500),
        jsonb_build_object('day',3,'value',101000)
      )
    ),
    'scenario', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.9),
        jsonb_build_object('day',2,'value',0.91),
        jsonb_build_object('day',3,'value',0.92)
      ),
      'revenue', jsonb_build_array(
        jsonb_build_object('day',1,'value',92000),
        jsonb_build_object('day',2,'value',94000),
        jsonb_build_object('day',3,'value',96000)
      )
    ),
    'simulation_period', jsonb_build_object('start_day',1,'end_day',3),
    'available_kpis', jsonb_build_array('fill_rate','revenue')
  )
),
(
  (SELECT id FROM demo_project), 'Demo Plant', 'failed', now() - interval '3 hours', now() - interval '2 hours',
  ARRAY[(SELECT id FROM p3)],
  jsonb_build_object(
    'baseline', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.96),
        jsonb_build_object('day',2,'value',0.96)
      )
    ),
    'scenario', jsonb_build_object(
      'fill_rate', jsonb_build_array(
        jsonb_build_object('day',1,'value',0.7),
        jsonb_build_object('day',2,'value',0.75)
      )
    ),
    'simulation_period', jsonb_build_object('start_day',1,'end_day',2),
    'available_kpis', jsonb_build_array('fill_rate')
  )
);

COMMIT;