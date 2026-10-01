-- §4 D233–D238 · GRAPH VERSIONS PER LEVEL; METRICS COMPUTED ONCE (WP 10.1).
--
-- §1  the composite does not move: `current_graph_hash` is still the v3 composite,
--     byte for byte, so no card and no run reads "data drift" for this package.
-- §2  the stored hash: an edit flips `dirty`; a read clears it; the stored hash
--     equals a fresh rebuild; a second read builds nothing.
-- §3  the levels: a PRICE edit moves `product` only; a TOPOLOGY edit (a deep-tier
--     edge) moves `firm` only; a lane QUANTITY moves `process` and `product`.
-- §4  graph versions: one per content, numbered; reverting an edit returns the
--     original version; a promotion (`ingest_runs` → applied) takes one.
-- §5  compute once: each kind claimed twice on unchanged data is ONE run; a price
--     edit leaves the firm and process keys alone; an undeclared kind keys on all;
--     `network_metrics` falls back to the process level when the deep tier is
--     incomplete and the store says so.
-- §6  process_structure: computed once, read on the second call, reachability
--     followed transitively in both directions.
-- §7  the firm page's read returns prominence with its provenance.
-- §8  a project with hashed children can still be deleted (the touch must not
--     resurrect a state row for a project that is going away).

DO $g570$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_proj  uuid := gen_random_uuid();
  v_proj2 uuid := gen_random_uuid();
  v_proj3 uuid := gen_random_uuid();
  v_h0    jsonb;
  v_h1    jsonb;
  v_h2    jsonb;
  v_st    public.project_graph_state%ROWTYPE;
  v_v1    uuid;
  v_v2    uuid;
  v_v3    uuid;
  v_no    integer;
  v_c1    jsonb;
  v_c2    jsonb;
  v_n     integer;
  v_kind  text;
  v_state text;
  v_ps    jsonb;
  v_run   uuid;
  v_row   record;
