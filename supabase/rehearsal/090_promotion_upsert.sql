-- WP 3.3 · THE PROMOTION IS AN UPSERT THAT NORMALIZES AND LEAVES A TRAIL.
--
-- `070` proves WP 3.2's landing still behaves exactly as it did — it is run
-- UNCHANGED against this package's promotion, which is the compatibility claim.
-- This file asserts what WP 3.3 adds, and the first section is the package's own
-- exit check:
--
--     "uploading the same file twice is a no-op"
--
-- §10 called that an exit check and said it needs an assertion, not a paragraph.
-- Section 1 is the assertion. It uploads the same file twice and requires that
-- tier 2 hold the same number of rows with the same ids afterwards — the SAME
-- IDS matter, because a table that deleted and re-inserted would satisfy a count
-- and break every foreign key pointing into it.
--
-- WHAT ONLY A DATABASE CAN SAY HERE. All five claims below are about what the
-- statement DOES: which index `ON CONFLICT` infers, whether `rate_to_weekly`
-- runs before or after the row lands, whether `xmax` distinguishes an insert
-- from an update, what `ON DELETE SET NULL` leaves behind, and whether
-- `DISTINCT ON` stops PostgreSQL raising 21000 on a file that repeats a line.

DO $wp33up$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000033200';
  v_project uuid := '00000000-0000-4000-8000-000000033201';
  v_rows    jsonb;
  v_first   jsonb;
  v_second  jsonb;
  v_run1    uuid;
  v_run2    uuid;
  v_n       integer;
  v_num     numeric;
  v_txt     text;
  v_ids     uuid[];
  v_ids2    uuid[];
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp33up@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp33up@example.invalid', 'WP33 upsert', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP33 upsert', v_user, 'WP33U');

  -- Two arcs. The first is quoted in a MONTHLY volume and a lead time in DAYS —
  -- the case D2 and D9 exist for, and the one `normalize-at-promotion` has to
  -- resolve before the row lands rather than leaving to eight read sites.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('supplier_id','SUP-1','material_id','MAT-1','volume','30.4375'),
      'parsed',   jsonb_build_object('supplier_id','SUP-1','material_id','MAT-1',
                                     'volume', 30.4375, 'time_unit', 'month',
                                     'lead_time', 14, 'lead_time_unit', 'day', 'unit_price', 3),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 3,
      'raw',      jsonb_build_object('supplier_id','SUP-2','material_id','MAT-2','volume','20'),
      'parsed',   jsonb_build_object('supplier_id','SUP-2','material_id','MAT-2',
                                     'volume', 20, 'time_unit', 'week',
                                     'lead_time', 4, 'unit_price', 5),
      'findings', '[]'::jsonb));

  v_first := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'inbound.csv', 'ingest', 'p/wp33/1.csv', 'text/csv', 512,
    repeat('a', 64), v_rows);
  v_run1 := (v_first ->> 'run_id')::uuid;

  v_first := public.ingest_apply_run(v_run1, v_user);
  IF (v_first ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: the first promotion moved % row(s), expected 2', v_first ->> 'rows_promoted';
  END IF;
  IF (v_first ->> 'rows_updated')::int <> 0 THEN
    RAISE EXCEPTION 'WP 3.3: the FIRST promotion reported % updated row(s); nothing existed to update',
      v_first ->> 'rows_updated';
  END IF;

  -- ── 1 · NORMALIZATION HAPPENS AT PROMOTION, NOT DOWNSTREAM (I3) ───────────
  --
  -- 30.4375 per MONTH is exactly 7 per week (a month is 30.4375 days, from the
  -- one unit table). The row must hold 7 and must SAY `week` — a weekly number
  -- under a `month` label is worse than either alone, and a weekly number under
  -- a NULL label is a number whose source a reader has to know (§5 T1).
  SELECT volume, time_unit INTO v_num, v_txt
    FROM public.inbound_logistics WHERE project_id = v_project AND supplier_id = 'SUP-1';
  IF round(v_num, 6) <> 7 THEN
    RAISE EXCEPTION 'WP 3.3: a monthly volume of 30.4375 promoted as %, expected 7 per week — the conversion did not happen inside the promoting statement', v_num;
  END IF;
  IF v_txt <> 'week' THEN
    RAISE EXCEPTION 'WP 3.3: the promoted row still says time_unit=%, so the value and its label disagree', v_txt;
  END IF;

  -- A DURATION, not a rate, and they are not inverses: 14 days is 2 weeks.
  SELECT lead_time, lead_time_unit INTO v_num, v_txt
    FROM public.inbound_logistics WHERE project_id = v_project AND supplier_id = 'SUP-1';
  IF round(v_num, 6) <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: a lead time of 14 days promoted as % weeks, expected 2 — `duration` was converted as a `rate`', v_num;
  END IF;
  IF v_txt <> 'week' THEN
    RAISE EXCEPTION 'WP 3.3: the promoted lead_time_unit is %, expected week', v_txt;
  END IF;

  -- The row the file gave no `lead_time_unit` for is stamped anyway. Its value
  -- was read on the documented 7-day basis, so leaving the column NULL would
  -- store a number whose unit lives in a comment.
  SELECT lead_time_unit INTO v_txt
    FROM public.inbound_logistics WHERE project_id = v_project AND supplier_id = 'SUP-2';
  IF v_txt <> 'week' THEN
    RAISE EXCEPTION 'WP 3.3: a row whose file omitted lead_time_unit has unit %, expected the canonical token to be written anyway (§5 T1)', v_txt;
  END IF;

  -- ── 2 · PROVENANCE: the row points at the line of the file (A4) ───────────
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND (ingest_run_id IS NULL OR source_row_id IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.3: % promoted row(s) carry no run or no source row', v_n;
  END IF;

  SELECT s.source_row_number INTO v_n
    FROM public.inbound_logistics i
    JOIN public.ingest_staged_rows s ON s.id = i.source_row_id
   WHERE i.project_id = v_project AND i.supplier_id = 'SUP-1';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: the canonical row traces to file line %, expected 2 — this is what A4 reaching the source file means', v_n;
  END IF;

  -- ── 3 · THE EXIT CHECK: the same file twice is a no-op ────────────────────
  SELECT array_agg(id ORDER BY supplier_id) INTO v_ids
    FROM public.inbound_logistics WHERE project_id = v_project;

  v_second := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'inbound.csv', 'ingest', 'p/wp33/2.csv', 'text/csv', 512,
    repeat('a', 64), v_rows);
  v_run2 := (v_second ->> 'run_id')::uuid;
  v_second := public.ingest_apply_run(v_run2, v_user);

  SELECT count(*) INTO v_n FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: uploading the same file twice left % row(s), expected 2 — THIS IS THE EXIT CHECK, and D5 is not closed', v_n;
  END IF;

  -- Every promoted row was an UPDATE. A count alone would be satisfied by a
  -- delete-and-reinsert; this says the promotion recognised them.
  IF (v_second ->> 'rows_updated')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: the second promotion reported % updated row(s), expected 2 — rows were inserted, not matched',
      v_second ->> 'rows_updated';
  END IF;

  -- AND THE IDS ARE THE SAME ROWS. A table that deleted and re-inserted would
  -- pass the count and break every reference into it.
  SELECT array_agg(id ORDER BY supplier_id) INTO v_ids2
    FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_ids2 IS DISTINCT FROM v_ids THEN
    RAISE EXCEPTION 'WP 3.3: the second upload replaced the rows rather than updating them — the surrogate ids changed';
  END IF;

  -- The provenance moved to the NEW run: a row says where it last came from.
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND ingest_run_id = v_run2;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: % row(s) name the second run, expected 2 — an updated row must re-point at the run that wrote it', v_n;
  END IF;

  -- Normalization is IDEMPOTENT. The second pass reads the already-promoted
  -- value from tier 1 again, not from tier 2, so 30.4375/month is still 7 —
  -- if the promotion ever converted a tier-2 value a second time this is 1.61.
  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-1';
  IF round(v_num, 6) <> 7 THEN
    RAISE EXCEPTION 'WP 3.3: after a second promotion the volume is %, expected 7 — the conversion was applied twice', v_num;
  END IF;

  -- ── 4 · a file that repeats a LINE does not abort the promotion ───────────
  --
  -- Two rows with the same natural key in ONE statement make `ON CONFLICT DO
  -- UPDATE` raise 21000, "cannot affect row a second time". Without `DISTINCT ON`
  -- the whole upload fails with an error naming nothing the uploader can act on.
  v_second := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'repeats.csv', 'ingest', 'p/wp33/3.csv', 'text/csv', 512,
    repeat('b', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 2,
        'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('supplier_id','SUP-9','material_id','MAT-9',
                                     'volume', 1, 'time_unit', 'week', 'lead_time', 1, 'unit_price', 1),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 5,
        'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('supplier_id','SUP-9','material_id','MAT-9',
                                     'volume', 99, 'time_unit', 'week', 'lead_time', 1, 'unit_price', 1),
        'findings', '[]'::jsonb)));
  v_run2 := (v_second ->> 'run_id')::uuid;
  v_second := public.ingest_apply_run(v_run2, v_user);

  IF (v_second ->> 'rows_superseded')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: a file repeating one arc reported % superseded line(s), expected 1',
      v_second ->> 'rows_superseded';
  END IF;

  -- The LATER line won — the same rule 20260916000017 applies to rows already in
  -- the table, so a user does not have to learn two.
  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-9';
  IF v_num <> 99 THEN
    RAISE EXCEPTION 'WP 3.3: the repeated arc promoted volume %, expected 99 — the LATER line must win', v_num;
  END IF;

  -- AND THE LOSING LINE IS TOLD SO, at row grain, in tier 1 where WP 3.4 reads.
  -- §5 T2: visible at the point of display, not in a log.
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run2 AND source_row_number = 2
     AND findings @> '[{"code": "superseded_by_later_line"}]'::jsonb;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: the superseded line carries no finding — the collapse is invisible to the person who uploaded it';
  END IF;
  SELECT f ->> 'message' INTO v_txt
    FROM public.ingest_staged_rows s, jsonb_array_elements(s.findings) f
   WHERE s.ingest_run_id = v_run2 AND s.source_row_number = 2
     AND f ->> 'code' = 'superseded_by_later_line';
  IF v_txt NOT LIKE '%row 5%' THEN
    RAISE EXCEPTION 'WP 3.3: the finding does not name the line that superseded it (got "%")', v_txt;
  END IF;

  -- ── 5 · a deleted run takes its trace, NOT the project's data ─────────────
  --
  -- `070` section 8 asserts the tier-2 rows survive. This asserts what happens to
  -- the columns pointing at the run: SET NULL, so the row says "the run that made
  -- me is gone", which is true, rather than holding a dangling id.
  DELETE FROM public.ingest_runs WHERE id = v_run2;

  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-9';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: deleting a run deleted a promoted row — a canonical row belongs to the project, not the run';
  END IF;

  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-9'
     AND ingest_run_id IS NULL AND source_row_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: a promoted row still points at a deleted run — the provenance columns are not ON DELETE SET NULL';
  END IF;

  -- ── 6 · the key is read from the database, and it refuses to guess ────────
  IF public.ingest_target_natural_key('inbound_logistics')
     IS DISTINCT FROM ARRAY['project_id','plant_name','supplier_id','material_id'] THEN
    RAISE EXCEPTION 'WP 3.3: the resolved natural key is %, not the one 20260916000018 created',
      public.ingest_target_natural_key('inbound_logistics');
  END IF;

  -- A table with only a surrogate key has no natural key, and the function says
  -- so instead of returning something a promotion would upsert on.
  BEGIN
    PERFORM public.ingest_target_natural_key('audit_logs');
    RAISE EXCEPTION 'WP 3.3: a table with only a surrogate key returned a natural key';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;

  -- And more than one candidate is refused rather than chosen between.
  -- `SET CONSTRAINTS ALL IMMEDIATE` first, and it is not boilerplate.
  -- `20260916000019` makes tier 2's `source_row_id` FK DEFERRABLE INITIALLY
  -- DEFERRED (it has to — see that file's comment on the cascade ordering), and
  -- PostgreSQL refuses `CREATE INDEX` on a table that has pending trigger events.
  -- Production never meets this: a migration creates its indexes before writing
  -- anything. A rehearsal does, because it writes and then builds. Flushing the
  -- deferred checks here is the honest way to say so rather than reaching for a
  -- non-deferrable constraint that would break the run deletion.
  SET CONSTRAINTS ALL IMMEDIATE;
  CREATE UNIQUE INDEX wp33_second_key ON public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price);
  BEGIN
    PERFORM public.ingest_target_natural_key('inbound_logistics');
    RAISE EXCEPTION 'WP 3.3: two candidate natural keys and the function picked one — a promotion would upsert on the wrong grain and the rows would look right';
  EXCEPTION WHEN ambiguous_column THEN NULL;
  END;
  DROP INDEX public.wp33_second_key;

  RAISE NOTICE 'WP 3.3: the promotion upserts on the natural key, normalizes units inside the statement, stamps run + source line, and the same file twice is a no-op';
