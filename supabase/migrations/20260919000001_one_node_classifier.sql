-- Phase 8 / WP 8.1 / §2.3 G1 — ONE CLASSIFIER, AND TWO HONEST COLUMNS.
--
-- §4 D119: a node's TYPE is authored eight times — once in SQL, four times across
-- the network pages, once in the map component, once in the engine — and the eight
-- disagree BY CONSTRUCTION, because none of them reads a type. There is no type
-- column on either edge table, and `supply_chain_data.from_location`'s own sidecar
-- says why it cannot be inferred safely: it is "a supplier, a material, or the
-- plant, DEPENDING ON WHICH LANE PRODUCED IT".
--
-- This file authors it once, in the data.
--
-- ── WHY `node_list` AND NOT A NEW TABLE ────────────────────────────────────
--
-- Because the typed node projection already exists. `node_list` is keyed
-- (project_id, node_id) by `node_list_unique_per_project`, carries `node_type`
-- and `node_group`, already has `computed_from_hash`/`computed_at` from WP 4.3,
-- is tier 3, is audited by three triggers, is described by a sidecar, and is read
-- by `MapView` and nothing else. A `graph_nodes` table would duplicate a table
-- that exists, which is the defect `single-source` (I1) exists to prevent.
--
-- ── WHY `bom_depth` AND `supply_tier` ARE TWO COLUMNS ──────────────────────
--
-- Because they are two different measurements that today's single `level` column
-- conflates, and THE CONFLATION IS THE WRONG MAPPING. A BOM three levels deep does
-- not mean three tiers of suppliers, and a tier-2 supplier is not "a material at
-- level 2". §15 (run `35433474185`) measured what that costs: the project a user
-- reported has a BOM four levels deep whose entire bom lane sits at level 2, and
-- its suppliers occupy levels 1 and 5 — from one upload.
--
-- Either column may be NULL, and NULL means UNKNOWN rather than zero. That is WP
-- 4.4's third-state lesson applied before it can be got wrong: `unknown` is not
-- `stale`, and a depth nobody knows is not a depth of 0 (§4 D126 is exactly what
-- answering it with 0 produces — the ladder calls 0 a product).
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────
--
--   * It drops NO column and changes NO existing value. `node_type` keeps its
--     four-value vocabulary and its meaning, because `MapView` reads it TODAY and
--     a binary supplier-else-customer test would silently reclassify every
--     `subassembly` as a customer. `classify_node_type` becomes a WRAPPER over the
--     one rule rather than a second copy of it — one rule, two vocabularies, and
--     the legacy one is derived from the new one instead of living beside it.
--   * It does not touch `supply_chain_data_multi_tier.level`. Two live writers
--     disagree about what that column means (§4 D132) and choosing between them is
--     WP 8.2's first act, not a side effect of this file.
--   * It adds NO column to `graph_hash`. `node_list` is in
--     `graphHashCoverage.test.ts`'s `STILL_WHOLLY_OUT` and these three columns are
--     derived, so folding them in would put an output inside the identity of its
--     own inputs — which is what `input-hash` (I5) exists to prevent.
-- ============================================================================

-- ── 1 · the columns ────────────────────────────────────────────────────────

ALTER TABLE public.node_list
  ADD COLUMN IF NOT EXISTS echelon     text,
  ADD COLUMN IF NOT EXISTS bom_depth   integer,
  ADD COLUMN IF NOT EXISTS supply_tier integer;

-- The vocabulary is CHECK-constrained rather than documented, because a value the
-- database accepts is a value some writer will eventually produce. `unknown` is in
-- the list ON PURPOSE and is not the same as NULL:
--
--     NULL      — never derived (a row written before this migration, or by a
--                 writer that does not set it)
--     'unknown' — derived, and the rule could not place the node in any echelon
--
-- Collapsing those two is how "we have not looked" becomes "we looked and found
-- nothing", which is the substitution T1 forbids.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_list_echelon_declared'
  ) THEN
    ALTER TABLE public.node_list
      ADD CONSTRAINT node_list_echelon_declared
      CHECK (echelon IS NULL OR echelon IN
        ('customer','product','subassembly','material','supplier','plant','unknown'));
  END IF;

  -- A depth of 0 is the finished product (the top of the tree); negative is not a
  -- depth. A tier of 0 is the focal plant itself.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_list_depths_non_negative'
  ) THEN
    ALTER TABLE public.node_list
      ADD CONSTRAINT node_list_depths_non_negative
      CHECK ((bom_depth   IS NULL OR bom_depth   >= 0)
         AND (supply_tier IS NULL OR supply_tier >= 0));
  END IF;
