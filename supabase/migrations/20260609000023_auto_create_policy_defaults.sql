-- Auto-create a policy_defaults row whenever a new project is inserted.
--
-- Without this, if a modeler never visits /policies, the row does not exist
-- and the sim-worker falls back to empty defaults — silently using zero safety
-- stock, no sourcing strategy, etc.  The row is created with empty JSONB
-- family columns so every upsert from the UI layer is an update, never an
-- insert-race condition.

CREATE OR REPLACE FUNCTION public.create_default_policy_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.policy_defaults (
    project_id,
    sourcing,
    inventory,
    transport,
    fulfillment,
    production,
    recovery,
    demand,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  ON CONFLICT (project_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_policy_defaults ON public.projects;
CREATE TRIGGER trg_create_policy_defaults
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.create_default_policy_defaults();

-- Back-fill policy_defaults for any projects that don't have a row yet.
INSERT INTO public.policy_defaults (
  project_id, sourcing, inventory, transport, fulfillment,
  production, recovery, demand, created_at, updated_at
)
SELECT
  p.id,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now(), now()
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_defaults pd WHERE pd.project_id = p.id
)
ON CONFLICT (project_id) DO NOTHING;
