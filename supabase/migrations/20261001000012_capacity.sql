-- ============================================================================
-- Phase 10 / WP 10.7 · §4 D247 · blueprint G15 · gate `declared-capability`
-- CAPACITY: ORGANIZATION POOL + ROLE SHARE.
--
-- D247: nothing metered or limited simulation compute or result storage. The
-- organization plan was an access period plus project and user limits;
-- `api_rate_limits` capped concurrency and replications for /v1 only; agent-apply
-- had its own constants; `sim-command` had none.
--
-- WHAT THIS ADDS
--   1. The organization plan gains `storage_quota_bytes`,
--      `compute_quota_rep_weeks_month`, `max_replications_per_run`,
--      `max_concurrent_runs` and `series_retention_days` — NULL = unlimited, as
--      the existing limits; an account with no organization has no plan and no
--      limits (D207's rule, unchanged).
--   2. `plan_role_allowances` — the share of the pool a member of each project
--      role may use (compute and storage, as a percentage) and how many runs
--      that member may have in flight. Defaults (org_id NULL) are seeded: owner
--      100 %, editor 60 %, analyst 25 %, viewer 0 % compute; a super admin
--      overrides them per organization (`admin_set_role_allowance`).
--   3. `run_usage` — the ledger: a reservation at dispatch (replication-weeks),
--      the actual at completion (replication-weeks done, bytes kept), and a
--      release when the sweep expires a run's series.
--   4. ONE enforcement point, inside `create_simulation_run` — the one insert
--      path the shared dispatcher uses for the browser, /v1 and agent-apply —
--      refusing with SQLSTATE P0402 (a quota: compute or storage), P0403 (the
--      per-run replication cap) or P0429 (concurrency), each message carrying
--      the numbers. /v1 passes its
--      key-scoped concurrency and replication caps in (`limits`) instead of
--      checking them itself; rpm/rpd stay at the gateway.
--   5. `series_retention_days` replaces WP 10.6's constant 90 days.
--
-- Storage USED is derived from the live runs (`series_bytes` of runs whose
-- series have not expired), not summed from the ledger, so a deleted run frees
-- its bytes whatever deleted it; compute used is the ledger's, so deleting runs
-- does not hand a month's compute back.
-- ============================================================================

-- ── 1 · the plan ─────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS storage_quota_bytes            bigint,
  ADD COLUMN IF NOT EXISTS compute_quota_rep_weeks_month  bigint,
  ADD COLUMN IF NOT EXISTS max_replications_per_run       integer,
  ADD COLUMN IF NOT EXISTS max_concurrent_runs            integer,
  ADD COLUMN IF NOT EXISTS series_retention_days          integer DEFAULT 90;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_capacity_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_capacity_check CHECK (
        (storage_quota_bytes IS NULL OR storage_quota_bytes > 0)
    AND (compute_quota_rep_weeks_month IS NULL OR compute_quota_rep_weeks_month > 0)
    AND (max_replications_per_run IS NULL OR max_replications_per_run BETWEEN 1 AND 200)
    AND (max_concurrent_runs IS NULL OR max_concurrent_runs > 0)
    AND (series_retention_days IS NULL OR series_retention_days > 0));

-- ── 2 · the role shares ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_role_allowances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_role       text NOT NULL CHECK (project_role IN ('owner','editor','analyst','viewer')),
  compute_share_pct  numeric(5,2) NOT NULL CHECK (compute_share_pct BETWEEN 0 AND 100),
  storage_share_pct  numeric(5,2) NOT NULL CHECK (storage_share_pct BETWEEN 0 AND 100),
  max_concurrent     integer CHECK (max_concurrent IS NULL OR max_concurrent >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_role_allowances_org_role_key UNIQUE NULLS NOT DISTINCT (org_id, project_role)
);
ALTER TABLE public.plan_role_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_role_allowances_read ON public.plan_role_allowances;
-- What a role may use is the plan, not tenant data; read by the Lab's run card.
CREATE POLICY plan_role_allowances_read ON public.plan_role_allowances
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.plan_role_allowances TO anon, authenticated;
GRANT ALL ON public.plan_role_allowances TO service_role;

INSERT INTO public.plan_role_allowances (org_id, project_role, compute_share_pct, storage_share_pct, max_concurrent)
VALUES (NULL, 'owner', 100, 100, NULL), (NULL, 'editor', 60, 60, 3),
       (NULL, 'analyst', 25, 25, 1), (NULL, 'viewer', 0, 0, 0)
ON CONFLICT ON CONSTRAINT plan_role_allowances_org_role_key DO NOTHING;

-- Audit: a change to what a role may consume is a plan decision a super admin
-- makes, and it names who (the admin RPCs log through `log_admin_action` too).
DROP TRIGGER IF EXISTS audit_plan_role_allowances_insert ON public.plan_role_allowances;
CREATE TRIGGER audit_plan_role_allowances_insert AFTER INSERT ON public.plan_role_allowances
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_plan_role_allowances_update ON public.plan_role_allowances;
CREATE TRIGGER audit_plan_role_allowances_update AFTER UPDATE ON public.plan_role_allowances
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_plan_role_allowances_delete ON public.plan_role_allowances;
CREATE TRIGGER audit_plan_role_allowances_delete AFTER DELETE ON public.plan_role_allowances
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- ── 3 · the ledger ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.run_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  user_id     uuid,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id      uuid REFERENCES public.simulation_runs(id) ON DELETE SET NULL,
  rep_weeks   bigint NOT NULL DEFAULT 0,
  bytes       bigint NOT NULL DEFAULT 0,
  kind        text NOT NULL CHECK (kind IN ('dispatch', 'complete', 'expire')),
  at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_usage_run_kind_key UNIQUE (run_id, kind)
);
CREATE INDEX IF NOT EXISTS run_usage_org_at ON public.run_usage (org_id, at);
CREATE INDEX IF NOT EXISTS run_usage_user_at ON public.run_usage (user_id, at);
ALTER TABLE public.run_usage ENABLE ROW LEVEL SECURITY;
-- No policy: the ledger is read through `get_my_capacity` and the admin RPC.
GRANT ALL ON public.run_usage TO service_role;

