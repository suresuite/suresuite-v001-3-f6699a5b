-- Replace the integrated process RPC to pull directly from supply_chain_data_multi_tier for performance and correctness
CREATE OR REPLACE FUNCTION public.get_integrated_process_network_data(
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
  data_source text,
  level integer,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  is_connected boolean,
  mapping_confidence numeric
) AS $$
BEGIN
  -- Ensure RLS helper functions have the caller context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Return multi-tier supply chain edges for the project, enforcing org via projects
  RETURN QUERY
  SELECT
    scd.id,
    scd.project_id,
    scd.plant_name,
    scd.from_location,
    scd.to_location,
    COALESCE(scd.data_source, 'multi_tier') AS data_source,
    scd.level,
    scd.material_consumption_rate,
    scd.sourcing_ratio,
    scd.weighted,
    true AS is_connected,
    1.0::numeric AS mapping_confidence
  FROM public.supply_chain_data_multi_tier scd
  JOIN public.projects p ON p.id = scd.project_id
  WHERE scd.project_id = p_project_id
    AND p.organization = public.get_current_user_org()
  ORDER BY scd.level NULLS LAST, scd.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';