END $$;

COMMENT ON COLUMN public.node_list.echelon IS
  'WP 8.1 · §4 D119. The node''s ROLE in the supply chain, derived once by '
  '`classify_node_echelon` and read rather than re-inferred. NULL means never '
  'derived; ''unknown'' means derived and unplaceable. Replaces the overloaded '
  '`node_type`, which cannot express ''subassembly'' — §15 run 35433474185 found '
  '65 nodes that are both a BOM material and a BOM source on one project alone.';

COMMENT ON COLUMN public.node_list.bom_depth IS
  'WP 8.1 · §4 D119. Depth in the BOM tree, from `bom_multi_level.level` — the '
  'table that owns the measurement — and NULL for a node that is in no BOM. This '
  'is what `supply_chain_data_multi_tier.level` actually holds on the bom lane, '
  'under a name that says so.';

COMMENT ON COLUMN public.node_list.supply_tier IS
  'WP 8.1 · §4 D119. Tiers upstream of the focal plant: 0 the plant, 1 a direct '
  'supplier, 2 and 3 from `tier2_suppliers`/`tier3_suppliers`. NULL when unknown, '
  'which includes every material, product and customer — they are not upstream '
  'suppliers, and reporting 0 for them would be the D126 substitution again. This '
  'is what `supply_chain_data_multi_tier.level`''s contract CLAIMED to be.';

