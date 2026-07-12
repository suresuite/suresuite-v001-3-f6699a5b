-- =====================================================================
-- Agent capability seeds — §13.1 grant vocabulary on the unified capability
-- layer (companion to 20260711000002_unified_access_control.sql; design:
-- docs/design/ai-agents.md §13.1, decision §10 Q3/Q14).
-- Flags gate existence (AGENT_ENABLED_IDS), capabilities gate access.
-- =====================================================================

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('agent_proposals',           'feature', 'Agent Proposals',       'See AI proposal cards and receive routed agent drafts',          260),
  ('agent_apply',               'feature', 'Agent Apply',           'Approve/Reject proposal cards (i.e. cause gated mutations)',     270),
  ('agent_data_steward',        'feature', 'Data Steward Agent',    'Routing eligibility for the Data Steward (item-master diffs)',   280),
  ('agent_policy_configurator', 'feature', 'Policy Configurator Agent', 'Routing eligibility for the Policy Configurator (policy bundle diffs)', 290),
  ('agent_vv_analyst',          'feature', 'V&V Analyst Agent',     'Routing eligibility for the V&V Analyst (model-card drafts)',    300),
  ('agent_experiment_designer', 'feature', 'Experiment Designer Agent', 'Routing eligibility for the Experiment Designer (experiment specs)', 310),
  ('agent_explainer',           'feature', 'Explainer Agent',       'Routing eligibility for the Explainer (trace explanations)',     320)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- Role defaults (§13.1 DEFAULT seeding):
--   agent_proposals  → follows ai_chat (on for roles that have ai_chat)
--   agent_apply      → on for modeler/admin/super_admin; off for user
--   per-agent keys   → staged: seeded ON as each agent's stage GAs (Stage 0:
--                      no agent is GA, so all five seed off)
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_proposals',
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_apply', r.role IN ('super_admin','admin','modeler')
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, c.key, false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
CROSS JOIN (VALUES ('agent_data_steward'),('agent_policy_configurator'),
                   ('agent_vv_analyst'),('agent_experiment_designer'),
                   ('agent_explainer')) AS c(key)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
