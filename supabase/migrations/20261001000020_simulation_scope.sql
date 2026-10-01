-- ============================================================================
-- Phase 11 / WP 11.2 · blueprint §9.2, §9.5 · gates `single-source`, `result-binding`
-- · §4 D259, D260, D261, D264
-- THE SIMULATION SCOPE, AND THE BINDINGS.
--
-- The engine reads eight tables (the worker's `datamap.py`). Since WP 4.1 the
-- snapshot's `inputs` domain has hashed exactly those eight, under a comment saying
-- so, and `hash_inputs` is its digest — so the scope the simulation reads already HAD
-- a hash. What it did not have was a NAME the store could key on, a gate comparing
-- the two read lists (D264), or a single consumer binding it: the Validated Model,
-- the RunKey and their content matches all bound the COMPOSITE, so a deep-tier upload
-- the engine never reads made every model stale and every simulation a new key
-- (D259, D260).
--
--   1. `simulation` joins the scope vocabulary, and ONE function maps a scope to the
--      hash that names it (`_scope_hash_key`, `simulation → hash_inputs`). The level
--      store registers it as a fourth level; every snapshot names its version.
--   2. A Validated Model binds `hash_simulation` and its version beside the snapshot
--      it was validated on; its `model_hash` digests the simulation hash; every
--      content match (supersede, the active-model unique key, dispatch stamping,
--      inheritance) compares it. A card no snapshot can teach (no snapshot id) keeps
--      the composite rule and says so by having no simulation hash.
--   3. RunKey v2: the spec's graph term is the simulation hash. The run row gains it
--      and its version; the composite stays. `find_reusable_runs` follows.
--   4. An analysis run records the VERSION of the level it keyed on (D261).
--
-- WHAT IT DOES NOT DO, AND WHY: NO NEW DIGEST AND NO `level_spec` BUMP. The brief
-- asked to fold a `hash_simulation` into `_dataset_level_hashes` and bump the level
-- rule to 2. A second digest of the same eight tables is one fact authored twice
-- (`single-source`); the brief tied the bump to that fold. So no stored hash moves,
-- and `rehearsal/670` §1 proves every one byte-identical across this migration
-- (§16 · WP 11.0).
--
-- RunKey history is NOT re-keyed. A stored `run_spec` is the identity a run was
-- dispatched under; a v1 key never equals a v2 key, so the first identical
-- submission after this migration re-runs once — the safe direction.
-- ============================================================================

-- ── 1 · the scope, named once ────────────────────────────────────────────

-- Which hash names a scope. THE mapping: the current-hash read, the analysis store
-- and the level state all ask it, so they cannot disagree about what `simulation`
-- means. `simulationScopeParity.test.ts` holds the `simulation` line to the domain
-- whose tables equal the worker's reads.
CREATE OR REPLACE FUNCTION public._scope_hash_key(p_scope text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE p_scope
           WHEN 'all'        THEN 'graph_hash'
           WHEN 'product'    THEN 'hash_product'
           WHEN 'process'    THEN 'hash_process'
           WHEN 'firm'       THEN 'hash_firm'
           WHEN 'simulation' THEN 'hash_inputs'
         END;
$$;
REVOKE ALL ON FUNCTION public._scope_hash_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_level_hash(p_project_id uuid, p_scope text)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.project_graph_hashes(p_project_id) ->> public._scope_hash_key(p_scope);
$$;
GRANT EXECUTE ON FUNCTION public.current_level_hash(uuid, text) TO anon, authenticated, service_role;

ALTER TABLE public.analysis_kinds DROP CONSTRAINT IF EXISTS analysis_kinds_input_scope_check;
ALTER TABLE public.analysis_kinds ADD CONSTRAINT analysis_kinds_input_scope_check
  CHECK (input_scope IN ('product', 'process', 'firm', 'simulation', 'all'));
ALTER TABLE public.analysis_kinds DROP CONSTRAINT IF EXISTS analysis_kinds_fallback_scope_check;
ALTER TABLE public.analysis_kinds ADD CONSTRAINT analysis_kinds_fallback_scope_check
  CHECK (fallback_scope IN ('product', 'process', 'firm', 'simulation', 'all'));
ALTER TABLE public.analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_input_scope_check;
ALTER TABLE public.analysis_runs ADD CONSTRAINT analysis_runs_input_scope_check
  CHECK (input_scope IN ('product', 'process', 'firm', 'simulation', 'all'));

-- ── 2 · the fourth level ─────────────────────────────────────────────────

ALTER TABLE public.dataset_versions
  ADD COLUMN IF NOT EXISTS simulation_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public._graph_level_register(p_dataset_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  dv     public.dataset_versions%ROWTYPE;
  v_spec integer := (public._dataset_level_hashes('{}'::jsonb) ->> 'level_spec')::int;
  v_ids  jsonb := '{}'::jsonb;
  v_lvl  text;
  v_hash text;
  v_id   uuid;
BEGIN
  SELECT * INTO dv FROM public.dataset_versions WHERE id = p_dataset_version_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(current_setting('app.current_user_id', true), '') = '' AND dv.author_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', dv.author_user_id::text, true);
  END IF;

  FOR v_lvl, v_hash IN
    SELECT l, h FROM (VALUES (1, 'product',    dv.hash_product),
                             (2, 'process',    dv.hash_process),
                             (3, 'firm',       dv.hash_firm),
                             -- WP 11.2 · the scope the engine reads: the `inputs` domain.
                             (4, 'simulation', dv.hash_inputs)) x(o, l, h)
     ORDER BY o
  LOOP
    CONTINUE WHEN v_hash IS NULL;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'graph_level_versions:' || dv.project_id::text || ':' || v_lvl, 0));
    SELECT id INTO v_id FROM public.graph_level_versions
     WHERE project_id = dv.project_id AND level = v_lvl AND level_hash = v_hash;
    IF NOT FOUND THEN
      INSERT INTO public.graph_level_versions
        (project_id, level, level_hash, level_spec, first_dataset_version_id, author_user_id, created_at)
      VALUES
        -- `simulation` is the `inputs` domain digest and carries no level rule.
        (dv.project_id, v_lvl, v_hash, CASE WHEN v_lvl = 'simulation' THEN NULL ELSE v_spec END,
         dv.id, dv.author_user_id, dv.created_at)
      RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_object(v_lvl, v_id);
  END LOOP;

  UPDATE public.dataset_versions
     SET product_version_id = (v_ids ->> 'product')::uuid,
         process_version_id = (v_ids ->> 'process')::uuid,
         firm_version_id    = (v_ids ->> 'firm')::uuid,
         simulation_version_id = (v_ids ->> 'simulation')::uuid
   WHERE id = dv.id
     AND (product_version_id IS DISTINCT FROM (v_ids ->> 'product')::uuid
       OR process_version_id IS DISTINCT FROM (v_ids ->> 'process')::uuid
       OR firm_version_id    IS DISTINCT FROM (v_ids ->> 'firm')::uuid
       OR simulation_version_id IS DISTINCT FROM (v_ids ->> 'simulation')::uuid);
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_register(uuid) FROM PUBLIC, anon, authenticated;

-- The backfill path learns `hash_inputs` too (a row frozen before WP 4.1 has none and
-- never will; a row that later learns one must register it).
DROP TRIGGER IF EXISTS dataset_versions_register_levels_upd ON public.dataset_versions;
CREATE TRIGGER dataset_versions_register_levels_upd
  AFTER UPDATE OF hash_product, hash_process, hash_firm, hash_inputs ON public.dataset_versions
  FOR EACH ROW
  WHEN (NEW.hash_product IS DISTINCT FROM OLD.hash_product
     OR NEW.hash_process IS DISTINCT FROM OLD.hash_process
     OR NEW.hash_firm    IS DISTINCT FROM OLD.hash_firm
     OR NEW.hash_inputs  IS DISTINCT FROM OLD.hash_inputs)
  EXECUTE FUNCTION public._graph_level_register_snapshot();

-- History, in order: the three levels are found (nothing is minted twice), the
-- simulation level is numbered in each project's `created_at` order.
SELECT public._graph_level_backfill();

CREATE OR REPLACE FUNCTION public.get_graph_version_state(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_h   jsonb := public.project_graph_hashes(p_project_id);
  v_cur public.dataset_versions%ROWTYPE;
  v_lat public.dataset_versions%ROWTYPE;
  v_n   bigint;
BEGIN
  SELECT * INTO v_cur FROM public.dataset_versions
   WHERE project_id = p_project_id AND graph_hash = v_h ->> 'graph_hash'
   ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_lat FROM public.dataset_versions
   WHERE project_id = p_project_id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT count(*) INTO v_n FROM public.dataset_versions WHERE project_id = p_project_id;
  RETURN jsonb_build_object(
    'current', v_h,
    'current_version', CASE WHEN v_cur.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_cur.id, 'version_no', v_cur.version_no, 'label', v_cur.label,
        'graph_hash', v_cur.graph_hash, 'created_at', v_cur.created_at) END,
    'latest', CASE WHEN v_lat.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_lat.id, 'version_no', v_lat.version_no, 'label', v_lat.label,
        'graph_hash', v_lat.graph_hash, 'hash_inputs', v_lat.hash_inputs,
        'hash_network', v_lat.hash_network, 'hash_product', v_lat.hash_product,
        'hash_process', v_lat.hash_process, 'hash_firm', v_lat.hash_firm,
        'product_version_id', v_lat.product_version_id,
        'process_version_id', v_lat.process_version_id,
        'firm_version_id', v_lat.firm_version_id,
        'simulation_version_id', v_lat.simulation_version_id,
        'author_email', v_lat.author_email, 'created_at', v_lat.created_at) END,
    'version_count', v_n,
    -- WP 11.1 · §4 D258 — each level's own version, from the same stored hashes.
    'levels', jsonb_build_object(
      'product', public._graph_level_state(p_project_id, 'product', v_h ->> 'hash_product'),
      'process', public._graph_level_state(p_project_id, 'process', v_h ->> 'hash_process'),
      'firm',    public._graph_level_state(p_project_id, 'firm',    v_h ->> 'hash_firm'),
      -- WP 11.2 · the scope the engine reads, by the ONE scope → hash mapping.
      'simulation', public._graph_level_state(p_project_id, 'simulation',
                                              v_h ->> public._scope_hash_key('simulation'))));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_graph_version_state(uuid) TO anon, authenticated, service_role;

