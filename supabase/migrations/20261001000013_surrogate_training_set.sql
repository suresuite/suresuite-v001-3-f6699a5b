-- ============================================================================
-- Phase 10 / WP 10.8 · blueprint §11.2–§11.4 · G12 · §4 D249
-- THE SURROGATE-READY TRAINING SET. No model is trained here.
--
-- 1. `surrogate_training_runs` — one row per replication of every run that may
--    teach a surrogate: completed, following a VALIDATED model that is not
--    revoked, NOT exploratory, faithful to the model's protocol
--    (`protocol_overrides = '{}'`), and not dispatched past the required-data
--    gate (a skipped gate computed on substituted defaults — T2). Keyed by the
--    Validated Model and the Graph Version the run computed over, exposing the
--    RunKey and the replication's KPIs and cell.
--
--    §4 D249's training half: a model's EVIDENCE run names no model on its own
--    row (it ran before the model existed, so it is `exploratory` by WP 10.4's
--    rule). A model's runs are therefore `model_validation_id = m.id` OR
--    `id = m.evidence_run_id` — dropping the evidence run would drop the very
--    run the model was validated on.
--
--    A VIEW, not a table: membership is a rule over rows that already exist, and
--    a materialised copy would be a second author of it (`single-source`). It
--    runs as its caller (`security_invoker`), as every view here must
--    (`rehearsal/030`).
--
-- 2. `feature_spec` — a per-Graph-Version structural description of the
--    sourcing network (out-degree and weighted out-degree per supplier, supplier
--    count per material, the single-sourced count and the multi-source rate),
--    computed ONCE per product-level hash as an analysis kind through the WP 10.1
--    store: `analysis_get_or_start` keys it, `analysis_complete_run` stores it,
--    and a second request for the same graph is a cache hit.
-- ============================================================================

-- ── 1 · the training set ─────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.surrogate_training_runs
WITH (security_invoker = true) AS
SELECT
  m.project_id,
  m.id                         AS validated_model_id,
  m.name                       AS model_name,
  m.version_no                 AS model_version_no,
  m.model_hash,
  r.dataset_version_id         AS graph_version_id,
  dv.version_no                AS graph_version_no,
  r.graph_hash,
  r.id                         AS run_id,
  r.run_key,
  r.engine_id,
  r.code_version,
  r.policy_version_id,
  r.policy_hash,
  (r.id = m.evidence_run_id)   AS is_evidence_run,
  rr.rep_index,
  NULLIF(rr.kpis ->> 'model_rep', '')::integer AS model_rep,
  NULLIF(rr.kpis ->> 'event_rep', '')::integer AS event_rep,
  rr.seed_used                 AS root_seed,
  rr.kpis
FROM public.model_validations m
JOIN public.simulation_runs r
  ON r.project_id = m.project_id
 AND ((r.model_validation_id = m.id AND NOT r.exploratory) OR r.id = m.evidence_run_id)
LEFT JOIN public.dataset_versions dv ON dv.id = r.dataset_version_id
JOIN public.run_replications rr ON rr.run_id = r.id AND rr.status = 'done'
WHERE m.verdict = 'validated'
  AND m.status <> 'revoked'
  AND r.status = 'done'
  AND COALESCE(r.protocol_overrides, '{}'::jsonb) = '{}'::jsonb
  AND NOT COALESCE(r.gate_skipped, false);

COMMENT ON VIEW public.surrogate_training_runs IS
  'WP 10.8 · §4 D249. One row per replication of a run that may train a surrogate: '
  'done, following a validated non-revoked model (by model_validation_id, or as that '
  'model''s evidence run), not exploratory, faithful to the protocol, gate not '
  'skipped. Grouped by validated_model_id and graph_version_id. Runs as its caller.';

GRANT SELECT ON public.surrogate_training_runs TO anon, authenticated, service_role;

-- What the training set holds, grouped as a surrogate would read it: per model
-- and graph version, how many runs and replications. Runs as its caller, so it
-- sees exactly what the view shows that caller.
CREATE OR REPLACE FUNCTION public.surrogate_training_summary(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY g.model_name, g.model_version_no, g.graph_version_no), '[]'::jsonb)
    FROM (
      SELECT validated_model_id, model_name, model_version_no, graph_version_id, graph_version_no,
             count(DISTINCT run_id) AS runs, count(*) AS replications,
             bool_or(is_evidence_run) AS includes_evidence_run
        FROM public.surrogate_training_runs
       WHERE project_id = p_project_id
       GROUP BY validated_model_id, model_name, model_version_no, graph_version_id, graph_version_no
    ) g
$$;
GRANT EXECUTE ON FUNCTION public.surrogate_training_summary(uuid) TO anon, authenticated, service_role;

-- ── 2 · the structural features, computed once per graph ─────────────────

