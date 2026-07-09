-- Super Admin Dashboard — Phase 1
-- Role, organizations, AI catalog, per-user AI permissions, budgets, usage logs, audit logs.
--
-- Renumbered from 20260705000001_super_admin_phase1.sql: that version (a) used
-- the super_admin enum value in the same transaction that added it (55P04) and
-- (b) collided with 20260705000001_open_logistics_reads.sql, so once that one
-- was recorded the CLI treated this file as applied. The enum value now comes
-- from 20260709000001 (its own transaction); this file only uses it.

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.approved_users
                 WHERE id = _user_id AND role = 'super_admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.current_is_super_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  uid := public.get_current_user_id();
  IF uid IS NULL THEN RETURN false; END IF;
  RETURN public.is_super_admin(uid);
END; $$;

-- Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_user_id uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orgs: super admin full" ON public.organizations;
CREATE POLICY "orgs: super admin full" ON public.organizations FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "orgs: members read own" ON public.organizations;
CREATE POLICY "orgs: members read own" ON public.organizations FOR SELECT
  USING (name = public.get_current_user_org() OR slug = public.get_current_user_org());

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  org_role text NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_members: super full" ON public.organization_members;
CREATE POLICY "org_members: super full" ON public.organization_members FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "org_members: read own" ON public.organization_members;
CREATE POLICY "org_members: read own" ON public.organization_members FOR SELECT
  USING (user_id = public.get_current_user_id());

INSERT INTO public.organizations (name, slug, status)
SELECT DISTINCT organization,
       lower(regexp_replace(organization, '[^a-zA-Z0-9]+', '-', 'g')),
       'active'
FROM public.approved_users
WHERE organization IS NOT NULL AND organization <> ''
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
UPDATE public.approved_users au
   SET organization_id = o.id
  FROM public.organizations o
 WHERE au.organization_id IS NULL
   AND lower(regexp_replace(au.organization, '[^a-zA-Z0-9]+', '-', 'g')) = o.slug;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
UPDATE public.projects p
   SET organization_id = o.id
  FROM public.organizations o
 WHERE p.organization_id IS NULL
   AND lower(regexp_replace(p.organization, '[^a-zA-Z0-9]+', '-', 'g')) = o.slug;

INSERT INTO public.organization_members (org_id, user_id, org_role)
SELECT au.organization_id, au.id,
       CASE WHEN au.role = 'admin'::public.app_role THEN 'admin' ELSE 'member' END
FROM public.approved_users au
WHERE au.organization_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

UPDATE public.approved_users
   SET role = 'super_admin'::public.app_role
 WHERE lower(email) = 'modeler1@gmail.com';

-- AI catalog
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_providers: read" ON public.ai_providers;
CREATE POLICY "ai_providers: read" ON public.ai_providers FOR SELECT USING (true);
DROP POLICY IF EXISTS "ai_providers: super write" ON public.ai_providers;
CREATE POLICY "ai_providers: super write" ON public.ai_providers FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());

CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  input_cost_per_1k numeric(12,6) NOT NULL DEFAULT 0,
  output_cost_per_1k numeric(12,6) NOT NULL DEFAULT 0,
  max_context integer NOT NULL DEFAULT 128000,
  enabled boolean NOT NULL DEFAULT true,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_models TO authenticated;
GRANT ALL ON public.ai_models TO service_role;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_models: read" ON public.ai_models;
CREATE POLICY "ai_models: read" ON public.ai_models FOR SELECT USING (true);
DROP POLICY IF EXISTS "ai_models: super write" ON public.ai_models;
CREATE POLICY "ai_models: super write" ON public.ai_models FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());

INSERT INTO public.ai_providers (code, display_name) VALUES
  ('google','Google'),('openai','OpenAI'),('anthropic','Anthropic'),('deepseek','DeepSeek')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_models (provider_id, code, display_name, input_cost_per_1k, output_cost_per_1k, max_context)
SELECT p.id, m.code, m.display_name, m.icp, m.ocp, m.ctx
FROM (VALUES
  ('google',   'google/gemini-3-flash-preview','Gemini 3 Flash (Preview)',  0.10, 0.40, 1000000),
  ('google',   'google/gemini-2.5-pro',        'Gemini 2.5 Pro',            1.25,10.00, 1000000),
  ('google',   'google/gemini-2.5-flash',      'Gemini 2.5 Flash',          0.30, 2.50, 1000000),
  ('google',   'google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite',     0.10, 0.40, 1000000),
  ('openai',   'openai/gpt-5',                 'GPT-5',                     1.25,10.00,  400000),
  ('openai',   'openai/gpt-5-mini',            'GPT-5 mini',                0.25, 2.00,  400000),
  ('openai',   'openai/gpt-5-nano',            'GPT-5 nano',                0.05, 0.40,  400000),
  ('openai',   'openai/gpt-5.5',               'GPT-5.5',                   3.00,15.00,  400000),
  ('deepseek', 'deepseek/deepseek-chat',       'DeepSeek Chat',             0.14, 0.28,  128000)
) AS m(provider_code, code, display_name, icp, ocp, ctx)
JOIN public.ai_providers p ON p.code = m.provider_code
ON CONFLICT (code) DO NOTHING;

