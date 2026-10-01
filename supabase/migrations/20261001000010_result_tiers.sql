-- ============================================================================
-- Phase 10 / WP 10.6 · §4 D246 · blueprint §9.2, §11.6
-- RESULT STORAGE TIERS, PINNING, RETENTION.
--
-- D246: every result was JSONB in Postgres with no expiry — only a project or
-- scenario delete removed one — and a 200-seed, ten-year run is thousands of
-- replication rows each carrying eleven weekly arrays, shipped through realtime
-- with the row.
--
-- WHAT THIS ADDS
--   HOT (Postgres, kept): the run row, its aggregates (now with the min/max range
--     the worker used to drop — `aggregate_kpis._range`, written by the worker),
--     and every replication's KPI row with its cell (`kpis.model_rep`/`event_rep`).
--   WARM (the private `run-results` bucket): a worker run's weekly series, ONE
--     zstd Parquet object per run, `<project_id>/<run_id>/series.parquet`, named by
--     `simulation_runs.series_object`; the rows then hold `time_series = '{}'`.
--     The bucket has NO object policies — the worker writes with the service role
--     and the browser reads through a short-lived signed URL `sim-command` mints
--     (`run.series_url`). A browser-computed run keeps its series in the rows (the
--     Pyodide engine has no pyarrow); the same retention applies to it.
--   RETENTION: `simulation_runs.retention` ∈ {standard, pinned, evidence};
--     `series_expires_at` is set when a standard run completes;
--     `series_bytes` says what its series cost. A Validated Model's evidence run is
--     `evidence` automatically and never expires; an editor or owner may pin or
--     release a run (`set_run_retention`). `sweep_expired_run_series` deletes an
--     expired run's SERIES only — the object, the JSONB series, the per-item rows —
--     and keeps everything that summarises the run; it records when
--     (`series_expired_at`) so the screen can say "Series expired — re-run
--     reproduces it" with the RunKey that will.
--
-- `time_series` is `NOT NULL DEFAULT '{}'`, so "not in the row" is `{}`, the value
-- every reader already treats as "no series" — not NULL (§16 · WP 10.6).
-- ============================================================================

-- ── 1 · the bucket ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $ins$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('run-results', 'run-results', false)
      ON CONFLICT (id) DO UPDATE SET public = false
    $ins$;
  END IF;
END $$;

-- ── 2 · the columns ──────────────────────────────────────────────────────

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS series_object     text,
  ADD COLUMN IF NOT EXISTS series_bytes      bigint,
  ADD COLUMN IF NOT EXISTS retention         text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS series_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS series_expired_at timestamptz;

ALTER TABLE public.simulation_runs DROP CONSTRAINT IF EXISTS simulation_runs_retention_check;
ALTER TABLE public.simulation_runs
  ADD CONSTRAINT simulation_runs_retention_check
  CHECK (retention IN ('standard', 'pinned', 'evidence'));
-- An evidence or pinned run has no expiry; a run whose series were swept has no object.
ALTER TABLE public.simulation_runs DROP CONSTRAINT IF EXISTS simulation_runs_retention_expiry_check;
ALTER TABLE public.simulation_runs
  ADD CONSTRAINT simulation_runs_retention_expiry_check
  CHECK ((retention = 'standard' OR series_expires_at IS NULL)
         AND (series_expired_at IS NULL OR series_object IS NULL));

CREATE INDEX IF NOT EXISTS simulation_runs_series_due
  ON public.simulation_runs (series_expires_at)
  WHERE retention = 'standard' AND series_expired_at IS NULL AND series_expires_at IS NOT NULL;

-- How long a standard run keeps its series. One statement of the default, which
-- WP 10.7 replaces with the organization plan's `series_retention_days`.
CREATE OR REPLACE FUNCTION public.run_series_retention(p_project_id uuid)
RETURNS interval
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT interval '90 days' $$;
GRANT EXECUTE ON FUNCTION public.run_series_retention(uuid) TO anon, authenticated, service_role;

-- ── 3 · expiry on completion, evidence by construction ───────────────────

