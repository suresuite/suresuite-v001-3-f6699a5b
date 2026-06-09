-- Create simulation_jobs table for ML service
CREATE TABLE IF NOT EXISTS public.simulation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id TEXT UNIQUE NOT NULL,
    project_id UUID NOT NULL,
    plant_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    job_type TEXT NOT NULL DEFAULT 'baseline_scenario',
    priority INTEGER NOT NULL DEFAULT 1,
    
    -- Request data
    config JSONB NOT NULL DEFAULT '{}',
    scenario_ids UUID[] DEFAULT '{}',
    baseline_enabled BOOLEAN DEFAULT true,
    
    -- Timing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Progress
    progress NUMERIC DEFAULT 0,
    current_stage TEXT,
    
    -- Results
    simulation_result_id UUID,
    partial_results JSONB,
    
    -- Error handling
    error_message TEXT,
    error_details JSONB,
    
    -- Performance
    estimated_duration_seconds INTEGER,
    
    -- Python service integration
    python_job_id TEXT,
    python_status TEXT,
    
    -- Organization/User context
    created_by UUID,
    organization TEXT NOT NULL DEFAULT 'default_org',
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT valid_job_type CHECK (job_type IN ('baseline_only', 'scenario_only', 'baseline_scenario', 'batch')),
    CONSTRAINT valid_priority CHECK (priority >= 1 AND priority <= 10)
);

-- Create simulation_performance_metrics table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.simulation_performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_job_id UUID REFERENCES public.simulation_jobs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Performance data
    execution_time_seconds NUMERIC,
    data_processing_time_seconds NUMERIC,
    cpu_usage_percent NUMERIC,
    memory_usage_mb NUMERIC,
    database_queries INTEGER DEFAULT 0,
    python_service_calls INTEGER DEFAULT 0,
    accuracy_score NUMERIC,
    convergence_iterations INTEGER,
    cache_hit_ratio NUMERIC,
    
    -- Context
    organization TEXT NOT NULL DEFAULT 'default_org',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create simulation_cache table if it doesn't exist  
CREATE TABLE IF NOT EXISTS public.simulation_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    cache_key TEXT NOT NULL,
    cache_type TEXT NOT NULL DEFAULT 'baseline_data',
    data_hash TEXT NOT NULL,
    
    -- Cache data
    data JSONB NOT NULL,
    dependencies TEXT[] DEFAULT '{}',
    data_version INTEGER DEFAULT 1,
    
    -- Cache management
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours'),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    access_count INTEGER DEFAULT 0,
    
    -- Context
    organization TEXT NOT NULL DEFAULT 'default_org',
    
    UNIQUE(project_id, cache_key, data_version)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_status ON public.simulation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_project_id ON public.simulation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_created_at ON public.simulation_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_job_id ON public.simulation_jobs(job_id);

CREATE INDEX IF NOT EXISTS idx_simulation_cache_project_key ON public.simulation_cache(project_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_simulation_cache_expires ON public.simulation_cache(expires_at);

-- Set up RLS policies
ALTER TABLE public.simulation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for simulation_jobs
CREATE POLICY "Simulation jobs: project access view" ON public.simulation_jobs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_jobs.project_id 
            AND p.organization = public.get_current_user_org()
        )
    );

CREATE POLICY "Simulation jobs: project access modify" ON public.simulation_jobs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_jobs.project_id 
            AND p.organization = public.get_current_user_org()
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

-- RLS Policies for simulation_performance_metrics  
CREATE POLICY "Simulation metrics: project access view" ON public.simulation_performance_metrics
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_performance_metrics.project_id 
            AND p.organization = public.get_current_user_org()
        )
    );

CREATE POLICY "Simulation metrics: project access modify" ON public.simulation_performance_metrics
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_performance_metrics.project_id 
            AND p.organization = public.get_current_user_org()
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

-- RLS Policies for simulation_cache
CREATE POLICY "Simulation cache: project access view" ON public.simulation_cache
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_cache.project_id 
            AND p.organization = public.get_current_user_org()
        )
    );

CREATE POLICY "Simulation cache: project access modify" ON public.simulation_cache
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.projects p 
            WHERE p.id = simulation_cache.project_id 
            AND p.organization = public.get_current_user_org()
            AND (p.modeler_id = public.get_current_user_id() OR 
                 (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
        )
    );

-- Add triggers for automatic updates
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_simulation_job_timing
    BEFORE UPDATE ON public.simulation_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_simulation_job_timing();

-- Set up defaults trigger
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_simulation_jobs_defaults
    BEFORE INSERT OR UPDATE ON public.simulation_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.set_simulation_tables_defaults();

CREATE TRIGGER set_simulation_cache_defaults
    BEFORE INSERT OR UPDATE ON public.simulation_cache
    FOR EACH ROW
    EXECUTE FUNCTION public.set_simulation_tables_defaults();

CREATE TRIGGER set_simulation_performance_metrics_defaults
    BEFORE INSERT OR UPDATE ON public.simulation_performance_metrics
    FOR EACH ROW
    EXECUTE FUNCTION public.set_simulation_tables_defaults();