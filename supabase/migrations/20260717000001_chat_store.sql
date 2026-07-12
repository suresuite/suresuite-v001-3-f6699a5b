-- =====================================================================
-- Server-side chat store — workstream M, Stage M0
-- (design: docs/design/ai-agents.md §14.1–§14.2, §14.5, §14.7)
-- Threads/messages move server-side; localStorage becomes a cache. The
-- summary columns (§14.3) ship here unused — M1 activates them.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.chat_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  folder_id     uuid REFERENCES public.chat_folders(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  persona_id    text,                          -- 'risk-analyst' | ... | null
  title         text NOT NULL DEFAULT 'New chat' CHECK (char_length(title) <= 120),
  pinned        boolean NOT NULL DEFAULT false,
  archived      boolean NOT NULL DEFAULT false,
  -- rolling summary (§14.3): covers messages [1 .. summary_upto_seq]
  summary            text CHECK (char_length(summary) <= 4000),
  summary_upto_seq   integer NOT NULL DEFAULT 0,
  last_message_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_threads_user_recent
  ON public.chat_threads (user_id, archived, pinned DESC, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  seq         integer NOT NULL,                -- 1-based, dense per thread
  role        text NOT NULL CHECK (role IN ('user','assistant')),
  content     text NOT NULL CHECK (char_length(content) <= 32000),
  parts       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the ChatPart[] the UI renders
  tool_calls  jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  model_code  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, seq),
  -- full-text search vector (§14.5) — default retrieval, no new model needed
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS chat_messages_fts ON public.chat_messages USING gin (fts);

-- ── access posture (§14.1) ────────────────────────────────────────────────────
-- Owner-read RLS; ALL writes through the SECURITY DEFINER RPCs below. Under the
-- app's custom auth the browser reads through the owner-scoped list_* RPCs
-- (explicit p_user_id, the 20260711000002 resolver idiom); the RLS policies
-- keep direct table reads owner-bounded for token-authenticated contexts.
ALTER TABLE public.chat_folders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_folders, public.chat_threads, public.chat_messages TO anon, authenticated;
GRANT ALL    ON public.chat_folders, public.chat_threads, public.chat_messages TO service_role;

DROP POLICY IF EXISTS "chat_folders: owner read" ON public.chat_folders;
CREATE POLICY "chat_folders: owner read" ON public.chat_folders FOR SELECT
  USING (user_id = public.get_current_user_id());
DROP POLICY IF EXISTS "chat_threads: owner read" ON public.chat_threads;
CREATE POLICY "chat_threads: owner read" ON public.chat_threads FOR SELECT
  USING (user_id = public.get_current_user_id());
DROP POLICY IF EXISTS "chat_messages: owner read" ON public.chat_messages;
CREATE POLICY "chat_messages: owner read" ON public.chat_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.chat_threads t
                 WHERE t.id = chat_messages.thread_id
                   AND t.user_id = public.get_current_user_id()));

-- ── helpers ───────────────────────────────────────────────────────────────────

