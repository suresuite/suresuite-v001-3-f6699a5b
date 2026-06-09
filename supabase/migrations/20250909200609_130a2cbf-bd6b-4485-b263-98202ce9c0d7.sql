-- Create or replace RPC to fetch multi-tier data with optional pagination
CREATE OR REPLACE FUNCTION public.get_supply_chain_data_multi_tier(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  data_source text,
  from_location text,
  to_location text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  path_root text,
  organization text,
  uploaded_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return query with or without pagination depending on p_limit
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RETURN QUERY
    SELECT
      scdmt.id,
      scdmt.project_id,
      scdmt.plant_name,
      scdmt.data_source,
      scdmt.from_location,
      scdmt.to_location,
      COALESCE(scdmt.level, 0) AS level,
      scdmt.material_consumption_rate,
      scdmt.sourcing_ratio,
      scdmt.weighted,
      scdmt.path_root,
      scdmt.organization,
      scdmt.uploaded_by,
      scdmt.created_at,
      scdmt.updated_at
    FROM public.supply_chain_data_multi_tier scdmt
    WHERE scdmt.project_id = p_project_id
    ORDER BY COALESCE(scdmt.level,0), scdmt.created_at, scdmt.id
    OFFSET COALESCE(p_offset, 0);
  ELSE
    RETURN QUERY
    SELECT
      scdmt.id,
      scdmt.project_id,
      scdmt.plant_name,
      scdmt.data_source,
      scdmt.from_location,
      scdmt.to_location,
      COALESCE(scdmt.level, 0) AS level,
      scdmt.material_consumption_rate,
      scdmt.sourcing_ratio,
      scdmt.weighted,
      scdmt.path_root,
      scdmt.organization,
      scdmt.uploaded_by,
      scdmt.created_at,
      scdmt.updated_at
    FROM public.supply_chain_data_multi_tier scdmt
    WHERE scdmt.project_id = p_project_id
    ORDER BY COALESCE(scdmt.level,0), scdmt.created_at, scdmt.id
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
  END IF;
END;
$$;