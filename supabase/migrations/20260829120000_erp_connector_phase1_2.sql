-- ERP/MRP connector — Phase 1 (single read-only connector pilot) + Phase 2
-- (scheduled sync + audit), per docs/design/erp-mrp-integration-plan.md (G18).
--
-- Design constraints this schema enforces (see plan §6b, §6c, §6c.1):
--   * A link is a two-sided grant: project ownership on this side, proven
--     company membership on the ERP side (checked by the Edge Function via
--     the linking user's own OAuth token — never inferred here).
--   * One link = one token reference = one project. No credential is ever
--     shared across links, so revoking one project's link cannot be
--     bypassed by a sibling project.
--   * Nothing lands in materials/products/bom_* directly. Every sync stages
--     rows first; a human (or an auto-apply rule under the anomaly
--     threshold) approves the merge — mirrors UploadWizard's existing
--     preview-before-commit pattern.
--   * Every sync is audited with a mapping report (mapped/defaulted/failed
--     field counts) in the same shape as simulation_runs.mapping_warnings,
--     so the UI's Sync Mapping Report can reuse MappingWarningsCard's logic.

-- ── Vault-backed token storage: external_oauth_token_ref names a secret in
--    Supabase Vault, never a value stored in the clear in this schema
--    (plan §2 principle 4, §6b rule 1 — the connector holds no static/shared
--    ERP credential, only per-link, per-user delegated tokens) ───────────────
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.get_erp_oauth_token(p_ref text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_ref;
$$;
-- service_role only: the Edge Function is the sole caller. No authenticated
-- grant here — a browser session must never be able to read a raw ERP token.
GRANT EXECUTE ON FUNCTION public.get_erp_oauth_token(text) TO service_role;

-- ── project_erp_links: one row per authorized project↔external-company link ──
CREATE TABLE IF NOT EXISTS public.project_erp_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  external_system       text NOT NULL,             -- 'orbit-mrp' today; generalized in Phase 3
  external_company_id   text NOT NULL,             -- the ERP's own company/tenant id
  external_company_name text,                      -- cached label for the UI, refreshed on each sync
  linked_by_user_id     uuid NOT NULL REFERENCES auth.users(id),
  -- Never the raw token: a pointer into Supabase Vault / Edge Function
  -- secrets. The Edge Function resolves this to a live OAuth token; this
  -- table never stores a credential in the clear.
  external_oauth_token_ref text NOT NULL,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'needs_attention', 'revoked')),
  status_detail         text,                      -- e.g. "Access revoked in orbit-mrp — reconnect"
  last_verified_at      timestamptz,                -- last successful live re-check (plan §6b rule 3)
  auto_apply_threshold_pct numeric NOT NULL DEFAULT 0
                          CHECK (auto_apply_threshold_pct >= 0 AND auto_apply_threshold_pct <= 100),
  created_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  UNIQUE (project_id, external_system, external_company_id)
);

COMMENT ON TABLE public.project_erp_links IS
  'One authorized project<->external-ERP-company link. Created only when the '
  'linking user has project access on this side AND the external system''s '
  'own OAuth consent has just proven company membership on that side '
  '(docs/design/erp-mrp-integration-plan.md §6b). auto_apply_threshold_pct=0 '
  'means every sync requires manual approval (Phase 1 default); raising it '
  'is the Phase 2 "auto-apply small changes" opt-in.';

