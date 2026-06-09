-- 1) Add organization columns and backfill
-- Use a non-empty default to keep NOT NULL simple, org can be updated later by admins
ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT 'default_org';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT 'default_org';

-- Backfill projects.organization from approved_users where possible
UPDATE public.projects p
SET organization = au.organization
FROM public.approved_users au
WHERE p.modeler_id = au.id
  AND p.organization IS NOT DISTINCT FROM 'default_org'
  AND au.organization IS NOT NULL;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_approved_users_organization ON public.approved_users(organization);
CREATE INDEX IF NOT EXISTS idx_projects_organization ON public.projects(organization);

-- 2) Helper to get current user's organization based on JWT email
CREATE OR REPLACE FUNCTION public.get_current_user_org()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.organization
  FROM public.approved_users au
  WHERE au.email = (auth.jwt() ->> 'email')
  LIMIT 1;
$$;

-- 3) BEFORE INSERT trigger to set project defaults from current user context
CREATE OR REPLACE FUNCTION public.set_project_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure modeler_id defaults to current user when missing
  IF NEW.modeler_id IS NULL THEN
    NEW.modeler_id := public.get_current_user_id();
  END IF;

  -- Force project organization to current user's organization
  NEW.organization := public.get_current_user_org();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_project_defaults ON public.projects;
CREATE TRIGGER trg_set_project_defaults
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_defaults();

-- 4) Update RLS on projects to enforce organization scoping
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to replace them with org-aware versions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='Projects: selectable by owner, admin, or plant access') THEN
    DROP POLICY "Projects: selectable by owner, admin, or plant access" ON public.projects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='Projects: modelers create their own projects; admins any') THEN
    DROP POLICY "Projects: modelers create their own projects; admins any" ON public.projects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='Projects: owner or admin can update') THEN
    DROP POLICY "Projects: owner or admin can update" ON public.projects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='Projects: owner or admin can delete') THEN
    DROP POLICY "Projects: owner or admin can delete" ON public.projects;
  END IF;
END $$;

-- Recreate with organization requirement
CREATE POLICY "Projects: select within organization"
ON public.projects
FOR SELECT
USING (
  organization = public.get_current_user_org()
  AND (
    modeler_id = public.get_current_user_id()
    OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
    OR (plant_name IN (
      SELECT upa.plant FROM public.user_plant_access upa
      WHERE upa.user_id = public.get_current_user_id() AND upa.can_view = true
    ))
  )
);

CREATE POLICY "Projects: create within organization"
ON public.projects
FOR INSERT
WITH CHECK (
  organization = public.get_current_user_org()
  AND (
    (((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'modeler') AND modeler_id = public.get_current_user_id())
    OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
);

CREATE POLICY "Projects: update within organization"
ON public.projects
FOR UPDATE
USING (
  organization = public.get_current_user_org()
  AND (modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
)
WITH CHECK (
  organization = public.get_current_user_org()
  AND (modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

CREATE POLICY "Projects: delete within organization"
ON public.projects
FOR DELETE
USING (
  organization = public.get_current_user_org()
  AND (modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
