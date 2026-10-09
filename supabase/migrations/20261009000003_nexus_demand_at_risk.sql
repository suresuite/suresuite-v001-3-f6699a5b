-- §4 D307 — NEXUS NODES ARE SCORED PER NODE, BY DEMAND AT RISK, AND KEPT.
--
-- `predict-critical-nodes` scored LANE ROWS: every `supply_chain_data` row got its
-- source node's score through `analysis_mark_critical_nodes`. Three things were
-- wrong with that, and this migration is the database half of fixing all three.
--
--   1. The score did not survive. `rebuild_supply_chain_lanes` DELETEs and
--      re-INSERTs every lane, and since WP 8.2 any write to a lane source fires
--      it, so the next upload erased every flag (§4 D196). `node_list` is
--      upsert-only (`node_list_discover` is `ON CONFLICT DO NOTHING`), so a node's
--      score now outlives a rebuild of the lanes it was computed from — and says
--      which world it came from through `computed_from_hash`, so a stale one is
--      visible as stale rather than silently current.
--   2. The counts were lane rows labelled "nodes", and were filtered by plant name
--      alone, which no project owns. `get_critical_node_stats` counts NODES from
--      the run that scored them, for ONE project, and refuses a reader without
--      access to it.
--   3. The method was invisible. The run's `params` now carry the method and the
--      threshold, so both are part of the cache key and both reach the card.
--
-- What the score IS lives in `supabase/functions/_shared/criticalNodes.ts`.

-- ── 1 · the writer — node_list, from a RUNNING run, attributed ───────────────

CREATE OR REPLACE FUNCTION public.analysis_apply_critical_nodes(
  _run_id        uuid,
  _scores        jsonb,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run     public.analysis_runs;
  v_updated integer := 0;
  v_cleared integer := 0;
BEGIN
  IF jsonb_typeof(_scores) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'analysis_apply_critical_nodes: _scores must be a json array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_run FROM public.analysis_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis_apply_critical_nodes: no run %', _run_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_run.analysis_kind <> 'critical_nodes' THEN
    RAISE EXCEPTION 'analysis_apply_critical_nodes: run % is a % run', _run_id, v_run.analysis_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The entity mirror is written while the run is running or not at all (WP 4.3):
  -- a finished run's answer is frozen, and stamping rows from it afterwards would
  -- let the store and its mirror drift with the run claiming to describe both.
  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION
      'analysis_apply_critical_nodes: run % is %, and the entity mirror is written '
      'while the run is running or not at all', _run_id, v_run.status
      USING ERRCODE = 'P0A01';
  END IF;

  -- Names WHO and decides nothing (`20260917000005`).
  PERFORM public.assert_writer_may_act('analysis_apply_critical_nodes', v_run.project_id, _actor_user_id);

  -- ONE statement, scoped by the RUN's project — the scope is not a parameter a
  -- caller can get wrong, and the hash is read off the run, not passed in.
  UPDATE public.node_list nl
     SET is_critical_node     = s.is_critical,
         critical_node_score  = s.score,
         prediction_timestamp = now(),
         computed_from_hash   = v_run.input_hash,
         computed_at          = now(),
         updated_at           = now()
    FROM jsonb_to_recordset(_scores) AS s(node_id text, is_critical boolean, score numeric)
   WHERE nl.project_id = v_run.project_id AND nl.node_id = s.node_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- A node this run did not score carries no score from an earlier one. It is
  -- not on the lane graph any more (a supplier dropped from the inbound file), and
  -- leaving its old flag would show a nexus that no longer exists.
  UPDATE public.node_list nl
     SET is_critical_node     = NULL,
         critical_node_score  = NULL,
         prediction_timestamp = now(),
         computed_from_hash   = v_run.input_hash,
         computed_at          = now(),
         updated_at           = now()
   WHERE nl.project_id = v_run.project_id
     AND (nl.is_critical_node IS NOT NULL OR nl.critical_node_score IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_scores) e
                      WHERE e ->> 'node_id' = nl.node_id);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object(
    'rows_updated', v_updated,
    'rows_cleared', v_cleared,
    'scores_supplied', jsonb_array_length(_scores),
    'computed_from_hash', v_run.input_hash);
END; $fn$;

COMMENT ON FUNCTION public.analysis_apply_critical_nodes(uuid, jsonb, uuid) IS
  '§4 D307 — the critical_nodes run''s entity mirror: one score per NODE on node_list '
  '(is_critical_node, critical_node_score), stamped with the run''s input_hash. '
  'Written while the run is running; clears a score on a node the run did not '
  'score. Attributes through assert_writer_may_act and authorizes nothing.';