-- A derivation inside the writer's own update: when a standard run completes it
-- gets its expiry, and a run that keeps its series in the rows gets their size.
-- It names WHAT and decides nothing.
CREATE OR REPLACE FUNCTION public._simulation_run_retention()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    IF NEW.retention = 'standard' AND NEW.series_expires_at IS NULL THEN
      NEW.series_expires_at := COALESCE(NEW.ended_at, now()) + public.run_series_retention(NEW.project_id);
    END IF;
    IF NEW.series_bytes IS NULL AND NEW.series_object IS NULL THEN
      NEW.series_bytes := (SELECT COALESCE(sum(pg_column_size(r.time_series)), 0)
                             FROM public.run_replications r WHERE r.run_id = NEW.id)
                        + (SELECT COALESCE(sum(pg_column_size(i.series)), 0)
                             FROM public.run_item_series i WHERE i.run_id = NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS simulation_runs_retention ON public.simulation_runs;
CREATE TRIGGER simulation_runs_retention
  BEFORE UPDATE OF status ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._simulation_run_retention();

-- A Validated Model's evidence run is kept: the model rests on it.
CREATE OR REPLACE FUNCTION public._validated_model_evidence_kept()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.evidence_run_id IS NOT NULL THEN
    UPDATE public.simulation_runs
       SET retention = 'evidence', series_expires_at = NULL
     WHERE id = NEW.evidence_run_id AND retention <> 'evidence';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._validated_model_evidence_kept() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS model_validations_evidence_kept ON public.model_validations;
CREATE TRIGGER model_validations_evidence_kept
  AFTER INSERT ON public.model_validations
  FOR EACH ROW EXECUTE FUNCTION public._validated_model_evidence_kept();

-- History: evidence runs are evidence; a completed standard run expires the
-- retention period after it ended (never before this migration runs).
UPDATE public.simulation_runs r
   SET retention = 'evidence', series_expires_at = NULL
  FROM public.model_validations m
 WHERE m.evidence_run_id = r.id AND r.retention <> 'evidence';
UPDATE public.simulation_runs
   SET series_expires_at = GREATEST(COALESCE(ended_at, created_at), now()) + public.run_series_retention(project_id)
 WHERE status = 'done' AND retention = 'standard' AND series_expires_at IS NULL;

-- ── 4 · pin and release ──────────────────────────────────────────────────

-- An editor or owner keeps a run's series ('pinned') or lets them expire again
-- ('standard', the retention period counted from now). Evidence is the model's,
-- not the user's: it cannot be released here.
CREATE OR REPLACE FUNCTION public.set_run_retention(
  p_run_id        uuid,
  p_retention     text,
  _actor_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  r      public.simulation_runs%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO r FROM public.simulation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run % not found', p_run_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.assert_writer_may_act('set_run_retention', r.project_id, _actor_user_id);
  v_role := public.effective_project_role(_actor_user_id, r.project_id);
  IF v_role IS NULL OR v_role NOT IN ('editor', 'owner') THEN
    RAISE EXCEPTION 'pinning a run needs the editor or owner role on its project (you hold %)',
      COALESCE(v_role, 'none') USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_retention NOT IN ('standard', 'pinned') THEN
    RAISE EXCEPTION 'retention must be standard or pinned' USING ERRCODE = 'check_violation';
  END IF;
  IF r.retention = 'evidence' THEN
    RAISE EXCEPTION 'this run is a Validated Model''s evidence and is kept with the model'
      USING ERRCODE = 'check_violation';
  END IF;
  IF r.series_expired_at IS NOT NULL THEN
    RAISE EXCEPTION 'this run''s series have already expired — re-run it (RunKey %) to reproduce them',
      COALESCE(left(r.run_key, 12), 'not recorded') USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.simulation_runs
     SET retention = p_retention,
         series_expires_at = CASE WHEN p_retention = 'pinned' THEN NULL
                                  WHEN status = 'done' THEN now() + public.run_series_retention(project_id)
                                  ELSE NULL END
   WHERE id = p_run_id
  RETURNING * INTO r;
  RETURN jsonb_build_object('run_id', r.id, 'retention', r.retention, 'series_expires_at', r.series_expires_at);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_run_retention(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_run_retention(uuid, text, uuid) TO anon, authenticated, service_role;

-- ── 5 · the sweep ────────────────────────────────────────────────────────

-- Expired series only. The run row, its aggregates and every replication's KPI
-- row are the summary and are KEPT; what goes is the Parquet object, the JSONB
-- series in the rows, and the per-item series rows. Modelled on
-- `sweep_expired_files`: rows and objects in one transaction.
CREATE OR REPLACE FUNCTION public.sweep_expired_run_series(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_ids   uuid[];
  v_paths text[];
  v_bytes bigint;
BEGIN
  SELECT array_agg(id), array_agg(series_object) FILTER (WHERE series_object IS NOT NULL),
         COALESCE(sum(series_bytes), 0)
    INTO v_ids, v_paths, v_bytes
    FROM (SELECT id, series_object, series_bytes
            FROM public.simulation_runs
           WHERE retention = 'standard' AND series_expired_at IS NULL
             AND series_expires_at IS NOT NULL AND series_expires_at < now()
           ORDER BY series_expires_at
           LIMIT GREATEST(1, COALESCE(p_limit, 500))) due;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('runs', 0, 'objects', 0, 'bytes', 0);
  END IF;
  IF v_paths IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2)'
      USING 'run-results', v_paths;
  END IF;
  UPDATE public.run_replications SET time_series = '{}'::jsonb
   WHERE run_id = ANY(v_ids) AND time_series <> '{}'::jsonb;
  DELETE FROM public.run_item_series WHERE run_id = ANY(v_ids);
  UPDATE public.simulation_runs
     SET series_object = NULL, series_expired_at = now()
   WHERE id = ANY(v_ids);
  RETURN jsonb_build_object('runs', cardinality(v_ids), 'objects', COALESCE(cardinality(v_paths), 0),
                            'bytes', v_bytes);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_expired_run_series(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_run_series(integer) TO service_role;

-- A run that is deleted — by a project delete, a scenario cascade, anything —
-- takes its series object with it, so no object outlives the row that names it.
CREATE OR REPLACE FUNCTION public._simulation_run_drop_series()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.series_object IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2'
      USING 'run-results', OLD.series_object;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public._simulation_run_drop_series() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS simulation_runs_drop_series ON public.simulation_runs;
CREATE TRIGGER simulation_runs_drop_series
  AFTER DELETE ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._simulation_run_drop_series();

-- Daily, where the deployment ships pg_cron (as the workspace sweep).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('run-series-sweep', '41 3 * * *',
                          'SELECT public.sweep_expired_run_series(5000);');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
