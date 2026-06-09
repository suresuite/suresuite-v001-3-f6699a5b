-- First, temporarily remove default constraint
ALTER TABLE public.approved_users ALTER COLUMN role DROP DEFAULT;

-- Create roles enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','modeler','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Convert existing role column to enum type
ALTER TABLE public.approved_users
  ALTER COLUMN role TYPE public.app_role USING (
    CASE 
      WHEN role = 'admin' THEN 'admin'::public.app_role
      WHEN role = 'modeler' THEN 'modeler'::public.app_role
      ELSE 'user'::public.app_role
    END
  );

-- Set proper default after conversion
ALTER TABLE public.approved_users ALTER COLUMN role SET DEFAULT 'user'::public.app_role;

-- Plants table
CREATE TABLE IF NOT EXISTS public.plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;

-- Policies for plants
DROP POLICY IF EXISTS "Anyone can view plants" ON public.plants;
CREATE POLICY "Anyone can view plants" ON public.plants FOR SELECT USING (true);

DROP POLICY IF EXISTS "Only admins manage plants" ON public.plants;
CREATE POLICY "Only admins manage plants" ON public.plants FOR ALL
USING (((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
WITH CHECK (((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'));

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  modeler_id UUID NOT NULL,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  supply_chain_model TEXT NOT NULL DEFAULT 'Make-To-Order',
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_modeler_project UNIQUE (modeler_id, name),
  CONSTRAINT chk_supply_chain_model CHECK (supply_chain_model IN ('Make-To-Stock','Make-To-Order'))
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects policies
DROP POLICY IF EXISTS "Projects: selectable by owner, admin, or plant access" ON public.projects;
CREATE POLICY "Projects: selectable by owner, admin, or plant access" ON public.projects FOR SELECT USING (
  modeler_id = public.get_current_user_id()
  OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  OR (
    plant_id IN (
      SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true
    )
  )
);

DROP POLICY IF EXISTS "Projects: modelers create their own projects; admins any" ON public.projects;
CREATE POLICY "Projects: modelers create their own projects; admins any" ON public.projects FOR INSERT WITH CHECK (
  (
    (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'modeler'
    AND modeler_id = public.get_current_user_id()
  )
  OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

DROP POLICY IF EXISTS "Projects: owner or admin can update" ON public.projects;
CREATE POLICY "Projects: owner or admin can update" ON public.projects FOR UPDATE USING (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
) WITH CHECK (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

DROP POLICY IF EXISTS "Projects: owner or admin can delete" ON public.projects;
CREATE POLICY "Projects: owner or admin can delete" ON public.projects FOR DELETE USING (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

-- Updated_at trigger for projects
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Updated_at trigger for plants
DROP TRIGGER IF EXISTS update_plants_updated_at ON public.plants;
CREATE TRIGGER update_plants_updated_at BEFORE UPDATE ON public.plants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();