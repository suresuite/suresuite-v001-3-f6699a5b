-- Network ETL / §4 D171 — a BOM root row that names a product is not an edge.
--
-- WHAT WAS WRONG. `bom_multi_level` files exported from ERP systems routinely
-- carry the finished products themselves as level-0 rows with a blank
-- `higher_level_component_id` (`P1,0,,1`) — a shape the ingest contract
-- explicitly admits ("level 0 is a root component"; blank parent "only at the
-- root level"), so such a file lands with ZERO findings. The lane rebuild then
-- applied D129's parentless-row rule ("the parent is every product the plant
-- ships") to those rows too, joining each one to EVERY shipping product:
-- self-loops (P1→P1), fabricated product→product edges (P1→P2, P2→P1), and a
-- duplicate of every real BOM lane per fabricated path root. Because
-- `classify_node_echelon` answers `subassembly` for a node that is both a BOM
-- source and a BOM target, every finished product then rendered as a
-- sub-assembly on every network page, and every centrality was computed over
-- edges no CSV contains. Reproduced end-to-end on the rehearsal database
-- during the 2026-09-23 acceptance audit; removing the two root rows restored
-- correct typing, which is the measurement this migration turns into a rule.
--
-- WHAT THIS CHANGES, AND WHAT IT KEEPS. One predicate, added to the
-- multi-level half of BOTH `bom_edges` CTEs (flat lane and deep lane): a
-- parentless row is skipped when its child is itself a product — declared in
-- the item master, or shipping through the outbound lanes. D129's rule is
-- UNCHANGED for what it was written for: a genuine top-level component with a
-- blank parent still feeds every shipping product. The engine's own flatten
-- (`datamap._flatten_multi_level_bom`) has always dropped blank-parent rows,
-- so after this the lanes and the simulation stop disagreeing about the same
-- uploaded file in the one case a user can actually produce.
--
-- Same signature, same grants, same COMMENT — `CREATE OR REPLACE` only.
-- `rehearsal/380` proves the fabrication is gone and D129 still holds.

CREATE OR REPLACE FUNCTION public.rebuild_supply_chain_lanes(
  p_project_id    uuid,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_org      text;
  v_modeler  uuid;
  v_actor    uuid;
  v_email    text;
  v_exists   boolean;
  v_scd      integer := 0;
  v_mt       integer := 0;
BEGIN
  SELECT true, p.organization, p.modeler_id
    INTO v_exists, v_org, v_modeler
    FROM public.projects p
   WHERE p.id = p_project_id;

  -- The project is gone, or was never there. This runs from a statement trigger
  -- on four tables that CASCADE from `projects`, so a project deletion fires it
  -- with the parent row already removed — and a rebuild there would re-insert
  -- rows into two tables that carry NO cascade of their own (`node_list` and
  -- `supply_chain_data_multi_tier`), which is orphan rows created by a repair.
  IF NOT COALESCE(v_exists, false) THEN
    RETURN jsonb_build_object('skipped', 'no_project');
  END IF;

  -- ATTRIBUTION, NOT AUTHORIZATION. The caller's actor, else whoever the
  -- enclosing statement already named, else the project owner — a tier-3 write
  -- must name somebody (`audit-actor`, G4), and a trigger has no caller to ask.
  v_actor := COALESCE(p_actor_user_id, public.get_current_user_id(), v_modeler);

  SELECT au.email INTO v_email
    FROM public.approved_users au WHERE au.id = v_actor LIMIT 1;

  IF v_actor IS NOT NULL THEN
    PERFORM public.set_current_user_context(v_actor, COALESCE(v_email, ''));
  END IF;
  PERFORM public.assert_writer_may_act('rebuild_supply_chain_lanes', p_project_id, v_actor);

  DELETE FROM public.supply_chain_data            WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- ONE insert per table rather than four. Every lane statement fires
  -- `auto_refresh_node_list_on_lane_change`, so the old ten-statement build paid
  -- for ten full re-classifications of the graph per combine — and after this
  -- package a source edit triggers a combine, so that cost is now paid on
  -- uploads too. Four statements instead of ten is not a micro-optimisation
  -- here; it is what makes the trigger in section 5 affordable.
  WITH RECURSIVE
  -- D150 — `rate_to_weekly` at EVERY read, which the deployed writer never had.
  -- WP 0.2 closed D2 in the edge function and the RPC kept all eight raw reads.
  -- `normalize-at-promotion` (I3) makes this exactly identity (×7/7) for any row
  -- promoted since WP 3.3 and load-bearing for every row that predates it, which
  -- is the same reason `sc_nodes` still converts.
  outb AS (
    SELECT o.plant_name, o.product_id, o.customer_id,
           public.rate_to_weekly(COALESCE(o.volume, 0), o.time_unit) AS wk
      FROM public.outbound_logistics o
     WHERE o.project_id = p_project_id
       AND COALESCE(btrim(o.product_id), '') <> ''
  ),
  demand AS (
    SELECT plant_name, product_id, SUM(wk) AS wk
      FROM outb GROUP BY plant_name, product_id
  ),
  -- Both BOM tables, normalized to (parent ← child, rate, depth). Unconditional,
  -- exactly as the RPC has always read them: `projects.bom_level` gates which one
  -- a project UPLOADS, and branching on it is what left three projects with a
  -- permanently empty Process page (D130). A project holding rows in both holds
  -- two real uploads and both are built.
  bom_edges AS (
    -- D129 / D141 — A PARENTLESS BOM ROW'S PARENT IS THE FINISHED PRODUCT.
    --
    -- `bom_multi_level.higher_level_component_id` is "empty at the top of the
    -- tree, where the parent is the finished product itself" — its own sidecar
    -- says so — and the table names NO product, so the BOM is plant-scoped and
    -- "the finished product" means every product that plant ships. With one
    -- product it is unambiguous; with several the row genuinely feeds each of
    -- them, and each root carries its OWN demand, so nothing is double counted.
    -- A plant that ships no product yields NULL here and the edge is dropped by
    -- the walk — which is the same answer as "reaches no finished product".
    --
    -- The old writers: the edge function looked up `plant::<blank>`, found no
    -- parent demand and skipped the row in the EMIT loop, so a count of `''`
    -- could never see it (D129). The RPC wrote `COALESCE(…, 'ROOT')` into both
    -- `to_location` and `path_root` — a node no CSV contains, no user can
    -- explain, and every centrality on the page would be computed over (D141).
    SELECT b.plant_name,
           COALESCE(NULLIF(btrim(b.higher_level_component_id), ''), d.product_id) AS parent_id,
           btrim(b.material_id)                       AS child_id,
           COALESCE(b.consumption_rate, 0)            AS rate,
           b.level                                    AS depth
      FROM public.bom_multi_level b
      LEFT JOIN demand d
        ON d.plant_name = b.plant_name
       AND NULLIF(btrim(b.higher_level_component_id), '') IS NULL
     WHERE b.project_id = p_project_id
       AND COALESCE(btrim(b.material_id), '') <> ''
       -- §4 D171 — A PARENTLESS ROW WHOSE CHILD IS ITSELF A PRODUCT IS THE
       -- PRODUCT'S OWN ROOT ROW, NOT A COMPONENT EDGE. D129's rule ("the
       -- parent is every product the plant ships") is for components at the
       -- top of the tree; applied to a row that NAMES a product as the child
       -- it fabricates parent = every OTHER product (P1→P2) and parent =
       -- itself (P1→P1), which typed every finished product `subassembly`
       -- and duplicated every real lane once per fabricated path root. The
       -- engine's flatten has always dropped blank-parent rows outright
       -- (datamap._flatten_multi_level_bom, roots-never-children), so before
       -- this line the two halves disagreed about the same uploaded file.
       -- "Is a product" is asked of both places a product can be declared:
       -- the item master, and the outbound lanes (`demand` covers a shipped
       -- product with no master row).
       AND NOT (NULLIF(btrim(b.higher_level_component_id), '') IS NULL
                AND (EXISTS (SELECT 1 FROM public.products pr
                              WHERE pr.project_id = p_project_id
                                AND btrim(pr.product_id) = btrim(b.material_id))
                     OR EXISTS (SELECT 1 FROM demand dd
                                 WHERE dd.plant_name = b.plant_name
                                   AND dd.product_id = btrim(b.material_id))))
    UNION ALL
    SELECT s.plant_name, btrim(s.product_id), btrim(s.material_id),
           COALESCE(s.consumption_rate, 0), 1
      FROM public.bom_single_level s
     WHERE s.project_id = p_project_id
       AND COALESCE(btrim(s.material_id), '') <> ''
       AND COALESCE(btrim(s.product_id), '')  <> ''
  ),
  -- THE DEMAND WALK, ported from `combine-project/index.ts`. A finished product's
  -- weekly demand propagates down the tree, multiplied by each edge's consumption
  -- rate, and every (node, root) pair sums the contributions of every path.
  --
  -- RECURSIVE and not a loop over `level`: a level-ordered loop is only correct if
  -- `level` is a topological order of the tree, and D140 is the finding that
  -- nobody may assume anything about that column. `path` is the cycle guard — a
  -- BOM that contains a cycle is bad data, not a reason to hang a migration — and
  -- the 64-step cap bounds a tree whose depth is data.
  walk AS (
    SELECT d.plant_name, d.product_id AS node_id, d.product_id AS root_id,
           d.wk AS qty, ARRAY[d.product_id] AS path
      FROM demand d
     WHERE d.wk IS NOT NULL
    UNION ALL
    SELECT e.plant_name, e.child_id, w.root_id, w.qty * e.rate, w.path || e.child_id
      FROM walk w
      JOIN bom_edges e
        ON e.plant_name = w.plant_name
       AND e.parent_id  = w.node_id
     WHERE e.child_id <> ALL (w.path)
       AND array_length(w.path, 1) < 64
  ),
  node_demand AS (
    SELECT plant_name, node_id, root_id, SUM(qty) AS qty
      FROM walk GROUP BY plant_name, node_id, root_id
  ),
  material_demand AS (
    SELECT plant_name, node_id, SUM(qty) AS qty
      FROM node_demand GROUP BY plant_name, node_id
  ),
  inb AS (
    SELECT i.plant_name, i.supplier_id, i.material_id,
           public.rate_to_weekly(COALESCE(i.volume, 0), i.time_unit) AS wk
      FROM public.inbound_logistics i
     WHERE i.project_id = p_project_id
       AND COALESCE(btrim(i.supplier_id), '') <> ''
       AND COALESCE(btrim(i.material_id), '') <> ''
  ),
  inb_total AS (
    SELECT plant_name, material_id, SUM(wk) AS wk
      FROM inb GROUP BY plant_name, material_id
  ),
  -- A PURCHASED material — one the plant buys rather than builds. This is what
  -- makes the flat lane the product-level graph: its bom rows run from the things
  -- a supplier delivers to the things a customer buys.
  purchased AS (
    SELECT DISTINCT plant_name, material_id FROM inb
  ),
  flat AS (
    SELECT o.plant_name, 'outbound'::text AS data_source,
           o.product_id AS from_location, o.customer_id AS to_location,
           o.wk AS rate,
           -- `volumeShare`, which is what this column's sidecar has always said
           -- it is. The RPC wrote a literal 1.0 on this lane and the edge
           -- function wrote the share; D140's class, settled toward the contract.
           CASE WHEN dm.wk > 0 THEN o.wk / dm.wk ELSE 1.0 END AS sourcing_ratio,
           o.wk AS weighted
      FROM outb o
      JOIN demand dm ON dm.plant_name = o.plant_name AND dm.product_id = o.product_id
     WHERE COALESCE(btrim(o.customer_id), '') <> ''
    UNION ALL
    SELECT nd.plant_name, 'bom',
           nd.node_id, nd.root_id,
           -- D136 — the EFFECTIVE consumption rate, where the multi-level path
           -- wrote a literal 0 and the single-level path wrote the real number.
           CASE WHEN dm.wk > 0 THEN nd.qty / dm.wk ELSE 0 END,
           1.0,
           nd.qty
      FROM node_demand nd
      JOIN purchased p  ON p.plant_name  = nd.plant_name AND p.material_id = nd.node_id
      JOIN demand    dm ON dm.plant_name = nd.plant_name AND dm.product_id = nd.root_id
     WHERE nd.qty > 0
       AND nd.node_id <> nd.root_id
    UNION ALL
    SELECT i.plant_name, 'inbound',
           i.supplier_id, i.material_id,
           i.wk,
           CASE WHEN t.wk > 0 THEN i.wk / t.wk ELSE 1.0 END,
           -- The MATERIAL's demand times this supplier's share of it. The RPC
           -- multiplied the plant's total outbound volume by the share instead,
           -- which is a number about products standing in for one about a
           -- material.
           COALESCE(md.qty, 0) * CASE WHEN t.wk > 0 THEN i.wk / t.wk ELSE 1.0 END
      FROM inb i
      JOIN inb_total t ON t.plant_name = i.plant_name AND t.material_id = i.material_id
      LEFT JOIN material_demand md
             ON md.plant_name = i.plant_name AND md.node_id = i.material_id
  )
  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, f.plant_name, f.data_source, f.from_location, f.to_location,
         f.rate, f.sourcing_ratio, f.weighted, v_actor, v_org
    FROM flat f
   WHERE COALESCE(btrim(f.from_location), '') <> ''
     AND COALESCE(btrim(f.to_location), '')   <> '';

  GET DIAGNOSTICS v_scd = ROW_COUNT;

  -- ── the deep lane ───────────────────────────────────────────────────────
  WITH RECURSIVE
  outb AS (
    SELECT o.plant_name, o.product_id, o.customer_id,
           public.rate_to_weekly(COALESCE(o.volume, 0), o.time_unit) AS wk
      FROM public.outbound_logistics o
     WHERE o.project_id = p_project_id
       AND COALESCE(btrim(o.product_id), '') <> ''
  ),
  demand AS (
    SELECT plant_name, product_id, SUM(wk) AS wk
      FROM outb GROUP BY plant_name, product_id
  ),
  bom_edges AS (
    SELECT b.plant_name,
           COALESCE(NULLIF(btrim(b.higher_level_component_id), ''), d.product_id) AS parent_id,
           btrim(b.material_id)            AS child_id,
           COALESCE(b.consumption_rate, 0) AS rate,
           -- D140 IN ONE LINE. The RPC wrote a literal 2 here and never read
           -- `b.level`, so `Project AA - ver3`'s four-level 396-row BOM landed
           -- entirely at level 2 and the page rendered 260 materials and 66
           -- products as one flat column labelled `material level 2`.
           b.level AS depth
      FROM public.bom_multi_level b
      LEFT JOIN demand d
        ON d.plant_name = b.plant_name
       AND NULLIF(btrim(b.higher_level_component_id), '') IS NULL
     WHERE b.project_id = p_project_id
       AND COALESCE(btrim(b.material_id), '') <> ''
       -- §4 D171 — A PARENTLESS ROW WHOSE CHILD IS ITSELF A PRODUCT IS THE
       -- PRODUCT'S OWN ROOT ROW, NOT A COMPONENT EDGE. D129's rule ("the
       -- parent is every product the plant ships") is for components at the
       -- top of the tree; applied to a row that NAMES a product as the child
       -- it fabricates parent = every OTHER product (P1→P2) and parent =
       -- itself (P1→P1), which typed every finished product `subassembly`
       -- and duplicated every real lane once per fabricated path root. The
       -- engine's flatten has always dropped blank-parent rows outright
       -- (datamap._flatten_multi_level_bom, roots-never-children), so before
       -- this line the two halves disagreed about the same uploaded file.
       -- "Is a product" is asked of both places a product can be declared:
       -- the item master, and the outbound lanes (`demand` covers a shipped
       -- product with no master row).
       AND NOT (NULLIF(btrim(b.higher_level_component_id), '') IS NULL
                AND (EXISTS (SELECT 1 FROM public.products pr
                              WHERE pr.project_id = p_project_id
                                AND btrim(pr.product_id) = btrim(b.material_id))
                     OR EXISTS (SELECT 1 FROM demand dd
                                 WHERE dd.plant_name = b.plant_name
                                   AND dd.product_id = btrim(b.material_id))))
    UNION ALL
    -- D130 — the single-level half of the deep lane, which never existed. A
    -- single-level BOM is a real two-level tree and the Process page can draw it.
    SELECT s.plant_name, btrim(s.product_id), btrim(s.material_id),
           COALESCE(s.consumption_rate, 0), 1
      FROM public.bom_single_level s
     WHERE s.project_id = p_project_id
       AND COALESCE(btrim(s.material_id), '') <> ''
       AND COALESCE(btrim(s.product_id), '')  <> ''
  ),
  walk AS (
    SELECT d.plant_name, d.product_id AS node_id, d.product_id AS root_id,
           d.wk AS qty, ARRAY[d.product_id] AS path
      FROM demand d
     WHERE d.wk IS NOT NULL
    UNION ALL
    SELECT e.plant_name, e.child_id, w.root_id, w.qty * e.rate, w.path || e.child_id
      FROM walk w
      JOIN bom_edges e
        ON e.plant_name = w.plant_name AND e.parent_id = w.node_id
     WHERE e.child_id <> ALL (w.path)
       AND array_length(w.path, 1) < 64
  ),
  node_demand AS (
    SELECT plant_name, node_id, root_id, SUM(qty) AS qty
      FROM walk GROUP BY plant_name, node_id, root_id
  ),
  material_demand AS (
    SELECT plant_name, node_id, SUM(qty) AS qty
      FROM node_demand GROUP BY plant_name, node_id
  ),
  inb AS (
    SELECT i.plant_name, i.supplier_id, i.material_id,
           public.rate_to_weekly(COALESCE(i.volume, 0), i.time_unit) AS wk
      FROM public.inbound_logistics i
     WHERE i.project_id = p_project_id
       AND COALESCE(btrim(i.supplier_id), '') <> ''
       AND COALESCE(btrim(i.material_id), '') <> ''
  ),
  inb_total AS (
    SELECT plant_name, material_id, SUM(wk) AS wk
      FROM inb GROUP BY plant_name, material_id
  ),
  deep AS (
    -- Outbound: the edge's upstream end is the finished product, and a finished
    -- product sits at BOM depth 0. That is a fact the tree states, not D134's
    -- substitution: NULL below means "this node is in no BOM", and a product is
    -- the root of one by definition.
    SELECT o.plant_name, 'outbound'::text AS data_source,
           o.product_id AS from_location, o.customer_id AS to_location,
           0::integer AS bom_depth, o.product_id AS path_root,
           o.wk AS rate,
           CASE WHEN dm.wk > 0 THEN o.wk / dm.wk ELSE 1.0 END AS sourcing_ratio,
           o.wk AS weighted
      FROM outb o
      JOIN demand dm ON dm.plant_name = o.plant_name AND dm.product_id = o.product_id
     WHERE COALESCE(btrim(o.customer_id), '') <> ''
    UNION ALL
    -- One row per BOM EDGE per ROOT PRODUCT, at the BOM's own depth.
    --
    -- `weighted` is THIS EDGE's contribution — the parent's demand for that root
    -- times this edge's rate — and not the child's total demand. The edge
    -- function wrote the child's total on every one of its parent edges, so a
    -- material used by two assemblies had its whole requirement counted twice.
    --
    -- LEFT JOIN, deliberately: a BOM subtree that reaches no finished product is
    -- still part of the tree this lane exists to draw. It arrives with a NULL
    -- `path_root` and a zero flow, which is what "we hold this structure and no
    -- demand reaches it" looks like — where an inner join would delete it and
    -- leave the Process page shorter than the CSV, with nothing to say why. It is
    -- also the only reading that does not regress a project holding a BOM and no
    -- outbound rows, which the RPC used to draw (flat, at level 2) and this would
    -- otherwise blank.
    SELECT e.plant_name, 'bom',
           e.child_id, e.parent_id,
           e.depth, nd.root_id,
           e.rate,
           1.0,
           COALESCE(nd.qty, 0) * e.rate
      FROM bom_edges e
      LEFT JOIN node_demand nd
        ON nd.plant_name = e.plant_name AND nd.node_id = e.parent_id
     WHERE e.parent_id IS NOT NULL
    UNION ALL
    -- Inbound: a supplier sits one step upstream of the material it feeds, so its
    -- depth is that material's depth PLUS ONE — from `node_bom_depth`, the one
    -- rule, and NULL when the material is in no BOM.
    --
    -- The RPC wrote `GREATEST(1, COALESCE(max_level, 0) + 1)`, whose two
    -- substitutions are the whole of the "two suppliers from one upload, four
    -- levels apart" §15 measured: a material absent from the BOM landed at 1,
    -- which the ladder calls a material, and one at depth 4 landed at 5.
    SELECT i.plant_name, 'inbound',
           i.supplier_id, i.material_id,
           public.node_bom_depth(p_project_id, i.material_id) + 1,
           i.material_id,
           i.wk,
           CASE WHEN t.wk > 0 THEN i.wk / t.wk ELSE 1.0 END,
           COALESCE(md.qty, 0) * CASE WHEN t.wk > 0 THEN i.wk / t.wk ELSE 1.0 END
      FROM inb i
      JOIN inb_total t ON t.plant_name = i.plant_name AND t.material_id = i.material_id
      LEFT JOIN material_demand md
             ON md.plant_name = i.plant_name AND md.node_id = i.material_id
  )
  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    level, bom_depth, path_root, material_consumption_rate, sourcing_ratio, weighted,
    uploaded_by, organization)
  SELECT p_project_id, d.plant_name, d.data_source, d.from_location, d.to_location,
         -- `level` is the deprecated ALIAS: the same value, NULLs included.
         d.bom_depth, d.bom_depth, d.path_root, d.rate, d.sourcing_ratio, d.weighted,
         v_actor, v_org
    FROM deep d
   WHERE COALESCE(btrim(d.from_location), '') <> ''
     AND COALESCE(btrim(d.to_location), '')   <> '';

  GET DIAGNOSTICS v_mt = ROW_COUNT;

  RETURN jsonb_build_object(
    'project_id',        p_project_id,
    'actor',             v_actor,
    'supply_chain_data', v_scd,
    'multi_tier',        v_mt);
END; $fn$;

