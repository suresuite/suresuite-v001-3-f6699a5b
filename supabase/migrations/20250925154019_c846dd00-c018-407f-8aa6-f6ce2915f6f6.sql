-- Add network science metrics columns to network_nodes table
ALTER TABLE public.network_nodes 
ADD COLUMN degree_centrality numeric,
ADD COLUMN weighted_degree_centrality numeric,
ADD COLUMN eigenvector_centrality numeric,
ADD COLUMN betweenness_centrality numeric,
ADD COLUMN closeness_centrality numeric,
ADD COLUMN network_metrics_updated_at timestamp with time zone;

-- Create RPC function to get network metrics for materials
CREATE OR REPLACE FUNCTION public.get_network_metrics_for_materials(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  id uuid,
  uid text,
  name text,
  revenue numeric,
  degree_centrality numeric,
  weighted_degree_centrality numeric,
  eigenvector_centrality numeric,
  betweenness_centrality numeric,
  closeness_centrality numeric,
  prominence numeric,
  connection_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return network metrics for material nodes only
  RETURN QUERY
  SELECT 
    nn.id,
    nn.uid,
    nn.name,
    nn.revenue,
    nn.degree_centrality,
    nn.weighted_degree_centrality,
    nn.eigenvector_centrality,
    nn.betweenness_centrality,
    nn.closeness_centrality,
    nn.prominence,
    (
      SELECT COUNT(*)::bigint 
      FROM public.network_edges ne 
      WHERE ne.project_id = p_project_id 
      AND (ne.src_uid = nn.uid OR ne.dst_uid = nn.uid)
    ) as connection_count
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND EXISTS (
      SELECT 1 FROM public.supply_chain_data scd 
      WHERE scd.project_id = p_project_id 
      AND scd.data_source = 'bom' 
      AND (scd.from_location = nn.uid OR scd.to_location = nn.uid)
    )
  ORDER BY nn.prominence DESC NULLS LAST, nn.degree_centrality DESC NULLS LAST;
END;
$function$;