-- ── 3 · an analysis run names its level's version (D261) ─────────────────

ALTER TABLE public.analysis_runs
  ADD COLUMN IF NOT EXISTS level_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL;

-- History, from each run's own scope and hash — computation, not invention: a run
-- whose content the project's level never froze stays NULL.
UPDATE public.analysis_runs ar
   SET level_version_id = g.id
  FROM public.graph_level_versions g
 WHERE ar.level_version_id IS NULL
   AND g.project_id = ar.project_id AND g.level = ar.input_scope AND g.level_hash = ar.input_hash;

CREATE OR REPLACE FUNCTION public.analysis_get_or_start(
  _project_id     uuid,
  _analysis_kind  text,
  _params         jsonb,
  _code_version   text,
  _actor_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_scope       text;
  v_hashes      jsonb;
  v_input_hash  text;
  v_dsv         uuid;
  v_lvl         uuid;
  v_params      jsonb := COALESCE(_params, '{}'::jsonb);
  v_params_hash text;
  v_run         public.analysis_runs;
BEGIN
  PERFORM public.assert_writer_may_act('analysis_get_or_start', _project_id, _actor_user_id);

  IF _analysis_kind IS NULL OR _code_version IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: analysis_kind and code_version are part of the key and may not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- §4 D235: the level this kind reads, from the ONE place it is stated. A kind
  -- the catalog does not declare keys on EVERYTHING ('all', the composite) — the
  -- conservative answer, which keeps WP 4.2's open enum open (a new kind costs no
  -- migration) without ever serving a stale hit.
  v_scope := COALESCE(public.analysis_scope_now(_project_id, _analysis_kind), 'all');

  v_hashes := public.project_graph_hashes(_project_id);
  -- WP 11.2 · the ONE scope → hash mapping (`simulation` is the `inputs` domain).
  v_input_hash := v_hashes ->> public._scope_hash_key(v_scope);
  IF v_input_hash IS NULL THEN
    RAISE EXCEPTION 'analysis_get_or_start: project % has no % hash, so a run could not name its inputs (I5)', _project_id, v_scope
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_params_hash := encode(extensions.digest(v_params::text, 'sha256'), 'hex');

  SELECT * INTO v_run FROM public.analysis_runs
   WHERE project_id = _project_id AND analysis_kind = _analysis_kind
     AND input_hash = v_input_hash AND params_hash = v_params_hash
     AND code_version = _code_version AND status = 'succeeded'
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', true, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
      'dataset_version_id', v_run.dataset_version_id,
      'level_version_id', v_run.level_version_id,
      'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
      'warnings', v_run.warnings, 'started_at', v_run.started_at,
      'finished_at', v_run.finished_at);
  END IF;

  -- The graph version this run computes over (created if the world has none yet).
  v_dsv := public.snapshot_dataset(_project_id, NULL, _actor_user_id, NULL);
  -- WP 11.2 · §4 D261 — and the VERSION of the level it keys on, which that snapshot
  -- has just registered. NULL for scope `all`, whose version is the snapshot itself.
  SELECT id INTO v_lvl FROM public.graph_level_versions
   WHERE project_id = _project_id AND level = v_scope AND level_hash = v_input_hash;

  INSERT INTO public.analysis_runs
    (project_id, analysis_kind, input_hash, input_scope, dataset_version_id, level_version_id,
     params_hash, params, code_version, actor_user_id)
  VALUES
    (_project_id, _analysis_kind, v_input_hash, v_scope, v_dsv, v_lvl,
     v_params_hash, v_params, _code_version, _actor_user_id)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_run;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'run_id', v_run.id, 'cache_hit', false, 'status', v_run.status,
      'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
      'dataset_version_id', v_run.dataset_version_id,
      'level_version_id', v_run.level_version_id,
      'params_hash', v_run.params_hash,
      'code_version', v_run.code_version, 'started_at', v_run.started_at);
  END IF;

  SELECT * INTO v_run FROM public.analysis_runs
   WHERE project_id = _project_id AND analysis_kind = _analysis_kind
     AND input_hash = v_input_hash AND params_hash = v_params_hash
     AND code_version = _code_version AND status <> 'failed'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_get_or_start: lost the key race for project %/% and then could not find the winner', _project_id, _analysis_kind;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id, 'cache_hit', v_run.status = 'succeeded', 'status', v_run.status,
    'input_hash', v_run.input_hash, 'input_scope', v_run.input_scope,
    'dataset_version_id', v_run.dataset_version_id,
    'params_hash', v_run.params_hash,
    'code_version', v_run.code_version, 'row_counts', v_run.row_counts,
    'warnings', v_run.warnings, 'started_at', v_run.started_at,
    'finished_at', v_run.finished_at, 'claimed_by_other', true);
