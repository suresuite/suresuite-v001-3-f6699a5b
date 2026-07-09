-- Realtime for the run loop — actually applied this time.
--
-- 20260607121406 added simulation_runs / run_replications / scenarios to the
-- supabase_realtime publication, but that file is in the migrations
-- workflow's "mark baseline as applied" range: on this remote it was only
-- RECORDED, never EXECUTED. Proof: a live postgres_changes subscription
-- (verify-sim-e2e run 29007372722+) received zero events for a fresh
-- simulation_runs INSERT even though anon SELECT works. Without publication
-- membership the worker writes rows the UI never sees.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'simulation_runs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.simulation_runs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'run_replications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.run_replications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'scenarios') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scenarios;
  END IF;
END $$;

-- Full old-row images so UPDATE/DELETE events carry every column.
ALTER TABLE public.simulation_runs REPLICA IDENTITY FULL;
ALTER TABLE public.run_replications REPLICA IDENTITY FULL;
ALTER TABLE public.scenarios REPLICA IDENTITY FULL;
