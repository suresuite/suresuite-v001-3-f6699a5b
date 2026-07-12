-- =====================================================================
-- Forward fix for chat_quick_thread_id (workstream M, Stage M0; design:
-- docs/design/ai-agents.md §14.2 rule 1).
-- The 20260717000001 version reached the remote using pgcrypto's digest(),
-- which fails to resolve under callers that pin search_path to 'public'
-- (import_local_threads is SECURITY DEFINER SET search_path TO 'public';
-- pgcrypto lives in the extensions schema). Re-create the function on
-- pg_catalog.sha256 so the derivation resolves under any search_path.
-- Derived ids are unchanged: sha256 over the same UTF-8 bytes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_quick_thread_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT encode(substring(sha256(convert_to('suresuite.quick.' || p_user_id::text, 'UTF8')) from 1 for 16), 'hex')::uuid;
$$;
GRANT EXECUTE ON FUNCTION public.chat_quick_thread_id(uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
