-- Phase 3 / WP 3.1 / §8.1–8.4 — ONE INGESTION CONTRACT, STARTING WITH ITS NAMES.
--
-- `erp_staged_*` / `erp_sync_runs` are the right tables with the wrong names.
-- `20260829120000_erp_connector_phase1_2.sql` built them for one source and said
-- so in its own COMMENT ON TABLE blocks — "'orbit-mrp' today; generalized in
-- Phase 3". This is Phase 3. Invariant `ingestion-contract` (I7) says a NEW
-- source implements the ingestion contract and never touches tier-2 schemas;
-- a table whose name asserts a single vendor cannot hold a second source's rows
-- without lying about what it is.
--
-- THIS IS A RENAME AND A WIDENING, NOT A REDESIGN. Every column that existed
-- still exists, with its type, its default and its CHECK. Three things are
-- added, and each closes a hole the CSV path would otherwise fall through:
--
--   · `source_kind ∈ (csv, orbit-mrp, api)` on runs and on staging — WHERE the
--     rows came from. No DEFAULT after the backfill, deliberately: a writer must
--     state its source, because a column that guesses is exactly the "number
--     with no source" §5 T1 forbids.
--   · `fact_class ∈ (master, transactional)` on staging — WHAT KIND of fact a
--     staged row is. WP 3.2 lands CSV rows with it; the connector's three tables
--     are all master data and are backfilled as such.
--   · `ingest_runs.project_id`, and a NULLABLE `link_id` — a CSV upload has a
--     project and no ERP link. The old schema made `link_id` NOT NULL and routed
--     every RLS decision through it, so a run without a link was not merely
--     unsupported: it was unreachable and ungoverned.
--
-- WHY THE COLUMN RENAMES ARE HERE AND NOT LATER. `sync_run_id` names a table
-- that no longer exists under that name, and `synced_at` says "synced" about a
-- file upload. WP 3.3 adds `ingest_run_id` to the tier-2 lanes; landing the same
-- word here means the vocabulary is one word rather than two, and it costs this
-- migration three ALTERs. Each index that names a renamed column is dropped
-- BEFORE the rename and recreated after — the introspector does not follow a
-- column rename into the indexes that reference it (D49), and the order avoids
-- the question entirely rather than relying on it being fixed.
--
-- CORRECT ON A FRESH DATABASE AND ON PRODUCTION'S (the D43/D4 shape). The
-- renames use `ALTER TABLE IF EXISTS`, so a re-run skips them instead of
-- aborting the file; every ADD COLUMN is `IF NOT EXISTS`; every DROP POLICY is
-- `IF EXISTS`, which matters more than it looks — the three staging policies are
-- created inside a `DO $$ EXECUTE format(…) $$` loop in the connector migration,
-- so the CONTRACT does not know they exist and a fresh rehearsal database does
-- not have them, while production does. `supabase/rehearsal/fixtures/030` puts
-- them back and `contract:rehearse -- --fixtures` runs this file against both
-- shapes. The statements after the renames are NOT `IF EXISTS`: if the connector
-- tables are absent altogether, something is wrong that a silent skip would hide.

-- ── 1 · the runs table ──────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.erp_sync_runs RENAME TO ingest_runs;

-- `project_id` is what the RLS will key on once a run can exist without a link.
ALTER TABLE public.ingest_runs
  ADD COLUMN IF NOT EXISTS project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'orbit-mrp';

-- The backfill is TOTAL BY CONSTRUCTION, which is why it carries no guard where
-- `customers` needed one (WP 3.0): `link_id` was NOT NULL with a foreign key, so
-- every existing row has a link and every link has a project. `customers` could
-- not make that argument — its duplicate keys were a data question — and got a
-- RAISE WARNING instead of a blocked deploy. Here a NULL after this UPDATE would
-- mean the foreign key had not been holding, and the SET NOT NULL below SHOULD
-- fail loudly in that case rather than leave the column half-populated.
UPDATE public.ingest_runs r
   SET project_id = l.project_id
  FROM public.project_erp_links l
 WHERE l.id = r.link_id AND r.project_id IS NULL;

ALTER TABLE public.ingest_runs ALTER COLUMN project_id SET NOT NULL;

-- A CSV or API run has no ERP link. Nullable, and the sidecar says what a NULL
-- means so nobody later reads it as "link lost".
ALTER TABLE public.ingest_runs ALTER COLUMN link_id DROP NOT NULL;

-- The DEFAULT existed only to backfill the rows already there. It goes now, so
-- the next writer has to say where its rows came from.
ALTER TABLE public.ingest_runs ALTER COLUMN source_kind DROP DEFAULT;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_source_kind_check CHECK (source_kind IN ('csv', 'orbit-mrp', 'api'));

DROP INDEX IF EXISTS public.erp_sync_runs_link_idx;
CREATE INDEX IF NOT EXISTS ingest_runs_link_idx ON public.ingest_runs (link_id, created_at DESC);
-- New, and the reason is the widening: the run list is now a PROJECT's list, not
-- a link's, and a CSV run has no link to look it up by.
CREATE INDEX IF NOT EXISTS ingest_runs_project_idx ON public.ingest_runs (project_id, created_at DESC);