-- Deterministic per-user id for the permanent "Quick chat" scratch thread
-- (§14.2 rule 1): the same derivation runs client-side, so every device of a
-- user converges on one server row without a discovery round trip.
CREATE OR REPLACE FUNCTION public.chat_quick_thread_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT encode(substring(digest('suresuite.quick.' || p_user_id::text, 'sha256') from 1 for 16), 'hex')::uuid;
$$;
GRANT EXECUTE ON FUNCTION public.chat_quick_thread_id(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._chat_assert_thread_owner(p_thread_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.chat_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread % not found', p_thread_id; END IF;
  IF p_user_id IS NULL OR v_owner <> p_user_id THEN RAISE EXCEPTION 'forbidden'; END IF;
END; $$;

-- ── write RPCs (§14.1 signature contracts; bodies follow the §4.1 idiom) ──────

CREATE OR REPLACE FUNCTION public.create_chat_folder(
  p_user_id uuid, p_name text, p_position integer DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.chat_folders (user_id, name, position)
  VALUES (p_user_id, p_name, COALESCE(p_position, 0))
  ON CONFLICT (user_id, name) DO UPDATE SET position = EXCLUDED.position
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_chat_folder(uuid,text,integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_chat_folder(
  p_folder_id uuid, p_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.chat_folders WHERE id = p_folder_id AND user_id = p_user_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_chat_folder(uuid,uuid) TO anon, authenticated, service_role;

-- upsert_chat_thread: create (p_id NULL ⇒ new id) or update an owned thread.
-- NULL means "keep" for title/persona; project/folder changes are explicit via
-- p_set_project/p_set_folder so NULL can also mean "detach".
CREATE OR REPLACE FUNCTION public.upsert_chat_thread(
  p_user_id     uuid,
  p_id          uuid DEFAULT NULL,
  p_title       text DEFAULT NULL,
  p_project_id  uuid DEFAULT NULL,
  p_set_project boolean DEFAULT false,
  p_persona_id  text DEFAULT NULL,
  p_folder_id   uuid DEFAULT NULL,
  p_set_folder  boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_owner uuid;
  v_project uuid := p_project_id;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
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
      folder_id  = CASE WHEN p_set_folder THEN p_folder_id ELSE folder_id END
    WHERE id = v_id;
  ELSE
    INSERT INTO public.chat_threads (id, user_id, title, project_id, persona_id, folder_id)
    VALUES (v_id, p_user_id, COALESCE(left(p_title, 120), 'New chat'),
            CASE WHEN p_set_project THEN v_project ELSE NULL END,
            p_persona_id,
            CASE WHEN p_set_folder THEN p_folder_id ELSE NULL END);
  END IF;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_chat_thread(uuid,uuid,text,uuid,boolean,text,uuid,boolean)
  TO anon, authenticated, service_role;

-- append_chat_message: assigns the next dense seq under a thread row lock,
-- stamps last_message_at, enforces the 32,000-char content cap. Returns the
-- assigned seq.
CREATE OR REPLACE FUNCTION public.append_chat_message(
  p_user_id     uuid,
  p_thread_id   uuid,
  p_role        text,
  p_content     text,
  p_parts       jsonb DEFAULT '[]'::jsonb,
  p_tool_calls  jsonb DEFAULT '[]'::jsonb,
  p_proposal_id uuid DEFAULT NULL,
  p_model_code  text DEFAULT NULL,
  p_created_at  timestamptz DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_seq integer;
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  PERFORM 1 FROM public.chat_threads WHERE id = p_thread_id FOR UPDATE;
  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.chat_messages WHERE thread_id = p_thread_id;
  INSERT INTO public.chat_messages
    (thread_id, seq, role, content, parts, tool_calls, proposal_id, model_code, created_at)
  VALUES
    (p_thread_id, v_seq, p_role, left(COALESCE(p_content, ''), 32000),
     COALESCE(p_parts, '[]'::jsonb), COALESCE(p_tool_calls, '[]'::jsonb),
     p_proposal_id, p_model_code, COALESCE(p_created_at, now()));
  UPDATE public.chat_threads
     SET last_message_at = COALESCE(p_created_at, now())
   WHERE id = p_thread_id;
  RETURN v_seq;
END; $$;
GRANT EXECUTE ON FUNCTION public.append_chat_message(uuid,uuid,text,text,jsonb,jsonb,uuid,text,timestamptz)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.move_chat_thread(
  p_thread_id uuid, p_folder_id uuid, p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_folders f WHERE f.id = p_folder_id AND f.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'folder % not found', p_folder_id;
  END IF;
  UPDATE public.chat_threads SET folder_id = p_folder_id WHERE id = p_thread_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.move_chat_thread(uuid,uuid,uuid) TO anon, authenticated, service_role;

-- set_thread_flags: NULL keeps the current value.
CREATE OR REPLACE FUNCTION public.set_thread_flags(
  p_thread_id uuid, p_pinned boolean, p_archived boolean, p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  UPDATE public.chat_threads
     SET pinned   = COALESCE(p_pinned, pinned),
         archived = COALESCE(p_archived, archived)
   WHERE id = p_thread_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_thread_flags(uuid,boolean,boolean,uuid) TO anon, authenticated, service_role;

-- delete_chat_thread: hard delete, cascades messages — the user's right to
-- erase their history (§14.2, §14.6).
CREATE OR REPLACE FUNCTION public.delete_chat_thread(
  p_thread_id uuid, p_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  DELETE FROM public.chat_threads WHERE id = p_thread_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_chat_thread(uuid,uuid) TO anon, authenticated, service_role;

-- import_local_threads: the one-time §14.7 migration from localStorage.
-- Idempotent by thread id: a thread whose (mapped) id already exists is
-- skipped whole — re-running the import can never duplicate or interleave.
-- Id mapping: valid uuid → kept verbatim; 'quick' → chat_quick_thread_id;
-- any other legacy id → md5-derived uuid of (user, local id), so re-imports
-- of the same legacy thread converge.
CREATE OR REPLACE FUNCTION public.import_local_threads(
  p_user_id uuid, p_threads jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_thread    jsonb;
  v_msg       jsonb;
  v_local_id  text;
  v_id        uuid;
  v_project   uuid;
  v_seq       integer;
  v_imported  integer := 0;
  v_skipped   integer := 0;
  v_mappings  jsonb := '[]'::jsonb;
  v_was_new   boolean;
  v_updated_at timestamptz;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_threads IS NULL OR jsonb_typeof(p_threads) <> 'array' THEN
    RAISE EXCEPTION 'import_local_threads: p_threads must be a json array';
  END IF;

  FOR v_thread IN SELECT * FROM jsonb_array_elements(p_threads) LOOP
    v_local_id := v_thread->>'id';
    IF v_local_id IS NULL OR v_local_id = '' THEN CONTINUE; END IF;

    IF v_local_id = 'quick' THEN
      v_id := public.chat_quick_thread_id(p_user_id);
    ELSIF v_local_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_id := v_local_id::uuid;
    ELSE
      v_id := md5(p_user_id::text || ':' || v_local_id)::uuid;
    END IF;

    v_was_new := NOT EXISTS (SELECT 1 FROM public.chat_threads WHERE id = v_id);
    IF NOT v_was_new THEN
      v_skipped := v_skipped + 1;
      v_mappings := v_mappings || jsonb_build_object(
        'local_id', v_local_id, 'server_id', v_id, 'imported', false);
      CONTINUE;
    END IF;

    v_project := NULL;
    IF (v_thread->>'projectId') IS NOT NULL
       AND (v_thread->>'projectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO v_project FROM public.projects WHERE id = (v_thread->>'projectId')::uuid;
    END IF;

    v_updated_at := CASE
      WHEN (v_thread->>'updatedAt') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN to_timestamp((v_thread->>'updatedAt')::numeric / 1000.0)
      ELSE NULL END;

    INSERT INTO public.chat_threads (id, user_id, title, project_id, persona_id, last_message_at)
    VALUES (
      v_id, p_user_id,
      COALESCE(NULLIF(left(v_thread->>'title', 120), ''),
               CASE WHEN v_local_id = 'quick' THEN 'Quick chat' ELSE 'New chat' END),
      v_project,
      NULLIF(v_thread->>'agentId', ''),
      v_updated_at
    );

    v_seq := 0;
    IF jsonb_typeof(v_thread->'messages') = 'array' THEN
      FOR v_msg IN SELECT * FROM jsonb_array_elements(v_thread->'messages') LOOP
        IF (v_msg->>'role') NOT IN ('user','assistant') THEN CONTINUE; END IF;
        v_seq := v_seq + 1;
        INSERT INTO public.chat_messages
          (thread_id, seq, role, content, parts, tool_calls, created_at)
        VALUES (
          v_id, v_seq, v_msg->>'role',
          left(COALESCE(v_msg->>'content', ''), 32000),
          CASE WHEN jsonb_typeof(v_msg->'parts') = 'array' THEN v_msg->'parts' ELSE '[]'::jsonb END,
          CASE WHEN jsonb_typeof(v_msg->'toolCalls') = 'array' THEN v_msg->'toolCalls' ELSE '[]'::jsonb END,
          CASE WHEN (v_msg->>'createdAt') ~ '^[0-9]+(\.[0-9]+)?$'
               THEN to_timestamp((v_msg->>'createdAt')::numeric / 1000.0)
               ELSE now() END
        );
      END LOOP;
    END IF;

    v_imported := v_imported + 1;
    v_mappings := v_mappings || jsonb_build_object(
      'local_id', v_local_id, 'server_id', v_id, 'imported', true);
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'mappings', v_mappings);
END; $$;
GRANT EXECUTE ON FUNCTION public.import_local_threads(uuid,jsonb) TO anon, authenticated, service_role;

-- ── read RPCs (owner-scoped, explicit p_user_id — the resolver idiom) ─────────

CREATE OR REPLACE FUNCTION public.list_chat_folders(p_user_id uuid)
RETURNS SETOF public.chat_folders
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.chat_folders WHERE user_id = p_user_id
   ORDER BY position ASC, name ASC;
$$;
GRANT EXECUTE ON FUNCTION public.list_chat_folders(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_chat_threads(p_user_id uuid)
RETURNS SETOF public.chat_threads
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.chat_threads WHERE user_id = p_user_id
   ORDER BY pinned DESC, last_message_at DESC NULLS LAST, created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_chat_threads(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_chat_messages(p_thread_id uuid, p_user_id uuid)
RETURNS SETOF public.chat_messages
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._chat_assert_thread_owner(p_thread_id, p_user_id);
  RETURN QUERY SELECT * FROM public.chat_messages
   WHERE thread_id = p_thread_id ORDER BY seq ASC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_chat_messages(uuid,uuid) TO anon, authenticated, service_role;

-- search_chat_messages: global FTS over the caller's own messages (§14.5),
-- optional project filter, ≤ 50 hits, newest-first within rank.
CREATE OR REPLACE FUNCTION public.search_chat_messages(
  p_user_id uuid, p_query text, p_project_id uuid DEFAULT NULL
) RETURNS TABLE (
  thread_id uuid, thread_title text, project_id uuid,
  message_id uuid, seq integer, role text, snippet text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id, t.title, t.project_id,
         m.id, m.seq, m.role,
         ts_headline('english', m.content, plainto_tsquery('english', p_query),
                     'MaxWords=24, MinWords=8, ShortWord=2'),
         m.created_at
    FROM public.chat_messages m
    JOIN public.chat_threads t ON t.id = m.thread_id
   WHERE t.user_id = p_user_id
     AND (p_project_id IS NULL OR t.project_id = p_project_id)
     AND m.fts @@ plainto_tsquery('english', p_query)
   ORDER BY ts_rank(m.fts, plainto_tsquery('english', p_query)) DESC, m.created_at DESC
   LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.search_chat_messages(uuid,text,uuid) TO anon, authenticated, service_role;

-- ── capability: chat_history_sync (workstream M0, §14.7) ─────────────────────
-- Seeded OFF at M0 landing so default behavior stays byte-identical to the
-- localStorage baseline; flipped to follow ai_chat at M0 GA (ai-agents.md §10
-- Q19 records the landing-vs-GA default).
INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('chat_history_sync', 'feature', 'Chat History Sync',
   'Server-side chat threads: cross-device history, folders and search', 330)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'chat_history_sync', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
