-- ONE DATASET AT A TIME — `20261001000024`, §4 D266.
--
-- `delete_project_dataset` gained the deep tier and the node list's uploaded fields, so
-- an owner can empty one wrong upload and upload it again. Each section calls the
-- function as the browser does (`anon`, the actor as a parameter).
--
--   §1 EACH DEEP-TIER BRANCH empties its table for project A only, and reports the count.
--   §2 'deep_tier' empties all three, edges first, and reports the sum.
--   §3 'node_list_uploads' clears the four uploaded columns and KEEPS the rows.
--   §4 'all' is UNCHANGED: it leaves the deep tier alone.
--   §5 WHO MAY: a modeler who is not the owner, and a super admin active in another
--      organization, are refused with `forbidden`; an admin of the organization is not.
--   §6 THE AUDIT ROW names the caller, with the session actor poisoned first.
--   §7 an unknown dataset is `invalid_dataset`.

DO $d690$
DECLARE
  v_org_a   uuid := gen_random_uuid();
  v_org_b   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_super_b uuid := gen_random_uuid();
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_p       uuid;
  v_n       integer;
  v_m       integer;
  v_audit   integer;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D690 A', 'd690a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D690 B', 'd690b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, is_active) VALUES
    (v_owner,   'D690 owner',   'd690o@example.invalid',  'x', 'modeler',     'D690 A', v_org_a, true),
    (v_admin,   'D690 admin',   'd690a@example.invalid',  'x', 'admin',       'D690 A', v_org_a, true),
    (v_other,   'D690 other',   'd690x@example.invalid',  'x', 'modeler',     'D690 A', v_org_a, true),
    (v_super_b, 'D690 super B', 'd690sb@example.invalid', 'x', 'super_admin', 'D690 B', v_org_b, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_a, 'D690 project A', v_owner, 'D690 plant', 'D690 A', v_org_a, 'single'),
    (v_b, 'D690 project B', v_owner, 'D690 plant', 'D690 A', v_org_a, 'single');

  -- Both projects get the same deep tier and node list; only A is ever deleted from.
  FOREACH v_p IN ARRAY ARRAY[v_a, v_b] LOOP
    INSERT INTO public.network_nodes (project_id, plant_name, organization, uid, name, depth) VALUES
      (v_p, 'D690 plant', 'D690 A', 'N1', 'Node one', 2),
      (v_p, 'D690 plant', 'D690 A', 'N2', 'Node two', 3),
      (v_p, 'D690 plant', 'D690 A', 'N3', 'Node three', 3);
    INSERT INTO public.network_edges (project_id, plant_name, organization, src_uid, dst_uid, depth) VALUES
      (v_p, 'D690 plant', 'D690 A', 'N2', 'N1', 3),
      (v_p, 'D690 plant', 'D690 A', 'N3', 'N1', 3);
    INSERT INTO public.network_summary (project_id, plant_name, organization, nodes_count, edges_count) VALUES
      (v_p, 'D690 plant', 'D690 A', 3, 2);
    INSERT INTO public.node_list (project_id, plant_name, organization, node_id, description_text, location_text, latitude, longitude) VALUES
      (v_p, 'D690 plant', 'D690 A', 'S-01', 'Steel mill', 'Hamburg, DE', 53.55, 9.99),
      (v_p, 'D690 plant', 'D690 A', 'C-11', NULL, 'Lyon, FR', 45.76, 4.84),
      (v_p, 'D690 plant', 'D690 A', 'P-100', NULL, NULL, NULL, NULL);
  END LOOP;

  SET LOCAL ROLE anon;

  -- ══ §5 · who may ══ (first, so a refusal is proven against full tables)
  BEGIN
    PERFORM public.delete_project_dataset(v_a, 'network_nodes', v_other, 'd690x@example.invalid');
    RAISE EXCEPTION 'D690/690 §5: a modeler who is not the owner deleted the deep-tier nodes';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_project_dataset(v_a, 'deep_tier', v_super_b, 'd690sb@example.invalid');
    RAISE EXCEPTION 'D690/690 §5: a super admin active in ANOTHER organization deleted the deep tier';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;

  -- ══ §7 · an unknown dataset ══
  BEGIN
    PERFORM public.delete_project_dataset(v_a, 'everything', v_owner, 'd690o@example.invalid');
    RAISE EXCEPTION 'D690/690 §7: an unknown dataset name was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_dataset' THEN RAISE; END IF;
  END;

  -- ══ §4 · 'all' leaves the deep tier and the node list alone ══
  PERFORM public.delete_project_dataset(v_a, 'all', v_owner, 'd690o@example.invalid');
  RESET ROLE;
  SELECT (SELECT count(*) FROM public.network_nodes   WHERE project_id = v_a)
       + (SELECT count(*) FROM public.network_edges   WHERE project_id = v_a)
       + (SELECT count(*) FROM public.network_summary WHERE project_id = v_a) INTO v_n;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'D690/690 §4: ''all'' changed the deep tier (% rows left of 6); it must stay as it was', v_n;
  END IF;

  -- ══ §6 · the audit row names the caller ══
  SELECT count(*) INTO v_audit FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_edges' AND actor_user_id = v_owner;
  PERFORM set_config('app.current_user_id', v_other::text, true);  -- POISON
  SET LOCAL ROLE anon;

  -- ══ §1 · each deep-tier branch ══
  v_n := public.delete_project_dataset(v_a, 'network_edges', v_owner, 'd690o@example.invalid');
  IF v_n <> 2 THEN RAISE EXCEPTION 'D690/690 §1: network_edges reported %, want 2', v_n; END IF;
  v_n := public.delete_project_dataset(v_a, 'deep_nodes', v_owner, 'd690o@example.invalid');
  IF v_n <> 3 THEN RAISE EXCEPTION 'D690/690 §1: deep_nodes reported %, want 3', v_n; END IF;
  -- An admin of the organization may too.
  v_n := public.delete_project_dataset(v_a, 'network_summary', v_admin, 'd690a@example.invalid');
  IF v_n <> 1 THEN RAISE EXCEPTION 'D690/690 §1: network_summary reported %, want 1', v_n; END IF;
  RESET ROLE;

  SELECT (SELECT count(*) FROM public.network_nodes   WHERE project_id = v_a)
       + (SELECT count(*) FROM public.network_edges   WHERE project_id = v_a)
       + (SELECT count(*) FROM public.network_summary WHERE project_id = v_a) INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D690/690 §1: % deep-tier rows of project A survived', v_n; END IF;
  SELECT (SELECT count(*) FROM public.network_nodes   WHERE project_id = v_b)
       + (SELECT count(*) FROM public.network_edges   WHERE project_id = v_b)
       + (SELECT count(*) FROM public.network_summary WHERE project_id = v_b) INTO v_n;
  IF v_n <> 6 THEN RAISE EXCEPTION 'D690/690 §1: project B lost deep-tier rows (% of 6 left)', v_n; END IF;

  SELECT count(*) INTO v_m FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_edges' AND actor_user_id = v_owner;
  IF v_m <= v_audit THEN
    RAISE EXCEPTION 'D690/690 §6: deleting network_edges wrote no data-plane audit row naming the owner';
  END IF;

  -- ══ §2 · 'deep_tier' on project B ══
  SET LOCAL ROLE anon;
  v_n := public.delete_project_dataset(v_b, 'deep_tier', v_owner, 'd690o@example.invalid');
  RESET ROLE;
  IF v_n <> 6 THEN RAISE EXCEPTION 'D690/690 §2: deep_tier reported %, want 6', v_n; END IF;
  SELECT (SELECT count(*) FROM public.network_nodes   WHERE project_id = v_b)
       + (SELECT count(*) FROM public.network_edges   WHERE project_id = v_b)
       + (SELECT count(*) FROM public.network_summary WHERE project_id = v_b) INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'D690/690 §2: % deep-tier rows of project B survived deep_tier', v_n; END IF;

  -- ══ §3 · node_list_uploads ══
  SET LOCAL ROLE anon;
  v_n := public.delete_project_dataset(v_a, 'node_list_uploads', v_owner, 'd690o@example.invalid');
  RESET ROLE;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'D690/690 §3: node_list_uploads reported %, want 2 (the row with nothing uploaded is not counted)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.node_list WHERE project_id = v_a;
  IF v_n <> 3 THEN RAISE EXCEPTION 'D690/690 §3: node_list_uploads deleted rows (% of 3 left)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_a
     AND (description_text IS NOT NULL OR location_text IS NOT NULL OR latitude IS NOT NULL OR longitude IS NOT NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 'D690/690 §3: % node(s) of project A still carry uploaded fields', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_b AND location_text IS NOT NULL;
  IF v_n <> 2 THEN RAISE EXCEPTION 'D690/690 §3: project B''s node list was cleared too (% of 2 locations left)', v_n; END IF;
END $d690$;
