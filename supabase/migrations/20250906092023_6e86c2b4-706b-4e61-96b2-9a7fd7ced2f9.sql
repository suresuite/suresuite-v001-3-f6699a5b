-- Ensure pg_net is available
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Safeguard & main trigger function: avoid recursion when only prominence fields are updated
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
  -- If this is an UPDATE on network_nodes and only prominence fields changed, skip to prevent loop
  IF TG_TABLE_NAME = 'network_nodes' AND TG_OP = 'UPDATE' THEN
    IF (NEW.prominence IS DISTINCT FROM OLD.prominence)
       OR (NEW.prominence_updated_at IS DISTINCT FROM OLD.prominence_updated_at) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_project_id := COALESCE(NEW.project_id, OLD.project_id);

  -- Require nodes AND edges to exist before invoking calculation
  SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = v_project_id LIMIT 1) INTO v_has_nodes;
  SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = v_project_id LIMIT 1) INTO v_has_edges;

  IF v_has_nodes AND v_has_edges THEN
    -- Set context to project owner (optional; useful for helper fns that read it)
    SELECT modeler_id INTO v_modeler_id FROM public.projects WHERE id = v_project_id;
    SELECT email INTO v_modeler_email FROM public.approved_users WHERE id = v_modeler_id;
    PERFORM public.set_current_user_context(v_modeler_id, COALESCE(v_modeler_email, ''));

    -- Prefer net.http_post; fallback to extensions.http_post
    BEGIN
      PERFORM net.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    EXCEPTION WHEN undefined_function THEN
      PERFORM extensions.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    END;

    RAISE LOG 'Auto-triggered prominence calculation for project %', v_project_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Recreate triggers to only fire on relevant column changes (prevents recursion on prominence updates)
DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_nodes ON public.network_nodes;
CREATE TRIGGER trigger_auto_calculate_prominence_nodes
  AFTER INSERT OR UPDATE OF project_id, uid, revenue, name, plant_name, country, industry, website, depth, number_of_employees
  ON public.network_nodes
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

DROP TRIGGER IF EXISTS trigger_auto_calculate_prominence_edges ON public.network_edges;
CREATE TRIGGER trigger_auto_calculate_prominence_edges
  AFTER INSERT OR UPDATE OF project_id, src_uid, dst_uid, relative_revenue, relative_revenue_percentage, depth, direction, relation_type, plant_name
  ON public.network_edges
  FOR EACH ROW EXECUTE FUNCTION public.auto_calculate_prominence_on_deep_tier_completion();

-- One-time backfill: invoke calculation for all projects that already have nodes & edges
DO $$
DECLARE pid uuid;
BEGIN
  FOR pid IN
    SELECT p.id
    FROM public.projects p
    WHERE EXISTS (SELECT 1 FROM public.network_nodes nn WHERE nn.project_id = p.id)
      AND EXISTS (SELECT 1 FROM public.network_edges ne WHERE ne.project_id = p.id)
  LOOP
    BEGIN
      PERFORM net.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', pid)
      );
    EXCEPTION WHEN undefined_function THEN
      PERFORM extensions.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indja2RydXR3a3l0d2NvbXJscGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyOTMyNDQsImV4cCI6MjA3MDg2OTI0NH0.YREwEcTbzQYEJw5f3NVQvH0133PUglwuwU6KjHBx21Q'
        ),
        jsonb_build_object('project_id', pid)
      );
    END;
  END LOOP;
END $$;