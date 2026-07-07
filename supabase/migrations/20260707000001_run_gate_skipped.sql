-- §8.2: the pre-dispatch validation gate fails open on data-load errors so a
-- transient read never blocks research runs — but the skip must be visible,
-- not buried in function logs. sim-command stamps this flag on the queued
-- run row whenever it dispatched without grading the manifest.
ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS gate_skipped boolean NOT NULL DEFAULT false;

SELECT pg_notify('pgrst', 'reload schema');
