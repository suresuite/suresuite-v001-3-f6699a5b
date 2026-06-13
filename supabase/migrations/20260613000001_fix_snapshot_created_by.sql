-- =====================================================================
-- Fix "Save model version" FK failure.
--
-- The app authenticates against public.approved_users (custom auth), so the
-- user id passed to snapshot_policy is NOT an auth.users id. The legacy FK
-- policy_versions.created_by -> auth.users(id) therefore rejects every
-- snapshot with a real user. Drop the FK; created_by keeps storing the
-- approved_users id (same as author_user_id).
-- =====================================================================

ALTER TABLE public.policy_versions
  DROP CONSTRAINT IF EXISTS policy_versions_created_by_fkey;

-- Recreate snapshot_policy unchanged in behaviour (it already writes
-- COALESCE(p_user_id, auth.uid()) into created_by/author_user_id, which is
-- now safe without the FK). Kept here so this migration is self-contained
-- on databases where 20260612000001 partially applied.
CREATE OR REPLACE FUNCTION public.snapshot_policy(
  p_project_id        uuid,
  p_label             text DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_user_email        text DEFAULT NULL,
  p_user_name         text DEFAULT NULL,
  p_parent_version_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id       uuid;
  v_snapshot jsonb;
  v_prev     jsonb;
BEGIN
  v_snapshot := public._build_policy_snapshot(p_project_id);

  IF p_parent_version_id IS NOT NULL THEN
    SELECT snapshot INTO v_prev FROM public.policy_versions WHERE id = p_parent_version_id;
  ELSE
    SELECT snapshot INTO v_prev
    FROM public.policy_versions
    WHERE project_id = p_project_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.policy_versions (
    project_id, label, snapshot, created_by,
    author_user_id, author_email, author_name,
    parent_version_id, previous_snapshot, policy_hash
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_snapshot,
    COALESCE(p_user_id, auth.uid()),
    COALESCE(p_user_id, auth.uid()),
    p_user_email,
    p_user_name,
    p_parent_version_id,
    v_prev,
    encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text, uuid, text, text, uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
