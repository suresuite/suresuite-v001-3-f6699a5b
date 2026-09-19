-- WP 6.2 · THE TENTH DATASET LANDS, AND THE TWO ENGINE-READ COLUMNS ARRIVE.
--
-- `20260919000001` makes `customers` a landable dataset because a GATE said it
-- had to be. WP 6.1 built "no engine-read field is unreachable by both the grid
-- and every upload" as a gate rather than a ratchet, on the grounds that it was
-- empty; §4 D94's declaration of `P-C.2`'s two `Customer` reads made it fire, and
-- the only honest way to satisfy it was to give the table the surface it had
-- never had (§4 D108).
--
-- WHAT ONLY A DATABASE CAN SAY HERE, and each is a claim the migration's text
-- cannot settle:
--
--   1. `ingest_apply_run` builds its INSERT from `pg_attribute` and its arbiter
--      from `pg_index`. Whether `customers_project_customer_key` is the index it
--      INFERS — rather than the surrogate key it does not have — is a property of
--      the running statement.
--   2. `server_set: [project_id]` with NO `plant_name`: the promotion derives the
--      server-set columns per target, and this table has no `plant_name` column
--      at all. A promotion that assumed both would raise 42703 here.
--   3. A BLANK optional cell must land NOTHING and let the column's own DEFAULT
--      stand in. `segment` is NOT NULL DEFAULT 'default' and `priority_weight` is
--      NOT NULL DEFAULT 1.0, so a landing that wrote NULL for a blank would abort
--      — and one that wrote 0 would silently make a customer last in every
--      allocation. Only executing it distinguishes the three.
--   4. The two provenance columns this migration adds are written BY the
--      promotion, not by the caller.
--   5. Re-uploading is an UPSERT on the natural key, not a duplicate row: the
--      table has no surrogate `id`, so a promotion that inserted would violate
--      the unique constraint rather than updating.

