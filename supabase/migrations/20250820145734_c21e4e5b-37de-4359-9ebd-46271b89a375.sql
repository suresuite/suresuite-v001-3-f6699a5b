-- First check and fix the user_plant_access table to ensure plant column is text
-- This is needed to align with supply_chain_data.plant which is text

-- Create roles enum first
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','modeler','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Temporarily remove default on approved_users.role
ALTER TABLE public.approved_users ALTER COLUMN role DROP DEFAULT;

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

-- Policies for plants - anyone can view, only admins manage
CREATE POLICY "Anyone can view plants" ON public.plants FOR SELECT USING (true);

CREATE POLICY "Only admins manage plants" ON public.plants FOR ALL
USING (((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
WITH CHECK (((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'));

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  modeler_id UUID NOT NULL,
  plant_name TEXT NOT NULL, -- Store plant name directly as text like supply_chain_data.plant
  supply_chain_model TEXT NOT NULL DEFAULT 'Make-To-Order',
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_modeler_project UNIQUE (modeler_id, name),
  CONSTRAINT chk_supply_chain_model CHECK (supply_chain_model IN ('Make-To-Stock','Make-To-Order'))
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects policies (using text plant names)
CREATE POLICY "Projects: selectable by owner, admin, or plant access" ON public.projects FOR SELECT USING (
  modeler_id = public.get_current_user_id()
  OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  OR (
    plant_name IN (
      SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true
    )
  )
);

CREATE POLICY "Projects: modelers create their own projects; admins any" ON public.projects FOR INSERT WITH CHECK (
  (
    (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'modeler'
    AND modeler_id = public.get_current_user_id()
  )
  OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

CREATE POLICY "Projects: owner or admin can update" ON public.projects FOR UPDATE USING (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
) WITH CHECK (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

CREATE POLICY "Projects: owner or admin can delete" ON public.projects FOR DELETE USING (
  modeler_id = public.get_current_user_id() OR ((SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
);

-- Add updated_at triggers
DROP TRIGGER IF EXISTS update_plants_updated_at ON public.plants;
CREATE TRIGGER update_plants_updated_at BEFORE UPDATE ON public.plants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();