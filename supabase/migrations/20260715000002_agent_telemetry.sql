-- =====================================================================
-- AI chat telemetry — typed event stream beside the ai_usage_logs ledger
-- (Stage 0; design: docs/design/ai-agents.md §7.1, §7.5)
-- ai_usage_logs remains the cost/usage ledger and is not modified.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_chat_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- attribution (ids only — §7.5 privacy: no emails, no message text)
  user_id      uuid,
  org_id       uuid,
  project_id   uuid,
  thread_id    text,
  request_id   text,          -- one uuid per project-ai-chat invocation, shared by its events

  -- actor
  persona_id   text,          -- 'risk-analyst' | ... | 'general' | null
  agent_id     text,          -- 'data-steward' | ... | null
  model_code   text,
  provider_code text,

  -- event
  event_kind   text NOT NULL CHECK (event_kind IN (
    'chat.request',        -- payload: {prompt_chars, history_len, has_project}
    'chat.reply',          -- payload: {reply_chars, parts_kinds: text[], blocked: bool}
    'tool.call',           -- payload: {tool, args_sha256, ok, row_count, note}
    'router.decision',     -- payload: RouteDecision minus advisory_part/artifact_part
                           --          plus {short_circuit: text|null}
    'proposal.created', 'proposal.viewed', 'proposal.approved',
    'proposal.rejected', 'proposal.applied', 'proposal.apply_failed',
    'proposal.expired')),  -- payload: {artifact_type, provenance, status_reason?, apply_attempts?}
  proposal_id  uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms   integer
);

CREATE INDEX IF NOT EXISTS ai_chat_events_time    ON public.ai_chat_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_chat_events_project ON public.ai_chat_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_chat_events_kind    ON public.ai_chat_events (event_kind, created_at DESC);

-- Same read posture as ai_usage_logs: super-admin reads all, users read own.
ALTER TABLE public.ai_chat_events ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.ai_chat_events TO service_role;
GRANT SELECT ON public.ai_chat_events TO authenticated;
GRANT ALL    ON public.ai_chat_events TO service_role;
DROP POLICY IF EXISTS "chat_events: super read" ON public.ai_chat_events;
CREATE POLICY "chat_events: super read" ON public.ai_chat_events FOR SELECT
  USING (public.current_is_super_admin());
DROP POLICY IF EXISTS "chat_events: user read own" ON public.ai_chat_events;
CREATE POLICY "chat_events: user read own" ON public.ai_chat_events FOR SELECT
  USING (user_id = public.get_current_user_id());

-- record_proposal_viewed: the ONE client-originated event (§7.1). SECURITY
-- DEFINER; writes only the 'proposal.viewed' kind, attributing the proposal's
-- project/thread context by id — never free text.
CREATE OR REPLACE FUNCTION public.record_proposal_viewed(
  p_proposal_id uuid,
  p_user_id     uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.proposals%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal % not found', p_proposal_id; END IF;
  INSERT INTO public.ai_chat_events (
    user_id, project_id, thread_id, agent_id, model_code, provider_code,
    event_kind, proposal_id, payload
  ) VALUES (
    COALESCE(p_user_id, public.get_current_user_id()),
    v_row.project_id, v_row.thread_id, v_row.agent_id,
    v_row.model_code, v_row.provider_code,
    'proposal.viewed', v_row.id,
    jsonb_build_object('artifact_type', v_row.artifact_type,
                       'provenance', v_row.provenance)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.record_proposal_viewed(uuid,uuid)
  TO anon, authenticated, service_role;

-- Retention: 180 days DEFAULT (§7.5), enforced by a scheduled call to this
-- sweeper (service role only — wiring the schedule is an ops step).
CREATE OR REPLACE FUNCTION public.prune_ai_chat_events(
  p_retention_days integer DEFAULT 180
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.ai_chat_events
   WHERE created_at < now() - make_interval(days => GREATEST(p_retention_days, 1));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.prune_ai_chat_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_ai_chat_events(integer) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
