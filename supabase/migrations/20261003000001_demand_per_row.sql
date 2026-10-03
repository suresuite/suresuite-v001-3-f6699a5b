-- Phase 14 / WP 14.2 / G20 §8.3 · §4 D284 (b) · gates `single-source`, `no-tier-skip`,
-- `normalize-at-promotion`, `natural-key`, `audit-actor`, `page-equals-run`
-- DEMAND PER CUSTOMER × PRODUCT ROW: THE DATA HALF.
--
-- WP 14.1 taught the engine to draw demand per customer × product row from a spec
-- (a distribution + mean + variation, or a forecast series). This migration gives
-- the spec a home, a way in, and a place in the snapshot a run computes from.
--
-- ── 1 · WHERE THE ROW SPEC LIVES: ON `outbound_logistics` ──────────────────
--
-- The plan's default, and the evidence decides it: `outbound_logistics`' natural
-- key is (project_id, plant_name, customer_id, product_id) — exactly one row per
-- customer × product in a project's one plant, which is the engine's row. A second
-- table keyed the same way would be a second author for the row's identity, and a
-- join that can disagree with the lane it describes (`single-source`, I1).
--
-- `demand_mean` / `demand_min` / `demand_max` are RATES in the row's `time_unit`,
-- like `volume`, and normalize to weeks AT PROMOTION by the same rule
-- (`ingest_normalize_at_promotion`, invariant I3). `demand_variation` is
-- dimensionless and is read by the distribution: a CV for `normal`, the ± fraction
-- for `triangular_av`.
--
-- ── 2 · THE FORECAST SERIES: `demand_forecasts` ────────────────────────────
--
-- One row per uploaded BUCKET: (customer, product, period_start) → quantity over
-- that bucket, `time_unit` week or month. Decision 7 (a monthly forecast is spread
-- evenly over its weeks) is applied AT PROMOTION, by a BEFORE trigger in the
-- promoting statement: `period_end` is the bucket's exclusive end and
-- `weekly_quantity` its quantity spread evenly over its own days × 7 — so November
-- (30 days) spreads 1 000 as 233.33/wk and December (31 days) as 225.81/wk. The
-- generic `rate` conversion was NOT used: it rewrites `time_unit` to `week`, and a
-- reader would then no longer know how long the bucket is.
--
-- WHICH SIMULATED WEEK A DATE IS (design doc §9, point 4): week 0 is the project's
-- EARLIEST `period_start`; simulated week w covers days [w·7, w·7 + 7) after it,
-- and its forecast is the sum over those seven days of each covering bucket's daily
-- rate. A day no bucket covers contributes nothing — the run's pre-run check warns
-- when a row's buckets leave a gap or end before the horizon. Applied by the
-- reader (`sim_worker/datamap.py::forecast_series`), which converts nothing: every
-- quantity it reads is already a weekly rate.
--
-- ── 3 · THE SNAPSHOT — AND WHY NO EXISTING HASH MOVES ──────────────────────
--
-- Both join the `inputs` domain (the simulation scope, WP 11.2): the engine newly
-- reads them, and a run bound to a dataset version must be bound to them too. Both
-- are added so that a project with neither keeps its snapshot TEXT unchanged — the
-- outbound fields NULL-stripped, the forecast key present only when the project has
-- a forecast. `schema_version` stays 3 for the same reason `20261001000007` gave:
-- a bump folds into the composite and would read every validated card as drift for
-- a change that added no fact to that project.
-- ============================================================================

-- ── 1 · the row spec on outbound_logistics ───────────────────────────────

ALTER TABLE public.outbound_logistics
  ADD COLUMN IF NOT EXISTS demand_distribution text,
  ADD COLUMN IF NOT EXISTS demand_mean         numeric,
  ADD COLUMN IF NOT EXISTS demand_variation    numeric,
  ADD COLUMN IF NOT EXISTS demand_min          numeric,
  ADD COLUMN IF NOT EXISTS demand_max          numeric;

