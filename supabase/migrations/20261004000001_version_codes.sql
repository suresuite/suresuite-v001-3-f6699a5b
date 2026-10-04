-- ============================================================================
-- Phase 10 / WP 10.5 follow-up · blueprint §8.4, §9.5 — VERSION CODES A PERSON CAN SAY.
--
-- Four counters printed the same way. A Validated Model `v1`, its simulation inputs
-- `v2`, its policies `v5` and the snapshot behind them `vN` are four sequences with
-- four rules (per insert; per content per level; per content; per content), and the
-- Lab showed "v1 · inputs v2 · policy v5" with nothing saying which number was which.
-- Two legacy policy rows of one content both read "v3". The owner asked for a code a
-- modeller can say in a meeting:
--
--     2026Q3 - Data 20260915 - Policy 20261004
--
--   1. `policy_versions.version_code` — the UTC day the CONTENT was first saved,
--      `YYYYMMDD`, and `-n` for the n-th distinct content first saved that day. Rows
--      of one content share it, exactly as they share `version_no` (§4 D241).
--   2. `graph_level_versions.version_code` — the same rule per project PER LEVEL; the
--      `simulation` level's code is what the Lab calls "Data 20260915".
--   3. `model_validations.planning_period` — the period a model is FOR (`2026Q3`),
--      chosen by the modeller, never derived: a model validated in October may be the
--      Q3 model. `model_code` is the period and `-n` for the n-th model of that
--      period. The period is not in `model_hash`: it names the model, it is not
--      what the model is.
--
-- The codes are STORED, not computed on read. A code computed on read moves when an
-- older same-day version is deleted (`20261004-2` would become `20261004`), and a
-- code that can move cannot be used to talk about a version. The suffix is one more
-- than the highest suffix of that day ever STORED, so a deletion never re-issues a
-- surviving code. `version_no` stays — exports, the RunKey and the API keep it.
--
-- A model saved before this migration has no period and none is guessed (T1): it reads
-- as "v1 · no period" until someone sets one, ONCE, through `set_model_planning_period`
-- — the second completion `_validated_model_immutable` allows, after the simulation
-- hash WP 11.2 let a model learn.
-- ============================================================================

-- ── 1 · the rule, once ───────────────────────────────────────────────────

-- The code a NEW version of `p_base` takes, given every code already stored in its
-- scope: the base itself when none is taken, else one past the highest suffix taken
-- (the bare base counts as 1). One function, three callers, so the three codes cannot
-- disagree about what "-2" means.
CREATE OR REPLACE FUNCTION public._next_version_code(p_base text, p_taken text[])
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN max(x.n) IS NULL THEN p_base ELSE p_base || '-' || (max(x.n) + 1)::text END
    FROM (SELECT CASE WHEN t = p_base THEN 1 ELSE substring(t FROM '-([0-9]+)$')::int END AS n
            FROM unnest(COALESCE(p_taken, '{}'::text[])) t
           WHERE t = p_base OR t ~ ('^' || p_base || '-[0-9]+$')) x;
$$;
REVOKE ALL ON FUNCTION public._next_version_code(text, text[]) FROM PUBLIC, anon, authenticated;

