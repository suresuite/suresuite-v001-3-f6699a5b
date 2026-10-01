-- §4 D258 · A VERSION PER LEVEL (WP 11.1).
--
-- §1  a snapshot registers three level rows, each numbered 1, and the snapshot
--     names them (its tuple).
-- §2  a PRICE edit + capture moves PRODUCT to v2; process and firm stay v1 — the
--     same rows, not copies (prices are not in the process level).
-- §3  a BOM QUANTITY edit moves product AND process; firm stays v1.
-- §4  a deep-tier edit moves FIRM only: before the capture the state says product
--     and process are current and firm is unsaved; after it, firm is v2.
-- §5  reverting the deep tier — with a price edit in between, so the composite is
--     NEW and the LATEST firm version is v2 — returns Firm v1 and mints no firm row.
-- §6  the newest snapshot's tuple names exactly the three versions the state says.
-- §7  the backfill numbers a planted history in `created_at` order per project,
--     not in insertion order, and a NULL level hash registers nothing.
-- §8  immutability: content and number refuse an UPDATE; the cascade that forgets
--     a deleted first snapshot does not.
-- §9  doors: no API role writes the table, nor plants the snapshot that would
--     register one (D265); the registering, backfill and number
--     functions are not executable by `anon` or `authenticated` (D248); the audit
--     row of a registration names the actor who froze the snapshot.

