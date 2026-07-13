-- =====================================================================
-- Project memory (M-3) — workstream M, Stage M2
-- (design: docs/design/ai-agents.md §14.4, §14.7).
--
-- Knowledge that outlives the thread: explicit, user-visible, provenance-
-- cited rows written ONLY with user consent — either an explicit verbal ask
-- ("remember that …") or an accepted memory chip. The model never writes
-- memory silently: the only insert path is save_project_memory, called by
-- surfaces that carry the user's consent (mm-03 pins this).
--
-- NOTE (ai-agents.md §10 Q22): the design doc names this file
-- 20260717000002_project_memory.sql; that version slot was taken at M0 by the
-- chat_quick_thread_id sha256 fix, so this migration ships as
-- 20260717000003 — content per §14.4 unchanged.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.project_memory (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('fact','preference','decision')),
  content     text NOT NULL CHECK (char_length(content) <= 500),
  citations   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- §4.3 shape; source thread/message or artifact
  grounding   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- optional {policy_hash, graph_hash} for staleness display
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by  uuid,
  source_thread_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_memory_active
  ON public.project_memory (project_id, status, created_at DESC);

-- Data-API posture: read-only to clients (the sidebar panel and the
-- get_project_memory tool read rows; the tool runs project-scoped under the
-- service role like every registered tool). Writes go through the SECURITY
-- DEFINER RPCs below only — the consent gate lives in the calling surfaces,
-- the RPC funnel guarantees there is no other path.
ALTER TABLE public.project_memory ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.project_memory TO anon, authenticated;
GRANT ALL    ON public.project_memory TO service_role;

DROP POLICY IF EXISTS "project_memory_read_all" ON public.project_memory;
CREATE POLICY "project_memory_read_all"
  ON public.project_memory FOR SELECT TO anon, authenticated USING (true);

-- §14.4 cap: 200 active memories per project (DEFAULT; the UI offers an
-- oldest-archive prompt beyond it — the RPC refuses rather than evicting).
CREATE OR REPLACE FUNCTION public.save_project_memory(
  p_project_id       uuid,
  p_kind             text,
  p_content          text,
  p_citations        jsonb DEFAULT '[]'::jsonb,
  p_source_thread_id uuid  DEFAULT NULL,
  p_user_id          uuid  DEFAULT NULL,
  p_grounding        jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'project % not found', p_project_id;
  END IF;
  IF p_kind NOT IN ('fact','preference','decision') THEN
    RAISE EXCEPTION 'kind must be fact, preference or decision';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'memory content must not be empty';
  END IF;
  IF char_length(p_content) > 500 THEN
    RAISE EXCEPTION 'too_large: memory content exceeds 500 characters';
  END IF;
  IF (SELECT count(*) FROM public.project_memory
       WHERE project_id = p_project_id AND status = 'active') >= 200 THEN
    RAISE EXCEPTION 'too_large: active-memory cap (200) reached for this project — archive older entries first';
  END IF;

  INSERT INTO public.project_memory
    (project_id, kind, content, citations, grounding, created_by, source_thread_id)
  VALUES
    (p_project_id, p_kind, btrim(p_content),
     COALESCE(p_citations, '[]'::jsonb), COALESCE(p_grounding, '{}'::jsonb),
     p_user_id, p_source_thread_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_project_memory(uuid,text,text,jsonb,uuid,uuid,jsonb)
  TO anon, authenticated, service_role;

-- Archive = the user-visible delete (edit = archive + new row, A5 discipline;
-- §14.4). Rows are never hard-deleted while the project lives.
CREATE OR REPLACE FUNCTION public.archive_project_memory(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.project_memory SET status = 'archived'
   WHERE id = p_id AND status = 'active';
$$;
GRANT EXECUTE ON FUNCTION public.archive_project_memory(uuid)
  TO anon, authenticated, service_role;

-- ── capability: project_memory (workstream M2, §14.7) ─────────────────────────
-- Seeded OFF at the M2 landing (the §10 Q19 discipline: a landing PR must not
-- change default behavior; the PROJECT_MEMORY_ENABLED server flag is also
-- off). Flipped at M2 GA via admin_set_capability or a follow-up migration.
INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('project_memory', 'feature', 'Project Memory',
   'Consent-only project memory: saved facts/preferences/decisions cited to their source', 340)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'project_memory', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
