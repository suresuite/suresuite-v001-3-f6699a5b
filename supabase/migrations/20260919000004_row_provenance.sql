-- Phase 6 / WP 6.3 / §5.4 — the acceptance test's missing half
--
-- §5.4's acceptance test for the WHOLE transparency standard:
--
--     "Hand a stakeholder a number from the Supplier grid and a laptop. With no
--      help and no app access beyond the export, they trace it to a row in a named
--      file uploaded by a named person on a named date — or find the named rule
--      that produced it in the absence of data."
--
-- A2's popover answers it INSIDE the app. A4's workbook answers the second half
-- outside it — the substitution rules are in the dataset export. The first half was
-- not answerable from the export at all, and §5.4 says why in A4's own note: *"the
-- dataset workbook starts at Tier 2 — it proves what the engine ran on, not where
-- those rows came from."*
--
-- WHY THE SNAPSHOT CANNOT CARRY IT, WHICH IS THE WHOLE REASON THIS FUNCTION EXISTS.
--
-- The obvious fix is to put `ingest_run_id` into `_build_dataset_snapshot_v2` so the
-- workbook already has it. That would be wrong: `graph_hash` hashes the snapshot, so
-- a re-upload that changed no VALUE would move the hash because the run id changed,
-- and every run stamped with the old hash would read as describing a different
-- dataset. The anchor is over values on purpose (§4 D67, D88). Provenance therefore
-- travels BESIDE the snapshot, never inside it.
--
-- WHICH MAKES THE TIMING A DECLARED LIMIT RATHER THAN A HIDDEN ONE. This function
-- reads LIVE, so a row re-promoted after the dataset version was frozen reports the
-- NEWER file. That is a real gap and it cannot be closed by reading harder — the old
-- staged row is still there, but nothing records which run a frozen snapshot's row
-- came from. So the function returns `promoted_at` for every row and the export
-- states the dataset version's own timestamp beside it, leaving a reader able to SEE
-- the disagreement instead of being told a filename that is subtly wrong.
--
-- THE NATURAL KEY IS READ FROM `pg_index`, NOT RESTATED. `ingest_target_natural_key`
-- already answers "which columns identify a row in this table" for the promotion, and
-- the export needs the same answer so a reader can match a workbook row to a
-- provenance row. A second list here would be `single-source` (I1) broken, and it is
-- the same reason `ingest_apply_run` reads its arbiter rather than guessing.

CREATE OR REPLACE FUNCTION public.ingest_row_provenance(
  p_project_id   uuid,
  p_user_id      uuid,
  p_target_table text
) RETURNS TABLE (
  natural_key        jsonb,
  has_provenance     boolean,
  source_row_number  integer,
  original_filename  text,
  content_sha256     text,
  uploaded_by_email  text,
  received_at        timestamptz,
  promoted_by_email  text,
  promoted_at        timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_key  text[];
  v_expr text;
  v_sql  text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_row_provenance: this read must name its reader'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF NOT public.ingest_target_is_promotable(p_target_table) THEN
    RAISE EXCEPTION 'ingest_row_provenance: % is not a landable tier-2 table', p_target_table
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- LOCAL, so it belongs to this transaction and cannot leak onto the next caller
  -- of a pooled connection; and it is what makes `has_project_access` answer for
  -- the named reader rather than for whoever the connection last belonged to.
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
  IF NOT public.has_project_access(p_project_id) THEN
    RAISE EXCEPTION 'ingest_row_provenance: % cannot read project %', p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_key := public.ingest_target_natural_key(p_target_table);

  -- `jsonb_build_object('col', t.col, …)` over the key columns, quoted with %I so
  -- a column needing a quoted spelling cannot break the statement (§4 D99's class).
  SELECT string_agg(format('%L, t.%I', c, c), ', ' ORDER BY ord)
    INTO v_expr
    FROM unnest(v_key) WITH ORDINALITY AS k(c, ord);

  v_sql := format($q$
    SELECT jsonb_build_object(%s),
           (t.source_row_id IS NOT NULL),
           s.source_row_number,
           f.original_filename,
           f.content_sha256,
           up.email,
           f.received_at,
           ap.email,
           r.applied_at
      FROM public.%I t
      -- LEFT JOINs throughout: a row with no provenance must appear with NULLs and
      -- `has_provenance = false`, because the export's job is to list every row and
      -- say which ones cannot be traced. An inner join would silently drop them and
      -- the sheet would read as complete.
      LEFT JOIN public.ingest_staged_rows s ON s.id = t.source_row_id
      LEFT JOIN public.ingest_runs r        ON r.id = s.ingest_run_id
      LEFT JOIN public.ingest_files f       ON f.ingest_run_id = r.id
      LEFT JOIN public.approved_users up    ON up.id = f.uploaded_by
      LEFT JOIN public.approved_users ap    ON ap.id = r.applied_by_user_id
     WHERE t.project_id = $1
     ORDER BY 1
  $q$, v_expr, p_target_table);

  RETURN QUERY EXECUTE v_sql USING p_project_id;
END; $fn$;

COMMENT ON FUNCTION public.ingest_row_provenance(uuid, uuid, text) IS
  '§5.4''s acceptance test, export side (WP 6.3): one row per tier-2 row of a '
  'landable table — its natural key (read from pg_index, never restated), the file '
  'and line it came from, who uploaded and who promoted it. Every row appears, '
  'including those with `has_provenance = false`, because the sheet''s job is to say '
  'which rows CANNOT be traced. Read LIVE and therefore newer than a frozen '
  'snapshot: `promoted_at` is returned so a reader can see the disagreement rather '
  'than be told a filename that is subtly wrong.';

REVOKE ALL ON FUNCTION public.ingest_row_provenance(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_row_provenance(uuid, uuid, text)
  TO anon, authenticated, service_role;
