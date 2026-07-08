-- The simulation now runs in a Vercel Python function (api/run_simulation.py)
-- instead of the never-deployed Fly worker; the BROWSER persists the results
-- it returns. That means anon (the app's only role — see 20260706000001)
-- must be able to write run_replications, not just read it. simulation_runs
-- already got anon FOR ALL in 20260706000001; this extends the same posture
-- to the per-replication rows so the whole result set lands from the client.
GRANT SELECT, INSERT, UPDATE ON public.run_replications TO anon;

DROP POLICY IF EXISTS "run_replications_anon_read" ON public.run_replications;
DROP POLICY IF EXISTS "run_replications_anon_write" ON public.run_replications;
CREATE POLICY "run_replications_anon_write"
  ON public.run_replications FOR ALL TO anon
  USING (true) WITH CHECK (true);

SELECT pg_notify('pgrst', 'reload schema');