-- PUBLIC is not enough: Supabase's default privileges grant EXECUTE on every new
-- function to anon and authenticated by name, and this writer authorizes nothing.
REVOKE ALL ON FUNCTION public.analysis_apply_critical_nodes(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analysis_apply_critical_nodes(uuid, jsonb, uuid) TO service_role;

-- ── 2 · the read — nodes, one project, a named reader ───────────────────────

CREATE OR REPLACE FUNCTION public.get_critical_node_stats(
  p_project_id uuid,
  p_user_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run     public.analysis_runs;
  v_run_id  uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'get_critical_node_stats: this read must name its reader'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  -- LOCAL, so it cannot outlive this transaction on a pooled connection, and so
  -- `has_project_access` answers for the named reader (the D169 shape).
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'get_critical_node_stats: % cannot read project %', p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A run on the CURRENT lane graph first; the newest run otherwise, and then it
  -- says it is stale (§4 D238's rule, the same one the network-metrics read uses).
  -- Only runs that scored NODES qualify: a run from before D307 scored lane rows,
  -- and during the deploy window the published function can still write one, which
  -- must not mask a node-level answer by being newer.
  SELECT r.id INTO v_run_id
    FROM public.analysis_runs r
   WHERE r.project_id = p_project_id AND r.analysis_kind = 'critical_nodes'
     AND r.status = 'succeeded'
     AND EXISTS (SELECT 1 FROM public.analysis_results ar
                  WHERE ar.run_id = r.id AND ar.entity_type = 'node')
   ORDER BY public.analysis_run_is_current(r.id) DESC NULLS LAST, r.started_at DESC, r.id
   LIMIT 1;
  IF v_run_id IS NULL THEN
    RETURN jsonb_build_object('run_id', NULL);
  END IF;
  SELECT * INTO v_run FROM public.analysis_runs WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id',       v_run.id,
    'finished_at',  v_run.finished_at,
    'is_current',   public.analysis_run_is_current(v_run.id),
    'method',       v_run.params ->> 'method',
    'threshold',    (v_run.params ->> 'threshold')::numeric,
    'demand_basis', v_run.row_counts ->> 'demand_basis',
    'warnings',     COALESCE(v_run.warnings, '[]'::jsonb),
    'total',        (SELECT COUNT(*) FROM public.analysis_results ar
                      WHERE ar.run_id = v_run.id AND ar.entity_type = 'node'),
    'nexus',        (SELECT COUNT(*) FROM public.analysis_results ar
                      WHERE ar.run_id = v_run.id AND ar.entity_type = 'node'
                        AND (ar.metrics ->> 'is_critical')::boolean),
    -- The ten highest, with what made them so — the role is READ from
    -- `node_list.echelon` (§4 D127), never inferred here.
    'top', COALESCE((
      SELECT jsonb_agg(t.j ORDER BY t.rank)
        FROM (
          SELECT (ar.metrics ->> 'rank')::int AS rank,
                 jsonb_build_object(
                   'node_id',           ar.entity_id,
                   'echelon',           nl.echelon,
                   'score',             (ar.metrics ->> 'score')::numeric,
                   'is_critical',       (ar.metrics ->> 'is_critical')::boolean,
                   'rank',              (ar.metrics ->> 'rank')::int,
                   'products_affected', (ar.metrics ->> 'products_affected')::int,
                   'sole_source_of',    COALESCE(ar.metrics -> 'sole_source_of', '[]'::jsonb)) AS j
            FROM public.analysis_results ar
            LEFT JOIN public.node_list nl
              ON nl.project_id = v_run.project_id AND nl.node_id = ar.entity_id
           WHERE ar.run_id = v_run.id AND ar.entity_type = 'node'
             AND ar.metrics ->> 'rank' IS NOT NULL
           ORDER BY (ar.metrics ->> 'rank')::int
           LIMIT 10) t), '[]'::jsonb)
  );
END; $fn$;

COMMENT ON FUNCTION public.get_critical_node_stats(uuid, uuid) IS
  '§4 D307 — the nexus card''s read: node counts, method, threshold, staleness and '
  'the ten highest-ranked nodes with their drivers, from the project''s current '
  'critical_nodes run (else its newest, marked stale). Refuses a reader without '
  'access to the project.';

REVOKE ALL ON FUNCTION public.get_critical_node_stats(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_critical_node_stats(uuid, uuid) TO anon, authenticated, service_role;

-- ── 3 · the analysis kind says what it reads and where it writes ────────────

UPDATE public.analysis_kinds
   SET description =
     'Nexus nodes by demand at risk over the lane graph (supply_chain_data), which '
     'is rebuilt from the process level; one score per node, mirrored onto node_list.'
 WHERE kind = 'critical_nodes';

-- ── 4 · the lane-row path, kept for ONE deploy window ───────────────────────
-- Migrations and edge functions deploy through different workflows with no order
-- between them, so the PUBLISHED `predict-critical-nodes` keeps calling the old
-- writer, and the published card the old read, until both redeploy.

COMMENT ON FUNCTION public.analysis_mark_critical_nodes(uuid, jsonb, uuid) IS
  'DEPRECATED (§4 D307): scored lane rows, which every lane rebuild deletes (D196). '
  'Uncalled in the repository; kept for the deploy window in which the published '
  'predict-critical-nodes still calls it. Superseded by analysis_apply_critical_nodes.';

-- And it is closed to the browser roles. `rehearsal/890`'s grant check found the
-- writer it replaces executable by `anon` and `authenticated` through Supabase's
-- default privileges — and it authorizes nothing, so anyone holding the public key
-- could stamp scores onto lane rows naming any actor. Its only caller is the edge
-- function, which runs as `service_role`.
REVOKE ALL ON FUNCTION public.analysis_mark_critical_nodes(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analysis_mark_critical_nodes(uuid, jsonb, uuid) TO service_role;

COMMENT ON FUNCTION public.get_prediction_stats(text, uuid, text) IS
  'DEPRECATED (§4 D307): counted lane rows by plant name across every project. '
  'Uncalled in the repository; kept for the deploy window of the published card. '
  'Superseded by get_critical_node_stats.';
