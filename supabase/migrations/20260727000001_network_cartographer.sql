-- =====================================================================
-- B8 Network Cartographer v1 (network_map_diff) — firm-level mapping
-- Phase D / G12 / AI agents — v1.5 Phase 4b (ai-agents.md §18.2, §18.5,
-- §13.1, §13.3, §8 T11; decision §10 Q27).
--
-- Behavior-neutral with the flags off (§9 kill-switch discipline): this
-- migration adds the external_evidence store (SELECT-only for clients,
-- writes through one SECURITY DEFINER RPC — the proposals-table posture),
-- swaps the proposals CHECK vocabulary, and seeds one capability key OFF
-- for every role (§10 Q19 discipline). Nothing here changes a code path
-- until AGENT_ENABLED_IDS includes network-cartographer AND an admin
-- grants agent_network_cartographer.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- 1. external_evidence — §18.2's provenance-scored ingest store.
--    External data never enters grounding directly: agents cite these
--    rows; the text they came from is data, never instructions (§8 T11).
--    Column set exactly as §18.2 names it.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.external_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id    text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 80),
  url_or_ref   text,
  content_hash text NOT NULL CHECK (char_length(content_hash) BETWEEN 8 AND 128),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  -- Deterministic from the source's trust_grade (§10 note 36e) — never
  -- LLM-scored.
  confidence   numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  -- Canonical triple: {subject:{name,lei?}, relation, object:{name,type?},
  --                    quote, doc_title?} (§18.2 pipeline stage 6).
  triple       jsonb NOT NULL,
  -- GLEIF LEI when the subject resolved against the seed slice (§18.2
  -- stage 4); null = unresolved (normalized-name identity, weaker).
  lei          text CHECK (lei IS NULL OR lei ~ '^[A-Z0-9]{20}$')
);

-- Idempotent ingestion: re-ingesting the same document from the same
-- source converges on the existing rows (content-addressed, §18.2).
CREATE UNIQUE INDEX IF NOT EXISTS external_evidence_dedupe_uq
  ON public.external_evidence (project_id, source_id, content_hash, md5(triple::text));

CREATE INDEX IF NOT EXISTS external_evidence_project_idx
  ON public.external_evidence (project_id, retrieved_at DESC);

-- Data-API posture: read-only to clients, like proposals.
ALTER TABLE public.external_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.external_evidence TO anon, authenticated;
GRANT ALL    ON public.external_evidence TO service_role;

DROP POLICY IF EXISTS "external_evidence_read_all" ON public.external_evidence;
CREATE POLICY "external_evidence_read_all"
  ON public.external_evidence FOR SELECT TO anon, authenticated USING (true);

-- record_external_evidence: the ONLY insert path (the create_agent_proposal
-- discipline). Called by the edge function (service context) on behalf of
-- ingest_network_evidence. Returns the new id, or the existing id on a
-- dedupe hit (converge, never error). The source-registry guard
-- (assertRegistered, _shared/sourceRegistry.ts) runs in the edge function
-- BEFORE this RPC — an unregistered source never reaches it.
CREATE OR REPLACE FUNCTION public.record_external_evidence(
  p_project_id   uuid,
  p_source_id    text,
  p_url_or_ref   text,
  p_content_hash text,
  p_confidence   numeric,
  p_triple       jsonb,
  p_lei          text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;
  IF p_triple IS NULL OR jsonb_typeof(p_triple) <> 'object' THEN
    RAISE EXCEPTION 'triple must be a JSON object';
  END IF;

  SELECT id INTO v_id FROM public.external_evidence
   WHERE project_id = p_project_id
     AND source_id = p_source_id
     AND content_hash = p_content_hash
     AND md5(triple::text) = md5(p_triple::text)
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- §8 T11: per-project evidence cap (5,000 DEFAULT) — mass ingestion
  -- cannot bloat the store.
  IF (SELECT count(*) FROM public.external_evidence
       WHERE project_id = p_project_id) >= 5000 THEN
    RAISE EXCEPTION 'too_large: external-evidence cap (5000) reached for this project';
  END IF;

  INSERT INTO public.external_evidence
    (project_id, source_id, url_or_ref, content_hash, confidence, triple, lei)
  VALUES
    (p_project_id, p_source_id, NULLIF(p_url_or_ref, ''), p_content_hash,
     p_confidence, p_triple, NULLIF(upper(COALESCE(p_lei, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_external_evidence(uuid,text,text,text,numeric,jsonb,text)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. proposals gains the ('network-cartographer','network_map_diff')
--    pairing — a constraint swap, never a table rebuild (§18.1 precedent).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_id_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_id_check
  CHECK (agent_id IN
    ('data-steward','policy-configurator','vv-analyst',
     'experiment-designer','explainer','report-builder','cost-estimator',
     'network-cartographer'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_artifact_type_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_artifact_type_check
  CHECK (artifact_type IN
    ('item_master_diff','policy_bundle_diff','model_card_draft',
     'experiment_spec','trace_explanation','decision_report',
     'parameter_estimate','network_map_diff'));

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
      ('network-cartographer','network_map_diff')));

-- ─────────────────────────────────────────────────────────────────────
-- 3. Capability key (§13.1): agent_network_cartographer — routing
--    eligibility for B8. Seeds OFF for every role at landing. The §13.3
--    rights row for network_map_diff reuses existing keys (agent_apply +
--    data_editing — the same rights the manual assign path demands), so
--    no new operation right is needed.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('agent_network_cartographer', 'feature', 'Network Cartographer Agent',
   'Routing eligibility for the Network Cartographer (evidence-cited deep-tier network mapping)', 360)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_network_cartographer', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
