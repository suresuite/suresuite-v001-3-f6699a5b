DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy_defaults','policy_overrides','policy_presets','recovery_playbooks','scenarios','experiments','simulation_runs','run_replications']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';