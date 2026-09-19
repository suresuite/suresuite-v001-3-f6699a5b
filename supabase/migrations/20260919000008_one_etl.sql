-- Phase 8 / WP 8.2 / §2.3 G1 — ONE ETL, AND IT STOPS LYING ABOUT `level`.
--
-- ── THE DECISION THIS PACKAGE COULD NOT AVOID ─────────────────────────────
--
-- §4 D140: TWO live ETLs write both edge tables and disagree about what `level`
-- means, so no reader can be correct. This file settles it.
--
--   THE SQL RPC LIVES. The edge function's lane build is deleted.
--
-- Four reasons, in the order they decided it:
--
--   1. The RPC is reached by a DATABASE TRIGGER — `auto_combine_on_completion`
--      on `projects` — as well as by three client sites. A trigger cannot call
--      an edge function, so keeping the edge function would leave the trigger
--      path permanently on the other writer. That is D140 by construction and
--      no amount of care in one of the two would close it.
--   2. `no-tier-skip` (I2): a derivation over tier-2 tables into tier 3 belongs
--      in the database. §4 D123 measured what the alternative costs — twelve of
--      eighteen edge functions shipped to `main` and never reached production.
--   3. The RPC already runs its DELETE and its INSERTs in ONE transaction.
--   4. D142's rebuild-on-source-change needs a TRIGGER, and a trigger can only
--      call SQL.
--
-- **AND THE BRIEF'S REASON WAS THE ONE REASON THAT IS NO LONGER TRUE.** It said
-- `combine-project` "is NOT deployed and never has been (§4 D123)".
-- `.github/workflows/supabase-functions.yml` has carried a `Deploy
-- combine-project` step since WP 6.3 (`cda6b57`), and `DataManager.tsx:518` —
-- the Combine BUTTON — invokes it. So both writers are live and reachable, and
-- the split is five call sites across two ETLs rather than the one stale one the
-- rescope described. The decision is unchanged; its evidence is (§16 · WP 8.2).
--
-- WHAT IS PORTED, NOT ADOPTED. The edge function's DEMAND WALK is the better
-- algorithm — it propagates a finished product's demand down the BOM, which the
-- RPC does not — so this file ports the walk into SQL rather than keeping the
-- RPC's arithmetic. It is a `WITH RECURSIVE` here instead of a level-ordered
-- loop, because a loop over `level` assumes that column is a topological order,
-- and D140 is precisely the finding that nobody may assume anything about it.
--
-- ── THE SEVEN DEFECTS THIS FILE CLOSES ────────────────────────────────────
--
--   D140  `level` was a literal 2 on the bom lane. It is now the BOM's own depth.
--   D134  `COALESCE(level, 0)` served an unknown depth to the ladder as a PRODUCT.
--   D129  a parentless BOM row's edge was dropped one stage before `''` could show.
--   D141  … and the RPC put a node called `ROOT` in its place.
--   D130  a single-level project wrote ZERO deep-tier rows, so its Process page
--         was permanently empty and nothing said why.
--   D133  `data_source_group` was written on 0 of 5 445 rows and the contract said
--         the pages filter on it.
--   D136  the multi-level path wrote a literal `material_consumption_rate: 0`.
--
-- and two this package FOUND rather than inherited:
--
--   D147  `get_multi_tier_network_data` projects `smt.data_source_group` from a
--         table that has no such column, so the function RAISES on every call.
--   D148  D2 was closed in the edge function and never in the RPC: the deployed
--         writer read every lane `volume` RAW, so a plant mixing monthly and
--         weekly rows had its sourcing shares computed across incompatible units.
--
-- ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
--
-- It does not backfill. The fix changes what a combine WRITES, not what is
-- already stored, so every project keeps the graph its last combine produced
-- until Combine is run again. `Project AA - ver3` — the project a user reported,
-- whose 396-row four-level BOM renders as one flat column — needs a re-combine
-- after this deploys. Said here, in §16, and in the pull request, because a
-- reader who sees "D140 closed" and looks at the page would otherwise conclude
-- it was not.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · `bom_depth`: the BOM's own depth, under a name that says so
-- ══════════════════════════════════════════════════════════════════════════
--
-- `level` has meant four things at once (§4 D127, D140) and its sidecar claimed a
-- fifth. `bom_depth` means ONE thing and the table that owns the measurement is
-- `bom_multi_level`. NULL is UNKNOWN and stays unknown — D134 is what the
-- alternative reads like on screen.
--
-- `level` is kept and written with the SAME value for one release, so the two
-- pages and `get_supply_chain_data_multi_tier`'s callers keep working while
-- WP 8.3/8.4 move the readers. An alias holds the same value or it is a second
-- authoring wearing a deprecation notice.

