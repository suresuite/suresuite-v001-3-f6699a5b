-- Phase 14 / WP 14.4 / G20 §5.2 · §4 D284 (d) · engine RFC 4 · gates `single-source`,
-- `no-tier-skip`, `natural-key`, `page-equals-run`
-- THE FINISHED-GOODS POLICY PER PRODUCT, AND FG OPENING STOCK: THE DATA HALF.
--
-- Engine 0.5.0 makes `Product.fg_policy` real (base-stock S · min-max s, S · days
-- of cover D) and gives an MTS product an FG opening stock (RFC 4). This migration
-- gives the five values a home on `products` — the product master, keyed
-- (project_id, product_id), which is the engine's product — and puts them in the
-- snapshot a run computes from (the simulation scope, `hash_inputs`).
--
-- ── 1 · WHY `products`, AND WHY NOW (RFC 4's own order) ─────────────────────
--
-- §14 RFC 4 said the capability comes first and the column follows it, because a
-- column nothing fills is what `seeded_from_hash` cost. Engine 0.5.0 is the
-- capability (`_initialize_state` starts an MTS product at `fg_initial_on_hand`),
-- so the column lands now, in the package that reads it.
--
-- All five are NULLABLE with no DEFAULT: an empty `fg_policy` is base-stock with
-- today's derived target, and an empty level is "not stated", never 0 — a
-- reader that coerced an empty S to 0 would plan to hold no stock at all.
-- `fg_cover_days` is DAYS and is not converted: the engine divides by 7 itself
-- (target = D/7 × projected weekly demand); the levels are units, not rates.
--
-- ── 2 · THE SNAPSHOT — AND WHY NO EXISTING HASH MOVES ──────────────────────
--
-- The products block appends the five through `jsonb_strip_nulls`, the route
-- WP 14.2 took for the outbound demand fields: a product that states none
-- serializes exactly as before, so no project's `hash_inputs` moves until it
-- sets one. `schema_version` stays 3 for the reason `20261001000007` gave.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fg_policy text,
  ADD COLUMN IF NOT EXISTS fg_base_stock numeric,
  ADD COLUMN IF NOT EXISTS fg_reorder_point numeric,
  ADD COLUMN IF NOT EXISTS fg_cover_days numeric,
  ADD COLUMN IF NOT EXISTS fg_initial_on_hand numeric;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_fg_policy_check,
  ADD CONSTRAINT products_fg_policy_check
    CHECK (fg_policy IS NULL OR fg_policy IN ('base_stock', 'min_max', 'days_of_cover')),
  DROP CONSTRAINT IF EXISTS products_fg_levels_nonnegative,
  ADD CONSTRAINT products_fg_levels_nonnegative
    CHECK (coalesce(fg_base_stock, 0) >= 0 AND coalesce(fg_reorder_point, 0) >= 0
           AND coalesce(fg_cover_days, 0) >= 0 AND coalesce(fg_initial_on_hand, 0) >= 0);

COMMENT ON COLUMN public.products.fg_policy IS
  'MTS finished-goods policy: base_stock (S) | min_max (s, S) | days_of_cover (D). NULL = base_stock with the derived target (PLAN.md §24 WP 14.4).';
COMMENT ON COLUMN public.products.fg_initial_on_hand IS
  'FG opening stock in units (engine RFC 4). NULL = the run starts at the policy target.';

-- ── 3 · the snapshot: the five join the simulation scope ────────────────────
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
        )
        -- WP 14.4: the FG policy and levels, only where a product states them,
        -- so a project that sets none keeps its snapshot text and its hash.
        || jsonb_strip_nulls(jsonb_build_object(
          'fg_policy', p.fg_policy,
          'fg_base_stock', p.fg_base_stock,
          'fg_reorder_point', p.fg_reorder_point,
          'fg_cover_days', p.fg_cover_days,
          'fg_initial_on_hand', p.fg_initial_on_hand
        )) ORDER BY p.product_id)
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
        )
        -- WP 14.2 (§24, D284 b): the row's own demand spec. NULL-stripped so a
        -- row that sets none hashes exactly as it did before this migration —
        -- no project's `hash_inputs` moves until it uploads a spec.
        || jsonb_strip_nulls(jsonb_build_object(
          'demand_distribution', o.demand_distribution,
          'demand_mean', o.demand_mean,
          'demand_variation', o.demand_variation,
          'demand_min', o.demand_min,
          'demand_max', o.demand_max
        )) ORDER BY o.plant_name, o.customer_id, o.product_id)
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
    )
    -- WP 14.2 (§24, D284 b): the forecast series per customer × product row,
    -- one element per uploaded bucket. PRESENT ONLY WHEN THE PROJECT HAS ONE
    -- (`HAVING count(*) > 0`): a project with no forecast keeps its snapshot,
    -- and so its `hash_inputs` and every binding on it, byte for byte.
    || COALESCE((
        SELECT jsonb_build_object('demand_forecasts', jsonb_agg(jsonb_build_object(
          'customer_id', f.customer_id,
          'product_id', f.product_id,
          'period_start', f.period_start,
          'time_unit', f.time_unit,
          'quantity', f.quantity,
          'period_end', f.period_end,
          'weekly_quantity', f.weekly_quantity
        ) ORDER BY f.customer_id, f.product_id, f.period_start))
        FROM public.demand_forecasts f WHERE f.project_id = p_project_id
        HAVING count(*) > 0
      ), '{}'::jsonb),

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
