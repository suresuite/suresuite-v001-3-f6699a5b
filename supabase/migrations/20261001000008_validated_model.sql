-- Phase 10 / WP 10.3 / §9.5 · §9.5.1 · §4 D243, D244 — THE VALIDATED MODEL.
--
-- `model_validations` becomes the Validated Model, EXTENDED, never replaced
-- (blueprint §0): a card already binds the policy, the graph and the scenario world
-- it was established on, and WP 10.2 made it found by that content. What it did not
-- state is HOW a decision-grade run must be made — so two cards that would tell an
-- analyst to run different experiments could share an identity (D243) — and it kept
-- a summary of its evidence instead of the evidence.
--
--   1. `protocol jsonb` — replications, root seed, CRN, the week steady state
--      begins, horizon, analysis window, CI level, CI half-width target, stopping
--      rule — checked by `validated_model_protocol_problems`, the one statement of
--      what a complete protocol is. `protocol_hash` and `model_hash` (policy, graph,
--      scenario world, protocol, engine) are the model's own identity.
--   2. `name`, per-project `version_no`, `engine_id` (its foreign key lands with the
--      engine registry in WP 10.4), revocation fields, and `face_validation` — the
--      recorded statement a face-validated model rests on.
--   3. IMMUTABLE. A trigger refuses every UPDATE except the lifecycle: status,
--      superseded_by and the revocation fields. Newer data or a newer policy never
--      mutates a model; it makes it stale, which is derived (§9.5 addendum (2)).
--   4. `model_validation_evidence` — the warm-up series and detector outputs, the
--      replication analysis, the per-KPI tests, the face-validation statement and
--      the evidence run ids. One row per model, immutable, audited.
--   5. ONE insert path, `_insert_validated_model`. `record_validated_model` (the
--      Save Validated Model action) authenticates the actor and enforces the
--      ADOPTION RULE — every selected KPI passed, or a recorded face-validation
--      statement (D244). `record_model_validation` keeps its signature for its two
--      existing callers (the deploy window, and `agent-apply`'s card proposal) and
--      derives a complete protocol from its arguments and the scenario.
--
-- ── WHAT THIS DOES NOT DO, AND WHY: THE SCENARIO FINGERPRINT IS NOT WIDENED ──
--
-- The brief asked to widen `scenario_fingerprint_hash` to include the protocol. It
-- is NOT widened, and the reason is the B0 design's own refinement (1): the
-- fingerprint is what a NEW scenario is matched on to INHERIT a card's warm-up and
-- replications (`apply_validation_to_scenario`). A stress scenario seeded from the
-- model has not inherited the protocol yet at the moment it is matched, so a
-- fingerprint that included the protocol could never match it — inheritance would
-- stop working, which is D219 again. The defect the widening was meant to close
-- (D243: two different protocols sharing one identity) is closed by `model_hash`,
-- which IS the Validated Model's identity and includes the protocol. §16 · WP 10.3.
-- ============================================================================

-- ── 1 · the protocol's one statement ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validated_model_protocol_problems(p jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE
  probs   text[] := '{}';
  unknown text[] := '{}';
  backfilled boolean := COALESCE((p ->> 'backfilled')::boolean, false);
  k       text;
  v_int_keys text[] := ARRAY['replications','root_seed','warmup_week','horizon_weeks','analysis_window_weeks'];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN ARRAY['protocol is not an object'];
  END IF;
  -- A protocol BACKFILLED from a card that predates protocols names the keys
  -- nothing recorded. Only those may be null; everything stated must be valid.
  IF p ? 'unknown' THEN
    SELECT COALESCE(array_agg(x), '{}') INTO unknown FROM jsonb_array_elements_text(p -> 'unknown') x;
  END IF;

  FOREACH k IN ARRAY ARRAY['replications','root_seed','crn','warmup_week','horizon_weeks',
                           'analysis_window_weeks','ci_level','ci_halfwidth_target','stopping_rule'] LOOP
    IF NOT (p ? k) THEN
      probs := probs || format('%s is missing', k);
    ELSIF jsonb_typeof(p -> k) = 'null' AND NOT (k = ANY (unknown)) AND k <> 'ci_halfwidth_target' THEN
      probs := probs || format('%s is null', k);
    END IF;
  END LOOP;
  IF cardinality(probs) > 0 THEN RETURN probs; END IF;

  FOREACH k IN ARRAY v_int_keys LOOP
    IF jsonb_typeof(p -> k) = 'number' AND ((p ->> k)::numeric <> trunc((p ->> k)::numeric)) THEN
      probs := probs || format('%s is not a whole number', k);
    ELSIF jsonb_typeof(p -> k) NOT IN ('number','null') THEN
      probs := probs || format('%s is not a number', k);
    END IF;
  END LOOP;
  IF cardinality(probs) > 0 THEN RETURN probs; END IF;

  -- A backfilled card states what it recommended, which may exceed what the engine
  -- runs in one go; a NEW protocol is what will be dispatched, so it must fit.
  IF jsonb_typeof(p -> 'replications') = 'number' AND (p ->> 'replications')::int < 1 THEN
    probs := array_append(probs, 'replications must be at least 1'::text);
  ELSIF NOT backfilled AND jsonb_typeof(p -> 'replications') = 'number' AND (p ->> 'replications')::int > 200 THEN
    probs := array_append(probs, 'replications must be at most 200 (the engine''s clamp)'::text);
  END IF;
  IF jsonb_typeof(p -> 'root_seed') = 'number' AND (p ->> 'root_seed')::bigint < 0 THEN
    probs := array_append(probs, 'root_seed must be non-negative'::text);
  END IF;
  IF jsonb_typeof(p -> 'crn') NOT IN ('boolean','null') THEN
    probs := array_append(probs, 'crn must be true or false'::text);
  END IF;
  IF jsonb_typeof(p -> 'warmup_week') = 'number' AND (p ->> 'warmup_week')::int < 0 THEN
    probs := array_append(probs, 'warmup_week must be non-negative'::text);
  END IF;
  IF jsonb_typeof(p -> 'horizon_weeks') = 'number' AND (p ->> 'horizon_weeks')::int < 1 THEN
    probs := array_append(probs, 'horizon_weeks must be at least 1'::text);
  END IF;
  IF jsonb_typeof(p -> 'analysis_window_weeks') = 'number' AND (p ->> 'analysis_window_weeks')::int < 1 THEN
    probs := array_append(probs, 'analysis_window_weeks must be at least 1'::text);
  END IF;
  IF NOT backfilled AND jsonb_typeof(p -> 'analysis_window_weeks') = 'number' AND jsonb_typeof(p -> 'horizon_weeks') = 'number'
     AND jsonb_typeof(p -> 'warmup_week') = 'number'
     AND (p ->> 'warmup_week')::int + (p ->> 'analysis_window_weeks')::int > (p ->> 'horizon_weeks')::int THEN
    probs := array_append(probs, 'warm-up plus analysis window exceeds the horizon'::text);
  END IF;
  IF jsonb_typeof(p -> 'ci_level') = 'number' AND NOT ((p ->> 'ci_level')::numeric > 0.5 AND (p ->> 'ci_level')::numeric < 1) THEN
    probs := array_append(probs, 'ci_level must be between 0.5 and 1'::text);
  ELSIF jsonb_typeof(p -> 'ci_level') NOT IN ('number','null') THEN
    probs := array_append(probs, 'ci_level is not a number'::text);
  END IF;
  IF jsonb_typeof(p -> 'ci_halfwidth_target') = 'number' AND (p ->> 'ci_halfwidth_target')::numeric <= 0 THEN
    probs := array_append(probs, 'ci_halfwidth_target must be positive'::text);
  ELSIF jsonb_typeof(p -> 'ci_halfwidth_target') NOT IN ('number','null') THEN
    probs := array_append(probs, 'ci_halfwidth_target is not a number'::text);
  END IF;
  IF jsonb_typeof(p -> 'stopping_rule') = 'string' AND (p ->> 'stopping_rule') NOT IN ('fixed_horizon','ci_halfwidth') THEN
    probs := array_append(probs, 'stopping_rule must be fixed_horizon or ci_halfwidth'::text);
  ELSIF jsonb_typeof(p -> 'stopping_rule') NOT IN ('string','null') THEN
    probs := array_append(probs, 'stopping_rule is not a string'::text);
  END IF;
  IF (p ->> 'stopping_rule') = 'ci_halfwidth' AND jsonb_typeof(p -> 'ci_halfwidth_target') IS DISTINCT FROM 'number' THEN
    probs := array_append(probs, 'a ci_halfwidth stopping rule needs a ci_halfwidth_target'::text);
  END IF;
  RETURN probs;
END;
$$;
GRANT EXECUTE ON FUNCTION public.validated_model_protocol_problems(jsonb) TO anon, authenticated, service_role;

-- ── 2 · the columns ──────────────────────────────────────────────────────

ALTER TABLE public.model_validations
  ADD COLUMN IF NOT EXISTS name            text,
  ADD COLUMN IF NOT EXISTS version_no      integer,
  ADD COLUMN IF NOT EXISTS protocol        jsonb,
  ADD COLUMN IF NOT EXISTS protocol_hash   text,
  ADD COLUMN IF NOT EXISTS model_hash      text,
  ADD COLUMN IF NOT EXISTS engine_id       uuid,
  ADD COLUMN IF NOT EXISTS face_validation text,
  ADD COLUMN IF NOT EXISTS revoked_at      timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by      uuid,
  ADD COLUMN IF NOT EXISTS revoke_reason   text;

-- The model's own identity: policy content, graph, scenario world, protocol, engine.
CREATE OR REPLACE FUNCTION public._validated_model_hash(
  p_policy_hash text, p_graph_hash text, p_scenario_hash text, p_protocol jsonb, p_engine text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT encode(extensions.digest(jsonb_build_object(
    'policy_hash', p_policy_hash, 'graph_hash', p_graph_hash,
    'scenario_hash', p_scenario_hash,
    'protocol_hash', encode(extensions.digest(COALESCE(p_protocol, 'null'::jsonb)::text, 'sha256'), 'hex'),
    'engine', p_engine)::text, 'sha256'), 'hex');
$$;

-- ── 3 · backfill the cards that exist (BEFORE the immutability trigger) ─────
--
-- From each card's own columns and its evidence run's stamped seed. What no
-- column recorded is named in `unknown`, not guessed: CRN and the stopping rule
-- were never stored on a card, and a seed only where an evidence run carries one.
UPDATE public.model_validations mv
   SET protocol = x.protocol
  FROM (
    SELECT m.id,
      jsonb_strip_nulls(jsonb_build_object(
        'backfilled', true,
        'replications', m.recommended_replications,
        'warmup_week', ceil(m.adopted_warmup_days / 7.0)::int,  -- as recorded
        'horizon_weeks', CASE WHEN (m.scenario_fingerprint ->> 'horizon_days') IS NULL THEN NULL
                              ELSE ceil((m.scenario_fingerprint ->> 'horizon_days')::numeric / 7.0)::int END,
        'ci_level', (m.replication_basis ->> 'confidence')::numeric,
        'ci_halfwidth_target', (m.replication_basis ->> 'target_precision')::numeric,
        'root_seed', r.seed
      ))
      || jsonb_build_object(
        'crn', NULL, 'stopping_rule', NULL,
        'analysis_window_weeks', CASE
           WHEN (m.scenario_fingerprint ->> 'horizon_days') IS NULL THEN NULL
           ELSE GREATEST(1, ceil((m.scenario_fingerprint ->> 'horizon_days')::numeric / 7.0)::int
                            - ceil(m.adopted_warmup_days / 7.0)::int) END)
      AS protocol
    FROM public.model_validations m
    LEFT JOIN public.simulation_runs r ON r.id = m.evidence_run_id
   WHERE m.protocol IS NULL
  ) x
 WHERE mv.id = x.id;

-- Fill the keys the strip removed back as explicit nulls and list every unknown.
UPDATE public.model_validations
   SET protocol = (
     SELECT jsonb_object_agg(k, protocol -> k)
       FROM unnest(ARRAY['replications','root_seed','crn','warmup_week','horizon_weeks',
                         'analysis_window_weeks','ci_level','ci_halfwidth_target','stopping_rule']) k
   ) || jsonb_build_object('backfilled', true, 'unknown', (
     SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
       FROM unnest(ARRAY['replications','root_seed','crn','warmup_week','horizon_weeks',
                         'analysis_window_weeks','ci_level','ci_halfwidth_target','stopping_rule']) k
      WHERE protocol -> k IS NULL OR jsonb_typeof(protocol -> k) = 'null'))
 WHERE protocol ? 'backfilled' AND NOT (protocol ? 'unknown');

UPDATE public.model_validations
   SET name = COALESCE(name, 'Validated model ' || to_char(validated_at, 'YYYY-MM-DD')),
       protocol_hash = encode(extensions.digest(protocol::text, 'sha256'), 'hex'),
       model_hash = public._validated_model_hash(policy_hash, graph_hash, scenario_hash, protocol,
                                                 COALESCE(engine_id::text, engine_fingerprint))
 WHERE protocol_hash IS NULL;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
    FROM public.model_validations
)
UPDATE public.model_validations mv SET version_no = numbered.n
  FROM numbered WHERE numbered.id = mv.id AND mv.version_no IS NULL;

ALTER TABLE public.model_validations
  DROP CONSTRAINT IF EXISTS model_validations_protocol_check;
ALTER TABLE public.model_validations
  ADD CONSTRAINT model_validations_protocol_check
  CHECK (protocol IS NULL OR cardinality(public.validated_model_protocol_problems(protocol)) = 0);

-- ── 4 · immutability ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._validated_model_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  k_lifecycle text[] := ARRAY['status','superseded_by','revoked_at','revoked_by','revoke_reason'];
BEGIN
  IF (to_jsonb(NEW) - k_lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - k_lifecycle) THEN
    RAISE EXCEPTION 'model_validations: a Validated Model is immutable — only its status, supersession and revocation may change (WP 10.3)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS model_validations_immutable ON public.model_validations;
CREATE TRIGGER model_validations_immutable
  BEFORE UPDATE ON public.model_validations
  FOR EACH ROW EXECUTE FUNCTION public._validated_model_immutable();

-- Number on insert; one number per model per project.
-- …and the two things a NEW model may not lack. Required on INSERT, not by a
-- CHECK: `dataset_version_id` is `ON DELETE SET NULL`, and a CHECK would fire on
-- that cascade's UPDATE while the project holding both rows is being deleted.
CREATE OR REPLACE FUNCTION public._validated_model_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.dataset_version_id IS NULL THEN
    RAISE EXCEPTION 'a Validated Model names the graph version it was validated on (dataset_version_id)'
      USING ERRCODE = 'not_null_violation';
  END IF;
  IF NEW.protocol IS NULL OR (NEW.protocol ? 'backfilled') THEN
    RAISE EXCEPTION 'a new Validated Model states its complete run protocol'
      USING ERRCODE = 'not_null_violation';
  END IF;
  IF NEW.version_no IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('model_validations:' || NEW.project_id::text, 0));
    SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
      FROM public.model_validations WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS model_validations_number ON public.model_validations;
