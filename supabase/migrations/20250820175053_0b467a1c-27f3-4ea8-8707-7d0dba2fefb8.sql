-- Ensure projects inserts pass RLS by setting defaults via trigger
BEGIN;

-- Attach BEFORE INSERT trigger to set organization and modeler_id
DROP TRIGGER IF EXISTS set_project_defaults_trigger ON public.projects;
CREATE TRIGGER set_project_defaults_trigger
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_defaults();

-- Keep updated_at fresh on updates
DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;