-- WP 5.3 · THE FOLD CHANGED THE NETWORK DOMAIN AND NOTHING ELSE.
--
-- `20260917000009` rewrites `_build_dataset_snapshot`, and the thing most worth
-- proving about a rewrite of that function is a NEGATIVE: that the `inputs`
-- domain is byte-identical to what it was. If a column were dropped or a key
-- renamed in transcription, every project's `hash_inputs` would move for a
-- reason that has nothing to do with this package — and it would look exactly
-- like the intended change, because the composite moves either way.
--
-- The v2 builder is still present under its own name, so the comparison is
-- available in ONE query. That is the only reason it was kept; §4 D40's class is
-- a second implementation nothing compares against, and this file is the
-- comparison.
--
-- WHAT A STATIC CHECK CANNOT DO HERE. `graphHashCoverage.test.ts` reads the
-- migration text and can see which columns are NAMED. It cannot see what
-- `jsonb_build_object` produces for a real project, which is what a hash is
-- taken over — and the extraction that built the v2 body was mechanical
-- precisely because a text-level slip is what this asserts against.

DO $wp53$
DECLARE
  v_owner   uuid := '00000000-0000-4000-8000-000000053300';
  v_project uuid := '00000000-0000-4000-8000-000000053301';
  v_org     uuid := '00000000-0000-4000-8000-000000053302';
  v_v3      jsonb;
  v_v2      jsonb;
  v_h0      text;
  v_txt     text;
