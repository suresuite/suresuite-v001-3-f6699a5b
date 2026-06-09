-- Grant anon execute on create_disruption_scenario_v2.
-- The app always uses an anon JWT (custom auth system), so without this grant
-- PostgREST rejects the RPC call before the SECURITY DEFINER function runs.
GRANT EXECUTE ON FUNCTION public.create_disruption_scenario_v2(
  uuid, text, text, uuid, text,
  disruption_status, text, text[],
  jsonb, jsonb, jsonb, date, date
) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
