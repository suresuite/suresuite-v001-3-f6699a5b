-- Phase 1: Enhanced Database Schema for Simulation Management

-- Create simulation_jobs table for background processing
CREATE TABLE public.simulation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  simulation_result_id UUID REFERENCES public.simulation_results(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'baseline_scenario',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 1,
  progress NUMERIC DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  
  -- Job configuration
  config JSONB NOT NULL DEFAULT '{}',
  scenario_ids UUID[] DEFAULT '{}',
  baseline_enabled BOOLEAN DEFAULT true,
  
  -- Python service integration
  python_job_id TEXT,
  python_status TEXT,
  
  -- Timing
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  estimated_duration_seconds INTEGER,
  
  -- Results and errors
  error_message TEXT,
  error_details JSONB,
  partial_results JSONB,
  
  -- Metadata
  created_by UUID,
  organization TEXT NOT NULL DEFAULT 'default_org',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create simulation_cache table for performance optimization
CREATE TABLE public.simulation_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  cache_type TEXT NOT NULL DEFAULT 'baseline_data' CHECK (cache_type IN ('baseline_data', 'scenario_data', 'network_analysis', 'risk_factors')),
  
  -- Cache data
  data JSONB NOT NULL,
  data_hash TEXT NOT NULL,
  
  -- Cache metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Versioning
  data_version INTEGER DEFAULT 1,
  dependencies TEXT[] DEFAULT '{}',
  
  -- Organization
  organization TEXT NOT NULL DEFAULT 'default_org',
  
  UNIQUE(project_id, cache_key)
);

-- Create simulation_performance_metrics for monitoring
CREATE TABLE public.simulation_performance_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_job_id UUID REFERENCES public.simulation_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  
  -- Performance data
  execution_time_seconds NUMERIC,
  memory_usage_mb NUMERIC,
  cpu_usage_percent NUMERIC,
  data_processing_time_seconds NUMERIC,
  cache_hit_ratio NUMERIC,
  
  -- Quality metrics
  convergence_iterations INTEGER,
  accuracy_score NUMERIC,
  
  -- Resource usage
  python_service_calls INTEGER DEFAULT 0,
  database_queries INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization TEXT NOT NULL DEFAULT 'default_org'
);

-- Add indexes for performance
CREATE INDEX idx_simulation_jobs_project_status ON public.simulation_jobs(project_id, status);
CREATE INDEX idx_simulation_jobs_queue ON public.simulation_jobs(status, priority DESC, queued_at);
CREATE INDEX idx_simulation_cache_lookup ON public.simulation_cache(project_id, cache_key, expires_at);
CREATE INDEX idx_simulation_cache_cleanup ON public.simulation_cache(expires_at);

-- Enable RLS for all new tables
ALTER TABLE public.simulation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_performance_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for simulation_jobs
CREATE POLICY "Simulation jobs: project access view" ON public.simulation_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_jobs.project_id 
      AND p.organization = get_current_user_org()
    )
  );

CREATE POLICY "Simulation jobs: project access modify" ON public.simulation_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_jobs.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_jobs.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

-- RLS Policies for simulation_cache
CREATE POLICY "Simulation cache: project access view" ON public.simulation_cache
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_cache.project_id 
      AND p.organization = get_current_user_org()
    )
  );

CREATE POLICY "Simulation cache: project access modify" ON public.simulation_cache
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_cache.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_cache.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

-- RLS Policies for simulation_performance_metrics
CREATE POLICY "Simulation metrics: project access view" ON public.simulation_performance_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_performance_metrics.project_id 
      AND p.organization = get_current_user_org()
    )
  );

CREATE POLICY "Simulation metrics: project access modify" ON public.simulation_performance_metrics
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_performance_metrics.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p 
      WHERE p.id = simulation_performance_metrics.project_id 
      AND p.organization = get_current_user_org()
      AND (p.modeler_id = get_current_user_id() OR 
           (SELECT user_role FROM get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

-- Triggers for automatic field population
CREATE OR REPLACE FUNCTION public.set_simulation_tables_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'simulation_jobs' THEN
    IF NEW.organization IS NULL THEN
      NEW.organization := public.get_current_user_org();
    END IF;
    IF NEW.created_by IS NULL THEN
      NEW.created_by := public.get_current_user_id();
    END IF;
    NEW.updated_at := now();
  END IF;
  
  IF TG_TABLE_NAME = 'simulation_cache' THEN
    IF NEW.organization IS NULL THEN
      NEW.organization := public.get_current_user_org();
    END IF;
    NEW.last_accessed_at := now();
  END IF;
  
  IF TG_TABLE_NAME = 'simulation_performance_metrics' THEN
    IF NEW.organization IS NULL THEN
      NEW.organization := public.get_current_user_org();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create triggers
CREATE TRIGGER simulation_jobs_defaults
  BEFORE INSERT OR UPDATE ON public.simulation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_simulation_tables_defaults();

CREATE TRIGGER simulation_cache_defaults
  BEFORE INSERT OR UPDATE ON public.simulation_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_simulation_tables_defaults();

CREATE TRIGGER simulation_performance_metrics_defaults
  BEFORE INSERT OR UPDATE ON public.simulation_performance_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_simulation_tables_defaults();

-- Add status update trigger for simulation_jobs
CREATE OR REPLACE FUNCTION public.update_simulation_job_timing()
RETURNS TRIGGER AS $$
BEGIN
  -- Update timing based on status changes
  IF OLD.status != NEW.status THEN
    CASE NEW.status
      WHEN 'running' THEN
        NEW.started_at := COALESCE(NEW.started_at, now());
      WHEN 'completed', 'failed', 'cancelled' THEN
        NEW.completed_at := COALESCE(NEW.completed_at, now());
    END CASE;
  END IF;
  
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER simulation_job_timing_trigger
  BEFORE UPDATE ON public.simulation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_simulation_job_timing();

-- Function for cache cleanup
CREATE OR REPLACE FUNCTION public.cleanup_simulation_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.simulation_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;