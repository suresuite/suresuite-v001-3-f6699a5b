-- WP 8.2 · ONE ETL, and it stops lying about `level` — asserted against a real
-- database, because every claim below is about what the derivation DOES.
--
-- `20260919000008` replaces a 270-line arithmetic body with a demand walk, a
-- depth read from the table that owns it, and a trigger. A static read of that
-- file cannot settle any of the following:
--
--   §1  THE 240. A purchased material three BOM levels under a finished product,
--       at rates 2, 3 and 4, with a weekly demand of 10, carries 240 — and the
--       flat lane's bom row runs `purchased material → FINISHED PRODUCT`, not
--       material → its immediate parent. The RPC wrote four hops each weighted by
--       the PLANT's total outbound volume, which is a number belonging to a
--       different question.
--   §2  DEPTH IS THE BOM'S OWN (§4 D140). The deep lane's `bom_depth` is 1, 2 and
--       3 down that chain, where the deployed writer wrote a literal 2 for all of
--       them — which is why `Project AA - ver3`'s 396-row four-level BOM renders
--       as one flat column. `level` carries the SAME value, because a deprecated
--       alias holds the same value or it is a second authoring.
--   §3  A NULL DEPTH ARRIVES NULL (§4 D134). A supplier of a material that is in
--       no BOM has no depth, and `get_supply_chain_data_multi_tier` no longer
--       answers 0 — which the page's ladder calls a PRODUCT.
--   §4  THE PARENTLESS BOM ROW REACHES THE FINISHED PRODUCT (§4 D129, D141), and
--       no row anywhere holds `''` or `ROOT`. Both defects are LATENT in
--       production — zero such rows in any of the ten projects — so the check is
--       a constructed row and not a count. A count could never have seen either:
--       the edge function dropped the edge one stage before `''` was written, and
--       the RPC replaced the endpoint with a node no CSV contains.
--   §5  A SINGLE-LEVEL PROJECT HAS A DEEP LANE (§4 D130). Three projects have a
--       permanently empty Process page and one of them holds 123 inbound rows.
--   §6  THE LANE IS REBUILT WHEN ITS SOURCES CHANGE (§4 D142), including on a
--       DELETE — the case that moves no timestamp, which is why the freshness
--       signal reported AA-ver3's 48 stale edges as fresh.
--   §7  THE FALLBACK READ NO LONGER RAISES (§4 D147). `get_multi_tier_network_data`
--       projected `smt.data_source_group` from a table that has never had that
--       column. It is `InteractiveNetworkSpace`'s fallback: the path a user
--       reaches only after the primary read has already failed.
--   §8  THE GRANTS AFTER TWO DROPs, and §9 the unit conversion the deployed
--       writer never had (§4 D148), and §10 the actor on a trigger-driven write.
--
-- ── MUTATIONS THAT MUST MAKE THIS FILE FAIL ───────────────────────────────
-- Each performed against this file and verified red (§16 · WP 8.2):
--   * `bom_edges`' `b.level AS depth` → `2 AS depth`, the deployed writer's
--     literal                                                   → §2 red.
--   * `get_supply_chain_data_multi_tier` back to `COALESCE(scdmt.level, 0)`
--                                                               → §3 red.
--   * remove the demand propagation — drop `* e.rate` from the recursive term of
--     `walk`, so a material carries its parent's demand rather than the product of
--     the rates along the path. MEASURED: the 240 becomes 10, not the 20 the
--     package brief predicted — every node inherits the ROOT's demand unchanged,
--     because the multiplication is the only thing that varies down the chain.
--     Stated as measured rather than as predicted                → §1 red.
--   * `COALESCE(NULLIF(btrim(b.higher_level_component_id), ''), d.product_id)`
--     back to `COALESCE(b.higher_level_component_id, 'ROOT')`   → §4 red.
--   * delete the `DO $mk$` block, so the four rebuild triggers are never created
--     (an `AFTER TRUNCATE` mutation does NOT work: a truncate trigger may not have
--     a transition table, so the migration fails before the assertion runs — a
--     mutation that kills the patient proves nothing)            → §6 red.
--   * `rate_to_weekly(...)` back to the raw `o.volume`          → §9 red.
--
-- ── A NOTE FOR WHOEVER WRITES THE NEXT REHEARSAL ──────────────────────────
-- Since this package the four lane sources carry a rebuild trigger, so a fixture
-- that writes `supply_chain_data` BY HAND and then touches `inbound_logistics`,
-- `outbound_logistics`, `bom_single_level` or `bom_multi_level` loses it. That
-- is not a defect on either side — a derived table stops holding what a test
-- typed into it the moment its inputs move, which is the whole of D142 — but it
-- is a trap, and it made four existing rehearsals go red on the first run of
-- this migration. Load the sources first, or assert against the derivation.

