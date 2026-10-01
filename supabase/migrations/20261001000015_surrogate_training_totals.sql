-- ============================================================================
-- Phase 10 / WP 10.9 · §4 D254 · blueprint §11.2–§11.4
-- THE TRAINING SET'S SIZE, COUNTED ONCE.
--
-- The after-merge reading of WP 10.7–10.9a (§15 run 36863326325, probe 16) found
-- one project whose training set is ONE run with ONE replication — the evidence
-- run three versions of one Validated Model share. `surrogate_training_runs` is
-- right to list it under each model (a model's lineage is its own), and
-- `surrogate_training_summary` is right per model; but the Lab's Surrogate card
-- SUMMED the per-model groups and would have said "3 replications · 3 runs" of a
-- set that holds one of each (T1).
--
-- `surrogate_training_totals` is the size of the set as a set: distinct runs,
-- distinct (run, replication) pairs, models and graph versions. The card reads
-- it; the per-model summary stays for whatever trains per model.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.surrogate_training_totals(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'runs', count(DISTINCT run_id),
           'replications', count(DISTINCT (run_id, rep_index)),
           'models', count(DISTINCT validated_model_id),
           'graph_versions', count(DISTINCT graph_version_id))
    FROM public.surrogate_training_runs
   WHERE project_id = p_project_id
$$;
GRANT EXECUTE ON FUNCTION public.surrogate_training_totals(uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
