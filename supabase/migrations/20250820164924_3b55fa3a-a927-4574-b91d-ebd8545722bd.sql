-- Ensure projects have defaults set from current user/org to satisfy RLS
-- 1) Trigger to set defaults on INSERT
DROP TRIGGER IF EXISTS trg_projects_set_defaults ON public.projects;
CREATE TRIGGER trg_projects_set_defaults
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_defaults();

-- 2) Keep updated_at fresh on UPDATE
DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