CREATE TRIGGER model_validations_number
  BEFORE INSERT ON public.model_validations
  FOR EACH ROW EXECUTE FUNCTION public._validated_model_number();

-- The audit triggers this table never had: it is described from this package on,
-- and `dataPlaneAudit.test.ts` holds every tier-4 table in the contract to them.
DROP TRIGGER IF EXISTS audit_model_validations_insert ON public.model_validations;
CREATE TRIGGER audit_model_validations_insert AFTER INSERT ON public.model_validations
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_model_validations_update ON public.model_validations;
CREATE TRIGGER audit_model_validations_update AFTER UPDATE ON public.model_validations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_model_validations_delete ON public.model_validations;
CREATE TRIGGER audit_model_validations_delete AFTER DELETE ON public.model_validations
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- ── 5 · the evidence ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.model_validation_evidence (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id        uuid NOT NULL UNIQUE REFERENCES public.model_validations(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  warmup               jsonb NOT NULL DEFAULT '{}'::jsonb,
  replication_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi_tests            jsonb NOT NULL DEFAULT '[]'::jsonb,
  face_validation      jsonb,
  evidence_run_ids     uuid[] NOT NULL DEFAULT '{}',
  author_user_id       uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.model_validation_evidence IS
  'WP 10.3 · §4 D243. What a Validated Model rests on, kept beside it rather than '
  'summarised into it: warm-up series and detector outputs per KPI, the replication '
  'analysis, the KS/Welch tests per KPI, the face-validation statement and the '
  'evidence runs. One row per model, written with it, never edited.';

ALTER TABLE public.model_validation_evidence ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.model_validation_evidence TO service_role;
DROP POLICY IF EXISTS model_validation_evidence_select ON public.model_validation_evidence;
CREATE POLICY model_validation_evidence_select ON public.model_validation_evidence
  FOR SELECT USING (public.has_project_access(project_id));

CREATE OR REPLACE FUNCTION public._validated_model_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'model_validation_evidence: evidence is written with its model and never edited (WP 10.3)'
    USING ERRCODE = 'P0A02';
END;
$$;
DROP TRIGGER IF EXISTS model_validation_evidence_immutable ON public.model_validation_evidence;
CREATE TRIGGER model_validation_evidence_immutable
  BEFORE UPDATE ON public.model_validation_evidence
  FOR EACH ROW EXECUTE FUNCTION public._validated_model_evidence_immutable();

DROP TRIGGER IF EXISTS audit_model_validation_evidence_insert ON public.model_validation_evidence;
CREATE TRIGGER audit_model_validation_evidence_insert AFTER INSERT ON public.model_validation_evidence
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_model_validation_evidence_update ON public.model_validation_evidence;
CREATE TRIGGER audit_model_validation_evidence_update AFTER UPDATE ON public.model_validation_evidence
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_model_validation_evidence_delete ON public.model_validation_evidence;
CREATE TRIGGER audit_model_validation_evidence_delete AFTER DELETE ON public.model_validation_evidence
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- Read the evidence of a model. The model row is readable by every API role
-- (`model_validations_read_all`), so its evidence through this function is no
-- wider an exposure; the table itself stays behind `has_project_access`.
CREATE OR REPLACE FUNCTION public.get_validated_model_evidence(p_validation_id uuid)
RETURNS SETOF public.model_validation_evidence
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT * FROM public.model_validation_evidence WHERE validation_id = p_validation_id; $$;
GRANT EXECUTE ON FUNCTION public.get_validated_model_evidence(uuid) TO anon, authenticated, service_role;

-- ── 6 · ONE insert path ──────────────────────────────────────────────────

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

  SELECT project_id, graph_hash INTO v_ds_project, v_graph_hash
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
     AND graph_hash = v_graph_hash AND scenario_hash = v_scenario_hash
     AND status = 'active'
  RETURNING id INTO v_prev_id;

  INSERT INTO public.model_validations (
    id, project_id, name, protocol, protocol_hash, model_hash, face_validation,
    policy_version_id, policy_hash, dataset_version_id, graph_hash,
    scenario_hash, scenario_fingerprint, engine_fingerprint,
    adopted_warmup_days, warmup_method, recommended_replications, replication_basis,
    validation_tests, findings_snapshot, verdict, basis, evidence_run_id,
    author_user_id, author_email
  ) VALUES (
    v_id, p_project_id,
    COALESCE(NULLIF(btrim(p_name), ''), 'Validated model'),
    p_protocol,
    encode(extensions.digest(p_protocol::text, 'sha256'), 'hex'),
    public._validated_model_hash(v_policy_hash, v_graph_hash, v_scenario_hash, p_protocol, v_engine),
    NULLIF(btrim(COALESCE(p_face_validation, '')), ''),
    p_policy_version_id, v_policy_hash, p_dataset_version_id, v_graph_hash,
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
REVOKE ALL ON FUNCTION public._insert_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,text,uuid,jsonb,uuid,text) FROM PUBLIC;

-- Save Validated Model. The adoption rule lives HERE, not only in the browser:
-- a statistical model needs every selected KPI's test to have run and passed; a
-- face-validated one needs the statement it rests on (§4 D244 — one passing KPI
-- used to be enough).
CREATE OR REPLACE FUNCTION public.record_validated_model(
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
  p_basis              text,
  p_face_validation    text,
  p_evidence_run_id    uuid,
  p_evidence           jsonb,
  _actor_user_id       uuid,
  p_user_email         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tests int;
  v_fail  int;
BEGIN
  PERFORM public.assert_writer_may_act('record_validated_model', p_project_id, _actor_user_id);

  SELECT count(*), count(*) FILTER (WHERE COALESCE((t ->> 'pass')::boolean, false) IS NOT TRUE)
    INTO v_tests, v_fail
    FROM jsonb_array_elements(COALESCE(p_validation_tests, '[]'::jsonb)) t;

  IF p_basis = 'statistical' THEN
    IF v_tests = 0 THEN
      RAISE EXCEPTION 'a statistically validated model needs the KPI tests it rests on'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_fail > 0 THEN
      RAISE EXCEPTION 'every selected KPI must pass its test: % of % did not', v_fail, v_tests
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_basis = 'face' THEN
    IF NULLIF(btrim(COALESCE(p_face_validation, '')), '') IS NULL THEN
      RAISE EXCEPTION 'a face-validated model needs the recorded statement it rests on'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'basis must be statistical or face' USING ERRCODE = 'check_violation';
  END IF;

  RETURN public._insert_validated_model(
    p_project_id, p_policy_version_id, p_dataset_version_id, p_scenario_id, p_name,
    p_protocol, p_warmup_method, p_replication_basis, p_validation_tests, p_findings,
    'validated', p_basis, p_face_validation, p_evidence_run_id, p_evidence,
    _actor_user_id, p_user_email);
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,uuid,jsonb,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,uuid,jsonb,uuid,text)
  TO anon, authenticated, service_role;

-- The legacy entry point keeps its signature and callers (the deploy window, and
-- `agent-apply`'s card proposal). It derives a COMPLETE protocol from its own
-- arguments and the scenario's estimation settings, so every card written from now
-- on carries one. It does not enforce the adoption rule: its agent caller records
-- rejected cards too, and its verdict comes from the persisted statistics it quotes.
CREATE OR REPLACE FUNCTION public.record_model_validation(
  p_project_id               uuid,
  p_policy_version_id        uuid,
  p_dataset_version_id       uuid,
  p_scenario_id              uuid,
  p_adopted_warmup_days      integer,
  p_warmup_method            text,
  p_recommended_replications integer,
  p_replication_basis        jsonb DEFAULT '{}'::jsonb,
  p_validation_tests         jsonb DEFAULT '[]'::jsonb,
  p_findings                 jsonb DEFAULT '[]'::jsonb,
  p_verdict                  text DEFAULT 'validated',
  p_basis                    text DEFAULT 'statistical',
  p_evidence_run_id          uuid DEFAULT NULL,
  p_user_id                  uuid DEFAULT NULL,
  p_user_email               text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  s         public.scenarios%ROWTYPE;
  v_horizon int;
  v_warm    int := ceil(GREATEST(0, p_adopted_warmup_days) / 7.0)::int;
  v_rule    text;
  v_target  numeric := NULLIF(p_replication_basis ->> 'target_precision', '')::numeric;
BEGIN
  SELECT * INTO s FROM public.scenarios WHERE id = p_scenario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  v_horizon := GREATEST(1, ceil(COALESCE(s.horizon_days, 364) / 7.0)::int);
  v_rule := COALESCE(s.stopping_rule ->> 'kind', 'fixed_horizon');
  IF v_rule = 'ci_halfwidth' AND v_target IS NULL THEN v_rule := 'fixed_horizon'; END IF;
  RETURN public._insert_validated_model(
    p_project_id, p_policy_version_id, p_dataset_version_id, p_scenario_id, NULL,
    jsonb_build_object(
      'replications', GREATEST(1, LEAST(200, p_recommended_replications)),
      'root_seed', GREATEST(0, COALESCE(s.seed, 0)),
      'crn', COALESCE(s.crn, true),
      'warmup_week', LEAST(v_warm, v_horizon - 1),
      'horizon_weeks', v_horizon,
      'analysis_window_weeks', GREATEST(1, v_horizon - LEAST(v_warm, v_horizon - 1)),
      'ci_level', COALESCE(NULLIF(p_replication_basis ->> 'confidence', '')::numeric, 0.95),
      'ci_halfwidth_target', v_target,
      'stopping_rule', v_rule),
    p_warmup_method, p_replication_basis, p_validation_tests, p_findings,
    p_verdict, p_basis, NULL, p_evidence_run_id, '{}'::jsonb,
    p_user_id, p_user_email);
END;
$fn$;

-- Revocation is a lifecycle change and names who made it.
DROP FUNCTION IF EXISTS public.revoke_model_validation(uuid);
CREATE FUNCTION public.revoke_model_validation(
  p_validation_id uuid,
  _actor_user_id  uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  END IF;
  UPDATE public.model_validations
     SET status = 'revoked', revoked_at = now(), revoked_by = _actor_user_id,
         revoke_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE id = p_validation_id AND status <> 'revoked';
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.revoke_model_validation(uuid, uuid, text) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
