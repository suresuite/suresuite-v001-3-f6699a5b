-- Phase 16 / WP 16.5 · A PRODUCT'S PRODUCTION LEAD TIME LANDS, NORMALIZES AND
-- REACHES THE SNAPSHOT.
--
-- `20261004000004` gives P-P.13's production lead time and its shape a home on
-- `products`. What only a database can say:
--
--   1. A products upload carrying the headers lands and is promoted by the
--      generic path; a lead time and bounds quoted in DAYS land in WEEKS and the
--      unit column says `week` (I3); a product that states none holds none.
--   2. Re-promoting the same file is idempotent.
--   3. The CHECK refuses a bad ordering, an unknown shape and a CV above 1.
--   4. The snapshot carries the values where a product states them — and a
--      product that states none serializes exactly as before (no hash moves).

DO $wp155$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000015500';
  v_project  uuid := '00000000-0000-4000-8000-000000015501';
  v_org      uuid := '00000000-0000-4000-8000-000000015503';
  v_rows     jsonb;
  v_res      jsonb;
  v_n        integer;
  v_snap     jsonb;
  v_p        jsonb;
  v_failed   boolean;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP15.5 org', 'wp155-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp155@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active)
    VALUES (v_user, 'wp155@example.invalid', 'WP15.5', 'x', 'modeler', 'WP15.5 org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP15.5 plt', v_user, 'WP155', 'WP15.5 org', v_org);

  -- ── 1 · the upload lands and its durations normalize at promotion ───────
  --
  -- P1: 14 days, triangular 7 / 14 / 28 days → 2 weeks, 1 / 2 / 4 weeks.
  -- P2: 3 weeks, normal with CV 0.2 (no unit — weeks). P3 states nothing.
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P1', 'fulfillment_mode', 'mto',
        'production_lead_time', 14, 'production_lead_time_unit', 'day',
        'production_lead_time_dist', 'triangular', 'production_lead_time_min', 7,
        'production_lead_time_mode', 14, 'production_lead_time_max', 28),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P2', 'fulfillment_mode', 'mts',
        'production_lead_time', 3, 'production_lead_time_dist', 'normal',
        'production_lead_time_cv', 0.2),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 4, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P3', 'fulfillment_mode', 'mto'),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'products',
    'products.csv', 'ingest', 'p/wp155/p.csv', 'text/csv', 128, repeat('e', 64), v_rows);
  v_res := public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 3 THEN
    RAISE EXCEPTION 'WP 16.5: the products promotion moved % row(s), expected 3 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P1'
     AND production_lead_time_unit = 'week' AND round(production_lead_time, 6) = 2
     AND round(production_lead_time_min, 6) = 1 AND round(production_lead_time_mode, 6) = 2
     AND round(production_lead_time_max, 6) = 4 AND production_lead_time_dist = 'triangular';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.5: P1 did not land 2 weeks, triangular 1 / 2 / 4 weeks from days (I3)';
  END IF;
  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P3'
     AND production_lead_time IS NULL AND production_lead_time_dist IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.5: P3 stated no production lead time and holds one';
  END IF;
  -- The promotion states the canonical unit on every row of the run (I3), P3
  -- included — which is why the snapshot carries the unit only beside a duration (§4).
  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P3' AND production_lead_time_unit = 'week';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.5: the promotion did not stamp the canonical unit on P3 — the snapshot rule below is guarding nothing';
  END IF;

  -- ── 2 · re-promotion is idempotent ──────────────────────────────────────
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'products',
    'products.csv', 'ingest', 'p/wp155/p2.csv', 'text/csv', 128, repeat('f', 64), v_rows);
  v_res := public.ingest_apply_run((v_res ->> 'run_id')::uuid, v_user);
  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P1'
     AND round(production_lead_time, 6) = 2 AND round(production_lead_time_max, 6) = 4;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 16.5: re-promoting the same file moved P1''s production lead time — converted twice';
  END IF;

  -- ── 3 · the CHECK refuses a bad ordering, a shape and a CV ──────────────
  v_failed := false;
  BEGIN
    UPDATE public.products SET production_lead_time_min = 9, production_lead_time_max = 2
     WHERE project_id = v_project AND product_id = 'P3';
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'WP 16.5: a product with min 9 > max 2 was accepted';
  END IF;
  BEGIN
    UPDATE public.products SET production_lead_time_dist = 'weibull'
     WHERE project_id = v_project AND product_id = 'P3';
    RAISE EXCEPTION 'WP 16.5: production_lead_time_dist = weibull was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.products SET production_lead_time_cv = 1.2
     WHERE project_id = v_project AND product_id = 'P3';
    RAISE EXCEPTION 'WP 16.5: production_lead_time_cv = 1.2 was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ── 4 · the snapshot: stated values in, unstated keys absent ────────────
  v_snap := public._build_dataset_snapshot_v2(v_project);
  SELECT e INTO v_p FROM jsonb_array_elements(v_snap -> 'inputs' -> 'products') e
   WHERE e ->> 'product_id' = 'P2';
  IF v_p ->> 'production_lead_time_dist' IS DISTINCT FROM 'normal'
     OR (v_p ->> 'production_lead_time')::numeric <> 3 THEN
    RAISE EXCEPTION 'WP 16.5: the snapshot does not carry P2''s production lead time — %', v_p::text;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_snap -> 'inputs' -> 'products') e
   WHERE e ->> 'product_id' = 'P3';
  IF v_p ?| ARRAY['production_lead_time', 'production_lead_time_unit', 'production_lead_time_dist',
                  'production_lead_time_cv', 'production_lead_time_min', 'production_lead_time_mode',
                  'production_lead_time_max'] THEN
    RAISE EXCEPTION 'WP 16.5: a product that states no production lead time carries its keys — its hash would move: %', v_p::text;
  END IF;
END
$wp155$;