END $wp33up$;

-- WP 3.3 · D55 — AN ITEM MASTER PROMOTES THROUGH THE SAME STATEMENT.
--
-- The claim §10 makes about D55 is that once the promotion upserts, the three
-- item masters cost "an `ingest_dataset` block in three sidecars and nothing
-- else". That is a claim about GENERALITY, and the only way to test it is to
-- promote into a table shaped unlike a lane:
--
--   · its natural key is a composite PRIMARY KEY, not the index `20260916000018`
--     created — so `ingest_target_natural_key` has to find a key it did not make;
--   · it has NO `plant_name` — so a promotion that hard-coded the server-set
--     columns, as WP 3.2's did, cannot write to it at all.
--
-- If either needed a second code path, this section is where that shows.

DO $wp33im$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000033300';
  v_project uuid := '00000000-0000-4000-8000-000000033301';
  v_landed  jsonb;
  v_applied jsonb;
  v_run     uuid;
  v_n       integer;
  v_num     numeric;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp33im@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp33im@example.invalid', 'WP33 item master', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP33 item master', v_user, 'WP33M');

  -- The key is the composite PRIMARY KEY, found without being told.
  IF public.ingest_target_natural_key('materials')
     IS DISTINCT FROM ARRAY['project_id','material_id'] THEN
    RAISE EXCEPTION 'WP 3.3: materials resolved to natural key %, expected the composite PRIMARY KEY',
      public.ingest_target_natural_key('materials');
  END IF;

  v_landed := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'materials',
    'materials.csv', 'ingest', 'p/wp33m/1.csv', 'text/csv', 256,
    repeat('c', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('material_id','MAT-1','name','Widget','cost', 5),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('material_id','MAT-2','name','Gasket','cost', 2),
        'findings', '[]'::jsonb)));
  v_run := (v_landed ->> 'run_id')::uuid;

  v_applied := public.ingest_apply_run(v_run, v_user);
  IF (v_applied ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: an item master promoted % row(s), expected 2 — a table with no plant_name must go through the SAME statement a lane does',
      v_applied ->> 'rows_promoted';
  END IF;

  SELECT count(*) INTO v_n FROM public.materials
   WHERE project_id = v_project AND ingest_run_id = v_run AND source_row_id IS NOT NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: % item-master row(s) carry their provenance, expected 2', v_n;
  END IF;

  -- The same file again: an upsert on the PRIMARY KEY, not two rows.
  v_landed := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'materials',
    'materials.csv', 'ingest', 'p/wp33m/2.csv', 'text/csv', 256,
    repeat('c', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('material_id','MAT-1','name','Widget','cost', 9),
        'findings', '[]'::jsonb)));
  v_applied := public.ingest_apply_run((v_landed ->> 'run_id')::uuid, v_user);

  SELECT count(*) INTO v_n FROM public.materials WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: re-uploading an item master left % row(s), expected 2', v_n;
  END IF;
  SELECT cost INTO v_num FROM public.materials
   WHERE project_id = v_project AND material_id = 'MAT-1';
  IF v_num <> 9 THEN
    RAISE EXCEPTION 'WP 3.3: the re-uploaded item master kept cost %, expected the new value 9', v_num;
  END IF;

  -- no-tier-skip (I2): the rows arrived through tier 0 and tier 1, and the file
  -- manifest is there to prove it.
  SELECT count(*) INTO v_n FROM public.ingest_files f
    JOIN public.ingest_runs r ON r.id = f.ingest_run_id
   WHERE r.project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: % tier-0 manifest(s) for two item-master uploads, expected 2 — the upload skipped a tier', v_n;
  END IF;

  RAISE NOTICE 'WP 3.3: an item master lands in tier 0/1 and upserts into tier 2 through the same statement a lane does (D55)';
