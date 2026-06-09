
-- 1) Ensure pg_net is available
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Update the trigger function to require only nodes + edges (no summary)
CREATE OR REPLACE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id uuid;
  v_has_nodes boolean := false;
  v_has_edges boolean := false;
  v_modeler_id uuid;
  v_modeler_email text;
BEGIN
  -- Determine project
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);

  -- Require nodes AND edges to exist (no summary required)
  SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = v_project_id LIMIT 1) INTO v_has_nodes;
  SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = v_project_id LIMIT 1) INTO v_has_edges;

  IF v_has_nodes AND v_has_edges THEN
    -- Get modeler context
    SELECT modeler_id INTO v_modeler_id FROM public.projects WHERE id = v_project_id;
    SELECT email INTO v_modeler_email FROM public.approved_users WHERE id = v_modeler_id;

    -- Set caller context for RLS helpers
    PERFORM public.set_current_user_context(v_modeler_id, COALESCE(v_modeler_email, ''));

    -- Prefer net.http_post if present; fallback to extensions.http_post
    IF to_regprocedure('net.http_post(text, jsonb, jsonb)') IS NOT NULL THEN
      PERFORM net.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    ELSIF to_regprocedure('extensions.http_post(text, jsonb, jsonb)') IS NOT NULL THEN
      PERFORM extensions.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    ELSE
      RAISE WARNING 'Neither net.http_post nor extensions.http_post is available. Is pg_net installed?';
    END IF;

    RAISE LOG 'Auto-triggered prominence calculation for project % (nodes+edges condition met)', v_project_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 3) Remove trigger from network_summary (we only need nodes + edges now)
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_summary ON public.network_summary;

-- 4) Ensure triggers on nodes and edges fire after INSERT/UPDATE
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes ON public.network_nodes;
CREATE TRIGGER trigger_auto_calculate_prominence_nodes
  AFTER INSERT OR UPDATE ON public.network_nodes
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges ON public.network_edges;
CREATE TRIGGER trigger_auto_calculate_prominence_edges
  AFTER INSERT OR UPDATE ON public.network_edges
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();
