-- =====================================================================
-- Agent proposals — the reviewable unit of Layer B output
-- (Stage 0 / G-series: §12 platform law; design: docs/design/ai-agents.md §4)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- who drafted it
  agent_id           text NOT NULL CHECK (agent_id IN
                       ('data-steward','policy-configurator','vv-analyst',
                        'experiment-designer','explainer')),
  artifact_type      text NOT NULL CHECK (artifact_type IN
                       ('item_master_diff','policy_bundle_diff','model_card_draft',
                        'experiment_spec','trace_explanation')),
  -- pairing is fixed (one artifact class per agent, §5); enforced here so a
  -- buggy tool cannot file a foreign artifact under the wrong owner:
  CONSTRAINT proposals_agent_owns_artifact CHECK (
    (agent_id, artifact_type) IN (
      ('data-steward','item_master_diff'),
      ('policy-configurator','policy_bundle_diff'),
      ('vv-analyst','model_card_draft'),
      ('experiment-designer','experiment_spec'),
      ('explainer','trace_explanation'))),

  -- content
  schema_version     integer NOT NULL DEFAULT 1,
  title              text NOT NULL CHECK (char_length(title) <= 140),
  payload            jsonb NOT NULL,            -- per-artifact JSON Schema, §5
  citations          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- §4.3 shape
  provenance         text NOT NULL CHECK (provenance IN
                       ('deterministic',   -- values computed by named reducers; LLM packaged only
                        'llm_drafted',     -- LLM-selected/derived content, human must verify
                        'user_supplied')), -- values dictated verbatim by the user's message
  -- grounding freshness: hashes of the artifacts the payload was drafted against
  grounding          jsonb NOT NULL DEFAULT '{}'::jsonb,
                     -- {graph_hash?, policy_hash?, scenario_hash?, registry_version?}

  -- idempotency & lineage
  idempotency_key    text NOT NULL,   -- sha256 over (agent_id ∥ artifact_type ∥ canonical payload core), §4.5
  superseded_by      uuid REFERENCES public.proposals(id) ON DELETE SET NULL,

  -- lifecycle
  status             text NOT NULL DEFAULT 'proposed' CHECK (status IN
                       ('draft','proposed','approved','applied','rejected','expired')),
  status_reason      text,            -- rejection note / expiry cause / supersession pointer
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '14 days',

  -- apply bookkeeping (written only by agent-apply via service role)
  apply_attempts     integer NOT NULL DEFAULT 0,
  apply_error        text,
  applied_result     jsonb,           -- per-artifact result incl. `before` state for revert, §4.4
  applied_at         timestamptz,

  -- attribution & audit
  thread_id          text,            -- client thread uuid (localStorage), for card anchoring
  model_code         text,            -- which LLM drafted (client model id, e.g. 'gemini-2.5-flash')
  provider_code      text,            -- 'gemini' | 'openai' | 'deepseek'
  created_by         uuid,            -- asserted user id (Layer A trust model; see §8 row S1)
  created_by_email   text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One live proposal per idempotency key per project: a re-drafted identical ask
-- converges on the existing card instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS proposals_live_idem_uq
  ON public.proposals (project_id, idempotency_key)
  WHERE status IN ('draft','proposed','approved');

