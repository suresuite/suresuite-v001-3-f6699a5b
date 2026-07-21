-- =====================================================================
-- B9 Disruption Sentinel v1 (risk_alert) — on-demand event assessment
-- Phase D / G12 / AI agents — v1.5 Phase 4d (ai-agents.md §18.3, §18.5,
-- §13.1, §13.3, §8 T11; decision §10 Q28; landing notes §10 note 37).
--
-- Behavior-neutral with the flags off (§9 kill-switch discipline): this
-- migration swaps the proposals CHECK vocabulary, adds ONE narrow
-- service-role RPC (the impact fill — §18.3 hard gate 8), and seeds one
-- capability key OFF for every role (§10 Q19 discipline). Nothing here
-- changes a code path until AGENT_ENABLED_IDS includes disruption-sentinel
-- AND an admin grants agent_disruption_sentinel. The evidence substrate is
-- Phase 4b's external_evidence store, reused unchanged (one pipeline, two
-- consumers — §18.3 stage 5).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. proposals gains the ('disruption-sentinel','risk_alert') pairing —
--    a constraint swap, never a table rebuild (§18.1 precedent).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_id_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_id_check
  CHECK (agent_id IN
    ('data-steward','policy-configurator','vv-analyst',
     'experiment-designer','explainer','report-builder','cost-estimator',
     'network-cartographer','disruption-sentinel'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_artifact_type_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_artifact_type_check
  CHECK (artifact_type IN
    ('item_master_diff','policy_bundle_diff','model_card_draft',
     'experiment_spec','trace_explanation','decision_report',
     'parameter_estimate','network_map_diff','risk_alert'));

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
      ('cost-estimator','parameter_estimate'),
      ('network-cartographer','network_map_diff'),
      ('disruption-sentinel','risk_alert')));

-- ─────────────────────────────────────────────────────────────────────
-- 2. update_risk_alert_impact — the ONLY writer of a complete impact
--    block (§18.3 hard gate 8; §10 note 37g). Service-role only (the
--    mark_* single-writer discipline): agent-apply calls it on-demand
--    when the linked run has completed; it fills a PENDING impact
--    exactly once, for an APPLIED risk_alert, and never overwrites a
--    complete one. Impact numbers therefore can only enter through
--    agent-apply's read of run_replications — never a client, never a
--    model.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_risk_alert_impact(
  p_proposal_id uuid,
  p_impact      jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_impact IS NULL OR jsonb_typeof(p_impact) <> 'object'
     OR p_impact->>'status' <> 'complete'
     OR p_impact->>'run_id' IS NULL THEN
    RAISE EXCEPTION 'impact must be a complete impact object with a run_id';
  END IF;

  UPDATE public.proposals
     SET applied_result = jsonb_set(COALESCE(applied_result, '{}'::jsonb),
                                    '{impact}', p_impact)
   WHERE id = p_proposal_id
     AND status = 'applied'
     AND artifact_type = 'risk_alert'
     AND COALESCE(applied_result->'impact'->>'status', 'pending') = 'pending'
  RETURNING applied_result INTO v_result;

  IF v_result IS NULL THEN
    -- Idempotent: an already-complete impact (or a non-applied card) is
    -- returned as stored, never overwritten.
    SELECT applied_result INTO v_result FROM public.proposals
     WHERE id = p_proposal_id AND artifact_type = 'risk_alert';
    IF v_result IS NULL THEN
      RAISE EXCEPTION 'risk_alert proposal % not found', p_proposal_id;
    END IF;
  END IF;
  RETURN v_result;
END; $$;
-- Service role ONLY — deliberately NOT granted to anon/authenticated.
REVOKE ALL ON FUNCTION public.update_risk_alert_impact(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_risk_alert_impact(uuid, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Capability key (§13.1): agent_disruption_sentinel — routing
--    eligibility for B9. Seeds OFF for every role at landing. The §13.3
--    rights row for risk_alert reuses existing keys (agent_apply +
--    simulation_lab + /simulation-lab — the experiment row: approving an
--    alert dispatches a run), so no new operation right is needed.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('agent_disruption_sentinel', 'feature', 'Disruption Sentinel Agent',
   'Routing eligibility for the Disruption Sentinel (on-demand corroborated risk alerts with simulation-sized impact)', 370)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_disruption_sentinel', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