-- ── 2 · the one rule ───────────────────────────────────────────────────────
--
-- Reads BOTH edge tables, which the old classifier did not: `rebuild_node_list`
-- derived `node_list` from `supply_chain_data` alone, so the deep-tier half of the
-- graph — the half the Process-level page renders — was outside the only typed
-- projection in the repository. §15 measured 104 such nodes (§4 D124).
--
-- THE PRIORITY ORDER IS THE RULE AND IT IS DETERMINISTIC. A node can hold several
-- lane roles at once (§15: 65 do), and "whichever we noticed last" is what four of
-- the eight classifiers currently answer. The order here is from the outside of
-- the chain inward, because the outer roles are the ones a lane states directly:
--
--   customer     — a target of the outbound lane and nothing else
--   supplier     — a source of the inbound lane and nothing else
--   subassembly  — BOTH a BOM target and a BOM source: the plant builds it AND
--                  consumes it. The value the old classifier had no word for, so
--                  it resolved all 65 to `product`.
--   product      — a source of the outbound lane, or a BOM target that is not
--                  also a BOM source
--   material     — a target of the inbound lane, or a BOM source
--   plant        — the project's own plant, which appears in no lane as a node
--   unknown      — in `node_list` and in no lane
CREATE OR REPLACE FUNCTION public.classify_node_echelon(p_project_id uuid, p_node_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_outbound_target boolean := false;   -- a customer
  is_outbound_source boolean := false;   -- a product
  is_inbound_source  boolean := false;   -- a supplier
  is_inbound_target  boolean := false;   -- a purchased material
  is_bom_source      boolean := false;   -- consumed by something
  is_bom_target      boolean := false;   -- built from something
  is_plant           boolean := false;
BEGIN
  IF p_node_id IS NULL OR btrim(p_node_id) = '' THEN
    RETURN 'unknown';
  END IF;

  -- One pass over each table rather than six EXISTS queries per node: the old
  -- classifier ran four correlated subqueries and `refresh_node_list_for_project`
  -- calls it twice per row, which is 8 scans per node on a 638-node project.
  SELECT
    bool_or(data_source = 'outbound' AND to_location   = p_node_id),
    bool_or(data_source = 'outbound' AND from_location = p_node_id),
    bool_or(data_source = 'inbound'  AND from_location = p_node_id),
    bool_or(data_source = 'inbound'  AND to_location   = p_node_id),
    bool_or(data_source = 'bom'      AND from_location = p_node_id),
    bool_or(data_source = 'bom'      AND to_location   = p_node_id)
  INTO is_outbound_target, is_outbound_source, is_inbound_source,
       is_inbound_target, is_bom_source, is_bom_target
  FROM (
    SELECT data_source, from_location, to_location
      FROM public.supply_chain_data
     WHERE project_id = p_project_id
       AND (from_location = p_node_id OR to_location = p_node_id)
    UNION ALL
    SELECT data_source, from_location, to_location
      FROM public.supply_chain_data_multi_tier
     WHERE project_id = p_project_id
       AND (from_location = p_node_id OR to_location = p_node_id)
  ) both_lanes;

  SELECT EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = p_project_id AND p.plant_name = p_node_id
  ) INTO is_plant;

  is_outbound_target := COALESCE(is_outbound_target, false);
  is_outbound_source := COALESCE(is_outbound_source, false);
  is_inbound_source  := COALESCE(is_inbound_source,  false);
  is_inbound_target  := COALESCE(is_inbound_target,  false);
  is_bom_source      := COALESCE(is_bom_source,      false);
  is_bom_target      := COALESCE(is_bom_target,      false);

  IF is_outbound_target AND NOT (is_outbound_source OR is_bom_source OR is_bom_target
                                 OR is_inbound_source OR is_inbound_target) THEN
    RETURN 'customer';
  ELSIF is_inbound_source AND NOT (is_outbound_target OR is_outbound_source
                                   OR is_bom_source OR is_bom_target OR is_inbound_target) THEN
    RETURN 'supplier';
  ELSIF is_bom_source AND is_bom_target THEN
    RETURN 'subassembly';
  ELSIF is_outbound_source OR is_bom_target THEN
    RETURN 'product';
  ELSIF is_inbound_target OR is_bom_source THEN
    RETURN 'material';
  ELSIF is_outbound_target THEN
    -- A customer that also holds another role: the outbound target is the claim a
    -- lane states directly, so it wins over nothing else matching.
    RETURN 'customer';
  ELSIF is_inbound_source THEN
    RETURN 'supplier';
  ELSIF is_plant THEN
    RETURN 'plant';
  ELSE
    RETURN 'unknown';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.classify_node_echelon(uuid, text) IS
  'WP 8.1 · §4 D119. THE node classifier. Every other one in this repository is '
  'either derived from it (`classify_node_type`) or is being deleted by WP 8.3. '
  'Reads both edge tables — the old rule read `supply_chain_data` only, which left '
  '104 deep-tier nodes untyped (§4 D124).';

