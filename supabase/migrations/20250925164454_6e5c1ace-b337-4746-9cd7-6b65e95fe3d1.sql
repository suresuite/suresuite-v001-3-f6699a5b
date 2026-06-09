-- Create function to check if network metrics need recalculation
CREATE OR REPLACE FUNCTION public.should_recalculate_network_metrics(p_project_id uuid)
RETURNS TABLE(
  needs_recalculation boolean,
  reason text,
  last_calculated timestamp with time zone,
  data_last_modified timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_calc_time timestamp with time zone;
  last_data_time timestamp with time zone;
  has_metrics boolean := false;
  metrics_count integer := 0;
BEGIN
  -- Check if we have any calculated metrics for materials
  SELECT COUNT(*) INTO metrics_count
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND nn.degree_centrality IS NOT NULL
    AND nn.betweenness_centrality IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.supply_chain_data scd 
      WHERE scd.project_id = p_project_id 
      AND scd.data_source = 'bom' 
      AND (scd.from_location = nn.uid OR scd.to_location = nn.uid)
    );

  has_metrics := metrics_count > 0;

  -- Get the latest calculation timestamp
  SELECT MAX(nn.network_metrics_updated_at) INTO last_calc_time
  FROM public.network_nodes nn
  WHERE nn.project_id = p_project_id
    AND nn.network_metrics_updated_at IS NOT NULL;

  -- Get the latest data modification timestamp
  SELECT GREATEST(
    COALESCE(MAX(scd.updated_at), '1970-01-01'::timestamp with time zone),
    COALESCE(MAX(bsl.updated_at), '1970-01-01'::timestamp with time zone),
    COALESCE(MAX(bml.updated_at), '1970-01-01'::timestamp with time zone),
    COALESCE(MAX(il.updated_at), '1970-01-01'::timestamp with time zone),
    COALESCE(MAX(ol.updated_at), '1970-01-01'::timestamp with time zone)
  ) INTO last_data_time
  FROM public.supply_chain_data scd
  LEFT JOIN public.bom_single_level bsl ON bsl.project_id = p_project_id
  LEFT JOIN public.bom_multi_level bml ON bml.project_id = p_project_id  
  LEFT JOIN public.inbound_logistics il ON il.project_id = p_project_id
  LEFT JOIN public.outbound_logistics ol ON ol.project_id = p_project_id
  WHERE scd.project_id = p_project_id;

  -- Determine if recalculation is needed
  RETURN QUERY
  SELECT 
    CASE
      WHEN NOT has_metrics THEN true
      WHEN last_calc_time IS NULL THEN true
      WHEN last_data_time > last_calc_time THEN true
      ELSE false
    END as needs_recalculation,
    CASE
      WHEN NOT has_metrics THEN 'No metrics calculated yet'
      WHEN last_calc_time IS NULL THEN 'No calculation timestamp found'
      WHEN last_data_time > last_calc_time THEN 'Data modified since last calculation'
      ELSE 'Metrics are up to date'
    END as reason,
    last_calc_time,
    last_data_time;
END;
$function$;

-- Function to automatically calculate network metrics on project completion
CREATE OR REPLACE FUNCTION public.auto_calculate_network_metrics_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  modeler_email text;
  should_calc record;
BEGIN
  -- Only act on transition to completed
  IF COALESCE(OLD.completed, false) = false AND COALESCE(NEW.completed, false) = true THEN
    -- Check if calculation is needed
    SELECT * INTO should_calc 
    FROM public.should_recalculate_network_metrics(NEW.id) 
    LIMIT 1;
    
    IF should_calc.needs_recalculation THEN
      -- Get modeler email for context
      SELECT au.email INTO modeler_email
      FROM public.approved_users au
      WHERE au.id = NEW.modeler_id
      LIMIT 1;

      -- Set user context and trigger calculation via edge function
      PERFORM public.set_current_user_context(NEW.modeler_id, COALESCE(modeler_email, ''));
      
      -- Log the auto-calculation trigger
      RAISE LOG 'Auto-triggering network metrics calculation for project % (reason: %)', 
        NEW.id, should_calc.reason;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Add trigger to auto-calculate metrics on project completion
DROP TRIGGER IF EXISTS auto_calculate_metrics_on_completion ON public.projects;
CREATE TRIGGER auto_calculate_metrics_on_completion
  AFTER UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_calculate_network_metrics_on_completion();