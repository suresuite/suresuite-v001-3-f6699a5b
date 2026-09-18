-- Phase 5 / WP 5.3 / §4 D75 — THE DEEP-TIER GRAPH JOINS THE ANCHOR.
--
-- WP 4.3 found that `current_graph_hash` cannot see the inputs of the two
-- analyses that key on it: it hashes eleven tier-2 tables, and the centrality
-- analyzers read `network_nodes(uid, revenue, name)` and
-- `network_edges(src_uid, dst_uid, relative_revenue)`. Re-upload a network and
-- the anchor does not move, so the store reports a hit and serves the PREVIOUS
-- graph's centralities.
--
-- It mitigated that by carrying `network_topology_hash()` in
-- `analysis_runs.params` as `topology_digest`, declared in the sidecar as an
-- INPUT travelling in a PARAMETER, and said the real fix was a `schema_version`
-- bump WP 4.4 would make safe. This is that fix.
--
-- ── WHY IT IS SAFE TO TAKE NOW, AND THE NUMBERS ARE NOT MINE TO GUESS ──────
--
-- WP 4.1's rule is to COUNT the blast radius before a bump, not after. §15 run
-- `35280849096` did, against every project:
--
--     live proposals grounded on a graph_hash ......... 0
--     proposals already expired for grounding drift ... 0
--     analysis_runs / analysis_results ............... 0 / 0
--
-- So this bump invalidates nothing that exists. It is also the FIRST bump taken
-- after D70 was closed, which is the difference that matters: a hash change is a
-- reversible display state now, so even a non-zero count would have cost a
-- badge rather than a rewritten row.
--
-- ── THE FOLD IS BY COLUMN, NOT BY TIER, AND THAT IS A DEPARTURE ────────────
--
-- §4 D56 and D75 both say the fold happens when WP 5.3 DROPS the computed
-- columns, at which point `network_nodes`'s remainder is a tier-2 input table
-- and the coverage rule pulls it in. **That route is blocked and the number says
-- so**: §15 measured 8 577 of 8 577 derived rows carrying NO input hash, with 0
-- runs and 0 results in the store. Dropping the columns today destroys 8 577
-- values with nothing to replace them (see D88), so the tier change cannot be
-- the vehicle.
--
-- The fold is therefore explicit and by column: the INPUT columns of
-- `network_nodes` and `network_edges` join the `network` domain, and not one
-- computed column does. That is a better rule than the tier proxy anyway —
-- what the invariant actually says is that no analysis OUTPUT may enter the
-- identity of its own inputs, and `graphHashCoverage.test.ts` is changed in the
-- same commit from "these four tables are excluded" (a proxy that would have
-- had to be deleted wholesale) to "no computed column is hashed" (the thing
-- itself).
--
-- ── WHAT IS DELIBERATELY NOT HASHED, COLUMN BY COLUMN ─────────────────────
--
--   network_nodes    uid, revenue                 IN  — the prominence RPC
--                                                      returns exactly these
--                    name                         OUT — cosmetic; `20260703000001`
--                                                      says a rename must never
--                                                      invalidate a run, and the
--                                                      inputs domain excludes it
--                                                      for the same reason
--                    country, industry, website,  OUT — uploaded, read by no
--                    traded_as, number_of_          analysis and by no engine
--                    employees, lat, long,          mapping. Hashing them would
--                    is_seed, depth                 make an unrelated edit cost a
--                                                   full recomputation
--                    prominence, the five          OUT — ANALYSIS OUTPUT. This is
--                    centralities, both             the line the invariant is
--                    *_updated_at, computed_*       about
--
--   network_edges    src_uid, dst_uid,            IN  — the edge RPC returns
--                    relative_revenue                 exactly these
--                    relation_type, depth,        OUT — uploaded, read by no
--                    direction, relative_             analysis
--                    revenue_percentage
--
-- The IN set is exactly what `network_topology_hash` digested, which is exactly
-- what the two prominence RPCs return. Narrower than the tables on purpose: a
-- digest wider than the read turns every unrelated edit into a recomputation,
-- and `supabase/rehearsal/130` §1 already asserts that editing `country` must
-- not move it. `rehearsal/150` re-asserts it against the anchor.
-- ============================================================================

