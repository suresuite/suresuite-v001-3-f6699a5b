-- WP 6.3 · §5.4 A2 — THE VALUE CHAIN ANSWERS, AND ANSWERS ONCE.
--
-- `20260919000003` adds `ingest_value_chain`. What only a running database can
-- settle, and each is a claim the migration's text cannot:
--
--   1. The chain REACHES the file through the run. `ingest_files` carries no
--      `project_id` by design, so the join is staged row → run → file, and a
--      rehearsal is the only thing that proves the path is connected rather than
--      merely plausible.
--   2. It returns EXACTLY ONE ROW IN BOTH MODES. The provenance mode joins five
--      tables; the no-provenance mode joins the same five against a NULL staged
--      row and must still return one row. An inner join would return zero, and
--      zero rows renders as "failed to load" — the failure the function's
--      contract exists to rule out.
--   3. `raw` comes back keyed by the header the FILE carried and `parsed` by the
--      TIER-2 COLUMN name. Those are different key spaces and the popover picks
--      from both, so a function that returned one in place of the other would
--      look right and show the wrong cell.
--   4. Freshness counts only LATER applied runs of the SAME target — and in the
--      no-provenance mode it counts every applied run, because there is no
--      `applied_at` to be later than. Both halves are arithmetic over rows.
--   5. The access gate answers for the NAMED READER, not for whoever the
--      connection last belonged to. That is the GUC being set LOCAL, and a text
--      scan cannot see it.
--   6. It refuses a target table outside the landing path, so the second mode's
--      table-name parameter is not a generic reader.
--
-- EVERY COMPARISON HERE IS `IS DISTINCT FROM`, AND A MUTATION IS WHY. The first
-- draft of §3 read `IF v_chain.raw ->> 'priority_weight' <> '' THEN`. The mutation
-- that returns `parsed` where `raw` belongs — the exact confusion §3 exists to
-- catch — PASSED it: `parsed` has no such key, `->>` gave NULL, `NULL <> ''` is
-- NULL, and `IF NULL` does not fire. A plain `<>` in an assertion is a test that
-- cannot fail when the value goes missing, which is the one case worth testing.

