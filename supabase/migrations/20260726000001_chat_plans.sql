-- =====================================================================
-- chat_plans — the §21 agent-harness task plan, one server-side row per
-- plan (Phase H3; design: docs/design/ai-agents.md §21.2, D3/Q34).
-- The proposals posture verbatim: client SELECT, writes via SECURITY
-- DEFINER RPCs, realtime publication. A plan is owner-scoped thread
-- state (like a folder rename) — it can never touch project data and
-- sits outside the §13.3 rights matrix by construction.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.chat_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL,
  project_id    uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       uuid,
  agent_id      text,                          -- owning agent slug (v1: 'experiment-designer')
  title         text NOT NULL DEFAULT 'Task plan' CHECK (char_length(title) <= 140),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN
                  ('active','done','failed','abandoned','expired')),
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- §21.1 step shape
  resume_count  integer NOT NULL DEFAULT 0,           -- §21.5 cap 10
  model_code    text,                                  -- last model to advance it (D3: informational)
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_plans_thread ON public.chat_plans (thread_id, status, created_at DESC);

-- Data-API posture (§21.2 "the proposals posture verbatim"): read-only to
-- clients so PlanCard can SELECT + subscribe under the app's custom auth;
-- every write goes through the RPCs below.
ALTER TABLE public.chat_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_plans TO anon, authenticated;
GRANT ALL    ON public.chat_plans TO service_role;

DROP POLICY IF EXISTS "chat_plans_read_all" ON public.chat_plans;
CREATE POLICY "chat_plans_read_all"
  ON public.chat_plans FOR SELECT TO anon, authenticated USING (true);

-- updated_at maintenance (the proposals trigger idiom)
CREATE OR REPLACE FUNCTION public._chat_plans_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS chat_plans_touch ON public.chat_plans;
CREATE TRIGGER chat_plans_touch BEFORE UPDATE ON public.chat_plans
  FOR EACH ROW EXECUTE FUNCTION public._chat_plans_touch();

