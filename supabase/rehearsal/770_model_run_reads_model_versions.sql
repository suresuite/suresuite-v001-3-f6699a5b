-- PLAN.md §23 WP 13.3 · §4 D280 — RUN, VALIDATE, SAVE THE MODEL: BOTH VERSIONS FROZEN.
--
-- What only a running database can settle:
--
--   §1 "Save version & run" freezes the data DEDUPLICATED BY CONTENT: two snapshots
--      of an unchanged project are one dataset version; a live edit makes another.
--   §2 A Validated Model names its two versions; after a LIVE EDIT, a run that
--      follows the model and names the model's dataset version is created bound to
--      THAT version — its simulation hash is the model's, not the live project's —
--      and an identical run after a second edit is offered for reuse (the key did
--      not move with the live data).
--   §3 A run that names the model but the LIVE dataset version is REFUSED
--      (`20261002000009`), and so is one naming other policies.
--   §4 "Run current data as exploratory" — the model's policies on the live data,
--      naming no model — is created, exploratory, bound to the live version.

DO $wp133$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_scen   uuid := gen_random_uuid();
  v_pv     uuid;
  v_ph     text;
  v_dsA    uuid;
  v_dsA2   uuid;
  v_dsB    uuid;
  v_m      uuid;
  v_simA   text;
  v_res    jsonb;
  v_run    uuid;
  v_key    text;
  v_row    public.simulation_runs%ROWTYPE;
  v_state  text;
  k_proto  jsonb := '{"replications":10,"root_seed":42,"crn":true,"warmup_week":4,"horizon_weeks":52,
                      "analysis_window_weeks":48,"ci_level":0.95,"ci_halfwidth_target":0.05,
                      "stopping_rule":"fixed_horizon"}'::jsonb;
  k_pass   jsonb := '[{"kpi":"fill_rate","ks":0.1,"ks_p":0.6,"t":0.2,"t_p":0.7,"n":40,"source":"weekly series","pass":true}]'::jsonb;
BEGIN
  INSERT INTO public.sim_engines (slug, name, status) VALUES ('scsim', 'scsim', 'active')
    ON CONFLICT (slug) DO NOTHING;
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r770@example.invalid', 'R770', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R770', v_user, 'P');
  PERFORM set_config('app.current_user_id', v_user::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications) VALUES
    (v_scen, v_proj, 'R770 baseline', 364, 42, 10);
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10);
  INSERT INTO public.products (project_id, product_id) VALUES (v_proj, 'P1');
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit)
    VALUES (v_proj, 'P', 'S1', 'M1', 4, 100, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate)
    VALUES (v_proj, 'P', 'P1', 'M1', 2);

  v_pv := public.snapshot_policy(v_proj, 'R770', v_user);
  v_ph := public.current_policy_hash(v_proj);

  -- ══ §1 · the dataset version is deduplicated by content ══
  v_dsA  := public.snapshot_dataset(v_proj, NULL, v_user);
  v_dsA2 := public.snapshot_dataset(v_proj, NULL, v_user);
  IF v_dsA2 IS DISTINCT FROM v_dsA THEN
    RAISE EXCEPTION 'R770 §1: two snapshots of an unchanged project made two dataset versions';
  END IF;
  SELECT hash_inputs INTO v_simA FROM public.dataset_versions WHERE id = v_dsA;

  -- ══ §2 · a model on A; a live edit; the model's run binds A ══
  v_m := public.record_validated_model(v_proj, v_pv, v_dsA, v_scen, 'R770 model', k_proto, 'mser5',
           '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user);
  IF (SELECT dataset_version_id FROM public.model_validations WHERE id = v_m) IS DISTINCT FROM v_dsA
     OR (SELECT policy_version_id FROM public.model_validations WHERE id = v_m) IS DISTINCT FROM v_pv THEN
    RAISE EXCEPTION 'R770 §2: the model does not bind both of its versions';
  END IF;

  UPDATE public.materials SET cost = 25 WHERE project_id = v_proj AND material_id = 'M1';   -- the live edit
  v_dsB := public.snapshot_dataset(v_proj, NULL, v_user);
  IF v_dsB = v_dsA OR (SELECT hash_inputs FROM public.dataset_versions WHERE id = v_dsB) = v_simA THEN
    RAISE EXCEPTION 'R770 §2: the live edit did not move the simulation inputs — the fixture proves nothing';
  END IF;

  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_version_id', v_pv, 'policy_hash', v_ph, 'dataset_version_id', v_dsA,
             'graph_hash', (SELECT graph_hash FROM public.dataset_versions WHERE id = v_dsA),
             'model_validation_id', v_m, 'exploratory', false,
             'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  v_run := (v_res ->> 'run_id')::uuid;
  v_key := v_res ->> 'run_key';
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_run;
  IF v_row.dataset_version_id IS DISTINCT FROM v_dsA OR v_row.hash_simulation IS DISTINCT FROM v_simA
     OR v_row.model_validation_id IS DISTINCT FROM v_m OR v_row.exploratory THEN
    RAISE EXCEPTION 'R770 §2: the model run is not bound to the model''s dataset version after a live edit: %',
      to_jsonb(v_row) - 'run_spec';
  END IF;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 10, ended_at = now() WHERE id = v_run;
  UPDATE public.materials SET cost = 40 WHERE project_id = v_proj AND material_id = 'M1';   -- a second edit
  PERFORM public.snapshot_dataset(v_proj, NULL, v_user);
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_version_id', v_pv, 'policy_hash', v_ph, 'dataset_version_id', v_dsA,
             'model_validation_id', v_m, 'exploratory', false,
             'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  IF (v_res -> 'reuse' ->> 'run_id')::uuid IS DISTINCT FROM v_run OR v_res ->> 'run_key' <> v_key THEN
    RAISE EXCEPTION 'R770 §2: a second live edit moved the model run''s key: %', v_res;
  END IF;

  -- ══ §3 · a run naming the model with the LIVE data, or other policies, is refused ══
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object(
               'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
               'policy_version_id', v_pv, 'policy_hash', v_ph, 'dataset_version_id', v_dsB,
               'model_validation_id', v_m, 'exploratory', false,
               'seed', 42, 'disruption_schedule', '[]'::jsonb), true, false, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R770 §3: a run naming the model was created on data the model was not validated on';
  END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.create_simulation_run(jsonb_build_object(
               'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
               'policy_version_id', v_pv, 'policy_hash', 'not-the-model-policies', 'dataset_version_id', v_dsA,
               'model_validation_id', v_m, 'exploratory', false,
               'seed', 42, 'disruption_schedule', '[]'::jsonb), true, false, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R770 §3: a run naming the model was created with other policies';
  END IF;

  -- ══ §4 · current data as exploratory: no model, the live version, exploratory ══
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_version_id', v_pv, 'policy_hash', v_ph, 'dataset_version_id', v_dsB,
             'exploratory', true, 'seed', 42, 'disruption_schedule', '[]'::jsonb), true, false, v_user);
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = (v_res ->> 'run_id')::uuid;
  IF v_row.id IS NULL OR NOT v_row.exploratory OR v_row.model_validation_id IS NOT NULL
     OR v_row.dataset_version_id IS DISTINCT FROM v_dsB THEN
    RAISE EXCEPTION 'R770 §4: the current-data exploratory run is not what it says: %', to_jsonb(v_row) - 'run_spec';
  END IF;

  RAISE NOTICE 'WP 13.3: a model run reads the model''s two versions after a live edit; other data under the model is refused; current data runs as exploratory';
END $wp133$;
