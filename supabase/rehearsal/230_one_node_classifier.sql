-- WP 8.1 · one classifier, two honest columns — asserted against a real database.
--
-- `20260919000001` makes five claims a static read of the migration cannot settle,
-- because every one of them is about what the database DOES:
--
--   §1  a node holding several lane roles resolves to exactly ONE echelon, and the
--       same one every time — the property the eight render-time classifiers do not
--       have (§4 D112). `ProductLevelNetwork`'s answer for such a node depends on
--       which row it read last, and no amount of reading the function says whether
--       the SQL rule is deterministic; running it twice over a shuffled table does.
--   §2  a node that is BOTH a BOM target and a BOM source is `subassembly` — the
--       value the old classifier had no word for, so it answered `product` for the
--       65 such nodes §15 found on one project (run 35433474185).
--   §3  the deep-tier lane is in the projection (§4 D117): a node that exists ONLY
--       in `supply_chain_data_multi_tier` gets a `node_list` row and an echelon.
--   §4  `bom_depth` and `supply_tier` are INDEPENDENT and independently NULL — the
--       whole point of splitting `level` in two. A material has a depth and no
--       tier; a tier-2 supplier has a tier and no depth.
--   §5  the refresh is idempotent, and the lane trigger actually FIRES — which is
--       §4 D128, a trigger that read NEW in a statement-level context and therefore
--       did nothing at all between 2025-08-29 and this package.
--
-- MUTATIONS THAT MUST MAKE THIS FILE FAIL, each verified by making it:
--   * remove the `is_bom_source AND is_bom_target` branch from
--     `classify_node_echelon` → §2 red (a subassembly reports `product`).
--   * revert the CTE in `node_list_discover` to `supply_chain_data` only → §3 red.
--   * make `node_supply_tier` return 0 instead of NULL for a non-supplier → §4 red,
--     which is §4 D119's substitution caught in a second column.
--   * re-attach `auto_refresh_node_list_on_scd_change` → §5 red (no refresh). NOTE:
--     performing this mutation ALSO found a defect in the migration itself — the
--     three `supply_chain_data` triggers had no `DROP IF EXISTS`, so the file could
--     not be applied twice. Fixed in `20260919000001` section 7, and recorded here
--     because it is the mutation, not the assertion, that earned it.
--   * call `rebuild_node_list` from the refresh instead of `node_list_discover`
--     → `rehearsal/090` and `/110` go red with `forbidden`, NOT this file: 230's
--     actor IS the project's modeler, so the authorization check it would hit
--     passes. Stated precisely rather than claimed here, because a mutation this
--     file does not catch is one the reader must know is caught elsewhere.

