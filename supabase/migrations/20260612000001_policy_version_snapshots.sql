-- =====================================================================
-- Policy version snapshots v2 + version-bound simulation runs.
--
--   * policy_versions gains author/lineage columns (idempotent superset of
--     docs/policy-version-fix.sql) plus policy_hash.
--   * Snapshot shape v2: { schema_version, defaults: {7 families},
--     fulfillment_strategy, overrides: [{scope,target_key,family,patch}] }.
--     v1 snapshots (flat family map, no "defaults" key) remain readable.
--   * snapshot_policy captures defaults + ALL policy_overrides +
--     fulfillment_strategy and stamps a sha256 policy_hash.
--   * restore_policy_version restores all of it (v2) or defaults only (v1).
--   * current_policy_hash(project) lets clients detect unsaved changes.
--   * simulation_runs.policy_version_id ties each run to a saved version.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Columns ---------------------------------------------------------------

ALTER TABLE public.policy_versions
  ADD COLUMN IF NOT EXISTS author_user_id    uuid,
  ADD COLUMN IF NOT EXISTS author_email      text,
  ADD COLUMN IF NOT EXISTS author_name       text,
  ADD COLUMN IF NOT EXISTS parent_version_id uuid REFERENCES public.policy_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS policy_hash       text;

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES public.policy_versions(id) ON DELETE SET NULL;

-- 2. Data-API access (same posture as docs/policy-version-fix.sql) ----------

GRANT SELECT, INSERT ON public.policy_versions TO anon;
GRANT ALL            ON public.policy_versions TO service_role;

DROP POLICY IF EXISTS "Users can read versions for their projects"   ON public.policy_versions;
DROP POLICY IF EXISTS "Users can create versions for their projects" ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_anon_read"                    ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_auth_read"                    ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_read_all"                     ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_insert_all"                   ON public.policy_versions;

CREATE POLICY "policy_versions_read_all"
  ON public.policy_versions FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "policy_versions_insert_all"
  ON public.policy_versions FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 3. Snapshot builder (single canonicalization point for hashing) -----------

CREATE OR REPLACE FUNCTION public._build_policy_snapshot(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row       public.policy_defaults%ROWTYPE;
  v_overrides jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.policy_defaults
  WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No policy_defaults found for project %', p_project_id;
  END IF;

  -- Deterministic ordering so snapshot::text is stable for hashing.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'scope', o.scope,
        'target_key', o.target_key,
        'family', o.family,
        'patch', o.patch
      )
      ORDER BY o.scope, o.target_key, o.family
    ),
    '[]'::jsonb
  )
  INTO v_overrides
  FROM public.policy_overrides o
  WHERE o.project_id = p_project_id;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'defaults', jsonb_build_object(
      'sourcing',    v_row.sourcing,
      'inventory',   v_row.inventory,
      'transport',   v_row.transport,
      'fulfillment', v_row.fulfillment,
      'production',  v_row.production,
      'recovery',    v_row.recovery,
      'demand',      v_row.demand
    ),
    'fulfillment_strategy', COALESCE(v_row.fulfillment_strategy, 'make_to_stock'),
    'overrides', v_overrides
  );
END;
$$;

-- 4. snapshot_policy: full-state v2 snapshot + policy_hash -------------------

DROP FUNCTION IF EXISTS public.snapshot_policy(uuid, text);
DROP FUNCTION IF EXISTS public.snapshot_policy(uuid, text, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.snapshot_policy(
  p_project_id        uuid,
  p_label             text DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_user_email        text DEFAULT NULL,
  p_user_name         text DEFAULT NULL,
  p_parent_version_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id       uuid;
  v_snapshot jsonb;
  v_prev     jsonb;
BEGIN
  v_snapshot := public._build_policy_snapshot(p_project_id);

  -- Previous model: explicit parent snapshot, else latest version on project.
  IF p_parent_version_id IS NOT NULL THEN
    SELECT snapshot INTO v_prev FROM public.policy_versions WHERE id = p_parent_version_id;
  ELSE
    SELECT snapshot INTO v_prev
    FROM public.policy_versions
    WHERE project_id = p_project_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.policy_versions (
    project_id, label, snapshot, created_by,
    author_user_id, author_email, author_name,
    parent_version_id, previous_snapshot, policy_hash
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_snapshot,
    COALESCE(p_user_id, auth.uid()),
    COALESCE(p_user_id, auth.uid()),
    p_user_email,
    p_user_name,
    p_parent_version_id,
    v_prev,
    encode(digest(v_snapshot::text, 'sha256'), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text, uuid, text, text, uuid) TO anon, authenticated;

-- 5. current_policy_hash: dirty detection ------------------------------------

CREATE OR REPLACE FUNCTION public.current_policy_hash(p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT encode(digest(public._build_policy_snapshot(p_project_id)::text, 'sha256'), 'hex');
$$;

GRANT EXECUTE ON FUNCTION public.current_policy_hash(uuid) TO anon, authenticated;

-- 6. list_policy_versions: expose policy_hash --------------------------------

DROP FUNCTION IF EXISTS public.list_policy_versions(uuid);

CREATE OR REPLACE FUNCTION public.list_policy_versions(p_project_id uuid)
RETURNS TABLE (
  id                uuid,
  label             text,
  author_email      text,
  author_name       text,
  parent_version_id uuid,
  policy_hash       text,
  created_at        timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, label, author_email, author_name, parent_version_id, policy_hash, created_at
  FROM public.policy_versions
  WHERE project_id = p_project_id
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_policy_versions(uuid) TO anon, authenticated;

-- 7. restore_policy_version: full restore for v2, defaults-only for v1 -------

CREATE OR REPLACE FUNCTION public.restore_policy_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row      public.policy_versions%ROWTYPE;
  v_defaults jsonb;
  v_is_v2    boolean;
BEGIN
  SELECT * INTO v_row FROM public.policy_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version % not found', p_version_id; END IF;

  v_is_v2    := v_row.snapshot ? 'defaults';
  v_defaults := CASE WHEN v_is_v2 THEN v_row.snapshot -> 'defaults' ELSE v_row.snapshot END;

  UPDATE public.policy_defaults SET
    sourcing    = COALESCE(v_defaults -> 'sourcing',    sourcing),
    inventory   = COALESCE(v_defaults -> 'inventory',   inventory),
    transport   = COALESCE(v_defaults -> 'transport',   transport),
    fulfillment = COALESCE(v_defaults -> 'fulfillment', fulfillment),
    production  = COALESCE(v_defaults -> 'production',  production),
    recovery    = COALESCE(v_defaults -> 'recovery',    recovery),
    demand      = COALESCE(v_defaults -> 'demand',      demand),
    fulfillment_strategy = CASE
      WHEN v_is_v2 THEN COALESCE(v_row.snapshot ->> 'fulfillment_strategy', fulfillment_strategy)
      ELSE fulfillment_strategy
    END,
    updated_at  = now()
  WHERE project_id = v_row.project_id;

  -- v1 snapshots predate override capture: leave live overrides untouched.
  IF v_is_v2 THEN
    DELETE FROM public.policy_overrides WHERE project_id = v_row.project_id;

    INSERT INTO public.policy_overrides (project_id, scope, target_key, family, patch)
    SELECT
      v_row.project_id,
      o ->> 'scope',
      o ->> 'target_key',
      o ->> 'family',
      COALESCE(o -> 'patch', '{}'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_row.snapshot -> 'overrides', '[]'::jsonb)) AS o;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_policy_version(uuid) TO anon, authenticated;

-- 8. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
