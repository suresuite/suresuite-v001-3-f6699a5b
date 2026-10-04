-- ============================================================================
-- Phase 15 / WP 15.2 · §4 D292 · gate `engine-ledger` · blueprint G21
-- THE ENGINE BUILD LEDGER: every build that produced a result, recorded once.
--
-- D292: `sim_engines` holds one row per engine and the worker's boot report
-- OVERWRITES its `version` and `code_version`, so the registry could say which
-- build runs now and not which builds ran. Nine engine versions reported into
-- one row in four days, and since WP 15.1 every engine commit is a new build.
--
-- WHAT THIS ADDS
--   1. `sim_engine_builds` — append-only, one row per (engine, code_version). A
--      row is never deleted and never rewritten: `last_seen_at` moves forward,
--      a part the row did not know (digests, commit, image) may be filled ONCE,
--      and a build may be WITHDRAWN once, with a reason.
--   2. Every writer of a build records it here, in the same statement:
--        · the worker's boot report (`sim_engine_report`, now with `p_build`);
--        · every run row that names a code version (worker AND browser — a
--          trigger, because the browser writes `simulation_runs` as anon);
--        · history, backfilled below from the runs, the Validated Models and
--          the registry itself.
--   3. `sim_engine_build_withdraw` — a super admin withdraws a build found
--      wrong after release. Results it produced keep it and show the reason;
--      dispatch refuses an engine whose CURRENT build is withdrawn.
--
-- WHAT IT DELIBERATELY DOES NOT ADD (single source — §25 WP 15.2):
--   · no `status = current` column: the current build is `sim_engines.code_version`,
--     already authored by the boot report. A second copy would be a second author.
--   · no `simulation_runs.engine_build_id`: a run already names its build as
--     (engine_id, code_version), which IS this table's key. A copied id would be
--     the same fact twice; a composite foreign key cannot hold because the
--     dispatcher queues runs with `code_version = ''`. The trigger guarantees the
--     row exists; `rehearsal/820` proves it, as anon.
--   · no RunKey v3: the spec's engine term already hashes the registry's
--     `code_version`, whose MEANING became "the build" in WP 15.1. A new version
--     number with no new term would only re-key every run a second time.
--   · no audit triggers: a reference table, like `sim_engines`. Its writers are
--     the service role and run rows, which name no person; the one human act,
--     a withdrawal, records its actor in the row (`withdrawn_by`).
-- ============================================================================

-- ── 1 · the ledger ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sim_engine_builds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id          uuid NOT NULL REFERENCES public.sim_engines(id),
  code_version       text NOT NULL
    CONSTRAINT sim_engine_builds_code_version_shape CHECK (btrim(code_version) <> '' AND code_version = btrim(code_version)),
  scsim_digest       text
    CONSTRAINT sim_engine_builds_scsim_digest_shape CHECK (scsim_digest ~ '^[0-9a-f]{64}$'),
  sim_worker_digest  text
    CONSTRAINT sim_engine_builds_worker_digest_shape CHECK (sim_worker_digest ~ '^[0-9a-f]{64}$'),
  commit_sha         text
    CONSTRAINT sim_engine_builds_commit_shape CHECK (commit_sha ~ '^[0-9a-f]{7,40}$'),
  image_digest       text,
  first_seen_by      text NOT NULL
    CONSTRAINT sim_engine_builds_first_seen_by CHECK (first_seen_by IN ('worker_report', 'run', 'backfill')),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  withdrawn_at       timestamptz,
  withdrawn_reason   text,
  withdrawn_by       uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  CONSTRAINT sim_engine_builds_key UNIQUE (engine_id, code_version),
  CONSTRAINT sim_engine_builds_withdrawal_whole
    CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL)
           AND (withdrawn_reason IS NULL OR btrim(withdrawn_reason) <> '')),
  CONSTRAINT sim_engine_builds_seen_order CHECK (last_seen_at >= first_seen_at)
);
COMMENT ON TABLE public.sim_engine_builds IS
  'WP 15.2 · §4 D292 — the engine build ledger: one row per (engine, code_version) that produced a result or was reported running. Append-only; a build is withdrawn, never deleted.';

ALTER TABLE public.sim_engine_builds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sim_engine_builds_read ON public.sim_engine_builds;
-- A registry, like `sim_engines`: which builds exist is not project data.
CREATE POLICY sim_engine_builds_read ON public.sim_engine_builds
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.sim_engine_builds TO anon, authenticated, service_role;

