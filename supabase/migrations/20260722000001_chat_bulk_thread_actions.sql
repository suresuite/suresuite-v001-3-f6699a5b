-- =====================================================================
-- Bulk chat-thread actions — v1.2 Phase 2, sidebar multi-select
-- (design: docs/design/ai-agents.md §17.1; §14.1 single-row siblings;
--  §10 Q20 explicit-p_user_id resolver idiom)
-- Set-based writes behind the sidebar's multi-select action bar. Each RPC
-- enforces the same owner check as its single-row §14.1 sibling
-- (move_chat_thread / set_thread_flags / delete_chat_thread), but SKIPS
-- non-owned ids instead of failing, and returns the affected count.
-- Additive only: no table change, no behavior change to existing RPCs.
-- =====================================================================

-- bulk_move_chat_threads: file every owned thread in p_thread_ids under
-- p_folder_id (NULL detaches). The target folder must be the caller's own —
-- same rule as move_chat_thread; a foreign target fails the whole call
-- because it can never be right for any of the rows.
CREATE OR REPLACE FUNCTION public.bulk_move_chat_threads(
  p_thread_ids uuid[], p_folder_id uuid, p_user_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_folders f WHERE f.id = p_folder_id AND f.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'folder % not found', p_folder_id;
  END IF;
  UPDATE public.chat_threads
     SET folder_id = p_folder_id
   WHERE id = ANY (COALESCE(p_thread_ids, '{}'::uuid[]))
     AND user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.bulk_move_chat_threads(uuid[],uuid,uuid)
  TO anon, authenticated, service_role;

-- bulk_set_thread_flags: NULL keeps the current value (set_thread_flags
-- semantics), applied to every owned thread in p_thread_ids.
CREATE OR REPLACE FUNCTION public.bulk_set_thread_flags(
  p_thread_ids uuid[], p_pinned boolean, p_archived boolean, p_user_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.chat_threads
     SET pinned   = COALESCE(p_pinned, pinned),
         archived = COALESCE(p_archived, archived)
   WHERE id = ANY (COALESCE(p_thread_ids, '{}'::uuid[]))
     AND user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.bulk_set_thread_flags(uuid[],boolean,boolean,uuid)
  TO anon, authenticated, service_role;

-- bulk_delete_chat_threads: hard delete of every owned thread in
-- p_thread_ids, cascading messages (the user's right to erase, §14.6).
CREATE OR REPLACE FUNCTION public.bulk_delete_chat_threads(
  p_thread_ids uuid[], p_user_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.chat_threads
   WHERE id = ANY (COALESCE(p_thread_ids, '{}'::uuid[]))
     AND user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION public.bulk_delete_chat_threads(uuid[],uuid)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
