-- =====================================================================
-- ⚠ STAGED — NOT YET APPLIED. This file lives in supabase/migrations-staged/
-- because supabase-migrations.yml auto-applies anything pushed under
-- supabase/migrations/** (from ANY branch), and per §7.4 this flip may only
-- apply AFTER the live model-scored eval is green (blocked 2026-07-14 on the
-- three provider API keys being added as GitHub Actions secrets — see the PR).
-- To arm it once the eval-results branch shows a green tier-2 run:
--   git mv supabase/migrations-staged/20260724000001_agent_v12_ga_capability_flip.sql \
--          supabase/migrations/ && git push
-- =====================================================================
-- AI-agent v1.2 GA capability flip — ai-agents.md §9.8 (GA), §13.1 grant
-- vocabulary, §14.7 (M0/M2 GA), §10 Q3/Q14/Q19/Q22g.
--
-- Flags gate existence, capabilities gate access (§10 Q3): the server
-- deployment flags flip in .github/workflows/supabase-functions.yml in the
-- same PR; this migration flips the role-default GRANTS that were
-- deliberately seeded OFF at each landing (the Q19 discipline: a landing PR
-- must not change default behavior).
--
-- Evidence gate (§7.4): a mock eval run is never flag-flip evidence — this
-- migration lands only after the LIVE model-scored eval ran green on every
-- model enabled in this deployment (.github/workflows/ai-agent-model-eval.yml;
-- report on the eval-results branch).
--
-- Role-default rows only: org_capabilities / user_capabilities overrides keep
-- their existing precedence (§13.1). Upserts use DO UPDATE — unlike the
-- landing seeds' DO NOTHING, a GA flip's purpose IS to change the stored
-- value — and read the LIVE ai_chat / agent_proposals rows at apply time, so
-- any deployment-specific role posture is followed, never assumed.
-- =====================================================================

-- chat_history_sync (workstream M0): Q19's deferred M0-GA default — follow
-- ai_chat per role (§14.7 M0: "DEFAULT on where ai_chat is on").
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'chat_history_sync',
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key)
  DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();

-- project_memory (workstream M2): Q22g "flips at M2 GA" — on where ai_chat
-- is on.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'project_memory',
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key)
  DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();

-- Per-agent routing eligibility (Q14: "per-agent keys seed on as each stage
-- GAs"): the five GA'd agents follow agent_proposals per role.
--   * agent_explainer stays OFF — Stage 5 keeps its §9.6 entry gate
--     (facet-11 decision traces), which does not exist yet.
--   * agent_apply is deliberately untouched — exactly as seeded
--     (on for modeler/admin/super_admin, off for user; §13.1).
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key,
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'agent_proposals'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN (VALUES ('agent_data_steward'),('agent_policy_configurator'),
                   ('agent_vv_analyst'),('agent_experiment_designer'),
                   ('agent_report_builder')) AS c(key)
ON CONFLICT (role, capability_key)
  DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now();

SELECT pg_notify('pgrst', 'reload schema');
