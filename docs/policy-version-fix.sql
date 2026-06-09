-- =====================================================================
-- POLICY VERSION FIX — apply this in the SQL editor of the Supabase
-- project that /policies is talking to (wckdrutwkytwcomrlpib).
--
-- It fixes three problems:
--   1. Snapshots are inserted but never readable (RLS uses auth.uid()
--      while the app uses anon JWT + custom auth) → history looks empty.
--   2. created_by was always NULL → no record of who made a change.
--   3. There was no "previous model" capture and no parent-version link.
--
-- After running this, /policies' version selector + history + save-version
-- buttons (rendered above the four stages) will work end-to-end.
-- =====================================================================

-- 1. Add author + lineage columns ------------------------------------------------
ALTER TABLE public.policy_versions
  ADD COLUMN IF NOT EXISTS author_user_id   uuid,
  ADD COLUMN IF NOT EXISTS author_email     text,
  ADD COLUMN IF NOT EXISTS author_name      text,
  ADD COLUMN IF NOT EXISTS parent_version_id uuid REFERENCES public.policy_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_snapshot jsonb;

-- 2. Open up Data-API access for the app's anon JWT -----------------------------
GRANT SELECT, INSERT ON public.policy_versions TO anon;
GRANT ALL            ON public.policy_versions TO service_role;

DROP POLICY IF EXISTS "Users can read versions for their projects"   ON public.policy_versions;
DROP POLICY IF EXISTS "Users can create versions for their projects" ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_anon_read"                    ON public.policy_versions;
DROP POLICY IF EXISTS "policy_versions_auth_read"                    ON public.policy_versions;

CREATE POLICY "policy_versions_read_all"
  ON public.policy_versions FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "policy_versions_insert_all"
  ON public.policy_versions FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 3. Replace snapshot_policy so it captures author + previous model -------------
DROP FUNCTION IF EXISTS public.snapshot_policy(uuid, text);

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
  v_id        uuid;
  v_row       public.policy_defaults%ROWTYPE;
  v_prev      jsonb;
BEGIN
  SELECT * INTO v_row
  FROM public.policy_defaults
  WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No policy_defaults found for project %', p_project_id;
  END IF;

  -- Capture the "previous" model: either the explicit parent snapshot or the
  -- most recent version on this project (so history is a proper chain).
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
    parent_version_id, previous_snapshot
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    jsonb_build_object(
      'sourcing',    v_row.sourcing,
      'inventory',   v_row.inventory,
      'transport',   v_row.transport,
      'fulfillment', v_row.fulfillment,
      'production',  v_row.production,
      'recovery',    v_row.recovery,
      'demand',      v_row.demand
    ),
    COALESCE(p_user_id, auth.uid()),
    COALESCE(p_user_id, auth.uid()),
    p_user_email,
    p_user_name,
    p_parent_version_id,
    v_prev
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text, uuid, text, text, uuid) TO anon, authenticated;

-- 4. Convenience: list versions for the project picker -------------------------
CREATE OR REPLACE FUNCTION public.list_policy_versions(p_project_id uuid)
RETURNS TABLE (
  id                uuid,
  label             text,
  author_email      text,
  author_name       text,
  parent_version_id uuid,
  created_at        timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, label, author_email, author_name, parent_version_id, created_at
  FROM public.policy_versions
  WHERE project_id = p_project_id
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_policy_versions(uuid) TO anon, authenticated;

-- 5. Restore: write the chosen version back to policy_defaults -----------------
CREATE OR REPLACE FUNCTION public.restore_policy_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row public.policy_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.policy_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version % not found', p_version_id; END IF;

  UPDATE public.policy_defaults SET
    sourcing    = COALESCE(v_row.snapshot -> 'sourcing',    sourcing),
    inventory   = COALESCE(v_row.snapshot -> 'inventory',   inventory),
    transport   = COALESCE(v_row.snapshot -> 'transport',   transport),
    fulfillment = COALESCE(v_row.snapshot -> 'fulfillment', fulfillment),
    production  = COALESCE(v_row.snapshot -> 'production',  production),
    recovery    = COALESCE(v_row.snapshot -> 'recovery',    recovery),
    demand      = COALESCE(v_row.snapshot -> 'demand',      demand),
    updated_at  = now()
  WHERE project_id = v_row.project_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.restore_policy_version(uuid) TO anon, authenticated;

-- 6. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
