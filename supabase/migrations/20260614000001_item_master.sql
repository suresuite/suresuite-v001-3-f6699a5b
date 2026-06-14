-- Item-master tables: the authoritative source for the economics that drive
-- simulation KPIs (material cost, product sell price, capacity, MOQ, holding,
-- demand shape, fulfillment mode). Logistics/BOM tables keep arcs (lead time,
-- volume, consumption); masters keep per-item economics. See
-- docs/data-simulation-mapping.md and scsim/scsim/io/project_map.py.

-- ── materials master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materials (
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  material_id      text NOT NULL,
  name             text,
  cost             numeric,          -- c_m (€/unit)
  holding_cost_pct numeric,          -- fraction, e.g. 0.20
  moq              numeric,          -- minimum order quantity
  initial_on_hand  numeric,
  lead_time_dist   text,             -- deterministic | lognormal | gamma | empirical
  lead_time_cv     numeric,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, material_id)
);

-- ── products master ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  product_id          text NOT NULL,
  name                text,
  sell_price          numeric,       -- u_p (€/unit)
  production_capacity numeric,       -- units/week
  fulfillment_mode    text,          -- mto | mts | ato
  demand_distribution text,          -- triangular | deterministic | poisson | negbin
  demand_mean         numeric,       -- b_p (units/week)
  demand_cv           numeric,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, product_id)
);

-- ── suppliers master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id       text NOT NULL,
  name              text,
  capacity_per_week numeric,         -- NULL = ∞; finite enables partial capacity cuts
  reliability_score numeric NOT NULL DEFAULT 1.0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, supplier_id)
);

-- ── RLS + grants (mirror policy_defaults: open read/write to app roles; the
--    worker uses the service role) ──────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materials','products','suppliers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%1$s_auth_all" ON public.%1$s;
      CREATE POLICY "%1$s_auth_all" ON public.%1$s
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
      DROP POLICY IF EXISTS "%1$s_anon_read" ON public.%1$s;
      CREATE POLICY "%1$s_anon_read" ON public.%1$s
        FOR SELECT TO anon USING (true);
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', t);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.materials;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reconcile masters from the logistics/BOM ids so a row always exists to fill ─
CREATE OR REPLACE FUNCTION public.ensure_item_masters(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.suppliers (project_id, supplier_id)
  SELECT DISTINCT p_project_id, il.supplier_id
  FROM public.inbound_logistics il
  WHERE il.project_id = p_project_id AND il.supplier_id IS NOT NULL
  ON CONFLICT (project_id, supplier_id) DO NOTHING;

  INSERT INTO public.materials (project_id, material_id)
  SELECT DISTINCT p_project_id, m FROM (
    SELECT material_id AS m FROM public.inbound_logistics WHERE project_id = p_project_id
    UNION
    SELECT material_id     FROM public.bom_single_level   WHERE project_id = p_project_id
  ) q WHERE m IS NOT NULL
  ON CONFLICT (project_id, material_id) DO NOTHING;

  INSERT INTO public.products (project_id, product_id)
  SELECT DISTINCT p_project_id, p FROM (
    SELECT product_id AS p FROM public.bom_single_level  WHERE project_id = p_project_id
    UNION
    SELECT product_id      FROM public.outbound_logistics WHERE project_id = p_project_id
  ) q WHERE p IS NOT NULL
  ON CONFLICT (project_id, product_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON public.ensure_item_masters(uuid) TO authenticated, anon, service_role;

-- ── Results contract: mapping warnings + idempotent per-rep writes ──────────────
ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS mapping_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS run_replications_run_rep_uniq
  ON public.run_replications (run_id, rep_index);

-- ── Regenerate sc_nodes / sc_edges to read the masters (so SQL consumers agree
--    with the canonical Python mapper) ──────────────────────────────────────────
CREATE OR REPLACE VIEW public.sc_nodes AS
SELECT 'supplier:' || s.supplier_id AS id, s.project_id, COALESCE(s.name, s.supplier_id) AS name,
       'supplier' AS node_type, NULL::numeric AS weekly_demand, NULL::numeric AS unit_price,
       NULL::numeric AS capacity_units_per_day, 1.0::numeric AS yield_rate,
       s.capacity_per_week
FROM public.suppliers s
UNION ALL
SELECT 'material:' || m.material_id, m.project_id, COALESCE(m.name, m.material_id),
       'material', NULL::numeric, m.cost, NULL::numeric, 1.0::numeric, NULL::numeric
FROM public.materials m
UNION ALL
SELECT 'product:' || p.product_id, p.project_id, COALESCE(p.name, p.product_id),
       'product',
       COALESCE(p.demand_mean, agg.weekly_demand),
       COALESCE(p.sell_price, agg.unit_price),
       p.production_capacity, 1.0::numeric, NULL::numeric
FROM public.products p
LEFT JOIN (
  SELECT project_id, product_id,
         SUM(CASE WHEN time_unit ILIKE '%day%'   THEN volume * 7.0
                  WHEN time_unit ILIKE '%month%' THEN volume / 4.345
                  WHEN time_unit ILIKE '%year%'  THEN volume / 52.18
                  ELSE volume END) AS weekly_demand,
         -- demand-weighted average price
         CASE WHEN SUM(volume) > 0 THEN SUM(unit_price * volume) / SUM(volume) ELSE MAX(unit_price) END AS unit_price
  FROM public.outbound_logistics GROUP BY project_id, product_id
) agg ON agg.project_id = p.project_id AND agg.product_id = p.product_id
UNION ALL
SELECT 'customer:' || o.customer_id, o.project_id, o.customer_id,
       'customer', NULL::numeric, NULL::numeric, NULL::numeric, 1.0::numeric, NULL::numeric
FROM public.outbound_logistics o GROUP BY o.project_id, o.customer_id;

GRANT SELECT ON public.sc_nodes TO authenticated, anon, service_role;