-- upsert_chat_plan: SERVICE PATH ONLY (edge fn) — the single write funnel the
-- update_task_plan handler, the §21.4 resume pre-step and the §21.3 integrity
-- sweep all use. p_plan keys: id? (absent ⇒ create), thread_id, project_id?,
-- agent_id?, title?, status?, steps, model_code?, increment_resume? (boolean —
-- §21.4: resume_count increments only on turns that reach the LLM).
-- Create supersedes: any other active plan in the thread goes 'abandoned'
-- (§21.1 rule 1 — one live plan per thread, §4.2-style, never deleted).
CREATE OR REPLACE FUNCTION public.upsert_chat_plan(
  p_plan    jsonb,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_row     public.chat_plans;
  v_project uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_plan IS NULL OR (p_plan->>'thread_id') IS NULL THEN
    RAISE EXCEPTION 'upsert_chat_plan: p_plan.thread_id is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_plan->'steps', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'upsert_chat_plan: steps must be a json array';
  END IF;
  IF jsonb_array_length(COALESCE(p_plan->'steps', '[]'::jsonb)) > 12 THEN
    RAISE EXCEPTION 'invalid_params: a plan allows at most 12 steps';
  END IF;
  v_project := NULLIF(p_plan->>'project_id', '')::uuid;
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    v_project := NULL;
  END IF;

  IF (p_plan->>'id') IS NULL THEN
    -- create; supersede any other live plan in the thread first.
    UPDATE public.chat_plans
       SET status = 'abandoned'
     WHERE thread_id = (p_plan->>'thread_id')::uuid
       AND user_id = p_user_id
       AND status = 'active';
    INSERT INTO public.chat_plans (thread_id, project_id, user_id, agent_id, title, status, steps, model_code)
    VALUES (
      (p_plan->>'thread_id')::uuid,
      v_project,
      p_user_id,
      p_plan->>'agent_id',
      COALESCE(left(p_plan->>'title', 140), 'Task plan'),
      COALESCE(p_plan->>'status', 'active'),
      COALESCE(p_plan->'steps', '[]'::jsonb),
      p_plan->>'model_code'
    ) RETURNING id INTO v_id;
  ELSE
    v_id := (p_plan->>'id')::uuid;
    SELECT * INTO v_row FROM public.chat_plans WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan % not found', v_id; END IF;
    IF v_row.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_row.thread_id::text IS DISTINCT FROM (p_plan->>'thread_id') THEN
      RAISE EXCEPTION 'plan % is not in this thread', v_id;
    END IF;
    UPDATE public.chat_plans SET
      title        = COALESCE(left(p_plan->>'title', 140), title),
      status       = COALESCE(p_plan->>'status', status),
      steps        = COALESCE(p_plan->'steps', steps),
      model_code   = COALESCE(p_plan->>'model_code', model_code),
      resume_count = resume_count + CASE WHEN COALESCE((p_plan->>'increment_resume')::boolean, false) THEN 1 ELSE 0 END
    WHERE id = v_id;
  END IF;

  SELECT * INTO v_row FROM public.chat_plans WHERE id = v_id;
  RETURN to_jsonb(v_row);
END; $$;
REVOKE ALL ON FUNCTION public.upsert_chat_plan(jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_chat_plan(jsonb,uuid) TO service_role;

-- get_chat_plan / list_chat_plans: owner reads (the §10 Q20 explicit
-- p_user_id idiom — the 20260711000002 resolver posture).
CREATE OR REPLACE FUNCTION public.get_chat_plan(p_plan_id uuid, p_user_id uuid)
RETURNS SETOF public.chat_plans
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.chat_plans WHERE id = p_plan_id AND user_id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_chat_plan(uuid,uuid) TO anon, authenticated, service_role;

-- expire_chat_plans: lazy TTL sweep, the §4.1 expire_agent_proposals pattern
-- (per-thread, called by list_chat_plans and the edge fn's plan reads).
CREATE OR REPLACE FUNCTION public.expire_chat_plans(p_thread_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.chat_plans
     SET status = 'expired'
   WHERE thread_id = p_thread_id
     AND status = 'active'
     AND expires_at < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
GRANT EXECUTE ON FUNCTION public.expire_chat_plans(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_chat_plans(p_thread_id uuid, p_user_id uuid)
RETURNS SETOF public.chat_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.expire_chat_plans(p_thread_id);
  RETURN QUERY SELECT * FROM public.chat_plans
   WHERE thread_id = p_thread_id AND user_id = p_user_id
   ORDER BY created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_chat_plans(uuid,uuid) TO anon, authenticated, service_role;

-- advance_chat_plan_step: the ONE owner-callable write — the §21.4 approval
-- resume ("the client advances the step to awaiting_run (one RPC) and posts
-- the resume turn"). Deliberately narrow: exactly the two client-legal
-- transitions, both FROM awaiting_approval —
--   * → awaiting_run, requiring p_run_id (the applied_result.run_id binding
--     that lets the resume pre-step advance deterministically);
--   * → failed with a note (rejection / typed apply failure, §13.6 rule 3).
-- Everything else (model-driven updates, the integrity sweep, run-completion
-- advancement) stays on the service path.
CREATE OR REPLACE FUNCTION public.advance_chat_plan_step(
  p_plan_id uuid,
  p_step_id text,
  p_status  text,
  p_user_id uuid,
  p_note    text DEFAULT NULL,
  p_run_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row   public.chat_plans;
  v_steps jsonb := '[]'::jsonb;
  v_step  jsonb;
  v_found boolean := false;
BEGIN
  IF p_status NOT IN ('awaiting_run','failed') THEN
    RAISE EXCEPTION 'invalid_params: advance_chat_plan_step allows only awaiting_run or failed';
  END IF;
  IF p_status = 'awaiting_run' AND p_run_id IS NULL THEN
    RAISE EXCEPTION 'invalid_params: awaiting_run requires p_run_id (§21.1 rule 4)';
  END IF;
  SELECT * INTO v_row FROM public.chat_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan % not found', p_plan_id; END IF;
  IF v_row.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_row.status <> 'active' THEN RAISE EXCEPTION 'plan % is not active (is %)', p_plan_id, v_row.status; END IF;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_row.steps) LOOP
    IF (v_step->>'id') = p_step_id THEN
      v_found := true;
      IF (v_step->>'status') <> 'awaiting_approval' THEN
        RAISE EXCEPTION 'invalid_params: step % is % — only awaiting_approval steps advance here', p_step_id, v_step->>'status';
      END IF;
      v_step := jsonb_set(v_step, '{status}', to_jsonb(p_status));
      IF p_note IS NOT NULL THEN
        v_step := jsonb_set(v_step, '{note}', to_jsonb(left(p_note, 200)));
      END IF;
      IF p_run_id IS NOT NULL THEN
        v_step := jsonb_set(v_step, '{ref}',
          COALESCE(v_step->'ref', '{}'::jsonb) || jsonb_build_object('run_id', p_run_id));
      END IF;
    END IF;
    v_steps := v_steps || v_step;
  END LOOP;
  IF NOT v_found THEN RAISE EXCEPTION 'step % not found on plan %', p_step_id, p_plan_id; END IF;

  UPDATE public.chat_plans SET steps = v_steps WHERE id = p_plan_id;
  SELECT * INTO v_row FROM public.chat_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_row);
END; $$;
GRANT EXECUTE ON FUNCTION public.advance_chat_plan_step(uuid,text,text,uuid,text,uuid)
  TO anon, authenticated, service_role;

-- §21.3 telemetry: the three plan kinds join the ai_chat_events CHECK — the
-- established per-phase extension pattern (20260721000001, 20260723000001,
-- 20260724000001). Payloads carry ids and counts only (§7.5).
ALTER TABLE public.ai_chat_events DROP CONSTRAINT IF EXISTS ai_chat_events_event_kind_check;
ALTER TABLE public.ai_chat_events ADD CONSTRAINT ai_chat_events_event_kind_check
  CHECK (event_kind IN (
    'chat.request','chat.reply','tool.call','router.decision',
    'proposal.created','proposal.viewed','proposal.approved',
    'proposal.rejected','proposal.applied','proposal.apply_failed',
    'proposal.expired',
    'mode.changed','mode.blocked_intent',
    'suggestion.shown','suggestion.clicked',
    'report.rendered','report.downloaded','file.kept','file.expired',
    'verifier.blocked_reply',
    'plan.created','plan.step_changed','plan.closed'));

-- Realtime: the PlanCard checklist updates live (§21.2).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public'
                   AND tablename='chat_plans') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_plans;
  END IF;
END $$;
ALTER TABLE public.chat_plans REPLICA IDENTITY FULL;

SELECT pg_notify('pgrst', 'reload schema');
