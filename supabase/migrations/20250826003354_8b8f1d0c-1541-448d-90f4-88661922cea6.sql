-- Auto-combine supply chain data when a project becomes complete
-- Creates trigger function and trigger on projects table

-- 1) Trigger function
CREATE OR REPLACE FUNCTION public.auto_combine_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  modeler_email text;
BEGIN
  -- Only act on transition from false -> true
  IF COALESCE(OLD.completed, false) = false AND COALESCE(NEW.completed, false) = true THEN
    -- Fetch modeler email (may be NULL; user_id is sufficient for context)
    SELECT au.email INTO modeler_email
    FROM public.approved_users au
    WHERE au.id = NEW.modeler_id
    LIMIT 1;

    -- Combine datasets into supply_chain_data using existing function
    PERFORM public.combine_project_into_supply_chain(NEW.id, NEW.modeler_id, modeler_email);
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Trigger on projects.completed updates
DROP TRIGGER IF EXISTS project_completion_auto_combine ON public.projects;
CREATE TRIGGER project_completion_auto_combine
AFTER UPDATE OF completed ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.auto_combine_on_completion();