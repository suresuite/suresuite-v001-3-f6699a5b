-- §4 D208 · DELETING AN ORGANIZATION DELETES ITS PROJECTS AND ITS ACCOUNTS — ALL OF
-- IT OR NONE OF IT — AND IT IS NOT SUSPENSION.
--
-- `20260930000002` adds `admin_delete_organization` and moves D170's project sweep into
-- `_delete_project_rows`, which it shares with `delete_project`. What only a running
-- database can settle:
--
--   §1 REFUSALS, each leaving everything in place: a non-super-admin; a confirmation
--      that is not the slug; the acting admin's own organization; an organization
--      holding a super admin; an account recorded as the uploader of a row in ANOTHER
--      organization's project (the refusal names the account, rather than a foreign key
--      on some other table).
--   §2 ATOMIC: a failure at the LAST step (the organization row) leaves every project,
--      every account and every lane in place.
--   §3 THE DELETE: the organization, both its accounts, its project, the org-less
--      project one of its accounts owned, its API key, capability, membership and AI
--      budgets are gone; no project-scoped table holds a row of either project —
--      including an uploader's landed file (D161 does not bite: the cascade removes the
--      file before the account); the OTHER organization, its project and its lanes are
--      untouched.
--   §4 ATTRIBUTION: the admin log records `org.delete` with what was removed, and every
--      data-plane delete row names the super admin — with the session actor blanked
--      first, so the check cannot pass on a value the setup left behind.
--   §5 GRANTS: the browser (anon) may call the verb; nobody but its SECURITY DEFINER
--      callers may call the sweep.

DO $d208$
DECLARE
  v_doomed  uuid := gen_random_uuid();
  v_kept    uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();   -- active super admin, home org = kept
  v_super2  uuid := gen_random_uuid();   -- a super admin briefly homed in the doomed org
  v_admin   uuid := gen_random_uuid();   -- doomed org admin
  v_mod     uuid := gen_random_uuid();   -- doomed org modeler
  v_p       uuid := gen_random_uuid();   -- doomed org project
  v_orphan  uuid := gen_random_uuid();   -- org-less project owned by v_mod
  v_q       uuid := gen_random_uuid();   -- kept org project
  v_prof    uuid;
  v_slug    text;
  v_code    text;
  v_msg     text;
  v_n       integer;
  v_tbl     text;
  v_out     jsonb;
  v_seq     bigint;
