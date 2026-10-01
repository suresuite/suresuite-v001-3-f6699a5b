-- §4 D246 · RESULT STORAGE TIERS, PINNING, RETENTION (WP 10.6).
--
-- §1 a standard run gets its expiry when it completes, and a run that keeps its
--    series in the rows gets their size.
-- §2 the sweep removes an expired run's SERIES — the object pointer, the JSONB
--    series, the per-item rows — and KEEPS the summary: the run row, its
--    aggregates, every replication's KPI row. It records when.
-- §3 a Validated Model's evidence run is evidence the moment the model is saved,
--    and the sweep never touches it; a pinned run is never touched either.
-- §4 pinning is an editor's or owner's, never a viewer's; evidence cannot be
--    released; an expired run cannot be pinned back to life.
-- §5 the sweep and the evidence trigger are not API doors.
-- §6 a deleted run QUEUES its series object, and the next sweep hands it over for
--    removal through the Storage API — neither ever deletes a `storage.objects`
--    row with SQL, which orphans the file and which hosted Supabase refuses
--    (WP 10.9 · §4 D252; the stand-in below refuses it the same way).

-- Supabase's `storage.objects`, reduced to the two columns the sweep and the
-- delete trigger read. The prelude creates the schema and not the table, so
-- without this every object path in §2 and §6 would skip on its guard and pass
-- for the wrong reason.
CREATE TABLE IF NOT EXISTS storage.objects (bucket_id text, name text);
-- Hosted Supabase refuses a direct delete on its storage tables; so does this.
CREATE OR REPLACE FUNCTION storage._r600_refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'; END $$;
DROP TRIGGER IF EXISTS r600_refuse_delete ON storage.objects;
CREATE TRIGGER r600_refuse_delete BEFORE DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION storage._r600_refuse_delete();

