-- Phase 16 / WP 16.5 / §5 P-P.13 · §4 D300 · gates `normalize-at-promotion`,
-- `single-source`, `page-equals-run`
-- A PRODUCT'S PRODUCTION LEAD TIME: THE DATA HALF.
--
-- Engine 0.8.0 (WP 16.4) completes a product's output L weeks after it starts
-- (P-P.13), L = 0 by default. This migration gives L and its shape a home on
-- `products` — the product master, keyed (project_id, product_id) — and puts them
-- in the snapshot a run computes from (the simulation scope, `hash_inputs`).
--
-- ── 1 · THE COLUMNS ──────────────────────────────────────────────────────────
--
-- All seven are NULLABLE with no DEFAULT: an empty `production_lead_time` is 0 —
-- the product completes in the week it starts, as every product did before —
-- and an empty shape is deterministic. The lead time and its three bounds are
-- DURATIONS in `production_lead_time_unit` (day, week, …; blank = weeks — the
-- convention `inbound_logistics.lead_time_unit` set) and normalize to weeks at
-- promotion (invariant I3), so a file quoting days lands in weeks and says so.
-- One CHECK: the unit is one `unit_days()` knows, the shape is one of the six,
-- the CV is 0–1, every duration is ≥ 0 and the bounds are in order (they share
-- one unit, so the order holds before and after conversion).
--
-- ── 2 · THE SNAPSHOT — AND WHY NO EXISTING HASH MOVES ──────────────────────
--
-- The products block appends the seven through `jsonb_strip_nulls`, the route
-- WP 14.2, 14.4 and 15.2 took: a product that states none serializes exactly as
-- before. `schema_version` stays where `20261001000007` left it.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS production_lead_time      numeric,
  ADD COLUMN IF NOT EXISTS production_lead_time_unit text,
  ADD COLUMN IF NOT EXISTS production_lead_time_dist text,
  ADD COLUMN IF NOT EXISTS production_lead_time_cv   numeric,
  ADD COLUMN IF NOT EXISTS production_lead_time_min  numeric,
  ADD COLUMN IF NOT EXISTS production_lead_time_mode numeric,
  ADD COLUMN IF NOT EXISTS production_lead_time_max  numeric;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_production_lead_time_check;
ALTER TABLE public.products ADD CONSTRAINT products_production_lead_time_check CHECK (
  (production_lead_time_unit IS NULL OR public.unit_days(production_lead_time_unit) IS NOT NULL)
  AND (production_lead_time_dist IS NULL
       OR production_lead_time_dist IN ('deterministic', 'normal', 'lognormal', 'gamma', 'triangular', 'uniform'))
  AND (production_lead_time_cv IS NULL OR (production_lead_time_cv >= 0 AND production_lead_time_cv <= 1))
  AND coalesce(production_lead_time, 0) >= 0
  AND coalesce(production_lead_time_min, 0) >= 0
  AND coalesce(production_lead_time_mode, 0) >= 0
  AND coalesce(production_lead_time_max, 0) >= 0
  AND (production_lead_time_min IS NULL OR production_lead_time_mode IS NULL
       OR production_lead_time_min <= production_lead_time_mode)
  AND (production_lead_time_mode IS NULL OR production_lead_time_max IS NULL
       OR production_lead_time_mode <= production_lead_time_max)
  AND (production_lead_time_min IS NULL OR production_lead_time_max IS NULL
       OR production_lead_time_min <= production_lead_time_max)
);

COMMENT ON COLUMN public.products.production_lead_time IS
  'WP 16.5 · P-P.13: weeks from the start of production to the finished good, in '
  '`production_lead_time_unit`; weeks after promotion. NULL = 0 (completes in the week it starts).';
COMMENT ON COLUMN public.products.production_lead_time_unit IS
  'WP 16.5 · the unit of production_lead_time and its bounds (day, week, …). NULL = weeks.';
COMMENT ON COLUMN public.products.production_lead_time_dist IS
  'WP 16.5 · the production lead time''s shape: deterministic, normal, lognormal, gamma, '
  'triangular or uniform. NULL = deterministic.';
COMMENT ON COLUMN public.products.production_lead_time_cv IS
  'WP 16.5 · coefficient of variation (0–1) for normal, lognormal and gamma.';
COMMENT ON COLUMN public.products.production_lead_time_min IS
  'WP 16.5 · triangular and uniform: the lower bound, in production_lead_time_unit.';
