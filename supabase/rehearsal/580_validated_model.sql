-- §4 D243, D244 · THE VALIDATED MODEL (WP 10.3).
--
-- §1 Save Validated Model writes a model with a complete protocol, its hashes, a
--    per-project number, and ONE evidence row beside it; the audit row names the
--    actor even with the session poisoned first.
-- §2 the adoption rule is the DATABASE's: one failing KPI refuses a statistical
--    model; a face-validated model without its statement is refused; with it, saved.
-- §3 an incomplete or impossible protocol is refused (missing key, 500 replications,
--    warm-up + window beyond the horizon, a CI stopping rule without a target).
-- §4 IMMUTABLE: a protocol UPDATE and a warm-up UPDATE are refused; revocation (a
--    lifecycle change) is allowed and records who and when.
-- §5 evidence round-trips through `get_validated_model_evidence` and cannot be edited.
-- §6 the legacy entry point still writes a model, now with a derived, complete
--    protocol and an evidence row.
-- §7 a direct INSERT without a graph version or a protocol is refused.
-- §8 a backfilled protocol may leave named keys unknown — and only those.

DO $vm580$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_proj    uuid := gen_random_uuid();
  v_scen    uuid := gen_random_uuid();
  v_pv      uuid;
  v_ds      uuid;
  v_m1      uuid;
  v_m2      uuid;
  v_m3      uuid;
  v_row     public.model_validations%ROWTYPE;
  v_ev      public.model_validation_evidence%ROWTYPE;
  v_state   text;
  v_n       integer;
  k_proto   jsonb := '{"replications":30,"root_seed":42,"crn":true,"warmup_week":12,"horizon_weeks":156,
                      "analysis_window_weeks":144,"ci_level":0.95,"ci_halfwidth_target":0.05,
                      "stopping_rule":"fixed_horizon"}'::jsonb;
  k_pass    jsonb := '[{"kpi":"fill_rate","ks":0.1,"ks_p":0.6,"t":0.2,"t_p":0.7,"n":40,"source":"weekly series","pass":true},
                       {"kpi":"max_backlog","ks":0.2,"ks_p":0.4,"t":0.5,"t_p":0.5,"n":30,"source":"per-rep scalars","pass":true}]'::jsonb;
  k_onefail jsonb := '[{"kpi":"fill_rate","pass":true,"n":40},{"kpi":"max_backlog","pass":false,"n":30}]'::jsonb;
  k_evid    jsonb := '{"warmup":{"method":"mser5","per_kpi":{"fill_rate":{"week":12},"max_backlog":{"week":9}},"adopted_week":12},
                       "replication_analysis":{"confidence":0.95,"target_precision":0.05,"recommended":30}}'::jsonb;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_user, 'r580@example.invalid', 'R580', 'x'), (v_other, 'r580o@example.invalid', 'R580 other', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES (v_proj, 'R580', v_user, 'P');
  IF NOT EXISTS (SELECT 1 FROM public.policy_defaults WHERE project_id = v_proj) THEN
    INSERT INTO public.policy_defaults (project_id) VALUES (v_proj);
  END IF;
  INSERT INTO public.scenarios (id, project_id, name, horizon_days, seed) VALUES (v_scen, v_proj, 'R580 baseline', 1092, 42);
  v_pv := public.snapshot_policy(v_proj, 'R580', v_user);
  v_ds := public.snapshot_dataset(v_proj, NULL, v_user);

  -- ══ §1 · save ══
  PERFORM set_config('app.current_user_id', v_other::text, true);   -- POISON
  SELECT count(*) INTO v_n FROM public.audit_logs WHERE target_type = 'model_validations';
  v_m1 := public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'Baseline model', k_proto, 'mser5',
            '{"confidence":0.95}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, k_evid, v_user);
  SELECT * INTO v_row FROM public.model_validations WHERE id = v_m1;
  IF v_row.protocol IS DISTINCT FROM k_proto OR v_row.protocol_hash IS NULL OR v_row.model_hash IS NULL
     OR v_row.version_no IS DISTINCT FROM 1 OR v_row.name <> 'Baseline model'
     OR v_row.recommended_replications <> 30 OR v_row.adopted_warmup_days <> 84
     OR v_row.dataset_version_id IS DISTINCT FROM v_ds THEN
    RAISE EXCEPTION 'R580 §1: the saved model is wrong: %', to_jsonb(v_row);
  END IF;
  SELECT count(*) INTO v_n FROM public.model_validation_evidence WHERE validation_id = v_m1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R580 §1: % evidence rows for one model', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs a
                  WHERE a.plane = 'data' AND a.target_type = 'model_validations'
                    AND a.actor_user_id = v_user) THEN
    RAISE EXCEPTION 'R580 §1: no audit row on model_validations names the actor';
  END IF;

  -- ══ §2 · the adoption rule ══
  v_state := NULL;
  BEGIN
    PERFORM public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'x', k_proto, 'mser5',
      '{}'::jsonb, k_onefail, '[]'::jsonb, 'statistical', NULL, NULL, k_evid, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §2: a model with one failing KPI was saved (D244)'; END IF;
  v_state := NULL;
  BEGIN
    PERFORM public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'x', k_proto, 'mser5',
      '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'face', '  ', NULL, k_evid, v_user);
  EXCEPTION WHEN check_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §2: a face-validated model without its statement was saved'; END IF;
  v_m2 := public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'Face model', k_proto, 'engine',
            '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'face',
            'Weekly fill rate and backlog trajectories reviewed against Q3 operations; behaviour plausible.',
            NULL, k_evid, v_user);
  IF (SELECT status FROM public.model_validations WHERE id = v_m1) <> 'superseded'
     OR (SELECT superseded_by FROM public.model_validations WHERE id = v_m1) IS DISTINCT FROM v_m2 THEN
    RAISE EXCEPTION 'R580 §2: a second model on one content triple did not supersede the first';
  END IF;
  IF (SELECT face_validation FROM public.model_validations WHERE id = v_m2) IS NULL THEN
    RAISE EXCEPTION 'R580 §2: the face-validation statement was not recorded on the model';
  END IF;

  -- ══ §3 · incomplete or impossible protocols ══
  FOREACH v_state IN ARRAY ARRAY['missing','reps','window','ci'] LOOP
    BEGIN
      PERFORM public.record_validated_model(v_proj, v_pv, v_ds, v_scen, 'x',
        CASE v_state
          WHEN 'missing' THEN k_proto - 'root_seed'
          WHEN 'reps'    THEN k_proto || '{"replications":500}'
          WHEN 'window'  THEN k_proto || '{"analysis_window_weeks":150}'
          ELSE k_proto || '{"stopping_rule":"ci_halfwidth","ci_halfwidth_target":null}'
        END, 'mser5', '{}'::jsonb, k_pass, '[]'::jsonb, 'statistical', NULL, NULL, k_evid, v_user);
      RAISE EXCEPTION 'R580 §3: protocol case % was accepted', v_state;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  -- ══ §4 · immutability ══
  v_state := NULL;
  BEGIN
    UPDATE public.model_validations SET protocol = k_proto || '{"replications":10}' WHERE id = v_m2;
  EXCEPTION WHEN sqlstate 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §4: a protocol UPDATE was accepted'; END IF;
  v_state := NULL;
  BEGIN
    UPDATE public.model_validations SET adopted_warmup_days = 7 WHERE id = v_m2;
  EXCEPTION WHEN sqlstate 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §4: a warm-up UPDATE was accepted'; END IF;
  PERFORM public.revoke_model_validation(v_m2, v_user, 'R580 revocation');
  SELECT * INTO v_row FROM public.model_validations WHERE id = v_m2;
  IF v_row.status <> 'revoked' OR v_row.revoked_by IS DISTINCT FROM v_user OR v_row.revoked_at IS NULL
     OR v_row.revoke_reason IS DISTINCT FROM 'R580 revocation' THEN
    RAISE EXCEPTION 'R580 §4: revocation did not record who, when and why: %', to_jsonb(v_row);
  END IF;

  -- ══ §5 · evidence ══
  SELECT * INTO v_ev FROM public.get_validated_model_evidence(v_m1);
  IF v_ev.warmup -> 'per_kpi' -> 'max_backlog' ->> 'week' IS DISTINCT FROM '9'
     OR jsonb_array_length(v_ev.kpi_tests) <> 2
     OR v_ev.replication_analysis ->> 'recommended' IS DISTINCT FROM '30' THEN
    RAISE EXCEPTION 'R580 §5: the evidence did not round-trip: %', to_jsonb(v_ev);
  END IF;
  IF (SELECT face_validation ->> 'statement' FROM public.get_validated_model_evidence(v_m2)) IS NULL THEN
    RAISE EXCEPTION 'R580 §5: the face-validation statement is not in the evidence';
  END IF;
  v_state := NULL;
  BEGIN
    UPDATE public.model_validation_evidence SET kpi_tests = '[]' WHERE validation_id = v_m1;
  EXCEPTION WHEN sqlstate 'P0A02' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §5: evidence was edited'; END IF;

  -- ══ §6 · the legacy entry point ══
  v_m3 := public.record_model_validation(v_proj, v_pv, v_ds, v_scen, 30, 'engine', 25,
            '{"confidence":0.9}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'validated', 'face', NULL, v_user, NULL);
  SELECT * INTO v_row FROM public.model_validations WHERE id = v_m3;
  IF cardinality(public.validated_model_protocol_problems(v_row.protocol)) <> 0
     OR (v_row.protocol ->> 'replications')::int <> 25 OR (v_row.protocol ->> 'warmup_week')::int <> 5
     OR (v_row.protocol ->> 'root_seed')::int <> 42 OR (v_row.protocol ->> 'horizon_weeks')::int <> 156
     OR (v_row.protocol ->> 'ci_level')::numeric <> 0.9 THEN
    RAISE EXCEPTION 'R580 §6: the legacy RPC wrote protocol %', v_row.protocol;
  END IF;
  IF v_row.version_no <> 3 THEN
    RAISE EXCEPTION 'R580 §6: the third model is numbered %', v_row.version_no;
  END IF;

  -- ══ §7 · a direct INSERT must name a graph version and a protocol ══
  v_state := NULL;
  BEGIN
    INSERT INTO public.model_validations (project_id, policy_version_id, policy_hash, graph_hash, scenario_hash,
      scenario_fingerprint, adopted_warmup_days, recommended_replications, verdict, protocol)
    VALUES (v_proj, v_pv, 'ph', 'gh', 'sh', '{}'::jsonb, 7, 1, 'validated', k_proto);
  EXCEPTION WHEN not_null_violation THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'R580 §7: a model without a graph version was inserted'; END IF;

  -- ══ §8 · backfilled protocols ══
  IF cardinality(public.validated_model_protocol_problems(
       '{"backfilled":true,"unknown":["crn","stopping_rule","root_seed"],"replications":450,"root_seed":null,
         "crn":null,"warmup_week":5,"horizon_weeks":52,"analysis_window_weeks":47,"ci_level":0.95,
         "ci_halfwidth_target":0.05,"stopping_rule":null}'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'R580 §8: a correctly backfilled protocol was refused';
  END IF;
  IF cardinality(public.validated_model_protocol_problems(
       '{"backfilled":true,"unknown":["crn"],"replications":30,"root_seed":null,
         "crn":null,"warmup_week":5,"horizon_weeks":52,"analysis_window_weeks":47,"ci_level":0.95,
         "ci_halfwidth_target":0.05,"stopping_rule":"fixed_horizon"}'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'R580 §8: a backfilled protocol with an UNLISTED null was accepted';
  END IF;
END
$vm580$;
