-- RPC to safely fetch multi-tier supply chain data with proper RLS context
CREATE OR REPLACE FUNCTION public.get_supply_chain_data_multi_tier(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  path_root text,
  data_source text,
  from_location text,
  to_location text,
  level integer,
  weighted numeric,
  sourcing_ratio numeric,
  material_consumption_rate numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return rows limited to the requested project (RLS will also enforce org)
  RETURN QUERY
  SELECT 
    scdmt.id,
    scdmt.project_id,
    scdmt.plant_name,
    scdmt.path_root,
    scdmt.data_source,
    scdmt.from_location,
    scdmt.to_location,
    scdmt.level,
    scdmt.weighted,
    scdmt.sourcing_ratio,
    scdmt.material_consumption_rate,
    scdmt.created_at,
    scdmt.updated_at
  FROM public.supply_chain_data_multi_tier scdmt
  WHERE scdmt.project_id = p_project_id
  ORDER BY COALESCE(scdmt.level, 0), scdmt.created_at;
END;
$$;