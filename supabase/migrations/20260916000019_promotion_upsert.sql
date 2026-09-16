-- Phase 3 / WP 3.3 / §10 — THE PROMOTION BECOMES AN AUDITED UPSERT.
--
-- WP 3.2 left the seam ONE STATEMENT WIDE and said so: `ingest_apply_run`
-- promotes with a single dynamic `INSERT … SELECT` per target because there were
-- no natural keys to conflict on and units still normalized downstream. Both are
-- now false — `20260916000018` landed the keys — so that statement is REPLACED
-- here. There is no second promotion path beside it, and `supabase/rehearsal/070`
-- asserts WP 3.2's whole behaviour end to end, so an upsert that breaks any of it
-- fails before it merges.
--
-- THREE THINGS CHANGE IN THAT ONE STATEMENT, and nothing else in the function:
--
--   1. `ON CONFLICT (<natural key>) DO UPDATE` — uploading the same file twice
--      is a no-op instead of doubling the table (D5).
--   2. Units are converted INSIDE the statement, and the canonical unit is
--      written into the row (`normalize-at-promotion`, I3).
--   3. Every promoted row carries `ingest_run_id` and `source_row_id`, which is
--      A4 extended from the canonical row all the way down to the line of the
--      file it came from.
--
-- THE ACTOR IS STILL A PARAMETER. Nothing here reads the session GUC:
-- `ingest_apply_run` sets `app.current_user_id` LOCAL to its own transaction
-- before any tier-2 write, exactly as WP 3.2 built it, which is what makes the
-- audit trigger name the promoter rather than hope a pooled connection carried
-- the setting (D36). That code is untouched — this file replaces one statement.

-- ── 1 · provenance on tier 2 ────────────────────────────────────────────────
--
-- `ingest_run_id` is WP 3.1's word, chosen so that ONE column name covers the
-- whole path from a landed file to a canonical row; a synonym here would undo
-- that. Its target carries the project, the source kind and the approval, so a
-- tier-2 row that names a run names all three.
--
-- `source_row_id` points at the staged row, whose `source_row_number` is the
-- PHYSICAL LINE in the file (header = line 1). That is the difference between
-- "this came from an upload" and "this is line 47 of inbound.csv", which is the
-- thing a person can actually be shown.
--
-- BOTH ARE `ON DELETE SET NULL`, AND THAT IS NOT THE LAZY CHOICE. `rehearsal/070`
-- section 8 asserts that deleting a run deletes its tier-0 and tier-1 rows and
-- NONE of its tier-2 rows: a promoted row is the project's, not the run's.
-- CASCADE would delete a project's data when someone tidied up an old run. SET
-- NULL keeps the row and drops the trace, and a row whose provenance is NULL says
-- "the run that made me is gone", which is true and is better than a dangling id.

-- WRITTEN OUT PER TABLE RATHER THAN IN A LOOP, and that is not a style choice.
-- `introspect.mjs` replays DDL statically; a column added by `EXECUTE format(…)`
-- inside a `DO` block is invisible to it, so the artifact would not have these
-- columns, `contract:check` R1 would say the sidecars describe fields that are
-- not columns, and the generated page would not publish them. A migration that
-- the contract cannot read is a migration outside the contract.

ALTER TABLE public.inbound_logistics
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.inbound_logistics DROP CONSTRAINT IF EXISTS inbound_logistics_source_row_fk;
ALTER TABLE public.inbound_logistics
  ADD CONSTRAINT inbound_logistics_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.inbound_logistics.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.inbound_logistics.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

ALTER TABLE public.outbound_logistics
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.outbound_logistics DROP CONSTRAINT IF EXISTS outbound_logistics_source_row_fk;
ALTER TABLE public.outbound_logistics
  ADD CONSTRAINT outbound_logistics_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.outbound_logistics.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.outbound_logistics.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

ALTER TABLE public.bom_single_level
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.bom_single_level DROP CONSTRAINT IF EXISTS bom_single_level_source_row_fk;
ALTER TABLE public.bom_single_level
  ADD CONSTRAINT bom_single_level_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.bom_single_level.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.bom_single_level.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

