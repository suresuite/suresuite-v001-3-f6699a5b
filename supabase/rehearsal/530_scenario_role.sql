-- §4 D227 · THE VALIDATED BASELINE HAS AN IDENTITY (WP 9.4 slice 4).
--
-- `scenarios.role` replaces finding Run & Validate's scenario by its display name.
-- Every claim below is about what the database DOES, which no source-level test of
-- the migration can make.
--
-- §1 a scenario is an `experiment` unless it says otherwise; the CHECK refuses any
--    other word.
-- §2 one baseline per project: a second is refused (23505, the code Run & Validate
--    catches and re-selects on); another project may hold its own; an experiment
--    may be added beside it freely.
-- §3 the backfill rule, executed — the scenario an ACTIVE card's evidence run
--    belongs to wins even when it has been renamed; without one, the name candidate
--    with the newest run wins over an older, run-less one; a project that already
--    has a baseline is left alone; a second call changes nothing.
-- §4 the function the rule lives in is not callable by the API roles.

DO $role530$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
  v_p3     uuid := gen_random_uuid();
  v_s_old  uuid := gen_random_uuid();   -- p1: named, oldest, no run
  v_s_new  uuid := gen_random_uuid();   -- p1: named, newest run
  v_s_card uuid := gen_random_uuid();   -- p1: RENAMED, owns the active card's evidence run
  v_s_a    uuid := gen_random_uuid();   -- p2: named, no run
  v_s_b    uuid := gen_random_uuid();   -- p2: named, has a run
  v_s_keep uuid := gen_random_uuid();   -- p3: already the baseline
  v_s_dup  uuid := gen_random_uuid();   -- p3: named, must stay an experiment
  v_run1   uuid := gen_random_uuid();
  v_run2   uuid := gen_random_uuid();
  v_run3   uuid := gen_random_uuid();
  v_pv     uuid := gen_random_uuid();
  v_ds     uuid := gen_random_uuid();
  v_n      integer;
  v_state  text;
  v_role   text;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'r510@example.invalid', 'R530', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES
    (v_p1, 'R530 one',   v_user, 'P'),
    (v_p2, 'R530 two',   v_user, 'P'),
    (v_p3, 'R530 three', v_user, 'P');

  -- ══ §1 · the default, and the vocabulary ══
  INSERT INTO public.scenarios (id, project_id, name) VALUES (v_s_old, v_p1, 'Policy validation (auto)');
  SELECT role INTO v_role FROM public.scenarios WHERE id = v_s_old;
  IF v_role IS DISTINCT FROM 'experiment' THEN
    RAISE EXCEPTION 'R530 §1: a new scenario''s role is %, not experiment', v_role;
  END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.scenarios (project_id, name, role) VALUES (v_p1, 'bogus', 'decision');
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R530 §1: role = ''decision'' was accepted; the CHECK is missing';
  END IF;

  -- ══ §3 · the backfill rule (before §2, which plants baselines by hand) ══
  -- p1: three candidates. The renamed one owns the active card's evidence run.
  INSERT INTO public.scenarios (id, project_id, name, created_at) VALUES
    (v_s_new,  v_p1, 'Policy validation (auto)', now() - interval '2 days'),
    (v_s_card, v_p1, 'My renamed validation',    now() - interval '1 day');
  UPDATE public.scenarios SET created_at = now() - interval '9 days' WHERE id = v_s_old;
  INSERT INTO public.simulation_runs (id, project_id, scenario_id, status, created_at) VALUES
    (v_run1, v_p1, v_s_new,  'done', now()),                      -- the NEWEST run
    (v_run2, v_p1, v_s_card, 'done', now() - interval '1 hour');  -- the evidence run
  INSERT INTO public.policy_versions (id, project_id, snapshot) VALUES (v_pv, v_p1, '{}'::jsonb);
  -- WP 10.3: a new card names its graph version and states its protocol.
  INSERT INTO public.dataset_versions (id, project_id, snapshot, graph_hash) VALUES (v_ds, v_p1, '{}'::jsonb, 'gh');
  INSERT INTO public.model_validations (
    project_id, policy_version_id, policy_hash, dataset_version_id, graph_hash, scenario_hash, scenario_fingerprint,
    adopted_warmup_days, recommended_replications, verdict, evidence_run_id, status, protocol)
  VALUES (v_p1, v_pv, 'ph', v_ds, 'gh', 'sh', '{}'::jsonb, 105, 30, 'validated', v_run2, 'active',
          '{"replications":30,"root_seed":1,"crn":true,"warmup_week":15,"horizon_weeks":52,
            "analysis_window_weeks":37,"ci_level":0.95,"ci_halfwidth_target":0.05,"stopping_rule":"fixed_horizon"}'::jsonb);

  -- p2: two named candidates, one with a run.
  INSERT INTO public.scenarios (id, project_id, name, created_at) VALUES
    (v_s_a, v_p2, 'Policy validation (auto)', now() - interval '5 days'),
    (v_s_b, v_p2, 'Policy validation (auto)', now() - interval '1 day');
  INSERT INTO public.simulation_runs (id, project_id, scenario_id, status) VALUES
    (v_run3, v_p2, v_s_b, 'done');

  -- p3: a baseline already exists, and a named duplicate beside it.
  INSERT INTO public.scenarios (id, project_id, name, role) VALUES
    (v_s_keep, v_p3, 'Baseline, renamed', 'validation_baseline');
  INSERT INTO public.scenarios (id, project_id, name) VALUES
    (v_s_dup, v_p3, 'Policy validation (auto)');

  v_n := public.scenarios_assign_validation_baseline(NULL);
  IF (SELECT role FROM public.scenarios WHERE id = v_s_card) <> 'validation_baseline' THEN
    RAISE EXCEPTION 'R530 §3: the scenario owning the active card''s evidence run was not chosen';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id IN (v_s_old, v_s_new) AND role <> 'experiment') THEN
    RAISE EXCEPTION 'R530 §3: a second p1 candidate became a baseline too';
  END IF;
  IF (SELECT role FROM public.scenarios WHERE id = v_s_b) <> 'validation_baseline'
     OR (SELECT role FROM public.scenarios WHERE id = v_s_a) <> 'experiment' THEN
    RAISE EXCEPTION 'R530 §3: without a card, the candidate with a run should win over the run-less one';
  END IF;
  IF (SELECT role FROM public.scenarios WHERE id = v_s_dup) <> 'experiment'
     OR (SELECT role FROM public.scenarios WHERE id = v_s_keep) <> 'validation_baseline' THEN
    RAISE EXCEPTION 'R530 §3: a project that already had a baseline was changed';
  END IF;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'R530 §3: the backfill reported % row(s); p1 and p2 each needed one', v_n;
  END IF;
  IF public.scenarios_assign_validation_baseline(NULL) <> 0 THEN
    RAISE EXCEPTION 'R530 §3: a second backfill changed rows — it is not idempotent';
  END IF;

  -- ══ §2 · one baseline per project ══
  v_state := NULL;
  BEGIN
    INSERT INTO public.scenarios (project_id, name, role) VALUES (v_p1, 'second', 'validation_baseline');
  EXCEPTION WHEN unique_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R530 §2: a second validation baseline in one project was accepted';
  END IF;
  v_state := NULL;
  BEGIN
    UPDATE public.scenarios SET role = 'validation_baseline' WHERE id = v_s_old;
  EXCEPTION WHEN unique_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R530 §2: promoting an experiment beside an existing baseline was accepted';
  END IF;
  INSERT INTO public.scenarios (project_id, name) VALUES (v_p1, 'an experiment beside it');

  -- ══ §4 · the rule is not an API ══
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', 'public.scenarios_assign_validation_baseline(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R530 §4: anon may execute the backfill rule';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'public.scenarios_assign_validation_baseline(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R530 §4: authenticated may execute the backfill rule';
  END IF;

  RAISE NOTICE 'R530 ok — role default, CHECK, one baseline per project, backfill rule, no API grant';
END
$role530$;