COMMENT ON COLUMN public.products.production_lead_time_mode IS
  'WP 16.5 · triangular: the most likely value, in production_lead_time_unit.';
COMMENT ON COLUMN public.products.production_lead_time_max IS
  'WP 16.5 · triangular and uniform: the upper bound, in production_lead_time_unit.';

-- ── 3 · the durations normalize at promotion (I3) ───────────────────────────
CREATE OR REPLACE FUNCTION public.ingest_normalize_at_promotion(_target text)
RETURNS TABLE (column_name text, unit_column text, conversion text, canonical text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT n.column_name, n.unit_column, n.conversion, n.canonical FROM (VALUES
    ('inbound_logistics',  'lead_time',   'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'lead_time_max',  'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'lead_time_min',  'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'lead_time_mode', 'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'volume',      'time_unit',      'rate',     'week'),
    ('products',           'production_lead_time',      'production_lead_time_unit', 'duration', 'week'),
    ('products',           'production_lead_time_max',  'production_lead_time_unit', 'duration', 'week'),
    ('products',           'production_lead_time_min',  'production_lead_time_unit', 'duration', 'week'),
    ('products',           'production_lead_time_mode', 'production_lead_time_unit', 'duration', 'week'),
    ('outbound_logistics', 'demand_max',  'time_unit',      'rate',     'week'),
    ('outbound_logistics', 'demand_mean', 'time_unit',      'rate',     'week'),
    ('outbound_logistics', 'demand_min',  'time_unit',      'rate',     'week'),
    ('outbound_logistics', 'volume',      'time_unit',      'rate',     'week'),
    ('tier2_suppliers',    'volume',      'time_unit',      'rate',     'week'),
    ('tier3_suppliers',    'volume',      'time_unit',      'rate',     'week')
  ) AS n(target, column_name, unit_column, conversion, canonical)
  WHERE n.target = _target;
$$;

COMMENT ON FUNCTION public.ingest_normalize_at_promotion(text) IS
  'Phase 3 / WP 3.3 — the unit conversions ingest_apply_run applies as it '
  'promotes (invariant I3). Authored in the sidecars (`unit_column` + '
  '`normalize_at_promotion`); restated here because SQL cannot import the '
  'generated module, and pinned to it by ingestSpecParity.test.ts. WP 14.2 added '
  'the outbound row''s demand_mean / demand_min / demand_max, rates in the same '
  'time_unit as its volume; WP 16.2 the inbound lane''s lead_time_min / _mode / '
  '_max, durations in the same lead_time_unit as its lead_time; WP 16.5 the '
  'product''s production_lead_time and its bounds, in production_lead_time_unit.';

-- ── 4 · the snapshot: the production lead time joins the simulation scope ───
--
-- The v2 body below is `20261004000003`'s with one addition, marked WP 16.5.
-- `rehearsal/850` proves a product with none keeps its snapshot text.

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
          'fg_initial_on_hand', p.fg_initial_on_hand,
          -- WP 16.5 (§26, D300): the production lead time and its shape, only
          -- where a product states them — no existing hash moves.
          'production_lead_time', p.production_lead_time,
          -- The unit only beside a duration it qualifies: the promotion stamps the
          -- canonical `week` onto EVERY row of a run that carries the column, and a
          -- product that states no production lead time must keep its hash.
          'production_lead_time_unit', CASE
            WHEN coalesce(p.production_lead_time, p.production_lead_time_min,
                          p.production_lead_time_mode, p.production_lead_time_max) IS NOT NULL
            THEN p.production_lead_time_unit END,
          'production_lead_time_dist', p.production_lead_time_dist,
          'production_lead_time_cv', p.production_lead_time_cv,
          'production_lead_time_min', p.production_lead_time_min,
          'production_lead_time_mode', p.production_lead_time_mode,
          'production_lead_time_max', p.production_lead_time_max
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
        )
        -- WP 16.2 (§26, D299): the lane's own lead-time spread, only where a
        -- lane states one, so a project that sets none keeps its snapshot text
        -- and its `hash_inputs`.
        || jsonb_strip_nulls(jsonb_build_object(
          'lead_time_dist', il.lead_time_dist,
          'lead_time_cv', il.lead_time_cv,
          'lead_time_min', il.lead_time_min,
          'lead_time_mode', il.lead_time_mode,
          'lead_time_max', il.lead_time_max
        )) ORDER BY il.plant_name, il.supplier_id, il.material_id)
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
