-- ============================================================================
-- Phase 10 / WP 10.4 · §4 D245 · gate `result-binding` · blueprint §9.2
-- ENGINES, RUNKEY, AND THE RESULT BINDING ON THE ROW (absorbs WP 9.2).
--
-- D245: a run row bound no engine, no RunKey and no protocol, and "reuse" keyed
-- on three stamped hashes plus "the scenario row is unchanged since" — so a run
-- on a different engine build was offered as identical, and any scenario edit
-- (a rename included) threw every earlier run away. The engine was chosen by an
-- environment flag on the worker and labelled after the fact.
--
-- WHAT THIS ADDS
--   1. `sim_engines` — the engine registry. scsim is seeded ACTIVE; the legacy
--      worker engine is seeded RETIRED (it stays frozen — the law in CLAUDE.md —
--      and it is never offered). The worker reports its version and
--      `code_version` at boot through `sim_engine_report`; dispatch resolves an
--      engine through `sim_engine_for_dispatch`, which refuses a retired or
--      unknown engine and defaults to the single active one.
--   2. On `simulation_runs`: `engine_id`, `run_spec` (the whole identity, as
--      data), `run_key` (sha256 of it), `protocol_overrides` (`{}` = faithful to
--      the Validated Model) and `exploratory` (NOT NULL). The Validated Model the
--      run follows is the EXISTING `model_validation_id` — the brief's
--      `validated_model_id` would be a second column for one fact (§16 · WP 10.4).
--   3. ONE run identity, in SQL: `simulation_run_spec` builds it, `run_key` is its
--      hash, `find_reusable_runs` is the reuse lookup the dispatcher AND the AI
--      read tool both call (§20.1 law 2), and `create_simulation_run` is the one
--      insert path — under an advisory lock on the key, so identical submissions
--      make one run: a completed one is offered for reuse (409), an in-flight one
--      is attached to rather than duplicated.
--   4. `model_validations.engine_id` gets its foreign key (WP 10.3 left it waiting).
--
-- THE SPEC IS A DENYLIST OVER THE SCENARIO ROW, DELIBERATELY: every scenario
-- column is part of the key except the ones that are identity or presentation
-- (id, name, description, timestamps, role, author, the inheritance pointer, the
-- network-origin flag). A column added to `scenarios` later is IN the key by
-- default — the failure mode is a needless re-run, never a false reuse.
--
-- WHAT IT DOES NOT DO: drop `network_topology_hash` (§4 D240's last shim). The
-- PUBLISHED analyzers call it until the merge redeploys them, so the drop waits
-- for a §15 read after the merge — WP 10.9's (§20).
-- ============================================================================

-- ── 1 · the engine registry ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sim_engines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,
  name          text NOT NULL,
  version       text,
  code_version  text,
  status        text NOT NULL CHECK (status IN ('active', 'retired')),
  capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,
  reported_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sim_engines_slug_key UNIQUE (slug)
);
COMMENT ON TABLE public.sim_engines IS
  'WP 10.4 · §4 D245 — the engine registry. One row per engine; `status` says whether dispatch may use it. The worker reports `version`/`code_version` through sim_engine_report.';

ALTER TABLE public.sim_engines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sim_engines_read ON public.sim_engines;
-- A registry, not project data: every signed-in surface may read which engines exist.
CREATE POLICY sim_engines_read ON public.sim_engines FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.sim_engines TO anon, authenticated, service_role;

