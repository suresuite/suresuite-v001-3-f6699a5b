-- §4 D307 · NEXUS NODES ARE SCORED PER NODE, KEPT ON node_list, AND READ BY PROJECT.
--
-- What only a database can say about `20261009000003`:
--
--   1. the mirror writes one score per NODE, stamped with the run's own hash, and
--      clears a score the run did not give — a node off the lane graph keeps no
--      stale nexus flag;
--   2. the score SURVIVES a lane rebuild, which is D196's whole complaint: the
--      lane rows are deleted and the node_list row is not;
--   3. the write names its actor, proved with the GUC poisoned first;
--   4. the writer refuses a run of another kind and a run that has finished;
--   5. the read counts NODES from the run, gives the drivers in rank order with
--      the role READ from `echelon`, and prefers a node-level run over a newer
--      lane-row run from the old build;
--   6. the read refuses a reader who cannot see the project, and a reader who
--      names nobody;
--   7. the grants are explicit.

DO $d307$
DECLARE
  v_user     uuid := '00000000-0000-4000-8000-000000307000';
  v_stranger uuid := '00000000-0000-4000-8000-000000307001';
  v_project  uuid := '00000000-0000-4000-8000-000000307002';
  v_org      uuid;
  v_org2     uuid;
  v_run      uuid;
  v_old      uuid;
  v_other    uuid;
  v_hash     text;
  v_res      jsonb;
  v_stats    jsonb;
  v_row      record;
  v_n        integer;
  v_actor    uuid;
  v_refused  boolean;
