-- Fix PGRST205: policy_overrides (and policy_defaults) were not visible in the
-- PostgREST schema cache because the Data API grants were never applied to the
-- live database.  Re-issuing them is idempotent and safe.
--
-- The final pg_notify flushes PostgREST's in-memory schema cache so the tables
-- become visible without a service restart.

-- policy_overrides
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_overrides TO authenticated;
GRANT ALL                             ON public.policy_overrides TO service_role;

-- policy_defaults (same issue; re-grant for parity)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_defaults TO authenticated;
GRANT ALL                             ON public.policy_defaults TO service_role;

-- policy_presets
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_presets TO authenticated;
GRANT ALL                             ON public.policy_presets TO service_role;

-- Flush PostgREST schema cache — table becomes visible to the Data API immediately
SELECT pg_notify('pgrst', 'reload schema');