ALTER TABLE public.bom_multi_level
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.bom_multi_level DROP CONSTRAINT IF EXISTS bom_multi_level_source_row_fk;
ALTER TABLE public.bom_multi_level
  ADD CONSTRAINT bom_multi_level_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.bom_multi_level.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.bom_multi_level.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

ALTER TABLE public.tier2_suppliers
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.tier2_suppliers DROP CONSTRAINT IF EXISTS tier2_suppliers_source_row_fk;
ALTER TABLE public.tier2_suppliers
  ADD CONSTRAINT tier2_suppliers_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.tier2_suppliers.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.tier2_suppliers.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

ALTER TABLE public.tier3_suppliers
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.tier3_suppliers DROP CONSTRAINT IF EXISTS tier3_suppliers_source_row_fk;
ALTER TABLE public.tier3_suppliers
  ADD CONSTRAINT tier3_suppliers_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.tier3_suppliers.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted — '
  'a null here means the provenance is unknown, never that there was none.';
COMMENT ON COLUMN public.tier3_suppliers.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

-- ── 2 · which conversions apply, per target ─────────────────────────────────
--
-- THIS LIST EXISTS TWICE AND THAT IS DELIBERATE, not an oversight. SQL cannot
-- import `ingestSpec.generated.ts`, and the promotion builds dynamic SQL, so the
-- conversions have to be expressible inside the migration. The repository already
-- has exactly one answer for that shape — `ingest_target_is_promotable()` carries
-- the promotable list and `ingestSpecParity.test.ts` fails if it drifts from the
-- generated one — so this reuses that arrangement rather than inventing a third
-- (blueprint §0: extend existing artifacts). The authored source is the SIDECAR:
-- `unit_column` names where the unit comes from and `normalize_at_promotion` says
-- which conversion and what the value is left in. The parity test reads both this
-- function and the generated module.
--
-- `rate` AND `duration` ARE NOT INVERSES, which is why the kind is stated rather
-- than inferred: a duration of 1 month is ~4.35 weeks, a rate of 1 per month is
-- ~0.23 per week. `20260915000001` already holds both conversions, generated from
-- `grading.ts::UNIT_DAYS` — the one unit table (I3, D10). Nothing new is computed
-- here; the promotion CALLS them.

