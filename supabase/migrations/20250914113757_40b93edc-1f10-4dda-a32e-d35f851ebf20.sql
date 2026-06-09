-- Fix existing simulation_jobs table structure
-- First check if job_id column exists, if not add it
DO $$
BEGIN
  -- Add job_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'simulation_jobs' AND column_name = 'job_id'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD COLUMN job_id TEXT;
  END IF;
  
  -- Update job_id to be id if null
  UPDATE public.simulation_jobs SET job_id = id::text WHERE job_id IS NULL;
  
  -- Add unique constraint if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc 
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'simulation_jobs' 
    AND kcu.column_name = 'job_id' AND tc.constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD CONSTRAINT simulation_jobs_job_id_key UNIQUE (job_id);
  END IF;
END $$;

-- Add missing columns to simulation_jobs if they don't exist
DO $$
BEGIN
  -- Add current_stage column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'simulation_jobs' AND column_name = 'current_stage'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD COLUMN current_stage TEXT;
  END IF;

  -- Add python_job_id and python_status columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'simulation_jobs' AND column_name = 'python_job_id'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD COLUMN python_job_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'simulation_jobs' AND column_name = 'python_status'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD COLUMN python_status TEXT;
  END IF;

  -- Add queued_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'simulation_jobs' AND column_name = 'queued_at'
  ) THEN
    ALTER TABLE public.simulation_jobs ADD COLUMN queued_at TIMESTAMP WITH TIME ZONE DEFAULT now();
  END IF;
END $$;

-- Create indexes for performance if they don't exist
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_job_id ON public.simulation_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_status ON public.simulation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_project_id ON public.simulation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_simulation_jobs_created_at ON public.simulation_jobs(created_at);