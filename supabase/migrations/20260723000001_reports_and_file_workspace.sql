-- =====================================================================
-- B6 Report Builder (decision_report) + the file workspace
-- Phase B / §12 / AI agents — v1.2 Phase 3 (ai-agents.md §16, §13.3,
-- §9.8 Phase 3; decisions §10 Q24/Q25).
--
-- Behavior-neutral with the flags off (§9 kill-switch discipline): this
-- migration only adds vocabulary (CHECK swaps), storage (user_files, the
-- private 'workspace' bucket) and SECURITY DEFINER funnels. Nothing here
-- changes a Stage 0–4 code path until AGENT_ENABLED_IDS includes
-- report-builder and FILE_WORKSPACE_ENABLED is set.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. proposals gains the ('report-builder','decision_report') pairing —
--    a constraint swap, never a table rebuild (§16.1).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_id_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_id_check
  CHECK (agent_id IN
    ('data-steward','policy-configurator','vv-analyst',
     'experiment-designer','explainer','report-builder'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_artifact_type_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_artifact_type_check
  CHECK (artifact_type IN
    ('item_master_diff','policy_bundle_diff','model_card_draft',
     'experiment_spec','trace_explanation','decision_report'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_agent_owns_artifact;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_agent_owns_artifact
  CHECK (
    (agent_id, artifact_type) IN (
      ('data-steward','item_master_diff'),
      ('policy-configurator','policy_bundle_diff'),
      ('vv-analyst','model_card_draft'),
      ('experiment-designer','experiment_spec'),
      ('explainer','trace_explanation'),
      ('report-builder','decision_report')));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Capability keys (§13.1, §13.3 row for decision_report):
--    * reports — the operation right for rendering/downloading decision
--      reports (same-as-UI proof: a future manual "Export report" button
--      would demand exactly this). Seeds ON where ai_chat is on.
--    * agent_report_builder — routing eligibility for B6. Seeds OFF for
--      every role at landing (the §10 Q19 discipline: a capability seeded
--      on would flip behavior on deploy before the flag-flip evidence).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('reports',              'feature', 'Decision Reports',     'Render and download decision reports (XLSX/PDF) from the file workspace', 330),
  ('agent_report_builder', 'feature', 'Report Builder Agent', 'Routing eligibility for the Report Builder (decision reports)',           340)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'reports',
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'agent_report_builder', false
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. review_agent_proposal — §13.2 checkpoint 4 gains the §13.3
--    decision_report row: approving a report render requires
--    agent_proposals + reports, NOT agent_apply (rendering a file mutates
--    no project state). Every other artifact keeps the agent_apply rule.
-- ─────────────────────────────────────────────────────────────────────

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
    IF COALESCE((v_caps->>'is_super_admin')::boolean, false) THEN
      v_ok := true;
    ELSIF p_action = 'reject' THEN
      v_ok := COALESCE((v_caps->'features'->>'agent_proposals')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: reject requires the agent_proposals capability';
      END IF;
    ELSIF v_row.artifact_type = 'decision_report' THEN
      -- §13.3: decision_report apply = agent_proposals + reports; rendering
      -- mutates no project state, so agent_apply is deliberately NOT demanded.
      v_ok := COALESCE((v_caps->'features'->>'agent_proposals')::boolean, false)
          AND COALESCE((v_caps->'features'->>'reports')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: approve requires the agent_proposals and reports capabilities';
      END IF;
    ELSE
      v_ok := COALESCE((v_caps->'features'->>'agent_apply')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: approve requires the agent_apply capability';
      END IF;
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. user_files — the §16.2 metadata table. RLS owner-read (defense in
--    depth; the browser's custom-auth reads flow through list_user_files,
--    the Q20 explicit-p_user_id idiom); ALL writes via SECURITY DEFINER
--    RPCs + the service role (the §4.1 posture).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid,
  user_id     uuid NOT NULL,
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('report_xlsx','report_pdf','export_csv','upload')),
  name        text NOT NULL CHECK (char_length(name) <= 200),
  path        text NOT NULL UNIQUE,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  retained    boolean NOT NULL DEFAULT false,
  -- Retention law (§16.2, §10 Q25 DEFAULT): 14-day TTL on unretained files.
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_files_owner
  ON public.user_files (user_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_expiry
  ON public.user_files (expires_at) WHERE NOT retained;
CREATE INDEX IF NOT EXISTS user_files_org
  ON public.user_files (org_id);

ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_files TO anon, authenticated;
GRANT ALL    ON public.user_files TO service_role;

DROP POLICY IF EXISTS "user_files_owner_read" ON public.user_files;
CREATE POLICY "user_files_owner_read"
  ON public.user_files FOR SELECT TO anon, authenticated
  USING (user_id = public.get_current_user_id());

-- §10 Q25 DEFAULT: 500 MB per-user retained cap.
CREATE OR REPLACE FUNCTION public.workspace_retained_cap_bytes() RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT 524288000::bigint $$;

-- Internal: delete the storage objects for a set of workspace paths.
-- Guarded so the function also runs on scratch clusters without the
-- Supabase storage schema (the deterministic tier's Postgres, §7.4).
CREATE OR REPLACE FUNCTION public._delete_workspace_objects(p_paths text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_paths IS NULL OR array_length(p_paths, 1) IS NULL THEN RETURN; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2)'
      USING 'workspace', p_paths;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._delete_workspace_objects(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._delete_workspace_objects(text[]) TO service_role;

-- create_user_file: the ONLY insert path — service context only (report
-- renders and future export paths); the browser never writes rows directly.
CREATE OR REPLACE FUNCTION public.create_user_file(
  p_user_id     uuid,
  p_kind        text,
  p_name        text,
  p_path        text,
  p_size_bytes  bigint,
  p_org_id      uuid DEFAULT NULL,
  p_project_id  uuid DEFAULT NULL,
  p_proposal_id uuid DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL,
  -- caller-supplied id so the row id equals the <file_id> embedded in the
  -- storage path (the §16.2 path law's audit story)
  p_id          uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := p_org_id;
  v_id  uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user id required'; END IF;
  IF v_org IS NULL THEN
    SELECT organization_id INTO v_org FROM public.approved_users WHERE id = p_user_id;
  END IF;
  INSERT INTO public.user_files (id, org_id, user_id, project_id, proposal_id, kind, name, path, size_bytes, expires_at)
  VALUES (COALESCE(p_id, gen_random_uuid()), v_org, p_user_id, p_project_id, p_proposal_id, p_kind,
          left(p_name, 200), p_path, p_size_bytes,
          COALESCE(p_expires_at, now() + interval '14 days'))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_user_file(uuid,text,text,text,bigint,uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_file(uuid,text,text,text,bigint,uuid,uuid,uuid,timestamptz,uuid) TO service_role;

-- sweep_expired_files: the retention law's delete — row AND storage object,
-- in one transaction. Unretained rows past expires_at only; nothing the user
-- marked Keep is ever auto-deleted. Emits file.expired events (§16.3,
-- id-attributed only — §7.5). Called lazily by list_user_files (scoped to
-- the caller) and by the scheduled cleanup (unscoped, service context).
CREATE OR REPLACE FUNCTION public.sweep_expired_files(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rows  public.user_files[];
  v_paths text[];
  r       public.user_files;
BEGIN
  SELECT array_agg(f.*) INTO v_rows
    FROM public.user_files f
   WHERE NOT f.retained
     AND f.expires_at < now()
     AND (p_user_id IS NULL OR f.user_id = p_user_id);
  IF v_rows IS NULL THEN
    RETURN jsonb_build_object('deleted', 0, 'paths', '[]'::jsonb);
  END IF;

  v_paths := ARRAY(SELECT (u).path FROM unnest(v_rows) AS u);
  PERFORM public._delete_workspace_objects(v_paths);
  DELETE FROM public.user_files WHERE path = ANY(v_paths);

  -- §16.3 file.expired — best-effort telemetry, never blocks the sweep.
  BEGIN
    FOREACH r IN ARRAY v_rows LOOP
      INSERT INTO public.ai_chat_events (event_kind, user_id, project_id, payload)
      VALUES ('file.expired', r.user_id, r.project_id,
              jsonb_build_object('file_id', r.id, 'kind', r.kind, 'size_bytes', r.size_bytes));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('deleted', coalesce(array_length(v_paths, 1), 0), 'paths', to_jsonb(v_paths));
END; $$;
GRANT EXECUTE ON FUNCTION public.sweep_expired_files(uuid)
  TO anon, authenticated, service_role;

-- list_user_files: owner-scoped read (Q20 explicit-p_user_id idiom) with the
-- §16.2 lazy sweep — an expired unretained file never appears in a listing.
CREATE OR REPLACE FUNCTION public.list_user_files(
  p_user_id    uuid,
  p_project_id uuid DEFAULT NULL
) RETURNS SETOF public.user_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.sweep_expired_files(p_user_id);
  RETURN QUERY SELECT * FROM public.user_files
   WHERE user_id = p_user_id
     AND (p_project_id IS NULL OR project_id = p_project_id)
   ORDER BY created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION public.list_user_files(uuid,uuid)
  TO anon, authenticated, service_role;

-- set_file_retained: the Keep toggle. Retaining enforces the 500 MB per-user
-- cap IN SQL (typed failure 'retention_cap: …'); emits file.kept (§16.3).
CREATE OR REPLACE FUNCTION public.set_file_retained(
  p_file_id  uuid,
  p_user_id  uuid,
  p_retained boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row      public.user_files;
  v_retained bigint;
  v_cap      bigint := public.workspace_retained_cap_bytes();
BEGIN
  SELECT * INTO v_row FROM public.user_files
   WHERE id = p_file_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'file % not found', p_file_id; END IF;

  IF p_retained THEN
    SELECT COALESCE(sum(size_bytes), 0) INTO v_retained
      FROM public.user_files
     WHERE user_id = p_user_id AND retained AND id <> p_file_id;
    IF v_retained + v_row.size_bytes > v_cap THEN
      RAISE EXCEPTION 'retention_cap: keeping this file (% bytes) would exceed the % MB per-user retained cap (% bytes already kept)',
        v_row.size_bytes, v_cap / 1048576, v_retained;
    END IF;
  END IF;

  UPDATE public.user_files SET retained = p_retained WHERE id = p_file_id;

  IF p_retained THEN
    BEGIN
      INSERT INTO public.ai_chat_events (event_kind, user_id, project_id, payload)
      VALUES ('file.kept', p_user_id, v_row.project_id,
              jsonb_build_object('file_id', v_row.id, 'kind', v_row.kind, 'size_bytes', v_row.size_bytes));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_file_retained(uuid,uuid,boolean)
  TO anon, authenticated, service_role;

-- delete_user_file: owner-initiated delete — row AND storage object.
CREATE OR REPLACE FUNCTION public.delete_user_file(
  p_file_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.user_files;
BEGIN
  SELECT * INTO v_row FROM public.user_files
   WHERE id = p_file_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'file % not found', p_file_id; END IF;
  PERFORM public._delete_workspace_objects(ARRAY[v_row.path]);
  DELETE FROM public.user_files WHERE id = p_file_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_user_file(uuid,uuid)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Admin rollup (§16.2): org → file count, bytes, expiring-in-7d.
--    Read posture matches the existing admin surfaces (ai_usage_logs):
--    the admin page reads it with the platform client; it exposes only
--    aggregates, never paths or names. Rolls up on user_files.org_id —
--    the same org the §16.2 path law encodes.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.admin_org_file_usage AS
SELECT
  f.org_id,
  o.name AS org_name,
  count(*)::bigint                                                              AS file_count,
  COALESCE(sum(f.size_bytes), 0)::bigint                                        AS total_bytes,
  COALESCE(sum(f.size_bytes) FILTER (WHERE f.retained), 0)::bigint              AS retained_bytes,
  count(*) FILTER (WHERE NOT f.retained
                     AND f.expires_at < now() + interval '7 days')::bigint      AS expiring_7d
FROM public.user_files f
LEFT JOIN public.organizations o ON o.id = f.org_id
GROUP BY f.org_id, o.name;

GRANT SELECT ON public.admin_org_file_usage TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 6. The private 'workspace' storage bucket (§16.2). Path law:
--    org/<org_id>/user/<user_id>/<project_id|shared>/<file_id>__<name>.
--    NO storage.objects policies are created: anon/authenticated get no
--    direct object access at all — uploads run under the service role and
--    downloads are 60-minute signed URLs minted after an ownership check
--    (no public bucket, no unsigned URLs). Guarded so the migration also
--    applies on scratch clusters without the storage schema (§7.4 tier 1).
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $ins$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('workspace', 'workspace', false)
      ON CONFLICT (id) DO UPDATE SET public = false
    $ins$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. §16.3 usage-learning kinds join the §7.1 closed set: report.rendered /
--    report.downloaded / file.kept / file.expired (deferred from Phase 1 —
--    landed with their surfaces, the set stays honest about what exists).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_chat_events DROP CONSTRAINT IF EXISTS ai_chat_events_event_kind_check;
ALTER TABLE public.ai_chat_events ADD CONSTRAINT ai_chat_events_event_kind_check
  CHECK (event_kind IN (
    'chat.request','chat.reply','tool.call','router.decision',
    'proposal.created','proposal.viewed','proposal.approved',
    'proposal.rejected','proposal.applied','proposal.apply_failed',
    'proposal.expired',
    'mode.changed','mode.blocked_intent',
    'suggestion.shown','suggestion.clicked',
    'report.rendered','report.downloaded','file.kept','file.expired'));

-- ─────────────────────────────────────────────────────────────────────
-- 8. Scheduled cleanup (§16.2 retention law): a daily sweep beside the
--    lazy on-list sweep. Uses pg_cron when the deployment ships it;
--    otherwise the report-render function's {action:"sweep"} endpoint is
--    the scheduler's entry point (both call the same RPC).
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('workspace-file-sweep', '17 3 * * *',
                          'SELECT public.sweep_expired_files();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
