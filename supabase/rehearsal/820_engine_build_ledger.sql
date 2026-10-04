-- §4 D292 · THE ENGINE BUILD LEDGER (Phase 15 / WP 15.2, `20261004000001`).
--
-- §1 a boot report records its build: the same build twice is ONE row whose
--    last_seen_at moves; a new build is a second row, and the first survives.
-- §2 a part the row did not know is filled once; a later report never changes it.
-- §3 append-only: a recorded build is never rewritten, deleted or un-withdrawn.
-- §4 every run that names its build records it — written AS ANON, as the browser
--    writes; a queued run with no code version records nothing.
-- §5 withdrawal: only a super admin, only with a reason; dispatch then refuses
--    the engine whose current build it is, and a fresh build runs again.
-- §6 §4 D248: the two internal functions are no API; the report is service-only.

INSERT INTO public.sim_engines (slug, name, status, capabilities) VALUES
  ('scsim', 'scsim — the strategic engine', 'active', '{"compute": ["worker", "browser"]}'::jsonb),
  ('legacy-worker', 'Legacy worker engine (frozen)', 'retired', '{"compute": ["worker"]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

DO $r820$
DECLARE
  v_scsim  uuid;
  v_user   uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_org    uuid := gen_random_uuid();
  v_proj   uuid := gen_random_uuid();
  v_scen   uuid := gen_random_uuid();
  v_run    uuid;
  v_b1     public.sim_engine_builds%ROWTYPE;
  v_b2     public.sim_engine_builds%ROWTYPE;
  v_n      integer;
  v_state  text;
  v_names  text;
  k_a      text := 'scsim-9.9.1+aaaaaaaaaaaa';
  k_b      text := 'scsim-9.9.1+bbbbbbbbbbbb';
  k_run    text := 'scsim-9.9.1+cccccccccccc';
  k_dig    text := repeat('d', 64);
BEGIN
  SELECT id INTO v_scsim FROM public.sim_engines WHERE slug = 'scsim';

  -- ══ §1 · a boot report records its build ══
  PERFORM public.sim_engine_report('scsim', '9.9.1', k_a, NULL, NULL);
  SELECT * INTO v_b1 FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_a;
  IF NOT FOUND OR v_b1.first_seen_by <> 'worker_report' THEN
    RAISE EXCEPTION 'R820 §1: the boot report did not record its build';
  END IF;
  PERFORM pg_sleep(0.01);
  PERFORM public.sim_engine_report('scsim', '9.9.1', k_a, NULL, NULL);
  SELECT count(*) INTO v_n FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_a;
  SELECT * INTO v_b2 FROM public.sim_engine_builds WHERE id = v_b1.id;
  IF v_n <> 1 OR v_b2.last_seen_at <= v_b1.last_seen_at THEN
    RAISE EXCEPTION 'R820 §1: a second report of one build made % row(s) or did not move last_seen_at', v_n;
  END IF;
  PERFORM public.sim_engine_report('scsim', '9.9.1', k_b, NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_a)
     OR NOT EXISTS (SELECT 1 FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_b) THEN
    RAISE EXCEPTION 'R820 §1: a new build overwrote the old one — the D292 defect';
  END IF;
  IF (SELECT code_version FROM public.sim_engines WHERE id = v_scsim) <> k_b THEN
    RAISE EXCEPTION 'R820 §1: the registry does not say the newest report is current';
  END IF;

  -- ══ §2 · parts are filled once ══
  PERFORM public.sim_engine_report('scsim', '9.9.1', k_b, NULL,
    jsonb_build_object('scsim_digest', k_dig, 'sim_worker_digest', k_dig, 'commit', 'ABCDEF1234567',
                       'image_digest', 'registry.fly.io/w@sha256:1'));
  SELECT * INTO v_b2 FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_b;
  IF v_b2.commit_sha IS DISTINCT FROM 'abcdef1234567' OR v_b2.scsim_digest IS DISTINCT FROM k_dig
     OR v_b2.image_digest IS DISTINCT FROM 'registry.fly.io/w@sha256:1' THEN
    RAISE EXCEPTION 'R820 §2: the report did not fill the parts the row lacked: %', to_jsonb(v_b2);
  END IF;
  -- The same source from another commit is the SAME build: the first commit stands.
  PERFORM public.sim_engine_report('scsim', '9.9.1', k_b, NULL, jsonb_build_object('commit', '1111111'));
  IF (SELECT commit_sha FROM public.sim_engine_builds WHERE id = v_b2.id) <> 'abcdef1234567' THEN
    RAISE EXCEPTION 'R820 §2: a later report rewrote a recorded commit';
  END IF;

  -- ══ §3 · append-only ══
  v_state := NULL;
  BEGIN UPDATE public.sim_engine_builds SET code_version = 'scsim-0.0.0+000000000000' WHERE id = v_b2.id;
  EXCEPTION WHEN SQLSTATE 'P0A03' THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §3: a recorded build was renamed'; END IF;
  v_state := NULL;
  BEGIN UPDATE public.sim_engine_builds SET commit_sha = '2222222' WHERE id = v_b2.id;
  EXCEPTION WHEN SQLSTATE 'P0A03' THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §3: a filled part was changed'; END IF;
  v_state := NULL;
  BEGIN UPDATE public.sim_engine_builds SET last_seen_at = first_seen_at - interval '1 day' WHERE id = v_b2.id;
  EXCEPTION WHEN SQLSTATE 'P0A03' OR check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §3: last_seen_at moved backwards'; END IF;
  v_state := NULL;
  BEGIN DELETE FROM public.sim_engine_builds WHERE id = v_b1.id;
  EXCEPTION WHEN SQLSTATE 'P0A03' THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §3: a recorded build was deleted'; END IF;

  -- ══ §4 · every run records its build, as anon ══
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'R820 Org', 'r820-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_user,  'r820u@example.invalid', 'R820 User',  'x', 'modeler',     'R820 Org', v_org, true),
    (v_super, 'r820s@example.invalid', 'R820 Super', 'x', 'super_admin', 'R820 Org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R820', v_user, 'P');
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications)
    VALUES (v_scen, v_proj, 'R820 baseline', 364, 42, 1);
  INSERT INTO public.simulation_runs (scenario_id, project_id, status, rep_count_target, rep_count_done, code_version)
    VALUES (v_scen, v_proj, 'queued', 1, 0, '') RETURNING id INTO v_run;
  IF EXISTS (SELECT 1 FROM public.sim_engine_builds WHERE code_version = '') THEN
    RAISE EXCEPTION 'R820 §4: a queued run with no code version recorded a build';
  END IF;
  SET LOCAL ROLE anon;
  UPDATE public.simulation_runs SET code_version = k_run, status = 'done' WHERE id = v_run;
  RESET ROLE;
  SELECT * INTO v_b1 FROM public.sim_engine_builds WHERE engine_id = v_scsim AND code_version = k_run;
  IF NOT FOUND OR v_b1.first_seen_by <> 'run' THEN
    RAISE EXCEPTION 'R820 §4: a run written as anon did not record the build that computed it';
  END IF;
  SET LOCAL ROLE anon;
  v_state := NULL;
  BEGIN INSERT INTO public.sim_engine_builds (engine_id, code_version, first_seen_by) VALUES (v_scsim, 'scsim-x+y', 'run');
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused'; END;
  RESET ROLE;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §4: anon wrote the ledger directly'; END IF;

  -- ══ §5 · withdrawal ══
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_build_withdraw(v_b2.id, 'wrong', v_user);
  EXCEPTION WHEN insufficient_privilege THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §5: a non-super-admin withdrew a build'; END IF;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_build_withdraw(v_b2.id, '  ', v_super);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §5: a withdrawal without a reason was accepted'; END IF;
  PERFORM public.sim_engine_build_withdraw(v_b2.id, 'R820: MRP horizon off by one', v_super);
  SELECT * INTO v_b2 FROM public.sim_engine_builds WHERE id = v_b2.id;
  IF v_b2.withdrawn_at IS NULL OR v_b2.withdrawn_by IS DISTINCT FROM v_super THEN
    RAISE EXCEPTION 'R820 §5: the withdrawal was not recorded with its actor';
  END IF;
  v_state := NULL;
  BEGIN PERFORM public.sim_engine_for_dispatch(NULL);
  EXCEPTION WHEN check_violation THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §5: dispatch offered an engine whose current build is withdrawn'; END IF;
  v_state := NULL;
  BEGIN UPDATE public.sim_engine_builds SET withdrawn_at = NULL, withdrawn_reason = NULL WHERE id = v_b2.id;
  EXCEPTION WHEN SQLSTATE 'P0A03' THEN v_state := 'refused'; END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R820 §3: a withdrawn build was un-withdrawn'; END IF;
  -- A fixed build runs again; the withdrawn one stays withdrawn in the record.
  PERFORM public.sim_engine_report('scsim', '9.9.2', 'scsim-9.9.2+eeeeeeeeeeee', NULL, NULL);
  IF (public.sim_engine_for_dispatch(NULL)).id IS DISTINCT FROM v_scsim THEN
    RAISE EXCEPTION 'R820 §5: a fresh build was not dispatchable';
  END IF;
  IF (SELECT withdrawn_at FROM public.sim_engine_builds WHERE id = v_b2.id) IS NULL THEN
    RAISE EXCEPTION 'R820 §5: the withdrawal did not survive a new build';
  END IF;

  -- ══ §6 · §4 D248 — no internal function is an API ══
  SELECT string_agg(f, ', ') INTO v_names FROM unnest(ARRAY[
    'public._engine_build_record(uuid,text,text,jsonb)',
    'public._simulation_run_record_build()',
    'public.sim_engine_report(text,text,text,jsonb,jsonb)']) f
  WHERE has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'R820 §6: callable by an API role: %', v_names;
  END IF;

  RAISE NOTICE 'R820 engine build ledger: report, fill-once, append-only, anon run, withdrawal, grants — all hold';
END
$r820$;
