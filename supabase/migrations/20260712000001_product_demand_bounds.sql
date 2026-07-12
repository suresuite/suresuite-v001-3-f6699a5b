-- Phase B0 / G4 / §8.3 — explicit triangular demand bounds on the products
-- master (a_p, c_p), closing the last demand-fidelity gap for empirically
-- parameterized projects (Project TRON - ver2, WSC 2026 model):
--
-- The engine's Product entity has always supported explicit
-- demand_min/demand_max (a_p = max{0,(1−ν)b_p}, c_p = historical max), but the
-- data path (products master → ProjectData → from_project_data) could only
-- express the symmetric triangularAV form (mean ± cv). Real demand histories
-- have an asymmetric right tail (c ≫ b·(1+cv)); these two nullable columns let
-- the master carry the empirical bounds. NULL keeps today's behavior exactly
-- (bounds derived from demand_mean ± demand_cv), so existing projects are
-- untouched. See docs/data-simulation-mapping.md §4/§5.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS demand_min numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS demand_max numeric;

COMMENT ON COLUMN public.products.demand_min IS
  'a_p — explicit triangular demand lower bound (units/week). NULL → demand_mean·(1−demand_cv).';
COMMENT ON COLUMN public.products.demand_max IS
  'c_p — explicit triangular demand upper bound, e.g. the historical max (units/week). NULL → demand_mean·(1+demand_cv).';

-- Same full-row-merge upsert as 20260702000001, now carrying the two bounds.
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
     fulfillment_mode, demand_distribution, demand_mean, demand_cv,
     demand_min, demand_max, updated_at)
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
    NULLIF(r->>'demand_min', '')::numeric,
    NULLIF(r->>'demand_max', '')::numeric,
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
    demand_min          = excluded.demand_min,
    demand_max          = excluded.demand_max,
    updated_at          = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_products TO anon, authenticated, service_role;
