
-- 1) Exploded view: one row per (simulation_result, scenario_profile) mapping
CREATE OR REPLACE VIEW public.simulation_result_scenarios AS
WITH exploded AS (
  SELECT
    sr.id AS simulation_id,
    sr.project_id,
    sr.plant_name,
    sr.status AS simulation_status,
    sr.started_at,
    sr.completed_at,
    sr.metrics,
    sr.created_at AS simulation_created_at,
    sid AS scenario_id
  FROM public.simulation_results sr
  CROSS JOIN UNNEST(sr.scenario_ids) AS sid
)
SELECT
  e.simulation_id,
  e.project_id,
  e.plant_name,
  e.simulation_status,
  e.started_at,
  e.completed_at,
  e.metrics,
  e.simulation_created_at,
  dsp.id AS scenario_id,
  dsp.scenario_name,
  dsp.status AS scenario_status,
  dsp.description,
  dsp.disruption_start,
  dsp.disruption_end,
  dsp.created_at AS scenario_created_at
FROM exploded e
JOIN public.disruption_scenario_profiles dsp
  ON dsp.id = e.scenario_id;

COMMENT ON VIEW public.simulation_result_scenarios IS
'Exploded mapping between simulation_results and disruption_scenario_profiles (one row per referenced scenario).';


-- 2) Aggregated view: scenarios (and settings if any) grouped per simulation
CREATE OR REPLACE VIEW public.simulation_results_with_settings AS
SELECT
  sr.id AS simulation_id,
  sr.project_id,
  sr.plant_name,
  sr.status AS simulation_status,
  sr.started_at,
  sr.completed_at,
  sr.metrics,
  sr.created_at AS simulation_created_at,
  COALESCE(
    JSONB_AGG(
      DISTINCT JSONB_BUILD_OBJECT(
        'id', dsp.id,
        'scenario_name', dsp.scenario_name,
        'status', dsp.status,
        'description', dsp.description,
        'disruption_start', dsp.disruption_start,
        'disruption_end', dsp.disruption_end,
        'settings',
          COALESCE((
            SELECT JSONB_OBJECT_AGG(s.key, s.value)
            FROM public.disruption_scenario_settings s
            WHERE s.profile_id = dsp.id
          ), '{}'::jsonb)
      )
    ) FILTER (WHERE dsp.id IS NOT NULL),
    '[]'::jsonb
  ) AS scenarios
FROM public.simulation_results sr
LEFT JOIN LATERAL (
  SELECT sid
  FROM UNNEST(sr.scenario_ids) sid
) u ON TRUE
LEFT JOIN public.disruption_scenario_profiles dsp
  ON dsp.id = u.sid
GROUP BY
  sr.id, sr.project_id, sr.plant_name, sr.status, sr.started_at, sr.completed_at, sr.metrics, sr.created_at;

COMMENT ON VIEW public.simulation_results_with_settings IS
'Aggregated mapping between simulation_results and their scenarios (with settings if present).';


-- 3) RPC to seed synthetic (simple) data for a chosen project and caller
--    - Keeps it simple: inserts scenario profiles only (no targets/effects/settings)
--    - Inserts a few completed simulations referencing subsets of the scenarios
CREATE OR REPLACE FUNCTION public.seed_synthetic_simulation_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_num_profiles integer DEFAULT 5,
  p_num_simulations integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_plant text;
  created_profile_ids uuid[] := '{}';
  sim_id uuid;
  i int;
  j int;
  n_profiles int;
  n_sims int;
  sid uuid;
  scenario_subset uuid[];
  result jsonb := '{}'::jsonb;
