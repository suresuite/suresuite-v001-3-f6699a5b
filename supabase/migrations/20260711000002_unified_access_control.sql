-- Unified per-user access control — capabilities (pages + features), role/org/user
-- layers, per-user AI model & budget overrides, and the SECURITY DEFINER resolution
-- + admin RPCs behind the super-admin access management surface.
--
-- Companion to 20260709000002_super_admin_phase1.sql. It REUSES the existing
-- ai_models / ai_providers / user_ai_permissions / ai_budgets / ai_usage_logs /
-- admin_audit_logs tables and adds a capability layer on top of role-based routing.
--
-- Auth model (mirrors 20260711000001_api_access_control.sql): the browser talks to
-- PostgREST as the anon role with custom app auth, and set_current_user_context only
-- lives for the current transaction. So every admin RPC re-establishes context from an
-- explicit (p_actor_id, p_actor_email) pair and gates on is_super_admin(p_actor_id),
-- and every resolver takes _user_id explicitly (never a session GUC) — as v_admin_user_usage does.

-- ── capabilities (catalog) ────────────────────────────────────────────────────
-- One row per gateable page (a route in ROUTE_PERMISSIONS) or feature.
CREATE TABLE IF NOT EXISTS public.capabilities (
  key         text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('page','feature')),
  label       text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capabilities TO authenticated;
GRANT ALL ON public.capabilities TO service_role;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
-- Catalog is not sensitive: readable by everyone; only super admins mutate it.
DROP POLICY IF EXISTS "capabilities: read" ON public.capabilities;
CREATE POLICY "capabilities: read" ON public.capabilities FOR SELECT USING (true);
DROP POLICY IF EXISTS "capabilities: super write" ON public.capabilities;
CREATE POLICY "capabilities: super write" ON public.capabilities FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('/',                          'page', 'Getting Started',           'Landing / getting-started page',                         10),
  ('/project-manager',           'page', 'Project Manager',           'Create, import and manage project datasets',             20),
  ('/network/product-level',     'page', 'Product-Level Network',     'Product-level network view',                             30),
  ('/network/process-level',     'page', 'Process-Level Network',     'Process-level network view',                             40),
  ('/network/firm-level',        'page', 'Firm-Level Network',        'Firm-level network view',                                50),
  ('/network/interactive-space', 'page', 'Interactive Network Space', 'Interactive network exploration space',                  60),
  ('/policies',                  'page', 'Policies',                  'Sourcing, inventory, transportation & fulfillment policies', 70),
  ('/simulation-lab',            'page', 'Simulation Lab',            'Scientific simulation experiments',                      80),
  ('/project-intelligence',      'page', 'Project Intelligence',      'AI-powered project insights',                            90),
  ('/developer',                 'page', 'Developer API',             'API keys, scopes and quickstarts',                       100),
  ('/profile',                   'page', 'My Profile',                'Personal account settings (always available)',           110),
  ('/admin',                     'page', 'Super Admin',               'Platform administration area',                           120),
  ('ai_chat',                    'feature', 'AI Assistant',           'Use the AI chat assistant',                              210),
  ('simulation_lab',             'feature', 'Run Simulations',        'Configure and run simulation experiments',               220),
  ('project_intelligence',       'feature', 'Project Intelligence',   'Generate AI project insights and analysis',              230),
  ('data_editing',               'feature', 'Data Editing',           'Create and edit project data (item master, BOM, logistics)', 240),
  ('export',                     'feature', 'Export',                 'Export data, reports and simulation results',            250)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- ── role_capabilities (default grant per role) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_capabilities (
  role           text NOT NULL CHECK (role IN ('super_admin','admin','modeler','user')),
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;
-- Role defaults are not sensitive; readable so the client can fall back to them.
DROP POLICY IF EXISTS "role_caps: read" ON public.role_capabilities;
CREATE POLICY "role_caps: read" ON public.role_capabilities FOR SELECT USING (true);
DROP POLICY IF EXISTS "role_caps: super write" ON public.role_capabilities;
CREATE POLICY "role_caps: super write" ON public.role_capabilities FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());

