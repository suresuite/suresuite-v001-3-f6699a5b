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
AS $$
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
$$;