-- ── 2 · the three staging tables ────────────────────────────────────────────

ALTER TABLE IF EXISTS public.erp_staged_products     RENAME TO ingest_staged_products;
ALTER TABLE IF EXISTS public.erp_staged_bom_versions RENAME TO ingest_staged_bom_versions;
ALTER TABLE IF EXISTS public.erp_staged_bom_lines    RENAME TO ingest_staged_bom_lines;

DROP INDEX IF EXISTS public.erp_staged_products_sync_run_idx;
DROP INDEX IF EXISTS public.erp_staged_bom_versions_sync_run_idx;
DROP INDEX IF EXISTS public.erp_staged_bom_lines_sync_run_idx;

ALTER TABLE public.ingest_staged_products     RENAME COLUMN sync_run_id TO ingest_run_id;
ALTER TABLE public.ingest_staged_bom_versions RENAME COLUMN sync_run_id TO ingest_run_id;
ALTER TABLE public.ingest_staged_bom_lines    RENAME COLUMN sync_run_id TO ingest_run_id;

ALTER TABLE public.ingest_staged_products     RENAME COLUMN synced_at TO staged_at;
ALTER TABLE public.ingest_staged_bom_versions RENAME COLUMN synced_at TO staged_at;
ALTER TABLE public.ingest_staged_bom_lines    RENAME COLUMN synced_at TO staged_at;

CREATE INDEX IF NOT EXISTS ingest_staged_products_run_idx     ON public.ingest_staged_products (ingest_run_id);
CREATE INDEX IF NOT EXISTS ingest_staged_bom_versions_run_idx ON public.ingest_staged_bom_versions (ingest_run_id);
CREATE INDEX IF NOT EXISTS ingest_staged_bom_lines_run_idx    ON public.ingest_staged_bom_lines (ingest_run_id);

ALTER TABLE public.ingest_staged_products
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'orbit-mrp',
  ADD COLUMN IF NOT EXISTS fact_class  text NOT NULL DEFAULT 'master';
ALTER TABLE public.ingest_staged_bom_versions
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'orbit-mrp',
  ADD COLUMN IF NOT EXISTS fact_class  text NOT NULL DEFAULT 'master';
ALTER TABLE public.ingest_staged_bom_lines
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'orbit-mrp',
  ADD COLUMN IF NOT EXISTS fact_class  text NOT NULL DEFAULT 'master';

-- The connector's three tables ARE master data — products, BOM versions, BOM
-- lines — so the backfill value is a fact about them, not a placeholder. It is
-- still dropped as a DEFAULT: the next source states its own class.
ALTER TABLE public.ingest_staged_products     ALTER COLUMN source_kind DROP DEFAULT;
ALTER TABLE public.ingest_staged_products     ALTER COLUMN fact_class  DROP DEFAULT;
ALTER TABLE public.ingest_staged_bom_versions ALTER COLUMN source_kind DROP DEFAULT;
ALTER TABLE public.ingest_staged_bom_versions ALTER COLUMN fact_class  DROP DEFAULT;
ALTER TABLE public.ingest_staged_bom_lines    ALTER COLUMN source_kind DROP DEFAULT;
ALTER TABLE public.ingest_staged_bom_lines    ALTER COLUMN fact_class  DROP DEFAULT;

ALTER TABLE public.ingest_staged_products
  ADD CONSTRAINT ingest_staged_products_source_kind_check CHECK (source_kind IN ('csv', 'orbit-mrp', 'api')),
  ADD CONSTRAINT ingest_staged_products_fact_class_check  CHECK (fact_class IN ('master', 'transactional'));
ALTER TABLE public.ingest_staged_bom_versions
  ADD CONSTRAINT ingest_staged_bom_versions_source_kind_check CHECK (source_kind IN ('csv', 'orbit-mrp', 'api')),
  ADD CONSTRAINT ingest_staged_bom_versions_fact_class_check  CHECK (fact_class IN ('master', 'transactional'));
ALTER TABLE public.ingest_staged_bom_lines
  ADD CONSTRAINT ingest_staged_bom_lines_source_kind_check CHECK (source_kind IN ('csv', 'orbit-mrp', 'api')),
  ADD CONSTRAINT ingest_staged_bom_lines_fact_class_check  CHECK (fact_class IN ('master', 'transactional'));

ALTER TABLE public.ingest_staged_products     ALTER COLUMN link_id DROP NOT NULL;
ALTER TABLE public.ingest_staged_bom_versions ALTER COLUMN link_id DROP NOT NULL;
ALTER TABLE public.ingest_staged_bom_lines    ALTER COLUMN link_id DROP NOT NULL;

-- ── 3 · the policies, rewritten to key on the run's project ─────────────────
--
-- The old policies route through `project_erp_links`, which is how the schema
-- said "staging belongs to a connector". Staging now belongs to a RUN and a run
-- belongs to a PROJECT, so that is what the predicate reads. The result for a
-- connector run is identical — `supabase/rehearsal/050` asserts exactly that,
-- before this migration as well as after — and a CSV run, which has no link, is
-- governed for the first time instead of being invisible.
--
-- WRITTEN AS PLAIN STATEMENTS, not in a DO loop. The loop in the connector
-- migration is why `contract:introspect` records these three tables as having
-- RLS enabled and ZERO policies, and why the generated page for each says so.
-- Four literal statements cost eight lines and make the contract true.