-- ── 1 · `20260917000002`'s builder, under its own name ────────────────────
--
-- FIRST, because a `LANGUAGE sql` body is validated at CREATE time: defining
-- the v3 builder before the function it calls fails with "function
-- _build_dataset_snapshot_v2(uuid) does not exist". plpgsql would have let it
-- through and failed at run time instead, which is the worse of the two.
--
-- THE BODY IS BYTE-IDENTICAL to `20260917000002`'s, extracted from that file
-- rather than retyped — only the function name differs. Restating 200 lines of
-- column list by hand is a transcription slip waiting to happen, and a slip in
-- the `inputs` domain would silently move every project's hash for a reason
-- that has nothing to do with this package.
--
-- It is NOT a fallback: nothing calls it but the v3 builder below. A second
-- snapshot builder anything else could reach is D40's class.
CREATE OR REPLACE FUNCTION public._build_dataset_snapshot_v2(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', 2,

    -- ── the tables a SIMULATION reads ──────────────────────────────────────
    'inputs', jsonb_build_object(
      'suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'supplier_id', s.supplier_id,
          'capacity_per_week', s.capacity_per_week,
          'reliability_score', s.reliability_score
        ) ORDER BY s.supplier_id)
        FROM public.suppliers s WHERE s.project_id = p_project_id
      ), '[]'::jsonb),

      'materials', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'material_id', m.material_id,
          'cost', m.cost,
          'holding_cost_pct', m.holding_cost_pct,
          'moq', m.moq,
          'initial_on_hand', m.initial_on_hand,
          'lead_time_dist', m.lead_time_dist,
          'lead_time_cv', m.lead_time_cv
        ) ORDER BY m.material_id)
        FROM public.materials m WHERE m.project_id = p_project_id
      ), '[]'::jsonb),

      -- `demand_min` / `demand_max` were added to `products` after v1 and
      -- `datamap.py` reads both; without them a triangular or uniform demand
      -- could be re-parameterized without moving the anchor.
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', p.product_id,
          'sell_price', p.sell_price,
          'production_capacity', p.production_capacity,
          'fulfillment_mode', p.fulfillment_mode,
          'demand_distribution', p.demand_distribution,
          'demand_mean', p.demand_mean,
          'demand_cv', p.demand_cv,
          'demand_min', p.demand_min,
          'demand_max', p.demand_max
        ) ORDER BY p.product_id)
        FROM public.products p WHERE p.project_id = p_project_id
      ), '[]'::jsonb),

      -- `customers` has never been hashed and is not read by `datamap.py`
      -- either — `project_map.py` synthesizes a Customer from the ids in
      -- `outbound_logistics` and never loads this table, so P-C.2 always sees
      -- default `segment` and `priority_weight` (§4 D69, WP 6.2). It is hashed
      -- here anyway: it is an INPUT a user typed, the economics are real, and
      -- the day a reader loads it the anchor must already cover it. Under the
      -- old rule it would have been missed exactly as `lead_time_unit` was.
      'customers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'customer_id', c.customer_id,
          'segment', c.segment,
          'priority_weight', c.priority_weight,
          'sla_fill_floor_pct', c.sla_fill_floor_pct
        ) ORDER BY c.customer_id)
        FROM public.customers c WHERE c.project_id = p_project_id
      ), '[]'::jsonb),

      -- `lead_time_unit` (D9/D10): `datamap.py` names it in its projection and
      -- `lead_time` without it is a number whose source a reader has to know
      -- rather than read (§5 T1).
      'inbound', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', il.plant_name,
          'supplier_id', il.supplier_id,
          'material_id', il.material_id,
          'unit_price', il.unit_price,
          'lead_time', il.lead_time,
          'lead_time_unit', il.lead_time_unit,
          'time_unit', il.time_unit,
          'volume', il.volume
        ) ORDER BY il.plant_name, il.supplier_id, il.material_id)
        FROM public.inbound_logistics il WHERE il.project_id = p_project_id
      ), '[]'::jsonb),

      'outbound', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', o.plant_name,
          'customer_id', o.customer_id,
          'product_id', o.product_id,
          'unit_price', o.unit_price,
          'volume', o.volume,
          'time_unit', o.time_unit,
          'expected_lead_time', o.expected_lead_time
        ) ORDER BY o.plant_name, o.customer_id, o.product_id)
        FROM public.outbound_logistics o WHERE o.project_id = p_project_id
      ), '[]'::jsonb),

      'bom', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', b.plant_name,
          'product_id', b.product_id,
          'material_id', b.material_id,
          'consumption_rate', b.consumption_rate
        ) ORDER BY b.plant_name, b.product_id, b.material_id)
        FROM public.bom_single_level b WHERE b.project_id = p_project_id
      ), '[]'::jsonb),

      -- D11 — THE TABLE THE ENGINE PREFERS. `datamap.py` reads
      -- `bom_multi_level` first and falls back to `bom_single_level` only when
      -- it is empty, so on a multi-level project v1 hashed the table the run
      -- did not read.
      'bom_multi_level', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', bm.plant_name,
          'material_id', bm.material_id,
          'higher_level_component_id', bm.higher_level_component_id,
          'level', bm.level,
          'consumption_rate', bm.consumption_rate
        ) ORDER BY bm.plant_name, bm.material_id, bm.higher_level_component_id, bm.level)
        FROM public.bom_multi_level bm WHERE bm.project_id = p_project_id
      ), '[]'::jsonb)
    ),

    -- ── the tables the multi-tier ANALYSES read ────────────────────────────
    -- All three hold ZERO rows in production (§15), so this half is free to add
    -- and UNEXERCISED until somebody uploads one. A green rehearsal on it is
    -- not a working path and must not be reported as one.
    'network', jsonb_build_object(
      'tier2_suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', t.plant_name,
          'supplier_id', t.supplier_id,
          'upstream_supplier_id', t.upstream_supplier_id,
          'material_id', t.material_id,
          'relationship_type', t.relationship_type,
          'volume', t.volume,
          'unit_price', t.unit_price,
          'lead_time', t.lead_time,
          'time_unit', t.time_unit
        ) ORDER BY t.plant_name, t.supplier_id, t.upstream_supplier_id, t.material_id)
        FROM public.tier2_suppliers t WHERE t.project_id = p_project_id
      ), '[]'::jsonb),

      'tier3_suppliers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', t.plant_name,
          'supplier_id', t.supplier_id,
          'upstream_supplier_id', t.upstream_supplier_id,
          'material_id', t.material_id,
          'relationship_type', t.relationship_type,
          'volume', t.volume,
          'unit_price', t.unit_price,
          'lead_time', t.lead_time,
          'time_unit', t.time_unit
        ) ORDER BY t.plant_name, t.supplier_id, t.upstream_supplier_id, t.material_id)
        FROM public.tier3_suppliers t WHERE t.project_id = p_project_id
      ), '[]'::jsonb),

      'multi_tier', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plant_name', mt.plant_name,
          'from_firm_id', mt.from_firm_id,
          'to_firm_id', mt.to_firm_id,
          'to_firm_tier', mt.to_firm_tier,
          'to_firm_relationship', mt.to_firm_relationship
        ) ORDER BY mt.plant_name, mt.from_firm_id, mt.to_firm_id)
        FROM public.multi_tier_supply_chain mt WHERE mt.project_id = p_project_id
      ), '[]'::jsonb)
    )
  );
