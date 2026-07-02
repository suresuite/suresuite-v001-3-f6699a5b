-- Phase A / G4 / §8.3 — write RPCs for the item-master tables.
--
-- The app uses a custom auth system and the Supabase client always holds an
-- anon JWT, and 20260614000001_item_master.sql granted anon SELECT only.
-- Writes therefore go through SECURITY DEFINER RPCs, the same pattern as
-- policy_write_rpcs (save_policy_defaults / bulk_upsert_policy_overrides).
--
-- Semantics: full-row upsert of the economics columns keyed on
-- (project_id, <id>). A NULL in the payload clears the stored value — the
-- grid and the CSV template always carry the complete column set, so what
-- you upload is what you get. Enum columns are validated against the values
-- the scsim engine accepts (scsim/scsim/io/project_map.py): rejecting bad
-- values here beats a hard error at simulation compile time.

CREATE OR REPLACE FUNCTION public.bulk_upsert_materials(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_bad   text;
  v_count integer;
BEGIN
  SELECT r->>'lead_time_dist' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'lead_time_dist', '') IS NOT NULL
    AND r->>'lead_time_dist' NOT IN ('deterministic', 'lognormal', 'gamma')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid lead_time_dist "%" — engine accepts: deterministic, lognormal, gamma', v_bad;
  END IF;

  INSERT INTO public.materials
    (project_id, material_id, name, cost, holding_cost_pct, moq,
     initial_on_hand, lead_time_dist, lead_time_cv, updated_at)
  SELECT
    p_project_id,
    r->>'material_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'cost', '')::numeric,
    NULLIF(r->>'holding_cost_pct', '')::numeric,
    NULLIF(r->>'moq', '')::numeric,
    NULLIF(r->>'initial_on_hand', '')::numeric,
    NULLIF(r->>'lead_time_dist', ''),
    NULLIF(r->>'lead_time_cv', '')::numeric,
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'material_id', '') IS NOT NULL
  ON CONFLICT (project_id, material_id) DO UPDATE SET
    name             = excluded.name,
    cost             = excluded.cost,
    holding_cost_pct = excluded.holding_cost_pct,
    moq              = excluded.moq,
    initial_on_hand  = excluded.initial_on_hand,
    lead_time_dist   = excluded.lead_time_dist,
    lead_time_cv     = excluded.lead_time_cv,
    updated_at       = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_materials TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bulk_upsert_products(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_bad   text;
  v_count integer;
BEGIN
  SELECT r->>'fulfillment_mode' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'fulfillment_mode', '') IS NOT NULL
    AND lower(r->>'fulfillment_mode') NOT IN ('mto', 'mts')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid fulfillment_mode "%" — engine accepts: mto, mts (ato is not yet runnable)', v_bad;
  END IF;

  SELECT r->>'demand_distribution' INTO v_bad
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'demand_distribution', '') IS NOT NULL
    AND lower(r->>'demand_distribution') NOT IN ('triangular', 'deterministic', 'poisson', 'negbin')
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid demand_distribution "%" — engine accepts: triangular, deterministic, poisson, negbin', v_bad;
  END IF;

  INSERT INTO public.products
    (project_id, product_id, name, sell_price, production_capacity,
     fulfillment_mode, demand_distribution, demand_mean, demand_cv, updated_at)
  SELECT
    p_project_id,
    r->>'product_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'sell_price', '')::numeric,
    NULLIF(r->>'production_capacity', '')::numeric,
    lower(NULLIF(r->>'fulfillment_mode', '')),
    lower(NULLIF(r->>'demand_distribution', '')),
    NULLIF(r->>'demand_mean', '')::numeric,
    NULLIF(r->>'demand_cv', '')::numeric,
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'product_id', '') IS NOT NULL
  ON CONFLICT (project_id, product_id) DO UPDATE SET
    name                = excluded.name,
    sell_price          = excluded.sell_price,
    production_capacity = excluded.production_capacity,
    fulfillment_mode    = excluded.fulfillment_mode,
    demand_distribution = excluded.demand_distribution,
    demand_mean         = excluded.demand_mean,
    demand_cv           = excluded.demand_cv,
    updated_at          = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_products TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bulk_upsert_suppliers(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.suppliers
    (project_id, supplier_id, name, capacity_per_week, reliability_score, updated_at)
  SELECT
    p_project_id,
    r->>'supplier_id',
    NULLIF(r->>'name', ''),
    NULLIF(r->>'capacity_per_week', '')::numeric,  -- NULL = unlimited
    COALESCE(NULLIF(r->>'reliability_score', '')::numeric, 1.0),
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE NULLIF(r->>'supplier_id', '') IS NOT NULL
  ON CONFLICT (project_id, supplier_id) DO UPDATE SET
    name              = excluded.name,
    capacity_per_week = excluded.capacity_per_week,
    reliability_score = excluded.reliability_score,
    updated_at        = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_suppliers TO anon, authenticated, service_role;

-- Flush PostgREST schema cache so the new functions are visible immediately
SELECT pg_notify('pgrst', 'reload schema');
