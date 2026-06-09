-- Grant anon full access to the scenarios table so SimulationLab's
-- direct-table writes (useScenarios.create, createFromNode) work with
-- the app's anon JWT.  The table has no sensitive data and uses the
-- same permissive policy already in place for authenticated users.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO anon;

DROP POLICY IF EXISTS "scenarios_anon_all" ON public.scenarios;
CREATE POLICY "scenarios_anon_all"
  ON public.scenarios FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- snapshot_policy is SECURITY DEFINER but still requires EXECUTE grant
-- for the calling role.  The app always uses anon JWT.
GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text) TO anon;

SELECT pg_notify('pgrst', 'reload schema');