-- ── 3 · the legacy vocabulary, DERIVED rather than copied ──────────────────
--
-- `classify_node_type` keeps its exact four-value + `unknown` output, so `MapView`,
-- `node_list.node_type` and `node_group` are unchanged — but it no longer contains
-- a rule. It contains a MAPPING from the one rule, so the two cannot drift. That
-- is the whole of `single-source` applied to a function instead of to a document:
-- there was never a way for the old classifier's priority order and a page's to be
-- compared, and now there is only one order to compare against.
--
-- `subassembly` maps to `material` here and NOT to `product`, which is a CHANGE in
-- one direction for the 65 nodes §15 found: the old order answered `product`
-- because it tested product before material. A thing the plant both builds and
-- consumes is a material to the old vocabulary — it is bought-or-made input to
-- something else — and calling it a product told `MapView` to draw it as a
-- customer-side node. Recorded here because it is the one value this file moves.
CREATE OR REPLACE FUNCTION public.classify_node_type(p_project_id uuid, p_node_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE public.classify_node_echelon(p_project_id, p_node_id)
           WHEN 'subassembly' THEN 'material'
           WHEN 'plant'       THEN 'plant'
           ELSE public.classify_node_echelon(p_project_id, p_node_id)
         END;
$function$;

COMMENT ON FUNCTION public.classify_node_type(uuid, text) IS
  'WP 8.1 · §4 D119. The LEGACY four-value vocabulary, now DERIVED from '
  '`classify_node_echelon` rather than implementing a second priority order beside '
  'it. Kept because `MapView` reads `node_list.node_type` today. `subassembly` maps '
  'to `material`: the old order answered `product` for those 65 nodes, which told '
  'the map to draw a thing the plant consumes on the customer side.';

-- ── 4 · the two measurements, each from the table that owns it ─────────────

CREATE OR REPLACE FUNCTION public.node_bom_depth(p_project_id uuid, p_node_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- From `bom_multi_level`, which OWNS the depth — not from
  -- `supply_chain_data_multi_tier.level`, which two writers disagree about (D132)
  -- and one of which discards this very value for a literal 2.
  --
  -- MIN, not MAX: a material used by two assemblies at different depths has more
  -- than one true depth, and the shallowest is the one that says how close to a
  -- finished product it sits. A node that is only ever a PARENT at level 1 is the
  -- finished product, depth 0.
  SELECT LEAST(
    (SELECT MIN(b.level) FROM public.bom_multi_level b
      WHERE b.project_id = p_project_id AND b.material_id = p_node_id),
    (SELECT MIN(GREATEST(b.level - 1, 0)) FROM public.bom_multi_level b
      WHERE b.project_id = p_project_id AND b.higher_level_component_id = p_node_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.node_supply_tier(p_project_id uuid, p_node_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- What `supply_chain_data_multi_tier.level`'s contract CLAIMED to be, derived
  -- from the tables that actually state it. NULL for anything that is not an
  -- upstream supplier, because a material has no supplier tier and answering 0
  -- would be D126's substitution wearing a different column name.
  --
  -- MIN across the sources: a firm that supplies the plant directly AND appears as
  -- someone's upstream supplier sits at both, and "tiers upstream" means the
  -- shortest such path.
  SELECT MIN(tier) FROM (
    SELECT 0 AS tier FROM public.projects p
      WHERE p.id = p_project_id AND p.plant_name = p_node_id
    UNION ALL
    SELECT 1 FROM public.inbound_logistics i
      WHERE i.project_id = p_project_id AND i.supplier_id = p_node_id
    UNION ALL
    SELECT 1 FROM public.tier2_suppliers t
      WHERE t.project_id = p_project_id AND t.supplier_id = p_node_id
    UNION ALL
    SELECT 2 FROM public.tier2_suppliers t
      WHERE t.project_id = p_project_id AND t.upstream_supplier_id = p_node_id
    UNION ALL
    SELECT 2 FROM public.tier3_suppliers t
      WHERE t.project_id = p_project_id AND t.supplier_id = p_node_id
    UNION ALL
    SELECT 3 FROM public.tier3_suppliers t
      WHERE t.project_id = p_project_id AND t.upstream_supplier_id = p_node_id
  ) tiers;
$function$;

-- ── 5 · discovery, SPLIT FROM AUTHORIZATION — and the rehearsal is why ─────
--
-- `rebuild_node_list`'s node set came from `supply_chain_data` only, so the
-- deep-tier half of the graph had no row in the only typed projection this
-- repository has (§4 D124, 104 nodes). Widening the CTE is the easy half.
--
-- THE HARD HALF WAS FOUND BY EXECUTION, NOT BY READING, and it is what the
-- rehearsal is for. `rebuild_node_list` AUTHORIZES: it refuses unless the current
-- user is the project's modeler or an admin, in the same organization. That was
-- harmless while the refresh ran only from the `projects.completed` trigger and
-- from explicit client calls. The moment D135's fix makes the LANE trigger fire
-- for real, the refresh runs inside somebody else's INSERT — and
-- `rehearsal/090` and `110` both went RED with `forbidden`, raised from a
-- derivation nobody asked to authorize.
--
-- **A derivation is not a decision.** The statement that wrote the lane was already
-- authorized; re-deciding it inside a trigger can only ever refuse a writer the
-- database has already allowed. That is §4 D66 exactly, and `20260917000005` is the
-- precedent: a role gate was added to four RPCs, found to refuse an organization
-- admin on a live path, and removed — because `min_project_role` is D66's to make
-- live and not each writer's to answer ad hoc.
--
-- So discovery becomes its own function with NO authorization, and the two callers
-- differ in exactly one way: `rebuild_node_list` keeps its check for the clients
-- that call it directly, and the refresh does not, because a trigger has no caller
-- to check.
CREATE OR REPLACE FUNCTION public.node_list_discover(p_project_id uuid, p_org text, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  -- ATTRIBUTION, NOT AUTHORIZATION — and `dataPlaneAudit.test.ts` is what put this
  -- line here. The first draft of this function wrote a tier-3 table with no
  -- `app.current_user_id`, and the ratchet failed with the new name in the list:
  -- its audit rows would have said `actor_known: false`. `assert_writer_may_act` is
  -- the shared preamble three other writers already use (`20260917000005`): it
  -- refuses a NULL actor and sets the GUC LOCAL to this transaction, and it
  -- deliberately does NOT authorize — a role gate was written into it, found to
  -- refuse an organization admin on a live path, and removed, because
  -- `min_project_role` is D66's to make live and not each writer's to answer ad hoc.
  --
  -- So: this function names WHO, and nothing here decides WHETHER. See section 5's
  -- header for why the second half belongs to the caller.
  PERFORM public.assert_writer_may_act('node_list_discover', p_project_id, p_actor);

  WITH nodes AS (
    SELECT scd.plant_name, scd.from_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
    UNION
    SELECT scd.plant_name, scd.to_location AS node_id
    FROM public.supply_chain_data scd
    WHERE scd.project_id = p_project_id
    UNION
    SELECT t.plant_name, t.from_location AS node_id
    FROM public.supply_chain_data_multi_tier t
    WHERE t.project_id = p_project_id
    UNION
    SELECT t.plant_name, t.to_location AS node_id
    FROM public.supply_chain_data_multi_tier t
    WHERE t.project_id = p_project_id
  ), dedup AS (
    SELECT node_id, MIN(plant_name) AS plant_name
    FROM nodes
    WHERE node_id IS NOT NULL AND btrim(node_id) <> ''
    GROUP BY node_id
  )
  INSERT INTO public.node_list (project_id, plant_name, node_id, organization, created_by)
  SELECT p_project_id, d.plant_name, d.node_id, p_org, p_actor
  FROM dedup d
  ON CONFLICT (project_id, node_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

COMMENT ON FUNCTION public.node_list_discover(uuid, text, uuid) IS
  'WP 8.1 · §4 D124, D66. The node-set discovery, reading BOTH edge tables and '
  'carrying NO authorization: a derivation is not a decision, and re-deciding one '
  'inside a trigger can only refuse a writer the database already allowed '
  '(rehearsal/090 and /110 proved it by going red). `rebuild_node_list` keeps the '
  'check for its direct callers; the refresh does not, because a trigger has no '
  'caller to check.';

-- The checked wrapper every existing client call reaches, byte-for-byte the same
-- authorization it has always had.
CREATE OR REPLACE FUNCTION public.rebuild_node_list(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_modeler uuid;
  v_role text;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, modeler_id INTO v_org, v_org_id, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN public.node_list_discover(p_project_id, v_org, public.get_current_user_id());
END;
$$;

-- WP 4.3 named the second parameter `p_actor_user_id` and `CREATE OR REPLACE`
-- cannot rename an input parameter, so the name is kept exactly. It also carries
-- NO `DEFAULT`: a default on the two-argument form would make a one-argument call
-- ambiguous against the one-argument overload below, and PostgreSQL raises that at
-- CALL time rather than at definition time — the kind of failure that ships.
CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(p_project_id uuid, p_actor_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_modeler uuid;
  v_email   text;
  v_actor   uuid;
  v_org     text;
BEGIN
  SELECT p.modeler_id INTO v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_modeler IS NULL THEN
    RETURN;
  END IF;

  -- The caller's actor when it has one, the project owner otherwise. A tier-3
  -- write must name somebody (`audit-actor`, G4).
  v_actor := COALESCE(p_actor_user_id, v_modeler);

  SELECT au.email INTO v_email
  FROM public.approved_users au
  WHERE au.id = v_actor
  LIMIT 1;

  SELECT p.organization INTO v_org
  FROM public.projects p
  WHERE p.id = p_project_id;

  PERFORM public.set_current_user_context(v_actor, COALESCE(v_email, ''));

  -- `node_list_discover`, NOT `rebuild_node_list`: the refresh runs from a trigger
  -- inside somebody else's statement, and that statement was already authorized.
  -- See section 5's header and §4 D66 — `rehearsal/090` and `/110` are what
  -- calling the checked wrapper here looks like.
  PERFORM public.node_list_discover(p_project_id, v_org, v_actor);

  UPDATE public.node_list nl
  SET echelon     = e.echelon,
      node_type   = CASE e.echelon WHEN 'subassembly' THEN 'material' ELSE e.echelon END,
      node_group  = initcap(CASE e.echelon WHEN 'subassembly' THEN 'material' ELSE e.echelon END),
      bom_depth   = public.node_bom_depth(nl.project_id, nl.node_id),
      supply_tier = public.node_supply_tier(nl.project_id, nl.node_id)
  FROM (
    SELECT id, public.classify_node_echelon(project_id, node_id) AS echelon
      FROM public.node_list
     WHERE project_id = p_project_id
  ) e
  WHERE nl.id = e.id;
END;
$function$;

COMMENT ON FUNCTION public.refresh_node_list_for_project(uuid, uuid) IS
  'WP 8.1 · §4 D119, D124. Rebuilds the typed node projection from BOTH edge '
  'tables and writes `echelon`, `bom_depth` and `supply_tier` beside the legacy '
  '`node_type`/`node_group`, which are now derived from the same single rule.';

-- The one-argument form every trigger and migration calls, so no caller changes.
CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(p_project_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.refresh_node_list_for_project(p_project_id, NULL::uuid);
$function$;

-- ── 7 · BOTH lane triggers, AND D135: the one that exists has never fired ──
--
-- `trg_scd_auto_refresh_node_list` has watched `supply_chain_data` FOR EACH
-- STATEMENT since 2025-08-29, and **it has never refreshed anything.** Its body is
-- `pid := COALESCE(NEW.project_id, OLD.project_id)` and a STATEMENT-level trigger
-- has no NEW or OLD: PL/pgSQL leaves both unassigned, the field reference yields
-- NULL rather than raising, the `IF pid IS NOT NULL` guard is false, and the
-- function returns having done nothing. Demonstrated rather than reasoned about —
-- a statement trigger with that body raises `NOTICE pid=<NULL>` on a real
-- PostgreSQL 16 (§16 · WP 8.1).
--
-- That is **§4 D135**, and it is D80's shape exactly: a whole mechanism whose
-- failure has no symptom, because a refresh that does not happen looks like a
-- graph that has not changed. It is also the other half of the answer to D124 —
-- `node_list` is refreshed ONLY by the `projects.completed` row-level trigger and
-- by a one-off backfill loop from 2025-08-31, which is why §15 found 242
-- `node_list` rows against 294 graph nodes on the project a user reported.
--
-- Fixed with a TRANSITION TABLE, which is what a statement-level trigger has
-- instead of NEW: `REFERENCING NEW TABLE` is available FOR EACH STATEMENT since
-- PostgreSQL 10, gives the rows the statement actually touched, and means the
-- project is read from the statement rather than guessed from the table.
--
-- STATEMENT level and not FOR EACH ROW, deliberately: §4 D76 is what row-level
-- costs here — 2 129 full recomputations of one graph because a trigger fired once
-- per inserted edge.
CREATE OR REPLACE FUNCTION public.auto_refresh_node_list_on_lane_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pid uuid;
BEGIN
  -- One statement can in principle touch rows of several projects, so every
  -- distinct project in the transition set is refreshed rather than the first one.
  FOR pid IN
    SELECT DISTINCT project_id FROM changed_rows WHERE project_id IS NOT NULL
  LOOP
    PERFORM public.refresh_node_list_for_project(pid);
  END LOOP;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.auto_refresh_node_list_on_lane_change() IS
  'WP 8.1 · §4 D135. Replaces `auto_refresh_node_list_on_scd_change`, whose body '
  'read NEW/OLD in a STATEMENT-level trigger — both unassigned, so the project id '
  'was always NULL and the refresh never ran once since 2025-08-29. Reads the '
  'transition table instead, which is what a statement-level trigger actually has.';

-- `supply_chain_data` — the trigger that existed and did nothing.
--
-- Every CREATE below is preceded by its own DROP. The first draft dropped only the
-- OLD trigger name and MUTATION TESTING is what found it: re-applying the file
-- failed with `trigger "trg_scd_auto_refresh_node_list_ins" already exists`, which
-- `contract:rehearse` reports as a RUN-TIME failure a static replay cannot see
-- (§4 D31). A migration that cannot be applied twice is a migration that cannot be
-- repaired, and the scdmt half below had the DROPs all along — so the asymmetry
-- would have survived review by looking deliberate.
DROP TRIGGER IF EXISTS trg_scd_auto_refresh_node_list     ON public.supply_chain_data;
DROP TRIGGER IF EXISTS trg_scd_auto_refresh_node_list_ins ON public.supply_chain_data;
DROP TRIGGER IF EXISTS trg_scd_auto_refresh_node_list_upd ON public.supply_chain_data;
DROP TRIGGER IF EXISTS trg_scd_auto_refresh_node_list_del ON public.supply_chain_data;
CREATE TRIGGER trg_scd_auto_refresh_node_list_ins
AFTER INSERT ON public.supply_chain_data
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

CREATE TRIGGER trg_scd_auto_refresh_node_list_upd
AFTER UPDATE ON public.supply_chain_data
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

CREATE TRIGGER trg_scd_auto_refresh_node_list_del
AFTER DELETE ON public.supply_chain_data
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

-- `supply_chain_data_multi_tier` — the lane nothing has ever watched (D124).
DROP TRIGGER IF EXISTS trg_scdmt_auto_refresh_node_list_ins ON public.supply_chain_data_multi_tier;
CREATE TRIGGER trg_scdmt_auto_refresh_node_list_ins
AFTER INSERT ON public.supply_chain_data_multi_tier
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

DROP TRIGGER IF EXISTS trg_scdmt_auto_refresh_node_list_upd ON public.supply_chain_data_multi_tier;
CREATE TRIGGER trg_scdmt_auto_refresh_node_list_upd
AFTER UPDATE ON public.supply_chain_data_multi_tier
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

DROP TRIGGER IF EXISTS trg_scdmt_auto_refresh_node_list_del ON public.supply_chain_data_multi_tier;
CREATE TRIGGER trg_scdmt_auto_refresh_node_list_del
AFTER DELETE ON public.supply_chain_data_multi_tier
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.auto_refresh_node_list_on_lane_change();

-- The old function is left in place rather than dropped: `contract:check` R4 and
-- the introspector both read what migrations CREATE, and a function nothing calls
-- is a smaller risk than a DROP that a later migration's `CREATE OR REPLACE`
-- silently resurrects. Its comment says it is dead so a reader does not wire it
-- back up.
COMMENT ON FUNCTION public.auto_refresh_node_list_on_scd_change() IS
  'DEAD as of WP 8.1 — §4 D135. Read NEW/OLD in a STATEMENT-level trigger, so the '
  'project id was always NULL and this function never refreshed anything between '
  '2025-08-29 and WP 8.1. Replaced by `auto_refresh_node_list_on_lane_change`, '
  'which reads a transition table. Do not attach it to a trigger again.';

-- ── 8 · backfill, so the column is a fact and not a promise ────────────────
--
-- Every existing `node_list` row gets an `echelon`. WP 4.3 shipped
-- `computed_from_hash` nullable and §4 D88 is what that cost: 8 577 derived rows
-- that predate provenance, and a drop nobody can take. A derived column with no
-- backfill is the same shape — a column whose readers must all handle NULL
-- forever — so this one is filled in the migration that adds it.
--
-- `node_type` and `node_group` are RE-derived too, which moves the 65
-- subassemblies from `product` to `material`. That is the one value this file
-- changes, and §4 D119's row says why.
UPDATE public.node_list nl
SET echelon     = e.echelon,
    node_type   = CASE e.echelon WHEN 'subassembly' THEN 'material' ELSE e.echelon END,
    node_group  = initcap(CASE e.echelon WHEN 'subassembly' THEN 'material' ELSE e.echelon END),
    bom_depth   = public.node_bom_depth(nl.project_id, nl.node_id),
    supply_tier = public.node_supply_tier(nl.project_id, nl.node_id)
FROM (
  SELECT id, public.classify_node_echelon(project_id, node_id) AS echelon
    FROM public.node_list
) e
WHERE nl.id = e.id;
