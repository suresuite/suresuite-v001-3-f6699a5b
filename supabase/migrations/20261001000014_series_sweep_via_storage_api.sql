-- ============================================================================
-- Phase 10 / WP 10.9 · §4 D253 · blueprint §9.2, §11.6
-- THE SERIES SWEEP RUNS, AND REMOVES OBJECTS THROUGH THE STORAGE API.
--
-- The after-merge reading of WP 10.0–10.6 (§15 run 36857125032) found two faults
-- in `20261001000010`:
--
--   1. NOTHING RUNS THE SWEEP. Production has no pg_cron (`cron.job` does not
--      exist), so the guarded `cron.schedule('run-series-sweep', …)` was a silent
--      no-op and retention is declared but inert. (So are the two older guarded
--      schedules, `workspace-file-sweep` and the ERP sync — named in D253, not
--      changed here.)
--   2. OBJECTS WERE "REMOVED" WITH SQL. `DELETE FROM storage.objects` drops the
--      metadata row and leaves the stored file — the bytes the tier exists to
--      bound are never freed — and hosted Supabase refuses a direct delete on its
--      storage tables. Inside the AFTER DELETE trigger on `simulation_runs` that
--      refusal would abort the delete itself: a project or scenario delete that
--      reaches a run with a series object would fail.
--
-- WHAT THIS DOES
--   * `run_series_orphans` — the paths of objects whose run is gone, queued by the
--     delete trigger (which no longer touches `storage.objects`).
--   * `sweep_expired_run_series` marks due runs exactly as before but no longer
--     deletes objects; it RETURNS `paths` — the expired runs' objects and the
--     queued orphans (which it dequeues) — for the caller to remove through the
--     Storage API.
--   * The caller is the worker (`sim_worker.worker._sweep_series`): at every boot
--     and daily while it is up. It holds the service key and already writes the
--     objects, so it is the one process that can remove them properly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.run_series_orphans (
  path       text PRIMARY KEY,
  run_id     uuid,
  project_id uuid,
  queued_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.run_series_orphans ENABLE ROW LEVEL SECURITY;
-- No policy: written by the delete trigger, drained by the sweep (service role).
GRANT ALL ON public.run_series_orphans TO service_role;

-- A deleted run queues its object; it never deletes a storage row itself.
CREATE OR REPLACE FUNCTION public._simulation_run_drop_series()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.series_object IS NOT NULL THEN
    INSERT INTO public.run_series_orphans (path, run_id, project_id)
    VALUES (OLD.series_object, OLD.id, OLD.project_id)
    ON CONFLICT (path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public._simulation_run_drop_series() FROM PUBLIC, anon, authenticated;

-- Expired series only, as before; the objects are the caller's to remove.
CREATE OR REPLACE FUNCTION public.sweep_expired_run_series(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_limit   integer := GREATEST(1, COALESCE(p_limit, 500));
  v_ids     uuid[];
  v_paths   text[];
  v_orphans text[];
  v_bytes   bigint;
BEGIN
  SELECT array_agg(id), array_agg(series_object) FILTER (WHERE series_object IS NOT NULL),
         COALESCE(sum(series_bytes), 0)
    INTO v_ids, v_paths, v_bytes
    FROM (SELECT id, series_object, series_bytes
            FROM public.simulation_runs
           WHERE retention = 'standard' AND series_expired_at IS NULL
             AND series_expires_at IS NOT NULL AND series_expires_at < now()
           ORDER BY series_expires_at
           LIMIT v_limit
             FOR UPDATE SKIP LOCKED) due;
  IF v_ids IS NOT NULL THEN
    UPDATE public.run_replications SET time_series = '{}'::jsonb
     WHERE run_id = ANY(v_ids) AND time_series <> '{}'::jsonb;
    DELETE FROM public.run_item_series WHERE run_id = ANY(v_ids);
    UPDATE public.simulation_runs
       SET series_object = NULL, series_expired_at = now()
     WHERE id = ANY(v_ids);
  END IF;
  -- The objects of runs that no longer exist, dequeued as they are handed over.
  WITH taken AS (
    DELETE FROM public.run_series_orphans
     WHERE path IN (SELECT path FROM public.run_series_orphans ORDER BY queued_at LIMIT v_limit
                    FOR UPDATE SKIP LOCKED)
    RETURNING path)
  SELECT array_agg(path) INTO v_orphans FROM taken;
  RETURN jsonb_build_object(
    'runs', COALESCE(cardinality(v_ids), 0),
    'objects', COALESCE(cardinality(v_paths), 0) + COALESCE(cardinality(v_orphans), 0),
    'bytes', COALESCE(v_bytes, 0),
    'paths', to_jsonb(COALESCE(v_paths, '{}'::text[]) || COALESCE(v_orphans, '{}'::text[])));
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_expired_run_series(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_run_series(integer) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