-- Page defaults: seeded to preserve today's ROUTE_PERMISSIONS behaviour.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key,
  CASE
    WHEN r.role = 'super_admin' THEN true
    WHEN c.key = '/admin'    THEN false                                   -- super-admin only
    WHEN c.key = '/profile'  THEN true                                    -- always available
    WHEN c.key = '/'         THEN true
    WHEN c.key IN ('/network/firm-level','/network/product-level',
                   '/network/process-level','/network/interactive-space',
                   '/policies','/simulation-lab','/project-intelligence') THEN true
    WHEN c.key IN ('/project-manager','/developer') THEN r.role IN ('admin','modeler')
    ELSE false
  END
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN public.capabilities c
WHERE c.kind = 'page'
ON CONFLICT (role, capability_key) DO NOTHING;

-- Feature defaults: power roles get everything; plain users get read-oriented ones.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key,
  CASE
    WHEN r.role IN ('super_admin','admin','modeler') THEN true
    WHEN r.role = 'user' AND c.key IN ('ai_chat','project_intelligence','export') THEN true
    ELSE false                                                            -- user: simulation_lab, data_editing off
  END
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN public.capabilities c
WHERE c.kind = 'feature'
ON CONFLICT (role, capability_key) DO NOTHING;

-- ── org_capabilities (optional layer between role and user) ───────────────────
CREATE TABLE IF NOT EXISTS public.org_capabilities (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed        boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, capability_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_capabilities TO authenticated;
GRANT ALL ON public.org_capabilities TO service_role;
ALTER TABLE public.org_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_caps: super full" ON public.org_capabilities;
CREATE POLICY "org_caps: super full" ON public.org_capabilities FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "org_caps: members read own" ON public.org_capabilities;
CREATE POLICY "org_caps: members read own" ON public.org_capabilities FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = org_capabilities.org_id AND m.user_id = public.get_current_user_id()
  ));

-- ── user_capabilities (per-user tri-state override; wins over org & role) ─────
-- No row = inherit; allowed = true = explicit allow; allowed = false = explicit deny.
CREATE TABLE IF NOT EXISTS public.user_capabilities (
  user_id        uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed        boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, capability_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_capabilities TO authenticated;
GRANT ALL ON public.user_capabilities TO service_role;
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_caps: super full" ON public.user_capabilities;
CREATE POLICY "user_caps: super full" ON public.user_capabilities FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());
DROP POLICY IF EXISTS "user_caps: read own" ON public.user_capabilities;
CREATE POLICY "user_caps: read own" ON public.user_capabilities FOR SELECT
  USING (user_id = public.get_current_user_id());

-- updated_at triggers for the new tables (reuses the shared trigger fn).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capabilities','role_capabilities','org_capabilities','user_capabilities']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ── resolver: capabilities_for_user (internal, no auth gate) ──────────────────
-- Merges role default → org override → user override; super_admin gets everything;
-- /profile is never deniable (avoids self-lockout / forced password change loop).
-- Returns the resolved page/feature/model/budget set as jsonb. Takes _user_id
-- EXPLICITLY so it never depends on a pooled session GUC.
CREATE OR REPLACE FUNCTION public.capabilities_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role        text;
  v_org_id      uuid;
  v_is_super    boolean;
  v_pages       jsonb;
  v_features    jsonb;
  v_models      jsonb;
  v_budgets     jsonb;
  v_allowed_ids uuid[];
  v_all_models  boolean;
