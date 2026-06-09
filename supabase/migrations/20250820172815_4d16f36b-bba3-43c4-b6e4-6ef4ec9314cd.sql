-- Update RLS policies for projects to organization-based and remove plant/user_plant_access dependency

-- 1) Drop existing policies on projects
DROP POLICY IF EXISTS "Projects: select within organization" ON public.projects;
DROP POLICY IF EXISTS "Projects: create within organization" ON public.projects;
DROP POLICY IF EXISTS "Projects: update within organization" ON public.projects;
DROP POLICY IF EXISTS "Projects: delete within organization" ON public.projects;

-- 2) Recreate simplified organization-centric policies
-- View: anyone in same organization can see all projects
CREATE POLICY "Projects: org-wide view"
ON public.projects
FOR SELECT
USING (
  organization = public.get_current_user_org()
);

-- Insert: modelers can create their own projects; admins can create any within org
CREATE POLICY "Projects: org create by modeler or admin"
ON public.projects
FOR INSERT
WITH CHECK (
  organization = public.get_current_user_org() AND (
    ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'modeler' AND modeler_id = public.get_current_user_id() )
    OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' )
  )
);

-- Update: project owner (modeler) or org admin
CREATE POLICY "Projects: org update by owner or admin"
ON public.projects
FOR UPDATE
USING (
  organization = public.get_current_user_org() AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
)
WITH CHECK (
  organization = public.get_current_user_org() AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
);

-- Delete: project owner (modeler) or org admin
CREATE POLICY "Projects: org delete by owner or admin"
ON public.projects
FOR DELETE
USING (
  organization = public.get_current_user_org() AND (
    modeler_id = public.get_current_user_id() OR ( (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  )
);