CREATE INDEX IF NOT EXISTS proposals_project_status
  ON public.proposals (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_thread
  ON public.proposals (thread_id, created_at DESC);

-- Data-API posture: read-only to clients, like model_validations.
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.proposals TO anon, authenticated;
GRANT ALL    ON public.proposals TO service_role;

DROP POLICY IF EXISTS "proposals_read_all" ON public.proposals;
CREATE POLICY "proposals_read_all"
  ON public.proposals FOR SELECT TO anon, authenticated USING (true);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public._proposals_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS proposals_touch ON public.proposals;
CREATE TRIGGER proposals_touch BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public._proposals_touch();

-- create_agent_proposal: the ONLY insert path. Called by the edge function
-- (service context) on behalf of a draft_* tool. Returns the new id, or the
-- existing live id on an idempotency hit (duplicate ⇒ converge, never error).
CREATE OR REPLACE FUNCTION public.create_agent_proposal(
  p_project_id      uuid,
  p_agent_id        text,
  p_artifact_type   text,
  p_title           text,
  p_payload         jsonb,
  p_citations       jsonb,
  p_provenance      text,
  p_grounding       jsonb,
  p_idempotency_key text,
  p_thread_id       text DEFAULT NULL,
  p_model_code      text DEFAULT NULL,
  p_provider_code   text DEFAULT NULL,
  p_user_id         uuid DEFAULT NULL,
  p_user_email      text DEFAULT NULL,
  p_status          text DEFAULT 'proposed'   -- 'draft' | 'proposed' only
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('draft','proposed') THEN
    RAISE EXCEPTION 'create_agent_proposal: status must be draft or proposed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;
  SELECT id INTO v_id FROM public.proposals
   WHERE project_id = p_project_id AND idempotency_key = p_idempotency_key
     AND status IN ('draft','proposed','approved')
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- §8 T10: per-user live-proposal cap (DEFAULT 20) — mass drafting cannot
  -- bloat the fabric or spam cards.
  IF (SELECT count(*) FROM public.proposals
       WHERE project_id = p_project_id
         AND created_by IS NOT DISTINCT FROM p_user_id
         AND status IN ('draft','proposed','approved')) >= 20 THEN
    RAISE EXCEPTION 'too_large: live-proposal cap (20) reached for this project';
  END IF;

  INSERT INTO public.proposals (
    project_id, agent_id, artifact_type, title, payload, citations,
    provenance, grounding, idempotency_key, thread_id,
    model_code, provider_code, created_by, created_by_email, status
  ) VALUES (
    p_project_id, p_agent_id, p_artifact_type, p_title, p_payload,
    COALESCE(p_citations,'[]'::jsonb), p_provenance,
    COALESCE(p_grounding,'{}'::jsonb), p_idempotency_key, p_thread_id,
    p_model_code, p_provider_code, p_user_id, p_user_email, p_status
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_agent_proposal(uuid,text,text,text,jsonb,jsonb,text,jsonb,text,text,text,text,uuid,text,text)
  TO anon, authenticated, service_role;

-- review_agent_proposal: the user's approve / reject on the card.
--   proposed → approved | rejected;  draft → proposed (agent completing a draft).
CREATE OR REPLACE FUNCTION public.review_agent_proposal(
  p_proposal_id uuid,
  p_action      text,            -- 'approve' | 'reject' | 'propose'
  p_user_id     uuid DEFAULT NULL,
  p_user_email  text DEFAULT NULL,
  p_note        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal % not found', p_proposal_id; END IF;
  IF p_action = 'approve' THEN
    IF v_status <> 'proposed' THEN RAISE EXCEPTION 'approve requires status=proposed (is %)', v_status; END IF;
    UPDATE public.proposals SET status='approved', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'reject' THEN
    IF v_status NOT IN ('proposed','approved') THEN RAISE EXCEPTION 'reject requires proposed|approved (is %)', v_status; END IF;
    UPDATE public.proposals SET status='rejected', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'propose' THEN
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'propose requires status=draft (is %)', v_status; END IF;
    UPDATE public.proposals SET status='proposed' WHERE id=p_proposal_id;
  ELSE
    RAISE EXCEPTION 'unknown action %', p_action;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_agent_proposal(uuid,text,uuid,text,text)
  TO anon, authenticated, service_role;

-- mark_agent_proposal_applied / _apply_failed: SERVICE ROLE ONLY — the
-- agent-apply edge function is the sole writer of apply outcomes, the same
-- single-writer discipline the worker has over run results (asset A11).
CREATE OR REPLACE FUNCTION public.mark_agent_proposal_applied(
  p_proposal_id uuid, p_result jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.proposals
     SET status='applied', applied_result=p_result, applied_at=now(), apply_error=NULL
   WHERE id = p_proposal_id AND status = 'approved';
$$;
REVOKE ALL ON FUNCTION public.mark_agent_proposal_applied(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_agent_proposal_applied(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_agent_proposal_apply_failed(
  p_proposal_id uuid, p_error text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.proposals
     SET apply_attempts = apply_attempts + 1, apply_error = left(p_error, 500)
   WHERE id = p_proposal_id AND status = 'approved';
$$;
REVOKE ALL ON FUNCTION public.mark_agent_proposal_apply_failed(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_agent_proposal_apply_failed(uuid,text) TO service_role;

-- supersede_agent_proposal: filed by create_agent_proposal callers when a new
-- draft replaces a live one on the same target (e.g. user asked again with
-- changed intent). Old card keeps history; never deleted.
CREATE OR REPLACE FUNCTION public.supersede_agent_proposal(
  p_old_id uuid, p_new_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.proposals
     SET status='expired', status_reason='superseded', superseded_by=p_new_id
   WHERE id = p_old_id AND status IN ('draft','proposed','approved');
$$;
GRANT EXECUTE ON FUNCTION public.supersede_agent_proposal(uuid,uuid)
  TO anon, authenticated, service_role;

-- expire_agent_proposals: lazy sweep, called by list_agent_proposals.
-- Expires (a) past expires_at, (b) grounding drift — the payload was drafted
-- against hashes that no longer match the project (mirrors the §9.5 staleness
-- law: credibility is never inferred across drift).
CREATE OR REPLACE FUNCTION public.expire_agent_proposals(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.proposals p
     SET status='expired',
         status_reason = CASE WHEN p.expires_at < now() THEN 'ttl' ELSE 'grounding_drift' END
   WHERE p.project_id = p_project_id
     AND p.status IN ('draft','proposed','approved')
     AND ( p.expires_at < now()
           OR (p.grounding ? 'policy_hash'
               AND p.grounding->>'policy_hash' IS DISTINCT FROM public.current_policy_hash(p_project_id))
           OR (p.grounding ? 'graph_hash'
               AND p.grounding->>'graph_hash' IS DISTINCT FROM public.current_graph_hash(p_project_id)) );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
GRANT EXECUTE ON FUNCTION public.expire_agent_proposals(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_agent_proposals(
  p_project_id uuid, p_status text DEFAULT NULL
) RETURNS SETOF public.proposals
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.expire_agent_proposals(p_project_id);
  RETURN QUERY SELECT * FROM public.proposals
   WHERE project_id = p_project_id
     AND (p_status IS NULL OR status = p_status)
   ORDER BY created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_agent_proposals(uuid,text)
  TO anon, authenticated, service_role;

-- Realtime: proposal cards update live in open threads.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public'
                   AND tablename='proposals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proposals;
  END IF;
END $$;
ALTER TABLE public.proposals REPLICA IDENTITY FULL;

SELECT pg_notify('pgrst', 'reload schema');