DO $wp63vc$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000063100';
  v_other    uuid := '00000000-0000-4000-8000-000000063101';
  v_project  uuid := '00000000-0000-4000-8000-000000063102';
  v_rows     jsonb;
  v_res      jsonb;
  v_run1     uuid;
  v_run2     uuid;
  v_srow     uuid;
  v_chain    record;
  v_n        integer;
  v_caught   text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_user,  'wp63vc@example.invalid'),
    (v_other, 'wp63vc-other@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, display_name) VALUES
    (v_user,  'wp63vc@example.invalid',       'WP63 chain',  'x', 'Dana Uploader'),
    (v_other, 'wp63vc-other@example.invalid', 'WP63 other',  'x', 'Someone Else');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP63 value chain', v_user, 'WP63V');

  -- Two customers. C-1 fills both optional cells; C-2 leaves them blank, so its
  -- `raw` carries a header the `parsed` side does not, which is the asymmetry
  -- section 3 is about.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('customer_id','C-1','name','Northern Retail',
                                     'segment','strategic','priority_weight','3'),
      'parsed',   jsonb_build_object('customer_id','C-1','name','Northern Retail',
                                     'segment','strategic','priority_weight', 3),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 7,
      'raw',      jsonb_build_object('customer_id','C-2','name','Spot Buyer',
                                     'segment','','priority_weight',''),
      'parsed',   jsonb_build_object('customer_id','C-2','name','Spot Buyer'),
      'findings', jsonb_build_array(jsonb_build_object(
        'level','info','field','segment','code','blank','message','left empty'))));

  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers-may.csv', 'ingest', 'p/wp63/1.csv', 'text/csv', 411,
    repeat('a', 64), v_rows);
  v_run1 := (v_res ->> 'run_id')::uuid;
  PERFORM public.ingest_apply_run(v_run1, v_user);

  SELECT source_row_id INTO v_srow
    FROM public.customers WHERE project_id = v_project AND customer_id = 'C-2';
  IF v_srow IS NULL THEN
    RAISE EXCEPTION 'WP 6.3 §0: the promotion left C-2 with no source_row_id — the chain has nothing to expand';
  END IF;

  -- ── 1 · THE CHAIN REACHES THE FILE, AND IT IS ONE ROW ─────────────────────
  SELECT count(*) INTO v_n FROM public.ingest_value_chain(v_user, v_srow);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 6.3 §1: the chain returned % row(s) for a provenanced row, expected exactly 1', v_n;
  END IF;

  SELECT * INTO v_chain FROM public.ingest_value_chain(v_user, v_srow);
  IF NOT v_chain.has_provenance THEN
    RAISE EXCEPTION 'WP 6.3 §1: a row promoted through the landing path reported has_provenance = false';
  END IF;
  IF v_chain.original_filename IS DISTINCT FROM 'customers-may.csv' THEN
    RAISE EXCEPTION 'WP 6.3 §1: the chain names file "%", expected customers-may.csv — the run → file join is broken',
      COALESCE(v_chain.original_filename, '<null>');
  END IF;
  IF v_chain.content_sha256 IS DISTINCT FROM repeat('a', 64) THEN
    RAISE EXCEPTION 'WP 6.3 §1: the chain reports sha256 "%", not the bytes that were landed',
      COALESCE(v_chain.content_sha256, '<null>');
  END IF;
  IF v_chain.byte_size IS DISTINCT FROM 411 THEN
    RAISE EXCEPTION 'WP 6.3 §1: the chain reports % bytes, expected 411', v_chain.byte_size;
  END IF;

  -- ── 2 · THE PHYSICAL LINE, AND THE TWO PEOPLE ────────────────────────────
  --
  -- The line is what makes "show me the source row" a lookup rather than a
  -- reconstruction. 7, not 2: the second data row of the file sits on line 7
  -- here precisely so an off-by-position implementation fails.
  IF v_chain.source_row_number IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'WP 6.3 §2: the chain reports line %, expected 7 — the line is positional, not ordinal',
      v_chain.source_row_number;
  END IF;
  IF v_chain.uploaded_by_name IS DISTINCT FROM 'Dana Uploader' THEN
    RAISE EXCEPTION 'WP 6.3 §2: the chain names uploader "%", expected Dana Uploader',
      COALESCE(v_chain.uploaded_by_name, '<null>');
  END IF;
  IF v_chain.promoted_by_name IS DISTINCT FROM 'Dana Uploader' THEN
    RAISE EXCEPTION 'WP 6.3 §2: the chain names promoter "%" — `ingest_apply_run` records who approved the promotion',
      COALESCE(v_chain.promoted_by_name, '<null>');
  END IF;
  IF v_chain.promoted_at IS NULL OR v_chain.received_at IS NULL THEN
    RAISE EXCEPTION 'WP 6.3 §2: the chain has no received_at/promoted_at — a date is half of "who, when"';
  END IF;

  -- ── 3 · TWO KEY SPACES, AND THE POPOVER READS BOTH ───────────────────────
  --
  -- `raw` is keyed by the header the file carried; `parsed` by the tier-2 column.
  -- On this row they are DELIBERATELY different: `segment` arrived as the empty
  -- string and validation established no value, so `raw` has the key and `parsed`
  -- does not. A function that returned `parsed` twice would pass every shape
  -- check and show a user an empty cell for a cell their file filled in.
  IF NOT (v_chain.raw ? 'priority_weight')
     OR v_chain.raw ->> 'priority_weight' IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'WP 6.3 §3: raw.priority_weight is "%", expected the empty string the file carried',
      COALESCE(v_chain.raw ->> 'priority_weight', '<absent>');
  END IF;
  IF v_chain.parsed ? 'priority_weight' THEN
    RAISE EXCEPTION 'WP 6.3 §3: parsed carries priority_weight for a blank cell — absent says "no value was established", null says "the file said empty" (D7)';
  END IF;
  IF v_chain.parsed ->> 'name' IS DISTINCT FROM 'Spot Buyer' THEN
    RAISE EXCEPTION 'WP 6.3 §3: parsed.name is "%", so the two key spaces have been confused',
      COALESCE(v_chain.parsed ->> 'name', '<absent>');
  END IF;
  IF COALESCE(jsonb_array_length(v_chain.findings), -1) <> 1 THEN
    RAISE EXCEPTION 'WP 6.3 §3: the chain carries % finding(s), expected the one the landing recorded',
      jsonb_array_length(v_chain.findings);
  END IF;

  -- ── 4 · FRESHNESS COUNTS LATER RUNS OF THE SAME TARGET ───────────────────
  IF v_chain.later_uploads IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.3 §4: one upload exists and the chain counts % later one(s)', v_chain.later_uploads;
  END IF;

  -- A second upload of the SAME dataset, applied after the first.
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers-june.csv', 'ingest', 'p/wp63/2.csv', 'text/csv', 500,
    repeat('b', 64), jsonb_build_array(jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('customer_id','C-9','name','New Buyer'),
      'parsed',   jsonb_build_object('customer_id','C-9','name','New Buyer'),
      'findings', '[]'::jsonb)));
  v_run2 := (v_res ->> 'run_id')::uuid;
  PERFORM public.ingest_apply_run(v_run2, v_user);

  SELECT * INTO v_chain FROM public.ingest_value_chain(v_user, v_srow);
  IF v_chain.later_uploads IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 6.3 §4: after a second applied upload the chain counts % later one(s), expected 1',
      v_chain.later_uploads;
  END IF;
  IF v_chain.latest_upload_at IS NULL THEN
    RAISE EXCEPTION 'WP 6.3 §4: the chain reports later uploads and no date for the newest';
  END IF;

  -- A run for a DIFFERENT target must not count. `suppliers` is landable and is
  -- not this row's dataset.
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'suppliers',
    'suppliers.csv', 'ingest', 'p/wp63/3.csv', 'text/csv', 120,
    repeat('c', 64), jsonb_build_array(jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('supplier_id','S-1','name','Acme'),
      'parsed',   jsonb_build_object('supplier_id','S-1','name','Acme'),
      'findings', '[]'::jsonb)));
  PERFORM public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);

  SELECT * INTO v_chain FROM public.ingest_value_chain(v_user, v_srow);
  IF v_chain.later_uploads IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 6.3 §4: a `suppliers` upload was counted against a `customers` row — the count is not scoped to the target (now %)',
      v_chain.later_uploads;
  END IF;

  -- ── 5 · THE NO-PROVENANCE MODE STILL RETURNS ONE ROW ─────────────────────
  --
  -- 8 577 rows in production predate the landing path. Their provenance is
  -- UNKNOWN, and the difference between "unknown" and a blank popover is the
  -- whole of T2 at this point of display.
  SELECT count(*) INTO v_n
    FROM public.ingest_value_chain(v_user, NULL, v_project, 'customers');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 6.3 §5: the no-provenance mode returned % row(s); zero renders as "failed to load"', v_n;
  END IF;

  SELECT * INTO v_chain
    FROM public.ingest_value_chain(v_user, NULL, v_project, 'customers');
  IF v_chain.has_provenance THEN
    RAISE EXCEPTION 'WP 6.3 §5: the no-provenance mode claimed has_provenance = true';
  END IF;
  IF v_chain.original_filename IS NOT NULL OR v_chain.source_row_number IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.3 §5: the no-provenance mode invented a file or a line — unknown is not a value (I6)';
  END IF;
  -- Every applied `customers` run counts, because there is no applied_at to be
  -- later than: two were applied above.
  IF v_chain.later_uploads IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 6.3 §5: with no provenance the chain counts % applied `customers` upload(s), expected 2',
      v_chain.later_uploads;
  END IF;
  IF v_chain.target_table IS DISTINCT FROM 'customers' THEN
    RAISE EXCEPTION 'WP 6.3 §5: the chain reports target "%"', COALESCE(v_chain.target_table, '<null>');
  END IF;

  -- ── 6 · THE GATE ANSWERS FOR THE NAMED READER ────────────────────────────
  --
  -- `v_other` is a real approved user with no claim on this project. The GUC is
  -- deliberately poisoned with the OWNER first, so a function that read the
  -- session instead of its parameter would pass this and be wrong.
  PERFORM set_config('app.current_user_id', v_user::text, true);
  BEGIN
    PERFORM * FROM public.ingest_value_chain(v_other, v_srow);
    RAISE EXCEPTION 'WP 6.3 §6: a user with no access to the project read its value chain';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- And a NULL reader is refused rather than defaulted.
  BEGIN
    PERFORM * FROM public.ingest_value_chain(NULL, v_srow);
    RAISE EXCEPTION 'WP 6.3 §6: the chain answered a read that named no reader';
  EXCEPTION WHEN null_value_not_allowed THEN
    NULL;
  END;

  -- ── 7 · THE TABLE NAME IS NOT A GENERIC READER ───────────────────────────
  BEGIN
    PERFORM * FROM public.ingest_value_chain(v_user, NULL, v_project, 'approved_users');
    RAISE EXCEPTION 'WP 6.3 §7: the chain accepted a target table outside the landing path';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- And a staged row that does not exist is an error, not an empty answer: the
  -- caller passed an id it got from a row, so a miss means the chain is broken.
  BEGIN
    PERFORM * FROM public.ingest_value_chain(v_user, '00000000-0000-4000-8000-0000000630ff');
    RAISE EXCEPTION 'WP 6.3 §7: the chain answered for a staged row that does not exist';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;

  RAISE NOTICE 'WP 6.3 §5.4 A2: the value chain answers in both modes, once each';
END $wp63vc$;