-- Append-only. What MAY change, and only this way:
--   last_seen_at          forward only
--   scsim_digest, sim_worker_digest, commit_sha, image_digest   NULL → a value, once
--   withdrawn_at, withdrawn_reason   NULL → a value, once (never un-withdrawn)
--   withdrawn_by          NULL → a value with the withdrawal, or → NULL when the
--                         user is deleted (ON DELETE SET NULL)
CREATE OR REPLACE FUNCTION public._engine_build_append_only()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  k_fill text[] := ARRAY['scsim_digest', 'sim_worker_digest', 'commit_sha', 'image_digest',
                         'withdrawn_at', 'withdrawn_reason'];
  k      text;
  o      jsonb := to_jsonb(OLD);
  n      jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sim_engine_builds: a build is withdrawn, never deleted (WP 15.2)'
      USING ERRCODE = 'P0A03';
  END IF;
  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'sim_engine_builds: last_seen_at only moves forward'
      USING ERRCODE = 'P0A03';
  END IF;
  FOREACH k IN ARRAY k_fill LOOP
    IF o ->> k IS NOT NULL AND (n ->> k) IS DISTINCT FROM (o ->> k) THEN
      RAISE EXCEPTION 'sim_engine_builds: % was % and cannot change — a build''s parts are filled once', k, o ->> k
        USING ERRCODE = 'P0A03';
    END IF;
  END LOOP;
  IF OLD.withdrawn_by IS NOT NULL AND NEW.withdrawn_by IS NOT NULL
     AND NEW.withdrawn_by <> OLD.withdrawn_by THEN
    RAISE EXCEPTION 'sim_engine_builds: who withdrew a build cannot change'
      USING ERRCODE = 'P0A03';
  END IF;
  IF (n - (k_fill || ARRAY['last_seen_at', 'withdrawn_by']))
     IS DISTINCT FROM (o - (k_fill || ARRAY['last_seen_at', 'withdrawn_by'])) THEN
    RAISE EXCEPTION 'sim_engine_builds: a recorded build is never rewritten (WP 15.2)'
      USING ERRCODE = 'P0A03';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sim_engine_builds_append_only ON public.sim_engine_builds;
CREATE TRIGGER sim_engine_builds_append_only
  BEFORE UPDATE OR DELETE ON public.sim_engine_builds
  FOR EACH ROW EXECUTE FUNCTION public._engine_build_append_only();

-- ── 2 · recording a build ─────────────────────────────────────────────────

