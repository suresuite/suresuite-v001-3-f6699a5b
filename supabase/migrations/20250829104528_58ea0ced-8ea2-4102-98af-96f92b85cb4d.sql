-- 1) Ensure foreign keys between supply_chain_data/node_list and projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_scd_project'
      AND conrelid = 'public.supply_chain_data'::regclass
  ) THEN
    ALTER TABLE public.supply_chain_data
      ADD CONSTRAINT fk_scd_project
      FOREIGN KEY (project_id)
      REFERENCES public.projects(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_node_list_project'
      AND conrelid = 'public.node_list'::regclass
  ) THEN
    ALTER TABLE public.node_list
      ADD CONSTRAINT fk_node_list_project
      FOREIGN KEY (project_id)
      REFERENCES public.projects(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_scd_project_id ON public.supply_chain_data(project_id);
CREATE INDEX IF NOT EXISTS idx_node_list_project_id ON public.node_list(project_id);

-- 2) Helper to refresh node_list for a project with proper context
CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modeler uuid;
  v_email text;
BEGIN
  -- Find project's modeler (owner) and email
  SELECT p.modeler_id INTO v_modeler
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_modeler IS NULL THEN
    RETURN;
  END IF;

  SELECT au.email INTO v_email
  FROM public.approved_users au
  WHERE au.id = v_modeler
  LIMIT 1;

  -- Set context to project owner and rebuild
  PERFORM public.set_current_user_context(v_modeler, COALESCE(v_email, ''));
  PERFORM public.rebuild_node_list(p_project_id, v_modeler, v_email);
END;
$$;

-- 3) Update the existing trigger function to also refresh node_list when a project becomes completed
CREATE OR REPLACE FUNCTION public.auto_combine_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Refresh node list for this project
    PERFORM public.refresh_node_list_for_project(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Ensure the projects trigger exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_projects_auto_combine_on_completion'
  ) THEN
    CREATE TRIGGER trg_projects_auto_combine_on_completion
    AFTER UPDATE ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_combine_on_completion();
  END IF;
END $$;

-- 5) Create trigger to refresh node_list whenever supply_chain_data changes
CREATE OR REPLACE FUNCTION public.auto_refresh_node_list_on_scd_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);
  IF pid IS NOT NULL THEN
    PERFORM public.refresh_node_list_for_project(pid);
  END IF;
  RETURN NULL; -- statement-level work, nothing to modify
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_scd_auto_refresh_node_list'
  ) THEN
    CREATE TRIGGER trg_scd_auto_refresh_node_list
    AFTER INSERT OR UPDATE OR DELETE ON public.supply_chain_data
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.auto_refresh_node_list_on_scd_change();
  END IF;
END $$;