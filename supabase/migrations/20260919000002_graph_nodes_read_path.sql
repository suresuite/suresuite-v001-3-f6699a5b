-- Phase 8 / WP 8.3 / §2.3 G1 — THE READ PATH FOR THE TYPE THAT IS NOW AUTHORED.
--
-- WP 8.1 authored a node's echelon once, in `node_list`. This file is the finding
-- that came with trying to READ it: **no client can.**
--
-- `get_node_list` — the only route to that table from the application — has a fixed
-- `RETURNS TABLE(...)` listing seventeen columns by name. The three WP 8.1 added are
-- not among them, and `CREATE OR REPLACE FUNCTION` cannot change a function's return
-- type. So a column that exists, is backfilled, is CHECK-constrained and is derived
-- by one rule was invisible to every page in the product.
--
-- That is worth stating as a class rather than as an incident: **a fixed
-- `RETURNS TABLE` is a second place the schema is authored**, and it goes stale the
-- moment a migration widens the table. `single-source` (I1) is about a fact
-- authored twice, and this is one — in SQL rather than in markdown, which is the
-- same blind spot D101 and D105 came out of.
--
-- ── WHY A NEW FUNCTION AND NOT A WIDER `get_node_list` ─────────────────────
--
-- Because widening it means DROP and CREATE, and `20260918000003` is the record of
-- what that costs: a DROP takes the function's grants with it, and
-- `supabase/rehearsal/210` §2 had to check every role back as an EXPLICIT grantee
-- in `proacl` because `has_function_privilege` cannot fail while PUBLIC keeps
-- EXECUTE. `get_node_list` has four live callers in `src/`. Spending that risk to
-- add three columns nothing reads yet is the wrong trade, and an additive function
-- makes the migration of each caller a separate, revertible change.
--
-- `get_graph_nodes` returns what the GRAPH LAYER needs and nothing else: identity,
-- the echelon, the two measurements, and the geocode the map already uses. It does
-- NOT return the criticality prediction — that is analysis output, it belongs to a
-- run, and a page that wants it should ask the analysis store for it (WP 6.3's A5
-- record), not read it off an entity row (§4 D19).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_graph_nodes(
  p_project_id uuid,
  p_user_id    uuid,
  p_user_email text
)
RETURNS TABLE(
  node_id     text,
  echelon     text,
  node_type   text,
  bom_depth   integer,
  supply_tier integer,
  plant_name  text,
  label       text,
  location_text text,
  longitude   numeric,
  latitude    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- The same context call every reader in this schema makes, so RLS answers for the
  -- named user. This function READS and writes nothing, so there is no audit row to
  -- name an actor in — `audit-actor` (G4) is about writes.
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT
    nl.node_id,
    nl.echelon,
    nl.node_type,
    nl.bom_depth,
    nl.supply_tier,
    nl.plant_name,
    -- `label` is the id today, because `node_list` carries no display name. It is a
    -- SEPARATE column rather than the page falling back to the id, so the day a
    -- name lands there is one place to change and no page has to know.
    nl.node_id AS label,
    nl.location_text,
    nl.longitude,
    nl.latitude
  FROM public.node_list nl
  WHERE nl.project_id = p_project_id
  -- Ordered by the ECHELON as the chain runs, then by depth, then by id — so a page
  -- that renders in receive order renders the chain in order, and the ordering rule
  -- lives here rather than being re-derived in four components. `unknown` and NULL
  -- sort LAST and together: both mean the data does not place this node, and putting
  -- them anywhere else in the sequence would imply a position (T1).
  ORDER BY CASE COALESCE(nl.echelon, 'unknown')
             WHEN 'supplier'    THEN 0
             WHEN 'material'    THEN 1
             WHEN 'subassembly' THEN 2
             WHEN 'plant'       THEN 3
             WHEN 'product'     THEN 4
             WHEN 'customer'    THEN 5
             ELSE 6
           END,
           nl.bom_depth NULLS FIRST,
           nl.node_id;
END;
$function$;

COMMENT ON FUNCTION public.get_graph_nodes(uuid, uuid, text) IS
  'WP 8.3 · §4 D112. The read path for `node_list.echelon` / `bom_depth` / '
  '`supply_tier`. It exists because `get_node_list`''s fixed RETURNS TABLE could '
  'not carry them and `CREATE OR REPLACE` cannot change a return type — so a '
  'column that was authored, backfilled and constrained was invisible to every '
  'page. Additive rather than a DROP of `get_node_list`, which has four live '
  'callers and whose grants a DROP would take with it (`20260918000003`).';

REVOKE ALL ON FUNCTION public.get_graph_nodes(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_graph_nodes(uuid, uuid, text) TO anon, authenticated, service_role;
