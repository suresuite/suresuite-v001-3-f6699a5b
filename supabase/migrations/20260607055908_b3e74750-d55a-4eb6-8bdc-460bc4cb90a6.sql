
-- policy_defaults: one row per project, holds default policy JSON for each family
CREATE TABLE public.policy_defaults (
  project_id uuid PRIMARY KEY,
  sourcing jsonb NOT NULL DEFAULT '{}'::jsonb,
  inventory jsonb NOT NULL DEFAULT '{}'::jsonb,
  transport jsonb NOT NULL DEFAULT '{}'::jsonb,
  fulfillment jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_defaults TO authenticated;
GRANT ALL ON public.policy_defaults TO service_role;

ALTER TABLE public.policy_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read policy defaults"
  ON public.policy_defaults FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can upsert policy defaults"
  ON public.policy_defaults FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update policy defaults"
  ON public.policy_defaults FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete policy defaults"
  ON public.policy_defaults FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- policy_overrides: per-node or per-edge sparse patch
CREATE TABLE public.policy_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('node','edge')),
  target_key text NOT NULL,
  family text NOT NULL CHECK (family IN ('sourcing','inventory','transport','fulfillment')),
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope, target_key, family)
);

CREATE INDEX idx_policy_overrides_project ON public.policy_overrides(project_id);
CREATE INDEX idx_policy_overrides_project_family ON public.policy_overrides(project_id, family);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_overrides TO authenticated;
GRANT ALL ON public.policy_overrides TO service_role;

ALTER TABLE public.policy_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read policy overrides"
  ON public.policy_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert policy overrides"
  ON public.policy_overrides FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update policy overrides"
  ON public.policy_overrides FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete policy overrides"
  ON public.policy_overrides FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- update_updated_at_column already exists
CREATE TRIGGER trg_policy_defaults_updated_at
  BEFORE UPDATE ON public.policy_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_policy_overrides_updated_at
  BEFORE UPDATE ON public.policy_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.policy_defaults REPLICA IDENTITY FULL;
ALTER TABLE public.policy_overrides REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_defaults;
ALTER PUBLICATION supabase_realtime ADD TABLE public.policy_overrides;