ALTER TABLE public.outbound_logistics DROP CONSTRAINT IF EXISTS outbound_logistics_demand_spec_check;
ALTER TABLE public.outbound_logistics ADD CONSTRAINT outbound_logistics_demand_spec_check CHECK (
  (demand_distribution IS NULL
     OR demand_distribution IN ('deterministic', 'normal', 'triangular', 'triangular_av', 'poisson'))
  AND (demand_mean IS NULL OR demand_mean >= 0)
  AND (demand_variation IS NULL OR demand_variation >= 0)
  AND (demand_min IS NULL OR demand_min >= 0)
  AND (demand_max IS NULL OR demand_max >= 0)
);

COMMENT ON COLUMN public.outbound_logistics.demand_distribution IS
  'WP 14.2 · the row''s own demand distribution (deterministic, normal, triangular, '
  'triangular_av, poisson). NULL: the row takes its product''s distribution, scaled '
  'by its share of the product''s volume.';
COMMENT ON COLUMN public.outbound_logistics.demand_mean IS
  'WP 14.2 · the row''s mean demand (the mode for triangular), per `time_unit`; '
  'weekly after promotion.';
COMMENT ON COLUMN public.outbound_logistics.demand_variation IS
  'WP 14.2 · read by the distribution: the coefficient of variation for normal, the '
  '± fraction for triangular_av; ignored otherwise.';
COMMENT ON COLUMN public.outbound_logistics.demand_min IS
  'WP 14.2 · triangular only: the lower bound, per `time_unit`; weekly after promotion.';
COMMENT ON COLUMN public.outbound_logistics.demand_max IS
  'WP 14.2 · triangular only: the upper bound, per `time_unit`; weekly after promotion.';

-- ── 2 · the forecast table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.demand_forecasts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  customer_id     text        NOT NULL,
  product_id      text        NOT NULL,
  period_start    date        NOT NULL,
  time_unit       text,
  quantity        numeric     NOT NULL CHECK (quantity >= 0),
  period_end      date,
  weekly_quantity numeric,
  ingest_run_id   uuid        REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  source_row_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_forecasts_time_unit_check
    CHECK (time_unit IS NULL OR lower(time_unit) IN ('week', 'month'))
);

-- The natural key. Every column is NOT NULL, so `NULLS NOT DISTINCT` changes
-- nothing today; it is declared anyway so the day a key column becomes nullable
-- the arbiter does not silently start inserting duplicates (§4 D5).
CREATE UNIQUE INDEX IF NOT EXISTS demand_forecasts_natural_key
  ON public.demand_forecasts (project_id, customer_id, product_id, period_start)
  NULLS NOT DISTINCT;

ALTER TABLE public.demand_forecasts DROP CONSTRAINT IF EXISTS demand_forecasts_source_row_fk;
ALTER TABLE public.demand_forecasts
  ADD CONSTRAINT demand_forecasts_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- Decision 7, applied in the promoting statement (and by every other writer).
CREATE OR REPLACE FUNCTION public.demand_forecast_spread()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_unit text := lower(COALESCE(NULLIF(btrim(NEW.time_unit), ''), 'week'));
BEGIN
  IF v_unit = 'week' THEN
    NEW.period_end := NEW.period_start + 7;
  ELSIF v_unit = 'month' THEN
    NEW.period_end := (NEW.period_start + interval '1 month')::date;
  ELSE
    RAISE EXCEPTION 'demand_forecasts: time_unit % is neither week nor month', NEW.time_unit
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.weekly_quantity := NEW.quantity * 7.0 / (NEW.period_end - NEW.period_start);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $fn$;

COMMENT ON FUNCTION public.demand_forecast_spread() IS
  'Phase 14 / WP 14.2 (ADR 0002 decision 7) — a forecast bucket''s quantity spread '
  'evenly over its own days: period_end = start + 1 week or + 1 calendar month '
  '(exclusive), weekly_quantity = quantity × 7 / days. Runs in the promoting '
  'statement, so the tier-2 row states its weekly rate (invariant I3).';

DROP TRIGGER IF EXISTS demand_forecasts_spread ON public.demand_forecasts;
CREATE TRIGGER demand_forecasts_spread BEFORE INSERT OR UPDATE ON public.demand_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.demand_forecast_spread();

