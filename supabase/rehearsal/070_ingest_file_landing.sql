-- WP 3.2 · THE LANDING, AND THE AUDIT ROW IT OWES.
--
-- `050` proves the connector path survives a rename and `060` proves a link-less
-- run is legal. This file proves the thing WP 3.2 actually builds: that a CSV
-- upload lands in tier 0 and tier 1, that the landing NAMES THE UPLOADER, that a
-- row carrying an error finding never reaches tier 2, and that the promotion's
-- own audit row names the promoter too.
--
-- WHY IT HAS TO BE AN ASSERTION AND NOT A TEST THAT READS THE FUNCTION. Every
-- claim below depends on something only a database does: a trigger firing, a
-- policy refusing, a GUC reaching a trigger through a SECURITY DEFINER boundary,
-- a CHECK holding. WP 2.3 declared `audit-actor` met on the strength of a
-- migration that landed and §15 later found ZERO data-plane rows in production
-- (D45). A structural test would have agreed with the migration then and would
-- agree with this one now.
--
-- THE GUC QUESTION, SETTLED HERE. PLAN.md §16 · WP 3.1 records why D36's
-- "one-line fix" is not one: `get_current_user_id()` reads `app.current_user_id`,
-- and `projectLanes.ts`'s header says that setting does not survive PostgREST
-- connection pooling. `ingest_land_file` and `ingest_apply_run` therefore take
-- the actor as a PARAMETER and set the GUC themselves, LOCAL to their own
-- transaction, immediately before the write. Section 5 below is the assertion
-- that this reaches the tier-2 trigger — the half that could not be argued.