BEGIN
  INSERT INTO public.organizations (name, slug)
    VALUES ('D307 Nexus', 'd307-nexus') RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug)
    VALUES ('D307 Elsewhere', 'd307-elsewhere') RETURNING id INTO v_org2;
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'd307@example.invalid'), (v_stranger, 'd307s@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization_id)
    VALUES (v_user, 'd307@example.invalid', 'D307 modeler', 'x', v_org),
           (v_stranger, 'd307s@example.invalid', 'D307 stranger', 'x', v_org2);
  PERFORM set_config('app.current_user_id', v_user::text, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization_id)
    VALUES (v_project, 'D307 nexus', v_user, 'D307P', v_org);

  INSERT INTO public.supply_chain_data
    (project_id, plant_name, from_location, to_location, data_source)
    VALUES (v_project, 'D307P', 'S1', 'M1', 'inbound'),
           (v_project, 'D307P', 'S2', 'M1', 'inbound'),
           (v_project, 'D307P', 'M1', 'P1', 'bom');
  -- The node set, written directly and idempotently: whichever discovery path the
  -- lane insert fired, these rows exist. GONE is a node no lane names any
  -- more, carrying a flag from an earlier world.
  INSERT INTO public.node_list (project_id, plant_name, node_id, organization, created_by)
    VALUES (v_project, 'D307P', 'S1', 'D307 Nexus', v_user),
           (v_project, 'D307P', 'S2', 'D307 Nexus', v_user),
           (v_project, 'D307P', 'M1', 'D307 Nexus', v_user),
           (v_project, 'D307P', 'GONE', 'D307 Nexus', v_user)
    ON CONFLICT (project_id, node_id) DO NOTHING;
  UPDATE public.node_list SET is_critical_node = true, critical_node_score = 0.9
   WHERE project_id = v_project AND node_id = 'GONE';

  v_run := (public.analysis_get_or_start(
              v_project, 'critical_nodes',
              jsonb_build_object('method', 'demand_at_risk', 'threshold', 0.1, 'plant_name', NULL),
              'critical_nodes@d307.1', v_user) ->> 'run_id')::uuid;
  SELECT input_hash INTO v_hash FROM public.analysis_runs WHERE id = v_run;

  -- ── 3 (set up) · POISON the session actor, so only the RPC can fix it ─────
  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_guard_change;
  DELETE FROM public.audit_logs WHERE plane = 'data' AND target_type = 'node_list';
  ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_guard_change;

  -- ── 1 · one score per node, stamped, and the stale flag cleared ───────────
  v_res := public.analysis_apply_critical_nodes(
    v_run,
    jsonb_build_array(
      jsonb_build_object('node_id', 'S1', 'is_critical', true,  'score', 0.75),
      jsonb_build_object('node_id', 'S2', 'is_critical', true,  'score', 0.25),
      jsonb_build_object('node_id', 'M1', 'is_critical', true,  'score', 1),
      jsonb_build_object('node_id', 'P1', 'is_critical', true,  'score', 1),
      jsonb_build_object('node_id', 'NOWHERE', 'is_critical', false, 'score', 0)),
    v_user);
  -- The lane insert above discovered P1 (the node_list refresh fires on it), so
  -- four rows are written. NOWHERE has no node_list row: supplied, not written,
  -- and the counts say so rather than claiming five.
  IF (v_res ->> 'rows_updated')::int <> 4 OR (v_res ->> 'rows_cleared')::int <> 1
     OR (v_res ->> 'scores_supplied')::int <> 5 THEN
    RAISE EXCEPTION 'D307 §1: expected 4 updated, 1 cleared, 5 supplied; got %', v_res;
  END IF;
  SELECT * INTO v_row FROM public.node_list WHERE project_id = v_project AND node_id = 'S1';
  IF v_row.critical_node_score <> 0.75 OR NOT v_row.is_critical_node
     OR v_row.computed_from_hash IS DISTINCT FROM v_hash OR v_row.prediction_timestamp IS NULL THEN
    RAISE EXCEPTION 'D307 §1: S1 reads score=% critical=% hash=% (run hash %)',
      v_row.critical_node_score, v_row.is_critical_node, v_row.computed_from_hash, v_hash;
  END IF;
  SELECT * INTO v_row FROM public.node_list WHERE project_id = v_project AND node_id = 'GONE';
  IF v_row.is_critical_node IS NOT NULL OR v_row.critical_node_score IS NOT NULL THEN
    RAISE EXCEPTION 'D307 §1: GONE kept a nexus flag the run did not give it (critical=%, score=%)',
      v_row.is_critical_node, v_row.critical_node_score;
  END IF;

  -- ── 3 · the write names its actor, not the poisoned session ──────────────
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'node_list';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'D307 §3: the node_list mirror wrote no data-plane audit row';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'node_list'
     AND actor_user_id IS DISTINCT FROM v_user;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'D307 §3: % node_list audit row(s) name someone other than the writer. The GUC '
      'was poisoned with the stranger first, so the RPC did not set app.current_user_id.', v_n;
  END IF;
  PERFORM set_config('app.current_user_id', v_user::text, true);

  -- ── 2 · the score survives the lanes being rebuilt (D196) ────────────────
  DELETE FROM public.supply_chain_data WHERE project_id = v_project;
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, from_location, to_location, data_source)
    VALUES (v_project, 'D307P', 'S1', 'M1', 'inbound'),
           (v_project, 'D307P', 'S2', 'M1', 'inbound'),
           (v_project, 'D307P', 'M1', 'P1', 'bom');
  SELECT critical_node_score INTO v_row FROM public.node_list
   WHERE project_id = v_project AND node_id = 'S1';
  IF v_row.critical_node_score IS DISTINCT FROM 0.75 THEN
    RAISE EXCEPTION 'D307 §2: S1''s score did not survive a lane rebuild (now %)',
      v_row.critical_node_score;
  END IF;

  -- ── 5 (set up) · complete the run with node results ──────────────────────
  PERFORM public.analysis_complete_run(
    v_run,
    jsonb_build_array(
      jsonb_build_object('entity_type', 'node', 'entity_id', 'M1', 'metrics', jsonb_build_object(
        'score', 1, 'is_critical', true, 'rank', 1, 'products_affected', 1,
        'sole_source_of', '[]'::jsonb, 'betweenness', 0.1)),
      jsonb_build_object('entity_type', 'node', 'entity_id', 'S1', 'metrics', jsonb_build_object(
        'score', 0.75, 'is_critical', true, 'rank', 2, 'products_affected', 1,
        'sole_source_of', '[]'::jsonb, 'betweenness', 0)),
      jsonb_build_object('entity_type', 'node', 'entity_id', 'S2', 'metrics', jsonb_build_object(
        'score', 0.05, 'is_critical', false, 'rank', 3, 'products_affected', 1,
        'sole_source_of', '[]'::jsonb, 'betweenness', 0)),
      jsonb_build_object('entity_type', 'node', 'entity_id', 'C1', 'metrics', jsonb_build_object(
        'score', 0, 'is_critical', false, 'rank', NULL, 'products_affected', 0,
        'sole_source_of', '[]'::jsonb, 'betweenness', 0))),
    jsonb_build_object('nodes', 4, 'nexus', 2, 'demand_basis', 'weekly_volume'),
    '[]'::jsonb,
    v_user);

  -- ── 4 · the writer refuses a finished run and a run of another kind ──────
  v_refused := false;
  BEGIN
    PERFORM public.analysis_apply_critical_nodes(v_run, '[]'::jsonb, v_user);
  EXCEPTION WHEN SQLSTATE 'P0A01' THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D307 §4: the mirror accepted a write from a finished run';
  END IF;

  v_other := (public.analysis_get_or_start(
                v_project, 'network_metrics', jsonb_build_object('d307', true),
                'network_metrics@d307', v_user) ->> 'run_id')::uuid;
  v_refused := false;
  BEGIN
    PERFORM public.analysis_apply_critical_nodes(v_other, '[]'::jsonb, v_user);
  EXCEPTION WHEN invalid_parameter_value THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D307 §4: the mirror accepted a network_metrics run';
  END IF;

  -- A lane-row run from the OLD build, NEWER than the node run — the deploy window.
  -- `started_at` is immutable once written and `now()` is one value for this whole
  -- transaction, so the later start is written at INSERT rather than claimed.
  INSERT INTO public.analysis_runs
    (project_id, analysis_kind, input_hash, params_hash, code_version, params,
     status, started_at, actor_user_id, input_scope, dataset_version_id)
  SELECT project_id, analysis_kind, input_hash, md5('d307-old-build'), 'critical_nodes@wp101.1',
         jsonb_build_object('plant_name', 'D307P'),
         'running', started_at + interval '1 hour', actor_user_id, input_scope, dataset_version_id
    FROM public.analysis_runs WHERE id = v_run
  RETURNING id INTO v_old;
  PERFORM public.analysis_complete_run(
    v_old,
    jsonb_build_array(jsonb_build_object('entity_type', 'supply_chain_row',
      'entity_id', gen_random_uuid()::text,
      'metrics', jsonb_build_object('is_critical', true, 'criticality_score', 0.9))),
    jsonb_build_object('rows', 1), '[]'::jsonb, v_user);

  -- ── 5 · the read: nodes, from the node run, drivers in rank order ────────
  UPDATE public.node_list SET echelon = 'supplier'
   WHERE project_id = v_project AND node_id IN ('S1', 'S2');
  v_stats := public.get_critical_node_stats(v_project, v_user);
  IF (v_stats ->> 'run_id')::uuid IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'D307 §5: the read answered from run % — expected the node run %, '
      'not the newer lane-row run %', v_stats ->> 'run_id', v_run, v_old;
  END IF;
  IF (v_stats ->> 'total')::int <> 4 OR (v_stats ->> 'nexus')::int <> 2 THEN
    RAISE EXCEPTION 'D307 §5: expected 4 nodes and 2 nexus, read %', v_stats;
  END IF;
  IF v_stats ->> 'method' <> 'demand_at_risk' OR (v_stats ->> 'threshold')::numeric <> 0.1
     OR v_stats ->> 'demand_basis' <> 'weekly_volume' THEN
    RAISE EXCEPTION 'D307 §5: method/threshold/basis did not reach the read: %', v_stats;
  END IF;
  IF jsonb_array_length(v_stats -> 'top') <> 3
     OR v_stats -> 'top' -> 0 ->> 'node_id' <> 'M1'
     OR v_stats -> 'top' -> 1 ->> 'node_id' <> 'S1'
     OR v_stats -> 'top' -> 1 ->> 'echelon' <> 'supplier' THEN
    RAISE EXCEPTION 'D307 §5: top is not the ranked nodes with their echelon: %', v_stats -> 'top';
  END IF;

  -- ── 6 · a reader who cannot see the project, or names nobody, is refused ─
  v_refused := false;
  BEGIN
    PERFORM public.get_critical_node_stats(v_project, v_stranger);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D307 §6: a user of another organization read this project''s nexus nodes';
  END IF;
  v_refused := false;
  BEGIN
    PERFORM public.get_critical_node_stats(v_project, NULL);
  EXCEPTION WHEN null_value_not_allowed THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D307 §6: the read answered a reader who named nobody';
  END IF;

  -- ── 7 · the grants are explicit ─────────────────────────────────────────
  FOR v_row IN
    SELECT * FROM (VALUES
      ('public.get_critical_node_stats(uuid,uuid)', 'anon'),
      ('public.get_critical_node_stats(uuid,uuid)', 'authenticated'),
      ('public.get_critical_node_stats(uuid,uuid)', 'service_role'),
      ('public.analysis_apply_critical_nodes(uuid,jsonb,uuid)', 'service_role')) g(fn, role)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid = v_row.fn::regprocedure AND r.rolname = v_row.role
       AND a.privilege_type = 'EXECUTE';
    IF v_n < 1 THEN
      RAISE EXCEPTION 'D307 §7: % is not an explicit EXECUTE grantee of %', v_row.role, v_row.fn;
    END IF;
  END LOOP;
  -- ...and the writer is NOT open to the browser roles.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid IN ('public.analysis_apply_critical_nodes(uuid,jsonb,uuid)'::regprocedure,
                   -- the deprecated lane-row writer too: it authorizes nothing either
                   'public.analysis_mark_critical_nodes(uuid,jsonb,uuid)'::regprocedure)
     AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
     AND a.privilege_type = 'EXECUTE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D307 §7: a critical-node writer is executable by PUBLIC, anon or authenticated (% grant(s))', v_n;
  END IF;

  RAISE NOTICE 'D307 · 890: nexus nodes are scored per node, kept on node_list, and read by project — 7 section(s)';
END $d307$;