BEGIN
  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
  FROM public.approved_users au WHERE au.id = _user_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', _user_id, 'role', NULL, 'is_super_admin', false,
      'pages', '{}'::jsonb, 'features', '{}'::jsonb,
      'models', jsonb_build_object('all_allowed', false, 'allowed_codes', '[]'::jsonb,
                                   'default_code', NULL, 'fallback_code', NULL),
      'budgets', '{}'::jsonb);
  END IF;
  v_is_super := (v_role = 'super_admin');

  -- pages
  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_pages
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      WHEN c.key = '/profile' THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities  oc WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'page';

  -- features
  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_features
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities  oc WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'feature';

  -- models (empty/absent allow-list = all enabled models allowed, preserving prior behaviour)
  SELECT uap.allowed_model_ids INTO v_allowed_ids
  FROM public.user_ai_permissions uap WHERE uap.user_id = _user_id;
  v_all_models := v_is_super OR v_allowed_ids IS NULL OR array_length(v_allowed_ids, 1) IS NULL;

  SELECT jsonb_build_object(
    'all_allowed', v_all_models,
    'allowed_codes', CASE WHEN v_all_models
        THEN (SELECT COALESCE(jsonb_agg(m.code ORDER BY m.display_name), '[]'::jsonb)
                FROM public.ai_models m WHERE m.enabled)
        ELSE (SELECT COALESCE(jsonb_agg(m.code ORDER BY m.display_name), '[]'::jsonb)
                FROM public.ai_models m WHERE m.enabled AND m.id = ANY(v_allowed_ids)) END,
    'default_code',  (SELECT m.code FROM public.ai_models m
                        JOIN public.user_ai_permissions u ON u.default_model_id = m.id  WHERE u.user_id = _user_id),
    'fallback_code', (SELECT m.code FROM public.ai_models m
                        JOIN public.user_ai_permissions u ON u.fallback_model_id = m.id WHERE u.user_id = _user_id)
  ) INTO v_models;

  -- budgets + live usage
  SELECT jsonb_build_object(
    'monthly_usd', (SELECT budget_usd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'daily_usd',   (SELECT budget_usd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='daily'),
    'token_limit', (SELECT token_limit FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'rpm',         (SELECT rpm FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'rpd',         (SELECT rpd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='daily'),
    'mtd_cost_usd',  COALESCE((SELECT SUM(cost_usd)     FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'mtd_requests',  COALESCE((SELECT COUNT(*)          FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'mtd_tokens',    COALESCE((SELECT SUM(total_tokens) FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'today_cost_usd',COALESCE((SELECT SUM(cost_usd)     FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('day', now())), 0),
    'today_requests',COALESCE((SELECT COUNT(*)          FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('day', now())), 0)
  ) INTO v_budgets;

  RETURN jsonb_build_object(
    'user_id', _user_id, 'role', v_role, 'is_super_admin', v_is_super,
    'pages', v_pages, 'features', v_features, 'models', v_models, 'budgets', v_budgets);
END; $$;
-- internal only — reached through the wrappers below, never directly
REVOKE ALL ON FUNCTION public.capabilities_for_user(uuid) FROM PUBLIC;

-- Task-required resolver + logged-in wrapper. Both take _user_id explicitly.
CREATE OR REPLACE FUNCTION public.get_effective_capabilities(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.capabilities_for_user(_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_effective_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_capabilities(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_capabilities(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.capabilities_for_user(_user_id);
$$;
REVOKE ALL ON FUNCTION public.get_my_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_capabilities(uuid) TO anon, authenticated;

-- ── admin read RPCs (super-admin gated; establish context internally) ─────────

-- Per-user matrix: catalog rows with role default / org override / user override /
-- effective, plus the model catalog (grouped by provider) and budgets + usage.
CREATE OR REPLACE FUNCTION public.get_user_access(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role       text;
  v_org_id     uuid;
  v_is_super   boolean;
  v_caps       jsonb;
  v_models     jsonb;
  v_uap        public.user_ai_permissions%ROWTYPE;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
  FROM public.approved_users au WHERE au.id = p_target_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  v_is_super := (v_role = 'super_admin');

  SELECT jsonb_agg(j ORDER BY j->>'kind', (j->>'sort_order')::int, j->>'key') INTO v_caps
  FROM (
    SELECT jsonb_build_object(
      'key', c.key, 'kind', c.kind, 'label', c.label, 'description', c.description,
      'sort_order', c.sort_order,
      'role_default', COALESCE(rc.allowed, false),
      'org_override', oc.allowed,
      'user_override', uc.allowed,
      'effective', CASE
        WHEN v_is_super THEN true
        WHEN c.kind = 'page' AND c.key = '/profile' THEN true
        ELSE COALESCE(uc.allowed, oc.allowed, rc.allowed, false) END
    ) AS j
    FROM public.capabilities c
    LEFT JOIN public.role_capabilities rc ON rc.role = v_role      AND rc.capability_key = c.key
    LEFT JOIN public.org_capabilities  oc ON oc.org_id = v_org_id  AND oc.capability_key = c.key
    LEFT JOIN public.user_capabilities uc ON uc.user_id = p_target_user_id AND uc.capability_key = c.key
  ) s;

  SELECT * INTO v_uap FROM public.user_ai_permissions WHERE user_id = p_target_user_id;

  SELECT jsonb_build_object(
    'catalog', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', m.id, 'code', m.code, 'display_name', m.display_name,
                  'provider_code', p.code, 'provider_name', p.display_name, 'enabled', m.enabled
                ) ORDER BY p.display_name, m.display_name), '[]'::jsonb)
                FROM public.ai_models m LEFT JOIN public.ai_providers p ON p.id = m.provider_id
                WHERE m.enabled),
    'allowed_ids', to_jsonb(COALESCE(v_uap.allowed_model_ids, '{}')),
    'default_id',  v_uap.default_model_id,
    'fallback_id', v_uap.fallback_model_id,
    'all_allowed', v_is_super OR v_uap.allowed_model_ids IS NULL
                   OR array_length(v_uap.allowed_model_ids, 1) IS NULL
  ) INTO v_models;

  RETURN jsonb_build_object(
    'user_id', p_target_user_id,
    'name',  (SELECT name  FROM public.approved_users WHERE id = p_target_user_id),
    'email', (SELECT email FROM public.approved_users WHERE id = p_target_user_id),
    'role', v_role, 'organization_id', v_org_id, 'is_super_admin', v_is_super,
    'capabilities', COALESCE(v_caps, '[]'::jsonb),
    'models', v_models,
    'budgets', (public.capabilities_for_user(p_target_user_id) -> 'budgets'));
END; $$;
REVOKE ALL ON FUNCTION public.get_user_access(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_access(uuid, text, uuid) TO anon, authenticated;

-- Role-defaults matrix for the AdminRoles editor.
CREATE OR REPLACE FUNCTION public.get_role_access(p_actor_id uuid, p_actor_email text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'capabilities', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', c.key, 'kind', c.kind, 'label', c.label,
        'description', c.description, 'sort_order', c.sort_order)
        ORDER BY c.kind, c.sort_order, c.key), '[]'::jsonb) FROM public.capabilities c),
    'roles', (SELECT jsonb_object_agg(role, caps) FROM (
        SELECT rc.role, jsonb_object_agg(rc.capability_key, rc.allowed) AS caps
        FROM public.role_capabilities rc GROUP BY rc.role) r));
END; $$;
REVOKE ALL ON FUNCTION public.get_role_access(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_role_access(uuid, text) TO anon, authenticated;

-- Org-defaults matrix for the AdminOrganizations access editor.
CREATE OR REPLACE FUNCTION public.get_org_access(p_actor_id uuid, p_actor_email text, p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'org_name', (SELECT name FROM public.organizations WHERE id = p_org_id),
    'capabilities', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', c.key, 'kind', c.kind, 'label', c.label, 'description', c.description,
        'sort_order', c.sort_order, 'org_override', oc.allowed)
        ORDER BY c.kind, c.sort_order, c.key), '[]'::jsonb)
      FROM public.capabilities c
      LEFT JOIN public.org_capabilities oc ON oc.org_id = p_org_id AND oc.capability_key = c.key));
END; $$;
REVOKE ALL ON FUNCTION public.get_org_access(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_access(uuid, text, uuid) TO anon, authenticated;

-- ── admin write RPCs (super-admin gated + audited) ────────────────────────────

-- Set/clear a capability override at the user, org or role layer.
--   p_scope in ('user','org','role'); p_scope_id = user_id / org_id (uuid text) or role name.
--   p_allowed NULL clears the override (user/org → inherit; role → row removed).
CREATE OR REPLACE FUNCTION public.admin_set_capability(
  p_actor_id uuid, p_actor_email text,
  p_scope text, p_scope_id text, p_capability_key text, p_allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before boolean;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.capabilities WHERE key = p_capability_key) THEN
    RAISE EXCEPTION 'unknown capability %', p_capability_key;
  END IF;

  IF p_scope = 'user' THEN
    SELECT allowed INTO v_before FROM public.user_capabilities
      WHERE user_id = p_scope_id::uuid AND capability_key = p_capability_key;
    IF p_allowed IS NULL THEN
      DELETE FROM public.user_capabilities WHERE user_id = p_scope_id::uuid AND capability_key = p_capability_key;
    ELSE
      INSERT INTO public.user_capabilities (user_id, capability_key, allowed)
      VALUES (p_scope_id::uuid, p_capability_key, p_allowed)
      ON CONFLICT (user_id, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();
    END IF;
  ELSIF p_scope = 'org' THEN
    SELECT allowed INTO v_before FROM public.org_capabilities
      WHERE org_id = p_scope_id::uuid AND capability_key = p_capability_key;
    IF p_allowed IS NULL THEN
      DELETE FROM public.org_capabilities WHERE org_id = p_scope_id::uuid AND capability_key = p_capability_key;
    ELSE
      INSERT INTO public.org_capabilities (org_id, capability_key, allowed)
      VALUES (p_scope_id::uuid, p_capability_key, p_allowed)
      ON CONFLICT (org_id, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();
    END IF;
  ELSIF p_scope = 'role' THEN
    IF p_scope_id NOT IN ('super_admin','admin','modeler','user') THEN RAISE EXCEPTION 'unknown role %', p_scope_id; END IF;
    SELECT allowed INTO v_before FROM public.role_capabilities
      WHERE role = p_scope_id AND capability_key = p_capability_key;
    INSERT INTO public.role_capabilities (role, capability_key, allowed)
    VALUES (p_scope_id, p_capability_key, COALESCE(p_allowed, false))
    ON CONFLICT (role, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();
  ELSE
    RAISE EXCEPTION 'unknown scope %', p_scope;
  END IF;

  PERFORM public.log_admin_action(
    'access.capability_set', p_scope, p_scope_id,
    jsonb_build_object('capability', p_capability_key, 'allowed', v_before),
    jsonb_build_object('capability', p_capability_key, 'allowed', p_allowed));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_capability(uuid, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_capability(uuid, text, text, text, text, boolean) TO anon, authenticated;

-- Replace a user's allowed AI models + default/fallback.
CREATE OR REPLACE FUNCTION public.admin_set_user_models(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid,
  p_allowed_model_ids uuid[], p_default_model_id uuid, p_fallback_model_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT to_jsonb(u) INTO v_before FROM public.user_ai_permissions u WHERE u.user_id = p_target_user_id;

  INSERT INTO public.user_ai_permissions (user_id, allowed_model_ids, default_model_id, fallback_model_id)
  VALUES (p_target_user_id, COALESCE(p_allowed_model_ids, '{}'), p_default_model_id, p_fallback_model_id)
  ON CONFLICT (user_id) DO UPDATE
    SET allowed_model_ids = EXCLUDED.allowed_model_ids,
        default_model_id  = EXCLUDED.default_model_id,
        fallback_model_id = EXCLUDED.fallback_model_id,
        updated_at = now();

  PERFORM public.log_admin_action(
    'access.models_set', 'approved_users', p_target_user_id::text, v_before,
    jsonb_build_object('allowed_model_ids', to_jsonb(COALESCE(p_allowed_model_ids, '{}')),
                       'default_model_id', p_default_model_id, 'fallback_model_id', p_fallback_model_id));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_models(uuid, text, uuid, uuid[], uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_models(uuid, text, uuid, uuid[], uuid, uuid) TO anon, authenticated;

-- Upsert (or clear, when budget & limits are all NULL) a user's budget for a period.
CREATE OR REPLACE FUNCTION public.admin_set_user_budget(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_period text,
  p_budget_usd numeric, p_token_limit bigint, p_rpm integer, p_rpd integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_period NOT IN ('daily','monthly') THEN RAISE EXCEPTION 'bad period %', p_period; END IF;

  SELECT to_jsonb(b) INTO v_before FROM public.ai_budgets b
   WHERE b.scope='user' AND b.scope_id=p_target_user_id AND b.period=p_period;

  IF p_budget_usd IS NULL AND p_token_limit IS NULL AND p_rpm IS NULL AND p_rpd IS NULL THEN
    DELETE FROM public.ai_budgets WHERE scope='user' AND scope_id=p_target_user_id AND period=p_period;
  ELSE
    INSERT INTO public.ai_budgets (scope, scope_id, period, budget_usd, token_limit, rpm, rpd)
    VALUES ('user', p_target_user_id, p_period, p_budget_usd, p_token_limit, p_rpm, p_rpd)
    ON CONFLICT (scope, scope_id, period) DO UPDATE
      SET budget_usd = EXCLUDED.budget_usd, token_limit = EXCLUDED.token_limit,
          rpm = EXCLUDED.rpm, rpd = EXCLUDED.rpd, updated_at = now();
  END IF;

  PERFORM public.log_admin_action(
    'access.budget_set', 'approved_users', p_target_user_id::text, v_before,
    jsonb_build_object('period', p_period, 'budget_usd', p_budget_usd,
                       'token_limit', p_token_limit, 'rpm', p_rpm, 'rpd', p_rpd));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_budget(uuid, text, uuid, text, numeric, bigint, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_budget(uuid, text, uuid, text, numeric, bigint, integer, integer) TO anon, authenticated;
