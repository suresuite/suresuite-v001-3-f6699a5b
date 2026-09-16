-- Phase 3 / WP 3.2 / §8.1–8.4 — THE LANDING, AND THE PROMOTION IT FEEDS.
--
-- Two functions, and the split between them is the tier boundary. `ingest_land_file`
-- writes tier 0 and tier 1 and nothing else; `ingest_apply_run` is the only thing
-- in this file that touches tier 2. External data never lands below tier 1
-- (`no-tier-skip`, I2), and after this migration the CSV path is the first one in
-- this repository for which that is true rather than aspirational.
--
-- WHY A FUNCTION AND NOT THREE POSTGREST CALLS. `ingest_files.ingest_run_id` is
-- NOT NULL and the row is write-once, so the order is forced: open the run, then
-- land the file. Three round trips can stop between any two of them, and what
-- they leave behind is a run with no file or a file with no rows — a tier-0
-- record that lies about what happened, in the table that exists so that nothing
-- has to be taken on trust. One transaction cannot half-happen.
--
-- WHY THE ACTOR IS A PARAMETER AND NOT A GUC READ. D36 is that the service-role
-- writers cannot name an actor, and WP 3.1's gap check names the reason the
-- "one-line fix" is not one: the GUC `get_current_user_id()` reads is the same
-- one the lane policies read, and `projectLanes.ts`'s header records that it does
-- not survive PostgREST connection pooling. So the actor is passed EXPLICITLY, as
-- `log_data_action` already takes it, and the function sets the GUC ITSELF, LOCAL
-- to its own transaction, before any tier-2 write. The trigger then sees it
-- because it is in the same transaction and not because a connection happened to
-- be reused. That is the difference between attribution and a hope.
--
-- AND THE GUC IS ALSO THE AUTHORIZATION. Setting it makes `has_project_access()`
-- answer for the named actor, so the function can refuse a landing into a project
-- the uploader cannot reach — a check on the server, not a check the caller
-- reports having done. `supabase/rehearsal/070` asserts the refusal.

-- ── 1 · which tier-2 tables a landing may be promoted into ──────────────────
--
-- A LIST, in one place, because the promotion below builds dynamic SQL and a
-- dynamic INSERT whose table name came from a caller is an injection with a
-- migration around it. `ingestSpec.generated.ts` carries the same six names on
-- the TypeScript side, generated from the contract; `ingestSpecParity.test.ts`
-- fails if the two ever disagree, which is `single-source` (I1) applied to a
-- list that would otherwise be maintained twice.

CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable(_target_table text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _target_table IN (
    'inbound_logistics',
    'outbound_logistics',
    'bom_single_level',
    'bom_multi_level',
    'tier2_suppliers',
    'tier3_suppliers');
$$;

-- ── 2 · the landing: tier 0 + tier 1, one transaction, one audit row ────────

CREATE OR REPLACE FUNCTION public.ingest_land_file(
  _project_id        uuid,
  _actor_user_id     uuid,
  _source_kind       text,
  _fact_class        text,
  _target_table      text,
  _original_filename text,
  _storage_bucket    text,
  _storage_path      text,
  _content_type      text,
  _byte_size         bigint,
  _content_sha256    text,
  _rows              jsonb,   -- [{source_row_number, raw, parsed, findings}]
  _file_findings     jsonb DEFAULT '[]'::jsonb,
  _counts            jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run      uuid;
  v_file     uuid;
  v_audit    uuid;
  v_staged   integer := 0;
  v_rejected integer := 0;
BEGIN
  -- A CSV upload always has a person. `triggered_by_user_id` is nullable because
  -- a SCHEDULED connector run genuinely has no actor (G4 is honest about that),
  -- but an anonymous file landing is not that case — it is an unattributed tier
  -- transition, which is the thing the invariant exists to forbid.
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_land_file: a file landing must name its uploader (invariant audit-actor)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCAL to this transaction. Everything below that asks who is acting — the
  -- access check here, the tier-2 audit trigger in ingest_apply_run — reads this.
  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);

  IF NOT public.has_project_access(_project_id) THEN
    RAISE EXCEPTION 'ingest_land_file: % has no access to project %', _actor_user_id, _project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.ingest_target_is_promotable(_target_table) THEN
    RAISE EXCEPTION 'ingest_land_file: % is not a target this contract promotes into', _target_table
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The run first, and this order is not a preference: `ingest_files.ingest_run_id`
  -- is NOT NULL and the row is write-once, so a file cannot be bound to a run
  -- afterwards. `source_kind` is stated because the column has no DEFAULT and
  -- must not get one (WP 3.1, §5 T1).
  INSERT INTO public.ingest_runs (
    project_id, link_id, source_kind, triggered_by, triggered_by_user_id, status,
    rows_fetched, mapping_warnings, fields_mapped, fields_defaulted, fields_failed)
  VALUES (
    _project_id, NULL, _source_kind, 'manual', _actor_user_id, 'staged',
    COALESCE(_counts -> 'rows_fetched', '{}'::jsonb),
    COALESCE(_file_findings, '[]'::jsonb),
    COALESCE((_counts ->> 'fields_mapped')::int, 0),
    COALESCE((_counts ->> 'fields_defaulted')::int, 0),
    COALESCE((_counts ->> 'fields_failed')::int, 0))
  RETURNING id INTO v_run;

  INSERT INTO public.ingest_files (
    ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
    content_type, byte_size, content_sha256, uploaded_by)
  VALUES (
    v_run, _source_kind, _original_filename, _storage_bucket, _storage_path,
    _content_type, _byte_size, _content_sha256, _actor_user_id)
  RETURNING id INTO v_file;

  INSERT INTO public.ingest_staged_rows (
    ingest_run_id, source_kind, fact_class, target_table,
    source_row_number, raw, parsed, findings)
  SELECT v_run, _source_kind, _fact_class, _target_table,
         (r ->> 'source_row_number')::int,
         COALESCE(r -> 'raw',      '{}'::jsonb),
         COALESCE(r -> 'parsed',   '{}'::jsonb),
         COALESCE(r -> 'findings', '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) AS r;
  GET DIAGNOSTICS v_staged = ROW_COUNT;

  SELECT count(*) INTO v_rejected
    FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run AND findings @> '[{"level": "error"}]'::jsonb;

  -- THE AUDIT ROW THIS PACKAGE OWES. `ingest_files`'s sidecar says it plainly:
  -- a landing IS a tier transition — external bytes entering the system — and
  -- G4 says a tier transition writes a row NAMING the actor. Tier 0 and tier 1
  -- carry no `audit_tier_write` trigger (those are tier 2/3/4), so the emit is
  -- explicit, and it is exact about the actor because the actor was a parameter.
  v_audit := public.log_data_action(
    _actor_user_id, 'data', 'ingest_file_landed', 'ingest_files', v_file::text, NULL,
    jsonb_build_object(
      'tier',            '0/1',
      'run_id',          v_run,
      'project_id',      _project_id,
      'source_kind',     _source_kind,
      'fact_class',      _fact_class,
      'target_table',    _target_table,
      'filename',        _original_filename,
      'byte_size',       _byte_size,
      'content_sha256',  _content_sha256,
      'rows_staged',     v_staged,
      'rows_rejected',   v_rejected,
      -- Said in the row rather than inferred from a non-NULL actor later, the
      -- same way `audit_tier_write` says it.
      'actor_known',     true));

  RETURN jsonb_build_object(
    'run_id', v_run, 'file_id', v_file, 'audit_id', v_audit,
    'rows_staged', v_staged, 'rows_rejected', v_rejected);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_land_file(uuid,uuid,text,text,text,text,text,text,text,bigint,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_land_file(uuid,uuid,text,text,text,text,text,text,text,bigint,text,jsonb,jsonb,jsonb) TO service_role;

COMMENT ON FUNCTION public.ingest_land_file(uuid,uuid,text,text,text,text,text,text,text,bigint,text,jsonb,jsonb,jsonb) IS
  'Phase 3 / WP 3.2 — opens an ingestion run, lands the tier-0 file manifest and '
  'the tier-1 rows in ONE transaction, and writes the data-plane audit row that '
  'names the uploader. The actor is a parameter, never a GUC read, because the '
  'session GUC does not survive PostgREST pooling (D36).';

-- ── 3 · the promotion: tier 1 -> tier 2 ─────────────────────────────────────
--
-- WHAT THIS IS AND IS NOT. It is TODAY'S BEHAVIOUR, moved behind the landing: an
-- INSERT of the rows a user uploaded, now sourced from validated tier-1 rows
-- instead of from a browser's `split(',')`. It is NOT WP 3.3's upsert — there are
-- no natural keys on the four lane tables yet (D5, R5 warns), so an upsert has
-- nothing to conflict on, and units are still normalized downstream rather than
-- here (I3). WP 3.3 replaces the INSERT below with an audited upsert and moves
-- the normalization into it. The seam is one statement wide on purpose.
--
-- ROWS CARRYING AN `error` FINDING ARE NEVER PROMOTED. That is what "rejected
-- with a row-level finding" means: the row stays in tier 1 with the reason
-- attached, where WP 3.4's review screen can show it, and the 1 786 good rows go
-- through. D7's 376 null volumes are what the other answer costs.

CREATE OR REPLACE FUNCTION public.ingest_apply_run(
  _run_id        uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run      public.ingest_runs%ROWTYPE;
  v_plant    text;
  v_target   text;
  v_cols     text;
  v_vals     text;
  v_keys     integer;
  v_known    integer;
  v_inserted integer;
  v_total    integer := 0;
  v_held     integer := 0;
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

    -- The column list is the union of the keys the landing established, checked
    -- against the target's REAL columns. `format_type` gives a cast the column
    -- will accept, so nothing here guesses a type from a name.
    WITH keys AS (
      SELECT DISTINCT k AS key
        FROM public.ingest_staged_rows s, jsonb_object_keys(s.parsed) k
       WHERE s.ingest_run_id = _run_id
         AND s.target_table = v_target
         AND NOT (s.findings @> '[{"level": "error"}]'::jsonb)
    )
    SELECT count(*),
           count(a.attname),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attname),
           string_agg(format('(s.parsed ->> %L)::%s', a.attname,
                             format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY a.attname)
      INTO v_keys, v_known, v_cols, v_vals
      FROM keys
      LEFT JOIN pg_attribute a
             ON a.attrelid = format('public.%I', v_target)::regclass
            AND a.attname  = keys.key
            AND a.attnum   > 0
            AND NOT a.attisdropped;

    IF v_keys IS NULL OR v_keys = 0 THEN
      CONTINUE;  -- every row for this target was rejected
    END IF;
    IF v_known <> v_keys THEN
      RAISE EXCEPTION 'ingest_apply_run: staged rows for % name % column(s) that table does not have',
        v_target, v_keys - v_known USING ERRCODE = 'undefined_column';
    END IF;

    -- ONE STATEMENT per target, which is what makes the tier-2 audit trigger
    -- write ONE row saying "n rows" rather than n rows saying one (WP 2.3).
    EXECUTE format(
      'INSERT INTO public.%I (project_id, plant_name, %s)
         SELECT $1, $2, %s
           FROM public.ingest_staged_rows s
          WHERE s.ingest_run_id = $3
            AND s.target_table  = $4
            AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)
          ORDER BY s.source_row_number',
      v_target, v_cols, v_vals)
      USING v_run.project_id, v_plant, _run_id, v_target;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_total := v_total + v_inserted;
  END LOOP;

  SELECT count(*) INTO v_held
    FROM public.ingest_staged_rows
   WHERE ingest_run_id = _run_id AND findings @> '[{"level": "error"}]'::jsonb;

  UPDATE public.ingest_runs
     SET status = 'applied', applied_at = now(), applied_by_user_id = _actor_user_id,
         rows_new = v_total, rows_removed = v_held
   WHERE id = _run_id;

  RETURN jsonb_build_object('run_id', _run_id, 'rows_promoted', v_total, 'rows_held', v_held);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_apply_run(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_apply_run(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.ingest_apply_run(uuid,uuid) IS
  'Phase 3 / WP 3.2 — promotes a staged run''s clean rows into their tier-2 '
  'table, one statement per target so the statement-level audit trigger names '
  'the actor once with a count. Rows carrying an `error` finding stay in tier 1. '
  'WP 3.3 replaces the INSERT with an audited upsert on the natural keys and '
  'moves unit normalization into it.';

SELECT pg_notify('pgrst', 'reload schema');
