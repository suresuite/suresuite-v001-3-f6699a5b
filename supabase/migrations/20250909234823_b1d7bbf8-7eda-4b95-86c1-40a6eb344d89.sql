-- Create RPC function for multi-tier network data access with proper RLS context
CREATE OR REPLACE FUNCTION public.get_multi_tier_network_data(
  p_project_id uuid, 
  p_user_id uuid, 
  p_user_email text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  plant_name text,
  from_location text,
  to_location text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  data_source text,
  data_source_group text,
  path_root text,
  uploaded_by uuid,
  organization text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_org text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project access (same organization)
  SELECT organization INTO v_org
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- Authorization: same organization only
  IF v_org <> public.get_current_user_org() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Return multi-tier network data for the specified project
  RETURN QUERY
  SELECT
    smt.id,
    smt.project_id,
    smt.plant_name,
    smt.from_location,
    smt.to_location,
    smt.level,
    smt.material_consumption_rate,
    smt.sourcing_ratio,
    smt.weighted,
    smt.data_source,
    smt.data_source_group,
    smt.path_root,
    smt.uploaded_by,
    smt.organization,
    smt.created_at,
    smt.updated_at
  FROM public.supply_chain_data_multi_tier smt
  WHERE smt.project_id = p_project_id
  ORDER BY smt.level ASC, smt.from_location ASC;
END;
$function$;