-- User AI permissions
CREATE TABLE IF NOT EXISTS public.user_ai_permissions (
  user_id uuid PRIMARY KEY REFERENCES public.approved_users(id) ON DELETE CASCADE,
  allowed_model_ids uuid[] NOT NULL DEFAULT '{}',
  default_model_id uuid REFERENCES public.ai_models(id) ON DELETE SET NULL,
  fallback_model_id uuid REFERENCES public.ai_models(id) ON DELETE SET NULL,
  temperature numeric(3,2),
  max_context_override integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_permissions TO authenticated;
GRANT ALL ON public.user_ai_permissions TO service_role;
ALTER TABLE public.user_ai_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uap: super full" ON public.user_ai_permissions;
CREATE POLICY "uap: super full" ON public.user_ai_permissions FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "uap: read own" ON public.user_ai_permissions;
CREATE POLICY "uap: read own" ON public.user_ai_permissions FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Budgets
CREATE TABLE IF NOT EXISTS public.ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('user','org','project')),
  scope_id uuid NOT NULL,
  period text NOT NULL CHECK (period IN ('daily','monthly')),
  budget_usd numeric(12,4),
  token_limit bigint,
  rpm integer,
  rpd integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, scope_id, period)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_budgets TO authenticated;
GRANT ALL ON public.ai_budgets TO service_role;
ALTER TABLE public.ai_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets: super full" ON public.ai_budgets;
CREATE POLICY "budgets: super full" ON public.ai_budgets FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "budgets: user reads own" ON public.ai_budgets;
CREATE POLICY "budgets: user reads own" ON public.ai_budgets FOR SELECT
  USING (scope = 'user' AND scope_id = public.get_current_user_id());

-- Usage logs
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  project_id uuid,
  model_id uuid REFERENCES public.ai_models(id) ON DELETE SET NULL,
  model_code text,
  provider_code text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','error','blocked')),
  error_code text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at   ON public.ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON public.ai_usage_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created  ON public.ai_usage_logs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model        ON public.ai_usage_logs (model_id);
GRANT SELECT, INSERT ON public.ai_usage_logs TO authenticated;
GRANT ALL ON public.ai_usage_logs TO service_role;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage: super read" ON public.ai_usage_logs;
CREATE POLICY "usage: super read" ON public.ai_usage_logs FOR SELECT
  USING (public.current_is_super_admin());
DROP POLICY IF EXISTS "usage: user read own" ON public.ai_usage_logs;
CREATE POLICY "usage: user read own" ON public.ai_usage_logs FOR SELECT
  USING (user_id = public.get_current_user_id());

-- Audit logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor      ON public.admin_audit_logs (actor_user_id);
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit: super read" ON public.admin_audit_logs;
CREATE POLICY "audit: super read" ON public.admin_audit_logs FOR SELECT
  USING (public.current_is_super_admin());

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action text, p_target_type text, p_target_id text, p_before jsonb, p_after jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid; new_id uuid;
BEGIN
  actor := public.get_current_user_id();
  IF actor IS NULL OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.admin_audit_logs (actor_user_id, action, target_type, target_id, before, after)
  VALUES (actor, p_action, p_target_type, p_target_id, p_before, p_after)
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text,text,text,jsonb,jsonb) TO authenticated;

-- Triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','ai_providers','ai_models','user_ai_permissions','ai_budgets']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- Admin usage view
CREATE OR REPLACE VIEW public.v_admin_user_usage AS
SELECT au.id AS user_id, au.name, au.email, au.role::text AS role,
       au.organization, au.organization_id, au.is_active,
       COALESCE(mtd.requests, 0) AS mtd_requests,
       COALESCE(mtd.tokens, 0)   AS mtd_tokens,
       COALESCE(mtd.cost_usd, 0) AS mtd_cost_usd,
       (SELECT budget_usd FROM public.ai_budgets b
         WHERE b.scope='user' AND b.scope_id=au.id AND b.period='monthly' LIMIT 1) AS monthly_budget_usd
FROM public.approved_users au
LEFT JOIN LATERAL (
  SELECT count(*) AS requests, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost_usd
  FROM public.ai_usage_logs l
  WHERE l.user_id = au.id AND l.created_at >= date_trunc('month', now())
) mtd ON true;
GRANT SELECT ON public.v_admin_user_usage TO authenticated;