INSERT INTO public.sim_engines (slug, name, status, capabilities) VALUES
  ('scsim', 'scsim — the strategic engine', 'active',
   '{"compute": ["worker", "browser"], "replications_max": 200}'::jsonb),
  ('legacy-worker', 'Legacy worker engine (frozen)', 'retired', '{"compute": ["worker"]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- The engine a recorded code_version names. Both writers spell it the same way:
-- the worker's `scsim-<ENGINE_VERSION>` / `worker-legacy`, the browser's
-- `scsim-…` from the wheel manifest.
CREATE OR REPLACE FUNCTION public._engine_for_code_version(p_code_version text)
RETURNS uuid
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT id FROM public.sim_engines
   WHERE slug = CASE
     WHEN p_code_version ILIKE 'scsim%' THEN 'scsim'
     WHEN p_code_version = 'worker-legacy' THEN 'legacy-worker'
   END;
$$;
-- Not SECURITY DEFINER and reads only a table every role may read, so it is
-- granted, not revoked: the derivation triggers below run AS THE WRITER, and the
-- browser writes `simulation_runs` as anon (`rehearsal/590` §6 proves it as anon).
GRANT EXECUTE ON FUNCTION public._engine_for_code_version(text) TO anon, authenticated, service_role;

-- The worker's boot report. It updates the registry row it runs, never creates
-- one: an engine the registry does not know is not an engine dispatch may use.
CREATE OR REPLACE FUNCTION public.sim_engine_report(
  p_slug         text,
  p_version      text,
  p_code_version text,
  p_capabilities jsonb DEFAULT NULL
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
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sim_engine_report(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sim_engine_report(text, text, text, jsonb) TO service_role;

-- Dispatch's choice of engine: the one named, which must exist and be active;
-- or, when none is named, the single active engine.
CREATE OR REPLACE FUNCTION public.sim_engine_for_dispatch(p_engine_id uuid DEFAULT NULL)
RETURNS public.sim_engines
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  e public.sim_engines%ROWTYPE;
  n integer;
BEGIN
  IF p_engine_id IS NOT NULL THEN
    SELECT * INTO e FROM public.sim_engines WHERE id = p_engine_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'engine % is not in the registry', p_engine_id USING ERRCODE = 'no_data_found';
    END IF;
    IF e.status <> 'active' THEN
      RAISE EXCEPTION 'engine % is retired and cannot run', e.slug USING ERRCODE = 'check_violation';
    END IF;
    RETURN e;
  END IF;
  SELECT count(*) INTO n FROM public.sim_engines WHERE status = 'active';
  IF n = 0 THEN
    RAISE EXCEPTION 'no active engine is registered' USING ERRCODE = 'no_data_found';
  ELSIF n > 1 THEN
    RAISE EXCEPTION 'more than one engine is active — the run must name one' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO e FROM public.sim_engines WHERE status = 'active';
  RETURN e;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.sim_engine_for_dispatch(uuid) TO anon, authenticated, service_role;

-- ── 2 · the Validated Model's engine (WP 10.3 left the column waiting) ────

-- A derivation inside the insert: it names the engine the evidence run recorded
-- and decides nothing.
CREATE OR REPLACE FUNCTION public._validated_model_engine()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  NEW.engine_id := COALESCE(NEW.engine_id, public._engine_for_code_version(NEW.engine_fingerprint));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS model_validations_engine ON public.model_validations;
CREATE TRIGGER model_validations_engine
  BEFORE INSERT ON public.model_validations
  FOR EACH ROW EXECUTE FUNCTION public._validated_model_engine();

-- Immutability, with ONE completion allowed: `engine_id` may be filled once, and
-- only with the engine the model's own `engine_fingerprint` names. WP 10.3 shipped
-- the column empty on purpose (its foreign key is this package's), so filling it
-- from a fact the row already carries completes the model rather than changing it
-- — `model_hash` covers the fingerprint, not the id. Anything else stays refused.
CREATE OR REPLACE FUNCTION public._validated_model_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  k_lifecycle text[] := ARRAY['status','superseded_by','revoked_at','revoked_by','revoke_reason'];
  k_fill      text[] := k_lifecycle;
BEGIN
  IF OLD.engine_id IS NULL
     AND NEW.engine_id IS NOT DISTINCT FROM public._engine_for_code_version(OLD.engine_fingerprint) THEN
    k_fill := k_lifecycle || ARRAY['engine_id'];
  END IF;
  IF (to_jsonb(NEW) - k_fill) IS DISTINCT FROM (to_jsonb(OLD) - k_fill) THEN
    RAISE EXCEPTION 'model_validations: a Validated Model is immutable — only its status, supersession and revocation may change (WP 10.3)'
      USING ERRCODE = 'P0A02';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.model_validations
   SET engine_id = public._engine_for_code_version(engine_fingerprint)
 WHERE engine_id IS NULL AND engine_fingerprint IS NOT NULL;

ALTER TABLE public.model_validations DROP CONSTRAINT IF EXISTS model_validations_engine_id_fkey;
ALTER TABLE public.model_validations
  ADD CONSTRAINT model_validations_engine_id_fkey
  FOREIGN KEY (engine_id) REFERENCES public.sim_engines(id);

-- ── 3 · the run row's bindings ───────────────────────────────────────────

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS engine_id          uuid,
  ADD COLUMN IF NOT EXISTS run_spec           jsonb,
  ADD COLUMN IF NOT EXISTS run_key            text,
  ADD COLUMN IF NOT EXISTS protocol_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS exploratory        boolean;

ALTER TABLE public.simulation_runs DROP CONSTRAINT IF EXISTS simulation_runs_engine_id_fkey;
ALTER TABLE public.simulation_runs
  ADD CONSTRAINT simulation_runs_engine_id_fkey
  FOREIGN KEY (engine_id) REFERENCES public.sim_engines(id);

-- History: the engine a past run recorded, and "exploratory" exactly when it ran
-- under no Validated Model. Neither is a guess — both read the row's own columns.
UPDATE public.simulation_runs
   SET engine_id = public._engine_for_code_version(code_version)
 WHERE engine_id IS NULL AND COALESCE(code_version, '') <> '';
UPDATE public.simulation_runs
   SET exploratory = (model_validation_id IS NULL)
 WHERE exploratory IS NULL;

-- A writer that does not state these (the dispatcher deployed ahead of this
-- migration, in the window both deploy on merge) still writes a whole row: the
-- class is derived from the stamp, and the engine from the code version the
-- worker writes later. A derivation inside somebody else's statement names WHAT
-- and decides nothing.
CREATE OR REPLACE FUNCTION public._simulation_run_derive()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.exploratory := COALESCE(NEW.exploratory, NEW.model_validation_id IS NULL);
  END IF;
  IF NEW.engine_id IS NULL AND COALESCE(NEW.code_version, '') <> '' THEN
    NEW.engine_id := public._engine_for_code_version(NEW.code_version);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS simulation_runs_derive_ins ON public.simulation_runs;
CREATE TRIGGER simulation_runs_derive_ins
  BEFORE INSERT ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._simulation_run_derive();
DROP TRIGGER IF EXISTS simulation_runs_derive_upd ON public.simulation_runs;
CREATE TRIGGER simulation_runs_derive_upd
  BEFORE UPDATE OF code_version ON public.simulation_runs
  FOR EACH ROW EXECUTE FUNCTION public._simulation_run_derive();

ALTER TABLE public.simulation_runs ALTER COLUMN exploratory SET NOT NULL;

CREATE INDEX IF NOT EXISTS simulation_runs_run_key
  ON public.simulation_runs (project_id, run_key) WHERE run_key IS NOT NULL;

-- ── 4 · ONE run identity ─────────────────────────────────────────────────

-- The spec a RunKey hashes: the engine as it is registered NOW, the two content
-- hashes, the scenario row minus identity/presentation columns, and the
-- deviations from the Validated Model's protocol. Stored on the run as
-- `run_spec`, so every binding resolves from the row and no live row is read.
CREATE OR REPLACE FUNCTION public.simulation_run_spec(
  p_scenario_id        uuid,
  p_policy_hash        text,
  p_graph_hash         text,
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
    'run_key_version', 1,
    'engine', jsonb_build_object('id', e.id, 'slug', e.slug, 'version', e.version,
                                 'code_version', e.code_version),
    'policy_hash', p_policy_hash,
    'graph_hash', p_graph_hash,
    'scenario', sc,
    'protocol_overrides', COALESCE(p_protocol_overrides, '{}'::jsonb));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.simulation_run_spec(uuid, text, text, uuid, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.simulation_run_key(p_spec jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT encode(extensions.digest(p_spec::text, 'sha256'), 'hex') $$;
GRANT EXECUTE ON FUNCTION public.simulation_run_key(jsonb) TO anon, authenticated, service_role;

-- THE reuse predicate (§9.2, G17, §20.1 law 2): a completed run of this scenario
-- with this RunKey and at least the replications asked for. The dispatcher and
-- the AI read tool both reach it, so a read-hit and an apply-hit cannot disagree.
-- Invoker's rights: a caller sees only the runs its own grants let it see.
CREATE OR REPLACE FUNCTION public.find_reusable_runs(
  p_scenario_id        uuid,
  p_policy_hash        text,
  p_graph_hash         text,
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
      public.simulation_run_spec(p_scenario_id, p_policy_hash, p_graph_hash, p_engine_id, p_protocol_overrides)) AS key
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

-- The one insert path for a run row. Under an advisory lock on the RunKey:
--   · not forced, and a completed identical run exists → {reuse: candidate}, no row;
--   · an identical run is in flight (running, or queued in the last 15 minutes)
--     and the caller may attach → {run_id, attached: true}, no row — two clicks
--     are one run. A browser-computed run never attaches: the browser that asked
--     computes it, so a second one would be a second writer of one run;
--   · otherwise the queued row, carrying engine, spec, key, overrides and class.
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
  -- The engine travels to the worker in the envelope, so a worker that runs a
  -- different one refuses the run instead of computing and relabelling it.
  RETURN jsonb_build_object('run_id', v_id, 'attached', false, 'run_key', v_key,
    'engine', jsonb_build_object('id', v_engine.id, 'slug', v_engine.slug,
                                 'code_version', v_engine.code_version));
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_simulation_run(jsonb, boolean, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_simulation_run(jsonb, boolean, boolean, uuid) TO service_role;

-- ── 5 · §4 D248: internal SECURITY DEFINER helpers the API could call ─────
--
-- Supabase grants EXECUTE on every new `public` function to anon and
-- authenticated EXPLICITLY (default privileges), so `REVOKE … FROM PUBLIC` — the
-- shape 63 statements in this repository take — leaves a helper callable through
-- PostgREST. These six predate Phase 10 and every caller of each is itself
-- SECURITY DEFINER (measured in `rehearsal/590` §7's probe), so the API roles lose
-- nothing they use: the snapshot builders hand any project's policies or whole
-- dataset to a caller who names its uuid, and the super-admin helpers answer and
-- lock for anyone. Phase 10's own helpers are revoked where they are defined.
REVOKE ALL ON FUNCTION public._build_policy_snapshot(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._build_scenario_fingerprint(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._build_dataset_snapshot(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._build_dataset_snapshot_v2(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._active_super_admin_count()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._assert_super_admin(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_active_super_admins()        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._build_policy_snapshot(uuid),
                          public._build_scenario_fingerprint(uuid),
                          public._build_dataset_snapshot(uuid),
                          public._build_dataset_snapshot_v2(uuid),
                          public._active_super_admin_count(),
                          public._assert_super_admin(uuid, text),
                          public._lock_active_super_admins()
  TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
