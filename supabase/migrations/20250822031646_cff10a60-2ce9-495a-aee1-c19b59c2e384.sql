-- Create organization-aware RPC functions for supply chain data access

-- Function to get unique plants for a project (organization-aware)
CREATE OR REPLACE FUNCTION public.get_supply_chain_plants(p_project_id uuid, p_user_id uuid, p_user_email text)
RETURNS TABLE(plant_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return unique plant names from supply_chain_data for the given project
  RETURN QUERY
  SELECT DISTINCT scd.plant_name
  FROM public.supply_chain_data scd
  WHERE scd.project_id = p_project_id
  ORDER BY scd.plant_name;
END;
$$;