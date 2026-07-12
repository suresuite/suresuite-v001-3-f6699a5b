-- Phase B0 / §8: make the completion → network-metrics staleness check cheap.
--
-- should_recalculate_network_metrics(p_project_id) runs INSIDE every
-- projects-row UPDATE that flips completed=true (trigger
-- auto_calculate_metrics_on_completion). Two of its queries explode once a
-- project has combined network data:
--
--   1. metrics_count: EXISTS over supply_chain_data with
--      (from_location = nn.uid OR to_location = nn.uid) — the OR defeats any
--      index, so it seq-scans supply_chain_data once per network node.
--   2. last_data_time: FROM supply_chain_data LEFT JOIN bom/inbound/outbound
--      ON <project match only> — the join conditions do not correlate rows,
--      so this is a CARTESIAN product (|scd| × |bom| × |inbound| × |outbound|;
--      ≈ 6.8 × 10⁹ intermediate rows for a 1,200-node project). It was only
--      ever fast for projects with an EMPTY supply_chain_data — i.e. before
--      their first combine. Afterwards, every completion flip exceeds the
--      anon statement timeout (observed live on Project TRON - ver2: the
--      update_project_completion_status RPC dying at 3 s with no blockers).
--
-- Fix: index-friendly rewrites with identical semantics + the covering
-- indexes. Return shape and reason strings are unchanged.

CREATE INDEX IF NOT EXISTS idx_scd_project_from
  ON public.supply_chain_data(project_id, data_source, from_location);
CREATE INDEX IF NOT EXISTS idx_scd_project_to
  ON public.supply_chain_data(project_id, data_source, to_location);
CREATE INDEX IF NOT EXISTS idx_scd_project
  ON public.supply_chain_data(project_id);
CREATE INDEX IF NOT EXISTS idx_network_nodes_project
  ON public.network_nodes(project_id);

CREATE OR REPLACE FUNCTION public.should_recalculate_network_metrics(p_project_id uuid)
RETURNS TABLE(
  needs_recalculation boolean,
  reason text,
  last_calculated timestamp with time zone,
  data_last_modified timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_calc_time timestamp with time zone;
  last_data_time timestamp with time zone;
  has_metrics boolean := false;
  metrics_count integer := 0;
BEGIN
  -- Nodes with calculated metrics that appear on a BOM arc. The OR is split
  -- into two independently index-served EXISTS probes.
  SELECT COUNT(*) INTO metrics_count
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND nn.degree_centrality IS NOT NULL
    AND nn.betweenness_centrality IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.supply_chain_data scd
        WHERE scd.project_id = p_project_id
          AND scd.data_source = 'bom'
          AND scd.from_location = nn.uid
      )
      OR EXISTS (
        SELECT 1 FROM public.supply_chain_data scd
        WHERE scd.project_id = p_project_id
          AND scd.data_source = 'bom'
          AND scd.to_location = nn.uid
      )
    );

  has_metrics := metrics_count > 0;

  SELECT MAX(nn.network_metrics_updated_at) INTO last_calc_time
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND nn.network_metrics_updated_at IS NOT NULL;

  -- Latest data modification: independent per-table MAXes (the old version
  -- cross-joined the five tables).
  SELECT GREATEST(
    COALESCE((SELECT MAX(updated_at) FROM public.supply_chain_data  WHERE project_id = p_project_id), '1970-01-01'::timestamptz),
    COALESCE((SELECT MAX(updated_at) FROM public.bom_single_level   WHERE project_id = p_project_id), '1970-01-01'::timestamptz),
    COALESCE((SELECT MAX(updated_at) FROM public.bom_multi_level    WHERE project_id = p_project_id), '1970-01-01'::timestamptz),
    COALESCE((SELECT MAX(updated_at) FROM public.inbound_logistics  WHERE project_id = p_project_id), '1970-01-01'::timestamptz),
    COALESCE((SELECT MAX(updated_at) FROM public.outbound_logistics WHERE project_id = p_project_id), '1970-01-01'::timestamptz)
  ) INTO last_data_time;

  RETURN QUERY
  SELECT
    CASE
      WHEN NOT has_metrics THEN true
      WHEN last_calc_time IS NULL THEN true
      WHEN last_data_time > last_calc_time THEN true
      ELSE false
    END as needs_recalculation,
    CASE
      WHEN NOT has_metrics THEN 'No metrics calculated yet'
      WHEN last_calc_time IS NULL THEN 'No calculation timestamp found'
      WHEN last_data_time > last_calc_time THEN 'Data modified since last calculation'
      ELSE 'Metrics are up to date'
    END as reason,
    last_calc_time,
    last_data_time;
END;
$function$;
