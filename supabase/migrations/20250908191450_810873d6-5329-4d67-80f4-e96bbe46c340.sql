-- Create new table for multi-tier supply chain data
CREATE TABLE IF NOT EXISTS public.supply_chain_data_multi_tier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  data_source text, -- 'outbound' | 'bom' | 'inbound'
  from_location text NOT NULL,
  to_location text NOT NULL,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  level integer, -- depth in BOM flow, 0 for outbound
  path_root text, -- root product id for the propagated path
  uploaded_by uuid,
  organization text NOT NULL DEFAULT 'default_org',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS and add policies similar to supply_chain_data
ALTER TABLE public.supply_chain_data_multi_tier ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- View policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'supply_chain_data_multi_tier' AND policyname = 'Supply chain data multi-tier: project access view'
  ) THEN
    CREATE POLICY "Supply chain data multi-tier: project access view"
    ON public.supply_chain_data_multi_tier
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = supply_chain_data_multi_tier.project_id
          AND p.organization = public.get_current_user_org()
      )
    );
  END IF;

  -- Insert policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'supply_chain_data_multi_tier' AND policyname = 'Supply chain data multi-tier: project access insert'
  ) THEN
    CREATE POLICY "Supply chain data multi-tier: project access insert"
    ON public.supply_chain_data_multi_tier
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = supply_chain_data_multi_tier.project_id
          AND p.organization = public.get_current_user_org()
          AND (
            p.modeler_id = public.get_current_user_id()
            OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
          )
      )
    );
  END IF;

  -- Update policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'supply_chain_data_multi_tier' AND policyname = 'Supply chain data multi-tier: project access update'
  ) THEN
    CREATE POLICY "Supply chain data multi-tier: project access update"
    ON public.supply_chain_data_multi_tier
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = supply_chain_data_multi_tier.project_id
          AND p.organization = public.get_current_user_org()
          AND (
            p.modeler_id = public.get_current_user_id()
            OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = supply_chain_data_multi_tier.project_id
          AND p.organization = public.get_current_user_org()
          AND (
            p.modeler_id = public.get_current_user_id()
            OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
          )
      )
    );
  END IF;

  -- Delete policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'supply_chain_data_multi_tier' AND policyname = 'Supply chain data multi-tier: project access delete'
  ) THEN
    CREATE POLICY "Supply chain data multi-tier: project access delete"
    ON public.supply_chain_data_multi_tier
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = supply_chain_data_multi_tier.project_id
          AND p.organization = public.get_current_user_org()
          AND (
            p.modeler_id = public.get_current_user_id()
            OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
          )
      )
    );
  END IF;
END $$;

-- Defaults trigger for org/uploaded_by like supply_chain_data
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_sc_multi_tier_defaults'
  ) THEN
    CREATE TRIGGER set_sc_multi_tier_defaults
    BEFORE INSERT ON public.supply_chain_data_multi_tier
    FOR EACH ROW EXECUTE FUNCTION public.set_supply_chain_data_defaults();
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_scmt_project ON public.supply_chain_data_multi_tier(project_id);
CREATE INDEX IF NOT EXISTS idx_scmt_project_source ON public.supply_chain_data_multi_tier(project_id, data_source);
CREATE INDEX IF NOT EXISTS idx_scmt_paths ON public.supply_chain_data_multi_tier(project_id, path_root, level);
CREATE INDEX IF NOT EXISTS idx_scmt_from_to ON public.supply_chain_data_multi_tier(project_id, from_location, to_location);

