-- Create trigger function to call external simulation API
CREATE OR REPLACE FUNCTION public.trigger_external_simulation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
BEGIN
  -- Only process if status is 'pending' or 'queued'
  IF NEW.status IN ('pending', 'queued') AND (OLD IS NULL OR OLD.status != NEW.status) THEN
    -- Get organization for context
    SELECT organization INTO v_org FROM public.projects WHERE id = NEW.project_id;
    
    -- Call external simulation processor edge function
    PERFORM net.http_post(
      url := 'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/external-simulation-processor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
      ),
      body := jsonb_build_object(
        'job_id', NEW.id,
        'project_id', NEW.project_id,
        'organization', v_org
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on simulation_jobs table
DROP TRIGGER IF EXISTS external_simulation_trigger ON public.simulation_jobs;
CREATE TRIGGER external_simulation_trigger
  AFTER INSERT OR UPDATE ON public.simulation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_external_simulation();