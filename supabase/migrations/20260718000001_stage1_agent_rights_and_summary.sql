-- =====================================================================
-- Stage 1 + M1 server hardening — Phase B / §12 / AI agents
-- (design: docs/design/ai-agents.md §13.2 checkpoint 4, §4.2, §14.3)
--
-- 1. review_agent_proposal gains the §13.2 checkpoint-4 rights check:
--    'approve' requires the agent_apply capability, 'reject' requires
--    agent_proposals — both resolved server-side via get_my_capabilities
--    for the asserted user (the platform-wide Layer A trust model; §13.5).
--    The RPC also records the proposal.approved / proposal.rejected events
--    (§4.2 side effects) so the acceptance metric needs no client write.
-- 2. set_thread_summary: the M1 rolling-summary write/delete path
--    (§14.3 integrity: user-deletable ⇒ summary NULL, summary_upto_seq 0).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.review_agent_proposal(
  p_proposal_id uuid,
  p_action      text,            -- 'approve' | 'reject' | 'propose'
  p_user_id     uuid DEFAULT NULL,
  p_user_email  text DEFAULT NULL,
  p_note        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row  public.proposals%ROWTYPE;
  v_caps jsonb;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_row FROM public.proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal % not found', p_proposal_id; END IF;

  -- §13.2 checkpoint 4 (fail closed): resolve grants for the asserted user.
  -- 'propose' is the agent completing its own draft (service context) and
  -- carries no user grant.
  IF p_action IN ('approve', 'reject') THEN
    v_caps := public.get_my_capabilities(p_user_id);
    v_ok := COALESCE((v_caps->>'is_super_admin')::boolean, false)
         OR COALESCE((v_caps->'features'->>
              CASE WHEN p_action = 'approve' THEN 'agent_apply' ELSE 'agent_proposals' END
            )::boolean, false);
    IF NOT v_ok THEN
      RAISE EXCEPTION 'forbidden: % requires the % capability',
        p_action,
        CASE WHEN p_action = 'approve' THEN 'agent_apply' ELSE 'agent_proposals' END;
    END IF;
  END IF;

  IF p_action = 'approve' THEN
    IF v_row.status <> 'proposed' THEN RAISE EXCEPTION 'approve requires status=proposed (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='approved', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'reject' THEN
    IF v_row.status NOT IN ('proposed','approved') THEN RAISE EXCEPTION 'reject requires proposed|approved (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='rejected', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'propose' THEN
    IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'propose requires status=draft (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='proposed' WHERE id=p_proposal_id;
  ELSE
    RAISE EXCEPTION 'unknown action %', p_action;
  END IF;

  -- §4.2 side effects: the review events, id-attributed only (§7.5).
  IF p_action IN ('approve', 'reject') THEN
    INSERT INTO public.ai_chat_events (
      user_id, project_id, thread_id, agent_id, model_code, provider_code,
      event_kind, proposal_id, payload
    ) VALUES (
      p_user_id, v_row.project_id, v_row.thread_id, v_row.agent_id,
      v_row.model_code, v_row.provider_code,
      CASE WHEN p_action = 'approve' THEN 'proposal.approved' ELSE 'proposal.rejected' END,
      v_row.id,
      jsonb_build_object('artifact_type', v_row.artifact_type,
                         'provenance', v_row.provenance,
                         'status_reason', p_note)
    );
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_agent_proposal(uuid,text,uuid,text,text)
  TO anon, authenticated, service_role;

-- ── M1: rolling-summary write / delete (§14.3) ────────────────────────────────
-- Owner-checked like every chat-store write; called by project-ai-chat with
-- the thread owner's id after a refresh, and by the thread-info panel with
-- p_summary NULL to delete ("What the assistant remembers" is the user's).
CREATE OR REPLACE FUNCTION public.set_thread_summary(
  p_thread_id uuid,
  p_user_id   uuid,
  p_summary   text,
  p_upto_seq  integer DEFAULT 0
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  IF p_summary IS NULL OR btrim(p_summary) = '' THEN
    UPDATE public.chat_threads SET summary = NULL, summary_upto_seq = 0
     WHERE id = p_thread_id;
  ELSE
    UPDATE public.chat_threads
       SET summary = left(p_summary, 4000),
           summary_upto_seq = GREATEST(COALESCE(p_upto_seq, 0), 0)
     WHERE id = p_thread_id;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_thread_summary(uuid,uuid,text,integer)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
