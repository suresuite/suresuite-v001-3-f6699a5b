-- Phase 1: Create simulation_job_magnitudes table to store actual magnitudes used in each simulation
CREATE TABLE public.simulation_job_magnitudes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL,
  project_id UUID NOT NULL,
  scenario_id UUID NOT NULL,
  magnitude NUMERIC NOT NULL,
  magnitude_source TEXT NOT NULL DEFAULT 'database', -- 'ui_current' or 'database'
  effect_type TEXT NOT NULL,
  unit TEXT NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization TEXT NOT NULL DEFAULT 'default_org',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.simulation_job_magnitudes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Same pattern as other simulation tables
CREATE POLICY "Simulation job magnitudes: project access view" 
ON public.simulation_job_magnitudes 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND p.organization = public.get_current_user_org()
  )
);

CREATE POLICY "Simulation job magnitudes: project access modify" 
ON public.simulation_job_magnitudes 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND p.organization = public.get_current_user_org() 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1) = 'admin'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p 
    WHERE p.id = simulation_job_magnitudes.project_id 
    AND p.organization = public.get_current_user_org() 
    AND (
      p.modeler_id = public.get_current_user_id() 
      OR (SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1) = 'admin'
    )
  )
);

-- Add trigger for defaults
CREATE TRIGGER set_simulation_job_magnitudes_defaults
  BEFORE INSERT ON public.simulation_job_magnitudes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_simulation_tables_defaults();

-- Add indexes for performance
CREATE INDEX idx_simulation_job_magnitudes_job_id ON public.simulation_job_magnitudes(job_id);
CREATE INDEX idx_simulation_job_magnitudes_project_scenario ON public.simulation_job_magnitudes(project_id, scenario_id);
CREATE INDEX idx_simulation_job_magnitudes_recorded_at ON public.simulation_job_magnitudes(recorded_at DESC);