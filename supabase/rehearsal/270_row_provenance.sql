-- WP 6.3 · §5.4's ACCEPTANCE TEST, EXPORT SIDE.
--
-- `20260919000004` adds `ingest_row_provenance`, which is what lets the dataset
-- workbook answer "which file, which line, which person" for every row. What only a
-- running database can settle:
--
--   1. The natural key comes from `pg_index`. `customers`' key is
--      (project_id, customer_id) and `suppliers`' is (project_id, supplier_id); a
--      function that restated a key would be right for one table and wrong for the
--      next, and the RIGHT answer is whatever the unique index says today.
--   2. EVERY ROW APPEARS, traced or not. A row with no `source_row_id` must come
--      back with `has_provenance = false` and NULLs — an inner join would drop it
--      and the sheet would read as complete while omitting exactly the rows a
--      reader needs to know about.
--   3. The join reaches the FILE through the run, and the two PEOPLE through
--      `approved_users`. Five LEFT JOINs is the kind of thing that type-checks
--      while returning nothing.
--   4. The access gate answers for the NAMED READER, with the GUC poisoned first.
--   5. A table outside the landing path is refused, so the table-name parameter is
--      not a generic reader.
--
-- EVERY COMPARISON IS `IS DISTINCT FROM`, per `rehearsal/260`'s lesson: a plain `<>`
-- against a NULL does not fire, so it cannot fail in the one case worth testing.

