-- =====================================================================
-- GA capability grants for the routed agents + chat continuity
-- (docs/design/ai-agents.md §13.1; companion to 20260715000003_agent_capabilities.sql,
--  20260717000001_chat_store.sql, 20260717000003_project_memory.sql,
--  20260723000001_reports_and_file_workspace.sql).
--
-- WHY THIS MIGRATION EXISTS
-- Every per-agent key was seeded `false` for every role by its own stage
-- migration ("seeded ON as each agent's stage GAs"), and no migration ever
-- flipped one on. The server flags went GA — AGENT_ROUTER_ENABLED=true with
-- five agents in AGENT_ENABLED_IDS — but index.ts computes
--
--     enabledAgents = deploymentEnabledAgents() ∩ {slug | capFeatures[agent_<slug>]}
--
-- so the intersection stayed empty and decideRoute() returned
-- advisory("no_enabled_agents") for every message from every non-super-admin.
-- The five GA agents have never executed in production. Same for chat
-- continuity: CHAT_STORE_ENABLED / CHAT_SUMMARY_ENABLED / PROJECT_MEMORY_ENABLED
-- are all true server-side, but chat_history_sync and project_memory were
-- denied to every role, so no thread or memory ever synced.
--
-- POSTURE
-- Per-agent routing eligibility follows agent_apply (§13.1): on for
-- super_admin/admin/modeler, off for `user` — routing an agent means it can
-- file a proposal, and `user` cannot approve one. Chat continuity follows
-- ai_chat (on for every role that has the assistant at all).
--
-- Deliberately NOT granted here (kept false, each for its own reason):
--   agent_explainer              — routable in AGENT_PRECEDENCE but has no
--                                  implementation (no AGENT_TURNS entry, no
--                                  tools); granting it would only produce
--                                  silent advisory fall-throughs.
--   agent_cost_estimator         — built and tested, but absent from the
--   agent_network_cartographer     deployed AGENT_ENABLED_IDS, so the grant
--   agent_disruption_sentinel      would be a no-op. Enable the flag and the
--                                  grant together when they GA.
--
-- Unlike the stage seeds this uses ON CONFLICT DO UPDATE: the denying rows
-- already exist, so DO NOTHING would leave every agent dark.
-- =====================================================================

-- Per-agent routing eligibility for the five GA agents.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key, r.role IN ('super_admin','admin','modeler')
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN (VALUES ('agent_data_steward'),('agent_policy_configurator'),
                   ('agent_vv_analyst'),('agent_experiment_designer'),
                   ('agent_report_builder')) AS c(key)
ON CONFLICT (role, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Chat continuity follows ai_chat (§14.7 M0-M2): the server flags are on, so
-- the grant is what has been withholding thread sync and project memory.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key,
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN (VALUES ('chat_history_sync'),('project_memory')) AS c(key)
ON CONFLICT (role, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;

SELECT pg_notify('pgrst', 'reload schema');

-- =====================================================================
-- today_requests must count REQUESTS, not usage rows.
--
-- An agent-routed request legitimately writes more than one ai_usage_logs row
-- (the agent turn, then the request) — that is the §8 T5 design, "records all
-- three (distinct request_id)". But today_requests counted ROWS, so such a
-- request burned two or three units of the caller's per-day request limit.
-- ai_usage_logs.request_id has existed since the table was created and was
-- never populated; project-ai-chat now stamps it, so the counter can do what
-- its name says. COALESCE(request_id, id::text) keeps historical rows (NULL
-- request_id) each counting as one, exactly as they do today.
--
-- Reproduced verbatim from 20260711000002_unified_access_control.sql with
-- that single COUNT changed; everything else is byte-identical.
-- =====================================================================

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
    'today_requests',COALESCE((SELECT COUNT(DISTINCT COALESCE(request_id, id::text)) FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('day', now())), 0)
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

SELECT pg_notify('pgrst', 'reload schema');
