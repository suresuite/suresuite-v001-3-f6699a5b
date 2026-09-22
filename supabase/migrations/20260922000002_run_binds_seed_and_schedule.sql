-- Audit 2026-09-22 · WP 8 · F-11 / D-3: a run records the seed and the
-- disruption schedule it RAN, stamped by the dispatcher when the run is queued.
--
-- The run-results workbook bound `scenarios.seed` from the LIVE row, so editing
-- a scenario's seed after a run rebound the new seed to the old figures while
-- the reproducibility record still computed `reproducible = true`. The schedule
-- was not bound at all. `scenario_hash` cannot answer either question: it is the
-- baseline fingerprint and deliberately excludes events and estimation settings.
--
-- Both columns are NULLABLE with no default: a run dispatched before this
-- migration carries NULL, which the export treats as "not stamped" and resolves
-- only through the row-unchanged guard sim-command's reuse check already uses
-- (`scenarios.updated_at <= simulation_runs.created_at`). A default would stamp
-- a value no dispatcher wrote — a fabricated binding.
ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS seed bigint,
  ADD COLUMN IF NOT EXISTS disruption_schedule jsonb;

COMMENT ON COLUMN public.simulation_runs.seed IS
  'The scenario seed this run was dispatched with (stamped by sim-command). NULL = dispatched before stamping.';
COMMENT ON COLUMN public.simulation_runs.disruption_schedule IS
  'The disruption schedule this run was dispatched with (stamped by sim-command). NULL = dispatched before stamping.';

SELECT pg_notify('pgrst', 'reload schema');