DO $g660$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_proj  uuid := gen_random_uuid();
  v_proj3 uuid := gen_random_uuid();
  v_d1    uuid;
  v_d2    uuid;
  v_d3    uuid;
  v_d4    uuid;
  v_d5    uuid;
  v_p1    uuid;
  v_r1    uuid;
  v_f1    uuid;
  v_dv    public.dataset_versions%ROWTYPE;
  v_st    jsonb;
  v_n     integer;
  v_cap   jsonb;
  v_a     uuid;
  v_b     uuid;
  v_c     uuid;
  v_ok    boolean;
  v_row   record;

  -- the level version a snapshot names for one level
  v_no    integer;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'r650@example.invalid', 'R660', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_proj, 'R660', v_user, 'P'), (v_proj3, 'R660 history', v_user, 'P');
  PERFORM set_config('app.current_user_id', v_user::text, true);

  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_proj, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_proj, 'M1', 10);
  INSERT INTO public.products (project_id, product_id) VALUES (v_proj, 'P1');
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id, unit_price, volume, time_unit)
    VALUES (v_proj, 'P', 'S1', 'M1', 4, 100, 'week');
  INSERT INTO public.bom_single_level (project_id, plant_name, product_id, material_id, consumption_rate)
    VALUES (v_proj, 'P', 'P1', 'M1', 2);

  -- ══ §1 · one snapshot, three level rows numbered 1 ══
  v_d1 := public.snapshot_dataset(v_proj, 'first', v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_d1;
  SELECT count(*) INTO v_n FROM public.graph_level_versions WHERE project_id = v_proj;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'R660 §1: a snapshot registered % level rows, expected 3 (product, process, firm)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.graph_level_versions WHERE project_id = v_proj AND version_no <> 1) THEN
    RAISE EXCEPTION 'R660 §1: a first snapshot''s level is not numbered 1';
  END IF;
  v_p1 := v_dv.product_version_id; v_r1 := v_dv.process_version_id; v_f1 := v_dv.firm_version_id;
  IF v_p1 IS NULL OR v_r1 IS NULL OR v_f1 IS NULL THEN
    RAISE EXCEPTION 'R660 §1: the snapshot does not name its tuple (% / % / %)', v_p1, v_r1, v_f1;
  END IF;
  IF (SELECT level_hash FROM public.graph_level_versions WHERE id = v_p1) IS DISTINCT FROM v_dv.hash_product
     OR (SELECT level_hash FROM public.graph_level_versions WHERE id = v_r1) IS DISTINCT FROM v_dv.hash_process
     OR (SELECT level_hash FROM public.graph_level_versions WHERE id = v_f1) IS DISTINCT FROM v_dv.hash_firm THEN
    RAISE EXCEPTION 'R660 §1: a level row carries a hash its snapshot does not';
  END IF;
  IF (SELECT first_dataset_version_id FROM public.graph_level_versions WHERE id = v_p1) IS DISTINCT FROM v_d1 THEN
    RAISE EXCEPTION 'R660 §1: the level row does not name the snapshot that first carried it';
  END IF;

  -- ══ §2 · a price edit moves product only ══
  UPDATE public.materials SET cost = 11 WHERE project_id = v_proj;
  v_d2 := public.snapshot_dataset(v_proj, 'price', v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_d2;
  IF v_d2 = v_d1 THEN RAISE EXCEPTION 'R660 §2: a price edit did not make a new snapshot'; END IF;
  SELECT version_no INTO v_no FROM public.graph_level_versions WHERE id = v_dv.product_version_id;
  IF v_no IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R660 §2: a price edit made product v%, expected v2', v_no;
  END IF;
  IF v_dv.process_version_id IS DISTINCT FROM v_r1 OR v_dv.firm_version_id IS DISTINCT FROM v_f1 THEN
    RAISE EXCEPTION 'R660 §2: a price edit moved the process or firm version';
  END IF;

  -- ══ §3 · a BOM quantity moves product AND process ══
  UPDATE public.bom_single_level SET consumption_rate = 3 WHERE project_id = v_proj;
  v_d3 := public.snapshot_dataset(v_proj, 'bom', v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_d3;
  SELECT version_no INTO v_no FROM public.graph_level_versions WHERE id = v_dv.product_version_id;
  IF v_no IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'R660 §3: a BOM quantity made product v%, expected v3', v_no;
  END IF;
  SELECT version_no INTO v_no FROM public.graph_level_versions WHERE id = v_dv.process_version_id;
  IF v_no IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R660 §3: a BOM quantity made process v%, expected v2 (numbered per LEVEL, not per project)', v_no;
  END IF;
  IF v_dv.firm_version_id IS DISTINCT FROM v_f1 THEN
    RAISE EXCEPTION 'R660 §3: a BOM quantity moved the firm version';
  END IF;

  -- ══ §4 · a deep-tier edit moves firm only, and says so before the capture ══
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue) VALUES
    (v_proj, 'P', 'F1', 'Firm one', 5), (v_proj, 'P', 'F2', 'Firm two', 7);
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_proj, 'P', 'F1', 'F2', 0.5);
  v_st := public.get_graph_version_state(v_proj);
  IF (v_st #>> '{levels,product,unsaved}')::boolean IS NOT FALSE
     OR (v_st #>> '{levels,product,current_version,version_no}')::int IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'R660 §4: after a deep-tier edit the product level does not read current v3: %', v_st -> 'levels' -> 'product';
  END IF;
  IF (v_st #>> '{levels,process,unsaved}')::boolean IS NOT FALSE
     OR (v_st #>> '{levels,process,current_version,version_no}')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R660 §4: after a deep-tier edit the process level does not read current v2: %', v_st -> 'levels' -> 'process';
  END IF;
  IF (v_st #>> '{levels,firm,unsaved}')::boolean IS NOT TRUE
     OR (v_st #> '{levels,firm,current_version}') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'R660 §4: after a deep-tier edit the firm level does not read unsaved: %', v_st -> 'levels' -> 'firm';
  END IF;
  IF (v_st -> 'current_version') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'R660 §4: the composite reads a saved version for an unsaved world';
  END IF;
  v_cap := public.capture_graph_version(v_proj, v_user, 'deep tier');
  v_d4 := (v_cap ->> 'dataset_version_id')::uuid;
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_d4;
  SELECT version_no INTO v_no FROM public.graph_level_versions WHERE id = v_dv.firm_version_id;
  IF v_no IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R660 §4: the deep-tier capture made firm v%, expected v2', v_no;
  END IF;
  IF v_dv.product_version_id IS DISTINCT FROM (SELECT product_version_id FROM public.dataset_versions WHERE id = v_d3)
     OR v_dv.process_version_id IS DISTINCT FROM (SELECT process_version_id FROM public.dataset_versions WHERE id = v_d3) THEN
    RAISE EXCEPTION 'R660 §4: a deep-tier capture moved the product or process version';
  END IF;
  v_st := public.get_graph_version_state(v_proj);
  IF (v_st #>> '{levels,firm,unsaved}')::boolean IS NOT FALSE
     OR (v_st #>> '{levels,firm,current_version,version_no}')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'R660 §4: after the capture the firm level does not read current v2';
  END IF;

  -- ══ §5 · revert the deep tier past a newer firm version → Firm v1, no new row ══
  UPDATE public.materials SET cost = 12 WHERE project_id = v_proj;      -- a NEW composite
  DELETE FROM public.network_edges WHERE project_id = v_proj;
  DELETE FROM public.network_nodes WHERE project_id = v_proj;
  SELECT count(*) INTO v_n FROM public.graph_level_versions WHERE project_id = v_proj AND level = 'firm';
  v_d5 := public.snapshot_dataset(v_proj, 'revert', v_user);
  SELECT * INTO v_dv FROM public.dataset_versions WHERE id = v_d5;
  IF v_d5 IN (v_d1, v_d2, v_d3, v_d4) THEN
    RAISE EXCEPTION 'R660 §5: the fixture did not produce a new composite — it cannot tell "any" from "latest"';
  END IF;
  IF v_dv.firm_version_id IS DISTINCT FROM v_f1 THEN
    RAISE EXCEPTION 'R660 §5: reverting the deep tier did not return Firm v1 (got version %)',
      (SELECT version_no FROM public.graph_level_versions WHERE id = v_dv.firm_version_id);
  END IF;
  IF (SELECT count(*) FROM public.graph_level_versions WHERE project_id = v_proj AND level = 'firm') <> v_n THEN
    RAISE EXCEPTION 'R660 §5: reverting the deep tier minted a firm row';
  END IF;
  SELECT version_no INTO v_no FROM public.graph_level_versions WHERE id = v_dv.product_version_id;
  IF v_no IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'R660 §5: the price edit beside the revert made product v%, expected v4', v_no;
  END IF;

  -- ══ §6 · the state and the newest snapshot's tuple agree ══
  v_st := public.get_graph_version_state(v_proj);
  IF (v_st #>> '{levels,product,current_version,id}')::uuid IS DISTINCT FROM v_dv.product_version_id
     OR (v_st #>> '{levels,process,current_version,id}')::uuid IS DISTINCT FROM v_dv.process_version_id
     OR (v_st #>> '{levels,firm,current_version,id}')::uuid IS DISTINCT FROM v_dv.firm_version_id THEN
    RAISE EXCEPTION 'R660 §6: the state and the snapshot name different level versions';
  END IF;
  IF (v_st #>> '{levels,firm,version_count}')::int <> 2
     OR (v_st #>> '{levels,firm,latest_version,version_no}')::int <> 2 THEN
    RAISE EXCEPTION 'R660 §6: the firm level''s history is not two versions with v2 the latest: %', v_st #> '{levels,firm}';
  END IF;

  -- ══ §7 · the backfill numbers history in created_at order ══
  -- Three snapshots planted with registration OFF, inserted newest-first; then the
  -- migration's own backfill function. The process level is one content all along;
  -- the third snapshot predates the firm level (a NULL hash).
  ALTER TABLE public.dataset_versions DISABLE TRIGGER dataset_versions_register_levels_ins;
  INSERT INTO public.dataset_versions (project_id, label, snapshot, graph_hash, hash_product, hash_process, hash_firm, created_at)
    VALUES (v_proj3, 'c', '{}'::jsonb, 'g-c', 'p-c', 'r-same', 'f-c', now() - interval '1 day')
    RETURNING id INTO v_c;
  INSERT INTO public.dataset_versions (project_id, label, snapshot, graph_hash, hash_product, hash_process, hash_firm, created_at)
    VALUES (v_proj3, 'a', '{}'::jsonb, 'g-a', 'p-a', 'r-same', NULL, now() - interval '3 days')
    RETURNING id INTO v_a;
  INSERT INTO public.dataset_versions (project_id, label, snapshot, graph_hash, hash_product, hash_process, hash_firm, created_at)
    VALUES (v_proj3, 'b', '{}'::jsonb, 'g-b', 'p-b', 'r-same', 'f-b', now() - interval '2 days')
    RETURNING id INTO v_b;
  ALTER TABLE public.dataset_versions ENABLE TRIGGER dataset_versions_register_levels_ins;
  IF EXISTS (SELECT 1 FROM public.graph_level_versions WHERE project_id = v_proj3) THEN
    RAISE EXCEPTION 'R660 §7: the planted history registered with the trigger disabled';
  END IF;
  IF public._graph_level_backfill(v_proj3) <> 3 THEN
    RAISE EXCEPTION 'R660 §7: the backfill did not visit the three planted snapshots';
  END IF;
  FOR v_row IN
    SELECT dv.label, p.version_no AS p_no, r.version_no AS r_no, f.version_no AS f_no, dv.firm_version_id
      FROM public.dataset_versions dv
      LEFT JOIN public.graph_level_versions p ON p.id = dv.product_version_id
      LEFT JOIN public.graph_level_versions r ON r.id = dv.process_version_id
      LEFT JOIN public.graph_level_versions f ON f.id = dv.firm_version_id
     WHERE dv.project_id = v_proj3
  LOOP
    IF v_row.p_no IS DISTINCT FROM (CASE v_row.label WHEN 'a' THEN 1 WHEN 'b' THEN 2 ELSE 3 END) THEN
      RAISE EXCEPTION 'R660 §7: snapshot % is product v%, expected the created_at order (a=1, b=2, c=3)', v_row.label, v_row.p_no;
    END IF;
    IF v_row.r_no IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'R660 §7: snapshot % is process v% for one unchanged content, expected v1', v_row.label, v_row.r_no;
    END IF;
    IF v_row.label = 'a' AND v_row.firm_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'R660 §7: a NULL firm hash registered a firm version';
    END IF;
    IF v_row.label <> 'a' AND v_row.f_no IS DISTINCT FROM (CASE v_row.label WHEN 'b' THEN 1 ELSE 2 END) THEN
      RAISE EXCEPTION 'R660 §7: snapshot % is firm v%, expected b=1, c=2', v_row.label, v_row.f_no;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.graph_level_versions WHERE project_id = v_proj3 AND level = 'firm' AND level_hash IS NULL) THEN
    RAISE EXCEPTION 'R660 §7: a firm row carries no hash';
  END IF;
  -- Idempotent: a second pass mints nothing.
  SELECT count(*) INTO v_n FROM public.graph_level_versions WHERE project_id = v_proj3;
  PERFORM public._graph_level_backfill(v_proj3);
  IF (SELECT count(*) FROM public.graph_level_versions WHERE project_id = v_proj3) <> v_n THEN
    RAISE EXCEPTION 'R660 §7: a second backfill minted level rows';
  END IF;

  -- ══ §8 · immutability ══
  v_ok := false;
  BEGIN
    UPDATE public.graph_level_versions SET level_hash = 'tampered' WHERE id = v_p1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'R660 §8: a level version''s hash was editable'; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.graph_level_versions SET version_no = 99 WHERE id = v_p1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'R660 §8: a level version''s number was editable'; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.graph_level_versions SET first_dataset_version_id = v_d2 WHERE id = v_p1;
  EXCEPTION WHEN SQLSTATE 'P0A02' THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'R660 §8: a level version''s first snapshot could be re-pointed'; END IF;
  -- The cascade: deleting the first snapshot forgets it and keeps the version.
  DELETE FROM public.dataset_versions WHERE id = v_c;
  SELECT count(*) INTO v_n FROM public.graph_level_versions
   WHERE project_id = v_proj3 AND level = 'product' AND level_hash = 'p-c' AND first_dataset_version_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R660 §8: deleting a snapshot did not leave its level version standing with no first snapshot';
  END IF;

  -- ══ §9 · doors and attribution ══
  IF has_table_privilege('anon', 'public.graph_level_versions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.graph_level_versions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.graph_level_versions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.graph_level_versions', 'DELETE')
     OR has_table_privilege('service_role', 'public.graph_level_versions', 'INSERT') THEN
    RAISE EXCEPTION 'R660 §9: an API role can write graph_level_versions — only a snapshot may mint a level version';
  END IF;
  -- §4 D265: nor may an API role plant a snapshot, which would mint level versions.
  IF has_table_privilege('anon', 'public.dataset_versions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dataset_versions', 'INSERT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dataset_versions' AND cmd IN ('INSERT', 'ALL')
                 AND roles && ARRAY['anon', 'authenticated']::name[]) THEN
    RAISE EXCEPTION 'R660 §9: an API role can insert a dataset_versions row directly (D265)';
  END IF;
  FOR v_row IN SELECT unnest(ARRAY['public._graph_level_register(uuid)', 'public._graph_level_backfill(uuid)',
                                   'public._graph_level_state(uuid,text,text)']) AS f LOOP
    IF has_function_privilege('anon', v_row.f, 'EXECUTE') OR has_function_privilege('authenticated', v_row.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'R660 §9: % is executable by an API role (D248)', v_row.f;
    END IF;
  END LOOP;

  -- The registration's audit row names the actor who froze the snapshot.
  ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_guard_change;
  DELETE FROM public.audit_logs WHERE plane = 'data' AND target_type = 'graph_level_versions';
  ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_guard_change;
  UPDATE public.materials SET cost = 13 WHERE project_id = v_proj;
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM public.snapshot_dataset(v_proj, 'attributed', v_user);
  SELECT * INTO v_row FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'graph_level_versions' AND action = 'insert'
   ORDER BY created_at DESC LIMIT 1;
  IF v_row IS NULL OR v_row.actor_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'R660 §9: a level version''s audit row does not name the snapshot''s actor (got %)',
      CASE WHEN v_row IS NULL THEN 'no row' ELSE COALESCE(v_row.actor_user_id::text, 'NULL') END;
  END IF;

  RAISE NOTICE 'R660: a version per level — numbered per level, deduplicated against any, a snapshot names its tuple, history backfilled in order';
END
$g660$;