DROP POLICY IF EXISTS "erp_sync_runs: project access"          ON public.ingest_runs;
DROP POLICY IF EXISTS "erp_staged_products: project access"     ON public.ingest_staged_products;
DROP POLICY IF EXISTS "erp_staged_bom_versions: project access" ON public.ingest_staged_bom_versions;
DROP POLICY IF EXISTS "erp_staged_bom_lines: project access"    ON public.ingest_staged_bom_lines;

CREATE POLICY "ingest_runs: project access" ON public.ingest_runs
  FOR ALL TO authenticated
  USING (public.has_project_access(project_id))
  WITH CHECK (public.has_project_access(project_id));

CREATE POLICY "ingest_staged_products: project access" ON public.ingest_staged_products
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingest_runs r
                  WHERE r.id = ingest_staged_products.ingest_run_id
                    AND public.has_project_access(r.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingest_runs r
                       WHERE r.id = ingest_staged_products.ingest_run_id
                         AND public.has_project_access(r.project_id)));

CREATE POLICY "ingest_staged_bom_versions: project access" ON public.ingest_staged_bom_versions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingest_runs r
                  WHERE r.id = ingest_staged_bom_versions.ingest_run_id
                    AND public.has_project_access(r.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingest_runs r
                       WHERE r.id = ingest_staged_bom_versions.ingest_run_id
                         AND public.has_project_access(r.project_id)));

CREATE POLICY "ingest_staged_bom_lines: project access" ON public.ingest_staged_bom_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingest_runs r
                  WHERE r.id = ingest_staged_bom_lines.ingest_run_id
                    AND public.has_project_access(r.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingest_runs r
                       WHERE r.id = ingest_staged_bom_lines.ingest_run_id
                         AND public.has_project_access(r.project_id)));

-- The grants the connector migration issued inside the same DO loop, restated
-- where a reader and the contract can both see them. On production these are
-- no-ops; on a fresh database they are the difference between a policy that
-- governs and a table nobody can reach.
GRANT ALL ON public.ingest_runs                 TO service_role;
GRANT ALL ON public.ingest_staged_products      TO service_role;
GRANT ALL ON public.ingest_staged_bom_versions  TO service_role;
GRANT ALL ON public.ingest_staged_bom_lines     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingest_runs                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingest_staged_products     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingest_staged_bom_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingest_staged_bom_lines    TO authenticated;

-- ── 4 · what these tables are, now that they are not one vendor's ───────────

COMMENT ON TABLE public.ingest_runs IS
  'Tier 1. One row per ingestion attempt from any source — a connector sync, a '
  'CSV upload (WP 3.2) or an API push — carrying the audit trail and the '
  'mapping report. `source_kind` says which; `link_id` is the ERP link for a '
  'connector run and NULL for every other kind. fields_mapped/defaulted/failed '
  'drive the same green/amber/red badge logic as MappingWarningsCard '
  '(src/components/sim/RunProgressPanel.tsx). Renamed from `erp_sync_runs` in '
  'Phase 3 / WP 3.1 (PLAN.md §10, D20 era): the connector migration named it '
  'for the only source that existed and said it would be generalized here.';

COMMENT ON TABLE public.ingest_staged_products IS
  'Tier 1 staging for item-master rows, in the source''s own shape plus '
  'provenance. NOTHING here is visible to the engine or the pages: a staged row '
  'reaches tier 2 only through an approved promotion (`no-tier-skip`, I2, and '
  'the connector migration''s own rule that nothing lands in materials/products/'
  'bom_* directly). `fact_class` distinguishes master rows from transactional '
  'ones; `source_kind` says where they came from. Renamed from '
  '`erp_staged_products` in Phase 3 / WP 3.1.';

COMMENT ON TABLE public.ingest_staged_bom_versions IS
  'Tier 1 staging for BOM headers, one per source BOM version. Renamed from '
  '`erp_staged_bom_versions` in Phase 3 / WP 3.1. See ingest_staged_products '
  'for the tier rule; the same one applies.';

COMMENT ON TABLE public.ingest_staged_bom_lines IS
  'Tier 1 staging for BOM component lines, one per parent/component pair in the '
  'source. Renamed from `erp_staged_bom_lines` in Phase 3 / WP 3.1. See '
  'ingest_staged_products for the tier rule; the same one applies.';

COMMENT ON COLUMN public.ingest_runs.source_kind IS
  'csv | orbit-mrp | api. No DEFAULT: a writer states its source, because a '
  'column that guesses one is a value with no provenance (PLAN.md §5 T1).';

COMMENT ON COLUMN public.ingest_runs.link_id IS
  'The ERP link this run used, or NULL for a source that has none (CSV, API). '
  'NULL means "this source needs no link", never "the link was lost".';

SELECT pg_notify('pgrst', 'reload schema');