BEGIN
  -- Caller context for RLS-aware helpers and authorization checks
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (same org AND owner/admin)
  SELECT organization, modeler_id, plant_name
    INTO v_org, v_modeler, v_plant
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org()
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin')
  THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  n_profiles := GREATEST(1, COALESCE(p_num_profiles, 1));
  n_sims := GREATEST(1, COALESCE(p_num_simulations, 1));

  -- Create disruption scenario profiles (simple/standard)
  FOR i IN 1..n_profiles LOOP
    INSERT INTO public.disruption_scenario_profiles (
      project_id, plant_name, scenario_name, status, description, tags, created_by, organization
    ) VALUES (
      p_project_id,
      v_plant,
      FORMAT('Synthetic Scenario %s - %s', i, TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')),
      CASE WHEN i % 3 = 1 THEN 'draft'
           WHEN i % 3 = 2 THEN 'active'
           ELSE 'archived' END::public.disruption_status,
      'Auto-generated synthetic scenario for testing',
      ARRAY[]::text[],
      p_user_id,
      v_org
    )
    RETURNING id INTO sid;

    created_profile_ids := ARRAY_APPEND(created_profile_ids, sid);
  END LOOP;

  -- Create a few completed simulations that reference subsets of the above scenarios
  FOR j IN 1..n_sims LOOP
    -- Pick first k scenarios, where k cycles through 1..min(3, n_profiles)
    scenario_subset := (
      SELECT ARRAY_AGG(id)::uuid[]
      FROM (
        SELECT UNNEST(created_profile_ids) AS id
        LIMIT LEAST((j % 3) + 1, n_profiles)
      ) t
    );

    INSERT INTO public.simulation_results (
      project_id, plant_name, scenario_ids, status, started_at, completed_at,
      created_by, organization, metrics
    ) VALUES (
      p_project_id, v_plant, scenario_subset,
      'completed',
      NOW() - MAKE_INTERVAL(days => (n_sims - j) * 2),
      NOW() - MAKE_INTERVAL(days => (n_sims - j) * 2) + INTERVAL '10 minutes',
      p_user_id, v_org,
      '{"notes": "synthetic"}'::jsonb
    )
    RETURNING id INTO sim_id;
  END LOOP;

  result := jsonb_build_object(
    'project_id', p_project_id,
    'inserted_profiles', n_profiles,
    'inserted_simulations', n_sims,
    'profile_ids', to_jsonb(created_profile_ids)
  );

  RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seed_synthetic_simulation_data(uuid, uuid, text, integer, integer) TO PUBLIC;


-- 4) Optional: seed a small sample into the most recently created project right now.
--    Keeps things simple and avoids over-engineering (profiles only, plus a few simulation rows).
DO $$
DECLARE
  v_pid uuid;
  v_org text;
  v_plant text;
  v_profile_ids uuid[] := '{}';
  v_sid uuid;
BEGIN
  SELECT id, organization, plant_name
    INTO v_pid, v_org, v_plant
  FROM public.projects
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pid IS NOT NULL THEN
    -- Insert 5 basic profiles
    FOR i IN 1..5 LOOP
      INSERT INTO public.disruption_scenario_profiles (
        project_id, plant_name, scenario_name, status, description, tags, organization
      ) VALUES (
        v_pid, v_plant,
        FORMAT('Synthetic Scenario Seed %s', i),
        CASE WHEN i % 3 = 1 THEN 'draft'
             WHEN i % 3 = 2 THEN 'active'
             ELSE 'archived' END::public.disruption_status,
        'Seeded for testing',
        ARRAY[]::text[],
        v_org
      )
      RETURNING id INTO v_sid;

      v_profile_ids := ARRAY_APPEND(v_profile_ids, v_sid);
    END LOOP;

    -- Insert 3 simple completed simulation rows referencing subsets of the above scenarios
    INSERT INTO public.simulation_results (
      project_id, plant_name, scenario_ids, status, started_at, completed_at, organization, metrics
    )
    VALUES
      (v_pid, v_plant, v_profile_ids[1:1], 'completed', NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days' + INTERVAL '15 minutes', v_org, '{"notes":"seed A"}'),
      (v_pid, v_plant, v_profile_ids[1:2], 'completed', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days' + INTERVAL '15 minutes', v_org, '{"notes":"seed B"}'),
      (v_pid, v_plant, v_profile_ids[1:3], 'completed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '15 minutes', v_org, '{"notes":"seed C"}');
  END IF;
END $$;