END; $fn$;

-- ── 4 · the Validated Model binds the simulation scope (D259) ────────────

ALTER TABLE public.model_validations
  ADD COLUMN IF NOT EXISTS hash_simulation       text,
  ADD COLUMN IF NOT EXISTS simulation_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL;

-- The model's identity: policy content, the SIMULATION'S inputs, the scenario world,
-- the protocol, the engine. DROP + CREATE because the argument is renamed; its
-- callers are PL/pgSQL bodies that name it, and every one is redefined or reached
-- through `_insert_validated_model` below.
DROP FUNCTION IF EXISTS public._validated_model_hash(text, text, text, jsonb, text);
CREATE FUNCTION public._validated_model_hash(
  p_policy_hash text, p_simulation_hash text, p_scenario_hash text, p_protocol jsonb, p_engine text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT encode(extensions.digest(jsonb_build_object(
    'policy_hash', p_policy_hash, 'simulation_hash', p_simulation_hash,
    'scenario_hash', p_scenario_hash,
    'protocol_hash', encode(extensions.digest(COALESCE(p_protocol, 'null'::jsonb)::text, 'sha256'), 'hex'),
    'engine', p_engine)::text, 'sha256'), 'hex');
$$;

-- Immutability, with a second COMPLETION allowed (WP 10.4 allowed the first, the
-- engine id): a model that has not yet learnt its simulation hash may learn it — and
-- its version, and the `model_hash` recomputed on it — but only the values its OWN
-- snapshot dictates. That completes the model from a fact it already names; it cannot
-- re-point it at another world. Anything else stays refused.
CREATE OR REPLACE FUNCTION public._validated_model_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  k_lifecycle text[] := ARRAY['status','superseded_by','revoked_at','revoked_by','revoke_reason'];
  k_fill      text[] := k_lifecycle;
  v_sim       text;
  v_simver    uuid;
BEGIN
  IF OLD.engine_id IS NULL
     AND NEW.engine_id IS NOT DISTINCT FROM public._engine_for_code_version(OLD.engine_fingerprint) THEN
    k_fill := k_fill || ARRAY['engine_id'];
  END IF;
  IF OLD.hash_simulation IS NULL AND NEW.hash_simulation IS NOT NULL THEN
    SELECT hash_inputs, simulation_version_id INTO v_sim, v_simver
      FROM public.dataset_versions WHERE id = OLD.dataset_version_id;
    IF NEW.hash_simulation = v_sim
       AND NEW.simulation_version_id IS NOT DISTINCT FROM v_simver
       AND NEW.model_hash IS NOT DISTINCT FROM public._validated_model_hash(
             OLD.policy_hash, v_sim, OLD.scenario_hash, OLD.protocol, OLD.engine_fingerprint) THEN
      k_fill := k_fill || ARRAY['hash_simulation', 'simulation_version_id', 'model_hash'];
    END IF;
  END IF;
  IF (to_jsonb(NEW) - k_fill) IS DISTINCT FROM (to_jsonb(OLD) - k_fill) THEN
    RAISE EXCEPTION 'model_validations: a Validated Model is immutable — only its status, supersession and revocation may change (WP 10.3)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;

-- Existing models learn their simulation hash and version from their OWN snapshot,
-- and their `model_hash` is recomputed on it — once, through the completion above.
-- The engine term is `engine_fingerprint`, which is what the insert path has always
-- passed. A card with no snapshot keeps both NULL and its old hash; it goes on
-- matching on the composite.
UPDATE public.model_validations m
   SET hash_simulation       = dv.hash_inputs,
       simulation_version_id = dv.simulation_version_id,
       model_hash            = public._validated_model_hash(m.policy_hash, dv.hash_inputs, m.scenario_hash,
                                                            m.protocol, m.engine_fingerprint)
  FROM public.dataset_versions dv
 WHERE dv.id = m.dataset_version_id
   AND dv.hash_inputs IS NOT NULL
   AND m.hash_simulation IS NULL;

-- One ACTIVE model per content, where content is now the simulation's inputs: two
-- models that differ only in a deep tier the engine never read are one model, and the
-- newer one stands (linked, never deleted).
WITH ranked AS (
  SELECT id,
         first_value(id) OVER w AS keeper,
         row_number()    OVER w AS rn
    FROM public.model_validations
   WHERE status = 'active'
  WINDOW w AS (PARTITION BY project_id, policy_hash, COALESCE(hash_simulation, graph_hash), scenario_hash
               ORDER BY validated_at DESC, created_at DESC, id DESC)
)
UPDATE public.model_validations mv
   SET status = 'superseded',
       superseded_by = ranked.keeper
  FROM ranked
 WHERE mv.id = ranked.id
   AND ranked.rn > 1;

DROP INDEX IF EXISTS public.model_validations_active_content_uq;
CREATE UNIQUE INDEX IF NOT EXISTS model_validations_active_content_uq
  ON public.model_validations (project_id, policy_hash, (COALESCE(hash_simulation, graph_hash)), scenario_hash)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public._insert_validated_model(
  p_project_id         uuid,
  p_policy_version_id  uuid,
  p_dataset_version_id uuid,
  p_scenario_id        uuid,
  p_name               text,
  p_protocol           jsonb,
  p_warmup_method      text,
  p_replication_basis  jsonb,
  p_validation_tests   jsonb,
  p_findings           jsonb,
  p_verdict            text,
  p_basis              text,
  p_face_validation    text,
  p_evidence_run_id    uuid,
  p_evidence           jsonb,
  p_actor              uuid,
  p_actor_email        text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id             uuid := gen_random_uuid();
  v_prev_id        uuid;
  v_policy_hash    text;
  v_graph_hash     text;
  v_sim_hash       text;
  v_sim_version    uuid;
  v_fingerprint    jsonb;
  v_scenario_hash  text;
  v_engine         text;
  v_ver_project    uuid;
  v_scen_project   uuid;
  v_ds_project     uuid;
  v_probs          text[];
BEGIN
  IF p_actor IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_actor::text, true);
  END IF;

  IF p_dataset_version_id IS NULL THEN
    RAISE EXCEPTION 'a Validated Model names the graph version it was validated on (dataset_version_id)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  v_probs := public.validated_model_protocol_problems(p_protocol);
  IF cardinality(v_probs) > 0 OR (p_protocol ? 'backfilled') THEN
    RAISE EXCEPTION 'the run protocol is incomplete: %', array_to_string(
      CASE WHEN cardinality(v_probs) > 0 THEN v_probs ELSE ARRAY['a new model may not carry a backfilled protocol'] END, '; ')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT project_id INTO v_ver_project FROM public.policy_versions WHERE id = p_policy_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy version % not found', p_policy_version_id; END IF;
  IF v_ver_project <> p_project_id THEN
    RAISE EXCEPTION 'policy version does not belong to project %', p_project_id;
  END IF;
  v_policy_hash := public._policy_version_hash(p_policy_version_id);

  -- WP 11.2 · §4 D259 — the model binds the scope the engine READS (the snapshot's
  -- `inputs` domain) and that scope's version, beside the snapshot it was validated on.
  SELECT project_id, graph_hash, hash_inputs, simulation_version_id
    INTO v_ds_project, v_graph_hash, v_sim_hash, v_sim_version
    FROM public.dataset_versions WHERE id = p_dataset_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset version % not found', p_dataset_version_id; END IF;
  IF v_ds_project <> p_project_id THEN
    RAISE EXCEPTION 'dataset version does not belong to project %', p_project_id;
  END IF;

  SELECT project_id INTO v_scen_project FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  IF v_scen_project <> p_project_id THEN
    RAISE EXCEPTION 'scenario does not belong to project %', p_project_id;
  END IF;

  v_fingerprint   := public._build_scenario_fingerprint(p_scenario_id);
  v_scenario_hash := encode(extensions.digest(v_fingerprint::text, 'sha256'), 'hex');

  IF p_evidence_run_id IS NOT NULL THEN
    SELECT NULLIF(code_version, '') INTO v_engine FROM public.simulation_runs WHERE id = p_evidence_run_id;
  END IF;

  UPDATE public.model_validations
     SET status = 'superseded'
   WHERE project_id = p_project_id AND policy_hash = v_policy_hash
     AND COALESCE(hash_simulation, graph_hash) = COALESCE(v_sim_hash, v_graph_hash)
     AND scenario_hash = v_scenario_hash
     AND status = 'active'
  RETURNING id INTO v_prev_id;

  INSERT INTO public.model_validations (
    id, project_id, name, protocol, protocol_hash, model_hash, face_validation,
    policy_version_id, policy_hash, dataset_version_id, graph_hash,
    hash_simulation, simulation_version_id,
    scenario_hash, scenario_fingerprint, engine_fingerprint,
    adopted_warmup_days, warmup_method, recommended_replications, replication_basis,
    validation_tests, findings_snapshot, verdict, basis, evidence_run_id,
    author_user_id, author_email
  ) VALUES (
    v_id, p_project_id,
    COALESCE(NULLIF(btrim(p_name), ''), 'Validated model'),
    p_protocol,
    encode(extensions.digest(p_protocol::text, 'sha256'), 'hex'),
    public._validated_model_hash(v_policy_hash, COALESCE(v_sim_hash, v_graph_hash), v_scenario_hash, p_protocol, v_engine),
    NULLIF(btrim(COALESCE(p_face_validation, '')), ''),
    p_policy_version_id, v_policy_hash, p_dataset_version_id, v_graph_hash,
    v_sim_hash, v_sim_version,
    v_scenario_hash, v_fingerprint, v_engine,
    (p_protocol ->> 'warmup_week')::int * 7,
    COALESCE(p_warmup_method, 'engine'),
    (p_protocol ->> 'replications')::int,
    COALESCE(p_replication_basis, '{}'::jsonb),
    COALESCE(p_validation_tests, '[]'::jsonb), COALESCE(p_findings, '[]'::jsonb),
    p_verdict, p_basis, p_evidence_run_id,
    p_actor, p_actor_email
  );

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.model_validations SET superseded_by = v_id WHERE id = v_prev_id;
  END IF;

  INSERT INTO public.model_validation_evidence (
    validation_id, project_id, warmup, replication_analysis, kpi_tests, face_validation,
    evidence_run_ids, author_user_id
  ) VALUES (
    v_id, p_project_id,
    COALESCE(p_evidence -> 'warmup', '{}'::jsonb),
    COALESCE(p_evidence -> 'replication_analysis', p_replication_basis, '{}'::jsonb),
    COALESCE(p_validation_tests, '[]'::jsonb),
    CASE WHEN NULLIF(btrim(COALESCE(p_face_validation, '')), '') IS NULL THEN NULL
         ELSE jsonb_build_object('statement', btrim(p_face_validation), 'by', p_actor, 'at', now()) END,
    COALESCE(ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(p_evidence -> 'run_ids') x),
             CASE WHEN p_evidence_run_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_evidence_run_id] END),
    p_actor
  );

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._insert_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,text,uuid,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;

