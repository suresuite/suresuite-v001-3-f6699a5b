-- policy_versions: immutable snapshots of the full policy bundle.
-- Enables the version rail UI (timeline, diff, restore).

CREATE TABLE public.policy_versions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label       text,                          -- user-supplied name, e.g. "Pre-Q4 freeze"
  snapshot    jsonb       NOT NULL,          -- full { sourcing, inventory, ... } bundle
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_versions_project ON public.policy_versions(project_id, created_at DESC);

GRANT SELECT, INSERT ON public.policy_versions TO authenticated;
GRANT ALL ON public.policy_versions TO service_role;

ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read versions for their projects"
  ON public.policy_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = policy_versions.project_id
        AND (p.modeler_id = auth.uid()
             OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

CREATE POLICY "Users can create versions for their projects"
  ON public.policy_versions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = policy_versions.project_id
        AND (p.modeler_id = auth.uid()
             OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

-- Helper function: snapshot current policy_defaults as a new version
CREATE OR REPLACE FUNCTION public.snapshot_policy(
  p_project_id uuid,
  p_label      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id  uuid;
  v_row public.policy_defaults%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.policy_defaults
  WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No policy_defaults found for project %', p_project_id;
  END IF;

  INSERT INTO public.policy_versions (project_id, label, snapshot, created_by)
  VALUES (
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
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_policy(uuid, text) TO authenticated;


-- Helper function: restore a saved version back into policy_defaults
CREATE OR REPLACE FUNCTION public.restore_policy_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.policy_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.policy_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % not found', p_version_id;
  END IF;

  UPDATE public.policy_defaults SET
    sourcing    = (v_row.snapshot ->> 'sourcing')::jsonb,
    inventory   = (v_row.snapshot ->> 'inventory')::jsonb,
    transport   = (v_row.snapshot ->> 'transport')::jsonb,
    fulfillment = (v_row.snapshot ->> 'fulfillment')::jsonb,
    production  = (v_row.snapshot ->> 'production')::jsonb,
    recovery    = (v_row.snapshot ->> 'recovery')::jsonb,
    demand      = (v_row.snapshot ->> 'demand')::jsonb,
    updated_at  = now(),
    updated_by  = auth.uid()
  WHERE project_id = v_row.project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_policy_version(uuid) TO authenticated;