-- The one writer. Inserts the build, or moves `last_seen_at` and fills a part
-- the row did not know. Internal (D248): no API role may call it.
CREATE OR REPLACE FUNCTION public._engine_build_record(
  p_engine_id    uuid,
  p_code_version text,
  p_source       text,
  p_build        jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id  uuid;
  v_cv  text := NULLIF(btrim(p_code_version), '');
  b     jsonb := COALESCE(p_build, '{}'::jsonb);
BEGIN
  IF p_engine_id IS NULL OR v_cv IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.sim_engine_builds AS sb
    (engine_id, code_version, scsim_digest, sim_worker_digest, commit_sha, image_digest, first_seen_by)
  VALUES
    (p_engine_id, v_cv,
     NULLIF(b ->> 'scsim_digest', ''), NULLIF(b ->> 'sim_worker_digest', ''),
     NULLIF(lower(b ->> 'commit'), ''), NULLIF(b ->> 'image_digest', ''), p_source)
  ON CONFLICT (engine_id, code_version) DO UPDATE SET
    last_seen_at      = GREATEST(sb.last_seen_at, clock_timestamp()),
    scsim_digest      = COALESCE(sb.scsim_digest, EXCLUDED.scsim_digest),
    sim_worker_digest = COALESCE(sb.sim_worker_digest, EXCLUDED.sim_worker_digest),
    commit_sha        = COALESCE(sb.commit_sha, EXCLUDED.commit_sha),
    image_digest      = COALESCE(sb.image_digest, EXCLUDED.image_digest)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._engine_build_record(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._engine_build_record(uuid, text, text, jsonb) TO service_role;

-- The worker's boot report, now with the build's parts. DROP + CREATE because a
-- parameter is added (CREATE OR REPLACE cannot); the grants are restated below.
-- `p_build` defaults to NULL, so a worker deployed ahead of this migration —
-- or one that falls back to the four-argument call — keeps working.
DROP FUNCTION IF EXISTS public.sim_engine_report(text, text, text, jsonb);
CREATE FUNCTION public.sim_engine_report(
  p_slug         text,
  p_version      text,
  p_code_version text,
  p_capabilities jsonb DEFAULT NULL,
  p_build        jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.sim_engines
     SET version      = NULLIF(btrim(p_version), ''),
         code_version = NULLIF(btrim(p_code_version), ''),
         capabilities = COALESCE(p_capabilities, capabilities),
         reported_at  = now()
   WHERE slug = p_slug
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'engine % is not in the registry', p_slug USING ERRCODE = 'no_data_found';
  END IF;
  -- WP 15.2 · §4 D292 — the registry row says what runs NOW; the ledger keeps it.
  PERFORM public._engine_build_record(v_id, p_code_version, 'worker_report', p_build);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sim_engine_report(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sim_engine_report(text, text, text, jsonb, jsonb) TO service_role;

-- Every run that names its build records it, whoever wrote the run. AFTER, so a
-- rejected row records nothing. SECURITY DEFINER because the browser writes
-- `simulation_runs` as anon and anon may not write the ledger; a trigger
-- function is not EXECUTE-checked when it fires, and API roles cannot call it.
CREATE OR REPLACE FUNCTION public._simulation_run_record_build()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._engine_build_record(
    COALESCE(NEW.engine_id, public._engine_for_code_version(NEW.code_version)),
    NEW.code_version, 'run', NULL);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._simulation_run_record_build() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS simulation_runs_record_build ON public.simulation_runs;
CREATE TRIGGER simulation_runs_record_build
  AFTER INSERT OR UPDATE OF code_version, engine_id ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._simulation_run_record_build();

-- ── 3 · withdrawing a build ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sim_engine_build_withdraw(
  p_build_id     uuid,
  p_reason       text,
  _actor_user_id uuid DEFAULT NULL
) RETURNS public.sim_engine_builds
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v public.sim_engine_builds%ROWTYPE;
BEGIN
  IF _actor_user_id IS NULL OR NOT public.is_super_admin(_actor_user_id) THEN
    RAISE EXCEPTION 'only a super admin may withdraw an engine build' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'a withdrawal states its reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v FROM public.sim_engine_builds WHERE id = p_build_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'engine build % is not in the ledger', p_build_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v.withdrawn_at IS NOT NULL THEN
    RETURN v;  -- already withdrawn: the first reason stands
  END IF;
  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  UPDATE public.sim_engine_builds
     SET withdrawn_at = now(), withdrawn_reason = btrim(p_reason), withdrawn_by = _actor_user_id
   WHERE id = p_build_id
  RETURNING * INTO v;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sim_engine_build_withdraw(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sim_engine_build_withdraw(uuid, text, uuid) TO anon, authenticated, service_role;

-- Dispatch refuses an engine whose CURRENT build is withdrawn. The body is
-- 20261001000009's, plus that one check after the engine is chosen.
CREATE OR REPLACE FUNCTION public.sim_engine_for_dispatch(p_engine_id uuid DEFAULT NULL)
RETURNS public.sim_engines
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  e public.sim_engines%ROWTYPE;
  n integer;
  w public.sim_engine_builds%ROWTYPE;
BEGIN
  IF p_engine_id IS NOT NULL THEN
    SELECT * INTO e FROM public.sim_engines WHERE id = p_engine_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'engine % is not in the registry', p_engine_id USING ERRCODE = 'no_data_found';
    END IF;
    IF e.status <> 'active' THEN
      RAISE EXCEPTION 'engine % is retired and cannot run', e.slug USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO n FROM public.sim_engines WHERE status = 'active';
    IF n = 0 THEN
      RAISE EXCEPTION 'no active engine is registered' USING ERRCODE = 'no_data_found';
    ELSIF n > 1 THEN
      RAISE EXCEPTION 'more than one engine is active — the run must name one' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO e FROM public.sim_engines WHERE status = 'active';
  END IF;
  -- WP 15.2 — a withdrawn build does not run again.
  SELECT * INTO w FROM public.sim_engine_builds
   WHERE engine_id = e.id AND code_version = e.code_version AND withdrawn_at IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'engine % runs build %, which was withdrawn: %', e.slug, w.code_version, w.withdrawn_reason
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN e;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.sim_engine_for_dispatch(uuid) TO anon, authenticated, service_role;

-- ── 4 · history ───────────────────────────────────────────────────────────
--
-- Every build a result, a Validated Model or the registry names. A build from
-- before WP 15.1 is recorded under its label (`scsim-0.2.8`) with no digests:
-- what ran under it is unknown, and the ledger says so rather than guessing.

INSERT INTO public.sim_engine_builds (engine_id, code_version, first_seen_by, first_seen_at, last_seen_at)
SELECT eng, cv, 'backfill', min(t0), GREATEST(max(t1), min(t0))
FROM (
  SELECT COALESCE(r.engine_id, public._engine_for_code_version(r.code_version)) AS eng,
         btrim(r.code_version) AS cv,
         r.created_at AS t0,
         COALESCE(r.ended_at, r.created_at) AS t1
    FROM public.simulation_runs r
   WHERE btrim(COALESCE(r.code_version, '')) <> ''
  UNION ALL
  SELECT COALESCE(m.engine_id, public._engine_for_code_version(m.engine_fingerprint)),
         btrim(m.engine_fingerprint), m.created_at, m.created_at
    FROM public.model_validations m
   WHERE btrim(COALESCE(m.engine_fingerprint, '')) <> ''
  UNION ALL
  SELECT e.id, btrim(e.code_version), COALESCE(e.reported_at, e.created_at), COALESCE(e.reported_at, e.created_at)
    FROM public.sim_engines e
   WHERE btrim(COALESCE(e.code_version, '')) <> ''
) h
WHERE eng IS NOT NULL
GROUP BY eng, cv
ON CONFLICT (engine_id, code_version) DO NOTHING;