COMMENT ON TABLE public.demand_forecasts IS
  'Phase 14 / WP 14.2 — the demand forecast per customer × product, one row per '
  'uploaded bucket (a week or a month). The plan reads it as the centre of the '
  'row''s weekly demand; the world draws around it. Lands through the ingestion '
  'contract and is promoted by ingest_apply_run; spread to a weekly rate at '
  'promotion (demand_forecast_spread).';

-- Who may read and write it. NO `*_anon_read` policy, deliberately: §4 D28's list
-- of unconditional policies is meant to shrink, and nothing needs one here — the
-- run reads through the snapshot (SECURITY DEFINER), the worker as service role,
-- and /policies through `get_project_demand_forecasts` below, which takes its
-- caller explicitly the way `get_project_datasets` does. Writes: the project's
-- modeler or an admin, as on `customers`.
ALTER TABLE public.demand_forecasts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_forecasts TO authenticated;
GRANT ALL ON public.demand_forecasts TO service_role;

DROP POLICY IF EXISTS "Demand forecasts: modifiers only" ON public.demand_forecasts;
CREATE POLICY "Demand forecasts: modifiers only" ON public.demand_forecasts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = demand_forecasts.project_id
               AND public.org_is_current_user_org(p.organization_id, p.organization)
               AND (p.modeler_id = public.get_current_user_id()
                    OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p
             WHERE p.id = demand_forecasts.project_id
               AND public.org_is_current_user_org(p.organization_id, p.organization)
               AND (p.modeler_id = public.get_current_user_id()
                    OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
  );

-- The grid's read: the project's forecast buckets for a member of its
-- organization, the authorization `get_project_datasets` applies.
CREATE OR REPLACE FUNCTION public.get_project_demand_forecasts(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_org text;
  v_org_id uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  SELECT organization, organization_id INTO v_org, v_org_id
    FROM public.projects WHERE id = p_project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'customer_id', f.customer_id, 'product_id', f.product_id,
      'period_start', f.period_start, 'period_end', f.period_end,
      'time_unit', f.time_unit, 'quantity', f.quantity,
      'weekly_quantity', f.weekly_quantity
    ) ORDER BY f.customer_id, f.product_id, f.period_start)
    FROM public.demand_forecasts f WHERE f.project_id = p_project_id
  ), '[]'::jsonb);
END; $fn$;

COMMENT ON FUNCTION public.get_project_demand_forecasts(uuid, uuid, text) IS
  'Phase 14 / WP 14.2 — the project''s forecast buckets for /policies and the Data '
  'map, read with the caller named (the app authenticates against approved_users). '
  'The table has no anon policy: D28''s list shrinks, it does not grow.';

-- The tier-2 audit (gate `audit-actor`): one row per statement, naming the actor
-- the promotion sets (`ingest_apply_run` takes it as a parameter).
DROP TRIGGER IF EXISTS audit_demand_forecasts_insert ON public.demand_forecasts;
CREATE TRIGGER audit_demand_forecasts_insert AFTER INSERT ON public.demand_forecasts
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_demand_forecasts_update ON public.demand_forecasts;
CREATE TRIGGER audit_demand_forecasts_update AFTER UPDATE ON public.demand_forecasts
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');
DROP TRIGGER IF EXISTS audit_demand_forecasts_delete ON public.demand_forecasts;
CREATE TRIGGER audit_demand_forecasts_delete AFTER DELETE ON public.demand_forecasts
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('2');

-- The stored current hash (WP 10.1): a hashed table marks its project's graph
-- state dirty on every write, or a run would bind a hash of the world before the
-- forecast changed.
DROP TRIGGER IF EXISTS graph_state_touch_ins ON public.demand_forecasts;
CREATE TRIGGER graph_state_touch_ins AFTER INSERT ON public.demand_forecasts
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_ins();
DROP TRIGGER IF EXISTS graph_state_touch_upd ON public.demand_forecasts;
CREATE TRIGGER graph_state_touch_upd AFTER UPDATE ON public.demand_forecasts
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_upd();
DROP TRIGGER IF EXISTS graph_state_touch_del ON public.demand_forecasts;
CREATE TRIGGER graph_state_touch_del AFTER DELETE ON public.demand_forecasts
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public._graph_state_touch_del();

