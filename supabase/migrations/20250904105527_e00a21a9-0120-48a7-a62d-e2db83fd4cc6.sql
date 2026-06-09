-- Create network_nodes table for deep tier analysis
CREATE TABLE public.network_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Node data columns from template
  uid text NOT NULL,
  depth integer,
  name text,
  country text,
  industry text,
  website text,
  traded_as text,
  number_of_employees integer,
  revenue numeric,
  lat numeric,
  long numeric,
  is_seed boolean DEFAULT false
);

-- Create network_edges table for deep tier analysis
CREATE TABLE public.network_edges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Edge data columns from template
  src_uid text NOT NULL,
  dst_uid text NOT NULL,
  relation_type text,
  relative_revenue numeric,
  relative_revenue_percentage numeric,
  depth integer,
  direction text
);

-- Create network_summary table for deep tier analysis
CREATE TABLE public.network_summary (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Summary data columns
  nodes_count integer,
  edges_count integer,
  tiers_data jsonb -- For tier distribution like {"0": 1, "1": 135, "2": 528}
);

-- Enable RLS on all tables
ALTER TABLE public.network_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_summary ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for network_nodes (same pattern as supply_chain_data)
CREATE POLICY "Network nodes: project access view" 
ON public.network_nodes 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Network nodes: project access insert" 
ON public.network_nodes 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network nodes: project access update" 
ON public.network_nodes 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network nodes: project access delete" 
ON public.network_nodes 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_nodes.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Create RLS policies for network_edges
CREATE POLICY "Network edges: project access view" 
ON public.network_edges 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Network edges: project access insert" 
ON public.network_edges 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network edges: project access update" 
ON public.network_edges 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network edges: project access delete" 
ON public.network_edges 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_edges.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Create RLS policies for network_summary
CREATE POLICY "Network summary: project access view" 
ON public.network_summary 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Network summary: project access insert" 
ON public.network_summary 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network summary: project access update" 
ON public.network_summary 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

CREATE POLICY "Network summary: project access delete" 
ON public.network_summary 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM projects p 
  WHERE p.id = network_summary.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Create triggers for default values (same pattern as other tables)
CREATE OR REPLACE FUNCTION public.set_network_data_defaults()
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

-- Apply triggers to all network tables
CREATE TRIGGER set_network_nodes_defaults
  BEFORE INSERT ON public.network_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_network_data_defaults();

CREATE TRIGGER set_network_edges_defaults
  BEFORE INSERT ON public.network_edges
  FOR EACH ROW EXECUTE FUNCTION public.set_network_data_defaults();

CREATE TRIGGER set_network_summary_defaults
  BEFORE INSERT ON public.network_summary
  FOR EACH ROW EXECUTE FUNCTION public.set_network_data_defaults();

-- Update project completion trigger to include deep tier datasets
CREATE OR REPLACE FUNCTION public.update_project_completion_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE 
  has_bom BOOLEAN; 
  has_inbound BOOLEAN; 
  has_outbound BOOLEAN; 
  has_deep_tier_nodes BOOLEAN;
  has_deep_tier_edges BOOLEAN;
  has_deep_tier_summary BOOLEAN;
  deep_tier_enabled BOOLEAN;
  pid UUID;
BEGIN
  pid := COALESCE(NEW.project_id, OLD.project_id);

  -- Get deep tier setting for this project
  SELECT p.deep_tier_enabled INTO deep_tier_enabled
  FROM public.projects p 
  WHERE p.id = pid;

  -- Check if BOM exists (either single or multi-level)
  SELECT (
    EXISTS(SELECT 1 FROM public.bom_single_level WHERE project_id = pid) 
    OR EXISTS(SELECT 1 FROM public.bom_multi_level WHERE project_id = pid)
  ) INTO has_bom;

  -- Check other datasets
  SELECT EXISTS(SELECT 1 FROM public.inbound_logistics WHERE project_id = pid) INTO has_inbound;
  SELECT EXISTS(SELECT 1 FROM public.outbound_logistics WHERE project_id = pid) INTO has_outbound;

  -- If deep tier is enabled, check for deep tier datasets
  IF deep_tier_enabled THEN
    SELECT EXISTS(SELECT 1 FROM public.network_nodes WHERE project_id = pid) INTO has_deep_tier_nodes;
    SELECT EXISTS(SELECT 1 FROM public.network_edges WHERE project_id = pid) INTO has_deep_tier_edges;
    SELECT EXISTS(SELECT 1 FROM public.network_summary WHERE project_id = pid) INTO has_deep_tier_summary;
    
    -- Update completion status including deep tier requirements
    UPDATE public.projects 
    SET completed = (has_bom AND has_inbound AND has_outbound AND has_deep_tier_nodes AND has_deep_tier_edges AND has_deep_tier_summary), 
        updated_at = now() 
    WHERE id = pid;
  ELSE
    -- Update completion status without deep tier requirements
    UPDATE public.projects 
    SET completed = (has_bom AND has_inbound AND has_outbound), 
        updated_at = now() 
    WHERE id = pid;
  END IF;

  RETURN NULL;
END;
$$;

-- Add triggers for the new tables to update completion status
CREATE TRIGGER update_completion_on_network_nodes_change
  AFTER INSERT OR UPDATE OR DELETE ON public.network_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER update_completion_on_network_edges_change
  AFTER INSERT OR UPDATE OR DELETE ON public.network_edges
  FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();

CREATE TRIGGER update_completion_on_network_summary_change
  AFTER INSERT OR UPDATE OR DELETE ON public.network_summary
  FOR EACH ROW EXECUTE FUNCTION public.update_project_completion_status();