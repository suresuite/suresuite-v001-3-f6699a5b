-- RPC functions for edge function to access network data

-- Function to get network nodes for prominence calculation
CREATE OR REPLACE FUNCTION public.get_network_nodes_for_prominence(p_project_id uuid)
RETURNS TABLE(
  id uuid,
  uid text,
  revenue numeric,
  name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    nn.id,
    nn.uid,
    nn.revenue,
    nn.name
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id;
END;
$function$;

-- Function to get network edges for prominence calculation
CREATE OR REPLACE FUNCTION public.get_network_edges_for_prominence(p_project_id uuid)
RETURNS TABLE(
  src_uid text,
  dst_uid text,
  relative_revenue numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ne.src_uid,
    ne.dst_uid,
    ne.relative_revenue
  FROM public.network_edges ne
  WHERE ne.project_id = p_project_id;
END;
$function$;

-- Grant execute permissions to service role for edge function usage
GRANT EXECUTE ON FUNCTION public.get_network_nodes_for_prominence(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_network_edges_for_prominence(uuid) TO service_role;