-- Create disruption scenarios table
CREATE TABLE public.disruption_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  plant_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  capacity_reduction_percent NUMERIC DEFAULT 0,
  time_delay_days NUMERIC DEFAULT 0,
  description TEXT,
  created_by UUID,
  organization TEXT NOT NULL DEFAULT 'default_org',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create simulation results table
CREATE TABLE public.simulation_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  plant_name TEXT NOT NULL,
  scenario_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_data JSONB,
  metrics JSONB,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  organization TEXT NOT NULL DEFAULT 'default_org',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.disruption_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_results ENABLE ROW LEVEL SECURITY;

-- RLS policies for disruption_scenarios
CREATE POLICY "Disruption scenarios: organization access view" 
ON public.disruption_scenarios 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Disruption scenarios: project access modify" 
ON public.disruption_scenarios 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = disruption_scenarios.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- RLS policies for simulation_results
CREATE POLICY "Simulation results: organization access view" 
ON public.simulation_results 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND p.organization = get_current_user_org()
));

CREATE POLICY "Simulation results: project access modify" 
ON public.simulation_results 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p 
  WHERE p.id = simulation_results.project_id 
  AND p.organization = get_current_user_org() 
  AND (p.modeler_id = get_current_user_id() OR (
    SELECT user_role FROM get_current_approved_user() LIMIT 1
  ) = 'admin')
));

-- Triggers for updated_at
CREATE TRIGGER update_disruption_scenarios_updated_at
  BEFORE UPDATE ON public.disruption_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_simulation_results_updated_at
  BEFORE UPDATE ON public.simulation_results
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Set organization defaults
CREATE TRIGGER set_disruption_scenarios_defaults
  BEFORE INSERT ON public.disruption_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.set_supply_chain_data_defaults();

CREATE TRIGGER set_simulation_results_defaults
  BEFORE INSERT ON public.simulation_results
  FOR EACH ROW
  EXECUTE FUNCTION public.set_supply_chain_data_defaults();