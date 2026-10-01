-- §4 D259, D260, D261, D264 · THE SIMULATION SCOPE, AND THE BINDINGS (WP 11.2).
--
-- §1  the scope is NAMED, not minted: `current_level_hash(…, 'simulation')` is the
--     snapshot's `inputs` domain digest; no hash moved (`level_spec` 1, schema 3,
--     the stored hashes a fresh rebuild's); the simulation level is registered and
--     the snapshot names its version.
-- §2  a model validated, then a DEEP-TIER edit (the engine does not read it): the
--     model is still found by content (dispatch's stamping door), `model_hash` and its
--     bindings do not move, inheritance accepts it, and an identical submission on the
--     new snapshot is OFFERED FOR REUSE — the RunKey did not move.
-- §3  a multi-tier chain edit (process level; not an engine input): the same.
-- §4  a PRICE edit: the model no longer matches, inheritance refuses it, the RunKey
--     moves (no reuse), and the simulation level is v2.
-- §5  a `bom_multi_level` edit (the engine READS it, though it is a process-level
--     table): the same as §4.
-- §6  an analysis run records the VERSION of the level it keyed on.
-- §7  a card that could not learn its simulation hash still matches on the composite,
--     and the immutability trigger lets a model learn only its own snapshot's hash.
-- §8  the run row binds the simulation hash and version; RunKey is v2.
-- §9  (WP 11.3) the snapshot's tuple, through the one read the browser can reach.

DO $g670$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_scen   uuid := gen_random_uuid();
  v_scen2  uuid := gen_random_uuid();
  v_pv     uuid;
  v_ph     text;
  v_sh     text;
  v_ds1    uuid;
  v_ds2    uuid;
  v_ds3    uuid;
  v_m1     uuid;
  v_mrow   public.model_validations%ROWTYPE;
  v_dv     public.dataset_versions%ROWTYPE;
  v_h      jsonb;
  v_run1   uuid;
  v_res    jsonb;
  v_claim  jsonb;
  v_n      integer;
  v_state  text;
  v_key1   text;
  v_hit    uuid;
  k_proto  jsonb := '{"replications":10,"root_seed":42,"crn":true,"warmup_week":4,"horizon_weeks":52,
                      "analysis_window_weeks":48,"ci_level":0.95,"ci_halfwidth_target":0.05,
                      "stopping_rule":"fixed_horizon"}'::jsonb;
  k_pass   jsonb := '[{"kpi":"fill_rate","ks":0.1,"ks_p":0.6,"t":0.2,"t_p":0.7,"n":40,"source":"weekly series","pass":true}]'::jsonb;