BEGIN
  -- The catalog's ROWS are data, and a base built from the artifact (`--since
  -- HEAD`) has the table without them; production and a fresh rehearsal both run
  -- the migration's seed, so this is a no-op there. `analysisKindsParity.test.ts`
  -- holds the seed itself.
  INSERT INTO public.analysis_kinds (kind, input_scope, fallback_scope, fallback_rule, description) VALUES
    ('network_metrics', 'firm', 'process', 'deep_tier_incomplete', 'rehearsal seed'),
    ('prominence', 'firm', NULL, NULL, 'rehearsal seed'),
    ('critical_nodes', 'process', NULL, NULL, 'rehearsal seed'),
    ('combine_etl', 'process', NULL, NULL, 'rehearsal seed'),
    ('process_structure', 'process', NULL, NULL, 'rehearsal seed')
  ON CONFLICT (kind) DO NOTHING;

  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'r570@example.invalid', 'R570', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_proj, 'R570', v_user, 'P'), (v_proj2, 'R570 doomed', v_user, 'P');
  PERFORM set_config('app.current_user_id', v_user::text, true);

  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10);
  INSERT INTO public.products (project_id, product_id) VALUES (v_proj, 'P1');
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit)
    VALUES (v_proj, 'P', 'S1', 'M1', 4, 100, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate)
    VALUES (v_proj, 'P', 'P1', 'M1', 2);

  -- ══ §1 · the composite is the v3 composite ══
  v_h0 := public.project_graph_hashes(v_proj);
  IF (v_h0 ->> 'graph_hash') IS DISTINCT FROM
     public._dataset_graph_hash(public._build_dataset_snapshot(v_proj)) THEN
    RAISE EXCEPTION 'R570 §1: the stored composite differs from the v3 composite of the same data';
  END IF;
  IF (public._build_dataset_snapshot(v_proj) ->> 'schema_version') IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'R570 §1: schema_version moved — every card and run would read data drift';
  END IF;
  IF public.current_graph_hash(v_proj) IS DISTINCT FROM v_h0 ->> 'graph_hash' THEN
    RAISE EXCEPTION 'R570 §1: current_graph_hash disagrees with project_graph_hashes';
  END IF;

  -- ══ §2 · stored, dirtied by an edit, cleared by a read ══
  SELECT * INTO v_st FROM public.project_graph_state WHERE project_id = v_proj;
  IF NOT FOUND OR v_st.dirty THEN
    RAISE EXCEPTION 'R570 §2: a read did not store a clean state';
  END IF;
  IF (public.project_graph_hashes(v_proj) ->> 'stored')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'R570 §2: a second read of unchanged data rebuilt the snapshot';
  END IF;
  UPDATE public.materials SET cost = 11 WHERE project_id = v_proj;
  IF NOT (SELECT dirty FROM public.project_graph_state WHERE project_id = v_proj) THEN
    RAISE EXCEPTION 'R570 §2: an edit to a hashed table did not flip dirty';
  END IF;
  v_h1 := public.project_graph_hashes(v_proj);
  IF (SELECT dirty FROM public.project_graph_state WHERE project_id = v_proj) THEN
    RAISE EXCEPTION 'R570 §2: a read after an edit did not clear dirty';
  END IF;
  IF (SELECT graph_hash FROM public.project_graph_state WHERE project_id = v_proj)
     IS DISTINCT FROM public._dataset_graph_hash(public._build_dataset_snapshot(v_proj)) THEN
    RAISE EXCEPTION 'R570 §2: the stored hash is not a fresh rebuild''s';
  END IF;

  -- ══ §3 · each edit moves its own level ══
  -- the price edit above (materials.cost 10 → 11)
  IF v_h1 ->> 'hash_product' = v_h0 ->> 'hash_product' THEN
    RAISE EXCEPTION 'R570 §3: a price edit did not move the product level';
  END IF;
  IF v_h1 ->> 'hash_firm' IS DISTINCT FROM v_h0 ->> 'hash_firm'
     OR v_h1 ->> 'hash_process' IS DISTINCT FROM v_h0 ->> 'hash_process' THEN
    RAISE EXCEPTION 'R570 §3: a price edit moved the firm or process level';
  END IF;
  -- a topology edit
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue) VALUES
    (v_proj, 'P', 'F1', 'Firm one', 5), (v_proj, 'P', 'F2', 'Firm two', 7);
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_proj, 'P', 'F1', 'F2', 0.5);
  v_h2 := public.project_graph_hashes(v_proj);
  IF v_h2 ->> 'hash_firm' = v_h1 ->> 'hash_firm' THEN
    RAISE EXCEPTION 'R570 §3: a deep-tier edit did not move the firm level';
  END IF;
  IF v_h2 ->> 'hash_product' IS DISTINCT FROM v_h1 ->> 'hash_product'
     OR v_h2 ->> 'hash_process' IS DISTINCT FROM v_h1 ->> 'hash_process' THEN
    RAISE EXCEPTION 'R570 §3: a deep-tier edit moved the product or process level';
  END IF;
  -- a lane quantity
  UPDATE public.inbound_logistics SET volume = 120 WHERE project_id = v_proj;
  v_h0 := public.project_graph_hashes(v_proj);
  IF v_h0 ->> 'hash_process' = v_h2 ->> 'hash_process' THEN
    RAISE EXCEPTION 'R570 §3: a lane volume did not move the process level';
  END IF;
  UPDATE public.inbound_logistics SET unit_price = 5 WHERE project_id = v_proj;
  v_h1 := public.project_graph_hashes(v_proj);
  IF v_h1 ->> 'hash_process' IS DISTINCT FROM v_h0 ->> 'hash_process' THEN
    RAISE EXCEPTION 'R570 §3: a lane PRICE moved the process level';
  END IF;

  -- ══ §4 · graph versions ══
  v_v1 := public.snapshot_dataset(v_proj, 'first', v_user);
  IF public.snapshot_dataset(v_proj, 'again', v_user) IS DISTINCT FROM v_v1 THEN
    RAISE EXCEPTION 'R570 §4: an unchanged world minted a second version';
  END IF;
  UPDATE public.materials SET cost = 99 WHERE project_id = v_proj;
  v_v2 := public.snapshot_dataset(v_proj, 'edited', v_user);
  -- One transaction gives every version one `created_at`; space them out so the
  -- latest version is v2, which is the only shape in which "dedupe against the
  -- latest" and "dedupe against any" give different answers.
  UPDATE public.dataset_versions SET created_at = now() - interval '2 minutes' WHERE id = v_v1;
  UPDATE public.dataset_versions SET created_at = now() - interval '1 minute'  WHERE id = v_v2;
  UPDATE public.materials SET cost = 11 WHERE project_id = v_proj;
  v_v3 := public.snapshot_dataset(v_proj, 'reverted', v_user);
  IF v_v3 IS DISTINCT FROM v_v1 THEN
    RAISE EXCEPTION 'R570 §4: reverting an edit minted % rather than returning the original %  — D234', v_v3, v_v1;
  END IF;
  SELECT version_no INTO v_no FROM public.dataset_versions WHERE id = v_v2;
  IF v_no IS DISTINCT FROM (SELECT version_no FROM public.dataset_versions WHERE id = v_v1) + 1 THEN
    RAISE EXCEPTION 'R570 §4: the edited world is numbered %, not the next number', v_no;
  END IF;
  IF (SELECT hash_firm FROM public.dataset_versions WHERE id = v_v1) IS NULL THEN
    RAISE EXCEPTION 'R570 §4: a new version carries no level hashes';
  END IF;
  -- a promotion takes a version
  UPDATE public.materials SET cost = 12 WHERE project_id = v_proj;
  SELECT count(*) INTO v_n FROM public.dataset_versions WHERE project_id = v_proj;
  INSERT INTO public.ingest_runs (id, project_id, source_kind, triggered_by, triggered_by_user_id, status)
    VALUES (gen_random_uuid(), v_proj, 'csv', 'manual', v_user, 'staged') RETURNING id INTO v_run;
  UPDATE public.ingest_runs SET status = 'applied', applied_at = now(), applied_by_user_id = v_user WHERE id = v_run;
  IF (SELECT count(*) FROM public.dataset_versions WHERE project_id = v_proj) <> v_n + 1 THEN
    RAISE EXCEPTION 'R570 §4: a promotion reaching applied took no graph version';
  END IF;
  IF (public.capture_graph_version(v_proj, v_user) ->> 'created')::boolean THEN
    RAISE EXCEPTION 'R570 §4: capturing an unchanged world reported a new version';
  END IF;

  -- ══ §5 · compute once ══
  FOREACH v_kind IN ARRAY ARRAY['network_metrics','prominence','critical_nodes','process_structure'] LOOP
    v_c1 := public.analysis_get_or_start(v_proj, v_kind, '{}'::jsonb, 'r570@1', v_user);
    PERFORM public.analysis_complete_run((v_c1 ->> 'run_id')::uuid, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, v_user);
    v_c2 := public.analysis_get_or_start(v_proj, v_kind, '{}'::jsonb, 'r570@1', v_user);
    IF (v_c2 ->> 'cache_hit')::boolean IS NOT TRUE OR v_c2 ->> 'run_id' <> v_c1 ->> 'run_id' THEN
      RAISE EXCEPTION 'R570 §5: % claimed twice on unchanged data was not one run', v_kind;
    END IF;
    IF v_c1 ->> 'dataset_version_id' IS NULL THEN
      RAISE EXCEPTION 'R570 §5: % ran without naming its graph version', v_kind;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.analysis_runs WHERE project_id = v_proj AND code_version = 'r570@1';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'R570 §5: four kinds claimed twice each wrote % runs, expected 4', v_n;
  END IF;
  IF (SELECT input_scope FROM public.analysis_runs
       WHERE project_id = v_proj AND analysis_kind = 'network_metrics' AND code_version = 'r570@1') <> 'firm' THEN
    RAISE EXCEPTION 'R570 §5: with a complete deep tier, network_metrics did not key on the firm level';
  END IF;
  -- a price edit leaves firm and process keys where they were
  UPDATE public.materials SET cost = 13 WHERE project_id = v_proj;
  FOREACH v_kind IN ARRAY ARRAY['network_metrics','prominence','critical_nodes'] LOOP
    v_c2 := public.analysis_get_or_start(v_proj, v_kind, '{}'::jsonb, 'r570@1', v_user);
    IF (v_c2 ->> 'cache_hit')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'R570 §5: a price edit invalidated % — D235', v_kind;
    END IF;
  END LOOP;
  SELECT id INTO v_run FROM public.analysis_runs
   WHERE project_id = v_proj AND analysis_kind = 'prominence' AND code_version = 'r570@1';
  IF public.analysis_run_is_current(v_run) IS NOT TRUE
     OR public.analysis_current_run(v_proj, 'prominence') IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'R570 §5: after a price edit the prominence run does not read as current';
  END IF;
  -- an undeclared kind keys on everything (the open enum stays open, and stays safe)
  v_c1 := public.analysis_get_or_start(v_proj, 'not_a_kind', '{}'::jsonb, 'r570@1', v_user);
  IF v_c1 ->> 'input_scope' <> 'all' OR v_c1 ->> 'input_hash' <> public.current_graph_hash(v_proj) THEN
    RAISE EXCEPTION 'R570 §5: an undeclared kind did not key on the composite: %', v_c1;
  END IF;
  -- the fallback: no deep-tier edges → network_metrics keys on the process level
  DELETE FROM public.network_edges WHERE project_id = v_proj;
  IF public.analysis_scope_now(v_proj, 'network_metrics') <> 'process' THEN
    RAISE EXCEPTION 'R570 §5: an incomplete deep tier did not resolve network_metrics to the process level';
  END IF;
  IF public.analysis_run_is_current(
       (SELECT id FROM public.analysis_runs WHERE project_id = v_proj
         AND analysis_kind = 'network_metrics' AND code_version = 'r570@1')) IS NOT FALSE THEN
    RAISE EXCEPTION 'R570 §5: a firm-level run reads current after the kind fell back to the lanes';
  END IF;
  v_c1 := public.analysis_get_or_start(v_proj, 'network_metrics', '{}'::jsonb, 'r570@1', v_user);
  IF v_c1 ->> 'input_scope' <> 'process' OR (v_c1 ->> 'cache_hit')::boolean THEN
    RAISE EXCEPTION 'R570 §5: the fallback claim was not a fresh process-level run: %', v_c1;
  END IF;

  -- ══ §6 · process_structure ══
  INSERT INTO public.supply_chain_data_multi_tier (project_id, plant_name, from_location, to_location, level, data_source) VALUES
    (v_proj, 'P', 'S1', 'M1', 2, 'inbound'),
    (v_proj, 'P', 'M1', 'A1', 1, 'bom'),
    (v_proj, 'P', 'A1', 'P1', 1, 'bom'),
    (v_proj, 'P', 'P1', 'C1', 0, 'outbound');
  v_ps := public.process_structure(v_proj, v_user);
  IF (v_ps ->> 'cache_hit')::boolean THEN
    RAISE EXCEPTION 'R570 §6: the first process_structure call reported a cache hit';
  END IF;
  IF NOT (v_ps -> 'reachable' -> 'M1' -> 'downstream') @> '["A1","P1","C1"]'::jsonb
     OR NOT (v_ps -> 'reachable' -> 'M1' -> 'upstream') @> '["S1"]'::jsonb THEN
    RAISE EXCEPTION 'R570 §6: reachability from M1 is wrong: %', v_ps -> 'reachable' -> 'M1';
  END IF;
  v_ps := public.process_structure(v_proj, v_user);
  IF (v_ps ->> 'cache_hit')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'R570 §6: the second call on unchanged data recomputed';
  END IF;
  SELECT count(*) INTO v_n FROM public.analysis_runs WHERE project_id = v_proj AND analysis_kind = 'process_structure'
     AND code_version = 'process_structure@wp101.1';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R570 §6: % process_structure runs for one world', v_n;
  END IF;

  -- ══ §7 · the firm read carries prominence and its provenance ══
  -- Its own project: every run in this block starts at one `now()`, so "newest" in
  -- a project with several prominence runs would be decided by uuid order.
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_proj3, 'R570 firm', v_user, 'P');
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue) VALUES
    (v_proj3, 'P', 'F1', 'Firm one', 5), (v_proj3, 'P', 'F2', 'Firm two', 7);
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_proj3, 'P', 'F1', 'F2', 0.5);
  v_c1 := public.analysis_get_or_start(v_proj3, 'prominence', '{}'::jsonb, 'r570@2', v_user);
  PERFORM public.analysis_complete_run((v_c1 ->> 'run_id')::uuid,
    '[{"entity_type":"node","entity_id":"F1","metrics":{"prominence":0.75}}]'::jsonb,
    '{}'::jsonb, '[]'::jsonb, v_user);
  SELECT * INTO v_row FROM public.get_network_nodes(v_proj3, v_user, 'r570@example.invalid') WHERE uid = 'F1';
  IF v_row.prominence IS DISTINCT FROM 0.75 OR v_row.metrics_source <> 'store' OR v_row.hash_is_current IS NOT TRUE THEN
    RAISE EXCEPTION 'R570 §7: get_network_nodes returned prominence % from % (current %)',
      v_row.prominence, v_row.metrics_source, v_row.hash_is_current;
  END IF;
  SELECT * INTO v_row FROM public.get_network_nodes(v_proj3, v_user, 'r570@example.invalid') WHERE uid = 'F2';
  IF v_row.metrics_source <> 'none' OR v_row.prominence IS NOT NULL THEN
    RAISE EXCEPTION 'R570 §7: a node with no stored prominence reported % from %', v_row.prominence, v_row.metrics_source;
  END IF;
  -- a topology edit makes the stored figure stale, and the read SAYS so
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_proj3, 'P', 'F2', 'F1', 0.2);
  SELECT * INTO v_row FROM public.get_network_nodes(v_proj3, v_user, 'r570@example.invalid') WHERE uid = 'F1';
  IF v_row.hash_is_current IS NOT FALSE OR v_row.prominence IS DISTINCT FROM 0.75 THEN
    RAISE EXCEPTION 'R570 §7: after a topology edit the stored prominence reads current=% (value %)',
      v_row.hash_is_current, v_row.prominence;
  END IF;

  -- ══ §8 · a project with hashed children can still be deleted ══
  INSERT INTO public.materials (project_id, material_id) VALUES (v_proj2, 'MX');
  PERFORM public.project_graph_hashes(v_proj2);
  DELETE FROM public.projects WHERE id = v_proj2;
  IF EXISTS (SELECT 1 FROM public.project_graph_state WHERE project_id = v_proj2) THEN
    RAISE EXCEPTION 'R570 §8: a deleted project left a graph state row';
  END IF;
END
$g570$;
