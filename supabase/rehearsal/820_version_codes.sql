-- WP 10.5 follow-up · blueprint §8.4, §9.5 — VERSION CODES: `2026Q3 - Data 20260915 - Policy 20261004`.
--
-- What only a running database can settle (`20261004000001`):
--
--   §1 A policy version's code is the UTC day its CONTENT was first saved; a second
--      content that day is `-2`; a row of an existing content shares its code; a
--      deleted same-day version's code is never re-issued to a new content.
--   §2 The backfill (the function the migration ran) codes a planted history in
--      first-appearance order, duplicates sharing one code.
--   §3 The simulation level's code follows the same rule per level; a stored code
--      cannot be changed.
--   §4 A model saved with a planning period is `2026Q3`, the next `2026Q3-2`; a model
--      saved without one has no code until it is given one, ONCE; a period outside
--      `YYYYQ1..4` is refused; the period is not in `model_hash`.

DO $codes$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_proj  uuid := gen_random_uuid();
  v_scen  uuid := gen_random_uuid();
  v_a     uuid;
  v_b     uuid;
  v_c     uuid;
  v_d     uuid;
  v_pv    uuid;
  v_ds1   uuid;
  v_ds2   uuid;
  v_m1    uuid;
  v_m2    uuid;
  v_m3    uuid;
  v_code  text;
  v_hash  text;
  v_state text;
  v_codes text[];
  k_proto jsonb := '{"replications":10,"root_seed":42,"crn":true,"warmup_week":4,"horizon_weeks":52,
                     "analysis_window_weeks":48,"ci_level":0.95,"ci_halfwidth_target":0.05,
                     "stopping_rule":"fixed_horizon"}'::jsonb;
  k_pass  jsonb := '[{"kpi":"fill_rate","ks":0.1,"ks_p":0.6,"t":0.2,"t_p":0.7,"n":40,"source":"weekly series","pass":true}]'::jsonb;