-- ── 4 · what is used, and what is left ───────────────────────────────────

-- A month's compute, from the ledger: each run counted once, at its actual if it
-- completed, else at its reservation.
CREATE OR REPLACE FUNCTION public._compute_used(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(sum(COALESCE(c.rep_weeks, d.rep_weeks)), 0)::bigint
    FROM public.run_usage d
    LEFT JOIN public.run_usage c ON c.run_id = d.run_id AND c.kind = 'complete'
   WHERE d.kind = 'dispatch'
     AND d.org_id IS NOT DISTINCT FROM p_org_id
     AND (p_user_id IS NULL OR d.user_id = p_user_id)
     AND d.at >= date_trunc('month', now());
$$;
REVOKE ALL ON FUNCTION public._compute_used(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Storage in use, from the live runs: what their series cost while kept.
CREATE OR REPLACE FUNCTION public._storage_used(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(sum(r.series_bytes), 0)::bigint
    FROM public.simulation_runs r
    JOIN public.projects p ON p.id = r.project_id
   WHERE p.organization_id IS NOT DISTINCT FROM p_org_id
     AND r.series_expired_at IS NULL
     AND (p_user_id IS NULL OR EXISTS (SELECT 1 FROM public.run_usage u
                                        WHERE u.run_id = r.id AND u.kind = 'dispatch' AND u.user_id = p_user_id));
$$;
REVOKE ALL ON FUNCTION public._storage_used(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The whole picture for one member of one project: the org's pool, the role's
-- share of it, and what is used and in flight. One statement, read by the
-- admission check and by the Lab's run card alike.
CREATE OR REPLACE FUNCTION public._capacity_state(p_project_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  o      public.organizations%ROWTYPE;
  v_org  uuid;
  v_role text;
  a      public.plan_role_allowances%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  IF v_org IS NOT NULL THEN
    SELECT * INTO o FROM public.organizations WHERE id = v_org;
  END IF;
  v_role := CASE WHEN p_user_id IS NULL THEN NULL ELSE public.effective_project_role(p_user_id, p_project_id) END;
  IF v_role IS NOT NULL THEN
    SELECT * INTO a FROM public.plan_role_allowances
     WHERE project_role = v_role AND (org_id = v_org OR org_id IS NULL)
     ORDER BY org_id NULLS LAST LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'org_id', v_org,
    'role', v_role,
    'pool', jsonb_build_object(
      'compute_quota_rep_weeks_month', o.compute_quota_rep_weeks_month,
      'compute_used_rep_weeks', public._compute_used(v_org),
      'storage_quota_bytes', o.storage_quota_bytes,
      'storage_used_bytes', public._storage_used(v_org),
      'max_concurrent_runs', o.max_concurrent_runs,
      'active_runs', (SELECT count(*) FROM public.simulation_runs r JOIN public.projects p ON p.id = r.project_id
                       WHERE p.organization_id IS NOT DISTINCT FROM v_org AND r.status IN ('queued','running')
                         AND (v_org IS NOT NULL OR r.project_id = p_project_id)),
      'max_replications_per_run', o.max_replications_per_run),
    'share', CASE WHEN v_role IS NULL THEN NULL ELSE jsonb_build_object(
      'compute_share_pct', a.compute_share_pct,
      'storage_share_pct', a.storage_share_pct,
      'max_concurrent', a.max_concurrent,
      'compute_used_rep_weeks', public._compute_used(v_org, p_user_id),
      'storage_used_bytes', public._storage_used(v_org, p_user_id),
      'active_runs', (SELECT count(*) FROM public.simulation_runs r
                       JOIN public.run_usage u ON u.run_id = r.id AND u.kind = 'dispatch'
                      WHERE u.user_id = p_user_id AND r.status IN ('queued','running'))) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public._capacity_state(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The admission check. Raises P0402 for a quota (compute or storage), P0403 for
-- a per-run replication cap, P0429 for concurrency, with the numbers in the
-- message; returns nothing when the run may proceed. `p_limits`
-- carries a caller's own caps (/v1's key-scoped `max_concurrent_runs` and
-- `max_replications`), applied as the stricter of theirs and the plan's.
CREATE OR REPLACE FUNCTION public._capacity_admit(
  p_project_id   uuid,
  p_user_id      uuid,
  p_replications integer,
  p_rep_weeks    bigint,
  p_bytes        bigint,
  p_limits       jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  s       jsonb := public._capacity_state(p_project_id, p_user_id);
  pool    jsonb := s -> 'pool';
  sh      jsonb := s -> 'share';
  v_n     numeric;
  v_cap   numeric;
BEGIN
  -- replications per run: the plan's and the caller's, whichever is stricter
  v_cap := LEAST(NULLIF(pool ->> 'max_replications_per_run', '')::numeric,
                 NULLIF(p_limits ->> 'max_replications', '')::numeric);
  IF v_cap IS NOT NULL AND p_replications > v_cap THEN
    RAISE EXCEPTION 'this run asks for % replications; the limit is % per run', p_replications, v_cap
      USING ERRCODE = 'P0403';
  END IF;
  -- concurrency: the organization's, the caller's, the role's
  v_n := (pool ->> 'active_runs')::numeric;
  v_cap := LEAST(NULLIF(pool ->> 'max_concurrent_runs', '')::numeric,
                 NULLIF(p_limits ->> 'max_concurrent_runs', '')::numeric);
  IF v_cap IS NOT NULL AND v_n >= v_cap THEN
    RAISE EXCEPTION 'the organization has % runs queued or running; the limit is %', v_n, v_cap
      USING ERRCODE = 'P0429';
  END IF;
  -- The role's in-flight allowance is a share OF the organization's: it binds
  -- only where the plan caps concurrency, so an organization with no plan (and
  -- an account with none) keeps "no limits" (D207's rule) — whether a viewer may
  -- run at all is the project role's to say, not capacity's.
  IF sh IS NOT NULL AND (sh ->> 'max_concurrent') IS NOT NULL AND (pool ->> 'max_concurrent_runs') IS NOT NULL
     AND (sh ->> 'active_runs')::numeric >= (sh ->> 'max_concurrent')::numeric THEN
    RAISE EXCEPTION 'you have % runs queued or running; your % role allows %',
      sh ->> 'active_runs', s ->> 'role', sh ->> 'max_concurrent' USING ERRCODE = 'P0429';
  END IF;
  -- the month's compute: the pool, then the role's share of it
  v_cap := NULLIF(pool ->> 'compute_quota_rep_weeks_month', '')::numeric;
  IF v_cap IS NOT NULL THEN
    v_n := (pool ->> 'compute_used_rep_weeks')::numeric;
    IF v_n + p_rep_weeks > v_cap THEN
      RAISE EXCEPTION 'this run needs % replication-weeks; the organization has % of % left this month',
        p_rep_weeks, GREATEST(0, v_cap - v_n), v_cap USING ERRCODE = 'P0402';
    END IF;
    IF sh IS NOT NULL THEN
      v_cap := floor(v_cap * (sh ->> 'compute_share_pct')::numeric / 100);
      v_n := (sh ->> 'compute_used_rep_weeks')::numeric;
      IF v_n + p_rep_weeks > v_cap THEN
        RAISE EXCEPTION 'this run needs % replication-weeks; your % share is % this month and you have % left',
          p_rep_weeks, s ->> 'role', v_cap, GREATEST(0, v_cap - v_n) USING ERRCODE = 'P0402';
      END IF;
    END IF;
  END IF;
  -- storage: what is kept plus what this run is expected to keep
  v_cap := NULLIF(pool ->> 'storage_quota_bytes', '')::numeric;
  IF v_cap IS NOT NULL THEN
    v_n := (pool ->> 'storage_used_bytes')::numeric;
    IF v_n + COALESCE(p_bytes, 0) > v_cap THEN
      RAISE EXCEPTION 'this run is expected to keep % bytes; the organization keeps % of % bytes — release or let runs expire',
        COALESCE(p_bytes, 0), v_n, v_cap USING ERRCODE = 'P0402';
    END IF;
    IF sh IS NOT NULL THEN
      v_cap := floor(v_cap * (sh ->> 'storage_share_pct')::numeric / 100);
      v_n := (sh ->> 'storage_used_bytes')::numeric;
      IF v_n + COALESCE(p_bytes, 0) > v_cap THEN
        RAISE EXCEPTION 'this run is expected to keep % bytes; your % share is % bytes and you keep %',
          COALESCE(p_bytes, 0), s ->> 'role', v_cap, v_n USING ERRCODE = 'P0402';
      END IF;
    END IF;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public._capacity_admit(uuid, uuid, integer, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- The Lab's view of it: the caller's own project, nothing wider (D28's actor).
CREATE OR REPLACE FUNCTION public.get_my_capacity(p_project_id uuid, _actor_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public._capacity_state(p_project_id, _actor_user_id) $$;
GRANT EXECUTE ON FUNCTION public.get_my_capacity(uuid, uuid) TO anon, authenticated, service_role;

-- ── 5 · the ledger's other two writes ────────────────────────────────────

-- Completion settles the reservation: the replication-weeks actually done (a
-- cancelled or failed run used what it ran) and the bytes it keeps.
CREATE OR REPLACE FUNCTION public._run_usage_complete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_weeks bigint;
BEGIN
  IF NEW.status IN ('done', 'failed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (SELECT 1 FROM public.run_usage WHERE run_id = NEW.id AND kind = 'dispatch') THEN
    v_weeks := GREATEST(1, ceil(COALESCE((NEW.run_spec -> 'scenario' ->> 'horizon_days')::numeric,
                         (SELECT horizon_days FROM public.scenarios WHERE id = NEW.scenario_id), 364) / 7.0))::bigint;
    INSERT INTO public.run_usage (org_id, user_id, project_id, run_id, rep_weeks, bytes, kind)
    SELECT d.org_id, d.user_id, d.project_id, NEW.id,
           COALESCE(NEW.rep_count_done, 0)::bigint * v_weeks,
           CASE WHEN NEW.status = 'done' THEN COALESCE(NEW.series_bytes, 0) ELSE 0 END, 'complete'
      FROM public.run_usage d WHERE d.run_id = NEW.id AND d.kind = 'dispatch'
    ON CONFLICT ON CONSTRAINT run_usage_run_kind_key DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._run_usage_complete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS simulation_runs_usage_complete ON public.simulation_runs;
CREATE TRIGGER simulation_runs_usage_complete
  AFTER UPDATE OF status ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._run_usage_complete();

-- The sweep releases: an 'expire' row for each run whose series it removes.
CREATE OR REPLACE FUNCTION public._run_usage_expire()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.series_expired_at IS NOT NULL AND OLD.series_expired_at IS NULL THEN
    INSERT INTO public.run_usage (org_id, user_id, project_id, run_id, rep_weeks, bytes, kind)
    SELECT (SELECT organization_id FROM public.projects WHERE id = NEW.project_id),
           (SELECT user_id FROM public.run_usage WHERE run_id = NEW.id AND kind = 'dispatch'),
           NEW.project_id, NEW.id, 0, -COALESCE(OLD.series_bytes, 0), 'expire'
    ON CONFLICT ON CONSTRAINT run_usage_run_kind_key DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._run_usage_expire() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS simulation_runs_usage_expire ON public.simulation_runs;
CREATE TRIGGER simulation_runs_usage_expire
  AFTER UPDATE OF series_expired_at ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._run_usage_expire();

-- ── 6 · retention from the plan ──────────────────────────────────────────

-- The plan's `series_retention_days`, which every organization starts at 90 (the
-- column default — WP 10.6's period, so nothing changes until an admin says so);
-- a super admin's NULL means unlimited, as every other limit of the plan. An
-- account with no organization has no plan and keeps the platform's 90 days:
-- retention is how the platform keeps storage bounded, not a limit on the user.
-- SECURITY DEFINER since it reads the plan: the retention trigger runs as the
-- writer, and a browser run completes as `anon`, which reads no organization.
CREATE OR REPLACE FUNCTION public.run_series_retention(p_project_id uuid)
RETURNS interval
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN o.id IS NULL THEN interval '90 days'
              WHEN o.series_retention_days IS NULL THEN NULL
              ELSE make_interval(days => o.series_retention_days) END
    FROM public.projects p LEFT JOIN public.organizations o ON o.id = p.organization_id
   WHERE p.id = p_project_id
$$;

-- No backfill: every organization starts at 90 days and an account with none
-- keeps 90, so no existing expiry changes. A change of the plan's period
-- re-dates that organization's standard runs (`admin_set_org_capacity`).

-- ── 7 · the super admin's controls ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_org_capacity(
  p_actor_id uuid, p_actor_email text, p_org_id uuid,
  p_storage_quota_bytes bigint, p_compute_quota_rep_weeks_month bigint,
  p_max_replications_per_run integer, p_max_concurrent_runs integer,
  p_series_retention_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT jsonb_build_object('storage_quota_bytes', storage_quota_bytes,
           'compute_quota_rep_weeks_month', compute_quota_rep_weeks_month,
           'max_replications_per_run', max_replications_per_run,
           'max_concurrent_runs', max_concurrent_runs, 'series_retention_days', series_retention_days)
    INTO v_before FROM public.organizations WHERE id = p_org_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;
  UPDATE public.organizations
     SET storage_quota_bytes = p_storage_quota_bytes,
         compute_quota_rep_weeks_month = p_compute_quota_rep_weeks_month,
         max_replications_per_run = p_max_replications_per_run,
         max_concurrent_runs = p_max_concurrent_runs,
         series_retention_days = p_series_retention_days,
         updated_at = now()
   WHERE id = p_org_id;
  -- A new retention period re-dates the organization's standard runs from when
  -- each ended (never into the past: a shortened period expires at the next
  -- sweep, not retroactively mid-read); NULL keeps their series without limit.
  IF (v_before ->> 'series_retention_days') IS DISTINCT FROM p_series_retention_days::text THEN
    UPDATE public.simulation_runs r
       SET series_expires_at = CASE WHEN p_series_retention_days IS NULL THEN NULL
             ELSE GREATEST(COALESCE(r.ended_at, r.created_at) + make_interval(days => p_series_retention_days), now()) END
      FROM public.projects p
     WHERE p.id = r.project_id AND p.organization_id = p_org_id
       AND r.status = 'done' AND r.retention = 'standard' AND r.series_expired_at IS NULL;
  END IF;
  PERFORM public.log_admin_action('org.capacity', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('storage_quota_bytes', p_storage_quota_bytes,
      'compute_quota_rep_weeks_month', p_compute_quota_rep_weeks_month,
      'max_replications_per_run', p_max_replications_per_run,
      'max_concurrent_runs', p_max_concurrent_runs, 'series_retention_days', p_series_retention_days));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_org_capacity(uuid,text,uuid,bigint,bigint,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_capacity(uuid,text,uuid,bigint,bigint,integer,integer,integer)
  TO anon, authenticated, service_role;

-- A per-organization override of a role's share (org NULL edits the default).
CREATE OR REPLACE FUNCTION public.admin_set_role_allowance(
  p_actor_id uuid, p_actor_email text, p_org_id uuid, p_project_role text,
  p_compute_share_pct numeric, p_storage_share_pct numeric, p_max_concurrent integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM set_config('app.current_user_id', p_actor_id::text, true);
  INSERT INTO public.plan_role_allowances (org_id, project_role, compute_share_pct, storage_share_pct, max_concurrent)
  VALUES (p_org_id, p_project_role, p_compute_share_pct, p_storage_share_pct, p_max_concurrent)
  ON CONFLICT ON CONSTRAINT plan_role_allowances_org_role_key DO UPDATE
     SET compute_share_pct = EXCLUDED.compute_share_pct, storage_share_pct = EXCLUDED.storage_share_pct,
         max_concurrent = EXCLUDED.max_concurrent, updated_at = now();
  PERFORM public.log_admin_action('org.role_allowance', 'plan_role_allowances',
    COALESCE(p_org_id::text, 'default') || ':' || p_project_role, NULL,
    jsonb_build_object('compute_share_pct', p_compute_share_pct, 'storage_share_pct', p_storage_share_pct,
                       'max_concurrent', p_max_concurrent));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_role_allowance(uuid,text,uuid,text,numeric,numeric,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_role_allowance(uuid,text,uuid,text,numeric,numeric,integer)
  TO anon, authenticated, service_role;

-- The usage view beside `admin_org_file_usage`: per organization, the month's
-- compute against its pool, the storage kept against its quota, runs in flight.
CREATE OR REPLACE FUNCTION public.admin_org_capacity_usage(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (org_id uuid, org_name text, compute_used_rep_weeks bigint, compute_quota_rep_weeks_month bigint,
               storage_used_bytes bigint, storage_quota_bytes bigint, active_runs bigint,
               max_concurrent_runs integer, series_retention_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT o.id, o.name, public._compute_used(o.id), o.compute_quota_rep_weeks_month,
         public._storage_used(o.id), o.storage_quota_bytes,
         (SELECT count(*) FROM public.simulation_runs r JOIN public.projects p ON p.id = r.project_id
           WHERE p.organization_id = o.id AND r.status IN ('queued','running')),
         o.max_concurrent_runs, o.series_retention_days
    FROM public.organizations o ORDER BY o.name;
END; $$;
REVOKE ALL ON FUNCTION public.admin_org_capacity_usage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_org_capacity_usage(uuid, text) TO anon, authenticated, service_role;

-- ── 8 · the one enforcement point ────────────────────────────────────────
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
  v_spec := public.simulation_run_spec(v_scenario, p_run ->> 'policy_hash', p_run ->> 'graph_hash',
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
    engine_id, run_spec, run_key, protocol_overrides, exploratory
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
    COALESCE((p_run ->> 'exploratory')::boolean, false) OR v_model IS NULL
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