DO $wp32$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000032100';
  v_other    uuid := '00000000-0000-4000-8000-000000032101';
  v_project  uuid := '00000000-0000-4000-8000-000000032102';
  v_foreign  uuid := '00000000-0000-4000-8000-000000032103';
  v_rows     jsonb;
  v_landed   jsonb;
  v_applied  jsonb;
  v_run      uuid;
  v_file     uuid;
  v_n        integer;
  v_txt      text;
  v_num      numeric;
  v_audit    public.audit_logs%ROWTYPE;
  v_status   text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_user,  'wp32@example.invalid'),
    (v_other, 'wp32-stranger@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_user,  'wp32@example.invalid',           'WP32 uploader', 'x'),
    (v_other, 'wp32-stranger@example.invalid',  'Stranger',      'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES
    (v_project, 'WP32 landing',  v_user,  'WP32'),
    (v_foreign, 'Not yours',     v_other, 'OTHER');

  -- Three rows as `ingest-file` produces them: two clean, one with a blank
  -- required `volume`. The first carries a QUOTED COMMA inside `supplier_id`,
  -- which is D6 travelling the whole length of the path.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('supplier_id', '"Acme, Inc."', 'material_id', ' MAT-1 ', 'volume', '10'),
      'parsed',   jsonb_build_object('supplier_id', 'Acme, Inc.', 'material_id', 'MAT-1',
                                     'volume', 10, 'time_unit', 'week', 'lead_time', 2, 'unit_price', 3),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 3,
      'raw',      jsonb_build_object('supplier_id', 'SUP-2', 'material_id', 'MAT-2', 'volume', '20'),
      'parsed',   jsonb_build_object('supplier_id', 'SUP-2', 'material_id', 'MAT-2',
                                     'volume', 20, 'time_unit', 'week', 'lead_time', 4, 'unit_price', 5),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 4,
      'raw',      jsonb_build_object('supplier_id', 'SUP-3', 'material_id', 'MAT-3', 'volume', ''),
      'parsed',   jsonb_build_object('supplier_id', 'SUP-3', 'material_id', 'MAT-3',
                                     'time_unit', 'week', 'lead_time', 6, 'unit_price', 7),
      'findings', jsonb_build_array(jsonb_build_object(
                    'level', 'error', 'field', 'volume', 'code', 'required_blank', 'row', 4,
                    'message', 'Row 4, column "volume": required and blank.'))));

  -- ── 1 · a landing that should be refused, three ways ──────────────────────
  --
  -- Before the happy path, because a function that lands anything asked of it is
  -- not governed, and the rehearsal is the only place that can tell.

  -- G4: an unattributed file landing is not a thing this system does.
  BEGIN
    PERFORM public.ingest_land_file(
      v_project, NULL, 'csv', 'transactional', 'inbound_logistics',
      'x.csv', 'ingest', 'p/1', 'text/csv', 10,
      repeat('a', 64), v_rows);
    RAISE EXCEPTION 'WP 3.2: a landing with no uploader was accepted — audit-actor is not enforced';
  EXCEPTION WHEN null_value_not_allowed THEN NULL;
  END;

  -- The asserted identity is CHECKED. `ingest-file` takes the uploader's id from
  -- the client (this application does not use Supabase Auth — D28), so the one
  -- thing the database can still refuse is a landing into a project that user
  -- cannot reach. If this stops holding, a caller can write into any project.
  BEGIN
    PERFORM public.ingest_land_file(
      v_foreign, v_user, 'csv', 'transactional', 'inbound_logistics',
      'x.csv', 'ingest', 'p/2', 'text/csv', 10,
      repeat('a', 64), v_rows);
    RAISE EXCEPTION 'WP 3.2: a file was landed into a project the uploader has no access to';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The promotion builds dynamic SQL, so the target is a closed set and the
  -- landing is where it closes — before a row exists, not at apply time.
  BEGIN
    PERFORM public.ingest_land_file(
      v_project, v_user, 'csv', 'transactional', 'audit_logs',
      'x.csv', 'ingest', 'p/3', 'text/csv', 10,
      repeat('a', 64), v_rows);
    RAISE EXCEPTION 'WP 3.2: a landing named an arbitrary target table and was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── 2 · the landing ───────────────────────────────────────────────────────
  DELETE FROM public.audit_logs WHERE plane = 'data';

  v_landed := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'inbound logistics.csv', 'ingest', 'project/wp32/inbound.csv', 'text/csv', 2048,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    v_rows,
    '[]'::jsonb,
    jsonb_build_object('rows_fetched', jsonb_build_object('inbound_logistics', 3),
                       'fields_mapped', 17, 'fields_defaulted', 0, 'fields_failed', 1));

  v_run  := (v_landed ->> 'run_id')::uuid;
  v_file := (v_landed ->> 'file_id')::uuid;

  IF (v_landed ->> 'rows_staged')::int <> 3 THEN
    RAISE EXCEPTION 'WP 3.2: the landing staged % row(s), expected 3', v_landed ->> 'rows_staged';
  END IF;
  IF (v_landed ->> 'rows_rejected')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the landing counted % rejected row(s), expected 1', v_landed ->> 'rows_rejected';
  END IF;

  -- The run says it is a CSV run, has no link, and has not been promoted yet.
  SELECT status INTO v_status FROM public.ingest_runs WHERE id = v_run;
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'WP 3.2: a freshly landed run is %, expected staged', v_status;
  END IF;
  SELECT count(*) INTO v_n FROM public.ingest_runs
   WHERE id = v_run AND source_kind = 'csv' AND link_id IS NULL
     AND project_id = v_project AND triggered_by_user_id = v_user;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the run is not the link-less csv run this package writes';
  END IF;

  -- Tier 0 exists, names the uploader IN THE ROW, and is bound to the run — the
  -- order that has no alternative, since `ingest_run_id` is NOT NULL and the row
  -- refuses every UPDATE.
  SELECT count(*) INTO v_n FROM public.ingest_files
   WHERE id = v_file AND ingest_run_id = v_run AND uploaded_by = v_user
     AND storage_bucket = 'ingest' AND byte_size = 2048;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the tier-0 manifest is missing or is not bound to the run';
  END IF;

  -- Tier 1 keeps BOTH sides of the parse. This is what makes D8 diagnosable
  -- rather than arguable: one id in `parsed`, two different strings in `raw`.
  SELECT parsed ->> 'material_id', raw ->> 'material_id'
    INTO v_txt, v_status
    FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run AND source_row_number = 2;
  IF v_txt <> 'MAT-1' THEN
    RAISE EXCEPTION 'WP 3.2: the staged row resolved material_id to "%", expected MAT-1', v_txt;
  END IF;
  IF v_status <> ' MAT-1 ' THEN
    RAISE EXCEPTION 'WP 3.2: the untrimmed cell did not survive into `raw` (got "%")', v_status;
  END IF;

  -- ── 3 · the audit row the landing owes (G4) ───────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_logs WHERE plane = 'data';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the landing wrote % data-plane audit row(s), expected exactly 1', v_n;
  END IF;
  SELECT * INTO v_audit FROM public.audit_logs WHERE plane = 'data';

  IF v_audit.action <> 'ingest_file_landed' THEN
    RAISE EXCEPTION 'WP 3.2: the audit row says action=%, expected ingest_file_landed', v_audit.action;
  END IF;
  IF v_audit.target_type <> 'ingest_files' OR v_audit.target_id <> v_file::text THEN
    RAISE EXCEPTION 'WP 3.2: the audit row points at %/%, expected ingest_files/%',
      v_audit.target_type, v_audit.target_id, v_file;
  END IF;
  -- THE POINT OF THE WHOLE SECTION: it names WHO.
  IF v_audit.actor_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'WP 3.2: the landing audit row names actor %, expected % — this is the invariant',
      v_audit.actor_user_id, v_user;
  END IF;
  IF (v_audit.after ->> 'actor_known') <> 'true' THEN
    RAISE EXCEPTION 'WP 3.2: the landing audit row says actor_known=%, expected true',
      v_audit.after ->> 'actor_known';
  END IF;
  IF (v_audit.after ->> 'content_sha256') IS NULL OR (v_audit.after ->> 'rows_rejected')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the landing audit row does not carry the hash and the counts';
  END IF;

  -- ── 4 · tier 1 is governed by the RUN's project ───────────────────────────
  PERFORM set_config('app.current_user_id', v_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 3.2: the uploader reads % of their own 3 staged rows', v_n;
  END IF;

  PERFORM set_config('app.current_user_id', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.2: a stranger reads % staged row(s) of another project''s upload', v_n;
  END IF;

  -- ── 5 · the promotion, and the audit row IT owes ──────────────────────────
  DELETE FROM public.audit_logs WHERE plane = 'data';
  DELETE FROM public.inbound_logistics WHERE project_id = v_project;

  v_applied := public.ingest_apply_run(v_run, v_user);

  IF (v_applied ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.2: the promotion moved % row(s), expected 2 — the third carries an error finding',
      v_applied ->> 'rows_promoted';
  END IF;
  IF (v_applied ->> 'rows_held')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the promotion held back % row(s), expected 1', v_applied ->> 'rows_held';
  END IF;

  SELECT count(*) INTO v_n FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.2: tier 2 holds % row(s) after the promotion, expected 2', v_n;
  END IF;

  -- D7, end to end: the row whose `volume` was blank is NOT in tier 2, and no
  -- row in tier 2 has a null volume. That is the defect, stated as an assertion.
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND (supplier_id = 'SUP-3' OR volume IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.2: a row with a blank required volume reached tier 2';
  END IF;

  -- D6, end to end: the quoted comma is still one field.
  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'Acme, Inc.';
  IF v_num IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'WP 3.2: the supplier containing a comma did not survive promotion (volume %)', v_num;
  END IF;

  -- The rejected row STAYS in tier 1, with its reason. "Rejected" is not
  -- "discarded": WP 3.4's review screen needs row 4 to exist somewhere.
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run AND findings @> '[{"level": "error"}]'::jsonb;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the rejected row did not stay in tier 1 with its finding';
  END IF;

  -- AND THE PROMOTION IS AUDITED, BY NAME. One row, because the trigger is
  -- statement-level; `actor_known` true, because `ingest_apply_run` set the GUC
  -- inside its own transaction rather than hoping a pooled session carried it.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics' AND action = 'insert';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the promotion wrote % tier-2 audit row(s), expected exactly 1', v_n;
  END IF;
  SELECT * INTO v_audit FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics' AND action = 'insert';
  IF v_audit.actor_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'WP 3.2: the promotion audit row names actor %, expected % — D36''s shape, closed on THIS path',
      v_audit.actor_user_id, v_user;
  END IF;
  IF (v_audit.after ->> 'rows_after')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.2: the promotion audit row counts % rows, expected 2 — the statement grain is wrong',
      v_audit.after ->> 'rows_after';
  END IF;

  -- The run records the promotion and who approved it.
  SELECT count(*) INTO v_n FROM public.ingest_runs
   WHERE id = v_run AND status = 'applied' AND applied_by_user_id = v_user AND applied_at IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.2: the run does not record that it was applied, and by whom';
  END IF;

  -- ── 6 · a run is promoted once ────────────────────────────────────────────
  BEGIN
    PERFORM public.ingest_apply_run(v_run, v_user);
    RAISE EXCEPTION 'WP 3.2: a run was promoted twice — the same rows are now in tier 2 twice';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── 7 · the closed vocabularies, on the new table ─────────────────────────
  BEGIN
    INSERT INTO public.ingest_staged_rows
      (ingest_run_id, source_kind, fact_class, target_table, source_row_number, raw)
    VALUES (v_run, 'csv', 'reference', 'inbound_logistics', 9, '{}'::jsonb);
    RAISE EXCEPTION 'WP 3.2: ingest_staged_rows accepted fact_class "reference"';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- One run, one target, one line — twice is the same fact, not two.
  BEGIN
    INSERT INTO public.ingest_staged_rows
      (ingest_run_id, source_kind, fact_class, target_table, source_row_number, raw)
    VALUES (v_run, 'csv', 'transactional', 'inbound_logistics', 2, '{}'::jsonb);
    RAISE EXCEPTION 'WP 3.2: the same file line was staged twice in one run';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── 8 · tier 0 and tier 1 die with their run ──────────────────────────────
  DELETE FROM public.ingest_runs WHERE id = v_run;
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows WHERE ingest_run_id = v_run;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.2: % staged row(s) survived the deletion of their run', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.ingest_files WHERE id = v_file;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.2: the tier-0 manifest survived the deletion of its run';
  END IF;
  -- And tier 2 does NOT: a promoted row is the project's, not the run's.
  SELECT count(*) INTO v_n FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.2: deleting a run deleted % promoted tier-2 row(s) — it must delete none', 2 - v_n;
  END IF;

  RAISE NOTICE 'WP 3.2: a CSV lands in tier 0/1 naming its uploader, a blank required cell never reaches tier 2, and both transitions are audited by name';
END $wp32$;
