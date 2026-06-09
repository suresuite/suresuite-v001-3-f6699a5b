-- sc_nodes and sc_edges: PostgREST-queryable views that the sim-worker
-- graph_cache reads directly.  These are convenience views over the three
-- core dataset tables; the worker also queries those tables directly but
-- these views support future tooling (dashboards, edge functions, etc.).

-- sc_nodes: one row per logical supply chain node
CREATE OR REPLACE VIEW public.sc_nodes AS
SELECT
  'supplier:' || il.supplier_id AS id,
  il.project_id,
  il.supplier_id                AS name,
  'supplier'                    AS node_type,
  NULL::numeric                 AS weekly_demand,
  NULL::numeric                 AS unit_price,
  NULL::numeric                 AS capacity_units_per_day,
  1.0::numeric                  AS yield_rate
FROM public.inbound_logistics il
GROUP BY il.project_id, il.supplier_id

UNION ALL

SELECT
  'material:' || b.material_id  AS id,
  b.project_id,
  b.material_id                 AS name,
  'material'                    AS node_type,
  NULL::numeric                 AS weekly_demand,
  NULL::numeric                 AS unit_price,
  NULL::numeric                 AS capacity_units_per_day,
  1.0::numeric                  AS yield_rate
FROM public.bom_single_level b
GROUP BY b.project_id, b.material_id

UNION ALL

SELECT
  'product:' || o.product_id    AS id,
  o.project_id,
  o.product_id                  AS name,
  'product'                     AS node_type,
  SUM(
    CASE WHEN o.time_unit ILIKE '%month%' THEN o.volume / 4.0
         ELSE o.volume
    END
  )                             AS weekly_demand,
  MAX(o.unit_price)             AS unit_price,
  NULL::numeric                 AS capacity_units_per_day,
  1.0::numeric                  AS yield_rate
FROM public.outbound_logistics o
GROUP BY o.project_id, o.product_id

UNION ALL

SELECT
  'customer:' || o.customer_id  AS id,
  o.project_id,
  o.customer_id                 AS name,
  'customer'                    AS node_type,
  NULL::numeric                 AS weekly_demand,
  NULL::numeric                 AS unit_price,
  NULL::numeric                 AS capacity_units_per_day,
  1.0::numeric                  AS yield_rate
FROM public.outbound_logistics o
GROUP BY o.project_id, o.customer_id;

GRANT SELECT ON public.sc_nodes TO authenticated, service_role;


-- sc_edges: one row per supply chain arc
CREATE OR REPLACE VIEW public.sc_edges AS
-- Supplier → Material arcs
SELECT
  gen_random_uuid()             AS id,
  il.project_id,
  'supplier:' || il.supplier_id AS from_node,
  'material:' || il.material_id AS to_node,
  'supply'                      AS edge_type,
  CASE WHEN il.time_unit ILIKE '%day%' OR il.lead_time > 30
       THEN il.lead_time / 7.0
       ELSE il.lead_time
  END                           AS lead_time,         -- weeks
  il.unit_price,
  il.volume,
  NULL::numeric                 AS consumption_rate
FROM public.inbound_logistics il

UNION ALL

-- Material → Product arcs (BOM)
SELECT
  gen_random_uuid()             AS id,
  b.project_id,
  'material:' || b.material_id  AS from_node,
  'product:'  || b.product_id   AS to_node,
  'bom'                         AS edge_type,
  NULL::numeric                 AS lead_time,
  NULL::numeric                 AS unit_price,
  NULL::numeric                 AS volume,
  b.consumption_rate
FROM public.bom_single_level b

UNION ALL

-- Product → Customer arcs (outbound)
SELECT
  gen_random_uuid()             AS id,
  o.project_id,
  'product:'  || o.product_id   AS from_node,
  'customer:' || o.customer_id  AS to_node,
  'outbound'                    AS edge_type,
  o.expected_lead_time          AS lead_time,
  o.unit_price,
  CASE WHEN o.time_unit ILIKE '%month%' THEN o.volume / 4.0
       ELSE o.volume
  END                           AS volume,
  NULL::numeric                 AS consumption_rate
FROM public.outbound_logistics o;

GRANT SELECT ON public.sc_edges TO authenticated, service_role;
