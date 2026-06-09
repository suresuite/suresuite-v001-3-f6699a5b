-- Fix the trigger to use the service role key instead of anon key
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

    -- Use service role key for edge function calls (now updated to use the secret)
    BEGIN
      PERFORM net.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    EXCEPTION WHEN undefined_function THEN
      PERFORM extensions.http_post(
        'https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/calculate-node-prominence',
        jsonb_build_object(
          'Content-Type','application/json'
        ),
        jsonb_build_object('project_id', v_project_id)
      );
    END;

    RAISE LOG 'Auto-triggered prominence calculation for project %', v_project_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;