-- Replace core RPC to implement new logic
CREATE OR REPLACE FUNCTION public.combine_project_into_supply_chain(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_bom_level text;
  inserted_count integer := 0;
  rc integer := 0;
BEGIN
  -- Caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id, bom_level
  INTO v_org, v_modeler, v_bom_level
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Clear previous combined data to avoid duplicates
  DELETE FROM public.supply_chain_data WHERE project_id = p_project_id;
  -- Also clear multi-tier details for this project
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;

  -- 1) OUTBOUND: product -> customer
  WITH ob AS (
    SELECT product_id, customer_id, plant_name, COALESCE(volume,0) AS volume
    FROM public.outbound_logistics
    WHERE project_id = p_project_id
  ),
  outbound_ins AS (
    INSERT INTO public.supply_chain_data (
      project_id, plant_name, data_source, from_location, to_location,
      sourcing_ratio, weighted, uploaded_by
    )
    SELECT
      p_project_id,
      o.plant_name,
      'outbound',
      o.product_id,
      o.customer_id,
      CASE WHEN SUM(o.volume) OVER (PARTITION BY o.product_id) > 0
           THEN o.volume / NULLIF(SUM(o.volume) OVER (PARTITION BY o.product_id),0)
           ELSE NULL END,
      o.volume,
      p_user_id
    FROM ob o
    RETURNING 1
  ),
  product_totals AS (
    SELECT product_id, SUM(volume) AS total_wt
    FROM ob
    GROUP BY product_id
  )
  SELECT COALESCE(COUNT(*),0) INTO rc FROM outbound_ins;
  inserted_count := inserted_count + rc;

  IF v_bom_level = 'single' THEN
    -- A2) Single-level BOM: material -> product with weighted = product_total * consumption_rate
    WITH b AS (
      SELECT material_id, product_id, plant_name, COALESCE(consumption_rate,0) AS rate
      FROM public.bom_single_level
      WHERE project_id = p_project_id
    ),
    bom_ins AS (
      INSERT INTO public.supply_chain_data (
        project_id, plant_name, data_source, from_location, to_location,
        material_consumption_rate, sourcing_ratio, weighted, uploaded_by
      )
      SELECT
        p_project_id,
        b.plant_name,
        'bom',
        b.material_id,
        b.product_id,
        NULLIF(b.rate,0),
        1,
        COALESCE(pt.total_wt,0) * NULLIF(b.rate,0),
        p_user_id
      FROM b
      LEFT JOIN product_totals pt ON pt.product_id = b.product_id
      WHERE NULLIF(b.rate,0) IS NOT NULL AND NULLIF(b.rate,0) > 0
      RETURNING 1
    ),
    material_totals AS (
      SELECT to_location AS product_id, from_location AS material_id, SUM(weighted) AS total_mat_wt
      FROM public.supply_chain_data
      WHERE project_id = p_project_id AND data_source = 'bom'
      GROUP BY to_location, from_location
    ),
    inb AS (
      SELECT supplier_id, material_id, plant_name, COALESCE(volume,0) AS volume
      FROM public.inbound_logistics
      WHERE project_id = p_project_id
    ),
    inbound_ins AS (
      INSERT INTO public.supply_chain_data (
        project_id, plant_name, data_source, from_location, to_location,
        sourcing_ratio, weighted, uploaded_by
      )
      SELECT
        p_project_id,
        i.plant_name,
        'inbound',
        i.supplier_id,
        i.material_id,
        CASE WHEN SUM(i.volume) OVER (PARTITION BY i.material_id) > 0
             THEN i.volume / NULLIF(SUM(i.volume) OVER (PARTITION BY i.material_id),0)
             ELSE NULL END,
        COALESCE(mt.total_mat_wt,0) * COALESCE(
          CASE WHEN SUM(i.volume) OVER (PARTITION BY i.material_id) > 0
               THEN i.volume / NULLIF(SUM(i.volume) OVER (PARTITION BY i.material_id),0)
               ELSE 0 END, 0
        ),
        p_user_id
      FROM inb i
      LEFT JOIN (
        SELECT material_id, SUM(weighted) AS total_mat_wt
        FROM public.supply_chain_data
        WHERE project_id = p_project_id AND data_source = 'bom'
        GROUP BY material_id
      ) mt ON mt.material_id = i.material_id
      RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM bom_ins),0) + COALESCE((SELECT COUNT(*) FROM inbound_ins),0) INTO rc;
    inserted_count := inserted_count + rc;

  ELSE
    -- B) Multi-level path
    -- 2B(i) Flatten multi-level BOM to root->leaf mapping with summed path rates and save in supply_chain_data
    WITH e AS (
      SELECT material_id, higher_level_component_id AS parent_id, plant_name, COALESCE(consumption_rate,0)::numeric AS rate
      FROM public.bom_multi_level
      WHERE project_id = p_project_id
    ),
    roots AS (
      SELECT DISTINCT parent_id AS root_id
      FROM e
      WHERE parent_id IS NOT NULL
        AND parent_id NOT IN (SELECT material_id FROM e)
    ),
    paths AS (
      -- immediate children of roots
      SELECT r.root_id, e.material_id AS leaf, 1 AS depth, NULLIF(e.rate,0) AS cum_rate, e.plant_name
      FROM roots r
      JOIN e ON e.parent_id = r.root_id
      WHERE NULLIF(e.rate,0) IS NOT NULL AND e.rate > 0
      UNION ALL
      SELECT p.root_id, c.material_id AS leaf, p.depth + 1, p.cum_rate * NULLIF(c.rate,0), c.plant_name
      FROM paths p
      JOIN e c ON c.parent_id = p.leaf
      WHERE NULLIF(c.rate,0) IS NOT NULL AND c.rate > 0
    ),
    root_leaf AS (
      SELECT root_id AS product_id, leaf AS material_id, SUM(cum_rate) AS total_rate, MIN(plant_name) AS plant_name
      FROM paths
      WHERE cum_rate IS NOT NULL AND cum_rate > 0
      GROUP BY root_id, leaf
    ),
    bom_flat_ins AS (
      INSERT INTO public.supply_chain_data (
        project_id, plant_name, data_source, from_location, to_location,
        material_consumption_rate, sourcing_ratio, weighted, uploaded_by
      )
      SELECT
        p_project_id,
        rl.plant_name,
        'bom',
        rl.material_id,
        rl.product_id,
        NULLIF(rl.total_rate,0),
        1,
        COALESCE(pt.total_wt,0) * NULLIF(rl.total_rate,0),
        p_user_id
      FROM root_leaf rl
      LEFT JOIN product_totals pt ON pt.product_id = rl.product_id
      WHERE NULLIF(rl.total_rate,0) IS NOT NULL AND rl.total_rate > 0
      RETURNING 1
    ),
    inbound_for_flat AS (
      -- compute material totals from flattened BOM
      SELECT material_id, SUM(weighted) AS total_mat_wt
      FROM public.supply_chain_data
      WHERE project_id = p_project_id AND data_source = 'bom'
      GROUP BY material_id
    ),
    inb AS (
      SELECT supplier_id, material_id, plant_name, COALESCE(volume,0) AS volume
      FROM public.inbound_logistics
      WHERE project_id = p_project_id
    ),
    inbound_flat_ins AS (
      INSERT INTO public.supply_chain_data (
        project_id, plant_name, data_source, from_location, to_location,
        sourcing_ratio, weighted, uploaded_by
      )
      SELECT
        p_project_id,
        i.plant_name,
        'inbound',
        i.supplier_id,
        i.material_id,
        CASE WHEN SUM(i.volume) OVER (PARTITION BY i.material_id) > 0
             THEN i.volume / NULLIF(SUM(i.volume) OVER (PARTITION BY i.material_id),0)
             ELSE NULL END,
        COALESCE(m.total_mat_wt,0) * COALESCE(
          CASE WHEN SUM(i.volume) OVER (PARTITION BY i.material_id) > 0
               THEN i.volume / NULLIF(SUM(i.volume) OVER (PARTITION BY i.material_id),0)
               ELSE 0 END, 0
        ),
        p_user_id
      FROM inb i
      LEFT JOIN inbound_for_flat m ON m.material_id = i.material_id
      RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM bom_flat_ins),0) + COALESCE((SELECT COUNT(*) FROM inbound_flat_ins),0) INTO rc;
    inserted_count := inserted_count + rc;

    -- 2B(ii) Detailed multi-tier propagation into supply_chain_data_multi_tier
    -- Insert outbound edges as level 0
    WITH ob AS (
      SELECT product_id, customer_id, plant_name, COALESCE(volume,0) AS volume
      FROM public.outbound_logistics
      WHERE project_id = p_project_id
    ),
    outbound_mt AS (
      INSERT INTO public.supply_chain_data_multi_tier (
        project_id, plant_name, data_source, from_location, to_location,
        sourcing_ratio, weighted, level, path_root, uploaded_by
      )
      SELECT
        p_project_id,
        o.plant_name,
        'outbound',
        o.product_id,
        o.customer_id,
        CASE WHEN SUM(o.volume) OVER (PARTITION BY o.product_id) > 0
             THEN o.volume / NULLIF(SUM(o.volume) OVER (PARTITION BY o.product_id),0)
             ELSE NULL END,
        o.volume,
        0,
        o.product_id,
        p_user_id
      FROM ob o
      RETURNING 1
    ),
    e AS (
      SELECT material_id, higher_level_component_id AS parent_id, plant_name, COALESCE(consumption_rate,0)::numeric AS rate
      FROM public.bom_multi_level
      WHERE project_id = p_project_id
    ),
    roots AS (
      SELECT DISTINCT parent_id AS root_id
      FROM e
      WHERE parent_id IS NOT NULL
        AND parent_id NOT IN (SELECT material_id FROM e)
    ),
    flow AS (
      -- start from roots with their product totals
      SELECT r.root_id, 0 AS depth, r.root_id AS node_id, COALESCE(pt.total_wt,0) AS node_total
      FROM roots r
      LEFT JOIN (
        SELECT product_id, SUM(volume) AS total_wt
        FROM public.outbound_logistics
        WHERE project_id = p_project_id
        GROUP BY product_id
      ) pt ON pt.product_id = r.root_id
      UNION ALL
      SELECT f.root_id, f.depth + 1 AS depth, c.material_id AS node_id, f.node_total * NULLIF(c.rate,0)
      FROM flow f
      JOIN e c ON c.parent_id = f.node_id
      WHERE NULLIF(c.rate,0) IS NOT NULL AND c.rate > 0
    ),
    edges_flow AS (
      SELECT f.root_id, f.depth AS parent_depth, f.node_id AS parent_id, c.material_id AS child_id, c.rate, f.node_total AS parent_total, (f.node_total * NULLIF(c.rate,0)) AS edge_weight, c.plant_name, f.depth + 1 AS depth
      FROM flow f
      JOIN e c ON c.parent_id = f.node_id
      WHERE NULLIF(c.rate,0) IS NOT NULL AND c.rate > 0
    ),
    bom_mt AS (
      INSERT INTO public.supply_chain_data_multi_tier (
        project_id, plant_name, data_source, from_location, to_location,
        material_consumption_rate, sourcing_ratio, weighted, level, path_root, uploaded_by
      )
      SELECT
        p_project_id,
        ef.plant_name,
        'bom',
        ef.child_id,
        ef.parent_id,
        NULLIF(ef.rate,0),
        1,
        COALESCE(ef.edge_weight,0),
        ef.depth,
        ef.root_id,
        p_user_id
      FROM edges_flow ef
      WHERE COALESCE(ef.edge_weight,0) > 0
      RETURNING 1
    ),
    inbound_shares AS (
      SELECT material_id, supplier_id, plant_name,
             COALESCE(volume,0) AS volume,
             SUM(COALESCE(volume,0)) OVER (PARTITION BY material_id) AS mat_total
      FROM public.inbound_logistics
      WHERE project_id = p_project_id
    ),
    inbound_mt AS (
      INSERT INTO public.supply_chain_data_multi_tier (
        project_id, plant_name, data_source, from_location, to_location,
        sourcing_ratio, weighted, level, path_root, uploaded_by
      )
      SELECT
        p_project_id,
        s.plant_name,
        'inbound',
        s.supplier_id,
        ef.child_id AS material_id,
        CASE WHEN s.mat_total > 0 THEN s.volume / NULLIF(s.mat_total,0) ELSE NULL END,
        COALESCE(ef.edge_weight,0) * COALESCE(CASE WHEN s.mat_total > 0 THEN s.volume / NULLIF(s.mat_total,0) ELSE 0 END, 0),
        ef.depth,
        ef.root_id,
        p_user_id
      FROM edges_flow ef
      JOIN inbound_shares s ON s.material_id = ef.child_id
      WHERE COALESCE(ef.edge_weight,0) > 0
      RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM outbound_mt),0) + COALESCE((SELECT COUNT(*) FROM bom_mt),0) + COALESCE((SELECT COUNT(*) FROM inbound_mt),0) INTO rc;
    -- we do not add multi-tier rows to inserted_count to keep compatibility (count of supply_chain_data)
  END IF;

  RETURN inserted_count;
END;$$;
