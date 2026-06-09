-- Auto-trigger prominence calculation when deep tier datasets are complete

-- Function to auto-calculate prominence when deep tier data is complete
CREATE OR REPLACE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id uuid;
  v_has_nodes boolean := false;
  v_has_edges boolean := false;
  v_has_summary boolean := false;
  v_modeler_id uuid;
  v_modeler_email text;
BEGIN
  -- Get project_id from the trigger
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);
  
  -- Check if all three deep tier datasets exist
  SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = v_project_id LIMIT 1) INTO v_has_nodes;
  SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = v_project_id LIMIT 1) INTO v_has_edges;
  SELECT EXISTS(SELECT 1 FROM public.network_summary WHERE project_id = v_project_id LIMIT 1) INTO v_has_summary;
  
  -- If all three datasets exist, trigger prominence calculation
  IF v_has_nodes AND v_has_edges AND v_has_summary THEN
    -- Get project modeler for context
    SELECT modeler_id INTO v_modeler_id FROM public.projects WHERE id = v_project_id;
    SELECT email INTO v_modeler_email FROM public.approved_users WHERE id = v_modeler_id;
    
    -- Set user context for the edge function call
    PERFORM public.set_current_user_context(v_modeler_id, COALESCE(v_modeler_email, ''));
    
    -- Call the prominence calculation edge function asynchronously
    PERFORM net.http_post(
      url := 'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
      ),
      body := jsonb_build_object('project_id', v_project_id)
    );
    
    RAISE LOG 'Auto-triggered prominence calculation for project %', v_project_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for auto-calculation on all three deep tier tables
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes ON public.network_nodes;
CREATE TRIGGER trigger_auto_calculate_prominence_nodes
  AFTER INSERT OR UPDATE OR DELETE ON public.network_nodes
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges ON public.network_edges;  
CREATE TRIGGER trigger_auto_calculate_prominence_edges
  AFTER INSERT OR UPDATE OR DELETE ON public.network_edges
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_summary ON public.network_summary;
CREATE TRIGGER trigger_auto_calculate_prominence_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.network_summary
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();