-- Create seed RPC to generate synthetic disruption scenario profiles and simulation results
CREATE OR REPLACE FUNCTION public.seed_synthetic_simulation_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_num_profiles integer DEFAULT 3,
  p_num_simulations integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_plant text;
  i integer;
  new_profile_id uuid;
  profile_ids uuid[] := ARRAY[]::uuid[];
  sim_id uuid;
  profile_name text;
  result_summary jsonb := '[]'::jsonb;
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization (same org AND project owner or admin)
  SELECT organization, modeler_id, plant_name
    INTO v_org, v_modeler, v_plant
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Create synthetic disruption scenario profiles using the existing v2 helper
  FOR i IN 1..GREATEST(1, COALESCE(p_num_profiles, 3)) LOOP
    profile_name := 'Scenario ' || i;
    new_profile_id := public.create_disruption_scenario_v2(
      p_project_id       => p_project_id,
      p_plant_name       => v_plant,
      p_scenario_name    => profile_name,
      p_user_id          => p_user_id,
      p_user_email       => p_user_email,
      p_status           => 'draft',
      p_description      => 'Synthetic scenario ' || i,
      p_tags             => ARRAY['seed'],
      p_targets          => jsonb_build_array(
                              jsonb_build_object(
                                'target_type','node',
                                'node_ids', jsonb_build_array('N' || i)
                              )
                            ),
      p_effects          => jsonb_build_array(
                              jsonb_build_object(
                                'effect_type','capacity_reduction',
                                'magnitude', (10 + i)::numeric,
                                'unit','percent'
                              )
                            ),
      p_settings         => jsonb_build_object('simulation_horizon_days', 7)
    );
    profile_ids := array_append(profile_ids, new_profile_id);
  END LOOP;

  -- Create synthetic simulation results referencing the seeded profiles
  FOR i IN 1..GREATEST(1, COALESCE(p_num_simulations, 3)) LOOP
    INSERT INTO public.simulation_results (
      project_id,
      plant_name,
      status,
      scenario_ids,
      started_at,
      completed_at,
      metrics,
      result_data
    ) VALUES (
      p_project_id,
      v_plant,
      'completed',
      ARRAY[ profile_ids[((i - 1) % GREATEST(1, COALESCE(array_length(profile_ids,1),1))) + 1] ],
      now() - interval '2 days',
      now() - interval '1 days',
      jsonb_build_object(
        'available_kpis', jsonb_build_array('fill_rate','revenue'),
        'baseline', jsonb_build_object(
          'fill_rate', jsonb_build_array(
            jsonb_build_object('day',0,'value',0.96),
            jsonb_build_object('day',7,'value',0.97)
          ),
          'revenue', jsonb_build_array(
            jsonb_build_object('day',0,'value',120000),
            jsonb_build_object('day',7,'value',125000)
          )
        ),
        'scenario', jsonb_build_object(
          'fill_rate', jsonb_build_array(
            jsonb_build_object('day',0,'value',0.90),
            jsonb_build_object('day',7,'value',0.95)
          ),
          'revenue', jsonb_build_array(
            jsonb_build_object('day',0,'value',110000),
            jsonb_build_object('day',7,'value',120000)
          )
        )
      ),
      jsonb_build_object(
        'seed_tag','demo_seed',
        'simulation_period', jsonb_build_object('start_day',0,'end_day',7)
      )
    ) RETURNING id INTO sim_id;

    result_summary := result_summary || jsonb_build_array(jsonb_build_object('simulation_id', sim_id));
  END LOOP;

  RETURN jsonb_build_object('profile_ids', profile_ids, 'simulations', result_summary);
END;
$$;