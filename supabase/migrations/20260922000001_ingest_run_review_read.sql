-- Phase 6 / WP 6.5a / §4 D169 — the review screen reads its run through the reader
-- it names, because under this application's identity model it cannot read it at all.
--
-- FOUND BY THE FIRST PRODUCTION UPLOAD. `ingest-file` went live on 2026-09-22 and the
-- landing worked: §15 run `35783395994` reads 2 runs, 2 files and 4 staged rows in
-- the project a user uploaded into. What the user saw was NOTHING — no review screen,
-- so no diff to read and no button to promote. `useIngestRun` reads `ingest_runs`,
-- `ingest_files` and `ingest_staged_rows` straight through PostgREST, and all three
-- carry one policy, `FOR ALL TO authenticated`, routed through `has_project_access`
-- (`20260916000012`–`14`). This application does not use Supabase Auth: the browser
-- calls as `anon` (D28, and D155's stage 1b is inert until its secret is set), so
-- RLS answered zero rows, `maybeSingle()` returned null without an error, and
-- `IngestRunPanel` rendered `null`. A run nobody can see is a run nobody can promote,
-- so every upload since the switch has stopped at tier 1.
--
-- WHY NOT WIDEN THE POLICIES TO `anon`. It would not work and it would be wrong.
-- `has_project_access` resolves the reader through `get_current_user_id()`, and an
-- anonymous PostgREST request carries no session, no GUC and no email claim, so the
-- predicate answers false for every row — widening the role changes nothing. And the
-- only way to make it answer would be to trust a header the browser sets, which is
-- D28's client assertion moved into RLS, where it would govern every reader.
--
-- WHAT THIS DOES INSTEAD is `ingest_value_chain`'s shape (`20260919000003`), the
-- precedent for exactly this situation: the reader arrives as a parameter, the GUC is
-- set LOCAL to this transaction, `has_project_access` is asked about THAT reader, and
-- the answer is refused rather than emptied. Read-only, one row of jsonb, and the
-- three tables' own policies are left exactly as they are.
--
-- `has_project_access` and NOT `min_project_role`, for the reason the value chain
-- gives: §4 D66 measured the two disagreeing in both directions, and the review
-- screen must show a run to everyone the grid would show that project to. Whether
-- the reader may PROMOTE is not this function's question — `ingest_apply_run`
-- answers it, and `ingest_diff_run` returns that answer with the counts.

CREATE OR REPLACE FUNCTION public.ingest_run_review(
  p_user_id uuid,
  p_run_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_project uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_run_review: this read must name its reader'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCAL, so it cannot outlive this transaction on a pooled connection, and so
  -- `has_project_access` answers for the named reader.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  SELECT r.project_id INTO v_project FROM public.ingest_runs r WHERE r.id = p_run_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'ingest_run_review: no run %', p_run_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.has_project_access(v_project) THEN
    RAISE EXCEPTION 'ingest_run_review: % cannot read project %', p_user_id, v_project
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'run',  (SELECT to_jsonb(r) FROM public.ingest_runs r WHERE r.id = p_run_id),
    -- A run lands at most one file; a connector run lands none, and `null` says so.
    'file', (SELECT to_jsonb(f) FROM public.ingest_files f WHERE f.ingest_run_id = p_run_id),
    'rows', COALESCE(
              (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source_row_number)
                 FROM public.ingest_staged_rows s WHERE s.ingest_run_id = p_run_id),
              '[]'::jsonb)
  );
END; $fn$;

COMMENT ON FUNCTION public.ingest_run_review(uuid, uuid) IS
  'WP 6.5a / D169 — the review screen''s read of ONE ingestion run: the run, its '
  'file manifest and its staged rows as one jsonb object. The reader arrives as a '
  'parameter and is authorized by has_project_access, because the browser calls as '
  'anon and the three tables'' RLS (TO authenticated) returns it nothing. Read-only; '
  'refuses an unknown run (no_data_found) and a reader without access '
  '(insufficient_privilege) rather than returning an empty review.';

REVOKE ALL ON FUNCTION public.ingest_run_review(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_run_review(uuid, uuid)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
