-- Trust / §4 D257 — `project_freshness` NAMES ITS READER, so the browser can call it.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- `project_freshness(p_project_id)` refuses unless `has_project_access` is true, and that
-- predicate learns who is calling from the session or the `app.current_user_id` setting.
-- The browser calls as `anon` (this application authenticates against `approved_users`,
-- not Supabase Auth — D28, D155), no session names anybody, and the setting is LOCAL to
-- the statement that sets it, so the freshness call arrives with no user and the answer
-- is false for EVERYONE: PostgREST returns 401 and the freshness badge, the Trust Report
-- panel and the Trust Report in a workbook export have each been reading "unavailable"
-- in a real browser. `rehearsal/140` sets the setting by hand before every call, which
-- is why it passed. D169 is the same shape: a read that works for a caller who is
-- already identified and for no one else.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
-- `project_freshness(p_project_id uuid, p_user_id uuid DEFAULT NULL)`. The browser names
-- the user; the function sets the actor for its own transaction and then applies the
-- SAME `has_project_access` rule it always has. Nothing about WHO may read freshness
-- widens: the project's owner, an `admin` or a `super_admin` (D256). A NULL name leaves
-- the actor alone, so every existing one-argument call still resolves and behaves as it
-- did. VOLATILE rather than STABLE, because it now sets a setting.
--
-- The signature changes, so this is a DROP and CREATE, which takes the grants with it —
-- they are restated. Everything between the opening `BEGIN` and `END` below the new
-- preamble is `20260917000008`'s body, byte for byte.

DROP FUNCTION IF EXISTS public.project_freshness(uuid);

CREATE FUNCTION public.project_freshness(p_project_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_hash     text;
  v_tables   jsonb := '{}'::jsonb;
  v_dsv      jsonb;
  v_runs     jsonb;
BEGIN
  -- The reader is NAMED, because the browser calls as `anon` and no session says who it is
  -- (D155). The same asserted-user model every upload RPC uses (D28): the database refuses
  -- a project that user cannot reach, which is a constraint and not proof of identity.
  -- A NULL name changes nothing, so a caller whose transaction already set the actor
  -- (the rehearsals, a service-side caller) is not blanked by omitting it.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'project_freshness: no access to project %', p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hash := public.current_graph_hash(p_project_id);

  -- One statement per derived table, each classifying its own rows against the
  -- single hash read above. `filter` rather than three scans.
  SELECT jsonb_object_agg(t, counts) INTO v_tables FROM (
    SELECT 'network_nodes' AS t, jsonb_build_object(
             'rows',    count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at)) AS counts
      FROM public.network_nodes WHERE project_id = p_project_id
    UNION ALL
    SELECT 'node_list', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.node_list WHERE project_id = p_project_id
    UNION ALL
    SELECT 'supply_chain_data', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.supply_chain_data WHERE project_id = p_project_id
    UNION ALL
    SELECT 'network_summary', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE computed_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE computed_from_hash IS NOT NULL
                                           AND computed_from_hash <> v_hash),
             'unknown', count(*) FILTER (WHERE computed_from_hash IS NULL),
             'computed_at', max(computed_at))
      FROM public.network_summary WHERE project_id = p_project_id
    UNION ALL
    -- The one that is NOT a display concern. §11: the engine reads overrides,
    -- not the grid, so a stale seeded override changes what a simulation
    -- computes. A TYPED override (`seeded_from_hash IS NULL`) is a decision and
    -- is reported as `typed` rather than folded into `unknown` — it is not
    -- missing provenance, it has none to miss.
    SELECT 'policy_overrides', jsonb_build_object(
             'rows', count(*),
             'fresh',   count(*) FILTER (WHERE seeded_from_hash = v_hash),
             'stale',   count(*) FILTER (WHERE seeded_from_hash IS NOT NULL
                                           AND seeded_from_hash <> v_hash),
             'unknown', 0,
             'typed',   count(*) FILTER (WHERE seeded_from_hash IS NULL),
             'computed_at', max(updated_at))
      FROM public.policy_overrides WHERE project_id = p_project_id
  ) q;

  SELECT to_jsonb(d) - 'snapshot' INTO v_dsv
    FROM public.dataset_versions d
   WHERE d.project_id = p_project_id
   ORDER BY d.created_at DESC LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
           'analysis_kind', r.analysis_kind,
           'run_id', r.id,
           'status', r.status,
           'code_version', r.code_version,
           'finished_at', r.finished_at,
           'freshness', public.freshness_of(r.input_hash, p_project_id),
           'warnings', r.warnings)
         ORDER BY r.started_at DESC) INTO v_runs
    FROM (SELECT DISTINCT ON (analysis_kind) *
            FROM public.analysis_runs
           WHERE project_id = p_project_id AND status = 'succeeded'
           ORDER BY analysis_kind, started_at DESC) r;

  RETURN jsonb_build_object(
    'project_id',      p_project_id,
    'graph_hash',      v_hash,
    'graph_hash_short', left(COALESCE(v_hash, ''), 12),
    'dataset_version', v_dsv,
    'tables',          COALESCE(v_tables, '{}'::jsonb),
    'latest_runs',     COALESCE(v_runs, '[]'::jsonb),
    'measured_at',     now());
END; $fn$;

COMMENT ON FUNCTION public.project_freshness(uuid, uuid) IS
  'WP 4.4 · everything the freshness badge and the Trust Report''s per-table '
  'section need, in ONE round trip and against ONE read of `current_graph_hash`. '
  'Per table it is computed and never written (D70), so a project whose hash '
  'moves and moves back reports fresh again with no row rewritten. '
  '`policy_overrides` reports `typed` separately from `unknown`: a typed override '
  'has no provenance to miss, and the ENGINE reads overrides rather than the '
  'grid, so its staleness is a simulation-correctness fact rather than a display '
  'one. D257 · the reader is named (`p_user_id`) because the browser calls as anon.';

REVOKE ALL ON FUNCTION public.project_freshness(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_freshness(uuid, uuid) TO anon, authenticated, service_role;
