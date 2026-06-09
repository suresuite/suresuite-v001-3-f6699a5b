-- Create dataset tables with proper RLS and plant linkage
CREATE TABLE IF NOT EXISTS public.bom_single_level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_name TEXT NOT NULL, -- Store plant name as text to match projects.plant_name
  product_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  consumption_rate NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bom_multi_level (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plant_name TEXT NOT NULL,
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
  plant_name TEXT NOT NULL,
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
  plant_name TEXT NOT NULL,
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
  plant_name TEXT NOT NULL,
  from_firm_id TEXT NOT NULL,
  to_firm_id TEXT NOT NULL,
  to_firm_tier INT,
  to_firm_relationship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all dataset tables
ALTER TABLE public.bom_single_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_multi_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multi_tier_supply_chain ENABLE ROW LEVEL SECURITY;

-- Dataset access policies (select) - based on project ownership/access
CREATE POLICY "BOM Single: viewable by project owner, admin, or plant access" ON public.bom_single_level FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      OR p.plant_name IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)
    )
  )
);

CREATE POLICY "BOM Multi: viewable by project owner, admin, or plant access" ON public.bom_multi_level FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      OR p.plant_name IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)
    )
  )
);

CREATE POLICY "Inbound: viewable by project owner, admin, or plant access" ON public.inbound_logistics FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      OR p.plant_name IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)
    )
  )
);

CREATE POLICY "Outbound: viewable by project owner, admin, or plant access" ON public.outbound_logistics FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      OR p.plant_name IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)
    )
  )
);

CREATE POLICY "Multi-tier: viewable by project owner, admin, or plant access" ON public.multi_tier_supply_chain FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      OR p.plant_name IN (SELECT plant FROM public.user_plant_access WHERE user_id = public.get_current_user_id() AND can_view = true)
    )
  )
);

-- Dataset modification policies (modelers and admins only)
CREATE POLICY "BOM Single: modifiers only" ON public.bom_single_level FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
);

CREATE POLICY "BOM Multi: modifiers only" ON public.bom_multi_level FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
);

CREATE POLICY "Inbound: modifiers only" ON public.inbound_logistics FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
);

CREATE POLICY "Outbound: modifiers only" ON public.outbound_logistics FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
);

CREATE POLICY "Multi-tier: modifiers only" ON public.multi_tier_supply_chain FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = project_id 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
    )
  )
);

-- Trigger function to enforce dataset plant matches project plant
CREATE OR REPLACE FUNCTION public.ensure_dataset_plant_matches_project()
RETURNS TRIGGER AS $$
DECLARE proj_plant TEXT;
BEGIN
  SELECT plant_name INTO proj_plant FROM public.projects WHERE id = NEW.project_id;
  IF proj_plant IS NULL THEN
    RAISE EXCEPTION 'Invalid project_id %', NEW.project_id;
  END IF;
  IF NEW.plant_name IS DISTINCT FROM proj_plant THEN
    RAISE EXCEPTION 'Dataset plant_name % does not match project plant_name %', NEW.plant_name, proj_plant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply plant matching triggers
DROP TRIGGER IF EXISTS bom_sl_plant_match ON public.bom_single_level;
CREATE TRIGGER bom_sl_plant_match
BEFORE INSERT OR UPDATE ON public.bom_single_level
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

DROP TRIGGER IF EXISTS bom_ml_plant_match ON public.bom_multi_level;
CREATE TRIGGER bom_ml_plant_match
BEFORE INSERT OR UPDATE ON public.bom_multi_level
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

DROP TRIGGER IF EXISTS inbound_plant_match ON public.inbound_logistics;
CREATE TRIGGER inbound_plant_match
BEFORE INSERT OR UPDATE ON public.inbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

DROP TRIGGER IF EXISTS outbound_plant_match ON public.outbound_logistics;
CREATE TRIGGER outbound_plant_match
BEFORE INSERT OR UPDATE ON public.outbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

DROP TRIGGER IF EXISTS multi_tier_plant_match ON public.multi_tier_supply_chain;
CREATE TRIGGER multi_tier_plant_match
BEFORE INSERT OR UPDATE ON public.multi_tier_supply_chain
FOR EACH ROW EXECUTE FUNCTION public.ensure_dataset_plant_matches_project();

-- Completion status function
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS TRIGGER AS $$
DECLARE 
  has_bom BOOLEAN; 
  has_inbound BOOLEAN; 
  has_outbound BOOLEAN; 
  has_multi BOOLEAN; 
  pid UUID;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);
  
  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;
  
  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;
  SELECT EXISTS(SELECT 1 FROM public.multi_tier_supply_chain WHERE project_id = pid) INTO has_multi;

  -- Update completion status
  UPDATE public.projects 
  SET completed = (has_bom AND has_inbound AND has_outbound AND has_multi), 
      updated_at = now() 
  WHERE id = pid;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply completion triggers
DROP TRIGGER IF EXISTS bom_sl_completion ON public.bom_single_level;
CREATE TRIGGER bom_sl_completion
AFTER INSERT OR DELETE OR UPDATE ON public.bom_single_level
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

DROP TRIGGER IF EXISTS bom_ml_completion ON public.bom_multi_level;
CREATE TRIGGER bom_ml_completion
AFTER INSERT OR DELETE OR UPDATE ON public.bom_multi_level
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

DROP TRIGGER IF EXISTS inbound_completion ON public.inbound_logistics;
CREATE TRIGGER inbound_completion
AFTER INSERT OR DELETE OR UPDATE ON public.inbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

DROP TRIGGER IF EXISTS outbound_completion ON public.outbound_logistics;
CREATE TRIGGER outbound_completion
AFTER INSERT OR DELETE OR UPDATE ON public.outbound_logistics
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

DROP TRIGGER IF EXISTS multi_tier_completion ON public.multi_tier_supply_chain;
CREATE TRIGGER multi_tier_completion
AFTER INSERT OR DELETE OR UPDATE ON public.multi_tier_supply_chain
FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

-- Updated_at triggers for dataset tables
DROP TRIGGER IF EXISTS update_bom_sl_updated_at ON public.bom_single_level;
CREATE TRIGGER update_bom_sl_updated_at BEFORE UPDATE ON public.bom_single_level FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bom_ml_updated_at ON public.bom_multi_level;
CREATE TRIGGER update_bom_ml_updated_at BEFORE UPDATE ON public.bom_multi_level FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_inbound_updated_at ON public.inbound_logistics;
CREATE TRIGGER update_inbound_updated_at BEFORE UPDATE ON public.inbound_logistics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_outbound_updated_at ON public.outbound_logistics;
CREATE TRIGGER update_outbound_updated_at BEFORE UPDATE ON public.outbound_logistics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_multi_tier_updated_at ON public.multi_tier_supply_chain;
CREATE TRIGGER update_multi_tier_updated_at BEFORE UPDATE ON public.multi_tier_supply_chain FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();