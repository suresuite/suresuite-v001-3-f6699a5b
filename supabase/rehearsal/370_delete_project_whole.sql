-- §4 D170 · DELETING A PROJECT DELETES ALL OF IT OR NONE OF IT.
--
-- Production's "Delete project" never worked: the live `delete-project` (a 2026-03-17
-- build) deleted table by table in the background and stopped at a table that no
-- longer exists, having already removed rows, with no actor on them, while the page
-- said it had worked. `20260922000003` moves the whole deletion into
-- `public.delete_project`, one transaction. What only a running database can settle:
--
--   §1 the owner deletes a project that holds lanes, derived lanes, a node list, a
--      deep-tier network, a disruption profile, a simulation result and a landed CSV
--      — and afterwards NOTHING scoped to it remains, in any table, including the
--      three with no foreign key that a trigger could re-derive (D142).
--   §2 every audit row the delete wrote names the actor — the edge function's
--      batches wrote `actor_known: false` on every one.
--   §3 somebody else is REFUSED (42501) and nothing is deleted; an unknown project is
--      P0002; a NULL actor is 22004.
--   §4 ATOMIC: a failure part-way leaves every row in place. Forced by a trigger that
--      raises on the `projects` delete — the last step — after the lanes are gone.
--   §5 `anon` and `authenticated` cannot EXECUTE it; `service_role` can.
--
-- The actors exist ONLY in `approved_users`, as all fourteen real ones do (D156).
--
-- TWO MUTATIONS THIS FILE CANNOT CATCH, said rather than hidden:
--   · removing step 6's final sweep — correct by design: `rebuild_supply_chain_lanes`
--     skips a project that no longer exists, so the sweep is belt to that brace;
--   · removing `REVOKE … FROM anon, authenticated` — a rehearsal base has no Supabase
--     default privileges, so `REVOKE … FROM PUBLIC` alone already leaves them without
--     EXECUTE here. In production those roles hold explicit grants, which is why the
--     migration revokes them by name; §5 pins the outcome, not the mechanism.

