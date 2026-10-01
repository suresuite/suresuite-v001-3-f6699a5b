-- §4 D245, D248 · ENGINES, RUNKEY, AND THE RESULT BINDING ON THE ROW (WP 10.4).
--
-- §1 the registry: scsim active, the legacy engine retired; dispatch defaults to
--    the single active engine, refuses a retired one, an unknown one, and a
--    choice between two active ones it was not told to make.
-- §2 the worker's boot report updates the row it runs and never creates one.
-- §3 ONE run identity: identical inputs give one RunKey; a seed, an engine build
--    or a protocol override moves it; a scenario RENAME does not.
-- §4 identical submissions make ONE run: in flight → attached; done → offered for
--    reuse with no new row; forced → a new row; a browser-computed run never
--    attaches. `find_reusable_runs` (the AI read tool's door) agrees with the
--    dispatcher's.
-- §5 every new run row resolves its bindings FROM THE ROW: editing the live
--    scenario after dispatch moves nothing the run recorded.
-- §6 a writer that states none of it (the deploy window) still writes a whole
--    row: the class is derived from the stamp, the engine from the code version.
-- §7 §4 D248: no internal (`_`-prefixed) SECURITY DEFINER function, and neither
--    of the two service-only RPCs, is EXECUTABLE by anon or authenticated.
-- §8 a Validated Model names the engine its evidence recorded.

-- The registry rows are seeded by the migration; a base built from an artifact
-- that already holds the migration has the table and not the rows (as 570).
INSERT INTO public.sim_engines (slug, name, status, capabilities) VALUES
  ('scsim', 'scsim — the strategic engine', 'active', '{"compute": ["worker", "browser"]}'::jsonb),
  ('legacy-worker', 'Legacy worker engine (frozen)', 'retired', '{"compute": ["worker"]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

DO $rk590$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_scen   uuid := gen_random_uuid();
  v_scsim  uuid;
  v_legacy uuid;
  v_eng    public.sim_engines%ROWTYPE;
  v_state  text;
  v_k1     text;
  v_k2     text;
  v_res    jsonb;
  v_res2   jsonb;
  v_run1   uuid;
  v_run2   uuid;
  v_n      integer;
  v_row    public.simulation_runs%ROWTYPE;
  v_names  text;
  v_base   jsonb;
  k_ph     text := repeat('a', 64);
  k_gh     text := repeat('b', 64);
BEGIN
  SELECT id INTO v_scsim FROM public.sim_engines WHERE slug = 'scsim';
  SELECT id INTO v_legacy FROM public.sim_engines WHERE slug = 'legacy-worker';

  -- ══ §1 · the registry ══
  v_eng := public.sim_engine_for_dispatch(NULL);
  IF v_eng.id IS DISTINCT FROM v_scsim THEN
    RAISE EXCEPTION 'R590 §1: the default engine is % — scsim is the single active one', v_eng.slug;
  END IF;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_for_dispatch(v_legacy);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R590 §1: the retired legacy engine was accepted for dispatch'; END IF;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_for_dispatch(gen_random_uuid());
  EXCEPTION WHEN no_data_found THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R590 §1: an unknown engine was accepted'; END IF;
  UPDATE public.sim_engines SET status = 'active' WHERE id = v_legacy;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_for_dispatch(NULL);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  UPDATE public.sim_engines SET status = 'retired' WHERE id = v_legacy;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R590 §1: with two active engines dispatch picked one silently'; END IF;

  -- ══ §2 · the boot report ══
  PERFORM public.sim_engine_report('scsim', '0.2.8', 'scsim-0.2.8', NULL);
  SELECT * INTO v_eng FROM public.sim_engines WHERE id = v_scsim;
  IF v_eng.code_version IS DISTINCT FROM 'scsim-0.2.8' OR v_eng.reported_at IS NULL THEN
    RAISE EXCEPTION 'R590 §2: the report did not land: %', to_jsonb(v_eng);
  END IF;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_report('made-up', '1', 'made-up-1', NULL);
  EXCEPTION WHEN no_data_found THEN v_state := 'refused'; END;
  IF v_state IS NULL OR EXISTS (SELECT 1 FROM public.sim_engines WHERE slug = 'made-up') THEN
    RAISE EXCEPTION 'R590 §2: a report created an engine the registry did not know';
  END IF;

  -- ══ §3 · one run identity ══
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r590@example.invalid', 'R590', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R590', v_user, 'P');
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications)
    VALUES (v_scen, v_proj, 'R590 baseline', 364, 42, 10);
  v_k1 := public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh));
  v_k2 := public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh));
  IF v_k1 IS DISTINCT FROM v_k2 OR length(v_k1) <> 64 THEN
    RAISE EXCEPTION 'R590 §3: one input gave two RunKeys';
  END IF;
  UPDATE public.scenarios SET name = 'R590 baseline (renamed)', description = 'a note' WHERE id = v_scen;
  IF public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh)) IS DISTINCT FROM v_k1 THEN
    RAISE EXCEPTION 'R590 §3: renaming a scenario moved its RunKey — reuse would be thrown away for a label';
  END IF;
  UPDATE public.scenarios SET seed = 43 WHERE id = v_scen;
  IF public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh)) = v_k1 THEN
    RAISE EXCEPTION 'R590 §3: a different seed kept the RunKey — a false reuse';
  END IF;
  UPDATE public.scenarios SET seed = 42 WHERE id = v_scen;
  PERFORM public.sim_engine_report('scsim', '0.2.9', 'scsim-0.2.9', NULL);
  IF public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh)) = v_k1 THEN
    RAISE EXCEPTION 'R590 §3: a new engine build kept the RunKey — D245 again';
  END IF;
  PERFORM public.sim_engine_report('scsim', '0.2.8', 'scsim-0.2.8', NULL);
  IF public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh, NULL, '{"replications": 5}')) = v_k1 THEN
    RAISE EXCEPTION 'R590 §3: a protocol override kept the RunKey';
  END IF;
  IF public.simulation_run_key(public.simulation_run_spec(v_scen, k_ph, k_gh)) IS DISTINCT FROM v_k1 THEN
    RAISE EXCEPTION 'R590 §3: restoring every input did not restore the RunKey';
  END IF;

  -- ══ §4 · identical submissions → one run ══
  v_base := jsonb_build_object('scenario_id', v_scen, 'project_id', v_proj, 'rep_count_target', 10,
              -- WP 11.2: the key's graph term is the SIMULATION scope, which a run reads
              -- from its snapshot or, with none (as here), from the caller. `k_gh` stands
              -- for both, so the read tool's door below keys on the same value.
              'policy_hash', k_ph, 'graph_hash', k_gh, 'hash_simulation', k_gh, 'seed', 42,
              'disruption_schedule', '[]'::jsonb);
  v_res := public.create_simulation_run(v_base, false, true, v_user);
  v_run1 := (v_res ->> 'run_id')::uuid;
  IF v_run1 IS NULL OR (v_res ->> 'attached')::boolean THEN
    RAISE EXCEPTION 'R590 §4: the first submission did not create a run: %', v_res;
  END IF;
  v_res2 := public.create_simulation_run(v_base, false, true, v_user);
  SELECT count(*) INTO v_n FROM public.simulation_runs WHERE scenario_id = v_scen;
  IF (v_res2 ->> 'run_id')::uuid IS DISTINCT FROM v_run1 OR NOT (v_res2 ->> 'attached')::boolean OR v_n <> 1 THEN
    RAISE EXCEPTION 'R590 §4: a second identical submission in flight made % run(s): %', v_n, v_res2;
  END IF;
  -- A browser-computed run is computed by the browser that asked: never attached.
  v_res2 := public.create_simulation_run(v_base, false, false, v_user);
  v_run2 := (v_res2 ->> 'run_id')::uuid;
  IF v_run2 IS NULL OR v_run2 = v_run1 THEN
    RAISE EXCEPTION 'R590 §4: a browser-computed run was attached to another run: %', v_res2;
  END IF;
  DELETE FROM public.simulation_runs WHERE id = v_run2;
  UPDATE public.simulation_runs SET status = 'done', rep_count_done = 10, code_version = 'scsim-0.2.8',
         ended_at = now() WHERE id = v_run1;
  v_res2 := public.create_simulation_run(v_base, false, true, v_user);
  SELECT count(*) INTO v_n FROM public.simulation_runs WHERE scenario_id = v_scen;
  IF (v_res2 -> 'reuse' ->> 'run_id')::uuid IS DISTINCT FROM v_run1 OR v_n <> 1 THEN
    RAISE EXCEPTION 'R590 §4: a completed identical run was not offered for reuse (% rows): %', v_n, v_res2;
  END IF;
  SELECT count(*) INTO v_n FROM public.find_reusable_runs(v_scen, k_ph, k_gh, 10) f WHERE f.run_id = v_run1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R590 §4: find_reusable_runs (the read tool''s door) disagrees with the dispatcher';
  END IF;
  SELECT count(*) INTO v_n FROM public.find_reusable_runs(v_scen, k_ph, k_gh, 20);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R590 §4: a 10-replication run was offered for a 20-replication request';
  END IF;
  v_res2 := public.create_simulation_run(v_base, true, true, v_user);
  SELECT count(*) INTO v_n FROM public.simulation_runs WHERE scenario_id = v_scen;
  IF v_n <> 2 OR (v_res2 ->> 'run_id')::uuid = v_run1 THEN
    RAISE EXCEPTION 'R590 §4: force_rerun did not create a new run';
  END IF;

  -- ══ §5 · the bindings live on the row ══
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_run1;
  IF v_row.engine_id IS DISTINCT FROM v_scsim OR v_row.run_key IS DISTINCT FROM v_k1
     OR public.simulation_run_key(v_row.run_spec) IS DISTINCT FROM v_row.run_key
     OR v_row.run_spec -> 'engine' ->> 'code_version' IS DISTINCT FROM 'scsim-0.2.8'
     OR v_row.run_spec ->> 'policy_hash' IS DISTINCT FROM k_ph
     OR v_row.run_spec ->> 'simulation_hash' IS DISTINCT FROM k_gh   -- RunKey v2 (WP 11.2)
     OR v_row.hash_simulation IS DISTINCT FROM k_gh
     OR (v_row.run_spec -> 'scenario' ->> 'horizon_days')::int IS DISTINCT FROM 364
     OR v_row.protocol_overrides IS DISTINCT FROM '{}'::jsonb
     OR v_row.exploratory IS NOT TRUE THEN
    RAISE EXCEPTION 'R590 §5: the run row does not carry its bindings: %', to_jsonb(v_row) - 'run_spec';
  END IF;
  UPDATE public.scenarios SET seed = 7, horizon_days = 728 WHERE id = v_scen;
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_run1;
  IF (v_row.run_spec -> 'scenario' ->> 'seed')::int <> 42
     OR (v_row.run_spec -> 'scenario' ->> 'horizon_days')::int <> 364 THEN
    RAISE EXCEPTION 'R590 §5: editing the live scenario moved what the run recorded';
  END IF;

  -- ══ §6 · the deploy-window writer ══
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version)
    VALUES (v_scen, v_proj, 'queued', 1, 0, '') RETURNING id INTO v_run2;
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_run2;
  IF v_row.exploratory IS NOT TRUE OR v_row.engine_id IS NOT NULL THEN
    RAISE EXCEPTION 'R590 §6: an unstated class/engine was not derived: %', to_jsonb(v_row) - 'run_spec';
  END IF;
  -- The browser engine persists its results AS ANON, so the derivation must run
  -- with anon's privileges — a helper only the owner could execute would fail
  -- every browser-computed run here.
  SET LOCAL ROLE anon;
  UPDATE public.simulation_runs SET code_version = 'worker-legacy' WHERE id = v_run2;
  RESET ROLE;
  IF (SELECT engine_id FROM public.simulation_runs WHERE id = v_run2) IS DISTINCT FROM v_legacy THEN
    RAISE EXCEPTION 'R590 §6: the engine was not derived from the code version the writer stamped';
  END IF;

  -- ══ §7 · §4 D248 — nothing internal is an API ══
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'R590 §7 (D248): internal SECURITY DEFINER helper(s) executable through the API: %', v_names;
  END IF;
  IF has_function_privilege('anon', 'public.create_simulation_run(jsonb,boolean,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_simulation_run(jsonb,boolean,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sim_engine_report(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R590 §7: a service-only RPC is executable through the API';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.create_simulation_run(jsonb,boolean,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R590 §7: the dispatcher (service_role) cannot create a run';
  END IF;

  -- ══ §8 · the model names its engine ══
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_validations_engine_id_fkey') THEN
    RAISE EXCEPTION 'R590 §8: model_validations.engine_id has no foreign key';
  END IF;
  IF public._engine_for_code_version('scsim-0.2.8') IS DISTINCT FROM v_scsim
     OR public._engine_for_code_version('worker-legacy') IS DISTINCT FROM v_legacy
     OR public._engine_for_code_version('something-else') IS NOT NULL THEN
    RAISE EXCEPTION 'R590 §8: a code version resolves to the wrong engine';
  END IF;

  RAISE NOTICE 'R590 ok — registry, boot report, one RunKey, one run, bindings on the row, the deploy window, D248, the model''s engine';
END
$rk590$;
