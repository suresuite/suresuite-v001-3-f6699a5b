-- Roles enum (convert approved_users.role to enum)
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','modeler','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.approved_users
  ALTER COLUMN role TYPE public.app_role USING (
    CASE WHEN role IN ('admin','modeler','user') THEN role::public.app_role ELSE 'user'::public.app_role END
  ),
  ALTER COLUMN role SET DEFAULT 'user'::public.app_role;

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

-- Dataset tables
CREATE TABLE IF NOT EXISTS public.bom_single_level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  consumption_rate NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bom_multi_level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  material_id TEXT NOT NULL,
  level INT NOT NULL,
  higher_level_component_id TEXT,
  consumption_rate NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_logistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  volume NUMERIC,
  time_unit TEXT,
  lead_time NUMERIC,
  unit_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outbound_logistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  volume NUMERIC,
  time_unit TEXT,
  expected_lead_time NUMERIC,
  unit_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.multi_tier_supply_chain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
  from_firm_id TEXT NOT NULL,
  to_firm_id TEXT NOT NULL,
  to_firm_tier INT,
  to_firm_relationship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on datasets
ALTER TABLE public.bom_single_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_multi_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multi_tier_supply_chain ENABLE ROW LEVEL SECURITY;

-- Dataset policies (select) - using correct syntax
CREATE POLICY "Datasets: selectable by project owner, admin, or plant access" ON public.bom_single_level FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR p.plant_id IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)))
);
CREATE POLICY "Datasets: selectable by project owner, admin, or plant access (ml)" ON public.bom_multi_level FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR p.plant_id IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)))
);
CREATE POLICY "Datasets: selectable by project owner, admin, or plant access (inbound)" ON public.inbound_logistics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR p.plant_id IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)))
);
CREATE POLICY "Datasets: selectable by project owner, admin, or plant access (outbound)" ON public.outbound_logistics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR p.plant_id IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)))
);
CREATE POLICY "Datasets: selectable by project owner, admin, or plant access (multi-tier)" ON public.multi_tier_supply_chain FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR p.plant_id IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)))
);

-- Dataset policies (insert/update/delete) - owner or admin
CREATE POLICY "Datasets: owner or admin can insert" ON public.bom_single_level FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can update" ON public.bom_single_level FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can delete" ON public.bom_single_level FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

CREATE POLICY "Datasets: owner or admin can insert (ml)" ON public.bom_multi_level FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can update (ml)" ON public.bom_multi_level FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can delete (ml)" ON public.bom_multi_level FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

CREATE POLICY "Datasets: owner or admin can insert (inbound)" ON public.inbound_logistics FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can update (inbound)" ON public.inbound_logistics FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can delete (inbound)" ON public.inbound_logistics FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

CREATE POLICY "Datasets: owner or admin can insert (outbound)" ON public.outbound_logistics FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can update (outbound)" ON public.outbound_logistics FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can delete (outbound)" ON public.outbound_logistics FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

CREATE POLICY "Datasets: owner or admin can insert (multi-tier)" ON public.multi_tier_supply_chain FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can update (multi-tier)" ON public.multi_tier_supply_chain FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);
CREATE POLICY "Datasets: owner or admin can delete (multi-tier)" ON public.multi_tier_supply_chain FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.modeler_id = public.get_current_user_id() OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'))
);

-- Trigger to enforce dataset plant matches project
CREATE OR REPLACE FUNCTION public.ensure_dataset_plant_matches_project()
RETURNS TRIGGER AS $$
DECLARE proj_plant UUID;
BEGIN
  SELECT plant_id INTO proj_plant FROM public.projects WHERE id = NEW.project_id;
  IF proj_plant IS NULL THEN
    RAISE EXCEPTION 'Invalid project_id %', NEW.project_id;
  END IF;
  IF NEW.plant_id IS DISTINCT FROM proj_plant THEN
    RAISE EXCEPTION 'Dataset plant_id % does not match project plant_id %', NEW.plant_id, proj_plant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER bom_sl_plant_match
BEFORE INSERT OR UPDATE ON public.bom_single_level
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

CREATE TRIGGER bom_ml_plant_match
BEFORE INSERT OR UPDATE ON public.bom_multi_level
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

CREATE TRIGGER inbound_plant_match
BEFORE INSERT OR UPDATE ON public.inbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

CREATE TRIGGER outbound_plant_match
BEFORE INSERT OR UPDATE ON public.outbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

CREATE TRIGGER multi_tier_plant_match
BEFORE INSERT OR UPDATE ON public.multi_tier_supply_chain
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

-- Completion status updater
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS TRIGGER AS $$
DECLARE has_bom BOOLEAN; DECLARE has_inbound BOOLEAN; DECLARE has_outbound BOOLEAN; DECLARE has_multi BOOLEAN; DECLARE pid UUID;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);
  SELECT (EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid) OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)) INTO has_bom;
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;
  SELECT EXISTS(SELECT 1 FROM public.multi_tier_supply_chain WHERE project_id = pid) INTO has_multi;

  UPDATE public.projects SET completed = (has_bom AND has_inbound AND has_outbound AND has_multi), updated_at = now() WHERE id = pid;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER bom_sl_completion
AFTER INSERT OR DELETE OR UPDATE ON public.bom_single_level
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER bom_ml_completion
AFTER INSERT OR DELETE OR UPDATE ON public.bom_multi_level
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER inbound_completion
AFTER INSERT OR DELETE OR UPDATE ON public.inbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER outbound_completion
AFTER INSERT OR DELETE OR UPDATE ON public.outbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER multi_tier_completion
AFTER INSERT OR DELETE OR UPDATE ON public.multi_tier_supply_chain
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

-- Updated_at triggers
CREATE TRIGGER update_plants_updated_at BEFORE UPDATE ON public.plants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bom_sl_updated_at BEFORE UPDATE ON public.bom_single_level FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bom_ml_updated_at BEFORE UPDATE ON public.bom_multi_level FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inbound_updated_at BEFORE UPDATE ON public.inbound_logistics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_outbound_updated_at BEFORE UPDATE ON public.outbound_logistics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_multi_tier_updated_at BEFORE UPDATE ON public.multi_tier_supply_chain FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();