ALTER TABLE public.supply_chain_data_multi_tier
  ADD COLUMN IF NOT EXISTS bom_depth integer;

COMMENT ON COLUMN public.supply_chain_data_multi_tier.bom_depth IS
  'WP 8.2 · §4 D140, D134. How deep in the BILL OF MATERIALS the edge''s UPSTREAM '
  'end sits — 0 a finished product, 1 a material directly under it, N the Nth '
  'level of `bom_multi_level`. Read from `bom_multi_level.level` for a bom edge '
  'and from `node_bom_depth` for a supplier''s material, never from this table''s '
  'own `level`. NULL means UNKNOWN and is never substituted with 0.';

COMMENT ON COLUMN public.supply_chain_data_multi_tier.level IS
  'DEPRECATED as of WP 8.2 — a deprecated ALIAS of `bom_depth`, carrying the same '
  'value (NULLs included) for one release while the network pages move. It named '
  'four different measurements across two live writers (§4 D140): 0/1/literal-2 '
  'and `max_level + 1`. Read `bom_depth`.';

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · D133 — `data_source_group` goes, and its contract claim with it
-- ══════════════════════════════════════════════════════════════════════════
--
-- §15 (run `35433474185`): written on 0 of 5 445 rows, on every project, since
-- 2025-08-22. Its sidecar says the network pages filter on it; NO page filters on
-- it — two of them declare it in a TypeScript row type and neither ever reads it.
--
-- D133 allows exactly two outcomes, and WRITING it is the worse one. `data_source`
-- holds three values. A "coarser grouping" of three values is not a grouping — it
-- would be a taxonomy invented to give a column something to hold, and a column
-- written but never read is the same defect as a column read but never written,
-- pointing the other way. So it goes, together with the claim.
--
-- AND DROPPING IT IS WHAT FOUND D147. Two functions project
-- `smt.data_source_group` FROM `supply_chain_data_multi_tier`, which has never had
-- that column: `get_multi_tier_network_data` raises `column smt.data_source_group
-- does not exist` on every call, and it is `InteractiveNetworkSpace`'s FALLBACK —
-- the path taken when the primary read has already failed. Both of a user's two
-- routes to that page fail, and the second fails for a reason the first cannot
-- explain. `rehearsal/310` §7 proves the raise against the base schema, which is
-- the only way to see it: nothing static compares a `RETURN QUERY`'s column list
-- with the table under it (D145's class, one column further in).

ALTER TABLE public.supply_chain_data DROP COLUMN IF EXISTS data_source_group;

-- The ETL replace RPC named the column in its INSERT list. It keeps its signature
-- (so no grant moves) and loses the column.
CREATE OR REPLACE FUNCTION public.etl_replace_supply_chain(
  _project_id uuid,
  _actor_user_id uuid,
  _rows jsonb,
  _multi_tier_rows jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_deleted int; v_ins int; v_mt_del int; v_mt_ins int;
BEGIN
  PERFORM public.assert_writer_may_act('etl_replace_supply_chain', _project_id, _actor_user_id);

  IF jsonb_typeof(_rows) <> 'array' OR jsonb_typeof(_multi_tier_rows) <> 'array' THEN
    RAISE EXCEPTION 'etl_replace_supply_chain: both row payloads must be json arrays'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM public.supply_chain_data WHERE project_id = _project_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = _project_id;
  GET DIAGNOSTICS v_mt_del = ROW_COUNT;

  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source,
    from_location, to_location, weighted, material_consumption_rate, sourcing_ratio,
    uploaded_by, organization)
  SELECT _project_id, r.plant_name, r.data_source,
         r.from_location, r.to_location, r.weighted, r.material_consumption_rate,
         r.sourcing_ratio, r.uploaded_by, r.organization
    FROM jsonb_populate_recordset(null::public.supply_chain_data, _rows) AS r;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, level, bom_depth, path_root,
    uploaded_by, organization)
  SELECT _project_id, r.plant_name, r.data_source, r.from_location, r.to_location,
         r.material_consumption_rate, r.sourcing_ratio, r.weighted, r.level,
         r.bom_depth, r.path_root, r.uploaded_by, r.organization
    FROM jsonb_populate_recordset(null::public.supply_chain_data_multi_tier, _multi_tier_rows) AS r;
  GET DIAGNOSTICS v_mt_ins = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_deleted, 'inserted', v_ins,
    'multi_tier_deleted', v_mt_del, 'multi_tier_inserted', v_mt_ins);
