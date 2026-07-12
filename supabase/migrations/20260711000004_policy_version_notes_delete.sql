-- =====================================================================
-- 6.D — Policy version history: notes, export support, guarded delete.
--
--   * policy_versions gains a free-text `notes` column — a description of the
--     model, DISTINCT from the short `label` (the label names the snapshot;
--     notes describe it).
--   * snapshot_policy captures notes at save time (7th arg, defaulted so
--     existing 6-arg callers keep working).
--   * update_policy_version_notes edits notes on an existing version.
--   * list_policy_versions returns notes + reference counts (runs, model
--     cards) so the UI can guard delete and label referenced versions.
--   * get_policy_version_snapshot returns one version's full v2 bundle so the
--     client can export it through the existing Excel writer.
--   * delete_policy_version removes a version, but REFUSES when it is bound to
--     a simulation run or a model-validation card. The model_validations FK is
--     ON DELETE CASCADE, so an unguarded delete would silently destroy a
--     validated model card — the guard makes that impossible.
-- =====================================================================

ALTER TABLE public.policy_versions
  ADD COLUMN IF NOT EXISTS notes text;

-- 1. snapshot_policy: add p_notes (7th arg, defaulted) ----------------------

DROP FUNCTION IF EXISTS public.snapshot_policy(uuid, text, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.snapshot_policy(
  p_project_id        uuid,
  p_label             text DEFAULT NULL,
  p_user_id           uuid DEFAULT NULL,
  p_user_email        text DEFAULT NULL,
  p_user_name         text DEFAULT NULL,
  p_parent_version_id uuid DEFAULT NULL,
  p_notes             text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id       uuid;
  v_snapshot jsonb;
  v_prev     jsonb;
BEGIN
  v_snapshot := public._build_policy_snapshot(p_project_id);

  -- Previous model: explicit parent snapshot, else latest version on project.
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
    project_id, label, notes, snapshot, created_by,
    author_user_id, author_email, author_name,
    parent_version_id, previous_snapshot, policy_hash
  ) VALUES (
    p_project_id,
    COALESCE(p_label, 'Snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
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

GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text, uuid, text, text, uuid, text) TO anon, authenticated;

-- 2. update_policy_version_notes: edit notes on an existing version ---------

CREATE OR REPLACE FUNCTION public.update_policy_version_notes(
  p_version_id uuid,
  p_notes      text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.policy_versions
  SET notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
  WHERE id = p_version_id;
$$;

GRANT EXECUTE ON FUNCTION public.update_policy_version_notes(uuid, text) TO anon, authenticated;

-- 3. list_policy_versions: expose notes + reference counts ------------------

DROP FUNCTION IF EXISTS public.list_policy_versions(uuid);

CREATE OR REPLACE FUNCTION public.list_policy_versions(p_project_id uuid)
RETURNS TABLE (
  id                uuid,
  label             text,
  notes             text,
  author_email      text,
  author_name       text,
  parent_version_id uuid,
  policy_hash       text,
  created_at        timestamptz,
  run_count         bigint,
  card_count        bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    v.id, v.label, v.notes, v.author_email, v.author_name,
    v.parent_version_id, v.policy_hash, v.created_at,
    (SELECT count(*) FROM public.simulation_runs  r WHERE r.policy_version_id = v.id),
    (SELECT count(*) FROM public.model_validations m WHERE m.policy_version_id = v.id)
  FROM public.policy_versions v
  WHERE v.project_id = p_project_id
  ORDER BY v.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_policy_versions(uuid) TO anon, authenticated;

-- 4. get_policy_version_snapshot: one version's full bundle for export ------

CREATE OR REPLACE FUNCTION public.get_policy_version_snapshot(p_version_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT snapshot FROM public.policy_versions WHERE id = p_version_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_policy_version_snapshot(uuid) TO anon, authenticated;

-- 5. delete_policy_version: guarded delete ---------------------------------

CREATE OR REPLACE FUNCTION public.delete_policy_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_runs  bigint;
  v_cards bigint;
BEGIN
  SELECT count(*) INTO v_runs  FROM public.simulation_runs  WHERE policy_version_id = p_version_id;
  SELECT count(*) INTO v_cards FROM public.model_validations WHERE policy_version_id = p_version_id;

  IF v_runs > 0 OR v_cards > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: this version is bound to % simulation run(s) and % validated model card(s). Versions referenced by runs or model cards are kept for provenance.',
      v_runs, v_cards
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM public.policy_versions WHERE id = p_version_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_policy_version(uuid) TO anon, authenticated;

-- 6. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
