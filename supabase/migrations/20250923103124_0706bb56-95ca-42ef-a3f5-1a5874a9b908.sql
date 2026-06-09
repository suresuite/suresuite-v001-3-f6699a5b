-- Corrected backfill for remaining NULL created_by records in simulation_results
-- Use the proper foreign key relationship instead of matching on scenario arrays

UPDATE public.simulation_results sr
SET created_by = sj.created_by,
    updated_at = now()
FROM public.simulation_jobs sj
WHERE sj.simulation_result_id = sr.id
  AND sr.created_by IS NULL
  AND sj.created_by IS NOT NULL;