DO $wp62cust$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000062200';
  v_project uuid := '00000000-0000-4000-8000-000000062201';
  v_rows    jsonb;
  v_res     jsonb;
  v_run1    uuid;
  v_run2    uuid;
  v_n       integer;
  v_num     numeric;
  v_txt     text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp62cust@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp62cust@example.invalid', 'WP62 customers', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP62 customers', v_user, 'WP62C');

  -- Three customers. C-1 declares both engine-read values; C-2 declares a
  -- priority of ZERO, which is a legitimate lowest priority and not an absence;
  -- C-3 declares neither, so both defaults must stand in.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('customer_id','C-1','segment','strategic','priority_weight','3'),
      'parsed',   jsonb_build_object('customer_id','C-1','name','Northern Retail',
                                     'segment','strategic','priority_weight', 3),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 3,
      'raw',      jsonb_build_object('customer_id','C-2','segment','spot','priority_weight','0'),
      'parsed',   jsonb_build_object('customer_id','C-2','name','Spot Buyer',
                                     'segment','spot','priority_weight', 0),
      'findings', '[]'::jsonb),
    jsonb_build_object(
      'source_row_number', 4,
      'raw',      jsonb_build_object('customer_id','C-3'),
      'parsed',   jsonb_build_object('customer_id','C-3'),
      'findings', '[]'::jsonb));

  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers.csv', 'ingest', 'p/wp62/1.csv', 'text/csv', 256,
    repeat('c', 64), v_rows);
  v_run1 := (v_res ->> 'run_id')::uuid;

  -- ── 1 · IT LANDS IN TIER 0 + TIER 1 AND NOT IN TIER 2 (I2) ────────────────
  --
  -- `no-tier-skip` says external data never lands below T1. The landing must
  -- have written three staged rows and NOTHING into `customers` yet.
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run1 AND target_table = 'customers';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: the landing staged % row(s) for customers, expected 3', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.customers WHERE project_id = v_project;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 6.2: % customer row(s) reached tier 2 at LANDING time — the landing skipped a tier (I2)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.ingest_files WHERE ingest_run_id = v_run1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 6.2: the landing wrote % tier-0 manifest row(s), expected 1', v_n;
  END IF;

  -- ── 2 · THE PROMOTION RESOLVES THE ARBITER AND THE SERVER-SET COLUMNS ─────
  v_res := public.ingest_apply_run(v_run1, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: the promotion moved % row(s), expected 3 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;
  IF (v_res ->> 'rows_updated')::int <> 0 THEN
    RAISE EXCEPTION 'WP 6.2: the FIRST promotion reported % updated row(s); nothing existed to update',
      v_res ->> 'rows_updated';
  END IF;

  -- `project_id` came from the RUN and never from the file.
  SELECT count(*) INTO v_n FROM public.customers WHERE project_id = v_project;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: tier 2 holds % customer row(s) for this project, expected 3', v_n;
  END IF;

  -- ── 3 · THE TWO ENGINE-READ COLUMNS HOLD WHAT THE FILE SAID ──────────────
  --
  -- This is the whole point of the package: `P-C.2` reads these on every run and
  -- until now a user could not set them from anywhere in the product (§4 D94).
  SELECT segment, priority_weight INTO v_txt, v_num
    FROM public.customers WHERE project_id = v_project AND customer_id = 'C-1';
  IF v_txt <> 'strategic' OR v_num <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: C-1 promoted as segment=%, priority_weight=%; expected strategic / 3',
      v_txt, v_num;
  END IF;

  -- ZERO IS A VALUE. `min: 0` and not `exclusive_min: 0` is deliberate — only the
  -- ratio between two customers means anything, so 0 is the lowest priority
  -- there is and the engine reads it correctly. A rule that rejected it would
  -- refuse a legitimate file; a promotion that turned it into the DEFAULT 1.0
  -- would silently promote a spot buyer to parity with everybody else.
  SELECT priority_weight INTO v_num
    FROM public.customers WHERE project_id = v_project AND customer_id = 'C-2';
  IF v_num <> 0 THEN
    RAISE EXCEPTION 'WP 6.2: C-2 declared priority_weight 0 and landed as % — a declared zero was read as an absence', v_num;
  END IF;

  -- ── 4 · A BLANK OPTIONAL CELL LETS THE COLUMN'S DEFAULT STAND IN ─────────
  --
  -- Both columns are NOT NULL WITH A DEFAULT. The landing lands no value for a
  -- blank optional cell, so the DEFAULT applies — which is a SUBSTITUTION and
  -- not a reading, and §5 T2 is why the row's own values are asserted here
  -- rather than assumed from the column definition.
  SELECT segment, priority_weight INTO v_txt, v_num
    FROM public.customers WHERE project_id = v_project AND customer_id = 'C-3';
  IF v_txt <> 'default' THEN
    RAISE EXCEPTION 'WP 6.2: C-3 gave no segment and holds "%"; expected the column DEFAULT ''default'' to stand in', v_txt;
  END IF;
  IF v_num <> 1.0 THEN
    RAISE EXCEPTION 'WP 6.2: C-3 gave no priority_weight and holds %; expected the column DEFAULT 1.0', v_num;
  END IF;

  -- ── 5 · PROVENANCE REACHES THE LINE OF THE FILE (A4) ─────────────────────
  SELECT count(*) INTO v_n FROM public.customers
   WHERE project_id = v_project AND (ingest_run_id IS NULL OR source_row_id IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 6.2: % promoted customer row(s) carry no run or no source row', v_n;
  END IF;

  SELECT s.source_row_number INTO v_n
    FROM public.customers c
    JOIN public.ingest_staged_rows s ON s.id = c.source_row_id
   WHERE c.project_id = v_project AND c.customer_id = 'C-2';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: C-2 traces to file line %, expected 3', v_n;
  END IF;

  -- ── 6 · THE AUDIT ROW NAMES THE ACTOR, AT BOTH TIERS (G4) ────────────────
  --
  -- The table has had its three triggers since it was adopted; what is new is
  -- that a WRITE now happens through the promotion, so the trigger has an actor
  -- to name. `ingest_apply_run` sets `app.current_user_id` LOCAL to its own
  -- transaction, which no migration text can demonstrate.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'customers' AND actor_user_id = v_user;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 6.2: the tier-2 write on customers left no audit row naming the promoter (G4)';
  END IF;

  -- And the row must be at STATEMENT grain, saying three rows once rather than
  -- one row three times — the property `010` proves for the audit trigger in
  -- general and that a per-row promotion would break for this target alone.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'customers' AND action = 'insert';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 6.2: promoting 3 customers wrote % insert audit row(s), expected exactly 1 (statement grain)', v_n;
  END IF;

  SELECT (a.after ->> 'rows_after')::int INTO v_n
    FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'customers' AND a.action = 'insert';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: the audit row counts % customer row(s), expected 3', v_n;
  END IF;

  -- ── 7 · RE-UPLOADING UPSERTS ON THE NATURAL KEY ──────────────────────────
  --
  -- There is NO surrogate `id` on this table, so a promotion that inserted would
  -- raise 23505 on `customers_project_customer_key` rather than producing a
  -- duplicate. The claim being tested is that the arbiter is INFERRED: C-1's
  -- priority changes and no fourth row appears.
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'source_row_number', 2,
      'raw',      jsonb_build_object('customer_id','C-1','priority_weight','9'),
      'parsed',   jsonb_build_object('customer_id','C-1','name','Northern Retail',
                                     'segment','strategic','priority_weight', 9),
      'findings', '[]'::jsonb));

  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers.csv', 'ingest', 'p/wp62/2.csv', 'text/csv', 128,
    repeat('d', 64), v_rows);
  v_run2 := (v_res ->> 'run_id')::uuid;
  v_res := public.ingest_apply_run(v_run2, v_user);

  IF (v_res ->> 'rows_updated')::int <> 1 THEN
    RAISE EXCEPTION 'WP 6.2: the re-upload reported % updated row(s), expected 1 — the promotion inserted instead of upserting on the natural key (I4)',
      v_res ->> 'rows_updated';
  END IF;

  SELECT count(*) INTO v_n FROM public.customers WHERE project_id = v_project;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 6.2: re-uploading one customer left % row(s), expected 3', v_n;
  END IF;

  SELECT priority_weight INTO v_num
    FROM public.customers WHERE project_id = v_project AND customer_id = 'C-1';
  IF v_num <> 9 THEN
    RAISE EXCEPTION 'WP 6.2: C-1 was re-uploaded at 9 and holds % — the upsert did not update the value', v_num;
  END IF;

  -- The re-upload must also re-point the provenance, or a row claims a file it
  -- was not last written from.
  SELECT c.ingest_run_id INTO v_txt
    FROM public.customers c WHERE c.project_id = v_project AND c.customer_id = 'C-1';
  IF v_txt::uuid <> v_run2 THEN
    RAISE EXCEPTION 'WP 6.2: C-1 was last written by run % and still names % — provenance survived the row it describes',
      v_run2, v_txt;
  END IF;

  -- ── 8 · A NON-PROMOTABLE TARGET IS STILL REFUSED ─────────────────────────
  --
  -- The mutation case for section 2: widening the list must not have widened it
  -- to everything. `ingest_target_is_promotable` is the guard, and an injection
  -- through `_target_table` is what it exists to stop.
  BEGIN
    v_res := public.ingest_land_file(
      v_project, v_user, 'csv', 'master', 'approved_users',
      'nope.csv', 'ingest', 'p/wp62/3.csv', 'text/csv', 16,
      repeat('e', 64), jsonb_build_array(jsonb_build_object(
        'source_row_number', 2, 'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('email','x@y.invalid'), 'findings', '[]'::jsonb)));
    v_run2 := (v_res ->> 'run_id')::uuid;
    PERFORM public.ingest_apply_run(v_run2, v_user);
    RAISE EXCEPTION 'WP 6.2: a promotion into `approved_users` SUCCEEDED — the promotable list is not a guard';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;   -- the guard fired, which is the assertion
  END;

  -- ── 9 · D113 · THE SAME CASE ON A LIVE DATASET, WHICH IS WHY IT MATTERS ──
  --
  -- This section is the reason §4 D113 is a defect and not a note about a new
  -- table. `suppliers` has been landable since WP 3.3 and
  -- `suppliers.reliability_score` is NOT NULL DEFAULT 1.0 with
  -- `required: false` — so a file where ONE row leaves it blank aborted the
  -- WHOLE promotion, and the user lost the upload to a constraint message about
  -- a cell they deliberately left empty.
  --
  -- The shipped template fills the column on all three of its rows, which is
  -- exactly why this went unnoticed: the template never exercises the case the
  -- contract permits. This is the mutation case for section 4 — reverting the
  -- COALESCE in `ingest_promotion_plan` turns THIS red, on a dataset that
  -- shipped three packages ago.
  DECLARE
    v_sup_project uuid := '00000000-0000-4000-8000-000000062202';
    v_sup_run     uuid;
  BEGIN
    INSERT INTO public.projects (id, name, modeler_id, plant_name)
      VALUES (v_sup_project, 'WP62 suppliers blank', v_user, 'WP62S');

    v_res := public.ingest_land_file(
      v_sup_project, v_user, 'csv', 'master', 'suppliers',
      'suppliers.csv', 'ingest', 'p/wp62/4.csv', 'text/csv', 128,
      repeat('ab', 32),
      jsonb_build_array(
        jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
          'parsed', jsonb_build_object('supplier_id','S0001','name','Acme',
                                       'capacity_per_week', 5000,
                                       'reliability_score', 0.98),
          'findings', '[]'::jsonb),
        -- the row that used to abort the statement
        jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
          'parsed', jsonb_build_object('supplier_id','S0002','name','Global Metals'),
          'findings', '[]'::jsonb)));
    v_sup_run := (v_res ->> 'run_id')::uuid;
    v_res := public.ingest_apply_run(v_sup_run, v_user);

    IF (v_res ->> 'rows_promoted')::int <> 2 THEN
      RAISE EXCEPTION 'WP 6.2 / D113: a suppliers file with one blank reliability_score promoted % row(s), expected 2',
        v_res ->> 'rows_promoted';
    END IF;

    -- The declared value survives…
    SELECT reliability_score INTO v_num FROM public.suppliers
     WHERE project_id = v_sup_project AND supplier_id = 'S0001';
    IF round(v_num, 4) <> 0.98 THEN
      RAISE EXCEPTION 'WP 6.2 / D113: S0001 declared 0.98 and holds % — the COALESCE swallowed a real value', v_num;
    END IF;

    -- …and the blank one takes the column's OWN default, not a number typed
    -- into a migration. 1.0 is what `pg_attrdef` holds; if the column's default
    -- changes, this assertion follows it, which is the whole reason the fix
    -- reads the catalog.
    SELECT reliability_score INTO v_num FROM public.suppliers
     WHERE project_id = v_sup_project AND supplier_id = 'S0002';
    IF v_num IS NULL THEN
      RAISE EXCEPTION 'WP 6.2 / D113: S0002 holds NULL in a NOT NULL column — impossible, so the plan changed shape';
    END IF;
    IF v_num <> (SELECT (pg_get_expr(ad.adbin, ad.adrelid))::numeric
                   FROM pg_attrdef ad
                   JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
                  WHERE ad.adrelid = 'public.suppliers'::regclass AND a.attname = 'reliability_score') THEN
      RAISE EXCEPTION 'WP 6.2 / D113: S0002 left the cell blank and holds %, which is not the column''s own DEFAULT', v_num;
    END IF;
  END;

  -- ── 10 · A NOT NULL COLUMN WITH NO DEFAULT STILL FAILS, LOUDLY ───────────
  --
  -- The mutation case for the WRAP's condition. `COALESCE` is applied only when
  -- the column has a default; a NOT NULL column with none must still refuse the
  -- row rather than having its error moved somewhere less legible. `customer_id`
  -- is that column — NOT NULL, no default, and `blank: reject` — so a staged row
  -- omitting it must not reach tier 2.
  DECLARE
    v_bad_run uuid;
  BEGIN
    v_res := public.ingest_land_file(
      v_project, v_user, 'csv', 'master', 'customers',
      'customers.csv', 'ingest', 'p/wp62/5.csv', 'text/csv', 64,
      repeat('cd', 32),
      jsonb_build_array(jsonb_build_object(
        'source_row_number', 2, 'raw', '{}'::jsonb,
        'parsed',   jsonb_build_object('name','No Id At All'),
        -- the landing's own validator marks it; the promotion must skip it
        'findings', jsonb_build_array(jsonb_build_object(
          'level','error','field','customer_id','code','required_blank','row',2,
          'message','Row 2, column "customer_id": required and blank.')))));
    v_bad_run := (v_res ->> 'run_id')::uuid;
    v_res := public.ingest_apply_run(v_bad_run, v_user);
    IF (v_res ->> 'rows_promoted')::int <> 0 THEN
      RAISE EXCEPTION 'WP 6.2: a row with an error finding promoted % row(s); expected 0',
        v_res ->> 'rows_promoted';
    END IF;
    SELECT count(*) INTO v_n FROM public.customers
     WHERE project_id = v_project AND name = 'No Id At All';
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'WP 6.2: a keyless customer row reached tier 2';
    END IF;
  END;

  RAISE NOTICE 'WP 6.2 · 230: customers lands, promotes, upserts and attributes; D113 on suppliers too — 10 section(s)';
END $wp62cust$;
