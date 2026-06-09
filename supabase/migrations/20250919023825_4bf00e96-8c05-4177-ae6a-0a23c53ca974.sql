-- Remove duplicate external simulation trigger and its function
DROP TRIGGER IF EXISTS external_simulation_trigger ON public.simulation_jobs;
DROP FUNCTION IF EXISTS public.trigger_external_simulation();