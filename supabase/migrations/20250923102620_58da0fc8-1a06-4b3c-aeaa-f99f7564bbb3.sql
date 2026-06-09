-- Add missing trigger for simulation_results table
CREATE TRIGGER set_simulation_results_defaults_trigger
  BEFORE INSERT ON public.simulation_results
  FOR EACH ROW EXECUTE FUNCTION public.set_simulation_results_defaults();

-- Backfill existing NULL created_by records by joining with simulation_jobs
UPDATE public.simulation_results sr
SET created_by = sj.created_by,
    updated_at = now()
FROM public.simulation_jobs sj
WHERE sr.project_id = sj.project_id
  AND sr.scenario_ids = sj.scenario_ids
  AND sr.created_by IS NULL
  AND sj.created_by IS NOT NULL;