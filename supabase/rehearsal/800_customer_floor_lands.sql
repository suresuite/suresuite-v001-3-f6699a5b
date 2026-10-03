-- Phase 14 / WP 14.3 · A CUSTOMER'S CONTRACTED FLOOR LANDS AND REACHES THE SNAPSHOT.
--
-- WP 14.3 makes `customers.sla_fill_floor_pct` consumed (each of the customer's
-- rows' default service target under the sla_tier rule) and offers it on the
-- customers template. No migration: the column, the landing path and the
-- snapshot key all predate this package. What only a database can say is that
-- the generic promotion carries the new header through, that a blank lands NULL
-- (no floor) rather than 0, and that the snapshot the worker reads holds it.

DO $wp143$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000014300';
  v_project  uuid := '00000000-0000-4000-8000-000000014301';
  v_org      uuid := '00000000-0000-4000-8000-000000014303';
  v_rows     jsonb;
  v_res      jsonb;
  v_run      uuid;
  v_num      numeric;
  v_n        integer;
  v_snap     jsonb;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP14.3 org', 'wp143-' || substr(v_org::text, 1, 8));
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp143@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active)
    VALUES (v_user, 'wp143@example.invalid', 'WP14.3', 'x', 'modeler', 'WP14.3 org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP14.3 floors', v_user, 'WP143', 'WP14.3 org', v_org);

  v_rows := jsonb_build_array(
    jsonb_build_object('source_row_number', 2, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C1', 'segment', 'key',
                                   'priority_weight', 3, 'sla_fill_floor_pct', 95),
      'findings', '[]'::jsonb),
    jsonb_build_object('source_row_number', 3, 'raw', '{}'::jsonb,
      'parsed', jsonb_build_object('customer_id', 'C2', 'segment', 'spot'),
      'findings', '[]'::jsonb));
  v_res := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'customers',
    'customers.csv', 'ingest', 'p/wp143/c.csv', 'text/csv', 128, repeat('e', 64), v_rows);
  v_run := (v_res ->> 'run_id')::uuid;
  v_res := public.ingest_apply_run(v_run, v_user);
  IF (v_res ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 14.3: the customers promotion moved % row(s), expected 2 — %',
      v_res ->> 'rows_promoted', v_res::text;
  END IF;

  SELECT sla_fill_floor_pct INTO v_num FROM public.customers
   WHERE project_id = v_project AND customer_id = 'C1';
  IF v_num IS DISTINCT FROM 95 THEN
    RAISE EXCEPTION 'WP 14.3: C1 promoted sla_fill_floor_pct %, expected 95', v_num;
  END IF;
  -- A blank is NO floor, never 0 (the sidecar's meaning; a 0 would read as
  -- "no service required").
  SELECT count(*) INTO v_n FROM public.customers
   WHERE project_id = v_project AND customer_id = 'C2' AND sla_fill_floor_pct IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 14.3: C2 stated no floor and holds one';
  END IF;

  -- The worker reads the snapshot's `inputs.customers`, floor included.
  v_snap := public._build_dataset_snapshot_v2(v_project);
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(v_snap -> 'inputs' -> 'customers') e
   WHERE e ->> 'customer_id' = 'C1' AND (e ->> 'sla_fill_floor_pct')::numeric = 95;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 14.3: the snapshot does not carry C1''s floor — %', (v_snap -> 'inputs' -> 'customers')::text;
  END IF;
END
$wp143$;