-- ── 3 · the eleventh promotable target ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable(_target_table text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _target_table IN (
    'bom_multi_level',
    'bom_single_level',
    'customers',
    'demand_forecasts',
    'inbound_logistics',
    'materials',
    'outbound_logistics',
    'products',
    'suppliers',
    'tier2_suppliers',
    'tier3_suppliers');
$$;

COMMENT ON FUNCTION public.ingest_target_is_promotable(text) IS
  'Phase 14 / WP 14.2 — the ELEVEN tables a staged row may be promoted into; '
  '`demand_forecasts` joined for the per-row forecast series (§4 D284 b). The list '
  'is in SQL because the promotion builds dynamic SQL and a target name from a '
  'caller is an injection; the TypeScript half is generated from the same sidecars '
  'and ingestSpecParity.test.ts holds the two together.';

-- ── 4 · the row spec's rates normalize at promotion (I3) ──────────────────

CREATE OR REPLACE FUNCTION public.ingest_normalize_at_promotion(_target text)
RETURNS TABLE (column_name text, unit_column text, conversion text, canonical text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT n.column_name, n.unit_column, n.conversion, n.canonical FROM (VALUES
    ('inbound_logistics',  'lead_time',   'lead_time_unit', 'duration', 'week'),
    ('inbound_logistics',  'volume',      'time_unit',      'rate',     'week'),
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
  'time_unit as its volume.';

-- ── 5 · the snapshot: both join the simulation scope ──────────────────────
--
-- The v2 body below is `20260917000009`'s, with exactly two additions, each
-- marked WP 14.2. `rehearsal/790` proves a project with neither keeps its
-- snapshot text — and so its hash — unchanged.

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

-- ── 6 · a wrong forecast upload can be removed ─────────────────────────────
--
-- The project data viewer's per-dataset delete (`20261001000024`, §4 D266)
-- learns the forecast: its own `demand_forecasts` branch, and the `all` branch
-- empties it too. The body is `20261001000024`'s with exactly those two
-- additions, each marked; authorization is unchanged.

CREATE OR REPLACE FUNCTION public.delete_project_dataset(
  p_project_id uuid,
  p_dataset text,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_org_id uuid;
  v_bom_level text;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  temp_count integer;
BEGIN
  -- Ensure this function has the correct caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, organization_id, bom_level, modeler_id
  INTO v_org, v_org_id, v_bom_level, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF NOT public.org_is_current_user_org(v_org_id, v_org) OR NOT (v_modeler = public.get_current_user_id() OR v_role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF lower(p_dataset) = 'inbound' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'outbound' THEN
    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'demand_forecasts' THEN
    -- PLAN.md §24 WP 14.2 — the per-row forecast buckets.
    DELETE FROM public.demand_forecasts WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('multitier','multi_tier') THEN
    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'bom' THEN
    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
    END IF;
  ELSIF lower(p_dataset) IN ('network_nodes','deep_nodes') THEN
    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_edges','deep_edges') THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) IN ('network_summary','deep_summary') THEN
    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'deep_tier' THEN
    DELETE FROM public.network_edges WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;

    DELETE FROM public.network_nodes WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.network_summary WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;
  ELSIF lower(p_dataset) = 'node_list_uploads' THEN
    UPDATE public.node_list
       SET description_text = NULL,
           location_text    = NULL,
           latitude         = NULL,
           longitude        = NULL,
           updated_at       = now()
     WHERE project_id = p_project_id
       AND (description_text IS NOT NULL OR location_text IS NOT NULL
            OR latitude IS NOT NULL OR longitude IS NOT NULL);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  ELSIF lower(p_dataset) = 'all' THEN
    DELETE FROM public.inbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := temp_count;

    DELETE FROM public.outbound_logistics WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    DELETE FROM public.demand_forecasts WHERE project_id = p_project_id;
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    deleted_count := deleted_count + temp_count;

    IF v_bom_level = 'single' THEN
      DELETE FROM public.bom_single_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    ELSE
      DELETE FROM public.bom_multi_level WHERE project_id = p_project_id;
      GET DIAGNOSTICS temp_count = ROW_COUNT;
      deleted_count := deleted_count + temp_count;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_dataset';
  END IF;

  RETURN deleted_count;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
