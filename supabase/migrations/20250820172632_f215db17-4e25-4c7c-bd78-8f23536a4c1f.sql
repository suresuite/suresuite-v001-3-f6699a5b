-- Streamlined database design: Remove plant-based access, implement organization-centric access

-- 1. Add organization column to supply_chain_data if it doesn't exist
ALTER TABLE public.supply_chain_data 
ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT 'default_org';

-- 2. Create trigger to set organization on supply_chain_data inserts
CREATE OR REPLACE FUNCTION public.set_supply_chain_data_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_org text;
BEGIN
  -- Get user's organization and set it
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;
  
  -- Set uploaded_by to current user if not set
  IF NEW.uploaded_by IS NULL THEN
    NEW.uploaded_by := public.get_current_user_id();
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supply_chain_data_set_defaults ON public.supply_chain_data;
CREATE TRIGGER trg_supply_chain_data_set_defaults
BEFORE INSERT ON public.supply_chain_data
FOR EACH ROW
EXECUTE FUNCTION public.set_supply_chain_data_defaults();

-- 3. Drop old RLS policies for all project-related tables
DROP POLICY IF EXISTS "BOM Multi: viewable by project owner, admin, or plant access" ON public.bom_multi_level;
DROP POLICY IF EXISTS "BOM Multi: modifiers only" ON public.bom_multi_level;
DROP POLICY IF EXISTS "BOM Single: viewable by project owner, admin, or plant access" ON public.bom_single_level;
DROP POLICY IF EXISTS "BOM Single: modifiers only" ON public.bom_single_level;
DROP POLICY IF EXISTS "Inbound: viewable by project owner, admin, or plant access" ON public.inbound_logistics;
DROP POLICY IF EXISTS "Inbound: modifiers only" ON public.inbound_logistics;
DROP POLICY IF EXISTS "Outbound: viewable by project owner, admin, or plant access" ON public.outbound_logistics;
DROP POLICY IF EXISTS "Outbound: modifiers only" ON public.outbound_logistics;
DROP POLICY IF EXISTS "Multi-tier: viewable by project owner, admin, or plant access" ON public.multi_tier_supply_chain;
DROP POLICY IF EXISTS "Multi-tier: modifiers only" ON public.multi_tier_supply_chain;

-- 4. Create new organization-based RLS policies for BOM Multi Level
CREATE POLICY "BOM Multi: organization access" 
ON public.bom_multi_level FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "BOM Multi: modifiers only" 
ON public.bom_multi_level FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_multi_level.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

-- 5. Create new organization-based RLS policies for BOM Single Level
CREATE POLICY "BOM Single: organization access" 
ON public.bom_single_level FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "BOM Single: modifiers only" 
ON public.bom_single_level FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = bom_single_level.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

-- 6. Create new organization-based RLS policies for Inbound Logistics
CREATE POLICY "Inbound: organization access" 
ON public.inbound_logistics FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "Inbound: modifiers only" 
ON public.inbound_logistics FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = inbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

-- 7. Create new organization-based RLS policies for Outbound Logistics
CREATE POLICY "Outbound: organization access" 
ON public.outbound_logistics FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "Outbound: modifiers only" 
ON public.outbound_logistics FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = outbound_logistics.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

-- 8. Create new organization-based RLS policies for Multi-tier Supply Chain
CREATE POLICY "Multi-tier: organization access" 
ON public.multi_tier_supply_chain FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "Multi-tier: modifiers only" 
ON public.multi_tier_supply_chain FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = multi_tier_supply_chain.project_id 
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT user_role FROM public.get_current_approved_user() LIMIT 1
    ) = 'admin')
  )
);

-- 9. Update supply_chain_data RLS policies for organization-based access
DROP POLICY IF EXISTS "Users can view supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can update their own supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can delete their own supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Anyone can insert supply chain data" ON public.supply_chain_data;

CREATE POLICY "Organization users can view supply chain data" 
ON public.supply_chain_data FOR SELECT 
USING (
  organization = public.get_current_user_org() OR 
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

CREATE POLICY "Organization users can insert supply chain data" 
ON public.supply_chain_data FOR INSERT 
WITH CHECK (organization = public.get_current_user_org());

CREATE POLICY "Users can update their own or org admin can update all" 
ON public.supply_chain_data FOR UPDATE 
USING (
  (uploaded_by = public.get_current_user_id() AND organization = public.get_current_user_org()) OR 
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

CREATE POLICY "Users can delete their own or org admin can delete all" 
ON public.supply_chain_data FOR DELETE 
USING (
  (uploaded_by = public.get_current_user_id() AND organization = public.get_current_user_org()) OR 
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

-- 10. Remove plant-related functions and triggers
DROP FUNCTION IF EXISTS public.upsert_user_plant_access_from_scd() CASCADE;

-- 11. Drop the plant-related tables (this will remove all data)
DROP TABLE IF EXISTS public.user_plant_access CASCADE;
DROP TABLE IF EXISTS public.plants CASCADE;