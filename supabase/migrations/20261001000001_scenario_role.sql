-- WP 9.4 slice 4 · §4 D227 — the validated baseline gets an identity.
--
-- Run & Validate (/policies) runs its validation into ONE scenario per project and
-- found it with `name = 'Policy validation (auto)'`. The Lab listed that row as an
-- ordinary scenario: renamable (which orphaned it — the next validation created a
-- second one), deletable, and editable, with every edit silently overwritten by the
-- next validation run. A display name was a join key, which is the thing
-- `uuid-identity` exists to refuse.
--
-- `role` says what a scenario is FOR. Two values, deliberately:
--   · `experiment`          — a what-if a person set up in the Lab (the default)
--   · `validation_baseline` — the scenario Run & Validate owns; at most one per project
-- The door a scenario came through is a different fact and stays where it is
-- (`from_network`); a third value for it would author that fact twice.
--
-- No SECURITY DEFINER function: Run & Validate selects by role and inserts with it,
-- through the same RLS path every scenario write takes, and the partial unique index
-- is what makes "one per project" structural. A second insert fails 23505 and the
-- caller re-selects.

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'experiment';

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scenarios_role_check' AND conrelid = 'public.scenarios'::regclass
  ) THEN
    ALTER TABLE public.scenarios
      ADD CONSTRAINT scenarios_role_check CHECK (role IN ('experiment', 'validation_baseline'));
  END IF;
END
$role$;

COMMENT ON COLUMN public.scenarios.role IS
  'What the scenario is for: experiment (a Lab what-if) or validation_baseline (the one '
  'scenario per project that Run & Validate owns). WP 9.4, §4 D227.';

-- Assign the baseline for every project that has none, idempotently. Kept as a
-- function (SECURITY INVOKER, not granted to the API roles) so the rule is written
-- once and `supabase/rehearsal/530` can execute the same rule the migration did.
--
-- Candidates are the scenarios Run & Validate could have written: the one named
-- 'Policy validation (auto)', or any scenario that owns an active card's evidence
-- run. Among them, in order: the one an ACTIVE card's evidence run belongs to (that
-- is the scenario a validation certifies), then the one with the newest run, then
-- the oldest. Every other candidate stays an experiment — a renamed duplicate is
-- still a scenario somebody may want, and deleting rows is not a backfill's call.
CREATE OR REPLACE FUNCTION public.scenarios_assign_validation_baseline(p_project_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  WITH evidence AS (
    SELECT DISTINCT r.scenario_id
      FROM public.model_validations mv
      JOIN public.simulation_runs r ON r.id = mv.evidence_run_id
     WHERE mv.status = 'active'
  ),
  candidates AS (
    SELECT s.id, s.project_id, s.created_at,
           (s.id IN (SELECT scenario_id FROM evidence)) AS has_evidence,
           (SELECT max(r.created_at) FROM public.simulation_runs r WHERE r.scenario_id = s.id) AS last_run
      FROM public.scenarios s
     WHERE (p_project_id IS NULL OR s.project_id = p_project_id)
       AND (s.name = 'Policy validation (auto)' OR s.id IN (SELECT scenario_id FROM evidence))
       AND NOT EXISTS (
             SELECT 1 FROM public.scenarios b
              WHERE b.project_id = s.project_id AND b.role = 'validation_baseline'
           )
  ),
  ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY project_id
             ORDER BY has_evidence DESC, last_run DESC NULLS LAST, created_at ASC, id ASC
           ) AS rk
      FROM candidates
  )
  UPDATE public.scenarios s
     SET role = 'validation_baseline'
    FROM ranked
   WHERE ranked.id = s.id AND ranked.rk = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.scenarios_assign_validation_baseline(uuid) FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.scenarios_assign_validation_baseline(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.scenarios_assign_validation_baseline(uuid) FROM authenticated;
  END IF;
END
$grants$;

SELECT public.scenarios_assign_validation_baseline(NULL);

CREATE UNIQUE INDEX IF NOT EXISTS scenarios_one_validation_baseline
  ON public.scenarios (project_id)
  WHERE role = 'validation_baseline';
