-- Create RPC wrappers for deep-tier network data with proper defaults
-- 1) Get network_nodes by project (optional plant filter)
CREATE OR REPLACE FUNCTION public.get_network_nodes(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  uid text,
  name text,
  industry text,
  website text,
  traded_as text,
  number_of_employees integer,
  revenue numeric,
  depth integer,
  lat numeric,
  long numeric,
  is_seed boolean,
  uploaded_by uuid,
  created_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  country text
) AS $$
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return nodes for the project (optionally filter by plant)
  RETURN QUERY
  SELECT
    nn.id,
    nn.project_id,
    nn.plant_name,
    nn.uid,
    nn.name,
    nn.industry,
    nn.website,
    nn.traded_as,
    nn.number_of_employees,
    nn.revenue,
    nn.depth,
    nn.lat,
    nn.long,
    nn.is_seed,
    nn.uploaded_by,
    nn.created_by,
    nn.organization,
    nn.created_at,
    nn.updated_at,
    nn.country
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND (p_plant_name IS NULL OR nn.plant_name = p_plant_name)
  ORDER BY nn.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2) Get network_edges by project (optional plant filter)
CREATE OR REPLACE FUNCTION public.get_network_edges(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  src_uid text,
  dst_uid text,
  relation_type text,
  relative_revenue numeric,
  relative_revenue_percentage numeric,
  depth integer,
  direction text,
  uploaded_by uuid,
  created_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) AS $$
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT
    ne.id,
    ne.project_id,
    ne.plant_name,
    ne.src_uid,
    ne.dst_uid,
    ne.relation_type,
    ne.relative_revenue,
    ne.relative_revenue_percentage,
    ne.depth,
    ne.direction,
    ne.uploaded_by,
    ne.created_by,
    ne.organization,
    ne.created_at,
    ne.updated_at
  FROM public.network_edges ne
  WHERE ne.project_id = p_project_id
    AND (p_plant_name IS NULL OR ne.plant_name = p_plant_name)
  ORDER BY ne.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3) Get network_summary by project (optional plant filter)
CREATE OR REPLACE FUNCTION public.get_network_summary(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_plant_name text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  nodes_count integer,
  edges_count integer,
  tiers_data jsonb,
  uploaded_by uuid,
  created_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) AS $$
BEGIN
  -- Set caller context for RLS helpers
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT
    ns.id,
    ns.project_id,
    ns.plant_name,
    ns.nodes_count,
    ns.edges_count,
    ns.tiers_data,
    ns.uploaded_by,
    ns.created_by,
    ns.organization,
    ns.created_at,
    ns.updated_at
  FROM public.network_summary ns
  WHERE ns.project_id = p_project_id
    AND (p_plant_name IS NULL OR ns.plant_name = p_plant_name)
  ORDER BY ns.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;