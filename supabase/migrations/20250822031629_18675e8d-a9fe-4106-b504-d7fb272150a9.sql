-- Create organization-aware RPC functions for supply chain data access

-- Function to get unique plants for a project (organization-aware)
CREATE OR REPLACE FUNCTION public.get_supply_chain_plants(p_project_id uuid, p_user_id uuid, p_user_email text)
 RETURNS TABLE(plant_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

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
AS $function$
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
$function$

-- Function to get prediction statistics (organization-aware) 
CREATE OR REPLACE FUNCTION public.get_prediction_stats(p_plant_name text, p_user_id uuid, p_user_email text)
 RETURNS TABLE(
   total_count bigint,
   critical_count bigint,
   non_critical_count bigint,
   last_prediction_timestamp timestamp with time zone
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint := 0;
  v_critical bigint := 0;
  v_last_prediction timestamp with time zone := null;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Get total count
  SELECT COUNT(*)
  INTO v_total
  FROM public.supply_chain_data scd
  WHERE scd.plant_name = p_plant_name;
  
  -- Get critical count
  SELECT COUNT(*)
  INTO v_critical
  FROM public.supply_chain_data scd
  WHERE scd.plant_name = p_plant_name
    AND scd.is_critical_node = true;
  
  -- Get latest prediction timestamp
  SELECT MAX(scd.prediction_timestamp)
  INTO v_last_prediction
  FROM public.supply_chain_data scd
  WHERE scd.plant_name = p_plant_name
    AND scd.prediction_timestamp IS NOT NULL;
  
  -- Return the results
  RETURN QUERY
  SELECT 
    v_total as total_count,
    v_critical as critical_count,
    (v_total - v_critical) as non_critical_count,
    v_last_prediction as last_prediction_timestamp;
END;
$function$