-- The day part: UTC, so every viewer in every time zone reads the same code.
CREATE OR REPLACE FUNCTION public._version_day_code(p_at timestamptz)
RETURNS text
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYYMMDD');
$$;
REVOKE ALL ON FUNCTION public._version_day_code(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 2 · policy versions ──────────────────────────────────────────────────

ALTER TABLE public.policy_versions ADD COLUMN IF NOT EXISTS version_code text;
ALTER TABLE public.policy_versions DROP CONSTRAINT IF EXISTS policy_versions_version_code_check;
ALTER TABLE public.policy_versions ADD CONSTRAINT policy_versions_version_code_check
  CHECK (version_code IS NULL OR version_code ~ '^[0-9]{8}(-[0-9]+)?$');

COMMENT ON COLUMN public.policy_versions.version_code IS
  'WP 10.5 follow-up. "Policy 20261004": the UTC day this CONTENT was first saved, '
  'and -n for the n-th distinct content first saved that day. Rows of one content '
  'share it, as they share version_no. Assigned on insert, never re-issued.';

-- Same trigger, same lock; it now names the code beside the number. A row of an
-- existing content takes that content's code; a new content takes the next code of
-- its day.
CREATE OR REPLACE FUNCTION public.policy_versions_assign_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  v_day text;
BEGIN
  IF NEW.version_no IS NOT NULL AND NEW.version_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('policy_versions:' || NEW.project_id::text, 0));
  IF NEW.version_no IS NULL THEN
    IF NEW.policy_hash IS NOT NULL THEN
      SELECT version_no INTO NEW.version_no
        FROM public.policy_versions
       WHERE project_id = NEW.project_id
         AND policy_hash = NEW.policy_hash
         AND version_no IS NOT NULL
       ORDER BY created_at, id
       LIMIT 1;
    END IF;
    IF NEW.version_no IS NULL THEN
      SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
        FROM public.policy_versions
       WHERE project_id = NEW.project_id;
    END IF;
  END IF;
  IF NEW.version_code IS NULL THEN
    -- One content, one code: whatever row already carries this number names it.
    SELECT version_code INTO NEW.version_code
      FROM public.policy_versions
     WHERE project_id = NEW.project_id
       AND version_no = NEW.version_no
       AND version_code IS NOT NULL
     ORDER BY created_at, id
     LIMIT 1;
    IF NEW.version_code IS NULL THEN
      v_day := public._version_day_code(COALESCE(NEW.created_at, now()));
      NEW.version_code := public._next_version_code(v_day, ARRAY(
        SELECT DISTINCT version_code FROM public.policy_versions
         WHERE project_id = NEW.project_id AND version_code LIKE v_day || '%'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3 · level versions ───────────────────────────────────────────────────

ALTER TABLE public.graph_level_versions ADD COLUMN IF NOT EXISTS version_code text;
ALTER TABLE public.graph_level_versions DROP CONSTRAINT IF EXISTS graph_level_versions_version_code_check;
ALTER TABLE public.graph_level_versions ADD CONSTRAINT graph_level_versions_version_code_check
  CHECK (version_code IS NULL OR version_code ~ '^[0-9]{8}(-[0-9]+)?$');

COMMENT ON COLUMN public.graph_level_versions.version_code IS
  'WP 10.5 follow-up. "Data 20260915" for the simulation level: the UTC day this '
  'level first had this content, and -n for the n-th content of that level first '
  'seen that day. Assigned on insert, never re-issued.';

CREATE OR REPLACE FUNCTION public._graph_level_versions_number()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  v_day text;
BEGIN
  IF NEW.version_no IS NOT NULL AND NEW.version_code IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'graph_level_versions:' || NEW.project_id::text || ':' || NEW.level, 0));
  IF NEW.version_no IS NULL THEN
    SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no
      FROM public.graph_level_versions
     WHERE project_id = NEW.project_id AND level = NEW.level;
  END IF;
  IF NEW.version_code IS NULL THEN
    v_day := public._version_day_code(COALESCE(NEW.created_at, now()));
    NEW.version_code := public._next_version_code(v_day, ARRAY(
      SELECT version_code FROM public.graph_level_versions
       WHERE project_id = NEW.project_id AND level = NEW.level AND version_code LIKE v_day || '%'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_versions_number() FROM PUBLIC, anon, authenticated;

-- Still immutable, with one completion: a row that predates its code may learn it,
-- once. A code, once stored, never changes.
CREATE OR REPLACE FUNCTION public._graph_level_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'first_dataset_version_id' - 'version_code')
       IS DISTINCT FROM (to_jsonb(OLD) - 'first_dataset_version_id' - 'version_code')
     OR (NEW.first_dataset_version_id IS NOT NULL
         AND NEW.first_dataset_version_id IS DISTINCT FROM OLD.first_dataset_version_id)
     OR (OLD.version_code IS NOT NULL AND NEW.version_code IS DISTINCT FROM OLD.version_code) THEN
    RAISE EXCEPTION 'graph_level_versions: a level version is immutable (WP 11.1)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._graph_level_versions_immutable() FROM PUBLIC, anon, authenticated;

-- ── 4 · backfill, in history order ───────────────────────────────────────
--
-- Each content's code is the day it first appeared; within a day, `version_no` order,
-- which is first-appearance order — so the codes and the numbers people have already
-- seen tell the same story. A FUNCTION, as `_graph_level_backfill` is, so
-- `rehearsal/820` runs the code this migration ran on a planted history.
-- NOT security definer: only the migration and a rehearsal run it, each as owner. It
-- fills a column nobody has read yet and names no actor, and no API role may call it.
CREATE OR REPLACE FUNCTION public._version_codes_backfill(p_project_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  v_pol integer;
  v_lvl integer;
BEGIN
  WITH contents AS (
    SELECT project_id, version_no, public._version_day_code(min(created_at)) AS day
      FROM public.policy_versions
     WHERE version_no IS NOT NULL
       AND (p_project_id IS NULL OR project_id = p_project_id)
     GROUP BY project_id, version_no
  ), coded AS (
    SELECT project_id, version_no,
           day || CASE WHEN n > 1 THEN '-' || n::text ELSE '' END AS code
      FROM (SELECT c.*, row_number() OVER (PARTITION BY project_id, day ORDER BY version_no) AS n
              FROM contents c) x
  )
  UPDATE public.policy_versions pv
     SET version_code = coded.code
    FROM coded
   WHERE pv.version_code IS NULL
     AND pv.project_id = coded.project_id
     AND pv.version_no = coded.version_no;
  GET DIAGNOSTICS v_pol = ROW_COUNT;

  WITH coded AS (
    SELECT id,
           day || CASE WHEN n > 1 THEN '-' || n::text ELSE '' END AS code
      FROM (SELECT g.id, public._version_day_code(g.created_at) AS day,
                   row_number() OVER (PARTITION BY g.project_id, g.level, public._version_day_code(g.created_at)
                                      ORDER BY g.version_no) AS n
              FROM public.graph_level_versions g
             WHERE p_project_id IS NULL OR g.project_id = p_project_id) x
  )
  UPDATE public.graph_level_versions g
     SET version_code = coded.code
    FROM coded
   WHERE g.id = coded.id
     AND g.version_code IS NULL;
  GET DIAGNOSTICS v_lvl = ROW_COUNT;

  RETURN v_pol + v_lvl;
END;
$$;
REVOKE ALL ON FUNCTION public._version_codes_backfill(uuid) FROM PUBLIC, anon, authenticated;

SELECT public._version_codes_backfill();

-- A level code names one content of one level; a policy code is shared by the rows of
-- one content and so cannot be unique by itself.
ALTER TABLE public.graph_level_versions DROP CONSTRAINT IF EXISTS graph_level_versions_code_key;
ALTER TABLE public.graph_level_versions
  ADD CONSTRAINT graph_level_versions_code_key UNIQUE (project_id, level, version_code);

-- ── 5 · the model's planning period ──────────────────────────────────────

ALTER TABLE public.model_validations
  ADD COLUMN IF NOT EXISTS planning_period text,
  ADD COLUMN IF NOT EXISTS model_code      text;
ALTER TABLE public.model_validations DROP CONSTRAINT IF EXISTS model_validations_planning_period_check;
ALTER TABLE public.model_validations ADD CONSTRAINT model_validations_planning_period_check
  CHECK (planning_period IS NULL OR planning_period ~ '^[0-9]{4}Q[1-4]$');
ALTER TABLE public.model_validations DROP CONSTRAINT IF EXISTS model_validations_model_code_check;
ALTER TABLE public.model_validations ADD CONSTRAINT model_validations_model_code_check
  CHECK ((planning_period IS NULL) = (model_code IS NULL)
         AND (model_code IS NULL OR model_code ~ ('^' || planning_period || '(-[0-9]+)?$')));
ALTER TABLE public.model_validations DROP CONSTRAINT IF EXISTS model_validations_model_code_key;
ALTER TABLE public.model_validations
  ADD CONSTRAINT model_validations_model_code_key UNIQUE (project_id, model_code);

COMMENT ON COLUMN public.model_validations.planning_period IS
  'WP 10.5 follow-up. The planning period the model is FOR ("2026Q3"), chosen by the '
  'modeller when the model is saved — never derived from a date. Not in model_hash. '
  'NULL on a model saved before it existed, until set once (set_model_planning_period).';
COMMENT ON COLUMN public.model_validations.model_code IS
  'WP 10.5 follow-up. "2026Q3", or "2026Q3-2" for the second model of that period in '
  'the project. Assigned by trigger when the period is set; never re-issued.';

-- The code a model of `p_period` takes in `p_project`. Under the numbering trigger's
-- lock, so two saves into one period cannot both take the same suffix.
CREATE OR REPLACE FUNCTION public._model_code_for(p_project_id uuid, p_period text)
RETURNS text
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('model_validations:' || p_project_id::text, 0));
  RETURN public._next_version_code(p_period, ARRAY(
    SELECT model_code FROM public.model_validations
     WHERE project_id = p_project_id AND model_code LIKE p_period || '%'));
END;
$$;
REVOKE ALL ON FUNCTION public._model_code_for(uuid, text) FROM PUBLIC, anon, authenticated;

-- `20261001000008`'s body, plus the code when an insert names a period.
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
  IF NEW.planning_period IS NOT NULL THEN
    NEW.model_code := public._model_code_for(NEW.project_id, NEW.planning_period);
  ELSE
    NEW.model_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- `20261001000020`'s body, plus a third completion: a model with no period may be
-- given one, ONCE, and the trigger — not the caller — names its code.
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
  IF OLD.planning_period IS NULL AND NEW.planning_period IS NOT NULL THEN
    NEW.model_code := public._model_code_for(OLD.project_id, NEW.planning_period);
    k_fill := k_fill || ARRAY['planning_period', 'model_code'];
  END IF;
  IF (to_jsonb(NEW) - k_fill) IS DISTINCT FROM (to_jsonb(OLD) - k_fill) THEN
    RAISE EXCEPTION 'model_validations: a Validated Model is immutable — only its status, supersession and revocation may change (WP 10.3)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;

-- Save Validated Model takes the period. `20261001000008`'s body; the period is set
-- through the completion above in the same transaction, so the one code assigner for
-- an existing row is the trigger. A new trailing parameter with a default cannot be
-- added in place: DROP + CREATE, grants restated. Existing callers that do not name
-- the period keep working unchanged.
DROP FUNCTION IF EXISTS public.record_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,uuid,jsonb,uuid,text);
CREATE FUNCTION public.record_validated_model(
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
  p_user_email         text DEFAULT NULL,
  p_planning_period    text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tests  int;
  v_fail   int;
  v_id     uuid;
  v_period text := NULLIF(btrim(COALESCE(p_planning_period, '')), '');
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

  v_id := public._insert_validated_model(
    p_project_id, p_policy_version_id, p_dataset_version_id, p_scenario_id, p_name,
    p_protocol, p_warmup_method, p_replication_basis, p_validation_tests, p_findings,
    'validated', p_basis, p_face_validation, p_evidence_run_id, p_evidence,
    _actor_user_id, p_user_email);

  IF v_period IS NOT NULL THEN
    UPDATE public.model_validations SET planning_period = v_period WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,uuid,jsonb,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_validated_model(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,uuid,jsonb,uuid,text,text)
  TO anon, authenticated, service_role;

-- Give a model saved without a period its period — once. The same writer gate as
-- saving the model; the immutability trigger refuses a second period and names the code.
CREATE OR REPLACE FUNCTION public.set_model_planning_period(
  p_validation_id   uuid,
  p_planning_period text,
  _actor_user_id    uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_project uuid;
  v_period  text;
  v_code    text;
BEGIN
  SELECT project_id, planning_period INTO v_project, v_period
    FROM public.model_validations WHERE id = p_validation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'validation % not found', p_validation_id; END IF;
  PERFORM public.assert_writer_may_act('set_model_planning_period', v_project, _actor_user_id);
  IF v_period IS NOT NULL THEN
    RAISE EXCEPTION 'this model''s planning period is already %; a period is set once', v_period
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.model_validations
     SET planning_period = NULLIF(btrim(COALESCE(p_planning_period, '')), '')
   WHERE id = p_validation_id
  RETURNING model_code INTO v_code;
  RETURN v_code;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_model_planning_period(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_model_planning_period(uuid, text, uuid) TO anon, authenticated, service_role;

-- ── 6 · the reads carry the codes ────────────────────────────────────────

-- RETURNS TABLE cannot widen in place: DROP + CREATE, the new column appended so a
-- positional reader is unchanged, the grant restated.
DROP FUNCTION IF EXISTS public.list_policy_versions(uuid);
CREATE FUNCTION public.list_policy_versions(p_project_id uuid)
RETURNS TABLE (
  id                uuid,
  label             text,
  notes             text,
  author_email      text,
  author_name       text,
  parent_version_id uuid,
  policy_hash       text,
  created_at        timestamptz,
  run_count         bigint,
  card_count        bigint,
  version_no        integer,
  version_code      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    v.id, v.label, v.notes, v.author_email, v.author_name,
    v.parent_version_id, v.policy_hash, v.created_at,
    (SELECT count(*) FROM public.simulation_runs  r WHERE r.policy_version_id = v.id),
    (SELECT count(*) FROM public.model_validations m WHERE m.policy_version_id = v.id),
    v.version_no,
    v.version_code
  FROM public.policy_versions v
  WHERE v.project_id = p_project_id
  ORDER BY v.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_policy_versions(uuid) TO anon, authenticated;

-- `20261001000021`'s read, each level carrying its code.
CREATE OR REPLACE FUNCTION public.dataset_version_tuple(p_dataset_version_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'dataset_version_id', dv.id,
    'version_no', dv.version_no,
    'graph_hash', dv.graph_hash,
    'created_at', dv.created_at,
    'product',    (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash,
                                             'version_code', g.version_code)
                     FROM public.graph_level_versions g WHERE g.id = dv.product_version_id),
    'process',    (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash,
                                             'version_code', g.version_code)
                     FROM public.graph_level_versions g WHERE g.id = dv.process_version_id),
    'firm',       (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash,
                                             'version_code', g.version_code)
                     FROM public.graph_level_versions g WHERE g.id = dv.firm_version_id),
    'simulation', (SELECT jsonb_build_object('id', g.id, 'version_no', g.version_no, 'hash', g.level_hash,
                                             'version_code', g.version_code)
                     FROM public.graph_level_versions g WHERE g.id = dv.simulation_version_id))
  FROM public.dataset_versions dv
  WHERE dv.id = p_dataset_version_id;
$$;
GRANT EXECUTE ON FUNCTION public.dataset_version_tuple(uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
