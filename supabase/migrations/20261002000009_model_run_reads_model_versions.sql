-- PLAN.md §23 WP 13.3 · §4 D280 — RUN, VALIDATE, SAVE THE MODEL: BOTH VERSIONS FROZEN.
--
-- A Validated Model has always NAMED a dataset version and a policy version
-- (`record_validated_model`, WP 10.3). What nothing held was the other half: a run
-- that FOLLOWS the model reading them. The dispatcher now sends a model run with
-- the model's own two versions (`_shared/dispatch.ts`), and the worker computes
-- from exactly those (WP 13.2) — and this makes the rule the database's too, so no
-- front door can stamp a run with a model while handing it other data:
--
--   a non-exploratory run that names a model must carry the model's policy hash,
--   and, when the model names its dataset version, the simulation inputs of that
--   version (by CONTENT — `hash_inputs` — so WP 11.2's deep-tier rule still holds:
--   an edit the engine does not read keeps the model and its key).
--
-- An exploratory run is never refused here: it claims no validation. A model that
-- predates WP 10.3 (no dataset version) is held to its policy hash only, and the
-- dispatcher refuses its run when the live inputs moved (it cannot be replayed).
--
-- The body is `20261001000020`'s with the guard added after the simulation hash is
-- read; same signature, so the grants stand and are restated below.
-- `supabase/rehearsal/770` proves it, mutation-tested.