-- Dispatch stamps through this, passing the composite of the snapshot it just took.
-- The composite names a snapshot; the snapshot names its simulation hash; a card is
-- in force when IT binds that hash — so the dispatcher needs no change to stamp by
-- inputs, and a deployed dispatcher stamps correctly from the moment this migrates.
CREATE OR REPLACE FUNCTION public.active_model_validation_by_content(
  p_project_id    uuid,
  p_policy_hash   text,
  p_graph_hash    text,
  p_scenario_hash text
) RETURNS SETOF public.model_validations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH sim AS (
    SELECT dv.hash_inputs AS h
      FROM public.dataset_versions dv
     WHERE dv.project_id = p_project_id AND dv.graph_hash = p_graph_hash AND dv.hash_inputs IS NOT NULL
     ORDER BY dv.created_at, dv.id
     LIMIT 1
  )
  SELECT m.*
    FROM public.model_validations m
   WHERE m.project_id    = p_project_id
     AND m.policy_hash   = p_policy_hash
     AND m.scenario_hash = p_scenario_hash
     AND m.status        = 'active'
     AND m.verdict       = 'validated'
     AND ((m.hash_simulation IS NOT NULL AND m.hash_simulation = (SELECT h FROM sim))
       OR (m.hash_simulation IS NULL AND m.graph_hash = p_graph_hash))
   ORDER BY m.validated_at DESC, m.id
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.active_model_validation_by_content(uuid, text, text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_validation_to_scenario(
  p_scenario_id   uuid,
  p_validation_id uuid,
  _actor_user_id  uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_card public.model_validations%ROWTYPE;
  v_scen_project uuid;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;

  SELECT * INTO v_card FROM public.model_validations WHERE id = p_validation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'validation % not found', p_validation_id; END IF;

  SELECT project_id INTO v_scen_project FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  IF v_scen_project <> v_card.project_id THEN
    RAISE EXCEPTION 'validation and scenario belong to different projects';
  END IF;

  IF v_card.status <> 'active' OR v_card.verdict <> 'validated' THEN
    RAISE EXCEPTION 'validation % is not an active validated model', p_validation_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.scenario_fingerprint_hash(p_scenario_id) IS DISTINCT FROM v_card.scenario_hash THEN
    RAISE EXCEPTION 'scenario % is not in the validated model''s world (scenario fingerprint differs)', p_scenario_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.current_policy_hash(v_card.project_id) IS DISTINCT FROM v_card.policy_hash THEN
    RAISE EXCEPTION 'the project''s policies are not the validated model''s (policy content differs)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- WP 11.2 · §4 D259 — the model's world is the SIMULATION'S inputs; a deep-tier
  -- change the engine never reads does not make it a different model. A card that
  -- could not learn its simulation hash (no snapshot) keeps the composite rule.
  IF v_card.hash_simulation IS NOT NULL THEN
    IF public.current_level_hash(v_card.project_id, 'simulation') IS DISTINCT FROM v_card.hash_simulation THEN
      RAISE EXCEPTION 'the project''s simulation inputs are not the validated model''s (inputs differ)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF public.current_graph_hash(v_card.project_id) IS DISTINCT FROM v_card.graph_hash THEN
    RAISE EXCEPTION 'the project''s data is not the validated model''s (graph differs)'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.scenarios SET
    warmup_mode             = 'manual',
    warmup_days             = v_card.adopted_warmup_days,
    replications            = v_card.recommended_replications,
    inherited_validation_id = v_card.id
  WHERE id = p_scenario_id;
END;
$$;

-- The list the AI tools read the badge from (`get_validation_status`, the reuse
-- lookup's badge column). It returned the composite and nothing else, so the agent's
-- copy of the badge rule could only say "stale (data drift)" after a deep-tier upload
-- the engine never reads. RETURNS TABLE cannot widen in place: DROP + CREATE, with the
-- two columns appended so positional readers are unchanged, and the grant restated.
DROP FUNCTION IF EXISTS public.list_model_validations(uuid);
CREATE FUNCTION public.list_model_validations(p_project_id uuid)
RETURNS TABLE (
  id                       uuid,
  policy_version_id        uuid,
  policy_hash              text,
  dataset_version_id       uuid,
  graph_hash               text,
  scenario_hash            text,
  engine_fingerprint       text,
  adopted_warmup_days      integer,
  warmup_method            text,
  recommended_replications integer,
  verdict                  text,
  basis                    text,
  status                   text,
  evidence_run_id          uuid,
  author_email             text,
  validated_at             timestamptz,
  hash_simulation          text,
  simulation_version_id    uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, policy_version_id, policy_hash, dataset_version_id, graph_hash,
         scenario_hash, engine_fingerprint, adopted_warmup_days, warmup_method,
         recommended_replications, verdict, basis, status, evidence_run_id,
         author_email, validated_at, hash_simulation, simulation_version_id
  FROM public.model_validations
  WHERE project_id = p_project_id
  ORDER BY validated_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_model_validations(uuid) TO anon, authenticated, service_role;

-- ── 5 · RunKey v2 hashes the simulation scope (D260) ─────────────────────

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS hash_simulation       text,
  ADD COLUMN IF NOT EXISTS simulation_version_id uuid
    REFERENCES public.graph_level_versions(id) ON DELETE SET NULL;

-- History learns WHAT IT COMPUTED OVER from its own snapshot (the run row is not
-- immutable, and this is a fact its snapshot already holds). Its `run_spec` and
-- `run_key` are left alone: they are the identity it was dispatched under.
UPDATE public.simulation_runs r
   SET hash_simulation       = dv.hash_inputs,
       simulation_version_id = dv.simulation_version_id
  FROM public.dataset_versions dv
 WHERE dv.id = r.dataset_version_id
   AND dv.hash_inputs IS NOT NULL
   AND r.hash_simulation IS NULL;

-- The argument is renamed, which `CREATE OR REPLACE` cannot do. Both callers that
-- name it positionally (`create_simulation_run`, `find_reusable_runs`) are redefined
-- here; a caller that named `p_graph_hash` (a dispatcher deployed ahead of this
-- migration) gets "function not found", which it already treats as the deploy window.
DROP FUNCTION IF EXISTS public.find_reusable_runs(uuid, text, text, integer, uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.simulation_run_spec(uuid, text, text, uuid, jsonb);

CREATE FUNCTION public.simulation_run_spec(
  p_scenario_id        uuid,
  p_policy_hash        text,
  p_simulation_hash    text,
  p_engine_id          uuid DEFAULT NULL,
  p_protocol_overrides jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  e    public.sim_engines%ROWTYPE;
  sc   jsonb;
BEGIN
  e := public.sim_engine_for_dispatch(p_engine_id);
  SELECT to_jsonb(s) - ARRAY['id','project_id','name','description','created_by','created_at',
                             'updated_at','role','inherited_validation_id','from_network']
    INTO sc
    FROM public.scenarios s WHERE s.id = p_scenario_id;
  IF sc IS NULL THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    -- v2 (WP 11.2): the graph term is the simulation scope, not the composite.
    'run_key_version', 2,
    'engine', jsonb_build_object('id', e.id, 'slug', e.slug, 'version', e.version,
                                 'code_version', e.code_version),
    'policy_hash', p_policy_hash,
    'simulation_hash', p_simulation_hash,
    'scenario', sc,
    'protocol_overrides', COALESCE(p_protocol_overrides, '{}'::jsonb));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.simulation_run_spec(uuid, text, text, uuid, jsonb) TO anon, authenticated, service_role;

CREATE FUNCTION public.find_reusable_runs(
  p_scenario_id        uuid,
  p_policy_hash        text,
  p_simulation_hash    text,
  p_replications       integer,
  p_engine_id          uuid DEFAULT NULL,
  p_protocol_overrides jsonb DEFAULT '{}'::jsonb,
  p_limit              integer DEFAULT 1
) RETURNS TABLE (run_id uuid, ended_at timestamptz, created_at timestamptz,
                 code_version text, rep_count_done integer, run_key text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH k AS (
    SELECT public.simulation_run_key(
      public.simulation_run_spec(p_scenario_id, p_policy_hash, p_simulation_hash, p_engine_id, p_protocol_overrides)) AS key
  )
  SELECT r.id, r.ended_at, r.created_at, r.code_version, r.rep_count_done, r.run_key
    FROM public.simulation_runs r, k
   WHERE r.scenario_id = p_scenario_id
     AND r.run_key = k.key
     AND r.status = 'done'
     AND COALESCE(r.rep_count_done, 0) >= GREATEST(1, p_replications)
   ORDER BY r.created_at DESC
   LIMIT GREATEST(1, LEAST(5, COALESCE(p_limit, 1)));
$$;
GRANT EXECUTE ON FUNCTION public.find_reusable_runs(uuid, text, text, integer, uuid, jsonb, integer)
  TO anon, authenticated, service_role;

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
