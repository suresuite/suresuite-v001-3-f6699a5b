-- =====================================================================
-- Align the run tables with the app's real auth model.
--
-- This app authenticates through the approved_users RPC flow and ALWAYS
-- calls Supabase with the anon JWT — there is no Supabase Auth session
-- (established precedent: 20260610000002_scenarios_anon_grants.sql,
-- 20260612000001 policy_versions anon policies, 20260703000001
-- dataset_versions anon grants). simulation_runs / run_replications were
-- still authenticated-only, which broke the whole run loop for every
-- user of this app:
--   * sim-command's RLS-scoped insert of the queued run row is denied,
--   * the frontend cannot SELECT runs/replications (and realtime
--     postgres_changes are filtered by SELECT privilege, so live
--     streaming never delivers).
-- The worker is unaffected (service_role).
-- =====================================================================

GRANT SELECT, INSERT, UPDATE ON public.simulation_runs TO anon;
GRANT SELECT ON public.run_replications TO anon;

DROP POLICY IF EXISTS "sim_runs_anon_all" ON public.simulation_runs;
CREATE POLICY "sim_runs_anon_all"
  ON public.simulation_runs FOR ALL TO anon
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "run_replications_anon_read" ON public.run_replications;
CREATE POLICY "run_replications_anon_read"
  ON public.run_replications FOR SELECT TO anon
  USING (true);

SELECT pg_notify('pgrst', 'reload schema');