DO $d170$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_p       uuid := gen_random_uuid();
  v_q       uuid := gen_random_uuid();
  v_prof    uuid;
  v_n       integer;
  v_code    text;
  v_tbl     text;
  -- now(), NOT clock_timestamp(): the runner holds this whole file in one transaction
  -- and `audit_logs.created_at` defaults to now() — transaction start — so a
  -- wall-clock mark would sit AFTER every audit row this file writes.
  v_since   timestamptz := now();
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D170 Org', 'd170-org-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id) VALUES
    (v_owner, 'd170o@example.invalid', 'D170 Owner', 'x', 'modeler', 'D170 Org', v_org),
    (v_other, 'd170x@example.invalid', 'D170 Other', 'x', 'modeler', 'D170 Org', v_org),
    (v_admin, 'd170a@example.invalid', 'D170 Admin', 'x', 'admin',   'D170 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D170 doomed', v_owner, 'D170P', 'D170 Org', v_org, 'single'),
    (v_q, 'D170 atomic', v_owner, 'D170Q', 'D170 Org', v_org, 'single');

  -- Sources for both projects, then the derived lanes from them.
  INSERT INTO public.outbound_logistics (project_id, plant_name, product_id, customer_id, volume, time_unit) VALUES
    (v_p, 'D170P', 'PR', 'CU', 5, 'week'), (v_q, 'D170Q', 'PR', 'CU', 5, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate) VALUES
    (v_p, 'D170P', 'PR', 'MA', 2), (v_q, 'D170Q', 'PR', 'MA', 2);
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, volume, time_unit) VALUES
    (v_p, 'D170P', 'SU', 'MA', 1, 'week'), (v_q, 'D170Q', 'SU', 'MA', 1, 'week');
  PERFORM public.combine_project_into_supply_chain(v_p, v_owner, 'd170o@example.invalid');
  PERFORM public.combine_project_into_supply_chain(v_q, v_owner, 'd170o@example.invalid');

  -- A deep-tier node, a disruption profile with a child, a simulation result, a CSV run.
  INSERT INTO public.network_nodes (project_id, plant_name, uid) VALUES (v_p, 'D170P', 'N1');
  INSERT INTO public.disruption_scenario_profiles (project_id, plant_name, scenario_name) VALUES (v_p, 'D170P', 'D170 profile') RETURNING id INTO v_prof;
  INSERT INTO public.disruption_scenario_settings (profile_id, key, value) VALUES (v_prof, 'k', '"v"');
  PERFORM public.ingest_land_file(v_p, v_owner, 'csv', 'master', 'customers',
    'd170.csv', 'ingest', 'd170/d170.csv', 'text/csv', 10, repeat('d', 64),
    jsonb_build_array(jsonb_build_object('source_row_number', 2,
      'raw', jsonb_build_object('customer_id', 'C'), 'parsed', jsonb_build_object('customer_id', 'C'),
      'findings', '[]'::jsonb)));

  SELECT count(*) INTO v_n FROM public.supply_chain_data WHERE project_id = v_p;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'D170/370 setup: the combine produced no supply_chain_data, so §1 would prove nothing about derived rows';
  END IF;

  -- ══ §3 · refusals, before anything is deleted ══
  v_code := NULL;
  BEGIN PERFORM public.delete_project(v_p, v_other, 'd170x@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'D170/370 §3: a non-owner non-admin ended with SQLSTATE %, expected 42501', COALESCE(v_code, '(none — it deleted)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p) OR NOT EXISTS (SELECT 1 FROM public.inbound_logistics WHERE project_id = v_p) THEN
    RAISE EXCEPTION 'D170/370 §3: a refused delete removed rows';
  END IF;
  v_code := NULL;
  BEGIN PERFORM public.delete_project(gen_random_uuid(), v_owner, 'd170o@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'D170/370 §3: an unknown project ended with SQLSTATE %, expected P0002', COALESCE(v_code, '(none)');
  END IF;
  v_code := NULL;
  BEGIN PERFORM public.delete_project(v_p, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '22004' THEN
    RAISE EXCEPTION 'D170/370 §3: a NULL actor ended with SQLSTATE %, expected 22004', COALESCE(v_code, '(none)');
  END IF;

  -- ══ §4 · atomic: fail at the LAST step, after the lanes are gone ══
  CREATE FUNCTION pg_temp.d170_refuse() RETURNS trigger LANGUAGE plpgsql AS
    $f$ BEGIN RAISE EXCEPTION 'd170 forced failure'; END $f$;
  CREATE TRIGGER d170_refuse BEFORE DELETE ON public.projects
    FOR EACH ROW WHEN (OLD.name = 'D170 atomic') EXECUTE FUNCTION pg_temp.d170_refuse();
  v_code := NULL;
  BEGIN PERFORM public.delete_project(v_q, v_owner, 'd170o@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  DROP TRIGGER d170_refuse ON public.projects;
  IF v_code IS NULL OR v_code NOT LIKE '%forced failure%' THEN
    RAISE EXCEPTION 'D170/370 §4: the forced failure did not surface (got %)', COALESCE(v_code, '(no error)');
  END IF;
  FOREACH v_tbl IN ARRAY ARRAY['inbound_logistics','outbound_logistics','bom_single_level','supply_chain_data'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id = $1', v_tbl) INTO v_n USING v_q;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'D170/370 §4: a delete that FAILED left % empty — it is not atomic, which is the defect D170 exists to close', v_tbl;
    END IF;
  END LOOP;

  -- ══ §1 · the owner deletes, and nothing scoped to the project remains ══
  --
  -- THE SESSION ACTOR IS BLANKED FIRST. `ingest_land_file` and the combine above set
  -- `app.current_user_id` LOCAL to this transaction — which is the whole file — so §2
  -- passed with `delete_project`'s own attribution DELETED: it was reading the value
  -- the setup left behind (mutation-tested; the same trap as §16 · WP 4.1 · E).
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM public.delete_project(v_p, v_owner, 'd170o@example.invalid');
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_p) THEN
    RAISE EXCEPTION 'D170/370 §1: the project row survived its own deletion';
  END IF;
  FOR v_tbl IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'project_id' AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('ai_chat_events', 'ai_usage_logs', 'api_request_logs')  -- logs, kept on purpose
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id::text = $1', v_tbl) INTO v_n USING v_p::text;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'D170/370 §1: % still holds % row(s) of the deleted project', v_tbl, v_n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = v_prof) THEN
    RAISE EXCEPTION 'D170/370 §1: a disruption profile''s child outlived the project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ingest_files f WHERE f.storage_path = 'd170/d170.csv') THEN
    RAISE EXCEPTION 'D170/370 §1: the landed file''s manifest outlived the project';
  END IF;

  -- ══ §2 · every data-plane row the deletion wrote names the actor ══
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND action = 'delete' AND created_at >= v_since
     AND actor_user_id IS DISTINCT FROM v_owner
     AND target_type IN ('inbound_logistics','outbound_logistics','bom_single_level','supply_chain_data','node_list');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D170/370 §2: % delete audit row(s) do not name the actor — the batches'' defect survived', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND action = 'delete' AND created_at >= v_since AND actor_user_id = v_owner;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'D170/370 §2: the deletion wrote no attributed audit row at all';
  END IF;

  -- The untouched project is intact, and an ADMIN of the organization may delete it.
  PERFORM public.delete_project(v_q, v_admin, 'd170a@example.invalid');
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_q) THEN
    RAISE EXCEPTION 'D170/370 §3: an admin of the project''s organization could not delete it';
  END IF;

  -- ══ §5 · who may call it ══
  IF has_function_privilege('anon', 'public.delete_project(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.delete_project(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D170/370 §5: anon or authenticated may EXECUTE delete_project — a browser could delete any project by naming its owner';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.delete_project(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D170/370 §5: service_role cannot EXECUTE delete_project, so the edge function cannot delete anything';
  END IF;

  RAISE NOTICE 'D170/370: delete_project is whole, attributed, atomic and service-role only';
END $d170$;
