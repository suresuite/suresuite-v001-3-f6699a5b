-- ============================================================================
-- Phase 11 / WP 11.4 · blueprint §11.4 · G12 · §4 D261, D262
-- LINEAGE: KPIs BY THE WORLD THEY CAME FROM, FEATURES BY THEIRS.
--
-- The training set grouped KPIs by the run's COMPOSITE snapshot, so two snapshots
-- that differ only in the deep tier — which the engine does not read — split one
-- simulation world into two groups, and the Surrogate card's "graph versions" grew
-- with every deep-tier upload (D262). And `surrogate_feature_spec`, keyed on the
-- PRODUCT level, printed the composite's number beside its features (D261).
--
--   1. A run row learns its simulation scope from its snapshot even when its writer
--      did not state it. `create_simulation_run` states it (WP 11.2); a run inserted
--      any other way — a fixture, D252's direct insert — did not, and would fall out
--      of a grouping by simulation version. `_simulation_run_derive` (the BEFORE
--      trigger that already names a run's class and engine) now names its inputs too:
--      a derivation inside somebody else's statement names WHAT and decides nothing.
--   2. `surrogate_training_runs` exposes `simulation_version_id`, its number and
--      `hash_simulation` — the KPIs' world — appended, so every existing column keeps
--      its place; the composite `graph_version_id` stays for lineage.
--   3. `surrogate_training_summary` groups by Validated Model and SIMULATION version,
--      and counts the composites within; `surrogate_training_totals` counts
--      `simulation_versions` beside `graph_versions`.
--   4. `surrogate_feature_spec` returns the PRODUCT level's version — the features'
--      world — through WP 11.2's `level_version_id`, and the snapshot's number under
--      its own name, `snapshot_version_no`.
--
-- The join key between the two is the run's snapshot: its tuple names both the
-- simulation version (the KPIs) and the product version (the features) — blueprint
-- §11.4's Phase 11 note.
-- ============================================================================

-- ── 1 · a run names its inputs whoever wrote it ──────────────────────────

CREATE OR REPLACE FUNCTION public._simulation_run_derive()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.exploratory := COALESCE(NEW.exploratory, NEW.model_validation_id IS NULL);
    -- WP 11.4 · the simulation scope the run's snapshot carries, when the writer
    -- stated none (`create_simulation_run` always does).
    IF NEW.hash_simulation IS NULL AND NEW.dataset_version_id IS NOT NULL THEN
      SELECT dv.hash_inputs, dv.simulation_version_id
        INTO NEW.hash_simulation, NEW.simulation_version_id
        FROM public.dataset_versions dv
       WHERE dv.id = NEW.dataset_version_id;
    END IF;
  END IF;
  IF NEW.engine_id IS NULL AND COALESCE(NEW.code_version, '') <> '' THEN
    NEW.engine_id := public._engine_for_code_version(NEW.code_version);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2 · a level version's NUMBER, for a reader who cannot read the level table ──
--
-- The training view runs as its caller, and `graph_level_versions` admits a reader
-- through `has_project_access`, which refuses the browser's unidentified `anon` (D28).
-- A number is not data a level row withholds — `dataset_version_tuple` serves the
-- same — so it is read here, by id. Not `_`-prefixed: an invoker view calls it as the
-- API role, and D248's class rule keeps `_` helpers from the API roles.
CREATE OR REPLACE FUNCTION public.graph_level_version_no(p_level_version_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT version_no FROM public.graph_level_versions WHERE id = p_level_version_id; $$;
GRANT EXECUTE ON FUNCTION public.graph_level_version_no(uuid) TO anon, authenticated, service_role;

-- ── 3 · the training set, with the KPIs' world ───────────────────────────

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
  rr.kpis,
  -- WP 11.4 · the world the KPIs came from: the run's simulation scope, else its
  -- snapshot's (a row older than the derivation above).
  COALESCE(r.simulation_version_id, dv.simulation_version_id) AS simulation_version_id,
  public.graph_level_version_no(COALESCE(r.simulation_version_id, dv.simulation_version_id))
                               AS simulation_version_no,
  COALESCE(r.hash_simulation, dv.hash_inputs) AS hash_simulation
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
  'WP 10.8 · §4 D249; WP 11.4 · §4 D262. One row per replication of a run that may train a '
  'surrogate: done, following a validated non-revoked model (by model_validation_id, or as that '
  'model''s evidence run), not exploratory, faithful to the protocol, gate not skipped. Its KPIs '
  'came from `simulation_version_id` (the inputs the engine read); `graph_version_id` is the '
  'composite snapshot, kept for lineage. Runs as its caller.';

GRANT SELECT ON public.surrogate_training_runs TO anon, authenticated, service_role;

-- Grouped as a surrogate reads it: per Validated Model and SIMULATION version — two
-- snapshots that differ only in the deep tier are one group — with the composites
-- inside it counted, not grouped on.
CREATE OR REPLACE FUNCTION public.surrogate_training_summary(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(g ORDER BY g.model_name, g.model_version_no, g.simulation_version_no), '[]'::jsonb)
    FROM (
      SELECT validated_model_id, model_name, model_version_no, simulation_version_id, simulation_version_no,
             count(DISTINCT run_id) AS runs, count(*) AS replications,
             count(DISTINCT graph_version_id) AS graph_versions,
             bool_or(is_evidence_run) AS includes_evidence_run
        FROM public.surrogate_training_runs
       WHERE project_id = p_project_id
       GROUP BY validated_model_id, model_name, model_version_no, simulation_version_id, simulation_version_no
    ) g
$$;
GRANT EXECUTE ON FUNCTION public.surrogate_training_summary(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.surrogate_training_totals(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'runs', count(DISTINCT run_id),
           'replications', count(DISTINCT (run_id, rep_index)),
           'models', count(DISTINCT validated_model_id),
           'simulation_versions', count(DISTINCT simulation_version_id),
           'graph_versions', count(DISTINCT graph_version_id))
    FROM public.surrogate_training_runs
   WHERE project_id = p_project_id
$$;
GRANT EXECUTE ON FUNCTION public.surrogate_training_totals(uuid) TO anon, authenticated, service_role;

-- ── 4 · the features name THEIR world (D261) ────────────────────────────

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
      RETURN v_start || jsonb_build_object('features', NULL);
    END IF;
    v_results := public._feature_spec_compute(p_project_id);
    PERFORM public.analysis_complete_run(v_run, v_results,
      jsonb_build_object('results', jsonb_array_length(v_results)), '[]'::jsonb, _actor_user_id);
  END IF;
  SELECT metrics INTO v_summary FROM public.analysis_results
   WHERE run_id = v_run AND entity_type = 'graph' AND entity_id = 'summary';
  RETURN v_start || jsonb_build_object(
    -- WP 11.4 · §4 D261 — the PRODUCT level's version, which the features are keyed
    -- on; the composite snapshot's number under its own name.
    'level_version_id', (SELECT ar.level_version_id FROM public.analysis_runs ar WHERE ar.id = v_run),
    'product_version_no', (SELECT g.version_no FROM public.analysis_runs ar
                             JOIN public.graph_level_versions g ON g.id = ar.level_version_id
                            WHERE ar.id = v_run),
    'snapshot_version_no', (SELECT dv.version_no FROM public.analysis_runs ar
                              JOIN public.dataset_versions dv ON dv.id = ar.dataset_version_id
                             WHERE ar.id = v_run),
    'features', v_summary);
END;
$fn$;
REVOKE ALL ON FUNCTION public.surrogate_feature_spec(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surrogate_feature_spec(uuid, uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