-- ── erp_sync_runs: one row per sync attempt — the audit trail + mapping report ─
CREATE TABLE IF NOT EXISTS public.erp_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id         uuid NOT NULL REFERENCES public.project_erp_links(id) ON DELETE CASCADE,
  triggered_by    text NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  triggered_by_user_id uuid REFERENCES auth.users(id),  -- null for scheduled runs
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'staged', 'applied', 'failed', 'skipped')),
  -- Row counts, mirroring the "old=... new=..." verification docs/self-hosting.md
  -- already does by hand for a migration — surfaced in-product instead.
  rows_fetched    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"products": 1007, "bom_versions": 25, ...}
  rows_new        int NOT NULL DEFAULT 0,
  rows_changed    int NOT NULL DEFAULT 0,
  rows_unchanged  int NOT NULL DEFAULT 0,
  rows_removed    int NOT NULL DEFAULT 0,
  -- Same shape as simulation_runs.mapping_warnings (scsim MappingWarning):
  -- [{"level": "warn"|"info"|"error", "field": "...", "message": "..."}]
  mapping_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  fields_mapped   int NOT NULL DEFAULT 0,
  fields_defaulted int NOT NULL DEFAULT 0,
  fields_failed   int NOT NULL DEFAULT 0,
  diff_summary    jsonb,             -- rendered diff for the review UI, kept until applied/rejected
  applied_at      timestamptz,
  applied_by_user_id uuid REFERENCES auth.users(id),
  error_detail    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_sync_runs IS
  'Audit trail + Sync Mapping Report source for every connector sync, manual '
  'or scheduled (Phase 2). fields_mapped/defaulted/failed drive the same '
  'green/amber/red badge logic as MappingWarningsCard '
  '(src/components/sim/RunProgressPanel.tsx) — see plan §6c.1.';

-- ── Staging tables: raw external shape + provenance, never written straight
--    into materials/products/bom_* (plan §2 principles 0-1, §3) ──────────────
CREATE TABLE IF NOT EXISTS public.erp_staged_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id       uuid NOT NULL REFERENCES public.erp_sync_runs(id) ON DELETE CASCADE,
  link_id           uuid NOT NULL REFERENCES public.project_erp_links(id) ON DELETE CASCADE,
  external_id       text NOT NULL,          -- orbit-mrp products.id
  sku               text,
  name              text,
  product_type      text,                   -- finished_good | subassembly | raw_material
  unit_of_measure   text,
  lead_time_days    numeric,
  moq               numeric,
  unit_cost         numeric,
  supplier_name     text,
  supplier_number   text,
  cycle_time_seconds numeric,
  raw               jsonb NOT NULL,         -- full source row, for anything not yet mapped
  diff_state        text NOT NULL DEFAULT 'new'
                      CHECK (diff_state IN ('new', 'changed', 'unchanged', 'removed_upstream')),
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_staged_bom_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id     uuid NOT NULL REFERENCES public.erp_sync_runs(id) ON DELETE CASCADE,
  link_id         uuid NOT NULL REFERENCES public.project_erp_links(id) ON DELETE CASCADE,
  external_id     text NOT NULL,           -- orbit-mrp bom_versions.id
  external_product_id text NOT NULL,       -- orbit-mrp products.id, resolved via erp_staged_products
  version         text,
  is_active       boolean,
  raw             jsonb NOT NULL,
  diff_state      text NOT NULL DEFAULT 'new'
                    CHECK (diff_state IN ('new', 'changed', 'unchanged', 'removed_upstream')),
  synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_staged_bom_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id           uuid NOT NULL REFERENCES public.erp_sync_runs(id) ON DELETE CASCADE,
  link_id               uuid NOT NULL REFERENCES public.project_erp_links(id) ON DELETE CASCADE,
  external_id           text NOT NULL,        -- orbit-mrp bom_lines.id
  external_bom_version_id text NOT NULL,
  external_component_product_id text NOT NULL,
  quantity_per_unit     numeric,
  scrap_factor          numeric,
  raw                   jsonb NOT NULL,
  diff_state            text NOT NULL DEFAULT 'new'
                          CHECK (diff_state IN ('new', 'changed', 'unchanged', 'removed_upstream')),
  synced_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_staged_products_sync_run_idx ON public.erp_staged_products (sync_run_id);
CREATE INDEX IF NOT EXISTS erp_staged_bom_versions_sync_run_idx ON public.erp_staged_bom_versions (sync_run_id);
CREATE INDEX IF NOT EXISTS erp_staged_bom_lines_sync_run_idx ON public.erp_staged_bom_lines (sync_run_id);
CREATE INDEX IF NOT EXISTS project_erp_links_project_idx ON public.project_erp_links (project_id);
CREATE INDEX IF NOT EXISTS erp_sync_runs_link_idx ON public.erp_sync_runs (link_id, created_at DESC);