CREATE OR REPLACE FUNCTION public.ingest_normalize_at_promotion(_target text)
RETURNS TABLE (column_name text, unit_column text, conversion text, canonical text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT n.column_name, n.unit_column, n.conversion, n.canonical FROM (VALUES
    ('inbound_logistics',  'lead_time', 'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'volume',    'time_unit',      'rate',     'week'),
    ('outbound_logistics', 'volume',    'time_unit',      'rate',     'week'),
    ('tier2_suppliers',    'volume',    'time_unit',      'rate',     'week'),
    ('tier3_suppliers',    'volume',    'time_unit',      'rate',     'week')
  ) AS n(target, column_name, unit_column, conversion, canonical)
  WHERE n.target = _target;
$$;

COMMENT ON FUNCTION public.ingest_normalize_at_promotion(text) IS
  'Phase 3 / WP 3.3 — the unit conversions ingest_apply_run applies as it '
  'promotes (invariant I3). Authored in the sidecars (`unit_column` + '
  '`normalize_at_promotion`); restated here because SQL cannot import the '
  'generated module, and pinned to it by ingestSpecParity.test.ts.';

-- ── 3 · the promotion ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ingest_apply_run(
  _run_id        uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run       public.ingest_runs%ROWTYPE;
  v_plant     text;
  v_target    text;
  v_key       text[];
  v_cols      text;
  v_vals      text;
  v_update    text;
  v_file_key  text;
  v_names     text[];
  v_server    text;
  v_server_v  text;
  v_keys      integer;
  v_known     integer;
  v_written   integer;
  v_upd       integer;
  v_supers    integer;
  v_total     integer := 0;
  v_updated   integer := 0;
  v_collapsed integer := 0;
  v_held      integer := 0;
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_apply_run: a promotion must name its actor (invariant audit-actor)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- FOR UPDATE, so two clicks on "apply" cannot both find the run `staged`.
  SELECT * INTO v_run FROM public.ingest_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingest_apply_run: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_run.status <> 'staged' THEN
    RAISE EXCEPTION 'ingest_apply_run: run % is %, not staged — a run is promoted once',
      _run_id, v_run.status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
  IF NOT public.has_project_access(v_run.project_id) THEN
    RAISE EXCEPTION 'ingest_apply_run: % has no access to project %', _actor_user_id, v_run.project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `project_id` and `plant_name` come from the PROJECT and never from the file
  -- — the contract says so for every lane column (`set from the selected project,
  -- never from the CSV`), and `ensure_dataset_plant_matches_project` refuses the
  -- row otherwise.
  SELECT plant_name INTO v_plant FROM public.projects WHERE id = v_run.project_id;

  FOR v_target IN
    SELECT DISTINCT target_table FROM public.ingest_staged_rows WHERE ingest_run_id = _run_id
  LOOP
    IF NOT public.ingest_target_is_promotable(v_target) THEN
      RAISE EXCEPTION 'ingest_apply_run: % is not a promotable target', v_target
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The arbiter is READ FROM THE DATABASE, not restated: the one unique,
    -- non-partial index that is not the surrogate key. It raises rather than
    -- guessing when there is no candidate or more than one, because a promotion
    -- that upserted on the wrong grain would produce rows that look right.
    v_key := public.ingest_target_natural_key(v_target);

    -- Which server-set columns this target HAS. The item masters have no
    -- `plant_name` (D55), so the list cannot be hard-coded the way WP 3.2's was
    -- without a second code path for them — and a second path is what §10
    -- forbids.
    SELECT string_agg(quote_ident(c), ', ' ORDER BY c),
           string_agg(CASE c WHEN 'project_id' THEN '$1' ELSE '$2' END, ', ' ORDER BY c)
      INTO v_server, v_server_v
      FROM unnest(ARRAY['project_id','plant_name']) AS c
     WHERE EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = format('public.%I', v_target)::regclass
                      AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);

    -- WHICH COLUMNS THE STATEMENT WRITES, and it is not simply "the keys the file
    -- carried". Three sources, unioned:
    --
    --   · the parsed keys that are real columns of the target;
    --   · plus the UNIT COLUMN of any normalized column present, even when the
    --     file omitted it. A file with no `time_unit` still produces a weekly
    --     volume (an absent unit means weekly — `20260915000001`'s own default),
    --     and a row holding a weekly number under a NULL unit is a number whose
    --     source a reader has to know rather than read. §5 T1 says there is no
    --     such option, so the canonical token is written either way.
    --
    -- `format_type` gives a cast the column will accept, so nothing guesses a
    -- type from a name.
    WITH parsed_keys AS (
      SELECT DISTINCT k AS key
        FROM public.ingest_staged_rows s, jsonb_object_keys(s.parsed) k
       WHERE s.ingest_run_id = _run_id
         AND s.target_table = v_target
         AND NOT (s.findings @> '[{"level": "error"}]'::jsonb)
    ),
    checked AS (
      SELECT pk.key, a.attname
        FROM parsed_keys pk
        LEFT JOIN pg_attribute a
               ON a.attrelid = format('public.%I', v_target)::regclass
              AND a.attname  = pk.key
              AND a.attnum   > 0
              AND NOT a.attisdropped
    ),
    -- the unit column of every normalized column the file actually carried
    unit_cols AS (
      SELECT DISTINCT n.unit_column AS attname
        FROM public.ingest_normalize_at_promotion(v_target) n
       WHERE n.column_name IN (SELECT attname FROM checked WHERE attname IS NOT NULL)
    ),
    writing AS (
      SELECT attname FROM checked WHERE attname IS NOT NULL
      UNION
      SELECT attname FROM unit_cols
    ),
    resolved AS (
      SELECT w.attname,
             format_type(a.atttypid, a.atttypmod) AS coltype,
             (SELECT n.canonical FROM public.ingest_normalize_at_promotion(v_target) n
               WHERE n.unit_column = w.attname LIMIT 1) AS as_canonical,
             (SELECT n.conversion FROM public.ingest_normalize_at_promotion(v_target) n
               WHERE n.column_name = w.attname LIMIT 1) AS conversion,
             (SELECT n.unit_column FROM public.ingest_normalize_at_promotion(v_target) n
               WHERE n.column_name = w.attname LIMIT 1) AS reads_unit_from
        FROM writing w
        JOIN pg_attribute a
          ON a.attrelid = format('public.%I', v_target)::regclass
         AND a.attname  = w.attname
    )
    SELECT (SELECT count(*) FROM checked),
           (SELECT count(attname) FROM checked),
           string_agg(quote_ident(attname), ', ' ORDER BY attname),
           -- THE VALUE EXPRESSION IS WHERE NORMALIZATION HAPPENS (I3). A column
           -- the contract calls a rate or a duration over another column's unit
           -- is converted HERE, by the one unit table's own functions; the unit
           -- column itself becomes the canonical token, so the tier-2 row STATES
           -- that it is weekly. The converters downstream (`combine-project`,
           -- `sc_nodes`) then multiply by 7/7 and are exactly identity — which is
           -- why this moves the normalization without moving any number (§16).
           string_agg(
             CASE
               WHEN as_canonical IS NOT NULL THEN format('%L::%s', as_canonical, coltype)
               WHEN conversion = 'rate' THEN
                 format('public.rate_to_weekly((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                        attname, reads_unit_from, coltype)
               WHEN conversion = 'duration' THEN
                 format('public.duration_to_weeks((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                        attname, reads_unit_from, coltype)
               ELSE format('(s.parsed ->> %L)::%s', attname, coltype)
             END, ', ' ORDER BY attname)
      , array_agg(attname ORDER BY attname)
      INTO v_keys, v_known, v_cols, v_vals, v_names
      FROM resolved;

    IF v_keys IS NULL OR v_keys = 0 THEN
      CONTINUE;  -- every row for this target was rejected
    END IF;
    IF v_known <> v_keys THEN
      RAISE EXCEPTION 'ingest_apply_run: staged rows for % name % column(s) that table does not have',
        v_target, v_keys - v_known USING ERRCODE = 'undefined_column';
    END IF;

    -- The arbiter's own columns, as they appear in the file. `project_id` and
    -- `plant_name` are constant within a run, so the partition below uses the
    -- rest — the part the uploader controls.
    SELECT string_agg(format('s.parsed ->> %L', c), ', ' ORDER BY c)
      INTO v_file_key
      FROM unnest(v_key) AS c
     WHERE c <> ALL (ARRAY['project_id', 'plant_name']);

    -- Everything that is not part of the arbiter is overwritten by the incoming
    -- row. A key column must NOT appear: `ON CONFLICT DO UPDATE` forbids
    -- assigning to the columns it matched on, and it would be meaningless anyway
    -- — they are equal by construction.
    -- Empty when every written column is part of the arbiter — a pure-key table,
    -- where the upsert has nothing to change but must still stamp the provenance.
    -- The trailing comma belongs to this fragment so the statement is valid
    -- either way; `DO UPDATE SET` always has the three provenance assignments.
    SELECT COALESCE(string_agg(format('%I = EXCLUDED.%I,', c, c), ' ' ORDER BY c), '')
      INTO v_update
      FROM unnest(v_names) AS c
     WHERE c <> ALL (v_key);

    -- ONE STATEMENT per target, which is what makes the tier-2 audit trigger
    -- write ONE row saying "n rows" rather than n rows saying one (WP 2.3).
    --
    -- `DISTINCT ON` IS NOT DECORATION. `ON CONFLICT DO UPDATE` raises 21000 —
    -- "cannot affect row a second time" — when ONE statement carries two rows
    -- with the same arbiter key, which is exactly what a CSV containing the same
    -- arc twice produces. Without it the whole promotion aborts on a duplicate
    -- LINE, with an error naming nothing the uploader can act on. With it the
    -- last line for a key wins — the same rule `20260916000017` applies to rows
    -- already in the table — and the superseded lines are marked in tier 1 below
    -- rather than resolved in silence (§5 T2).
    --
    -- `xmax = 0` DISTINGUISHES AN INSERT FROM AN UPDATE in the RETURNING clause.
    -- It is how many rows the second upload of a file left alone, which is the
    -- exit check stated as a number instead of a claim.
    EXECUTE format(
      'WITH up AS (
         INSERT INTO public.%I (%s, %s, ingest_run_id, source_row_id)
           SELECT DISTINCT ON (%s) %s, %s, $3, s.id
             FROM public.ingest_staged_rows s
            WHERE s.ingest_run_id = $3
              AND s.target_table  = $4
              AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)
            ORDER BY %s, s.source_row_number DESC
         ON CONFLICT (%s) DO UPDATE SET %s
              ingest_run_id = EXCLUDED.ingest_run_id,
              source_row_id = EXCLUDED.source_row_id,
              updated_at    = now()
         RETURNING (xmax = 0) AS inserted
       )
       SELECT count(*)::int, count(*) FILTER (WHERE NOT inserted)::int FROM up',
      v_target, v_server, v_cols,
      COALESCE(v_file_key, '1'), v_server_v, v_vals,
      COALESCE(v_file_key, '1'),
      (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_key) AS c),
      v_update)
      INTO v_written, v_upd
      USING v_run.project_id, v_plant, _run_id, v_target;

    v_total   := v_total + v_written;
    v_updated := v_updated + v_upd;

    -- THE SUPERSEDED LINES GET A FINDING, at row grain, in tier 1 where WP 3.4's
    -- review screen reads. A count in an audit row tells an administrator that
    -- something was collapsed; this tells the uploader WHICH LINE lost and to
    -- which one. §5 T2: the substitution is visible at the point of display, not
    -- in a log.
    IF v_file_key IS NOT NULL THEN
      EXECUTE format(
        'WITH g AS (
           SELECT s.id, s.source_row_number,
                  max(s.source_row_number) OVER (PARTITION BY %s) AS kept
             FROM public.ingest_staged_rows s
            WHERE s.ingest_run_id = $1 AND s.target_table = $2
              AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)
         )
         UPDATE public.ingest_staged_rows t
            SET findings = t.findings || jsonb_build_array(jsonb_build_object(
                  ''level'',   ''warning'',
                  ''code'',    ''superseded_by_later_line'',
                  ''row'',     g.source_row_number,
                  ''message'', format(
                     ''Row %%s repeats a row already in this file; row %%s carries the '' ||
                     ''same %s and was promoted instead. This row was not promoted.'',
                     g.source_row_number, g.kept)))
           FROM g
          WHERE t.id = g.id AND g.source_row_number < g.kept',
        v_file_key, array_to_string(v_key, ' + '))
        USING _run_id, v_target;
      GET DIAGNOSTICS v_supers = ROW_COUNT;
      v_collapsed := v_collapsed + v_supers;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_held
    FROM public.ingest_staged_rows
   WHERE ingest_run_id = _run_id AND findings @> '[{"level": "error"}]'::jsonb;

  UPDATE public.ingest_runs
     SET status = 'applied', applied_at = now(), applied_by_user_id = _actor_user_id,
         rows_new = v_total, rows_removed = v_held
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'run_id',          _run_id,
    'rows_promoted',   v_total,
    -- of those, how many already existed under this natural key. A second upload
    -- of an unchanged file promotes the same count and updates ALL of it, which
    -- is "uploading the same file twice is a no-op" as a number.
    'rows_updated',    v_updated,
    -- lines the file repeated; each one carries a finding in tier 1 naming the
    -- line that superseded it.
    'rows_superseded', v_collapsed,
    'rows_held',       v_held);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_apply_run(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_apply_run(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.ingest_apply_run(uuid,uuid) IS
  'Phase 3 / WP 3.3 — promotes a staged run''s clean rows into their tier-2 '
  'table with an UPSERT on the natural key, normalizing units inside the same '
  'statement (I3) and stamping ingest_run_id + source_row_id so every canonical '
  'row traces to the line of the file it came from. One statement per target, so '
  'the statement-level audit trigger names the actor once with a count. Rows '
  'carrying an `error` finding stay in tier 1.';

SELECT pg_notify('pgrst', 'reload schema');