BEGIN
  -- Reference rows a base built from the artifact (`--since HEAD`) has as tables
  -- without their seed; production and a fresh rehearsal both carry them already.
  INSERT INTO public.sim_engines (slug, name, status) VALUES ('scsim', 'scsim', 'active')
    ON CONFLICT (slug) DO NOTHING;
  INSERT INTO public.analysis_kinds (kind, input_scope, fallback_scope, fallback_rule, description) VALUES
    ('process_structure', 'process', NULL, NULL, 'rehearsal seed')
  ON CONFLICT (kind) DO NOTHING;

  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r670@example.invalid', 'R670', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R670', v_user, 'P');
  PERFORM set_config('app.current_user_id', v_user::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications) VALUES
    (v_scen, v_proj, 'R670 baseline', 364, 42, 10),
    (v_scen2, v_proj, 'R670 stress', 364, 42, 10);

  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10);
  INSERT INTO public.products (project_id, product_id) VALUES (v_proj, 'P1');
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit)
    VALUES (v_proj, 'P', 'S1', 'M1', 4, 100, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate)
    VALUES (v_proj, 'P', 'P1', 'M1', 2);

  v_pv := public.snapshot_policy(v_proj, 'R670', v_user);
  v_ph := public.current_policy_hash(v_proj);
  v_sh := public.scenario_fingerprint_hash(v_scen);
  v_ds1 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_ds1;

  -- ══ §1 · named, not minted; nothing moved ══
  v_h := public.project_graph_hashes(v_proj);
  IF public.current_level_hash(v_proj, 'simulation') IS DISTINCT FROM v_h ->> 'hash_inputs'
     OR public._scope_hash_key('simulation') <> 'hash_inputs' THEN
    RAISE EXCEPTION 'R670 §1: the simulation scope is not the inputs domain';
  END IF;
  IF (v_h ->> 'hash_inputs') IS DISTINCT FROM
       encode(extensions.digest((public._build_dataset_snapshot(v_proj) -> 'inputs')::text, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'R670 §1: the simulation hash is not the digest of the snapshot''s inputs domain';
  END IF;
  IF (v_h ->> 'level_spec')::int IS DISTINCT FROM 1
     OR (public._build_dataset_snapshot(v_proj) ->> 'schema_version') IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'R670 §1: a hash rule moved (level_spec %, schema %)', v_h ->> 'level_spec',
      public._build_dataset_snapshot(v_proj) ->> 'schema_version';
  END IF;
  IF (public._dataset_all_hashes(public._build_dataset_snapshot(v_proj)) - 'schema_version' - 'level_spec')
       IS DISTINCT FROM (v_h - 'computed_at' - 'stored' - 'schema_version' - 'level_spec') THEN
    RAISE EXCEPTION 'R670 §1: the stored hashes are not a fresh rebuild''s: % vs %',
      v_h, public._dataset_all_hashes(public._build_dataset_snapshot(v_proj));
  END IF;
  IF v_dv.simulation_version_id IS NULL
     OR (SELECT level_hash FROM public.graph_level_versions WHERE id = v_dv.simulation_version_id) IS DISTINCT FROM v_dv.hash_inputs
     OR (SELECT version_no FROM public.graph_level_versions WHERE id = v_dv.simulation_version_id) <> 1 THEN
    RAISE EXCEPTION 'R670 §1: the snapshot does not name simulation v1';
  END IF;
  IF (public.get_graph_version_state(v_proj) #>> '{levels,simulation,current_version,version_no}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'R670 §1: the state does not say simulation v1';
  END IF;

  -- A model on that world, and a completed run under it.
  v_m1 := public.record_validated_model(v_proj, v_pv, v_ds1, v_scen, 'R670 model', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user);
  SELECT * INTO v_mrow FROM public.model_validations WHERE id = v_m1;
  IF v_mrow.hash_simulation IS DISTINCT FROM v_dv.hash_inputs
     OR v_mrow.simulation_version_id IS DISTINCT FROM v_dv.simulation_version_id
     OR v_mrow.graph_hash IS DISTINCT FROM v_dv.graph_hash THEN
    RAISE EXCEPTION 'R670 §1: the model does not bind the simulation scope beside its snapshot: %', to_jsonb(v_mrow);
  END IF;
  IF v_mrow.model_hash IS DISTINCT FROM public._validated_model_hash(v_ph, v_dv.hash_inputs, v_mrow.scenario_hash,
                                                                     k_proto, v_mrow.engine_fingerprint) THEN
    RAISE EXCEPTION 'R670 §1: model_hash is not over the simulation hash';
  END IF;
  -- …and the list the AI tools derive their badge from carries it (`vvTools.ts`).
  IF (SELECT l.hash_simulation FROM public.list_model_validations(v_proj) l WHERE l.id = v_m1)
       IS DISTINCT FROM v_dv.hash_inputs THEN
    RAISE EXCEPTION 'R670 §1: list_model_validations does not return the model''s simulation hash';
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_hash', v_ph, 'dataset_version_id', v_ds1, 'graph_hash', v_dv.graph_hash,
             'model_validation_id', v_m1, 'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  v_run1 := (v_res ->> 'run_id')::uuid;
  v_key1 := v_res ->> 'run_key';
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 10, ended_at = now() WHERE id = v_run1;

  -- ══ §2 · a deep-tier edit: the model and the key stand ══
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue) VALUES
    (v_proj, 'P', 'F1', 'Firm one', 5), (v_proj, 'P', 'F2', 'Firm two', 7);
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_proj, 'P', 'F1', 'F2', 0.5);
  v_ds2 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_ds2;
  IF v_ds2 = v_ds1 OR v_dv.graph_hash = (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds1) THEN
    RAISE EXCEPTION 'R670 §2: the deep-tier edit did not move the composite — the fixture proves nothing';
  END IF;
  IF v_dv.simulation_version_id IS DISTINCT FROM v_mrow.simulation_version_id THEN
    RAISE EXCEPTION 'R670 §2: a deep-tier edit moved the simulation version';
  END IF;
  SELECT id INTO v_hit FROM public.active_model_validation_by_content(v_proj, v_ph, v_dv.graph_hash, v_sh);
  IF v_hit IS DISTINCT FROM v_m1 THEN
    RAISE EXCEPTION 'R670 §2: after a deep-tier edit dispatch would not stamp the model (found %)', v_hit;
  END IF;
  IF (SELECT model_hash FROM public.model_validations WHERE id = v_m1) IS DISTINCT FROM v_mrow.model_hash
     OR (SELECT status FROM public.model_validations WHERE id = v_m1) <> 'active' THEN
    RAISE EXCEPTION 'R670 §2: the model moved';
  END IF;
  PERFORM public.apply_validation_to_scenario(v_scen2, v_m1, v_user);
  IF (SELECT inherited_validation_id FROM public.scenarios WHERE id = v_scen2) IS DISTINCT FROM v_m1 THEN
    RAISE EXCEPTION 'R670 §2: inheritance refused a model whose inputs are unchanged';
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_hash', v_ph, 'dataset_version_id', v_ds2, 'graph_hash', v_dv.graph_hash,
             'model_validation_id', v_m1, 'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  IF (v_res -> 'reuse' ->> 'run_id')::uuid IS DISTINCT FROM v_run1 OR v_res ->> 'run_key' <> v_key1 THEN
    RAISE EXCEPTION 'R670 §2: an identical simulation after a deep-tier edit was not offered for reuse: %', v_res;
  END IF;
  SELECT count(*) INTO v_n FROM public.find_reusable_runs(v_scen, v_ph, v_dv.hash_inputs, 10) f WHERE f.run_id = v_run1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R670 §2: the read tool''s door disagrees with the dispatcher after a deep-tier edit';
  END IF;

  -- ══ §3 · a multi-tier chain edit (process level, not an engine input): the same ══
  INSERT INTO public.multi_tier_supply_chain (project_id, plant_name, from_firm_id, to_firm_id, to_firm_tier)
    VALUES (v_proj, 'P', 'F1', 'F2', 2);
  v_ds3 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_ds3;
  IF v_dv.process_version_id = (SELECT process_version_id FROM public.dataset_versions WHERE id = v_ds2) THEN
    RAISE EXCEPTION 'R670 §3: a multi-tier edit did not move the process level — the fixture proves nothing';
  END IF;
  SELECT id INTO v_hit FROM public.active_model_validation_by_content(v_proj, v_ph, v_dv.graph_hash, v_sh);
  IF v_hit IS DISTINCT FROM v_m1 THEN
    RAISE EXCEPTION 'R670 §3: a multi-tier edit the engine does not read unstamped the model';
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_hash', v_ph, 'dataset_version_id', v_ds3, 'graph_hash', v_dv.graph_hash,
             'model_validation_id', v_m1, 'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  IF (v_res -> 'reuse' ->> 'run_id')::uuid IS DISTINCT FROM v_run1 THEN
    RAISE EXCEPTION 'R670 §3: a multi-tier edit defeated reuse: %', v_res;
  END IF;

  -- ══ §4 · a price edit: the model no longer matches, the key moves ══
  UPDATE public.materials SET cost = 11 WHERE project_id = v_proj;
  v_ds3 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_ds3;
  IF (SELECT version_no FROM public.graph_level_versions WHERE id = v_dv.simulation_version_id) <> 2 THEN
    RAISE EXCEPTION 'R670 §4: a price edit did not make simulation v2';
  END IF;
  SELECT count(*) INTO v_n FROM public.active_model_validation_by_content(v_proj, v_ph, v_dv.graph_hash, v_sh);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R670 §4: a model validated on other inputs was stamped after a price edit';
  END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.apply_validation_to_scenario(v_scen2, v_m1, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R670 §4: inheritance accepted a model whose simulation inputs changed';
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_hash', v_ph, 'dataset_version_id', v_ds3, 'graph_hash', v_dv.graph_hash,
             'seed', 42, 'disruption_schedule', '[]'::jsonb), false, true, v_user);
  IF v_res ? 'reuse' OR v_res ->> 'run_key' = v_key1 THEN
    RAISE EXCEPTION 'R670 §4: a price edit did not move the RunKey: %', v_res;
  END IF;
  -- back to the validated inputs for §5
  UPDATE public.materials SET cost = 10 WHERE project_id = v_proj;

  -- ══ §5 · bom_multi_level is a process-level table the engine READS ══
  INSERT INTO public.bom_multi_level (project_id, plant_name, material_id, higher_level_component_id, level, consumption_rate)
    VALUES (v_proj, 'P', 'M1', 'P1', 1, 2);
  v_ds3 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_ds3;
  IF v_dv.simulation_version_id = v_mrow.simulation_version_id THEN
    RAISE EXCEPTION 'R670 §5: a bom_multi_level edit did not move the simulation level';
  END IF;
  SELECT count(*) INTO v_n FROM public.active_model_validation_by_content(v_proj, v_ph, v_dv.graph_hash, v_sh);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R670 §5: a model was stamped after an edit to a table the engine reads';
  END IF;
  v_res := public.create_simulation_run(jsonb_build_object(
             'scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
             'policy_hash', v_ph, 'dataset_version_id', v_ds3, 'graph_hash', v_dv.graph_hash,
             'seed', 42, 'disruption_schedule', '[]'::jsonb), false, false, v_user);
  IF v_res ? 'reuse' OR v_res ->> 'run_key' = v_key1 THEN
    RAISE EXCEPTION 'R670 §5: a bom_multi_level edit did not move the RunKey: %', v_res;
  END IF;

  -- ══ §6 · an analysis run records its level's version ══
  v_claim := public.analysis_get_or_start(v_proj, 'process_structure', '{}'::jsonb, 'r670', v_user);
  IF (v_claim ->> 'level_version_id')::uuid IS DISTINCT FROM
     (SELECT process_version_id FROM public.dataset_versions
       WHERE project_id = v_proj AND hash_process = public.current_level_hash(v_proj, 'process')
       ORDER BY created_at, id LIMIT 1) THEN
    RAISE EXCEPTION 'R670 §6: the analysis run does not name its process version: %', v_claim;
  END IF;
  IF (SELECT level_version_id FROM public.analysis_runs WHERE id = (v_claim ->> 'run_id')::uuid) IS NULL THEN
    RAISE EXCEPTION 'R670 §6: the analysis row carries no level version';
  END IF;
  v_claim := public.analysis_get_or_start(v_proj, 'r670_undeclared', '{}'::jsonb, 'r670', v_user);
  IF (v_claim ->> 'input_scope') <> 'all' OR (v_claim ->> 'level_version_id') IS NOT NULL THEN
    RAISE EXCEPTION 'R670 §6: a composite-keyed run named a level version: %', v_claim;
  END IF;

  -- ══ §7 · a card with no simulation hash keeps the composite rule ══
  ALTER TABLE public.model_validations DISABLE TRIGGER model_validations_immutable;
  UPDATE public.model_validations SET hash_simulation = NULL, simulation_version_id = NULL WHERE id = v_m1;
  ALTER TABLE public.model_validations ENABLE TRIGGER model_validations_immutable;
  DELETE FROM public.bom_multi_level WHERE project_id = v_proj;
  DELETE FROM public.multi_tier_supply_chain WHERE project_id = v_proj;
  -- the deep tier is still there, so the composite is v_ds2's, not v_ds1's
  SELECT count(*) INTO v_n FROM public.active_model_validation_by_content(
    v_proj, v_ph, (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds2), v_sh);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R670 §7: a card with no simulation hash matched a composite it was not validated on';
  END IF;
  SELECT count(*) INTO v_n FROM public.active_model_validation_by_content(
    v_proj, v_ph, (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds1), v_sh);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R670 §7: a card with no simulation hash no longer matches its own composite';
  END IF;
  -- …and the one completion the immutability trigger allows: the model may learn the
  -- simulation hash ITS OWN snapshot carries (with that version and the model hash it
  -- implies) — the migration's backfill path — and nothing else.
  v_state := NULL;
  BEGIN
    UPDATE public.model_validations SET hash_simulation = repeat('f', 64) WHERE id = v_m1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R670 §7: a model learnt a simulation hash its snapshot does not carry';
  END IF;
  UPDATE public.model_validations m
     SET hash_simulation = dv.hash_inputs, simulation_version_id = dv.simulation_version_id,
         model_hash = public._validated_model_hash(m.policy_hash, dv.hash_inputs, m.scenario_hash,
                                                   m.protocol, m.engine_fingerprint)
    FROM public.dataset_versions dv
   WHERE m.id = v_m1 AND dv.id = m.dataset_version_id;
  IF (SELECT model_hash FROM public.model_validations WHERE id = v_m1) IS DISTINCT FROM v_mrow.model_hash THEN
    RAISE EXCEPTION 'R670 §7: the backfill completion did not restore the model''s own hash';
  END IF;

  -- ══ §8 · the run row ══
  IF (SELECT hash_simulation FROM public.simulation_runs WHERE id = v_run1)
       IS DISTINCT FROM (SELECT hash_inputs FROM public.dataset_versions WHERE id = v_ds1)
     OR (SELECT simulation_version_id FROM public.simulation_runs WHERE id = v_run1)
       IS DISTINCT FROM (SELECT simulation_version_id FROM public.dataset_versions WHERE id = v_ds1)
     OR (SELECT run_spec ->> 'run_key_version' FROM public.simulation_runs WHERE id = v_run1) <> '2'
     OR (SELECT run_spec ? 'graph_hash' FROM public.simulation_runs WHERE id = v_run1) THEN
    RAISE EXCEPTION 'R670 §8: the run row does not bind the simulation scope under RunKey v2';
  END IF;
  IF (SELECT graph_hash FROM public.simulation_runs WHERE id = v_run1)
       IS DISTINCT FROM (SELECT graph_hash FROM public.dataset_versions WHERE id = v_ds1) THEN
    RAISE EXCEPTION 'R670 §8: the composite left the run row';
  END IF;

  -- ══ §9 · the tuple a person reads (WP 11.3) ══
  -- `dataset_version_tuple` is the one read the browser can reach (the level table's
  -- own policy refuses an unidentified `anon`); the version list carries the same.
  v_h := public.dataset_version_tuple(v_ds1);
  IF (v_h #>> '{simulation,version_no}')::int IS DISTINCT FROM 1
     OR (v_h #>> '{simulation,hash}') IS DISTINCT FROM (SELECT hash_inputs FROM public.dataset_versions WHERE id = v_ds1)
     OR (v_h ->> 'version_no')::int IS DISTINCT FROM (SELECT version_no FROM public.dataset_versions WHERE id = v_ds1)
     OR (v_h #>> '{firm,version_no}') IS NULL THEN
    RAISE EXCEPTION 'R670 §9: the tuple of the first snapshot is wrong: %', v_h;
  END IF;
  IF (SELECT l.tuple FROM public.list_dataset_versions(v_proj) l WHERE l.id = v_ds1) IS DISTINCT FROM v_h THEN
    RAISE EXCEPTION 'R670 §9: the version list and the tuple read disagree';
  END IF;
  IF NOT has_function_privilege('anon', 'public.dataset_version_tuple(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R670 §9: the browser cannot read the tuple';
  END IF;

  RAISE NOTICE 'R670: the simulation scope is named and bound — a deep-tier edit keeps the model and the key; an input edit moves both';
END
$g670$;