BEGIN
  IF to_regprocedure('public._build_dataset_snapshot_v2(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'WP 5.3 §0 — `_build_dataset_snapshot_v2` is absent, so nothing can compare '
      'the v3 snapshot against the one it replaced. If it was deleted on purpose, '
      'this file goes with it and §16 says why.';
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP53 Org', 'wp53-org');
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'wp53@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
    VALUES (v_owner, 'wp53@example.invalid', 'WP53', 'x', 'WP53 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP53 fold', v_owner, 'WP53P', 'WP53 Org', v_org);

  -- A project with rows in BOTH halves: an empty `inputs` domain would make §1
  -- pass by comparing two empty objects, which is the way this assertion could
  -- be green and worthless.
  INSERT INTO public.suppliers (project_id, supplier_id, name, capacity_per_week, reliability_score)
    VALUES (v_project, 'S1', 'Supplier one', 500, 0.9);
  INSERT INTO public.materials (project_id, material_id, name, cost, holding_cost_pct)
    VALUES (v_project, 'M1', 'Material one', 10, 0.2);
  INSERT INTO public.products (project_id, product_id, name, sell_price, demand_mean)
    VALUES (v_project, 'P1', 'Product one', 99, 12);
  INSERT INTO public.customers (project_id, customer_id, name, priority_weight)
    VALUES (v_project, 'C1', 'Customer one', 1);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    VALUES (v_project, 'WP53P', 'S1', 'M1', 7, 'days', 100, 10);
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, customer_id, product_id, volume, time_unit, unit_price)
    VALUES (v_project, 'WP53P', 'C1', 'P1', 50, 'week', 99);
  INSERT INTO public.tier2_suppliers
    (project_id, plant_name, supplier_id, upstream_supplier_id, material_id, volume)
    VALUES (v_project, 'WP53P', 'S1', 'S0', 'M1', 30);

  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue, country)
    VALUES (v_project, 'WP53P', 'N1', 'Node one', 100, 'DE'),
           (v_project, 'WP53P', 'N2', 'Node two', 50, 'FR');
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue)
    VALUES (v_project, 'WP53P', 'N1', 'N2', 0.5);

  v_v3 := public._build_dataset_snapshot(v_project);
  v_v2 := public._build_dataset_snapshot_v2(v_project);

  -- ── 1 · the `inputs` domain is UNTOUCHED ────────────────────────────────

  IF (v_v3 -> 'inputs') IS DISTINCT FROM (v_v2 -> 'inputs') THEN
    RAISE EXCEPTION
      'WP 5.3 §1 — THE FOLD MOVED THE `inputs` DOMAIN. It must change only '
      '`network`. A difference here means the v2 body was mis-transcribed when it '
      'was copied under its own name, so every project''s `hash_inputs` has moved '
      'for a reason that has nothing to do with the deep-tier topology — and it '
      'looks identical to the intended change, because the composite moves either '
      'way.';
  END IF;

  IF jsonb_typeof(v_v3 -> 'inputs') IS DISTINCT FROM 'object'
     OR v_v3 -> 'inputs' = '{}'::jsonb THEN
    RAISE EXCEPTION
      'WP 5.3 §1 — the `inputs` domain is empty, so §1 compared two empty objects '
      'and proved nothing. The fixture above must put rows in the tier-2 tables.';
  END IF;

  -- ── 2 · the version moved, and the two blocks arrived ───────────────────

  IF (v_v3 ->> 'schema_version') IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'WP 5.3 §2 — the snapshot reports schema_version %, expected 3.',
      v_v3 ->> 'schema_version';
  END IF;
  IF NOT ((v_v3 -> 'network') ? 'deep_tier_nodes')
     OR NOT ((v_v3 -> 'network') ? 'deep_tier_edges') THEN
    RAISE EXCEPTION 'WP 5.3 §2 — the `network` domain has no deep-tier blocks.';
  END IF;

  -- and the three blocks that were already there are still there, unchanged:
  -- `||` merges, so a key collision would silently REPLACE one of them.
  IF (v_v3 -> 'network' -> 'tier2_suppliers') IS DISTINCT FROM (v_v2 -> 'network' -> 'tier2_suppliers')
  OR (v_v3 -> 'network' -> 'tier3_suppliers') IS DISTINCT FROM (v_v2 -> 'network' -> 'tier3_suppliers')
  OR (v_v3 -> 'network' -> 'multi_tier')      IS DISTINCT FROM (v_v2 -> 'network' -> 'multi_tier') THEN
    RAISE EXCEPTION
      'WP 5.3 §2 — a pre-existing `network` block changed. The fold uses `||`, '
      'which REPLACES on a key collision rather than raising, so a block named '
      'twice would vanish without a word.';
  END IF;

  -- ── 3 · NOT ONE COMPUTED COLUMN IS IN THE SNAPSHOT ─────────────────────
  --
  -- The invariant the fold is most likely to break, and a text scan of the
  -- migration cannot settle it: what matters is what `jsonb_build_object`
  -- PRODUCES. Written as a search over the rendered snapshot text so a column
  -- added to the block later is caught by the same assertion.

  FOREACH v_txt IN ARRAY ARRAY[
    'prominence', 'degree_centrality', 'weighted_degree_centrality',
    'eigenvector_centrality', 'betweenness_centrality', 'closeness_centrality',
    'computed_from_hash', 'computed_at', 'network_metrics_updated_at',
    'is_critical_node', 'critical_node_score'
  ] LOOP
    IF position(v_txt in v_v3::text) > 0 THEN
      RAISE EXCEPTION
        'WP 5.3 §3 — the snapshot contains `%`, which is ANALYSIS OUTPUT. Folding '
        'a result into the identity of its own inputs means every run invalidates '
        'itself and no cache can hit twice — the thing `input-hash` (I5) and '
        'WP 4.2''s exit check exist to prevent.', v_txt;
    END IF;
  END LOOP;

  -- ── 4 · and the anchor actually moves with the graph ───────────────────
  --
  -- §1–§3 are about the snapshot's SHAPE. This is the behaviour the package is
  -- for, end to end through the composite.

  v_h0 := public.current_graph_hash(v_project);

  UPDATE public.network_nodes SET revenue = 101 WHERE project_id = v_project AND uid = 'N1';
  IF public.current_graph_hash(v_project) IS NOT DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION 'WP 5.3 §4 — changing a node''s `revenue` did not move the anchor, and the prominence RPC returns it.';
  END IF;
  UPDATE public.network_nodes SET revenue = 100 WHERE project_id = v_project AND uid = 'N1';
  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION 'WP 5.3 §4 — reverting `revenue` did not restore the anchor.';
  END IF;

  -- a node the analyzers never see must not move it
  UPDATE public.network_nodes SET country = 'ES' WHERE project_id = v_project AND uid = 'N1';
  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION
      'WP 5.3 §4 — changing `country` moved the anchor. The fold took more than '
      'the six columns the prominence RPCs return, so every unrelated edit now '
      'costs a full recomputation of every centrality in the project.';
  END IF;

  RAISE NOTICE 'WP 5.3 · 150_topology_in_the_anchor · all sections passed';
END $wp53$;