CREATE OR REPLACE FUNCTION public.create_simulation_run(
  p_run              jsonb,
  p_force_rerun      boolean DEFAULT false,
  p_attach_inflight  boolean DEFAULT true,
  _actor_user_id     uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_scenario  uuid := (p_run ->> 'scenario_id')::uuid;
  v_project   uuid := (p_run ->> 'project_id')::uuid;
  v_target    integer := GREATEST(1, COALESCE((p_run ->> 'rep_count_target')::int, 1));
  v_overrides jsonb := COALESCE(p_run -> 'protocol_overrides', '{}'::jsonb);
  v_engine    public.sim_engines%ROWTYPE;
  v_spec      jsonb;
  v_key       text;
  v_hit       record;
  v_model     uuid := NULLIF(p_run ->> 'model_validation_id', '')::uuid;
  v_id        uuid;
  v_rep_weeks bigint;
  v_actor     uuid;
  v_sim       text;
  v_simver    uuid;
  v_mpol      text;
  v_mds       uuid;
  v_msim      text;
  v_mgraph    text;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  IF v_scenario IS NULL OR v_project IS NULL THEN
    RAISE EXCEPTION 'a run names its project and scenario' USING ERRCODE = 'not_null_violation';
  END IF;
  IF jsonb_typeof(v_overrides) <> 'object' THEN
    RAISE EXCEPTION 'protocol_overrides is an object' USING ERRCODE = 'check_violation';
  END IF;

  v_engine := public.sim_engine_for_dispatch(NULLIF(p_run ->> 'engine_id', '')::uuid);
  -- WP 11.2 · §4 D260 — the key hashes what the engine READS: the simulation scope of
  -- the snapshot this run is bound to (read here, so a caller cannot hand the key a
  -- hash its snapshot does not carry), else the one the caller names.
  SELECT dv.hash_inputs, dv.simulation_version_id INTO v_sim, v_simver
    FROM public.dataset_versions dv
   WHERE dv.id = NULLIF(p_run ->> 'dataset_version_id', '')::uuid AND dv.project_id = v_project;
  v_sim := COALESCE(v_sim, NULLIF(p_run ->> 'hash_simulation', ''));
  IF v_simver IS NULL AND v_sim IS NOT NULL THEN
    SELECT id INTO v_simver FROM public.graph_level_versions
     WHERE project_id = v_project AND level = 'simulation' AND level_hash = v_sim;
  END IF;
  -- PLAN.md §23 WP 13.3 · §4 D280 — WHAT WAS VALIDATED IS WHAT RUNS. A run that
  -- follows a Validated Model (and is not exploratory) must read the model's own
  -- content: its policy hash, and — when the model names its dataset version — the
  -- simulation inputs of that version. A run naming the model while reading other
  -- data or other policies would carry a validation it does not have. Content, not
  -- ids: a run stamped by content after a deep-tier edit the engine does not read
  -- (WP 11.2) still reads the model's inputs and is accepted.
  IF v_model IS NOT NULL AND NOT COALESCE((p_run ->> 'exploratory')::boolean, false) THEN
    SELECT mv.policy_hash, mv.dataset_version_id,
           COALESCE(mv.hash_simulation, dvm.hash_inputs) AS sim, mv.graph_hash
      INTO v_mpol, v_mds, v_msim, v_mgraph
      FROM public.model_validations mv
      LEFT JOIN public.dataset_versions dvm ON dvm.id = mv.dataset_version_id
     WHERE mv.id = v_model AND mv.project_id = v_project;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the Validated Model % is not this project''s', v_model USING ERRCODE = 'check_violation';
    END IF;
    IF v_mpol IS DISTINCT FROM (p_run ->> 'policy_hash') THEN
      RAISE EXCEPTION 'a run of a Validated Model reads the model''s policy version — this run names other policies (§23 WP 13.3)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_mds IS NOT NULL AND (
         CASE WHEN v_msim IS NOT NULL THEN v_sim IS DISTINCT FROM v_msim
              ELSE (SELECT graph_hash FROM public.dataset_versions
                     WHERE id = NULLIF(p_run ->> 'dataset_version_id', '')::uuid) IS DISTINCT FROM v_mgraph
         END) THEN
      RAISE EXCEPTION 'a run of a Validated Model reads the model''s dataset version — this run names other data; run it as exploratory instead (§23 WP 13.3)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  v_spec := public.simulation_run_spec(v_scenario, p_run ->> 'policy_hash', v_sim,
                                       v_engine.id, v_overrides);
  v_key := public.simulation_run_key(v_spec);
  PERFORM pg_advisory_xact_lock(hashtextextended('simulation_run:' || v_project::text || ':' || v_key, 0));

  IF NOT COALESCE(p_force_rerun, false) THEN
    SELECT r.id, r.ended_at, r.created_at, r.code_version, r.rep_count_done INTO v_hit
      FROM public.simulation_runs r
     WHERE r.project_id = v_project AND r.scenario_id = v_scenario AND r.run_key = v_key
       AND r.status = 'done' AND COALESCE(r.rep_count_done, 0) >= v_target
     ORDER BY r.created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('reuse', jsonb_build_object(
        'run_id', v_hit.id, 'ended_at', v_hit.ended_at, 'created_at', v_hit.created_at,
        'code_version', v_hit.code_version, 'rep_count_done', v_hit.rep_count_done), 'run_key', v_key);
    END IF;
  END IF;

  IF COALESCE(p_attach_inflight, true) THEN
    SELECT r.id INTO v_hit
      FROM public.simulation_runs r
     WHERE r.project_id = v_project AND r.scenario_id = v_scenario AND r.run_key = v_key
       AND COALESCE(r.rep_count_target, 0) >= v_target
       AND (r.status = 'running' OR (r.status = 'queued' AND r.created_at > now() - interval '15 minutes'))
     ORDER BY r.created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('run_id', v_hit.id, 'attached', true, 'run_key', v_key);
    END IF;
  END IF;

  -- WP 10.7 · §4 D247 — capacity is checked HERE, for a run that will actually be
  -- computed: a reuse or an attach above consumes nothing. One enforcement point
  -- for every front door (the browser, /v1, agent-apply all reach this through
  -- the shared dispatcher). The actor is the app's asserted user (D28).
  v_rep_weeks := v_target::bigint * GREATEST(1, ceil(COALESCE((v_spec -> 'scenario' ->> 'horizon_days')::numeric, 364) / 7.0))::bigint;
  -- The member whose share this run draws on: the app's asserted user, which the
  -- dispatcher passes in the run (D28 — client-asserted); `_actor_user_id` when
  -- the caller has nothing else. A run with no actor is held to the pool only.
  v_actor := COALESCE(NULLIF(p_run ->> 'actor_user_id', '')::uuid, _actor_user_id);
  PERFORM public._capacity_admit(v_project, v_actor, v_target, v_rep_weeks,
                                 COALESCE((p_run ->> 'bytes_estimate')::bigint, 0),
                                 COALESCE(p_run -> 'limits', '{}'::jsonb));

  INSERT INTO public.simulation_runs (
    scenario_id, project_id, status, rep_count_target, rep_count_done, code_version,
    policy_version_id, policy_hash, dataset_version_id, graph_hash, created_by,
    scenario_hash, model_validation_id, gate_skipped, seed, disruption_schedule,
    engine_id, run_spec, run_key, protocol_overrides, exploratory,
    hash_simulation, simulation_version_id
  ) VALUES (
    v_scenario, v_project, 'queued', v_target, 0, '',
    NULLIF(p_run ->> 'policy_version_id', '')::uuid, p_run ->> 'policy_hash',
    NULLIF(p_run ->> 'dataset_version_id', '')::uuid, p_run ->> 'graph_hash',
    NULLIF(p_run ->> 'created_by', '')::uuid,
    p_run ->> 'scenario_hash', v_model,
    COALESCE((p_run ->> 'gate_skipped')::boolean, false),
    (p_run ->> 'seed')::bigint, p_run -> 'disruption_schedule',
    v_engine.id, v_spec, v_key, v_overrides,
    -- exploratory: said by the caller, and never false for a run with no model.
    COALESCE((p_run ->> 'exploratory')::boolean, false) OR v_model IS NULL,
    v_sim, v_simver
  )
  RETURNING id INTO v_id;
  -- The reservation: replication-weeks at dispatch, settled at completion.
  INSERT INTO public.run_usage (org_id, user_id, project_id, run_id, rep_weeks, bytes, kind)
  VALUES ((SELECT organization_id FROM public.projects WHERE id = v_project), v_actor, v_project, v_id,
          v_rep_weeks, 0, 'dispatch');
  -- The engine travels to the worker in the envelope, so a worker that runs a
  -- different one refuses the run instead of computing and relabelling it.
  RETURN jsonb_build_object('run_id', v_id, 'attached', false, 'run_key', v_key,
    'engine', jsonb_build_object('id', v_engine.id, 'slug', v_engine.slug,
                                 'code_version', v_engine.code_version));
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_simulation_run(jsonb, boolean, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_simulation_run(jsonb, boolean, boolean, uuid) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
