-- =====================================================================
-- WP 4.1 — `ingest_legacy_upsert_lane` derives its column list ONCE
--                                                    (Phase 4 / G4 / §11)
--
-- THIS IS ITS OWN MIGRATION BECAUSE `20260917000003` HAS BEEN APPLIED.
--
-- The change below was written as an edit to that file and reverted, because
-- the deploy had already run: `supabase-migrations.yml` has no branch filter
-- (§4 D31), so the branch push deployed it, and Supabase tracks applied
-- migrations by version. Re-pushing an EDITED `20260917000003` would have been
-- skipped as already applied — leaving the file and production disagreeing
-- about what the function contains, with nothing in the repository able to
-- notice. An applied migration is history; a correction to it is a new
-- migration. `contract:introspect` reads the LAST definition of a name, so the
-- artifact and every gate that reads it follow this file.
--
-- WHAT CHANGES: nothing the database does. `20260917000003` built the quoted
-- column list and then split it back on ', ' to derive the value list and the
-- `DO UPDATE SET` fragment, so a fact it already held was re-derived from a
-- weaker source — and the split would mis-parse any identifier that needs a
-- quoted spelling. The column names are kept as a `text[]` and every fragment
-- comes from it. `supabase/rehearsal/110` §7a passes identically either way,
-- which is exactly why this needed reading rather than testing.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ingest_legacy_upsert_lane(
  _project_id    uuid,
  _actor_user_id uuid,
  _target        text,
  _rows          jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_key      text[];
  v_names    text[];
  v_file_key text;
  v_cols     text;
  v_vals     text;
  v_update   text;
  v_plant    text;
  v_written  integer;
  v_updated  integer;
BEGIN
  PERFORM public.assert_writer_may_act('ingest_legacy_upsert_lane', _project_id, _actor_user_id);

  IF NOT public.ingest_target_is_promotable(_target) THEN
    RAISE EXCEPTION 'ingest_legacy_upsert_lane: % is not a writable lane', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'ingest_legacy_upsert_lane: rows must be a json array, got %',
      COALESCE(jsonb_typeof(_rows), 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(_rows) = 0 THEN
    RETURN jsonb_build_object('rows_written', 0, 'rows_updated', 0, 'target', _target);
  END IF;

  SELECT plant_name INTO v_plant FROM public.projects WHERE id = _project_id;

  v_key := public.ingest_target_natural_key(_target);

  -- The arbiter columns the PAYLOAD supplies — the server-set two are excluded
  -- because they are the same value for every row and cannot discriminate.
  SELECT string_agg(quote_ident(c), ', ' ORDER BY c) INTO v_file_key
    FROM unnest(v_key) AS c WHERE c NOT IN ('project_id','plant_name');

  -- Which columns to write: the union of the payload's keys, intersected with
  -- the target's real columns, minus everything the server owns. A key the
  -- table does not have is DROPPED rather than raising — these are legacy
  -- callers and a new field in a client payload must not take the grid down.
  --
  -- KEPT AS AN ARRAY, which is the whole of this migration. `20260917000003`
  -- built the quoted column list and then SPLIT IT BACK on ', ' to derive the
  -- value list and the `DO UPDATE SET` fragment — a second, weaker source for a
  -- fact that was already in hand, and one that would mis-parse any identifier
  -- needing a quoted spelling. `ingest_promotion_plan` carries both a string
  -- and a `write_names text[]` for the same reason.
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_names
    FROM (SELECT DISTINCT k FROM jsonb_array_elements(_rows) e, jsonb_object_keys(e) k) p
    JOIN pg_attribute a
      ON a.attrelid = format('public.%I', _target)::regclass
     AND a.attname  = p.k AND a.attnum > 0 AND NOT a.attisdropped
   WHERE a.attname NOT IN ('id','project_id','plant_name','created_at','updated_at',
                           'ingest_run_id','source_row_id');

  IF v_names IS NULL THEN
    RAISE EXCEPTION
      'ingest_legacy_upsert_lane: the payload carries no column of %. Writing nothing '
      'and reporting success is how a silent data loss looks.', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT string_agg(quote_ident(c), ', ' ORDER BY c),
         string_agg('r.' || quote_ident(c), ', ' ORDER BY c)
    INTO v_cols, v_vals
    FROM unnest(v_names) AS c;

  -- A key column must NOT appear in DO UPDATE SET: `ON CONFLICT` forbids
  -- assigning to what it matched on, and it would be meaningless anyway.
  SELECT COALESCE(string_agg(format('%I = EXCLUDED.%I,', c, c), ' ' ORDER BY c), '')
    INTO v_update
    FROM unnest(v_names) AS c
   WHERE c <> ALL (v_key);

  -- ONE STATEMENT, which is what makes the tier-2 audit trigger write ONE row
  -- saying "n rows" rather than n rows saying one (WP 2.3). `DISTINCT ON` is
  -- not decoration: `ON CONFLICT DO UPDATE` raises 21000 when one statement
  -- carries two rows with the same arbiter key, which a grid that assigns the
  -- same supplier twice produces. Last one wins, the same rule
  -- `ingest_apply_run` applies.
  EXECUTE format(
    'WITH up AS (
       INSERT INTO public.%I (project_id, plant_name, %s)
         SELECT DISTINCT ON (%s) $1, $2, %s
           FROM jsonb_populate_recordset(null::public.%I, $3) AS r
          ORDER BY %s
       ON CONFLICT (%s) DO UPDATE SET %s updated_at = now()
       RETURNING (xmax = 0) AS inserted
     )
     SELECT count(*)::int, count(*) FILTER (WHERE NOT inserted)::int FROM up',
    _target, v_cols,
    COALESCE(v_file_key, '1'),
    v_vals,
    _target,
    COALESCE(v_file_key, '1'),
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_key) AS c),
    v_update)
    INTO v_written, v_updated
    USING _project_id, v_plant, _rows;

  RETURN jsonb_build_object(
    'target', _target, 'rows_written', v_written, 'rows_updated', v_updated);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_legacy_upsert_lane(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_legacy_upsert_lane(uuid,uuid,text,jsonb) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
