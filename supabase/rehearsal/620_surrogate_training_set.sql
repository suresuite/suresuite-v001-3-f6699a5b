-- §4 D249 · THE SURROGATE-READY TRAINING SET (WP 10.8, blueprint §11.2–§11.4).
--
-- §1 the view holds a validated model's faithful runs, replication by replication,
--    INCLUDING the model's evidence run, which names no model on its own row.
-- §2 it excludes an exploratory run, a run that deviated from the protocol, a run
--    that skipped the required-data gate, an unfinished run, a failed
--    replication, and every run of a revoked model.
-- §3 the summary groups it by Validated Model and Graph Version.
-- §4 the structural features are right on a known network.
-- §5 they are computed ONCE per graph: a second request is a cache hit on the
--    same run; a changed sourcing network is a new run; changing it back is the
--    first run again.
-- §6 the doors: the view runs as its caller, and the feature computation is not
--    an API door.

INSERT INTO public.sim_engines (slug, name, status, capabilities) VALUES
  ('scsim', 'scsim — the strategic engine', 'active', '{"compute": ["worker", "browser"]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
-- The catalog's rows are data; a base built from an artifact that already holds
-- the migration has the table without them (as 570).
INSERT INTO public.analysis_kinds (kind, input_scope, fallback_scope, fallback_rule, description) VALUES
  ('feature_spec', 'product', NULL, NULL, 'rehearsal seed')
ON CONFLICT (kind) DO NOTHING;

DO $st620$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_proj  uuid := gen_random_uuid();
  v_scen  uuid := gen_random_uuid();
  v_pv    uuid;
  v_ds    uuid;
  v_m     uuid;
  v_m2    uuid;
  v_ev    uuid;
  v_good  uuid;
  v_expl  uuid;
  v_dev   uuid;
  v_skip  uuid;
  v_run   uuid;
  v_rev   uuid;
  v_f1    jsonb;
  v_f2    jsonb;
  v_n     bigint;
  v_sum   jsonb;
  k_proto jsonb := '{"replications":2,"root_seed":42,"crn":true,"warmup_week":0,"horizon_weeks":3,"analysis_window_weeks":3,
                     "ci_level":0.95,"ci_halfwidth_target":0.05,"stopping_rule":"fixed_horizon"}'::jsonb;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r620@example.invalid', 'R620', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R620', v_user, 'P');
  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_proj AND user_id = v_user) THEN
    INSERT INTO public.project_members (project_id, user_id, project_role) VALUES (v_proj, v_user, 'owner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  PERFORM set_config('app.current_user_id', v_user::text, true);

  -- A sourcing network: S1 → M1, M2; S2 → M2; S3 → M3. M1 and M3 single-sourced,
  -- M2 dual-sourced. Weekly volumes 100 + 50 (S1), 30 (S2), 4 per day = 28 (S3).
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1'), (v_proj, 'S2'), (v_proj, 'S3');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10), (v_proj, 'M2', 10), (v_proj, 'M3', 10);
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit) VALUES
    (v_proj, 'P', 'S1', 'M1', 4, 100, 'week'), (v_proj, 'P', 'S1', 'M2', 4, 50, 'week'),
    (v_proj, 'P', 'S2', 'M2', 4, 30, 'week'), (v_proj, 'P', 'S3', 'M3', 4, 4, 'day');

  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed) VALUES (v_scen, v_proj, 'R620', 21, 42);
  v_ds := public.snapshot_dataset(v_proj, NULL, v_user);
  v_pv := public.snapshot_policy(v_proj, 'R620', v_user);

  -- The evidence run: dispatched before any model, so it names none and is exploratory.
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id)
    VALUES (v_scen, v_proj, 'done', 2, 2, 'scsim-0.2.8', v_ds, v_pv) RETURNING id INTO v_ev;
  v_m := public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'R620 model', k_proto,
    'engine', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'face', 'Reviewed with operations.', v_ev, '{}'::jsonb, v_user);
  v_m2 := public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'R620 revoked model',
    k_proto || '{"replications":3}'::jsonb,
    'engine', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'face', 'Reviewed with operations.', NULL, '{}'::jsonb, v_user);

  -- One faithful run of the model, and four that must not train anything.
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'done', 2, 2, 'scsim-0.2.8', v_ds, v_pv, v_m, false, '{}', false) RETURNING id INTO v_good;
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'done', 2, 2, 'scsim-0.2.8', v_ds, v_pv, v_m, true, '{}', false) RETURNING id INTO v_expl;
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'done', 2, 2, 'scsim-0.2.8', v_ds, v_pv, v_m, false, '{"replications": 5}', false) RETURNING id INTO v_dev;
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'done', 2, 2, 'scsim-0.2.8', v_ds, v_pv, v_m, false, '{}', true) RETURNING id INTO v_skip;
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'running', 2, 1, 'scsim-0.2.8', v_ds, v_pv, v_m, false, '{}', false) RETURNING id INTO v_run;
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
                                      dataset_version_id, policy_version_id, model_validation_id, exploratory, protocol_overrides, gate_skipped)
  VALUES (v_scen, v_proj, 'done', 3, 3, 'scsim-0.2.8', v_ds, v_pv, v_m2, false, '{}', false) RETURNING id INTO v_rev;

  -- Two replications each; the faithful run's second one failed.
  INSERT INTO public.run_replications (run_id, project_id, rep_index, seed_used, status, kpis)
  SELECT r, v_proj, i, 42, CASE WHEN r = v_good AND i = 1 THEN 'failed' ELSE 'done' END,
         jsonb_build_object('fill_rate', 0.9 + i / 100.0, 'model_rep', i, 'event_rep', 0)
    FROM unnest(ARRAY[v_ev, v_good, v_expl, v_dev, v_skip, v_run, v_rev]) r, generate_series(0, 1) i;
  PERFORM public.revoke_model_validation(v_m2, v_user, 'R620 revocation');

  -- ══ §1 · a model's faithful runs, its evidence run included ══
  SELECT count(*) INTO v_n FROM public.surrogate_training_runs WHERE project_id = v_proj;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'R620 §1/§2: the training set holds % replications, not 3 (evidence 2 + faithful 1): %', v_n,
      (SELECT jsonb_agg(jsonb_build_object('run', run_id, 'rep', rep_index)) FROM public.surrogate_training_runs WHERE project_id = v_proj);
  END IF;
  IF (SELECT count(*) FROM public.surrogate_training_runs WHERE run_id = v_ev AND is_evidence_run
         AND validated_model_id = v_m AND graph_version_id = v_ds) <> 2 THEN
    RAISE EXCEPTION 'R620 §1: the model''s evidence run is not in its training set (D249)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.surrogate_training_runs WHERE run_id = v_good AND rep_index = 0
                    AND model_rep = 0 AND event_rep = 0 AND root_seed = 42 AND (kpis ->> 'fill_rate')::numeric = 0.9) THEN
    RAISE EXCEPTION 'R620 §1: the faithful run''s replication is missing its cell or KPIs';
  END IF;

  -- ══ §2 · and nothing else ══
  IF EXISTS (SELECT 1 FROM public.surrogate_training_runs
              WHERE run_id IN (v_expl, v_dev, v_skip, v_run, v_rev) OR (run_id = v_good AND rep_index = 1)) THEN
    RAISE EXCEPTION 'R620 §2: an exploratory, deviating, gate-skipped, unfinished, failed or revoked-model replication is training data: %',
      (SELECT jsonb_agg(DISTINCT run_id) FROM public.surrogate_training_runs
        WHERE run_id IN (v_expl, v_dev, v_skip, v_run, v_rev));
  END IF;

  -- ══ §3 · grouped by model and graph version ══
  v_sum := public.surrogate_training_summary(v_proj);
  IF jsonb_array_length(v_sum) <> 1 OR (v_sum -> 0 ->> 'runs')::int <> 2 OR (v_sum -> 0 ->> 'replications')::int <> 3
     OR (v_sum -> 0 ->> 'validated_model_id')::uuid <> v_m OR NOT (v_sum -> 0 ->> 'includes_evidence_run')::boolean THEN
    RAISE EXCEPTION 'R620 §3: the summary is not one group of 2 runs / 3 replications: %', v_sum;
  END IF;

  -- ══ §4 · the features are right ══
  v_f1 := public.surrogate_feature_spec(v_proj, v_user);
  IF (v_f1 -> 'features' ->> 'suppliers')::int <> 3 OR (v_f1 -> 'features' ->> 'materials_sourced')::int <> 3
     OR (v_f1 -> 'features' ->> 'edges')::int <> 4 OR (v_f1 -> 'features' ->> 'max_out_degree')::int <> 2
     OR (v_f1 -> 'features' ->> 'single_sourced_count')::int <> 2
     OR round((v_f1 -> 'features' ->> 'multi_source_rate')::numeric, 4) <> 0.3333
     OR round((v_f1 -> 'features' ->> 'mean_out_degree')::numeric, 4) <> 1.3333
     OR round((v_f1 -> 'features' ->> 'mean_weighted_out_degree')::numeric, 4) <> 69.3333 THEN
    RAISE EXCEPTION 'R620 §4: the features are wrong: %', v_f1;
  END IF;
  IF (SELECT (metrics ->> 'weighted_out_degree')::numeric FROM public.analysis_results
       WHERE run_id = (v_f1 ->> 'run_id')::uuid AND entity_type = 'supplier' AND entity_id = 'S3') <> 28 THEN
    RAISE EXCEPTION 'R620 §4: a daily lane was not weighted per week';
  END IF;
  IF (v_f1 ->> 'cache_hit')::boolean OR (v_f1 ->> 'input_scope') <> 'product' THEN
    RAISE EXCEPTION 'R620 §4: the first request was not a fresh product-level run: %', v_f1;
  END IF;

  -- ══ §5 · once per graph ══
  v_f2 := public.surrogate_feature_spec(v_proj, v_user);
  IF NOT (v_f2 ->> 'cache_hit')::boolean OR v_f2 ->> 'run_id' <> v_f1 ->> 'run_id' OR v_f2 -> 'features' <> v_f1 -> 'features' THEN
    RAISE EXCEPTION 'R620 §5: a second request for the same graph recomputed: % vs %', v_f2, v_f1;
  END IF;
  UPDATE public.inbound_logistics SET supplier_id = 'S2' WHERE project_id = v_proj AND supplier_id = 'S3';
  v_f2 := public.surrogate_feature_spec(v_proj, v_user);
  IF (v_f2 ->> 'cache_hit')::boolean OR v_f2 ->> 'run_id' = v_f1 ->> 'run_id'
     OR (v_f2 -> 'features' ->> 'suppliers')::int <> 2 THEN
    RAISE EXCEPTION 'R620 §5: a changed sourcing network served the old features: %', v_f2;
  END IF;
  UPDATE public.inbound_logistics SET supplier_id = 'S3' WHERE project_id = v_proj AND material_id = 'M3';
  v_f2 := public.surrogate_feature_spec(v_proj, v_user);
  IF NOT (v_f2 ->> 'cache_hit')::boolean OR v_f2 ->> 'run_id' <> v_f1 ->> 'run_id' THEN
    RAISE EXCEPTION 'R620 §5: the restored network did not return its first features: %', v_f2;
  END IF;
  SELECT count(*) INTO v_n FROM public.analysis_runs WHERE project_id = v_proj AND analysis_kind = 'feature_spec';
  IF v_n <> 2 THEN RAISE EXCEPTION 'R620 §5: % feature runs for two graphs', v_n; END IF;

  -- ══ §6 · the doors ══
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.surrogate_training_runs'::regclass
                    AND 'security_invoker=true' = ANY (c.reloptions)) THEN
    RAISE EXCEPTION 'R620 §6: the training view runs as its owner';
  END IF;
  IF has_function_privilege('anon', 'public._feature_spec_compute(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._feature_spec_compute(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R620 §6: the feature computation is an API door';
  END IF;

  RAISE NOTICE 'R620 ok — faithful runs and evidence in, the rest out, features once per graph';
END
$st620$;
