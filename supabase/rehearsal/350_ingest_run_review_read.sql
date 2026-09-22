-- WP 6.5a · D169 — THE REVIEW SCREEN CAN READ THE RUN IT JUST LANDED.
--
-- The first production upload landed (tier 0 + tier 1, §15 run `35783395994`) and the
-- person who made it saw nothing: `useIngestRun` read the three `ingest_*` tables as
-- `anon`, their only policy is `TO authenticated`, and RLS answers a refused read with
-- ZERO ROWS rather than an error — so the panel rendered `null` and no run could be
-- promoted. Every claim here is about what the database DOES for a particular role,
-- which no source-level test can make.
--
-- §1 reproduces the defect in production's shape: an uploader who exists ONLY in
--    `approved_users` (no `auth.users` row — 0 of 14 real ones have one), a landed run,
--    and `anon` reading `ingest_runs` directly gets nothing. RLS is ENABLED here by the
--    file itself and restored after, because a base whose RLS is off would let `anon`
--    read everything and the assertion would pass for the wrong reason (§16 · WP 4.1 · E).
-- §2 the RPC, called AS `anon`, returns the run, its file and its rows in line order.
-- §3 a reader without access is REFUSED (42501), never handed an empty review.
-- §4 an unknown run and a NULL reader are refused, each with its own code.
-- §5 the GUC is set with is_local = true (pinned on the source; see §5 for why not behaviourally).

DO $wp65read$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_project  uuid := gen_random_uuid();
  v_run      uuid;
  v_review   jsonb;
  v_rows     integer;
  v_rls_was  boolean;
  v_code     text;
BEGIN
  INSERT INTO public.approved_users (id, name, email, password_hash, role) VALUES
    (v_user,     'WP65 reviewer', 'wp65r@example.invalid', 'x', 'user'),
    (v_outsider, 'WP65 outsider', 'wp65o@example.invalid', 'x', 'user');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP65 review', v_user, 'WP65R');

  -- Two rows landed OUT of line order, so §2's ordering assertion can fail.
  v_run := (public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'review.csv', 'ingest', 'wp65r/review.csv', 'text/csv', 64, repeat('c', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 7,
        'raw', jsonb_build_object('customer_id', 'C-7'),
        'parsed', jsonb_build_object('customer_id', 'C-7'), 'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 2,
        'raw', jsonb_build_object('customer_id', 'C-2'),
        'parsed', jsonb_build_object('customer_id', 'C-2'), 'findings', '[]'::jsonb))
  ) ->> 'run_id')::uuid;

  -- ══ §1 · the defect: anon reads the table and gets NOTHING, silently ══
  SELECT relrowsecurity INTO v_rls_was FROM pg_class WHERE oid = 'public.ingest_runs'::regclass;
  ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;
  PERFORM set_config('app.current_user_id', v_user::text, true);
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_rows FROM public.ingest_runs WHERE id = v_run;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rows := 0;   -- no grant at all is the same answer for the screen: nothing to show
  END;
  PERFORM set_config('app.current_user_id', '', true);
  IF NOT v_rls_was THEN
    ALTER TABLE public.ingest_runs DISABLE ROW LEVEL SECURITY;
  END IF;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'WP 6.5a/350 §1: anon read % row(s) of ingest_runs directly — the premise of D169 is wrong, re-measure before trusting this fix',
      v_rows;
  END IF;

  -- ══ §2 · the RPC, AS anon, returns the whole review ══
  SET LOCAL ROLE anon;
  v_review := public.ingest_run_review(v_user, v_run);
  RESET ROLE;

  IF (v_review -> 'run' ->> 'id')::uuid IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'WP 6.5a/350 §2: the review names run %, expected %', v_review -> 'run' ->> 'id', v_run;
  END IF;
  IF v_review -> 'run' ->> 'status' IS DISTINCT FROM 'staged' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §2: a freshly landed run reads status "%", expected staged', v_review -> 'run' ->> 'status';
  END IF;
  IF v_review -> 'file' ->> 'original_filename' IS DISTINCT FROM 'review.csv' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §2: the review''s file is %, expected review.csv — the run → file join is broken', v_review -> 'file';
  END IF;
  IF jsonb_array_length(v_review -> 'rows') <> 2 THEN
    RAISE EXCEPTION 'WP 6.5a/350 §2: the review carries % staged row(s), expected 2', jsonb_array_length(v_review -> 'rows');
  END IF;
  IF (v_review -> 'rows' -> 0 ->> 'source_row_number')::int IS DISTINCT FROM 2
     OR (v_review -> 'rows' -> 1 ->> 'source_row_number')::int IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'WP 6.5a/350 §2: rows are not in line order: %', v_review -> 'rows';
  END IF;

  -- ══ §3 · a reader without access is REFUSED, not shown a blank ══
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    v_review := public.ingest_run_review(v_outsider, v_run);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_code := SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §3: an outsider''s read ended with SQLSTATE %, expected 42501 — a review must refuse, never empty', COALESCE(v_code, '(none — it returned a review)');
  END IF;

  -- ══ §4 · unknown run and NULL reader ══
  v_code := NULL;
  BEGIN
    v_review := public.ingest_run_review(v_user, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §4: an unknown run ended with SQLSTATE %, expected P0002 (no_data_found)', COALESCE(v_code, '(none)');
  END IF;
  v_code := NULL;
  BEGIN
    v_review := public.ingest_run_review(NULL, v_run);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '22004' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §4: a NULL reader ended with SQLSTATE %, expected 22004 (null_value_not_allowed)', COALESCE(v_code, '(none)');
  END IF;

  RAISE NOTICE 'WP 6.5a/350: an approved-users-only reader, calling as anon, reads its run through ingest_run_review; outsiders, unknown runs and NULL readers are refused';
END $wp65read$;

-- ══ §5 · the GUC it sets is LOCAL ══
-- Not measurable behaviourally HERE: the runner wraps each file in one BEGIN … ROLLBACK,
-- so a LOCAL setting correctly survives every statement of this file — the first draft
-- asserted the opposite and failed for exactly that reason. What can be pinned is the
-- call itself: `is_local` must be `true`, or the reader's id would outlive the request on
-- a pooled connection and answer `has_project_access` for the NEXT caller.
DO $wp65guc$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.ingest_run_review(uuid, uuid)'::regprocedure)
     NOT LIKE '%set_config(''app.current_user_id'', p_user_id::text, true)%' THEN
    RAISE EXCEPTION 'WP 6.5a/350 §5: ingest_run_review no longer sets app.current_user_id with is_local = true';
  END IF;
END $wp65guc$;
