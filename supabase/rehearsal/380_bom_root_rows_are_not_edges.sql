-- §4 D171 · A BOM ROOT ROW THAT NAMES A PRODUCT IS NOT AN EDGE — asserted
-- against a real database, because the defect was found by running one.
--
-- `20260924000001` adds one predicate to the multi-level half of both
-- `bom_edges` CTEs in `rebuild_supply_chain_lanes`: a parentless row is
-- skipped when its child is itself a product. Before it, a file carrying the
-- finished products as level-0 rows (`FP1,0,,1` — the shape ERP exports
-- produce, admitted by the ingest contract with zero findings) had each such
-- row joined to EVERY shipping product: self-loops, fabricated
-- product→product edges, a duplicate of every real lane per fabricated path
-- root — and `classify_node_echelon` therefore typed every finished product
-- `subassembly` on every page. The engine's flatten drops blank-parent rows
-- outright, so the lanes and the simulation disagreed about one file.
--
--   §1  NOTHING IS FABRICATED. With both products' root rows present, the
--       deep lane holds no self-loop, no bom edge between two products, and
--       no bom edge FROM a product at all — and each real edge exactly once
--       per (from, to, path_root).
--   §2  THE ECHELON IS THE PRODUCT'S. `node_list` answers `product` for both
--       finished products and `subassembly` only for the true sub-assembly —
--       the answer the same fixture got WITHOUT the root rows.
--   §3  D129 STILL HOLDS. A genuine parentless COMPONENT row still feeds
--       every shipping product — one edge per root, typed `material`.
--   §4  BOTH DECLARATIONS COUNT. A root row whose child is a product declared
--       ONLY by its outbound lanes (no item-master row) fabricates nothing
--       either — "is a product" is asked of the master AND of `demand`.
--
-- ── MUTATIONS THAT MUST MAKE THIS FILE FAIL ───────────────────────────────
--   * remove the D171 predicate from either `bom_edges` CTE (the pre-migration
--     body) → §1 red (self-loop FP1→FP1, cross edge FP1→FP2) and §2 red
--     (both products answer `subassembly`). Verified red against the
--     pre-migration function during the 2026-09-23 acceptance audit — the
--     reproduction this file encodes.
--   * narrow the predicate to the item master only (drop the `demand` EXISTS)
--     → §4 red: the master-less shipped product's root row fabricates again.
--   * widen it to ALL parentless rows (the engine's own rule) → §3 red: the
--     genuine top-level component loses its edges, which is D129 reopened.

DO $d171$
DECLARE
  v_org   uuid := '00000000-0000-4000-8000-000000171000';
  v_actor uuid := '00000000-0000-4000-8000-000000171001';
  v_proj  uuid := '00000000-0000-4000-8000-000000171010';
  v_plant text := 'D171P';
  v_email text := 'd171@example.invalid';
  v_n     integer;
  v_txt   text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D171 Org', 'd171-org');
  INSERT INTO auth.users (id, email) VALUES (v_actor, v_email);
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
    VALUES (v_actor, v_email, 'D171 Actor', 'x', 'D171 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level)
    VALUES (v_proj, 'D171 roots', v_actor, v_plant, 'D171 Org', v_org, 'multi');

  PERFORM public.set_current_user_context(v_actor, v_email);

  -- ── the fixture ─────────────────────────────────────────────────────────
  -- FP1 and FP2 are finished products: in the item master AND shipping.
  -- LANEONLY is a product declared ONLY by outbound (no master row) — §4's
  -- subject. SUB is a true sub-assembly (built from RAW1, consumed by FP1).
  -- TOPC is a genuine parentless top-level component — D129's subject.
  -- The three root rows (FP1, FP2, LANEONLY at level 0, parent blank) are the
  -- poisoned shape: the file a user actually uploads.
  INSERT INTO public.products (project_id, product_id, name)
    VALUES (v_proj, 'FP1', 'Product One'),
           (v_proj, 'FP2', 'Product Two'),
           (v_proj, 'SUB', 'Sub-assembly');

  INSERT INTO public.outbound_logistics
    (project_id, plant_name, product_id, customer_id, volume, time_unit)
  VALUES (v_proj, v_plant, 'FP1',      'CUST', 10, 'week'),
         (v_proj, v_plant, 'FP2',      'CUST',  5, 'week'),
         (v_proj, v_plant, 'LANEONLY', 'CUST',  2, 'week');

  INSERT INTO public.bom_multi_level
    (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
  VALUES (v_proj, v_plant, 'FP1',      0, NULL,  1),   -- the poisoned rows
         (v_proj, v_plant, 'FP2',      0, '',    1),
         (v_proj, v_plant, 'LANEONLY', 0, NULL,  1),
         (v_proj, v_plant, 'SUB',      1, 'FP1', 1),   -- the real tree
         (v_proj, v_plant, 'RAW1',     2, 'SUB', 2),
         (v_proj, v_plant, 'RAW2',     1, 'FP1', 1),
         (v_proj, v_plant, 'RAW2',     1, 'FP2', 2),
         (v_proj, v_plant, 'TOPC',     0, NULL,  3);   -- D129's genuine case

  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, lead_time, unit_price, time_unit)
  VALUES (v_proj, v_plant, 'SUP1', 'RAW1', 20, 1, 1, 'week'),
         (v_proj, v_plant, 'SUP2', 'RAW2', 20, 1, 1, 'week'),
         (v_proj, v_plant, 'SUP3', 'TOPC', 20, 1, 1, 'week');

  -- ── §1 · nothing is fabricated ──────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_proj AND data_source = 'bom'
     AND from_location = to_location;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D171 §1: % self-loop bom edge(s) — the root rows are being read as edges again', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_proj AND data_source = 'bom'
     AND from_location IN ('FP1', 'FP2', 'LANEONLY');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D171 §1: % bom edge(s) FROM a product — parent = every-other-product is back', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM (
    SELECT from_location, to_location, path_root
      FROM public.supply_chain_data_multi_tier
     WHERE project_id = v_proj AND data_source = 'bom'
     GROUP BY 1, 2, 3
    HAVING count(*) > 1) dup;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D171 §1: % duplicated bom edge(s) per (from, to, path_root)', v_n;
  END IF;

  -- ── §2 · the echelon is the product's ───────────────────────────────────
  SELECT string_agg(node_id || '=' || echelon, ', ' ORDER BY node_id) INTO v_txt
    FROM public.node_list
   WHERE project_id = v_proj AND node_id IN ('FP1', 'FP2', 'SUB')
     AND NOT ((node_id IN ('FP1', 'FP2') AND echelon = 'product')
              OR (node_id = 'SUB' AND echelon = 'subassembly'));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'D171 §2: wrong echelon(s) with root rows present: %', v_txt;
  END IF;

  -- ── §3 · D129 still holds ───────────────────────────────────────────────
  SELECT count(DISTINCT to_location) INTO v_n
    FROM public.supply_chain_data_multi_tier
   WHERE project_id = v_proj AND data_source = 'bom'
     AND from_location = 'TOPC'
     AND to_location IN ('FP1', 'FP2', 'LANEONLY');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'D171 §3: the genuine parentless component reaches % of 3 shipping products — D129 reopened', v_n;
  END IF;

  -- ── §4 · a lane-only product's root row fabricates nothing either ───────
  -- (asserted by §1's from-a-product sweep; here the positive half: LANEONLY
  -- exists as a node and is not a bom source.)
  SELECT count(*) INTO v_n
    FROM public.node_list
   WHERE project_id = v_proj AND node_id = 'LANEONLY';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D171 §4: the lane-only product is missing from node_list (%)', v_n;
  END IF;

  RAISE NOTICE 'D171 rehearsal green: no fabricated edges, product echelons intact, D129 preserved, both product declarations honored — 4 sections.';
END
$d171$;
