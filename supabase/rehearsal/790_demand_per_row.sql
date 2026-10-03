-- Phase 14 / WP 14.2 · DEMAND PER CUSTOMER × PRODUCT ROW REACHES THE SNAPSHOT.
--
-- `20261003000001` gives the per-row demand spec a home on `outbound_logistics`,
-- adds the forecast table, and puts both into the snapshot's `inputs` domain (the
-- simulation scope). What only a database can say:
--
--   1. The row spec's rates normalize at promotion: a monthly `demand_mean` lands
--      weekly and the row's `time_unit` reads `week` (I3).
--   2. A forecast lands in tier 0 + 1, is promoted by `ingest_apply_run` on its
--      natural key, and the promoting statement spreads a MONTHLY bucket evenly
--      over its own days (decision 7): 1 000 over a 31-day December is
--      1 000 × 7 / 31 per week, and the bucket ends on 1 January.
--   3. The snapshot carries both — and a project that sets neither keeps its
--      snapshot text, so no existing hash moves.
--   4. Changing a forecast moves `hash_inputs` (the simulation scope).
--   5. The promotion names its actor in the tier-2 audit (G4); a re-upload
--      upserts; a bucket that is neither a week nor a month is refused.

DO $wp142$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000014200';
  v_project  uuid := '00000000-0000-4000-8000-000000014201';
  v_plain    uuid := '00000000-0000-4000-8000-000000014202';
  v_org      uuid := '00000000-0000-4000-8000-000000014203';
  v_rows     jsonb;
  v_res      jsonb;
  v_run      uuid;
  v_n        integer;
  v_num      numeric;
  v_txt      text;
  v_date     date;
  v_snap     jsonb;
  v_elem     jsonb;
  v_h1       text;
  v_h2       text;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP14.2 org', 'wp142-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp142@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active)
    VALUES (v_user, 'wp142@example.invalid', 'WP14.2', 'x', 'modeler', 'WP14.2 org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP14.2 rows', v_user, 'WP142', 'WP14.2 org', v_org),
           (v_plain,   'WP14.2 plain', v_user, 'WP142P', 'WP14.2 org', v_org);

  -- ── 1 · the row spec lands and its rates normalize at promotion ──────────
  --
  -- C1 states a monthly mean: 60.875 per month is exactly 14 per week on the
  -- 30.4375-day month (`rate_to_weekly`). C2 states no spec at all.
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2,
      'raw', jsonb_build_object('customer_id', 'C1'),
      'parsed', jsonb_build_object('customer_id', 'C1', 'product_id', 'P1',
        'volume', 60.875, 'time_unit', 'month', 'expected_lead_time', 1, 'unit_price', 10,
        'demand_distribution', 'normal', 'demand_mean', 60.875, 'demand_variation', 0.2),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3,
      'raw', jsonb_build_object('customer_id', 'C2'),
      'parsed', jsonb_build_object('customer_id', 'C2', 'product_id', 'P1',
        'volume', 40, 'time_unit', 'week', 'expected_lead_time', 1, 'unit_price', 12),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'outbound_logistics',
    'outbound.csv', 'ingest', 'p/wp142/out.csv', 'text/csv', 200, repeat('a', 64), v_rows);
  v_run := (v_res ->> 'run_id')::uuid;
  v_res := public.ingest_apply_run(v_run, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 14.2: the outbound promotion moved % row(s), expected 2 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  SELECT demand_mean, time_unit, demand_distribution INTO v_num, v_txt, v_elem
    FROM (SELECT demand_mean, time_unit, to_jsonb(demand_distribution) AS demand_distribution
            FROM public.outbound_logistics WHERE project_id = v_project AND customer_id = 'C1') x;
  IF abs(v_num - 14) > 1e-9 OR v_txt <> 'week' OR v_elem <> to_jsonb('normal'::text) THEN
    RAISE EXCEPTION 'WP 14.2: C1 promoted demand_mean % / time_unit % / distribution %; expected 14 / week / normal (I3)',
      v_num, v_txt, v_elem;
  END IF;
  SELECT count(*) INTO v_n FROM public.outbound_logistics
   WHERE project_id = v_project AND customer_id = 'C2'
     AND demand_distribution IS NULL AND demand_mean IS NULL AND demand_variation IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 14.2: C2 stated no demand spec and holds one';
  END IF;

  -- ── 2 · the forecast lands, is promoted, and a month is spread ───────────
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C1', 'product_id', 'P1',
                                   'period_start', '2026-11-02', 'quantity', 60),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C1', 'product_id', 'P1',
                                   'period_start', '2026-11-09', 'time_unit', 'week', 'quantity', 80),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 4, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C1', 'product_id', 'P1',
                                   'period_start', '2026-12-01', 'time_unit', 'month', 'quantity', 1000),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'demand_forecasts',
    'forecast.csv', 'ingest', 'p/wp142/fc.csv', 'text/csv', 200, repeat('b', 64), v_rows);
  v_run := (v_res ->> 'run_id')::uuid;

  SELECT count(*) INTO v_n FROM public.demand_forecasts WHERE project_id = v_project;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 14.2: % forecast row(s) reached tier 2 at LANDING time (I2)', v_n;
  END IF;

  v_res := public.ingest_apply_run(v_run, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 3 THEN
    RAISE EXCEPTION 'WP 14.2: the forecast promotion moved % row(s), expected 3 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  -- A blank time_unit is a one-week bucket, quantity per week as stated.
  SELECT weekly_quantity, period_end INTO v_num, v_date
    FROM public.demand_forecasts
   WHERE project_id = v_project AND period_start = '2026-11-02';
  IF v_num <> 60 OR v_date <> '2026-11-09' THEN
    RAISE EXCEPTION 'WP 14.2: a blank-unit bucket spread to %/wk ending %; expected 60 ending 2026-11-09', v_num, v_date;
  END IF;

  -- Decision 7: December's 1 000 is spread evenly over its 31 days.
  SELECT weekly_quantity, period_end, time_unit INTO v_num, v_date, v_txt
    FROM public.demand_forecasts
   WHERE project_id = v_project AND period_start = '2026-12-01';
  IF abs(v_num - 1000.0 * 7 / 31) > 1e-9 OR v_date <> '2027-01-01' OR v_txt <> 'month' THEN
    RAISE EXCEPTION 'WP 14.2: December spread to %/wk ending % (unit %); expected % ending 2027-01-01, unit kept as month',
      v_num, v_date, v_txt, 1000.0 * 7 / 31;
  END IF;

  -- Provenance reaches the line of the file (A4), and the audit names the actor (G4).
  SELECT count(*) INTO v_n FROM public.demand_forecasts
   WHERE project_id = v_project AND (ingest_run_id IS NULL OR source_row_id IS NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 14.2: % promoted forecast row(s) carry no run or no source row', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'demand_forecasts' AND actor_user_id = v_user;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 14.2: the tier-2 forecast write left no audit row naming the promoter (G4)';
  END IF;

  -- ── 3 · the snapshot carries both ────────────────────────────────────────
  v_snap := public._build_dataset_snapshot(v_project);
  IF jsonb_array_length(v_snap -> 'inputs' -> 'demand_forecasts') <> 3 THEN
    RAISE EXCEPTION 'WP 14.2: the snapshot carries % forecast bucket(s), expected 3',
      jsonb_array_length(v_snap -> 'inputs' -> 'demand_forecasts');
  END IF;
  SELECT e INTO v_elem FROM jsonb_array_elements(v_snap -> 'inputs' -> 'demand_forecasts') e
   WHERE e ->> 'period_start' = '2026-12-01';
  IF abs((v_elem ->> 'weekly_quantity')::numeric - 1000.0 * 7 / 31) > 1e-9
     OR v_elem ->> 'period_end' <> '2027-01-01' THEN
    RAISE EXCEPTION 'WP 14.2: the snapshot''s December bucket is %', v_elem;
  END IF;
  SELECT e INTO v_elem FROM jsonb_array_elements(v_snap -> 'inputs' -> 'outbound') e
   WHERE e ->> 'customer_id' = 'C1';
  IF v_elem ->> 'demand_distribution' <> 'normal' OR abs((v_elem ->> 'demand_mean')::numeric - 14) > 1e-9 THEN
    RAISE EXCEPTION 'WP 14.2: the snapshot''s C1 outbound row is % — no demand spec', v_elem;
  END IF;
  SELECT e INTO v_elem FROM jsonb_array_elements(v_snap -> 'inputs' -> 'outbound') e
   WHERE e ->> 'customer_id' = 'C2';
  IF v_elem ? 'demand_distribution' OR v_elem ? 'demand_mean' THEN
    RAISE EXCEPTION 'WP 14.2: C2 sets no spec and its snapshot row carries demand keys: %', v_elem;
  END IF;

  -- A project that sets neither keeps its snapshot TEXT: no forecast key, and
  -- outbound rows with exactly the seven keys they always had.
  INSERT INTO public.outbound_logistics (project_id, plant_name, customer_id, product_id,
                                         volume, time_unit, expected_lead_time, unit_price)
  VALUES (v_plain, 'WP142P', 'C9', 'P9', 10, 'week', 1, 5);
  v_snap := public._build_dataset_snapshot(v_plain);
  IF (v_snap -> 'inputs') ? 'demand_forecasts' THEN
    RAISE EXCEPTION 'WP 14.2: a project with no forecast has a demand_forecasts key — its hash moved';
  END IF;
  SELECT array_agg(k ORDER BY k)::text INTO v_txt
    FROM jsonb_object_keys((v_snap -> 'inputs' -> 'outbound') -> 0) k;
  IF v_txt <> '{customer_id,expected_lead_time,plant_name,product_id,time_unit,unit_price,volume}' THEN
    RAISE EXCEPTION 'WP 14.2: an outbound row with no spec snapshots keys % — its hash moved', v_txt;
  END IF;

  -- ── 4 · a forecast change moves the simulation scope ─────────────────────
  v_h1 := public._dataset_all_hashes(public._build_dataset_snapshot(v_project)) ->> 'hash_inputs';
  UPDATE public.demand_forecasts SET quantity = 1100
   WHERE project_id = v_project AND period_start = '2026-12-01';
  v_h2 := public._dataset_all_hashes(public._build_dataset_snapshot(v_project)) ->> 'hash_inputs';
  IF v_h1 IS NULL OR v_h1 = v_h2 THEN
    RAISE EXCEPTION 'WP 14.2: changing a forecast did not move hash_inputs (% → %)', v_h1, v_h2;
  END IF;
  SELECT weekly_quantity INTO v_num FROM public.demand_forecasts
   WHERE project_id = v_project AND period_start = '2026-12-01';
  IF abs(v_num - 1100.0 * 7 / 31) > 1e-9 THEN
    RAISE EXCEPTION 'WP 14.2: an UPDATE did not re-spread the bucket (%/wk)', v_num;
  END IF;

  -- ── 5 · a re-upload upserts; an unknown bucket is refused ────────────────
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C1', 'product_id', 'P1',
                                   'period_start', '2026-11-09', 'time_unit', 'week', 'quantity', 95),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'demand_forecasts',
    'forecast2.csv', 'ingest', 'p/wp142/fc2.csv', 'text/csv', 100, repeat('c', 64), v_rows);
  v_res := public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);
  SELECT count(*), max(quantity) INTO v_n, v_num FROM public.demand_forecasts
   WHERE project_id = v_project AND period_start = '2026-11-09';
  IF v_n <> 1 OR v_num <> 95 THEN
    RAISE EXCEPTION 'WP 14.2: a re-upload left % row(s) for the bucket, quantity %; expected one row, 95', v_n, v_num;
  END IF;

  BEGIN
    INSERT INTO public.demand_forecasts (project_id, customer_id, product_id, period_start, time_unit, quantity)
    VALUES (v_project, 'C1', 'P1', '2027-03-01', 'quarter', 10);
    RAISE EXCEPTION 'WP 14.2: a quarter-long bucket was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- refused, as it must be
  END;

  -- ── 6 · a wrong forecast upload can be removed, and only the forecast ────
  PERFORM public.delete_project_dataset(v_project, 'demand_forecasts', v_user, 'wp142@example.invalid');
  SELECT count(*) INTO v_n FROM public.demand_forecasts WHERE project_id = v_project;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 14.2: deleting the forecast dataset left % bucket(s)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.outbound_logistics WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 14.2: deleting the forecast dataset touched the outbound lanes (% left)', v_n;
  END IF;

  RAISE NOTICE 'WP 14.2: demand per row lands, normalizes, spreads and reaches the snapshot';
END $wp142$;
