-- Phase 6 / WP 6.3 / §5.4 A2 — the value chain, as ONE read
--
-- A2 answers "where did THIS number come from?" and §5.4 lists the steps it must
-- name: source file → row → uploader → approver → unit → engine transform →
-- substitutions → freshness → what would change it. Four of those already existed
-- in the database with NO READER. `ingest_files` holds the filename, the bytes'
-- SHA-256 and the uploader; `ingest_staged_rows` holds the physical line, the
-- cells AS RECEIVED (`raw`, keyed by the header the file carried) and what
-- validation made of them (`parsed`, keyed by tier-2 column name); `ingest_runs`
-- holds the promoter and the moment of promotion. Every tier-2 row written through
-- the landing path carries `ingest_run_id` + `source_row_id` to reach them, and
-- until now nothing did.
--
-- IT TAKES THE STAGED ROW, NOT A TABLE NAME AND A ROW ID.
--
-- The first draft took `(target_table, row_id)` and looked the row up with dynamic
-- SQL. That is wrong twice. It cannot serve `customers` at all — that table has no
-- surrogate `id`, only its natural key (§4 D5's `NULLS NOT DISTINCT` indexes), so a
-- function keyed on `id` would answer for nine of the ten landable datasets and
-- raise 42703 on the tenth. And it would be a generic row reader behind a
-- `SECURITY DEFINER` grant, which is a surface nobody asked for. The client
-- already HAS `source_row_id`: the lane reads select `*`, so the grid row carries
-- it. So this function expands a staged-row id into its chain — no dynamic SQL, no
-- table-name parameter, and it works for every table equally.
--
-- WHAT IT DOES NOT DO, AND WHY THAT IS THE DESIGN.
--
-- It does not map a tier-2 COLUMN to the CSV HEADER it came from. That mapping is
-- authored once, in `supabase/contract/*.contract.yaml`, and published to the
-- client as `_shared/ingestSpec.generated.ts`, which the wizard already imports.
-- Restating it here would make a second copy of a fact the contract owns —
-- `single-source` (I1), and exactly the shape of §4 D101. So `raw` and `parsed`
-- come back WHOLE and the caller picks the header out of the spec.
--
-- IT RETURNS EXACTLY ONE ROW, ALWAYS.
--
-- Including for a row with NO provenance, where it answers `has_provenance =
-- false` with every lineage field NULL. Zero rows would be indistinguishable from
-- a failed load, and 8 577 rows in this database predate the landing path (§4
-- D88): their provenance is UNKNOWN, which is a different statement from "there
-- was none" and must not be told as a blank. In that mode the caller passes the
-- project and the target table instead of a staged row, and still gets the
-- freshness half — "this row's provenance is unknown AND two later uploads of this
-- dataset exist" is a useful sentence; "unknown" alone is not.
--
-- AUTHORIZATION. The app authenticates against `approved_users`, not Supabase
-- Auth, so the reader arrives as a parameter and the GUC is set LOCAL to this
-- transaction before `has_project_access` is consulted — the `assert_writer_may_act`
-- preamble minus its write half. The predicate is `has_project_access` and NOT
-- `min_project_role`: §4 D66 measured the two against a real database and they
-- disagree in BOTH directions, so swapping them here would silently deny an
-- organization admin the provenance of a row they can already see on the grid.

CREATE OR REPLACE FUNCTION public.ingest_value_chain(
  p_user_id       uuid,
  p_source_row_id uuid DEFAULT NULL,
  p_project_id    uuid DEFAULT NULL,
  p_target_table  text DEFAULT NULL
) RETURNS TABLE (
  has_provenance      boolean,
  project_id          uuid,
  target_table        text,
  source_kind         text,
  original_filename   text,
  content_sha256      text,
  byte_size           bigint,
  source_row_number   integer,
  raw                 jsonb,
  parsed              jsonb,
  findings            jsonb,
  diff_state          text,
  uploaded_by_name    text,
  uploaded_by_email   text,
  received_at         timestamptz,
  promoted_by_name    text,
  promoted_by_email   text,
  promoted_at         timestamptz,
  run_status          text,
  later_uploads       integer,
  latest_upload_at    timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_project uuid;
  v_target  text;
  v_applied timestamptz;
  v_run     uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_value_chain: this read must name its reader'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCAL — `true` — so it belongs to THIS transaction and cannot leak onto the
  -- next caller of a pooled connection. It is also what makes
  -- `has_project_access` answer for the named reader.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  IF p_source_row_id IS NOT NULL THEN
    SELECT r.project_id, s.target_table, r.applied_at, r.id
      INTO v_project, v_target, v_applied, v_run
      FROM public.ingest_staged_rows s
      JOIN public.ingest_runs r ON r.id = s.ingest_run_id
     WHERE s.id = p_source_row_id;
    IF v_project IS NULL THEN
      RAISE EXCEPTION 'ingest_value_chain: no staged row %', p_source_row_id
        USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    IF p_project_id IS NULL OR p_target_table IS NULL THEN
      RAISE EXCEPTION 'ingest_value_chain: with no staged row, name the project and the target table'
        USING ERRCODE = 'null_value_not_allowed';
    END IF;
    -- Only this mode takes a table NAME from the caller, and it is checked
    -- against the set the promotion knows, so the parameter cannot name anything
    -- outside the landing path.
    IF NOT public.ingest_target_is_promotable(p_target_table) THEN
      RAISE EXCEPTION 'ingest_value_chain: % is not a landable tier-2 table', p_target_table
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_project := p_project_id;
    v_target  := p_target_table;
  END IF;

  IF NOT public.has_project_access(v_project) THEN
    RAISE EXCEPTION 'ingest_value_chain: % cannot read project %', p_user_id, v_project
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    (p_source_row_id IS NOT NULL),
    v_project,
    v_target,
    f.source_kind,
    f.original_filename,
    f.content_sha256,
    f.byte_size,
    s.source_row_number,
    s.raw,
    s.parsed,
    s.findings,
    s.diff_state,
    up.display_name,
    up.email,
    f.received_at,
    ap.display_name,
    ap.email,
    r.applied_at,
    r.status,
    -- FRESHNESS AS A COUNT, NOT A BOOLEAN. "Two later uploads of this dataset
    -- exist" is actionable where "stale" is not, and D70's rule is that an
    -- unknown must not be rendered as a known: with no provenance there is no
    -- `applied_at` to compare against, so EVERY applied run counts as later and
    -- the caller is told the provenance is unknown in the same breath.
    --
    -- `>=` WITH THE ROW'S OWN RUN EXCLUDED, NOT `>`, AND A REHEARSAL IS WHY.
    -- `applied_at` defaults to `now()`, which is TRANSACTION start time, so two
    -- promotions in one transaction carry the SAME timestamp and `>` counted
    -- neither as later than the other — `rehearsal/260` §4 failed on exactly
    -- that. Timestamp ties are therefore counted as later, deliberately: the
    -- error it admits is over-reporting a stale cell by the number of runs
    -- sharing an instant, and under-reporting staleness is the direction that
    -- misleads a reader about their own data.
    (SELECT count(*)::integer FROM public.ingest_runs r2
      WHERE r2.project_id = v_project
        AND r2.applied_at IS NOT NULL
        AND (v_applied IS NULL OR (r2.applied_at >= v_applied AND r2.id IS DISTINCT FROM v_run))
        AND EXISTS (SELECT 1 FROM public.ingest_staged_rows s2
                     WHERE s2.ingest_run_id = r2.id AND s2.target_table = v_target)),
    (SELECT max(r2.applied_at) FROM public.ingest_runs r2
      WHERE r2.project_id = v_project
        AND r2.applied_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.ingest_staged_rows s2
                     WHERE s2.ingest_run_id = r2.id AND s2.target_table = v_target))
  -- LEFT JOIN from a one-row anchor so the no-provenance mode still returns its
  -- single row: an inner join on `ingest_staged_rows` would return NOTHING there,
  -- which is the failure this function's contract exists to rule out.
  FROM (SELECT 1) anchor
  LEFT JOIN public.ingest_staged_rows s ON s.id = p_source_row_id
  LEFT JOIN public.ingest_runs r ON r.id = s.ingest_run_id
  -- The file is reached through the RUN, not through the staged row: a run lands
  -- one file and the rows belong to the run, so there is one join key and no
  -- second copy of it — the reason `ingest_files` carries no `project_id`.
  LEFT JOIN public.ingest_files f ON f.ingest_run_id = r.id
  LEFT JOIN public.approved_users up ON up.id = f.uploaded_by
  LEFT JOIN public.approved_users ap ON ap.id = r.applied_by_user_id;
END; $fn$;

COMMENT ON FUNCTION public.ingest_value_chain(uuid, uuid, uuid, text) IS
  '§5.4 A2 — the value chain for ONE tier-2 row, expanded from its `source_row_id`: '
  'file, bytes hash, physical line, cells as received, uploader, promoter, and how '
  'many later uploads of the same dataset exist. Returns exactly one row always; '
  '`has_provenance = false` means the provenance is UNKNOWN (the row predates the '
  'landing path), never that there was none. Does NOT map column to CSV header — '
  'that is authored in the contract and read by the caller from the generated spec (I1).';

REVOKE ALL ON FUNCTION public.ingest_value_chain(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_value_chain(uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