END; $fn$;

COMMENT ON FUNCTION public.etl_replace_supply_chain(uuid,uuid,jsonb,jsonb) IS
  'WP 4.1''s atomic tier-3 replace. DEAD as of WP 8.2 — its one caller was '
  '`combine-project`''s lane build, which this package deleted. Left in place '
  'rather than dropped, for the reason WP 8.1 left `auto_refresh_node_list_on_scd_'
  'change`: a DROP takes the function''s grants with it (`rehearsal/210` §2) and a '
  'later `CREATE OR REPLACE` can resurrect it silently. If a second lane writer is '
  'ever justified, it is this function''s job to be it — not a page''s.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3 · `node_bom_depth` learns the single-level BOM (part of D130)
-- ══════════════════════════════════════════════════════════════════════════
--
-- WP 8.1 authored a node's BOM depth ONCE, and read one of the two BOM tables. So
-- `node_list.bom_depth` is NULL for every node of a single-level project, and the
-- deep lane this file builds for those projects would have had nothing to read.
--
-- Widened rather than restated: the alternative is a second depth rule inside the
-- lane build, which is `single-source` (I1) broken in the commit that closes D140
-- for exactly the same reason.
--
-- The rule is unchanged — MIN, because a material used by two assemblies at two
-- depths has more than one true depth and the shallowest says how close to a
-- finished product it sits. `LEAST` of two scalar sub-selects becomes MIN over a
-- UNION so a third and fourth source join without nesting.
CREATE OR REPLACE FUNCTION public.node_bom_depth(p_project_id uuid, p_node_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT MIN(d)::integer FROM (
    SELECT b.level AS d FROM public.bom_multi_level b
      WHERE b.project_id = p_project_id AND b.material_id = p_node_id
    UNION ALL
    SELECT GREATEST(b.level - 1, 0) FROM public.bom_multi_level b
      WHERE b.project_id = p_project_id AND b.higher_level_component_id = p_node_id
    UNION ALL
    -- A single-level BOM is a two-level tree: the product is 0 and every material
    -- under it is 1. That is what "single level" NAMES, so reading it is not a
    -- substitution.
    SELECT 1 FROM public.bom_single_level s
      WHERE s.project_id = p_project_id AND s.material_id = p_node_id
    UNION ALL
    SELECT 0 FROM public.bom_single_level s
      WHERE s.project_id = p_project_id AND s.product_id = p_node_id
  ) depths;
$function$;

COMMENT ON FUNCTION public.node_bom_depth(uuid, text) IS
  'WP 8.1 · §4 D140. THE node BOM-depth rule, now reading BOTH bom tables (WP 8.2, '
  'part of D130): a single-level project''s nodes had no depth at all, so its deep '
  'lane had nothing to be built from. MIN across every occurrence. NULL means the '
  'node is in no BOM and is never reported as 0.';

-- ══════════════════════════════════════════════════════════════════════════
-- 4 · THE ONE ETL
-- ══════════════════════════════════════════════════════════════════════════
--
-- Split in two, for the reason WP 8.1 split `rebuild_node_list` from
-- `node_list_discover` and paid for not doing it first: a DERIVATION NAMES WHO
-- AND DECIDES NOTHING (§4 D66, and `20260917000005` is the precedent). This
-- function runs from a statement trigger inside somebody else's INSERT, and a
-- derivation that authorizes there can only refuse a writer the database has
-- already allowed — which is how WP 8.1 turned two rehearsals red with
-- `forbidden`.
--
--   `rebuild_supply_chain_lanes`          — the derivation. Names the actor via
--                                           `assert_writer_may_act`. No role gate.
--   `combine_project_into_supply_chain`   — UNCHANGED signature and UNCHANGED
--                                           authorization; now delegates.
--
-- ── WHAT THE FLAT LANE MEANS, WHICH IS THE WHOLE OF D136's SECOND HALF ────
--
-- `supply_chain_data` is the PRODUCT-LEVEL lane: four echelons with the BOM
-- COLLAPSED. A bom row in it is `purchased material → FINISHED PRODUCT` and its
-- `weighted` is the product's weekly demand times the product of the consumption
-- rates along every path between them, SUMMED where a material reaches the same
-- product more than one way. A purchased material that reaches no finished
-- product emits no row.
--
-- The RPC wrote `material → its IMMEDIATE PARENT` with `weighted = the PLANT's
-- total outbound volume × that one row's rate` — so a four-deep BOM produced four
-- flat hops that are not a product graph, each weighted by a number belonging to a
-- different question. The edge function's `material_consumption_rate: 0` literal
-- (D136) is replaced by the EFFECTIVE rate, `weighted / demand`, which is the
-- units of this material one unit of that product consumes through every path.
-- On a single-level BOM that is exactly the uploaded `consumption_rate`, so the
-- column means the same thing on both project shapes for the first time.
--
-- Sub-assemblies are deliberately absent from THIS lane and present in the deep
-- one: "BOM collapsed" is what the product-level graph IS, and D136's first half
-- is answered by the deep lane now being built for every project shape rather
-- than by putting assemblies in a lane whose whole definition excludes them.
--
-- ── WHAT THE DEEP LANE MEANS ──────────────────────────────────────────────
--
-- `supply_chain_data_multi_tier` is the REAL TREE: one row per BOM edge per root
-- product, at the BOM's own depth.

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
  -- D148 — `rate_to_weekly` at EVERY read, which the deployed writer never had.
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

COMMENT ON FUNCTION public.rebuild_supply_chain_lanes(uuid, uuid) IS
  'WP 8.2 · §4 D140. THE supply-chain lane derivation — the ONE writer of both '
  'edge tables. Names its actor and decides nothing (D66): it runs from a '
  'statement trigger inside somebody else''s write, which the database has already '
  'authorized. `combine_project_into_supply_chain` is the authorizing wrapper.';

REVOKE ALL ON FUNCTION public.rebuild_supply_chain_lanes(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_supply_chain_lanes(uuid, uuid) TO service_role;

-- The authorizing wrapper. SAME signature, SAME return type, SAME authorization —
-- so no caller changes, no grant moves, and the `projects` completion trigger's
-- `PERFORM` is untouched. What changed is that its body is no longer 270 lines of
-- arithmetic.
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org     text;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
    FROM public.projects WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- UNCHANGED, deliberately. This predicate — modeler or organization admin — is
  -- what `20260917000005` established as this path's authorization when a role
  -- gate was found to refuse an organization admin on it. §4 D66 owns the
  -- divergence between it and `min_project_role`; it is not four writers' to
  -- answer ad hoc, and it is not this package's to move either.
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org)
     OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM public.rebuild_supply_chain_lanes(p_project_id, p_user_id);
END;
$function$;

COMMENT ON FUNCTION public.combine_project_into_supply_chain(uuid, uuid, text) IS
  'WP 8.2 · §4 D140. The AUTHORIZING wrapper over `rebuild_supply_chain_lanes`. '
  'Since WP 8.2 it is the only ETL: `combine-project` delegates here instead of '
  'building the lanes itself, so the completion trigger and the four client sites '
  'all reach one writer with one rule for `bom_depth`.';

-- ══════════════════════════════════════════════════════════════════════════
-- 5 · D142 — the lane is rebuilt when its sources change
-- ══════════════════════════════════════════════════════════════════════════
--
-- §15 (run `35433474185`): 2 of 10 projects hold an inbound lane that does not
-- match `inbound_logistics`, and the worst is the project a user reported — 369
-- lane rows against 321 source rows. 48 edges that no CSV contains.
--
-- NOT A TIMESTAMP COMPARISON, and D142 is the second place this repository has
-- learned why (D12 was the first). AA-ver3's lane was written 0.17 s AFTER its
-- `inbound_logistics` was last touched, so every freshness check in the product
-- said up to date — because `max(updated_at)` DOES NOT MOVE WHEN ROWS ARE
-- DELETED. A clock answers "did anything happen", and 48 rows leaving a table is
-- 48 things happening that move no clock.
--
-- A TRIGGER instead, on the four source tables. STATEMENT level with a TRANSITION
-- TABLE, which is what a statement trigger has instead of NEW/OLD — D143 is what
-- the other reading costs: a trigger that read `NEW.project_id` at statement level
-- did nothing at all for thirteen months and looked exactly like a graph that had
-- not changed. FOR EACH STATEMENT and not FOR EACH ROW: §4 D76 is what row-level
-- costs here, 2 129 recomputations of one graph.
CREATE OR REPLACE FUNCTION public.auto_rebuild_supply_chain_lanes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pid uuid;
BEGIN
  -- One statement can touch rows of several projects — `ingest_apply_run` writes
  -- one, a hand-typed repair need not — so every distinct project in the
  -- transition set is rebuilt rather than the first one.
  FOR pid IN
    SELECT DISTINCT project_id FROM changed_rows WHERE project_id IS NOT NULL
  LOOP
    PERFORM public.rebuild_supply_chain_lanes(pid, NULL);
  END LOOP;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.auto_rebuild_supply_chain_lanes() IS
  'WP 8.2 · §4 D142. Rebuilds both edge tables when any of the four source lanes '
  'changes. A DELETE is the case that matters: it moves no timestamp, so every '
  'freshness comparison in the product reported a stale graph as fresh.';

-- WRITTEN OUT, NOT GENERATED — AND `contract:rehearse -- --since HEAD` IS WHY.
--
-- The first draft created these twelve triggers from a `DO $mk$` block with
-- `EXECUTE format(...)` over an array of the four table names. It is shorter, it
-- applies correctly, and it passed the first two rehearsal modes. **The third
-- mode failed** — the one that rebuilds the base from the artifact THIS BRANCH
-- writes — because `contract:introspect` cannot follow dynamic DDL: it reports it
-- as "dynamic" and records no trigger. So the artifact `main` inherits would have
-- described a schema with no rebuild triggers at all, and every branch rehearsing
-- against it afterwards would have been testing a database this migration does not
-- produce. That is §4 D52's cost exactly, arriving through `format()` instead of
-- through a rename, and only the third mode can see it.
--
-- Twelve statements instead of six lines is the price of a schema that describes
-- itself. WP 8.1 wrote its six out for the same reason.
DROP TRIGGER IF EXISTS trg_outbound_logistics_rebuild_lanes_ins ON public.outbound_logistics;
CREATE TRIGGER trg_outbound_logistics_rebuild_lanes_ins
AFTER INSERT ON public.outbound_logistics
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_outbound_logistics_rebuild_lanes_upd ON public.outbound_logistics;
CREATE TRIGGER trg_outbound_logistics_rebuild_lanes_upd
AFTER UPDATE ON public.outbound_logistics
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_outbound_logistics_rebuild_lanes_del ON public.outbound_logistics;
CREATE TRIGGER trg_outbound_logistics_rebuild_lanes_del
AFTER DELETE ON public.outbound_logistics
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_inbound_logistics_rebuild_lanes_ins ON public.inbound_logistics;
CREATE TRIGGER trg_inbound_logistics_rebuild_lanes_ins
AFTER INSERT ON public.inbound_logistics
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_inbound_logistics_rebuild_lanes_upd ON public.inbound_logistics;
CREATE TRIGGER trg_inbound_logistics_rebuild_lanes_upd
AFTER UPDATE ON public.inbound_logistics
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_inbound_logistics_rebuild_lanes_del ON public.inbound_logistics;
CREATE TRIGGER trg_inbound_logistics_rebuild_lanes_del
AFTER DELETE ON public.inbound_logistics
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_single_level_rebuild_lanes_ins ON public.bom_single_level;
CREATE TRIGGER trg_bom_single_level_rebuild_lanes_ins
AFTER INSERT ON public.bom_single_level
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_single_level_rebuild_lanes_upd ON public.bom_single_level;
CREATE TRIGGER trg_bom_single_level_rebuild_lanes_upd
AFTER UPDATE ON public.bom_single_level
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_single_level_rebuild_lanes_del ON public.bom_single_level;
CREATE TRIGGER trg_bom_single_level_rebuild_lanes_del
AFTER DELETE ON public.bom_single_level
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_multi_level_rebuild_lanes_ins ON public.bom_multi_level;
CREATE TRIGGER trg_bom_multi_level_rebuild_lanes_ins
AFTER INSERT ON public.bom_multi_level
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_multi_level_rebuild_lanes_upd ON public.bom_multi_level;
CREATE TRIGGER trg_bom_multi_level_rebuild_lanes_upd
AFTER UPDATE ON public.bom_multi_level
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

DROP TRIGGER IF EXISTS trg_bom_multi_level_rebuild_lanes_del ON public.bom_multi_level;
CREATE TRIGGER trg_bom_multi_level_rebuild_lanes_del
AFTER DELETE ON public.bom_multi_level
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_rebuild_supply_chain_lanes();

-- ══════════════════════════════════════════════════════════════════════════
-- 6 · the two read paths — D134's substitution, and D147's raise
-- ══════════════════════════════════════════════════════════════════════════
--
-- Both are D145's shape: a fixed `RETURNS TABLE` is a SECOND authoring of the
-- schema, and `CREATE OR REPLACE FUNCTION` cannot change a return type. So both
-- are a DROP and a CREATE. Neither has ever carried an explicit grant — checked
-- against every migration that names them — so the DROP takes none with it, and
-- `rehearsal/310` §8 reads `proacl` back rather than asking
-- `has_function_privilege`, which cannot fail while PUBLIC keeps EXECUTE
-- (`rehearsal/210` §2 is where that lesson was paid for).

-- AND THE THREE-ARGUMENT OVERLOAD GOES WITH IT — D145's class, found by writing
-- `rehearsal/310`. `get_supply_chain_data_multi_tier` has existed in TWO live
-- forms since 2025-09-09: this five-argument one and a three-argument one
-- (`20250909193139`) projecting the same table with the same column list minus
-- the pagination. Two consequences, both live:
--
--   * a THREE-ARGUMENT positional call is ambiguous and raises `function … is not
--     unique`. The application never hit it because PostgREST calls by NAMED
--     argument with all five, so the overload has been unreachable and unnoticed;
--     the first three-argument call anybody wrote — this package's own rehearsal —
--     found it immediately.
--   * every fix to the read path lands in ONE of them. D134's `COALESCE(level, 0)`
--     was in the five-argument form only, and `bom_depth` would have been too, so
--     "the read no longer substitutes 0" would have been true of one function and
--     false of the other, under one name.
--
-- Dropped rather than kept in step: keeping two is the defect. Its column list is
-- a strict subset of the survivor's, no caller passes three arguments, and it
-- carries no explicit grant (`rehearsal/310` §8 reads the ACL back).
DROP FUNCTION IF EXISTS public.get_supply_chain_data_multi_tier(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_supply_chain_data_multi_tier(uuid, uuid, text, integer, integer);
CREATE FUNCTION public.get_supply_chain_data_multi_tier(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  data_source text,
  from_location text,
  to_location text,
  level integer,
  bom_depth integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  path_root text,
  organization text,
  uploaded_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT
    scdmt.id, scdmt.project_id, scdmt.plant_name, scdmt.data_source,
    scdmt.from_location, scdmt.to_location,
    -- D134 — the `COALESCE(scdmt.level, 0)` is GONE, in both branches. A NULL
    -- depth is UNKNOWN, the page has an `unknown` case it could never reach
    -- because this function answered the question before the page was asked it,
    -- and `0` is the one value the ladder calls a PRODUCT.
    scdmt.level, scdmt.bom_depth,
    scdmt.material_consumption_rate, scdmt.sourcing_ratio, scdmt.weighted,
    scdmt.path_root, scdmt.organization, scdmt.uploaded_by,
    scdmt.created_at, scdmt.updated_at
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  -- NULLS LAST so dropping the COALESCE does not also drop the total order the
  -- pagination below depends on.
  ORDER BY scdmt.bom_depth ASC NULLS LAST, scdmt.created_at, scdmt.id
  OFFSET COALESCE(p_offset, 0)
  LIMIT CASE WHEN COALESCE(p_limit, 0) > 0 THEN p_limit ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION public.get_supply_chain_data_multi_tier(uuid, uuid, text, integer, integer) IS
  'WP 8.2 · §4 D134, D140. The deep lane''s read path. Returns `bom_depth` beside '
  'the deprecated `level`, and no longer substitutes 0 for an unknown depth.';

DROP FUNCTION IF EXISTS public.get_multi_tier_network_data(uuid, uuid, text);
CREATE FUNCTION public.get_multi_tier_network_data(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  from_location text,
  to_location text,
  level integer,
  bom_depth integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  data_source text,
  path_root text,
  uploaded_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_org text;
  v_org_id uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- QUALIFIED, and this is D147's SECOND fatal error rather than a tidy-up. The
  -- `RETURNS TABLE` declares an OUT parameter named `organization`, so the
  -- unqualified `SELECT organization … FROM public.projects` that stood here
  -- raised `column reference "organization" is ambiguous` — BEFORE the missing
  -- column could even be reached. Two independent run-time failures in one
  -- fourteen-line body, which is what "this function has never executed once"
  -- looks like from the inside.
  SELECT p.organization, p.organization_id INTO v_org, v_org_id
  FROM public.projects p WHERE p.id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    smt.id, smt.project_id, smt.plant_name, smt.from_location, smt.to_location,
    -- D147 — `smt.data_source_group` stood here, and
    -- `supply_chain_data_multi_tier` has never had that column. This function
    -- raised `column smt.data_source_group does not exist` on EVERY call, and it
    -- is `InteractiveNetworkSpace`'s fallback: the path a user reaches only after
    -- the primary read has already failed. See the `SELECT … INTO` above for the
    -- second, independent raise in the same body.
    smt.level, smt.bom_depth,
    smt.material_consumption_rate, smt.sourcing_ratio, smt.weighted,
    smt.data_source, smt.path_root, smt.uploaded_by, smt.organization,
    smt.created_at, smt.updated_at
  FROM public.supply_chain_data_multi_tier smt
  WHERE smt.project_id = p_project_id
  ORDER BY smt.bom_depth ASC NULLS LAST, smt.from_location ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_multi_tier_network_data(uuid, uuid, text) IS
  'WP 8.2 · §4 D147. `InteractiveNetworkSpace`''s fallback read. It projected a '
  'column the table has never had, so it raised on every call since 2025-09-09 — '
  'D145''s class one column further in: nothing compares a `RETURN QUERY`''s '
  'column list with the table under it.';

SELECT pg_notify('pgrst', 'reload schema');
