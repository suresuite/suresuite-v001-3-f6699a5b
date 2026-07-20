-- =====================================================================
-- B7 Cost Estimator (parameter_estimate)
-- Phase D / G12 / AI agents — v1.5 Phase 4a (ai-agents.md §18.1, §18.5,
-- §13.1, §13.3; decision §10 Q26).
--
-- Behavior-neutral with the flags off (§9 kill-switch discipline): this
-- migration only adds vocabulary (CHECK swaps) and one capability key
-- seeded OFF for every role (§10 Q19 discipline — a capability seeded on
-- would flip behavior on deploy before the flag-flip evidence). Nothing
-- here changes a code path until AGENT_ENABLED_IDS includes
-- cost-estimator AND an admin grants agent_cost_estimator.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. proposals gains the ('cost-estimator','parameter_estimate')
--    pairing — a constraint swap, never a table rebuild (§18.1).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_id_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_id_check
  CHECK (agent_id IN
    ('data-steward','policy-configurator','vv-analyst',
     'experiment-designer','explainer','report-builder','cost-estimator'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_artifact_type_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_artifact_type_check
  CHECK (artifact_type IN
    ('item_master_diff','policy_bundle_diff','model_card_draft',
     'experiment_spec','trace_explanation','decision_report',
     'parameter_estimate'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_owns_artifact;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_owns_artifact
  CHECK (
    (agent_id, artifact_type) IN (
      ('data-steward','item_master_diff'),
      ('policy-configurator','policy_bundle_diff'),
      ('vv-analyst','model_card_draft'),
      ('experiment-designer','experiment_spec'),
      ('explainer','trace_explanation'),
      ('report-builder','decision_report'),
      ('cost-estimator','parameter_estimate')));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Capability key (§13.1): agent_cost_estimator — routing eligibility
--    for B7. Seeds OFF for every role at landing. The §13.3 rights row
--    for parameter_estimate reuses existing keys (agent_apply +
--    data_editing — identical to item_master_diff), so no new operation
--    right is needed.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('agent_cost_estimator', 'feature', 'Cost Estimator Agent',
   'Routing eligibility for the Cost Estimator (parameter estimates with uncertainty intervals)', 350)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_cost_estimator', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