BEGIN
  INSERT INTO public.sim_engines (slug, name, status) VALUES ('scsim', 'scsim', 'active')
    ON CONFLICT (slug) DO NOTHING;
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES (v_user, 'r820@example.invalid', 'R820', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R820', v_user, 'P');
  PERFORM set_config('app.current_user_id', v_user::text, true);

  -- ══ §1 · policy codes ══
  -- 22:00 at UTC-5 is 03:00 UTC the NEXT day: the code is the UTC day.
  INSERT INTO public.policy_versions (project_id, label, snapshot, policy_hash, created_at)
    VALUES (v_proj, 'a', '{}'::jsonb, 'h-a', '2026-09-15 22:00:00-05') RETURNING id INTO v_a;
  INSERT INTO public.policy_versions (project_id, label, snapshot, policy_hash, created_at)
    VALUES (v_proj, 'b', '{}'::jsonb, 'h-b', '2026-09-16 10:00:00+00') RETURNING id INTO v_b;
  INSERT INTO public.policy_versions (project_id, label, snapshot, policy_hash, created_at)
    VALUES (v_proj, 'a again', '{}'::jsonb, 'h-a', '2026-09-17 10:00:00+00') RETURNING id INTO v_c;
  SELECT array_agg(version_code ORDER BY created_at) INTO v_codes
    FROM public.policy_versions WHERE id IN (v_a, v_b, v_c);
  IF v_codes IS DISTINCT FROM ARRAY['20260916', '20260916-2', '20260916'] THEN
    RAISE EXCEPTION 'R820 §1: policy codes are %, expected {20260916,20260916-2,20260916} (UTC day; -2; a content keeps its code)', v_codes;
  END IF;

  -- Delete the first content (both rows); the next content that day must not take
  -- the code a surviving version still answers to, nor the one it gave up.
  DELETE FROM public.policy_versions WHERE id IN (v_a, v_c);
  INSERT INTO public.policy_versions (project_id, label, snapshot, policy_hash, created_at)
    VALUES (v_proj, 'd', '{}'::jsonb, 'h-d', '2026-09-16 18:00:00+00') RETURNING id INTO v_d;
  SELECT version_code INTO v_code FROM public.policy_versions WHERE id = v_d;
  IF v_code IS DISTINCT FROM '20260916-3' THEN
    RAISE EXCEPTION 'R820 §1: after a deletion a new same-day content took %, expected 20260916-3', v_code;
  END IF;

  -- The live save path codes too, and a repeat save of the same content returns it.
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  v_pv := public.snapshot_policy(v_proj, 'R820', v_user);
  SELECT version_code INTO v_code FROM public.policy_versions WHERE id = v_pv;
  IF v_code IS NULL OR v_code !~ ('^' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '(-[0-9]+)?$') THEN
    RAISE EXCEPTION 'R820 §1: snapshot_policy saved a version coded %, expected today (UTC)', v_code;
  END IF;
  IF public.snapshot_policy(v_proj, 'R820 again', v_user) IS DISTINCT FROM v_pv THEN
    RAISE EXCEPTION 'R820 §1: a repeat save of one content made a second version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.list_policy_versions(v_proj) l WHERE l.id = v_pv AND l.version_code = v_code) THEN
    RAISE EXCEPTION 'R820 §1: list_policy_versions does not carry the code';
  END IF;

  -- ══ §2 · the backfill codes a planted history ══
  UPDATE public.policy_versions SET version_code = NULL WHERE project_id = v_proj;
  PERFORM public._version_codes_backfill(v_proj);
  SELECT array_agg(version_code ORDER BY version_no, created_at) INTO v_codes
    FROM public.policy_versions WHERE project_id = v_proj AND id IN (v_b, v_d);
  IF v_codes IS DISTINCT FROM ARRAY['20260916', '20260916-2'] THEN
    RAISE EXCEPTION 'R820 §2: the backfill coded the surviving history %, expected {20260916,20260916-2}', v_codes;
  END IF;
  IF EXISTS (SELECT 1 FROM public.policy_versions WHERE project_id = v_proj AND version_code IS NULL) THEN
    RAISE EXCEPTION 'R820 §2: the backfill left a policy version without a code';
  END IF;

  -- ══ §3 · the simulation level ══
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed, replications) VALUES
    (v_scen, v_proj, 'R820 baseline', 364, 42, 10);
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10);
  INSERT INTO public.products (project_id, product_id) VALUES (v_proj, 'P1');
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit)
    VALUES (v_proj, 'P', 'S1', 'M1', 4, 100, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate)
    VALUES (v_proj, 'P', 'P1', 'M1', 2);
  v_ds1 := public.snapshot_dataset(v_proj, NULL, v_user);
  UPDATE public.materials SET cost = 25 WHERE project_id = v_proj AND material_id = 'M1';
  v_ds2 := public.snapshot_dataset(v_proj, NULL, v_user);
  SELECT array_agg(g.version_code ORDER BY g.version_no) INTO v_codes
    FROM public.graph_level_versions g WHERE g.project_id = v_proj AND g.level = 'simulation';
  v_code := to_char((SELECT created_at FROM public.dataset_versions WHERE id = v_ds1) AT TIME ZONE 'UTC', 'YYYYMMDD');
  IF v_codes IS DISTINCT FROM ARRAY[v_code, v_code || '-2'] THEN
    RAISE EXCEPTION 'R820 §3: two simulation-input contents of one day are coded %, expected {%,%-2}', v_codes, v_code, v_code;
  END IF;
  IF (public.dataset_version_tuple(v_ds2) -> 'simulation' ->> 'version_code') IS DISTINCT FROM v_code || '-2' THEN
    RAISE EXCEPTION 'R820 §3: dataset_version_tuple does not carry the simulation code: %', public.dataset_version_tuple(v_ds2);
  END IF;
  v_state := NULL;
  BEGIN
    UPDATE public.graph_level_versions SET version_code = '20000101'
     WHERE project_id = v_proj AND level = 'simulation' AND version_no = 1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R820 §3: a stored level code was changed';
  END IF;

  -- ══ §4 · the model's planning period ══
  v_m1 := public.record_validated_model(v_proj, v_pv, v_ds2, v_scen, 'R820 model', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user,
            NULL, '2026Q3');
  v_m2 := public.record_validated_model(v_proj, v_pv, v_ds2, v_scen, 'R820 model', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user,
            NULL, '2026Q3');
  -- The positional call every caller made before this migration: no period, no code.
  v_m3 := public.record_validated_model(v_proj, v_pv, v_ds2, v_scen, 'R820 model', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user);
  SELECT array_agg(COALESCE(model_code, '∅') ORDER BY version_no) INTO v_codes
    FROM public.model_validations WHERE id IN (v_m1, v_m2, v_m3);
  IF v_codes IS DISTINCT FROM ARRAY['2026Q3', '2026Q3-2', '∅'] THEN
    RAISE EXCEPTION 'R820 §4: model codes are %, expected {2026Q3,2026Q3-2,∅}', v_codes;
  END IF;

  SELECT model_hash INTO v_hash FROM public.model_validations WHERE id = v_m3;
  v_code := public.set_model_planning_period(v_m3, '2026Q3', v_user);
  IF v_code IS DISTINCT FROM '2026Q3-3' THEN
    RAISE EXCEPTION 'R820 §4: setting a period on a model without one gave %, expected 2026Q3-3', v_code;
  END IF;
  IF (SELECT model_hash FROM public.model_validations WHERE id = v_m3) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'R820 §4: the planning period moved model_hash — it names the model, it is not the model';
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.set_model_planning_period(v_m3, '2026Q4', v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R820 §4: a model''s planning period was set twice';
  END IF;
  v_state := NULL;
  BEGIN
    UPDATE public.model_validations SET planning_period = '2026Q4' WHERE id = v_m1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R820 §4: a direct update changed a model''s planning period';
  END IF;

  -- A period that is not a quarter, and a write that names nobody, are refused.
  UPDATE public.model_validations SET status = 'superseded' WHERE id = v_m1;   -- lifecycle stays writable
  v_m3 := public.record_validated_model(v_proj, v_pv, v_ds1, v_scen, 'R820 bad period', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, '{}'::jsonb, v_user);
  v_state := NULL;
  BEGIN
    PERFORM public.set_model_planning_period(v_m3, '2026Q5', v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R820 §4: the period 2026Q5 was accepted';
  END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.set_model_planning_period(v_m3, '2026Q2', NULL);
  EXCEPTION WHEN null_value_not_allowed THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'R820 §4: a planning period was set by a call that names no actor';
  END IF;

  RAISE NOTICE 'WP 10.5 follow-up: policy and data codes are the UTC day of first appearance with -n, stored and never re-issued; a model is coded by its planning period, set once';
END $codes$;
