
-- Disable automatic combine by dropping both possible triggers on public.projects

-- Older migration trigger name (fires AFTER UPDATE OF completed)
DROP TRIGGER IF EXISTS project_completion_auto_combine ON public.projects;

-- Newer migration trigger name (fires AFTER UPDATE, function checks completed transition)
DROP TRIGGER IF EXISTS trg_projects_auto_combine_on_completion ON public.projects;