END $wp33im$;

-- WP 3.3 · D36 — A SQL WRITER THAT TAKES THE ACTOR NOW TELLS THE TRIGGER.
--
-- `assign_material_supplier` writes three tier-2/3 tables from the /policies grid
-- and has taken `p_user_id` since it was written, and its audit rows said
-- `actor_known: false` anyway — the one line telling the trigger was missing.
-- WP 2.3 declared `audit-actor` met on the strength of a migration and §15 later
-- found zero data-plane rows in production (D45); a structural test would agree
-- with this migration exactly as it agreed with that one. So: run it, and read
-- the row back.

DO $wp33d36$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000033400';
  v_project uuid := '00000000-0000-4000-8000-000000033401';
  v_n       integer;
  v_audit   public.audit_logs%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp33d36@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp33d36@example.invalid', 'WP33 D36', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization)
    VALUES (v_project, 'WP33 D36', v_user, 'WP33D', 'WP33 Org');

  DELETE FROM public.audit_logs WHERE plane = 'data';
  PERFORM public.assign_material_supplier(v_project, 'MAT-A', 'SUP-A', v_user, 'wp33d36@example.invalid');

  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-A' AND material_id = 'MAT-A';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: assign_material_supplier wrote % lane row(s), expected 1', v_n;
  END IF;

  SELECT * INTO v_audit FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics' AND action = 'insert';
  IF v_audit.actor_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'WP 3.3: the assignment audit row names actor %, expected % — D36 on this path', v_audit.actor_user_id, v_user;
  END IF;
  IF (v_audit.after ->> 'actor_known') <> 'true' THEN
    RAISE EXCEPTION 'WP 3.3: the assignment audit row still says actor_known=%', v_audit.after ->> 'actor_known';
  END IF;

  -- AND IT IS STILL IDEMPOTENT under the new unique index. A package that adds
  -- unique indexes owes every EXISTING writer this check: assigning a supplier
  -- that is already assigned must be a no-op, not a 23505 at a user who did
  -- nothing wrong.
  PERFORM public.assign_material_supplier(v_project, 'MAT-A', 'SUP-A', v_user, 'wp33d36@example.invalid');
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-A' AND material_id = 'MAT-A';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: assigning the same supplier twice left % row(s), expected 1', v_n;
  END IF;

  RAISE NOTICE 'WP 3.3: assign_material_supplier names its actor and survives the natural-key index (D36, one path)';
END $wp33d36$;