$$;


-- ── 2 · the snapshot gains two blocks in its `network` domain ─────────────
--
-- THE BASE IS BUILT ONCE, IN A `FROM`, and the first draft of this file got it
-- wrong in the way `20260917000002` warns about in its own comment:
--
--     "Recomputing the snapshot per domain would let a row change between two
--      builds and produce a composite that decomposes into two halves nothing
--      ever held together."
--
-- That draft had `_..._inputs()` and `_..._network()` each calling the v2
-- builder, which is two builds of one snapshot — the exact defect, reintroduced
-- by a refactor whose only purpose was to make this diff readable. One call, in
-- a scalar subquery, and the two domains come out of the same object.

CREATE OR REPLACE FUNCTION public._build_dataset_snapshot(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', 3,
    'inputs', b.base -> 'inputs',
    -- THE FOLD. Exactly the six columns the two prominence RPCs return, and not
    -- one column an analysis writes.
    'network', (b.base -> 'network') || jsonb_build_object(
      'deep_tier_nodes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'uid', n.uid,
          'revenue', n.revenue
        ) ORDER BY n.uid, n.id)
        FROM public.network_nodes n WHERE n.project_id = p_project_id
      ), '[]'::jsonb),
      'deep_tier_edges', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'src_uid', e.src_uid,
          'dst_uid', e.dst_uid,
          'relative_revenue', e.relative_revenue
        ) ORDER BY e.src_uid, e.dst_uid, e.id)
        FROM public.network_edges e WHERE e.project_id = p_project_id
      ), '[]'::jsonb)
    )
  )
  FROM (SELECT public._build_dataset_snapshot_v2(p_project_id) AS base) b;
$$;

COMMENT ON FUNCTION public._build_dataset_snapshot(uuid) IS
  'WP 5.3 · §4 D75. v3: the `network` domain now carries the deep-tier topology '
  'the two centrality analyzers actually read — exactly the six columns '
  '`get_network_nodes_for_prominence` and `get_network_edges_for_prominence` '
  'return, and not one column an analysis writes. Before this, '
  '`current_graph_hash` was blind to those tables, so a re-uploaded network was '
  'served the previous graph''s centralities as a cache hit; WP 4.3 mitigated it '
  'by carrying a digest in `analysis_runs.params` and said this bump was the '
  'real fix. The `inputs` domain is unchanged — `rehearsal/110` is what proves '
  'that, and it is the check a transcription slip in the v2 body would trip.';

-- ── 3 · `network_topology_hash` is DEPRECATED, not dropped ────────────────
--
-- The deployed `calculate-network-science-metrics` and `calculate-node-prominence`
-- still call it until the edge functions redeploy, and migrations and functions
-- deploy through different workflows with no ordering between them — the same
-- window WP 4.3 and WP 4.4 each left a shim for. It keeps working and now
-- returns a digest of the same six columns the anchor holds, so a caller in the
-- window gets a `params` entry that is redundant rather than wrong.

COMMENT ON FUNCTION public.network_topology_hash(uuid) IS
  'DEPRECATED by WP 5.3 (§4 D75). The topology it digests is IN '
  '`current_graph_hash` since `20260917000009`, so a run no longer needs to '
  'carry it in `analysis_runs.params` — the key sees the graph directly. Kept '
  'only for the window in which the deployed edge functions still call it; a '
  'params entry from one of those is redundant, not wrong. Delete it and the '
  '`topology_digest` param with the other deploy-window shims.';

SELECT pg_notify('pgrst', 'reload schema');
