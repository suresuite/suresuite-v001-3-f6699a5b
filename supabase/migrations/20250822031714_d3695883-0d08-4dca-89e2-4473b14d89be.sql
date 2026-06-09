-- Function to get supply chain data for a project and plant (organization-aware)
CREATE OR REPLACE FUNCTION public.get_supply_chain_data(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  data_source text,
  plant_name text,
  from_location text,
  to_location text,
  material_consumption_rate numeric,
  sourcing_ratio numeric,
  weighted numeric,
  uploaded_by uuid,
  organization text,
  is_critical_node boolean,
  critical_node_score numeric,
  prediction_timestamp timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return supply chain data for the given project and plant
  RETURN QUERY
  SELECT scd.*
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id
    AND (p_plant_name IS NULL OR scd.plant_name = p_plant_name)
  ORDER BY scd.created_at;
END;
$$;