INSERT INTO public.analysis_kinds (kind, input_scope, fallback_scope, fallback_rule, description) VALUES
  ('feature_spec', 'product', NULL, NULL,
   'Structural features of the sourcing network for a surrogate (WP 10.8): out-degree and weighted '
   'out-degree per supplier, suppliers per material, the single-sourced count and the multi-source rate, '
   'over inbound_logistics.')
ON CONFLICT (kind) DO UPDATE
  SET input_scope = EXCLUDED.input_scope, fallback_scope = EXCLUDED.fallback_scope,
      fallback_rule = EXCLUDED.fallback_rule, description = EXCLUDED.description;

-- The features of one project's sourcing network as it is now. Pure: reads the
-- tier-2 lanes and returns the analysis results array `analysis_complete_run`
-- stores. Weighted out-degree is weekly volume (`rate_to_weekly`, identity for
-- promoted rows — I3). Internal: reached only through `surrogate_feature_spec`.
CREATE OR REPLACE FUNCTION public._feature_spec_compute(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lanes AS (
    SELECT supplier_id, material_id,
           sum(COALESCE(public.rate_to_weekly(volume, time_unit), 0)) AS weekly
      FROM public.inbound_logistics
     WHERE project_id = p_project_id
       AND NULLIF(btrim(supplier_id), '') IS NOT NULL
       AND NULLIF(btrim(material_id), '') IS NOT NULL
     GROUP BY supplier_id, material_id
  ),
  sup AS (SELECT supplier_id, count(*) AS out_degree, sum(weekly) AS weighted FROM lanes GROUP BY supplier_id),
  mat AS (SELECT material_id, count(*) AS suppliers FROM lanes GROUP BY material_id)
  SELECT jsonb_build_array(jsonb_build_object(
           'entity_type', 'graph', 'entity_id', 'summary',
           'metrics', jsonb_build_object(
             'feature_spec_version', 1,
             'suppliers', (SELECT count(*) FROM sup),
             'materials_sourced', (SELECT count(*) FROM mat),
             'edges', (SELECT count(*) FROM lanes),
             'mean_out_degree', (SELECT round(avg(out_degree), 6) FROM sup),
             'max_out_degree', (SELECT max(out_degree) FROM sup),
             'mean_weighted_out_degree', (SELECT round(avg(weighted), 6) FROM sup),
             'single_sourced_count', (SELECT count(*) FROM mat WHERE suppliers = 1),
             'multi_source_rate', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                               ELSE round(count(*) FILTER (WHERE suppliers > 1)::numeric / count(*), 6) END
                                     FROM mat))))
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('entity_type', 'supplier', 'entity_id', supplier_id,
                      'metrics', jsonb_build_object('out_degree', out_degree, 'weighted_out_degree', round(weighted, 6)))
                      ORDER BY supplier_id) FROM sup), '[]'::jsonb)
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('entity_type', 'material', 'entity_id', material_id,
                      'metrics', jsonb_build_object('suppliers', suppliers, 'single_sourced', suppliers = 1))
                      ORDER BY material_id) FROM mat), '[]'::jsonb)
$$;
REVOKE ALL ON FUNCTION public._feature_spec_compute(uuid) FROM PUBLIC, anon, authenticated;

-- The one door: get the stored features of the current graph, computing them
-- only when no succeeded run holds them for this product-level hash. The actor
-- is attributed by the store's own functions (`assert_writer_may_act`).
CREATE OR REPLACE FUNCTION public.surrogate_feature_spec(p_project_id uuid, _actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_start   jsonb;
  v_run     uuid;
  v_results jsonb;
  v_summary jsonb;
BEGIN
  v_start := public.analysis_get_or_start(p_project_id, 'feature_spec',
               '{"feature_spec_version": 1}'::jsonb, 'feature_spec-1', _actor_user_id);
  v_run := (v_start ->> 'run_id')::uuid;
  IF NOT COALESCE((v_start ->> 'cache_hit')::boolean, false) THEN
    IF COALESCE((v_start ->> 'claimed_by_other')::boolean, false) THEN
      -- Another caller is computing this graph's features right now: say so,
      -- rather than computing them a second time.
      RETURN v_start || jsonb_build_object('features', NULL);
    END IF;
    v_results := public._feature_spec_compute(p_project_id);
    PERFORM public.analysis_complete_run(v_run, v_results,
      jsonb_build_object('results', jsonb_array_length(v_results)), '[]'::jsonb, _actor_user_id);
  END IF;
  SELECT metrics INTO v_summary FROM public.analysis_results
   WHERE run_id = v_run AND entity_type = 'graph' AND entity_id = 'summary';
  RETURN v_start || jsonb_build_object(
    'graph_version_no', (SELECT dv.version_no FROM public.analysis_runs ar
                           JOIN public.dataset_versions dv ON dv.id = ar.dataset_version_id
                          WHERE ar.id = v_run),
    'features', v_summary);
END;
$fn$;
REVOKE ALL ON FUNCTION public.surrogate_feature_spec(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surrogate_feature_spec(uuid, uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