BEGIN
  v_slug := 'd208-doomed-' || substr(v_doomed::text, 1, 8);
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_doomed, 'D208 Doomed', v_slug),
    (v_kept,   'D208 Kept',   'd208-kept-' || substr(v_kept::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id) VALUES
    (v_super,  'd208s@example.invalid',  'D208 Super',  'x', 'super_admin', 'D208 Kept',   v_kept),
    (v_super2, 'd208s2@example.invalid', 'D208 Super2', 'x', 'super_admin', 'D208 Doomed', v_doomed),
    (v_admin,  'd208a@example.invalid',  'D208 Admin',  'x', 'admin',       'D208 Doomed', v_doomed),
    (v_mod,    'd208m@example.invalid',  'D208 Mod',    'x', 'modeler',     'D208 Doomed', v_doomed);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p,      'D208 doomed project', v_mod,   'D208P', 'D208 Doomed', v_doomed, 'single'),
    (v_q,      'D208 kept project',   v_super, 'D208Q', 'D208 Kept',   v_kept,   'single');
  INSERT INTO public.projects (id, name, modeler_id, plant_name, bom_level) VALUES
    (v_orphan, 'D208 org-less project', v_mod, 'D208O', 'single');
  -- `set_project_defaults` stamps an organization from the owner; this project is the
  -- legacy shape with none, which the delete must still reach through its owner.
  UPDATE public.projects SET organization_id = NULL, organization = 'D208 legacy text' WHERE id = v_orphan;
  IF (SELECT organization_id FROM public.projects WHERE id = v_orphan) IS NOT NULL THEN
    RAISE EXCEPTION 'D208/430 setup: the org-less project was re-stamped with an organization, so §3 would not prove it is reached through its owner';
  END IF;

  INSERT INTO public.outbound_logistics (project_id, plant_name, product_id, customer_id, volume, time_unit) VALUES
    (v_p, 'D208P', 'PR', 'CU', 5, 'week'), (v_q, 'D208Q', 'PR', 'CU', 5, 'week'),
    (v_orphan, 'D208O', 'PR', 'CU', 5, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate) VALUES
    (v_p, 'D208P', 'PR', 'MA', 2), (v_q, 'D208Q', 'PR', 'MA', 2);
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, volume, time_unit) VALUES
    (v_p, 'D208P', 'SU', 'MA', 1, 'week'), (v_q, 'D208Q', 'SU', 'MA', 1, 'week');
  PERFORM public.combine_project_into_supply_chain(v_p, v_mod, 'd208m@example.invalid');
  PERFORM public.combine_project_into_supply_chain(v_q, v_super, 'd208s@example.invalid');

  INSERT INTO public.network_nodes (project_id, plant_name, uid) VALUES (v_p, 'D208P', 'N1');
  INSERT INTO public.disruption_scenario_profiles (project_id, plant_name, scenario_name)
    VALUES (v_p, 'D208P', 'D208 profile') RETURNING id INTO v_prof;
  INSERT INTO public.disruption_scenario_settings (profile_id, key, value) VALUES (v_prof, 'k', '"v"');
  -- The modeler uploads a CSV into the doomed project: D161's shape, inside the scope.
  PERFORM public.ingest_land_file(v_p, v_mod, 'csv', 'master', 'customers',
    'd208.csv', 'ingest', 'd208/d208.csv', 'text/csv', 10, repeat('e', 64),
    jsonb_build_array(jsonb_build_object('source_row_number', 2,
      'raw', jsonb_build_object('customer_id', 'C'), 'parsed', jsonb_build_object('customer_id', 'C'),
      'findings', '[]'::jsonb)));

  INSERT INTO public.api_keys (key_prefix, secret_hash, org_id) VALUES ('d208pfx', 'hash', v_doomed);
  INSERT INTO public.capabilities (key, kind, label) VALUES ('d208.cap', 'feature', 'D208 capability')
    ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES (v_doomed, 'd208.cap', true);
  INSERT INTO public.ai_budgets (scope, scope_id, period) VALUES
    ('org', v_doomed, 'monthly'), ('user', v_mod, 'monthly'), ('project', v_p, 'monthly'),
    ('org', v_kept, 'monthly');

  SELECT count(*) INTO v_n FROM public.supply_chain_data WHERE project_id = v_p;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'D208/430 setup: the combine produced no supply_chain_data, so §3 would prove nothing about derived rows';
  END IF;

  -- ══ §1 · refusals ══
  v_msg := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_admin, 'd208a@example.invalid', v_doomed, v_slug);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D208/430 §1: an org admin (not a super admin) got %, expected forbidden', COALESCE(v_msg, '(no error — it deleted)');
  END IF;

  v_code := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super, 'd208s@example.invalid', v_doomed, 'D208 Doomed');
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'D208/430 §1: a confirmation that is the NAME rather than the slug ended with %, expected 22023', COALESCE(v_code, '(no error — it deleted)');
  END IF;

  v_code := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super, 'd208s@example.invalid', gen_random_uuid(), v_slug);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'D208/430 §1: an unknown organization ended with %, expected P0002', COALESCE(v_code, '(none)');
  END IF;

  v_msg := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super2, 'd208s2@example.invalid', v_doomed, v_slug);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE '%your own organization%' THEN
    RAISE EXCEPTION 'D208/430 §1: a super admin deleting their OWN organization got %', COALESCE(v_msg, '(no error — they deleted themselves)');
  END IF;

  v_msg := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super, 'd208s@example.invalid', v_doomed, v_slug);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  IF v_msg IS NULL OR v_msg NOT LIKE '%super admin%' OR v_msg NOT LIKE '%d208s2@example.invalid%' THEN
    RAISE EXCEPTION 'D208/430 §1: an organization holding a super admin was not refused by name (got %)', COALESCE(v_msg, '(no error — a super admin was erased)');
  END IF;
  UPDATE public.approved_users SET organization_id = v_kept, organization = 'D208 Kept' WHERE id = v_super2;

  -- The modeler is recorded as the uploader of a lane row in the KEPT org's project.
  INSERT INTO public.supply_chain_data (project_id, plant_name, from_location, to_location, uploaded_by)
    VALUES (v_q, 'D208Q', 'X', 'Y', v_mod);
  v_code := NULL; v_msg := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super, 'd208s@example.invalid', v_doomed, v_slug);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; v_msg := SQLERRM; END;
  IF v_code IS DISTINCT FROM '23503' OR v_msg NOT LIKE '%d208m@example.invalid%' THEN
    RAISE EXCEPTION 'D208/430 §1: an account with work in another organization''s project ended with % (%), expected 23503 naming the account',
      COALESCE(v_code, '(none)'), COALESCE(v_msg, '');
  END IF;
  DELETE FROM public.supply_chain_data WHERE project_id = v_q AND uploaded_by = v_mod;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_doomed)
     OR NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_mod)
     OR NOT EXISTS (SELECT 1 FROM public.inbound_logistics WHERE project_id = v_p) THEN
    RAISE EXCEPTION 'D208/430 §1: a refused delete removed rows';
  END IF;

  -- ══ §2 · atomic: fail at the LAST step, after projects and accounts are gone ══
  CREATE FUNCTION pg_temp.d208_refuse() RETURNS trigger LANGUAGE plpgsql AS
    $f$ BEGIN RAISE EXCEPTION 'd208 forced failure'; END $f$;
  EXECUTE format('CREATE TRIGGER d208_refuse BEFORE DELETE ON public.organizations
    FOR EACH ROW WHEN (OLD.id = %L::uuid) EXECUTE FUNCTION pg_temp.d208_refuse()', v_doomed);
  v_msg := NULL;
  BEGIN PERFORM public.admin_delete_organization(v_super, 'd208s@example.invalid', v_doomed, v_slug);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  DROP TRIGGER d208_refuse ON public.organizations;
  IF v_msg IS NULL OR v_msg NOT LIKE '%forced failure%' THEN
    RAISE EXCEPTION 'D208/430 §2: the forced failure did not surface (got %)', COALESCE(v_msg, '(no error)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p)
     OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_orphan)
     OR (SELECT count(*) FROM public.approved_users WHERE id IN (v_admin, v_mod)) <> 2 THEN
    RAISE EXCEPTION 'D208/430 §2: a delete that FAILED removed a project or an account — it is not atomic';
  END IF;
  FOREACH v_tbl IN ARRAY ARRAY['inbound_logistics','outbound_logistics','bom_single_level','supply_chain_data','node_list'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id = $1', v_tbl) INTO v_n USING v_p;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'D208/430 §2: a delete that FAILED left % empty — it is not atomic', v_tbl;
    END IF;
  END LOOP;

  -- ══ §3 · the delete ══
  PERFORM set_config('app.current_user_id', '', true);   -- §4 must not read the setup's actor
  -- §4 reads only what the delete wrote: the setup's lane inserts fire the D142 rebuild,
  -- whose own deletes carry the setup's actor, and `created_at` is transaction start.
  SELECT COALESCE(max(seq), 0) INTO v_seq FROM public.audit_logs;
  v_out := public.admin_delete_organization(v_super, 'd208s@example.invalid', v_doomed, v_slug);
  IF (v_out->>'projects')::int <> 2 OR (v_out->>'users')::int <> 2 THEN
    RAISE EXCEPTION 'D208/430 §3: expected 2 projects and 2 accounts deleted, the function reported %', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_doomed) THEN
    RAISE EXCEPTION 'D208/430 §3: the organization row survived its own deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM public.approved_users WHERE id IN (v_admin, v_mod)) THEN
    RAISE EXCEPTION 'D208/430 §3: an account of the deleted organization survived';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id IN (v_p, v_orphan)) THEN
    RAISE EXCEPTION 'D208/430 §3: a project of the deleted organization survived (the org-less one is reached through its owner)';
  END IF;
  FOR v_tbl IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'project_id' AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('ai_chat_events', 'ai_usage_logs', 'api_request_logs')  -- logs, kept on purpose
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id::text IN ($1, $2)', v_tbl)
      INTO v_n USING v_p::text, v_orphan::text;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'D208/430 §3: % still holds % row(s) of a deleted project', v_tbl, v_n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.disruption_scenario_settings WHERE profile_id = v_prof)
     OR EXISTS (SELECT 1 FROM public.ingest_files WHERE storage_path = 'd208/d208.csv') THEN
    RAISE EXCEPTION 'D208/430 §3: a disruption profile''s child or a landed file outlived its project';
  END IF;
  IF EXISTS (SELECT 1 FROM public.api_keys WHERE org_id = v_doomed)
     OR EXISTS (SELECT 1 FROM public.org_capabilities WHERE org_id = v_doomed)
     OR EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_doomed) THEN
    RAISE EXCEPTION 'D208/430 §3: an API key, capability or membership outlived its organization';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_budgets WHERE scope_id IN (v_doomed, v_mod, v_p)) THEN
    RAISE EXCEPTION 'D208/430 §3: an AI budget scoped to the organization, an account or a project outlived it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_budgets WHERE scope = 'org' AND scope_id = v_kept) THEN
    RAISE EXCEPTION 'D208/430 §3: the OTHER organization''s AI budget was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_kept)
     OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_q)
     OR (SELECT count(*) FROM public.approved_users WHERE id IN (v_super, v_super2)) <> 2 THEN
    RAISE EXCEPTION 'D208/430 §3: the delete reached the OTHER organization';
  END IF;
  FOREACH v_tbl IN ARRAY ARRAY['inbound_logistics','outbound_logistics','bom_single_level','supply_chain_data','node_list'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id = $1', v_tbl) INTO v_n USING v_q;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'D208/430 §3: the OTHER organization''s project lost its % rows', v_tbl;
    END IF;
  END LOOP;

  -- ══ §4 · attribution ══
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'org.delete' AND target_id = v_doomed::text AND actor_user_id = v_super
     AND jsonb_array_length(before->'users') = 2 AND jsonb_array_length(before->'projects') = 2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D208/430 §4: expected ONE org.delete admin row naming the super admin and listing 2 accounts and 2 projects, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND action = 'delete' AND seq > v_seq
     AND actor_user_id IS DISTINCT FROM v_super
     AND target_type IN ('inbound_logistics','outbound_logistics','bom_single_level','supply_chain_data','node_list');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D208/430 §4: % data-plane delete row(s) do not name the super admin', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND action = 'delete' AND seq > v_seq AND actor_user_id = v_super;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'D208/430 §4: the deletion wrote no attributed data-plane row at all';
  END IF;

  -- ══ §5 · grants ══
  IF has_function_privilege('anon', 'public._delete_project_rows(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._delete_project_rows(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D208/430 §5: anon or authenticated may EXECUTE _delete_project_rows — an unauthorized sweep of any project';
  END IF;
  IF NOT has_function_privilege('anon', 'public.admin_delete_organization(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D208/430 §5: anon cannot EXECUTE admin_delete_organization, so the page (which calls as anon, D155) cannot delete';
  END IF;

  RAISE NOTICE 'D208/430: an organization is deleted whole — projects, accounts, keys — atomically, attributed, and only by a super admin who names its slug';
END $d208$;