DO $wp82$
DECLARE
  v_org     uuid := '00000000-0000-4000-8000-000000082000';
  v_actor   uuid := '00000000-0000-4000-8000-000000082001';
  v_other   uuid := '00000000-0000-4000-8000-000000082002';
  v_multi   uuid := '00000000-0000-4000-8000-000000082010';
  v_single  uuid := '00000000-0000-4000-8000-000000082011';
  v_unit    uuid := '00000000-0000-4000-8000-000000082012';
  v_plant   text := 'WP82P';
  v_uplant  text := 'WP82U';
  v_splant  text := 'WP82S';
  v_email   text := 'wp82@example.invalid';
  v_n       integer;
  v_d       integer;
  v_w       numeric;
  v_r       numeric;
  v_txt     text;
  v_row     record;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP82 Org', 'wp82-org');
  INSERT INTO auth.users (id, email) VALUES (v_actor, v_email), (v_other, 'wp82b@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
    VALUES (v_actor, v_email, 'WP82 Actor', 'x', 'WP82 Org', v_org),
           (v_other, 'wp82b@example.invalid', 'WP82 Other', 'x', 'WP82 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level)
    VALUES (v_multi,  'WP82 multi',  v_actor, v_plant,  'WP82 Org', v_org, 'multi'),
           -- `bom_level = 'single'` is D130's whole subject: the edge function
           -- built the deep lane inside the `multi` branch only, so this project
           -- shape has had a permanently empty Process page and an empty state
           -- that reads "no data uploaded".
           (v_single, 'WP82 single', v_other, v_splant, 'WP82 Org', v_org, 'single'),
           -- A third project rather than a second plant: a dataset's `plant_name`
           -- must match its project's, which is enforced by a trigger.
           (v_unit,   'WP82 units',  v_actor, v_uplant, 'WP82 Org', v_org, 'single');

  PERFORM public.set_current_user_context(v_actor, v_email);

  -- ── the fixture ─────────────────────────────────────────────────────────
  --
  -- WP82P — the chain the brief pins: PROD ← M1(×2) ← M2(×3) ← M3(×4), demand 10.
  -- Only M3 is PURCHASED, so the product-level lane holds exactly one bom row for
  -- that chain and its weight is 10 × 2 × 3 × 4.
  --
  -- MP is deliberately reachable TWO ways — directly under PROD at rate 1 and
  -- under M1 at rate 1 — so §1 also asserts the SUM, and §2 the MIN depth rule.
  --
  -- ORPHAN (NULL parent) and ORPHAN2 (blank parent) are D129/D141's constructed
  -- rows. NOBOM is a purchased material in no BOM at all: D134's NULL depth.
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id, volume, time_unit)
  VALUES (v_multi, v_plant, 'PROD', 'CUST', 10, 'week');

  INSERT INTO public.bom_multi_level
    (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
  VALUES (v_multi, v_plant, 'M1',      1, 'PROD', 2),
         (v_multi, v_plant, 'M2',      2, 'M1',   3),
         (v_multi, v_plant, 'M3',      3, 'M2',   4),
         (v_multi, v_plant, 'MP',      1, 'PROD', 1),
         (v_multi, v_plant, 'MP',      2, 'M1',   1),
         (v_multi, v_plant, 'ORPHAN',  1, NULL,   7),
         (v_multi, v_plant, 'ORPHAN2', 1, '',     1);

  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
  VALUES (v_multi, v_plant, 'SUP1', 'M3',      100, 'week'),
         (v_multi, v_plant, 'SUP2', 'MP',        1, 'week'),
         (v_multi, v_plant, 'SUP3', 'ORPHAN',    1, 'week'),
         (v_multi, v_plant, 'SUP4', 'ORPHAN2',   1, 'week'),
         (v_multi, v_plant, 'SUP5', 'NOBOM',     1, 'week');

  -- WP82U — a SINGLE-level BOM quoted at a MONTHLY rate. 30.4375 per month is
  -- exactly 7 per week, so §9 discriminates the conversion from the raw read with
  -- no rounding at all.
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id, volume, time_unit)
  VALUES (v_unit, v_uplant, 'PRODU', 'CUSTU', 30.4375, 'month');
  INSERT INTO public.bom_single_level
    (project_id, plant_name, product_id, material_id, consumption_rate)
  VALUES (v_unit, v_uplant, 'PRODU', 'MU', 2);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
  VALUES (v_unit, v_uplant, 'SUPU', 'MU', 1, 'week');

  PERFORM public.combine_project_into_supply_chain(v_multi, v_actor, v_email);
  PERFORM public.combine_project_into_supply_chain(v_unit,  v_actor, v_email);

  -- ══ 1 · THE 240 ════════════════════════════════════════════════════════
  --
  -- `weighted` is the product's demand times the product of the consumption
  -- rates along every path between them. The deployed RPC wrote
  -- `total_outbound_volume × that one row's rate` — 10 × 4 = 40 for M3, against a
  -- parent that is M2 and not PROD.
  SELECT weighted, material_consumption_rate INTO v_w, v_r
    FROM public.supply_chain_data
   WHERE project_id = v_multi AND data_source = 'bom'
     AND from_location = 'M3' AND to_location = 'PROD';
  IF v_w IS NULL THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — there is no `M3 → PROD` bom row. The flat lane''s bom edges must '
      'run from a PURCHASED MATERIAL to a FINISHED PRODUCT, with the BOM collapsed; '
      'the RPC wrote material → its immediate parent.';
  END IF;
  IF round(v_w, 6) <> 240 THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — `M3 → PROD` carries %, expected 240 = 10 × 2 × 3 × 4. A demand '
      'that is not propagated down the tree gives 20 (the parent''s demand), and '
      'the plant''s raw outbound volume times one rate gives 40.', v_w;
  END IF;
  -- D136 — the EFFECTIVE rate, where the multi-level path wrote a literal 0.
  IF round(v_r, 6) <> 24 THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — `M3 → PROD` reports a consumption rate of %, expected 24 = '
      '2 × 3 × 4. The edge function wrote a hardcoded 0 on this lane while the '
      'single-level path wrote the real number, so one column meant two things '
      '(§4 D136).', v_r;
  END IF;
  -- The SUM over two paths: MP reaches PROD directly (×1) and through M1 (×2×1).
  SELECT weighted INTO v_w FROM public.supply_chain_data
   WHERE project_id = v_multi AND data_source = 'bom'
     AND from_location = 'MP' AND to_location = 'PROD';
  IF round(v_w, 6) <> 30 THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — `MP → PROD` carries %, expected 30 = 10×1 + 10×2×1. A material '
      'that reaches the same product more than one way sums its paths.', v_w;
  END IF;
  -- M1 and M2 are BUILT, not bought, so the product-level lane holds no row for
  -- them: "BOM collapsed" is what this lane IS. They are in the deep lane (§2).
  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_multi AND data_source = 'bom' AND from_location IN ('M1','M2');
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — the flat lane holds % row(s) for a material the plant BUILDS. '
      'Its bom edges are purchased material → finished product.', v_n;
  END IF;
  -- The inbound weight is the MATERIAL's demand times the supplier's share, not
  -- the plant's outbound volume times the share.
  SELECT weighted INTO v_w FROM public.supply_chain_data
   WHERE project_id = v_multi AND data_source = 'inbound'
     AND from_location = 'SUP1' AND to_location = 'M3';
  IF round(v_w, 6) <> 240 THEN
    RAISE EXCEPTION
      'WP 8.2 §1 — `SUP1 → M3` carries %, expected 240 — M3''s own demand, since '
      'SUP1 is its only supplier. The RPC used the plant''s total outbound volume '
      'here, which is a figure about products standing in for one about a material.', v_w;
  END IF;

  -- ══ 2 · DEPTH IS THE BOM'S OWN, AND `level` IS ITS ALIAS (D140) ════════
  FOR v_row IN
    SELECT * FROM (VALUES ('M1','PROD',1), ('M2','M1',2), ('M3','M2',3)) AS t(child, parent, depth)
  LOOP
    SELECT bom_depth, level INTO v_d, v_n
      FROM public.supply_chain_data_multi_tier
     WHERE project_id = v_multi AND data_source = 'bom'
       AND from_location = v_row.child AND to_location = v_row.parent;
    IF v_d IS DISTINCT FROM v_row.depth THEN
      RAISE EXCEPTION
        'WP 8.2 §2 — `% → %` sits at bom_depth %, expected %. The deployed RPC '
        'wrote a LITERAL 2 for every bom row and never read `bom_multi_level.level` '
        '(§4 D140), which is why a four-level BOM renders as one flat column and '
        'the page labels 260 materials and 66 products `material level 2` at once.',
        v_row.child, v_row.parent, v_d, v_row.depth;
    END IF;
    IF v_n IS DISTINCT FROM v_d THEN
      RAISE EXCEPTION
        'WP 8.2 §2 — `% → %` has level=% and bom_depth=%. `level` is a DEPRECATED '
        'ALIAS for one release: an alias carries the same value or it is a second '
        'authoring wearing a deprecation notice.', v_row.child, v_row.parent, v_n, v_d;
    END IF;
  END LOOP;
  -- A finished product is the root of its own BOM, so an outbound edge is depth 0.
  SELECT bom_depth INTO v_d FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_multi AND data_source = 'outbound' AND from_location = 'PROD';
  IF v_d IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 8.2 §2 — the outbound edge sits at bom_depth %, expected 0.', v_d;
  END IF;
  -- A supplier sits one step upstream of the material it feeds. The RPC wrote
  -- `GREATEST(1, COALESCE(max_level, 0) + 1)`, whose floor and substitution put
  -- two suppliers from one upload four levels apart.
  SELECT bom_depth INTO v_d FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_multi AND data_source = 'inbound' AND from_location = 'SUP1';
  IF v_d IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION
      'WP 8.2 §2 — `SUP1` feeds M3 at depth 3 and sits at bom_depth %, expected 4.', v_d;
  END IF;
  -- MIN, not MAX: MP is at level 1 and at level 2, and the shallowest says how
  -- close to a finished product it sits. That is `node_bom_depth`'s rule and the
  -- lane reads it rather than restating it.
  IF public.node_bom_depth(v_multi, 'MP') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 8.2 §2 — node_bom_depth(MP) is %, expected 1 (MIN over its two depths).',
      public.node_bom_depth(v_multi, 'MP');
  END IF;

  -- ══ 3 · A NULL DEPTH ARRIVES NULL (D134) ═══════════════════════════════
  --
  -- NOBOM is purchased and appears in no BOM, so its supplier has no depth. The
  -- read RPC used to `COALESCE(scdmt.level, 0)` in both of its branches, and the
  -- page's ladder calls 0 a PRODUCT — so an unknown was reported as a confident
  -- wrong type, and the `unknown` case the page already has could never be reached
  -- because the RPC answered the question before the page was asked it.
  SELECT bom_depth INTO v_d FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_multi AND data_source = 'inbound' AND from_location = 'SUP5';
  IF v_d IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 8.2 §3 — `SUP5` feeds a material in no BOM and the lane stored depth %, '
      'expected NULL. NULL is UNKNOWN and 0 is a claim.', v_d;
  END IF;
  SELECT level, bom_depth INTO v_n, v_d
    FROM public.get_supply_chain_data_multi_tier(v_multi, v_actor, v_email)
   WHERE data_source = 'inbound' AND from_location = 'SUP5';
  IF v_n IS NOT NULL OR v_d IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 8.2 §3 — the read path returned level=% / bom_depth=% for an unknown '
      'depth, expected NULL for both. `COALESCE(scdmt.level, 0)` is §4 D134 and it '
      'served the ladder a PRODUCT.', v_n, v_d;
  END IF;
  -- And the read still returns every row: dropping the substitution must not drop
  -- the rows it was substituting for.
  SELECT count(*) INTO v_n FROM public.get_supply_chain_data_multi_tier(v_multi, v_actor, v_email);
  IF v_n <> (SELECT count(*) FROM public.supply_chain_data_multi_tier WHERE project_id = v_multi) THEN
    RAISE EXCEPTION 'WP 8.2 §3 — the read path returned % of % lane rows.',
      v_n, (SELECT count(*) FROM public.supply_chain_data_multi_tier WHERE project_id = v_multi);
  END IF;

  -- ══ 4 · THE PARENTLESS BOM ROW REACHES THE FINISHED PRODUCT (D129, D141) ══
  --
  -- LATENT IN PRODUCTION — zero parentless `bom_multi_level` rows in any of the
  -- ten projects (§15 run 35433474185) — so this is a constructed row and not a
  -- count, and a count is exactly what could not have seen either defect: the
  -- edge function's demand walk looked up `plant::<blank>`, found no parent and
  -- skipped the row in the EMIT loop, so the `|| ''` a reader sees first never
  -- ran; the RPC wrote `COALESCE(…, 'ROOT')` into BOTH `to_location` and
  -- `path_root`, so the finished product was severed from its own BOM and a node
  -- no CSV contains stood in its place — with every centrality computed over it.
  FOR v_row IN SELECT unnest(ARRAY['ORPHAN','ORPHAN2']) AS child LOOP
    SELECT count(*) INTO v_n FROM public.supply_chain_data_multi_tier
     WHERE project_id = v_multi AND data_source = 'bom'
       AND from_location = v_row.child AND to_location = 'PROD';
    IF v_n <> 1 THEN
      RAISE EXCEPTION
        'WP 8.2 §4 — `%` has no parent in `bom_multi_level` and produced % edge(s) '
        'to the finished product, expected 1. Its parent IS the finished product — '
        'the column''s own sidecar says so.', v_row.child, v_n;
    END IF;
  END LOOP;
  -- 10 × 7: the parentless row's rate against the product's demand.
  SELECT weighted INTO v_w FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_multi AND data_source = 'bom'
     AND from_location = 'ORPHAN' AND to_location = 'PROD';
  IF round(v_w, 6) <> 70 THEN
    RAISE EXCEPTION 'WP 8.2 §4 — `ORPHAN → PROD` carries %, expected 70 = 10 × 7.', v_w;
  END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT from_location AS n FROM public.supply_chain_data            WHERE project_id = v_multi
    UNION ALL SELECT to_location            FROM public.supply_chain_data            WHERE project_id = v_multi
    UNION ALL SELECT from_location          FROM public.supply_chain_data_multi_tier WHERE project_id = v_multi
    UNION ALL SELECT to_location            FROM public.supply_chain_data_multi_tier WHERE project_id = v_multi
    UNION ALL SELECT path_root              FROM public.supply_chain_data_multi_tier WHERE project_id = v_multi
  ) e WHERE e.n = 'ROOT' OR COALESCE(btrim(e.n), '') = '';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.2 §4 — % endpoint(s) are `ROOT` or blank. Never '''', never ''ROOT'': '
      'both are a node on screen sourced to nothing, which is §5 T1 in one string.', v_n;
  END IF;

  -- ══ 5 · A SINGLE-LEVEL PROJECT HAS A DEEP LANE (D130) ══════════════════
  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id, volume, time_unit)
  VALUES (v_single, v_splant, 'PRODS', 'CUSTS', 5, 'week');
  INSERT INTO public.bom_single_level
    (project_id, plant_name, product_id, material_id, consumption_rate)
  VALUES (v_single, v_splant, 'PRODS', 'MS', 3);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
  VALUES (v_single, v_splant, 'SUPS', 'MS', 2, 'week');

  PERFORM public.set_current_user_context(v_other, 'wp82b@example.invalid');
  PERFORM public.combine_project_into_supply_chain(v_single, v_other, 'wp82b@example.invalid');

  SELECT count(*) INTO v_n FROM public.supply_chain_data_multi_tier WHERE project_id = v_single;
  IF v_n < 3 THEN
    RAISE EXCEPTION
      'WP 8.2 §5 — a `bom_level = single` project produced % deep-tier row(s). The '
      'edge function built all three `*TierInserts` inside the `multi` branch only, '
      'so this project shape has had a permanently empty Process page rendering an '
      'empty state that reads "no data uploaded" (§4 D130).', v_n;
  END IF;
  SELECT bom_depth INTO v_d FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_single AND data_source = 'bom' AND from_location = 'MS';
  IF v_d IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'WP 8.2 §5 — `MS → PRODS` sits at bom_depth %, expected 1. A single-level BOM '
      'is a real two-level tree and that is what "single level" NAMES.', v_d;
  END IF;
  SELECT bom_depth INTO v_d FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_single AND data_source = 'inbound' AND from_location = 'SUPS';
  IF v_d IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'WP 8.2 §5 — `SUPS` sits at bom_depth %, expected 2. `node_bom_depth` reads '
      '`bom_single_level` since WP 8.2; before it, every node of a single-level '
      'project had NULL depth and this lane had nothing to be built from.', v_d;
  END IF;
  SELECT weighted INTO v_w FROM public.supply_chain_data
   WHERE project_id = v_single AND data_source = 'bom' AND from_location = 'MS';
  IF round(v_w, 6) <> 15 THEN
    RAISE EXCEPTION 'WP 8.2 §5 — `MS → PRODS` carries %, expected 15 = 5 × 3.', v_w;
  END IF;

  -- ══ 6 · THE LANE IS REBUILT WHEN ITS SOURCES CHANGE (D142) ═════════════
  --
  -- NO COMBINE IS CALLED BELOW. That is the assertion: §15 found 2 of 10 projects
  -- holding an inbound lane that does not match `inbound_logistics`, worst on the
  -- project a user reported — 369 lane rows against 321 source rows — because
  -- neither writer is a trigger and a CSV edited after the last combine changes
  -- the source and leaves the graph as it was.
  --
  -- A DELETE, deliberately. An INSERT would also pass a timestamp comparison; a
  -- DELETE is the case that defeats one, because `max(updated_at)` does not move
  -- when rows LEAVE a table. AA-ver3's lane was written 0.17 s AFTER its
  -- `inbound_logistics` was last touched, so every freshness check in the product
  -- called 48 stale edges fresh (§4 D12, D142).
  DELETE FROM public.inbound_logistics
   WHERE project_id = v_single AND supplier_id = 'SUPS';

  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_single AND from_location = 'SUPS';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.2 §6 — the source row is deleted and % lane edge(s) for `SUPS` survive. '
      'Nothing rebuilt the lane, and no timestamp can tell you so.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_single AND from_location = 'SUPS';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 8.2 §6 — % deep-tier edge(s) for `SUPS` survive its source row.', v_n;
  END IF;
  -- The rest of the graph is still there: a rebuild is a rebuild, not a wipe.
  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_single AND data_source = 'outbound';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 8.2 §6 — the rebuild removed the outbound lane along with the deleted supplier.';
  END IF;
  -- THE FLAT BOM ROW FOR `MS` IS GONE, AND THAT IS THE RULE RATHER THAN A LOSS.
  -- The product-level lane's bom edges run from a PURCHASED material, so deleting
  -- the last supplier of `MS` stops it being one and it leaves that lane — the
  -- same rule as "a purchased material that reaches no finished product emits no
  -- row", read from the other end. The first draft of this section asserted the
  -- opposite and was wrong about the lane's own definition.
  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_single AND data_source = 'bom' AND from_location = 'MS';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.2 §6 — `MS` has no supplier left and still holds % product-level bom '
      'row(s). The flat lane''s bom edges run from a PURCHASED material.', v_n;
  END IF;
  -- The DEEP lane keeps it: that lane is the real tree, and a sub-assembly or an
  -- unbought material is still part of the structure the Process page draws.
  SELECT count(*) INTO v_n FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_single AND data_source = 'bom' AND from_location = 'MS';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 8.2 §6 — the deep lane holds % `MS → PRODS` edge(s), expected 1. The BOM '
      'is still the BOM when nobody supplies one of its materials.', v_n;
  END IF;
  -- An INSERT is watched too — a CSV row ADDED after the last combine.
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
  VALUES (v_single, v_splant, 'SUPS2', 'MS', 4, 'week');
  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_single AND from_location = 'SUPS2';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 8.2 §6 — a new source row produced % lane edge(s), expected 1.', v_n;
  END IF;

  -- ══ 7 · THE FALLBACK READ NO LONGER RAISES (D147) ══════════════════════
  --
  -- `get_multi_tier_network_data` projected `smt.data_source_group` and
  -- `supply_chain_data_multi_tier` has never had that column, so the function
  -- raised `column smt.data_source_group does not exist` on EVERY call since
  -- 2025-09-09. plpgsql plans a `RETURN QUERY` at first execution, which is why
  -- nothing static could see it — D145's class one column further in.
  PERFORM public.set_current_user_context(v_actor, v_email);
  SELECT count(*) INTO v_n
    FROM public.get_multi_tier_network_data(v_multi, v_actor, v_email);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 8.2 §7 — the fallback read returned % rows for a populated lane.', v_n;
  END IF;
  -- And D133's column is gone from the table as well as from the contract.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'supply_chain_data'
     AND column_name = 'data_source_group';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 8.2 §7 — `supply_chain_data.data_source_group` still exists. It was '
      'written on 0 of 5 445 rows while its sidecar told readers the network pages '
      'filter on it (§4 D133), and D133 allows two outcomes: write it, or delete '
      'the column and the claim in the same commit.';
  END IF;

  -- ══ 8 · THE EXECUTE PRIVILEGES AFTER TWO DROPs ═════════════════════════
  --
  -- Both read functions changed their `RETURNS TABLE`, which `CREATE OR REPLACE`
  -- cannot do, so both are a DROP and a CREATE — and a DROP takes a function's
  -- grants with it. `rehearsal/210` §2 checks EXPLICIT `proacl` grantees because
  -- `has_function_privilege` cannot fail while PUBLIC keeps EXECUTE. THIS CHECK IS
  -- THE INVERSE, and deliberately: neither of these two has ever carried an
  -- explicit grant — no migration that names them contains a GRANT — so their
  -- state before the DROP is a NULL `proacl` and the default PUBLIC EXECUTE.
  -- Asserting explicit grantees here would fail for the right reason and the wrong
  -- one at once. What must hold is that the state is UNCHANGED.
  FOR v_row IN
    SELECT unnest(ARRAY['public.get_supply_chain_data_multi_tier(uuid,uuid,text,integer,integer)',
                        'public.get_multi_tier_network_data(uuid,uuid,text)']) AS sig
  LOOP
    IF (SELECT proacl FROM pg_proc WHERE oid = v_row.sig::regprocedure) IS NOT NULL THEN
      RAISE EXCEPTION
        'WP 8.2 §8 — % now carries an explicit ACL where it carried none. If this '
        'is deliberate the check is wrong; if it is not, a grant has been invented.',
        v_row.sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_row.sig::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('anon', v_row.sig::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_row.sig::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'WP 8.2 §8 — a role lost EXECUTE on % across the DROP and CREATE.', v_row.sig;
    END IF;
  END LOOP;

  -- ══ 9 · THE UNIT CONVERSION THE DEPLOYED WRITER NEVER HAD (D148) ═══════
  --
  -- D2 was closed in `combine-project` by WP 0.2 and never in the RPC: all eight
  -- of its `volume` reads were RAW, so a plant mixing monthly and weekly rows had
  -- its sourcing shares computed across incompatible units — and a share decides
  -- which supplier the platform calls primary.
  --
  -- 30.4375 per MONTH is exactly 7 per week, and MU consumes 2 of them, so the
  -- collapsed bom edge carries 14. Read raw it would carry 60.875.
  SELECT weighted INTO v_w FROM public.supply_chain_data
   WHERE project_id = v_unit AND data_source = 'bom' AND from_location = 'MU';
  IF round(v_w, 6) <> 14 THEN
    RAISE EXCEPTION
      'WP 8.2 §9 — `MU → PRODU` carries %, expected 14 = (30.4375 / month → 7 / week) '
      '× 2. A raw read gives 60.875. `rate_to_weekly` is the one unit rule (I3) and '
      'the deployed RPC never called it (§4 D148).', v_w;
  END IF;

  -- ══ 10 · THE TRIGGER-DRIVEN WRITE NAMES ITS ACTOR (G4) ═════════════════
  --
  -- WITH THE GUC POISONED FIRST, which is what §16 · WP 4.1 · E says a first draft
  -- gets wrong: a check that passes because the session already held the right
  -- value proves nothing about the writer. The rebuild runs inside somebody else's
  -- statement, so when that statement named nobody the derivation falls back to
  -- the project's modeler — a tier-3 write must name somebody, and `unknown` is
  -- not an option `audit-actor` allows.
  DELETE FROM public.audit_logs WHERE plane = 'data';
  PERFORM set_config('app.current_user_id', '', true);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
  VALUES (v_single, v_splant, 'SUPS3', 'MS', 1, 'week');

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'supply_chain_data'
     AND actor_user_id = v_other
     AND COALESCE((after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION
      'WP 8.2 §10 — the trigger-driven rebuild wrote no attributed audit row on '
      '`supply_chain_data` naming % (the project''s modeler) with the session actor '
      'blanked. A derivation names WHO and decides nothing (§4 D66).', v_other;
  END IF;

  RAISE NOTICE
    'WP 8.2 · 310 — one ETL: the 240, the BOM''s own depth, a NULL that stays NULL, '
    'the parentless row on its finished product, a single-level deep lane, the '
    'rebuild on a DELETE, the fallback that no longer raises, the grants, the unit '
    'conversion and the actor — 10 sections.';
END
$wp82$;