DO $rt600$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_scen   uuid := gen_random_uuid();
  v_std    uuid;
  v_pin    uuid;
  v_ev     uuid;
  v_pv     uuid;
  v_ds     uuid;
  v_row    public.simulation_runs%ROWTYPE;
  v_res    jsonb;
  v_n      integer;
  v_state  text;
  k_series jsonb := '{"fill_rate":[0.9,0.95,1.0],"on_hand_units":[10,11,12]}'::jsonb;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_owner, 'r600@example.invalid', 'R600', 'x'), (v_viewer, 'r600v@example.invalid', 'R600 viewer', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R600', v_owner, 'P');
  IF NOT EXISTS (SELECT 1 FROM public.project_members WHERE project_id = v_proj AND user_id = v_owner) THEN
    INSERT INTO public.project_members (project_id, user_id, project_role) VALUES (v_proj, v_owner, 'owner');
  END IF;
  INSERT INTO public.project_members (project_id, user_id, project_role) VALUES (v_proj, v_viewer, 'viewer')
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed) VALUES (v_scen, v_proj, 'R600', 21, 42);

  -- Three runs, each with two replications carrying series and one item row.
  FOR i IN 1..3 LOOP
    INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version)
      VALUES (v_scen, v_proj, 'running', 2, 0, 'scsim-0.2.8')
      RETURNING id INTO v_row.id;
    INSERT INTO public.run_replications (run_id, project_id, rep_index, seed_used, status, kpis, time_series)
      VALUES (v_row.id, v_proj, 0, 42, 'done', '{"fill_rate":0.95,"model_rep":0,"event_rep":0}', k_series),
             (v_row.id, v_proj, 1, 42, 'done', '{"fill_rate":0.93,"model_rep":1,"event_rep":0}', k_series);
    INSERT INTO public.run_item_series (run_id, project_id, kind, item_id, series)
      VALUES (v_row.id, v_proj, 'product', 'P1', '{"on_hand":[1,2,3]}');
    IF i = 1 THEN v_std := v_row.id; ELSIF i = 2 THEN v_pin := v_row.id; ELSE v_ev := v_row.id; END IF;
  END LOOP;

  -- ══ §1 · completion sets expiry and size ══
  UPDATE public.simulation_runs
     SET status = 'done', rep_count_done = 2, ended_at = now(),
         aggregate_kpis = '{"fill_rate":0.94,"_range":{"fill_rate":{"min":0.93,"max":0.95}}}'
   WHERE id IN (v_std, v_pin, v_ev);
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_std;
  IF v_row.retention <> 'standard' OR v_row.series_expires_at IS NULL
     OR v_row.series_expires_at < now() + interval '89 days' OR COALESCE(v_row.series_bytes, 0) <= 0 THEN
    RAISE EXCEPTION 'R600 §1: completion did not set expiry and size: %', to_jsonb(v_row) - 'run_spec';
  END IF;

  -- ══ §3 · evidence by construction, and pinning ══
  v_ds := public.snapshot_dataset(v_proj, NULL, v_owner);
  v_pv := public.snapshot_policy(v_proj, 'R600', v_owner);
  PERFORM public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'R600 model',
    '{"replications":2,"root_seed":42,"crn":true,"warmup_week":0,"horizon_weeks":3,"analysis_window_weeks":3,
      "ci_level":0.95,"ci_halfwidth_target":0.05,"stopping_rule":"fixed_horizon"}'::jsonb,
    'engine', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'face', 'Reviewed with operations.', v_ev, '{}'::jsonb, v_owner);
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_ev;
  IF v_row.retention <> 'evidence' OR v_row.series_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'R600 §3: saving a model did not keep its evidence run: %', to_jsonb(v_row) - 'run_spec';
  END IF;
  v_res := public.set_run_retention(v_pin, 'pinned', v_owner);
  IF (v_res ->> 'retention') <> 'pinned' OR (v_res ->> 'series_expires_at') IS NOT NULL THEN
    RAISE EXCEPTION 'R600 §3: pinning did not keep the run: %', v_res;
  END IF;

  -- Everything is now due: age the three expiries into the past. An evidence or
  -- pinned run has none to age, which is the point.
  UPDATE public.simulation_runs SET series_expires_at = now() - interval '1 day'
   WHERE id = v_std;

  -- ══ §2 · the sweep keeps the summary ══
  v_res := public.sweep_expired_run_series(100);
  IF (v_res ->> 'runs')::int < 1 THEN
    RAISE EXCEPTION 'R600 §2: the sweep removed nothing: %', v_res;
  END IF;
  SELECT * INTO v_row FROM public.simulation_runs WHERE id = v_std;
  IF v_row.series_expired_at IS NULL OR v_row.series_object IS NOT NULL
     OR v_row.aggregate_kpis ->> 'fill_rate' IS NULL OR v_row.status <> 'done' THEN
    RAISE EXCEPTION 'R600 §2: the swept run lost its summary or kept its pointer: %', to_jsonb(v_row) - 'run_spec';
  END IF;
  SELECT count(*) INTO v_n FROM public.run_replications
   WHERE run_id = v_std AND time_series = '{}'::jsonb AND kpis ? 'fill_rate';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R600 §2: the replication KPI rows were not kept with their series removed (% of 2)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.run_item_series WHERE run_id = v_std) THEN
    RAISE EXCEPTION 'R600 §2: the per-item series of an expired run survived';
  END IF;

  -- ══ §3 (continued) · evidence and pinned untouched ══
  SELECT count(*) INTO v_n FROM public.run_replications
   WHERE run_id IN (v_pin, v_ev) AND time_series <> '{}'::jsonb;
  IF v_n <> 4 OR (SELECT count(*) FROM public.run_item_series WHERE run_id IN (v_pin, v_ev)) <> 2 THEN
    RAISE EXCEPTION 'R600 §3: the sweep touched a pinned or evidence run';
  END IF;

  -- ══ §4 · who may pin, and what ══
  v_state := NULL;
  BEGIN PERFORM public.set_run_retention(v_pin, 'standard', v_viewer);
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R600 §4: a viewer changed a run''s retention'; END IF;
  v_state := NULL;
  BEGIN PERFORM public.set_run_retention(v_ev, 'standard', v_owner);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R600 §4: evidence was released'; END IF;
  v_state := NULL;
  BEGIN PERFORM public.set_run_retention(v_std, 'pinned', v_owner);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R600 §4: an expired run was pinned as if its series still existed'; END IF;
  v_state := NULL;
  BEGIN UPDATE public.simulation_runs SET retention = 'pinned', series_expires_at = now() WHERE id = v_pin;
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R600 §4: a pinned run was given an expiry'; END IF;
  v_res := public.set_run_retention(v_pin, 'standard', v_owner);
  IF (v_res ->> 'series_expires_at') IS NULL THEN
    RAISE EXCEPTION 'R600 §4: releasing a pin did not restart the retention period: %', v_res;
  END IF;

  -- ══ §5 · not API doors ══
  IF has_function_privilege('anon', 'public.sweep_expired_run_series(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sweep_expired_run_series(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R600 §5: the sweep is executable through the API';
  END IF;

  -- ══ §6 · a deleted run queues its object; the sweep hands it over ══
  EXECUTE 'INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2)'
    USING 'run-results', v_proj::text || '/' || v_pin::text || '/series.parquet';
  UPDATE public.simulation_runs SET series_object = v_proj::text || '/' || v_pin::text || '/series.parquet'
   WHERE id = v_pin;
  -- Must not raise: a run delete never touches a storage row.
  DELETE FROM public.simulation_runs WHERE id = v_pin;
  IF NOT EXISTS (SELECT 1 FROM public.run_series_orphans
                  WHERE path = v_proj::text || '/' || v_pin::text || '/series.parquet' AND run_id = v_pin) THEN
    RAISE EXCEPTION 'R600 §6: a deleted run''s series object was not queued for removal';
  END IF;
  v_res := public.sweep_expired_run_series(100);
  IF NOT (v_res -> 'paths') ? (v_proj::text || '/' || v_pin::text || '/series.parquet') THEN
    RAISE EXCEPTION 'R600 §6: the sweep did not hand over the orphaned object: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM public.run_series_orphans WHERE run_id = v_pin) THEN
    RAISE EXCEPTION 'R600 §6: a handed-over object stayed queued';
  END IF;

  RAISE NOTICE 'R600 ok — expiry on completion, the sweep keeps the summary, evidence and pins kept, who may pin';
END
$rt600$;