DO $wp81$
DECLARE
  v_org     uuid := '00000000-0000-4000-8000-000000081000';
  v_actor   uuid := '00000000-0000-4000-8000-000000081001';
  v_project uuid := '00000000-0000-4000-8000-000000081003';
  v_plant   text := 'WP81P';
  v_e       text;
  v_e2      text;
  v_n       integer;
  v_depth   integer;
  v_tier    integer;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP81 Org', 'wp81-org');
  INSERT INTO auth.users (id, email) VALUES (v_actor, 'wp81@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
    VALUES (v_actor, 'wp81@example.invalid', 'WP81 Actor', 'x', 'WP81 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level)
    VALUES (v_project, 'WP81', v_actor, v_plant, 'WP81 Org', v_org, 'multi');

  PERFORM public.set_current_user_context(v_actor, 'wp81@example.invalid');

  -- The graph. `SUBASM` is deliberately BOTH a bom target and a bom source: the
  -- plant builds it from RAW and consumes it into PROD. `DUAL` is deliberately
  -- both an inbound source (a supplier) and a bom source (a material) — the exact
  -- node §4 D112 says four classifiers answer four ways.
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location, weighted)
  VALUES
    (v_project, v_plant, 'outbound', 'PROD',   'CUST',   10),
    (v_project, v_plant, 'bom',      'SUBASM', 'PROD',    5),
    (v_project, v_plant, 'bom',      'RAW',    'SUBASM',  3),
    (v_project, v_plant, 'bom',      'DUAL',   'PROD',    2),
    (v_project, v_plant, 'inbound',  'SUP1',   'RAW',     7),
    (v_project, v_plant, 'inbound',  'DUAL',   'RAW',     1);

  -- The BOM, which is where `bom_depth` comes from — NOT from the lane's `level`,
  -- which two live writers disagree about (§4 D125).
  INSERT INTO public.bom_multi_level
    (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
  VALUES
    (v_project, v_plant, 'SUBASM', 1, 'PROD',   1),
    (v_project, v_plant, 'RAW',    2, 'SUBASM', 3),
    (v_project, v_plant, 'DUAL',   1, 'PROD',   2);

  -- The upstream tiers, which is where `supply_tier` comes from.
  INSERT INTO public.tier2_suppliers
    (project_id, plant_name, supplier_id, upstream_supplier_id, material_id)
  VALUES (v_project, v_plant, 'SUP1', 'SUP2', 'RAW');

  PERFORM public.refresh_node_list_for_project(v_project, v_actor);

  -- ── 1 · one node, one echelon, and the SAME one twice ───────────────────
  --
  -- `DUAL` is an inbound source AND a bom source. The old SQL rule answered
  -- `material` by priority; `ProcessLevelNetwork` answers `supplier` through its
  -- `inbound` override; `ProductLevelNetwork` answers A or B depending on row
  -- order; `MapView` drops it. This asserts the ONE property all four lack:
  -- whatever the answer is, it does not depend on anything but the data.
  SELECT public.classify_node_echelon(v_project, 'DUAL') INTO v_e;
  SELECT public.classify_node_echelon(v_project, 'DUAL') INTO v_e2;
  IF v_e IS NULL OR v_e <> v_e2 THEN
    RAISE EXCEPTION 'WP 8.1 §1 — `DUAL` resolved to % then % : the rule is not deterministic.', v_e, v_e2;
  END IF;
  IF v_e NOT IN ('customer','product','subassembly','material','supplier','plant','unknown') THEN
    RAISE EXCEPTION 'WP 8.1 §1 — `DUAL` resolved to %, which the CHECK does not allow.', v_e;
  END IF;
  -- And exactly one `node_list` row carries it, because identity is (project, node).
  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_project AND node_id = 'DUAL';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 8.1 §1 — `DUAL` has % node_list rows, expected exactly 1.', v_n;
  END IF;

  -- ── 2 · the value the old vocabulary had no word for ────────────────────
  SELECT echelon INTO v_e FROM public.node_list
   WHERE project_id = v_project AND node_id = 'SUBASM';
  IF v_e IS DISTINCT FROM 'subassembly' THEN
    RAISE EXCEPTION
      'WP 8.1 §2 — `SUBASM` is both a BOM target and a BOM source and reports "%", '
      'not "subassembly". That is the 65 nodes §15 found being called products again.', v_e;
  END IF;
  -- The legacy column is DERIVED from the same rule and maps it to `material`, so
  -- `MapView` does not draw a thing the plant consumes on the customer side.
  SELECT node_type INTO v_e FROM public.node_list
   WHERE project_id = v_project AND node_id = 'SUBASM';
  IF v_e IS DISTINCT FROM 'material' THEN
    RAISE EXCEPTION 'WP 8.1 §2 — `SUBASM`.node_type is "%", expected "material".', v_e;
  END IF;
  IF public.classify_node_type(v_project, 'SUBASM') IS DISTINCT FROM 'material' THEN
    RAISE EXCEPTION 'WP 8.1 §2 — `classify_node_type` disagrees with the column it fills.';
  END IF;

  -- ── 3 · the deep-tier lane is inside the projection (D117) ──────────────
  --
  -- `DEEPONLY` exists in `supply_chain_data_multi_tier` and NOWHERE else. Before
  -- this package it had no `node_list` row, so no page could read a type for it —
  -- 104 such nodes in production.
  INSERT INTO public.supply_chain_data_multi_tier
    (project_id, plant_name, data_source, from_location, to_location, level, weighted)
  VALUES (v_project, v_plant, 'inbound', 'DEEPONLY', 'RAW', 5, 1);

  -- No explicit refresh call: §5's whole point is that the lane trigger fires.
  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_project AND node_id = 'DEEPONLY';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 8.1 §3 — `DEEPONLY` exists only in the multi-tier lane and has % node_list '
      'row(s), expected 1. Either the discovery CTE reads one table again, or the '
      'lane trigger did not fire (D117 / D128).', v_n;
  END IF;
  SELECT echelon INTO v_e FROM public.node_list
   WHERE project_id = v_project AND node_id = 'DEEPONLY';
  IF v_e IS DISTINCT FROM 'supplier' THEN
    RAISE EXCEPTION
      'WP 8.1 §3 — `DEEPONLY` is an inbound source in the deep-tier lane and reports '
      '"%", expected "supplier". The classifier is not reading both edge tables.', v_e;
  END IF;

  -- ── 4 · depth and tier are two measurements, independently NULL ─────────
  --
  -- This is the assertion the whole split exists for. If either column falls back
  -- to 0 rather than staying NULL, §4 D119 has been rebuilt in a new column: an
  -- unknown answered with a confident number.
  SELECT bom_depth, supply_tier INTO v_depth, v_tier
    FROM public.node_list WHERE project_id = v_project AND node_id = 'RAW';
  IF v_depth IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 8.1 §4 — `RAW` sits at BOM level 2 and reports bom_depth %.', v_depth;
  END IF;
  IF v_tier IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 8.1 §4 — `RAW` is a material, not an upstream supplier, and reports '
      'supply_tier % instead of NULL. An unknown answered with a number is D119.', v_tier;
  END IF;

  -- `SUP2` is asserted through the FUNCTION and not through `node_list`, and the
  -- reason is a scope limit this file states rather than hides: `node_list` is the
  -- projection of the two EDGE tables, and `SUP2` appears in neither — it exists
  -- only as a `tier2_suppliers.upstream_supplier_id`. So it is not a node of this
  -- graph today, `supply_tier` resolves to 0, 1 or NULL for every node that IS one,
  -- and 2/3 are reachable only for an upstream supplier that also appears in an
  -- edge table. Folding the deep-tier FIRM graph in is a different node universe
  -- (`network_nodes.uid` against material ids is §4 D122) and is not this package's.
  SELECT public.node_supply_tier(v_project, 'SUP2') INTO v_tier;
  IF v_tier IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'WP 8.1 §4 — `node_supply_tier` for `SUP2`, a `tier2_suppliers`'
      '.upstream_supplier_id, is %, expected 2.', v_tier;
  END IF;
  IF public.node_bom_depth(v_project, 'SUP2') IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 8.1 §4 — `SUP2` is in no BOM and `node_bom_depth` returns % instead of '
      'NULL. That is the conflation the two columns exist to end.',
      public.node_bom_depth(v_project, 'SUP2');
  END IF;
  -- And it is NOT in the projection, which is the scope limit asserted rather than
  -- assumed: a later package that folds the firm graph in makes this count 1 and
  -- must change this line deliberately.
  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_project AND node_id = 'SUP2';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.1 §4 — `SUP2` has % node_list row(s). It appears in neither edge table, '
      'so something widened the projection beyond the graph it projects.', v_n;
  END IF;

  -- `SUP1` supplies the plant directly AND is a `tier2_suppliers.supplier_id`, so
  -- it sits at tier 1 by both routes; `MIN` is the declared rule and this pins it.
  SELECT supply_tier INTO v_tier FROM public.node_list
   WHERE project_id = v_project AND node_id = 'SUP1';
  IF v_tier IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 8.1 §4 — `SUP1` reports supply_tier %, expected 1.', v_tier;
  END IF;

  -- `PROD` is the top of the tree: a parent at BOM level 1, so depth 0.
  SELECT bom_depth INTO v_depth FROM public.node_list
   WHERE project_id = v_project AND node_id = 'PROD';
  IF v_depth IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'WP 8.1 §4 — `PROD` is the parent of a level-1 BOM row and reports bom_depth %, '
      'expected 0.', v_depth;
  END IF;

  -- ── 5 · idempotent, and the trigger that never fired now does (D128) ────
  --
  -- The refresh runs a second time and nothing moves. Then a lane write with NO
  -- explicit refresh call must still reach `node_list` — which is the half that
  -- was false for thirteen months, because a statement-level trigger reading
  -- NEW.project_id computes NULL and returns.
  PERFORM public.refresh_node_list_for_project(v_project, v_actor);
  SELECT count(*) INTO v_n FROM public.node_list WHERE project_id = v_project;
  IF v_n <> 7 THEN
    RAISE EXCEPTION
      'WP 8.1 §5 — after a second refresh the project has % node_list rows, expected 7 '
      '(PROD, CUST, SUBASM, RAW, DUAL, SUP1, DEEPONLY — not SUP2, see §4). The refresh '
      'is not idempotent.', v_n;
  END IF;

  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location, weighted)
  VALUES (v_project, v_plant, 'inbound', 'LATE', 'RAW', 1);

  SELECT count(*) INTO v_n FROM public.node_list
   WHERE project_id = v_project AND node_id = 'LATE' AND echelon = 'supplier';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 8.1 §5 — a `supply_chain_data` INSERT with no explicit refresh left `LATE` '
      'out of the typed projection. The lane trigger is dead again — D128.';
  END IF;

  -- And `SUP1`'s tier survives a refresh it was not the subject of.
  SELECT supply_tier INTO v_tier FROM public.node_list
   WHERE project_id = v_project AND node_id = 'SUP1';
  IF v_tier IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 8.1 §5 — `SUP1`.supply_tier became % after a later refresh.', v_tier;
  END IF;

  RAISE NOTICE
    'WP 8.1 · 230 — one classifier, deterministic; `subassembly` exists; the deep-tier '
    'lane is inside the projection; depth and tier are independently NULL; and the lane '
    'trigger fires for the first time since 2025-08-29 (D128).';
END
$wp81$;

-- ── 6 · WP 8.3 · the READ PATH carries the columns WP 8.1 authored ─────────
--
-- `get_node_list`'s fixed `RETURNS TABLE` lists seventeen columns by name and
-- `CREATE OR REPLACE` cannot change a return type, so the three columns WP 8.1
-- added were invisible to every page in the product. `get_graph_nodes` is the
-- additive read path. This section fails if it stops returning an echelon, or if
-- its ordering stops putting the chain in order.
--
-- MUTATIONS THAT MUST MAKE IT FAIL:
--   * drop `echelon` from `get_graph_nodes`'s RETURNS TABLE → the column check red.
--   * reverse the ORDER BY's CASE → the sequence check red.
DO $wp83$
DECLARE
  v_org     uuid := '00000000-0000-4000-8000-000000081000';
  v_actor   uuid := '00000000-0000-4000-8000-000000081001';
  v_project uuid := '00000000-0000-4000-8000-000000081003';
  v_seq     text;
  v_n       integer;
BEGIN
  -- The fixture §1–§5 built is still there; this reads it back through the RPC.
  SELECT count(*) INTO v_n
    FROM public.get_graph_nodes(v_project, v_actor, 'wp81@example.invalid')
   WHERE echelon IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.3 §6 — % node(s) come back from `get_graph_nodes` with a NULL echelon. '
      'Every row was backfilled by `20260919000001`; a NULL here means the read path '
      'is not reading the column the migration filled.', v_n;
  END IF;

  -- The chain comes back in chain order, so a page that renders in receive order
  -- renders the supply chain the right way round.
  SELECT string_agg(DISTINCT echelon, '' ORDER BY echelon) INTO v_seq
    FROM public.get_graph_nodes(v_project, v_actor, 'wp81@example.invalid');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'WP 8.3 §6 — `get_graph_nodes` returned no rows for a project with 7 nodes.';
  END IF;

  -- `supplier` must arrive before `customer`, which is the claim the ORDER BY makes.
  SELECT string_agg(echelon, '>' ORDER BY first_seen) INTO v_seq FROM (
    SELECT echelon, MIN(rn) AS first_seen FROM (
      SELECT echelon, row_number() OVER () AS rn
        FROM public.get_graph_nodes(v_project, v_actor, 'wp81@example.invalid')
    ) numbered GROUP BY echelon
  ) t;
  IF position('supplier' in v_seq) = 0 OR position('customer' in v_seq) = 0 THEN
    RAISE EXCEPTION 'WP 8.3 §6 — the fixture should contain both a supplier and a customer; got %', v_seq;
  END IF;
  IF position('supplier' in v_seq) > position('customer' in v_seq) THEN
    RAISE EXCEPTION
      'WP 8.3 §6 — `get_graph_nodes` returned customers before suppliers (%). The '
      'ordering rule lives in the RPC so four components do not each re-derive it; '
      'if it is wrong here it is wrong everywhere.', v_seq;
  END IF;

  -- And `bom_depth` survives the trip, which is the column the reported project's
  -- flattened `level` cannot provide (§4 D125).
  SELECT bom_depth INTO v_n
    FROM public.get_graph_nodes(v_project, v_actor, 'wp81@example.invalid')
   WHERE node_id = 'RAW';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 8.3 §6 — `RAW` comes back with bom_depth %, expected 2.', v_n;
  END IF;

  RAISE NOTICE
    'WP 8.3 · 230 §6 — the read path carries `echelon`, `bom_depth` and `supply_tier`, '
    'and returns the chain in chain order.';
END
$wp83$;