DO $wp63prov$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000063200';
  v_other   uuid := '00000000-0000-4000-8000-000000063201';
  v_project uuid := '00000000-0000-4000-8000-000000063202';
  v_res     jsonb;
  v_run     uuid;
  v_rec     record;
  v_n       integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_user, 'wp63prov@example.invalid'), (v_other, 'wp63prov-other@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, display_name) VALUES
    (v_user,  'wp63prov@example.invalid',       'WP63 prov',  'x', 'Ravi Loader'),
    (v_other, 'wp63prov-other@example.invalid', 'WP63 other', 'x', 'Not Allowed');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP63 provenance', v_user, 'WP63P');

  -- One customer through the landing path…
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers-q3.csv', 'ingest', 'p/wp63p/1.csv', 'text/csv', 320,
    repeat('d', 64),
    jsonb_build_array(jsonb_build_object(
      'source_row_number', 5,
      'raw',      jsonb_build_object('customer_id','C-TRACED','name','Traced Co'),
      'parsed',   jsonb_build_object('customer_id','C-TRACED','name','Traced Co'),
      'findings', '[]'::jsonb)));
  v_run := (v_res ->> 'run_id')::uuid;
  PERFORM public.ingest_apply_run(v_run, v_user);

  -- …and one written straight into tier 2, which is what every row in production
  -- that predates the landing path looks like (§4 D88, 8 577 of them).
  INSERT INTO public.customers (project_id, customer_id, name)
    VALUES (v_project, 'C-LEGACY', 'Legacy Co');

  -- ── 1 · THE NATURAL KEY IS THE INDEX'S, AND BOTH ROWS APPEAR ─────────────
  SELECT count(*) INTO v_n
    FROM public.ingest_row_provenance(v_project, v_user, 'customers');
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 6.3 §1: the export lists % row(s), expected 2 — a row with no provenance was dropped', v_n;
  END IF;

  SELECT * INTO v_rec
    FROM public.ingest_row_provenance(v_project, v_user, 'customers')
   WHERE natural_key ->> 'customer_id' = 'C-TRACED';
  IF v_rec.natural_key ->> 'project_id' IS DISTINCT FROM v_project::text THEN
    RAISE EXCEPTION 'WP 6.3 §1: the natural key is %, and `customers`'' unique index is (project_id, customer_id)',
      v_rec.natural_key::text;
  END IF;

  -- ── 2 · THE TRACED ROW NAMES THE FILE, THE LINE AND BOTH PEOPLE ─────────
  IF NOT v_rec.has_provenance THEN
    RAISE EXCEPTION 'WP 6.3 §2: a row promoted through the landing path reports has_provenance = false';
  END IF;
  IF v_rec.original_filename IS DISTINCT FROM 'customers-q3.csv' THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export names file "%" — the run → file join is broken',
      COALESCE(v_rec.original_filename, '<null>');
  END IF;
  IF v_rec.source_row_number IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export reports line %, expected 5', v_rec.source_row_number;
  END IF;
  IF v_rec.content_sha256 IS DISTINCT FROM repeat('d', 64) THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export reports sha256 "%"', COALESCE(v_rec.content_sha256, '<null>');
  END IF;
  IF v_rec.uploaded_by_email IS DISTINCT FROM 'wp63prov@example.invalid' THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export names uploader "%"', COALESCE(v_rec.uploaded_by_email, '<null>');
  END IF;
  IF v_rec.promoted_by_email IS DISTINCT FROM 'wp63prov@example.invalid' THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export names promoter "%"', COALESCE(v_rec.promoted_by_email, '<null>');
  END IF;
  IF v_rec.promoted_at IS NULL OR v_rec.received_at IS NULL THEN
    RAISE EXCEPTION 'WP 6.3 §2: the export carries no date — "a named person on a named date" is the acceptance test''s own wording';
  END IF;

  -- ── 3 · THE UNTRACED ROW IS LISTED AND SAYS SO ──────────────────────────
  SELECT * INTO v_rec
    FROM public.ingest_row_provenance(v_project, v_user, 'customers')
   WHERE natural_key ->> 'customer_id' = 'C-LEGACY';
  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'WP 6.3 §3: the row with no provenance is absent from the export — the sheet would read as complete';
  END IF;
  IF v_rec.has_provenance THEN
    RAISE EXCEPTION 'WP 6.3 §3: a row written straight into tier 2 claims provenance';
  END IF;
  IF v_rec.original_filename IS NOT NULL OR v_rec.source_row_number IS NOT NULL
     OR v_rec.uploaded_by_email IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.3 §3: the untraced row carries a file, a line or a person — unknown is not a value (I6)';
  END IF;

  -- ── 4 · ANOTHER TABLE, ANOTHER KEY, READ FROM THE INDEX ─────────────────
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'suppliers',
    'suppliers-q3.csv', 'ingest', 'p/wp63p/2.csv', 'text/csv', 90,
    repeat('e', 64),
    jsonb_build_array(jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('supplier_id','S-1','name','Acme'),
      'parsed',   jsonb_build_object('supplier_id','S-1','name','Acme'),
      'findings', '[]'::jsonb)));
  PERFORM public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);

  SELECT * INTO v_rec
    FROM public.ingest_row_provenance(v_project, v_user, 'suppliers')
   WHERE natural_key ->> 'supplier_id' = 'S-1';
  IF v_rec.natural_key ? 'customer_id' THEN
    RAISE EXCEPTION 'WP 6.3 §4: `suppliers`'' natural key carries customer_id — the key is restated rather than read';
  END IF;
  IF v_rec.original_filename IS DISTINCT FROM 'suppliers-q3.csv' THEN
    RAISE EXCEPTION 'WP 6.3 §4: the supplier row names file "%"', COALESCE(v_rec.original_filename, '<null>');
  END IF;

  -- ── 5 · THE GATE ANSWERS FOR THE NAMED READER ───────────────────────────
  --
  -- The GUC is poisoned with the OWNER first, so a function that read the session
  -- instead of its parameter would pass this and be wrong.
  PERFORM set_config('app.current_user_id', v_user::text, true);
  BEGIN
    PERFORM * FROM public.ingest_row_provenance(v_project, v_other, 'customers');
    RAISE EXCEPTION 'WP 6.3 §5: a user with no access to the project read its row provenance';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM public.ingest_row_provenance(v_project, NULL, 'customers');
    RAISE EXCEPTION 'WP 6.3 §5: the export answered a read that named no reader';
  EXCEPTION WHEN null_value_not_allowed THEN
    NULL;
  END;

  -- ── 6 · THE TABLE NAME IS NOT A GENERIC READER ──────────────────────────
  BEGIN
    PERFORM * FROM public.ingest_row_provenance(v_project, v_user, 'approved_users');
    RAISE EXCEPTION 'WP 6.3 §6: the export accepted a table outside the landing path';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  RAISE NOTICE 'WP 6.3 §5.4: every row is listed, and each says whether it can be traced';
END $wp63prov$;
