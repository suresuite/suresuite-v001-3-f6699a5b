-- Phase 16 / WP 16.2 · A LANE'S OWN LEAD-TIME SPREAD LANDS, NORMALIZES AND
-- REACHES THE SNAPSHOT.
--
-- `20261004000003` gives the lane's lead-time shape a home on `inbound_logistics`.
-- What only a database can say:
--
--   1. An inbound upload carrying the five headers lands and is promoted by the
--      generic path; the three bounds, quoted in DAYS like the lane's lead time,
--      land in WEEKS and the unit column says `week` (I3).
--   2. Re-promoting the same file is idempotent: the bounds are not converted a
--      second time.
--   3. The CHECK refuses a bad ordering (min > max) and a shape that is not one
--      of the six — the promotion aborts rather than landing a lane the engine
--      would refuse.
--   4. The snapshot carries a lane's spread where it states one — and a lane that
--      states none serializes exactly as before (no hash moves).

DO $wp152$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000015200';
  v_project  uuid := '00000000-0000-4000-8000-000000015201';
  v_org      uuid := '00000000-0000-4000-8000-000000015203';
  v_rows     jsonb;
  v_res      jsonb;
  v_run      uuid;
  v_n        integer;
  v_snap     jsonb;
  v_lane     jsonb;
  v_failed   boolean;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP15.2 org', 'wp152-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp152@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active)
    VALUES (v_user, 'wp152@example.invalid', 'WP15.2', 'x', 'modeler', 'WP15.2 org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP15.2 spread', v_user, 'WP152', 'WP15.2 org', v_org);

  -- ── 1 · the upload lands and its bounds normalize at promotion ──────────
  --
  -- S1 is triangular in DAYS: 14 / 21 / 49 days are 2 / 3 / 7 weeks. S2 is a
  -- normal lane in weeks with a CV. S3 states no spread at all.
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('supplier_id', 'S1', 'material_id', 'M1',
        'volume', 10, 'time_unit', 'week', 'unit_price', 3,
        'lead_time', 28, 'lead_time_unit', 'day',
        'lead_time_dist', 'triangular', 'lead_time_min', 14, 'lead_time_mode', 21,
        'lead_time_max', 49),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('supplier_id', 'S2', 'material_id', 'M1',
        'volume', 10, 'time_unit', 'week', 'unit_price', 4, 'lead_time', 3,
        'lead_time_dist', 'normal', 'lead_time_cv', 0.25),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 4, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('supplier_id', 'S3', 'material_id', 'M1',
        'volume', 10, 'time_unit', 'week', 'unit_price', 5, 'lead_time', 2),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'inbound.csv', 'ingest', 'p/wp152/in.csv', 'text/csv', 256, repeat('b', 64), v_rows);
  v_run := (v_res ->> 'run_id')::uuid;
  v_res := public.ingest_apply_run(v_run, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 3 THEN
    RAISE EXCEPTION 'WP 16.2: the inbound promotion moved % row(s), expected 3 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'S1'
     AND lead_time_dist = 'triangular' AND lead_time_unit = 'week'
     AND round(lead_time, 6) = 4 AND round(lead_time_min, 6) = 2
     AND round(lead_time_mode, 6) = 3 AND round(lead_time_max, 6) = 7;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.2: S1 did not land triangular 2 / 3 / 7 weeks (lead time 4) from days — the bounds were not normalized at promotion (I3)';
  END IF;
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'S3'
     AND lead_time_dist IS NULL AND lead_time_cv IS NULL AND lead_time_min IS NULL
     AND lead_time_mode IS NULL AND lead_time_max IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.2: S3 stated no spread and holds one';
  END IF;

  -- ── 2 · re-promotion is idempotent ──────────────────────────────────────
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
    'inbound.csv', 'ingest', 'p/wp152/in2.csv', 'text/csv', 256, repeat('c', 64), v_rows);
  v_res := public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'S1'
     AND round(lead_time_min, 6) = 2 AND round(lead_time_max, 6) = 7;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.2: re-promoting the same file moved S1''s bounds — they were converted twice';
  END IF;
  SELECT count(*) INTO v_n FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 16.2: re-promotion left % lanes, expected 3 (natural key upsert)', v_n;
  END IF;

  -- ── 3 · the CHECK refuses a bad ordering and an unknown shape ───────────
  v_failed := false;
  BEGIN
    v_res := public.ingest_land_file(
      v_project, v_user, 'csv', 'transactional', 'inbound_logistics',
      'bad.csv', 'ingest', 'p/wp152/bad.csv', 'text/csv', 64, repeat('d', 64),
      jsonb_build_array(jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
        'parsed', jsonb_build_object('supplier_id', 'S4', 'material_id', 'M1',
          'volume', 1, 'time_unit', 'week', 'unit_price', 1, 'lead_time', 3,
          'lead_time_dist', 'uniform', 'lead_time_min', 6, 'lead_time_max', 2),
        'findings', '[]'::jsonb)));
    v_res := public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'WP 16.2: a lane with min 6 > max 2 was promoted';
  END IF;
  BEGIN
    UPDATE public.inbound_logistics SET lead_time_dist = 'weibull'
     WHERE project_id = v_project AND supplier_id = 'S3';
    RAISE EXCEPTION 'WP 16.2: lead_time_dist = weibull was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.inbound_logistics SET lead_time_cv = 1.5
     WHERE project_id = v_project AND supplier_id = 'S3';
    RAISE EXCEPTION 'WP 16.2: lead_time_cv = 1.5 was accepted (the engine bounds it at 1, §4 D302)';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ── 4 · the snapshot: stated values in, unstated keys absent ────────────
  v_snap := public._build_dataset_snapshot_v2(v_project);
  SELECT e INTO v_lane FROM jsonb_array_elements(v_snap -> 'inputs' -> 'inbound') e
   WHERE e ->> 'supplier_id' = 'S2';
  IF v_lane ->> 'lead_time_dist' IS DISTINCT FROM 'normal' OR (v_lane ->> 'lead_time_cv')::numeric <> 0.25 THEN
    RAISE EXCEPTION 'WP 16.2: the snapshot does not carry S2''s spread — %', v_lane::text;
  END IF;
  SELECT e INTO v_lane FROM jsonb_array_elements(v_snap -> 'inputs' -> 'inbound') e
   WHERE e ->> 'supplier_id' = 'S3';
  IF v_lane ?| ARRAY['lead_time_dist', 'lead_time_cv', 'lead_time_min', 'lead_time_mode', 'lead_time_max'] THEN
    RAISE EXCEPTION 'WP 16.2: a lane that states no spread carries spread keys — its hash would move: %', v_lane::text;
  END IF;
END
$wp152$;