-- ── RLS: link/run/staging visibility follows the same project-access rule
--    projects itself already uses (owner/admin/plant access) ─────────────────
ALTER TABLE public.project_erp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_staged_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_staged_bom_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_staged_bom_lines ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.modeler_id = public.get_current_user_id()
           OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_project_access(uuid) TO authenticated;

CREATE POLICY "erp_links: project access" ON public.project_erp_links
  FOR ALL TO authenticated
  USING (public.has_project_access(project_id))
  WITH CHECK (public.has_project_access(project_id));

CREATE POLICY "erp_sync_runs: project access" ON public.erp_sync_runs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.project_erp_links l
                 WHERE l.id = link_id AND public.has_project_access(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.project_erp_links l
                       WHERE l.id = link_id AND public.has_project_access(l.project_id)));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_staged_products','erp_staged_bom_versions','erp_staged_bom_lines'] LOOP
    EXECUTE format($f$
      CREATE POLICY "%1$s: project access" ON public.%1$s
        FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM public.project_erp_links l
                       WHERE l.id = link_id AND public.has_project_access(l.project_id)))
        WITH CHECK (EXISTS (SELECT 1 FROM public.project_erp_links l
                             WHERE l.id = link_id AND public.has_project_access(l.project_id)));
    $f$, t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
  END LOOP;
END $$;

GRANT ALL ON public.project_erp_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_erp_links TO authenticated;
GRANT ALL ON public.erp_sync_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_sync_runs TO authenticated;

-- ── Provenance on the live item-master tables, so a synced field can carry
--    "from orbit-mrp · synced 3h ago" in ItemMasterEditor (plan §6c step 4) ───
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;

COMMENT ON COLUMN public.materials.source_system IS
  'NULL for manually entered/uploaded rows (default path, unaffected). Set '
  'when a connector sync (project_erp_links) last wrote this row — mirrors '
  'the dataset_version provenance pattern (G15 §8.4) at the per-field level.';

-- ── Phase 2: scheduled sync ────────────────────────────────────────────────
-- One cron-eligible row per link; the actual HTTP call to the sync Edge
-- Function is made by pg_cron + pg_net when both extensions are available
-- (mirrors the workspace-file-sweep pattern in
-- 20260723000001_reports_and_file_workspace.sql). Where pg_cron/pg_net are
-- not shipped on a deployment, an external scheduler (e.g. a Supabase Cron
-- Job configured in the dashboard, or GitHub Actions on a schedule) can
-- drive the same sync-runs-for-schedule RPC below — the schedule table and
-- the RPC are the real interface either way.
ALTER TABLE public.project_erp_links
  ADD COLUMN IF NOT EXISTS sync_schedule_cron text,     -- e.g. '0 3 * * *'; NULL = manual-only
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.due_erp_sync_links()
RETURNS SETOF public.project_erp_links LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Placeholder cron-due check: a real implementation evaluates
  -- sync_schedule_cron against now() (e.g. via pg_cron's own scheduling,
  -- which is why this function exists mainly for external-scheduler callers
  -- and for the erp-sync-orbit-mrp Edge Function's own dry-run/status views).
  SELECT * FROM public.project_erp_links
  WHERE sync_enabled = true
    AND status = 'active'
    AND sync_schedule_cron IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.due_erp_sync_links() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    -- Sweeps every 15 minutes for links whose sync_schedule_cron is due;
    -- the Edge Function itself re-checks each link's own cron expression
    -- and both sides of §6b's live authorization before doing any work, so
    -- an over-frequent sweep here only costs a cheap no-op HTTP call.
    PERFORM cron.schedule(
      'erp-connector-sync-sweep',
      '*/15 * * * *',
      $cron$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_functions_url', true) || '/erp-sync-orbit-mrp',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := jsonb_build_object('action', 'run_due_schedules')
        )
        FROM public.due_erp_sync_links();
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
