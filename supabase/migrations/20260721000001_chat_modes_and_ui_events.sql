-- =====================================================================
-- Interaction modes (Ask/Review) + Phase-1 usage-learning event kinds
-- (design: docs/design/ai-agents.md §15, §16.3, §17.3; decision §10 Q23)
-- Ships with Stage 4 / v1.2 Phase 1 (§9.8). Server flag CHAT_MODES_ENABLED
-- gates behavior; this migration only adds storage + vocabulary, so applying
-- it with every flag off is behavior-neutral (§9 kill-switch discipline).
-- =====================================================================

-- §15 storage contract: per-thread mode, server-enforced at §13.2
-- checkpoint 2. 'auto' is DELIBERATELY absent from the CHECK — unlocking it
-- is a migration + a §10 Q6 decision (resolved principals + explicit org
-- opt-in + per-agent accepted-rate ≥ 0.9 sustained 3 months), never a UI
-- change.
ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'review';
ALTER TABLE public.chat_threads DROP CONSTRAINT IF EXISTS chat_threads_mode_check;
ALTER TABLE public.chat_threads
  ADD CONSTRAINT chat_threads_mode_check CHECK (mode IN ('ask','review'));

-- upsert_chat_thread gains p_mode (NULL = keep). The old 8-parameter
-- signature is dropped first: CREATE OR REPLACE with an extra defaulted
-- parameter would OVERLOAD, and two candidates make every named-argument
-- PostgREST call ambiguous.
DROP FUNCTION IF EXISTS public.upsert_chat_thread(uuid,uuid,text,uuid,boolean,text,uuid,boolean);
CREATE OR REPLACE FUNCTION public.upsert_chat_thread(
  p_user_id     uuid,
  p_id          uuid DEFAULT NULL,
  p_title       text DEFAULT NULL,
  p_project_id  uuid DEFAULT NULL,
  p_set_project boolean DEFAULT false,
  p_persona_id  text DEFAULT NULL,
  p_folder_id   uuid DEFAULT NULL,
  p_set_folder  boolean DEFAULT false,
  p_mode        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_owner uuid;
  v_project uuid := p_project_id;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('ask','review') THEN
    RAISE EXCEPTION 'invalid mode % (ask|review)', p_mode;
  END IF;
  -- a project reference must resolve (FK is SET NULL on delete, not validating)
  IF v_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    v_project := NULL;
  END IF;

  SELECT user_id INTO v_owner FROM public.chat_threads WHERE id = v_id;
  IF FOUND THEN
    IF v_owner <> p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    UPDATE public.chat_threads SET
      title      = COALESCE(left(p_title, 120), title),
      project_id = CASE WHEN p_set_project THEN v_project ELSE project_id END,
      persona_id = COALESCE(p_persona_id, persona_id),
      folder_id  = CASE WHEN p_set_folder THEN p_folder_id ELSE folder_id END,
      mode       = COALESCE(p_mode, mode)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.chat_threads (id, user_id, title, project_id, persona_id, folder_id, mode)
    VALUES (v_id, p_user_id, COALESCE(left(p_title, 120), 'New chat'),
            CASE WHEN p_set_project THEN v_project ELSE NULL END,
            p_persona_id,
            CASE WHEN p_set_folder THEN p_folder_id ELSE NULL END,
            COALESCE(p_mode, 'review'));
  END IF;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_chat_thread(uuid,uuid,text,uuid,boolean,text,uuid,boolean,text)
  TO anon, authenticated, service_role;

-- §16.3 Phase-1 usage-learning kinds join the §7.1 closed set:
-- mode.changed / mode.blocked_intent (§15 telemetry) and
-- suggestion.shown / suggestion.clicked (§17.3). Report/file kinds land with
-- their Phase-3 surfaces — the set stays honest about what exists.
ALTER TABLE public.ai_chat_events DROP CONSTRAINT IF EXISTS ai_chat_events_event_kind_check;
ALTER TABLE public.ai_chat_events ADD CONSTRAINT ai_chat_events_event_kind_check
  CHECK (event_kind IN (
    'chat.request','chat.reply','tool.call','router.decision',
    'proposal.created','proposal.viewed','proposal.approved',
    'proposal.rejected','proposal.applied','proposal.apply_failed',
    'proposal.expired',
    'mode.changed','mode.blocked_intent',
    'suggestion.shown','suggestion.clicked'));

-- Client-originated events (§7.1 record_proposal_viewed idiom): the switch
-- flip and the chip click happen in the browser, so one narrow SECURITY
-- DEFINER funnel writes exactly those two kinds — ids and codes only, never
-- message text (§7.5; payload is size-capped and replaced when oversized).
CREATE OR REPLACE FUNCTION public.record_chat_ui_event(
  p_kind       text,
  p_user_id    uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_thread_id  text DEFAULT NULL,
  p_payload    jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF p_kind NOT IN ('mode.changed','suggestion.clicked') THEN
    RAISE EXCEPTION 'unsupported client event kind %', p_kind;
  END IF;
  IF length(v_payload::text) > 2000 THEN v_payload := '{}'::jsonb; END IF;
  INSERT INTO public.ai_chat_events (event_kind, user_id, project_id, thread_id, payload)
  VALUES (p_kind, p_user_id, p_project_id, left(p_thread_id, 120), v_payload);
END; $$;
GRANT EXECUTE ON FUNCTION public.record_chat_ui_event(text,uuid,uuid,text,jsonb)
  TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
