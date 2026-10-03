-- Phase 14 / WP 14.4 · THE FG POLICY PER PRODUCT LANDS AND REACHES THE SNAPSHOT.
--
-- `20261003000002` gives the finished-goods policy (base-stock S · min-max s, S ·
-- days of cover D) and FG opening stock a home on `products`. What only a
-- database can say:
--
--   1. A products upload carrying the five headers lands and is promoted by the
--      generic path, and a blank lands NULL (not stated), never 0.
--   2. The CHECK refuses a policy that is not one of the three.
--   3. The snapshot carries them where a product states them — and a product
--      that states none serializes exactly as before (no hash moves).

DO $wp144$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000014400';
  v_project  uuid := '00000000-0000-4000-8000-000000014401';
  v_org      uuid := '00000000-0000-4000-8000-000000014403';
  v_rows     jsonb;
  v_res      jsonb;
  v_run      uuid;
  v_n        integer;
  v_snap     jsonb;
  v_p        jsonb;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP14.4 org', 'wp144-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp144@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active)
    VALUES (v_user, 'wp144@example.invalid', 'WP14.4', 'x', 'modeler', 'WP14.4 org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP14.4 fg', v_user, 'WP144', 'WP14.4 org', v_org);

  -- ── 1 · the upload lands and is promoted ────────────────────────────────
  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P1', 'fulfillment_mode', 'mts',
        'fg_policy', 'min_max', 'fg_base_stock', 400, 'fg_reorder_point', 100,
        'fg_initial_on_hand', 250),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P2', 'fulfillment_mode', 'mts',
        'fg_policy', 'days_of_cover', 'fg_cover_days', 14),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 4, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('product_id', 'P3', 'fulfillment_mode', 'mto'),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'products',
    'products.csv', 'ingest', 'p/wp144/p.csv', 'text/csv', 128, repeat('f', 64), v_rows);
  v_run := (v_res ->> 'run_id')::uuid;
  v_res := public.ingest_apply_run(v_run, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 3 THEN
    RAISE EXCEPTION 'WP 14.4: the products promotion moved % row(s), expected 3 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P1'
     AND fg_policy = 'min_max' AND fg_base_stock = 400 AND fg_reorder_point = 100
     AND fg_initial_on_hand = 250 AND fg_cover_days IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 14.4: P1 did not land min_max s=100 S=400 opening 250 with no D';
  END IF;
  SELECT count(*) INTO v_n FROM public.products
   WHERE project_id = v_project AND product_id = 'P3'
     AND fg_policy IS NULL AND fg_base_stock IS NULL AND fg_initial_on_hand IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 14.4: P3 stated no FG policy and holds one';
  END IF;

  -- ── 2 · the CHECK refuses an unknown policy ─────────────────────────────
  BEGIN
    UPDATE public.products SET fg_policy = 'kanban'
     WHERE project_id = v_project AND product_id = 'P3';
    RAISE EXCEPTION 'WP 14.4: fg_policy = kanban was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- ── 3 · the snapshot: stated values in, unstated keys absent ────────────
  v_snap := public._build_dataset_snapshot_v2(v_project);
  SELECT e INTO v_p FROM jsonb_array_elements(v_snap -> 'inputs' -> 'products') e
   WHERE e ->> 'product_id' = 'P2';
  IF v_p ->> 'fg_policy' IS DISTINCT FROM 'days_of_cover' OR (v_p ->> 'fg_cover_days')::numeric <> 14 THEN
    RAISE EXCEPTION 'WP 14.4: the snapshot does not carry P2''s policy — %', v_p::text;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_snap -> 'inputs' -> 'products') e
   WHERE e ->> 'product_id' = 'P3';
  IF v_p ?| ARRAY['fg_policy', 'fg_base_stock', 'fg_reorder_point', 'fg_cover_days', 'fg_initial_on_hand'] THEN
    RAISE EXCEPTION 'WP 14.4: a product that states no FG policy carries FG keys — its hash would move: %', v_p::text;
  END IF;
END
$wp144$;
