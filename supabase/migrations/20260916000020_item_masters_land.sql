-- Phase 3 / WP 3.3 / §10 · D55 — THE THREE ITEM MASTERS JOIN THE LANDING.
--
-- `materials`, `products` and `suppliers` are the last CSV uploads that go from a
-- browser straight into tier 2. WP 3.2 parsed them server-side but left their
-- WRITE where it was — `bulk_upsert_*`, called from `UploadWizard` — and was
-- explicit that this was a judgement rather than an omission: `bulk_upsert_*`
-- already UPSERTS on the table's composite primary key and validates its enums in
-- SQL, so routing it through a landing whose promotion was an INSERT would have
-- turned an upsert into a duplicator. That was true. It stopped being true one
-- migration ago.
--
-- SO `no-tier-skip` (I2) GOES FROM PARTIAL TO MET FOR EVERY CSV THE CONTRACT
-- DESCRIBES. Nine datasets now land in tier 0 and tier 1 and reach tier 2 only
-- through `ingest_apply_run`. What remains outside is D56's group — the node list
-- and the two deep-tier network tables — which have no sidecar because WP 4.2
-- owns the decision about what tier they are, and `deep_tier_json` is not a CSV.
--
-- WHAT THIS COSTS, AND IT IS THE WHOLE COST: an `ingest_dataset` block in three
-- sidecars, the two provenance columns below, and three names in the promotable
-- list. There is no new code path. `ingest_apply_run` derives the natural key from
-- the catalog and the server-set columns from the target's own shape, so a table
-- with a composite PRIMARY KEY and no `plant_name` promotes through exactly the
-- statement a lane does. That is what the generality was for.

-- ── 1 · provenance, as on the six ───────────────────────────────────────────
--
-- Written out per table rather than in a loop: a column added by `EXECUTE
-- format(…)` is invisible to `introspect.mjs`, so the contract could not describe
-- it and the generated page could not publish it.

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;
ALTER TABLE public.materials DROP CONSTRAINT IF EXISTS materials_source_row_fk;
ALTER TABLE public.materials
  ADD CONSTRAINT materials_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_source_row_fk;
ALTER TABLE public.products
  ADD CONSTRAINT products_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_source_row_fk;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.materials.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted.';
COMMENT ON COLUMN public.materials.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3); its source_row_number '
  'is the physical line of the uploaded file, header = line 1.';
COMMENT ON COLUMN public.products.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted.';
COMMENT ON COLUMN public.products.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3); its source_row_number '
  'is the physical line of the uploaded file, header = line 1.';
COMMENT ON COLUMN public.suppliers.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 3.3). NULL for every row that '
  'predates the CSV landing path, and for rows whose run has since been deleted.';
COMMENT ON COLUMN public.suppliers.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 3.3); its source_row_number '
  'is the physical line of the uploaded file, header = line 1.';

-- ── 2 · the promotable list gains three ─────────────────────────────────────
--
-- The list exists here because the promotion builds dynamic SQL and a table name
-- from a caller is an injection with a migration around it. It is generated on
-- the TypeScript side from the same sidecars, and `ingestSpecParity.test.ts`
-- fails when the two disagree.

CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable(_target_table text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _target_table IN (
    'bom_multi_level',
    'bom_single_level',
    'inbound_logistics',
    'materials',
    'outbound_logistics',
    'products',
    'suppliers',
    'tier2_suppliers',
    'tier3_suppliers');
$$;

-- ── 3 · they are ALREADY audited, and checking beat assuming ────────────────
--
-- This file first recreated the three tables' `audit_tier_write` triggers,
-- reasoning that a table joining the promotion path needs them. It does — and
-- `20260916000001` created them for all three in WP 2.3, so the recreation was
-- nine duplicate triggers, every tier-2 write audited TWICE. `dataPlaneAudit.test.ts`
-- caught it by counting: 57 statement triggers where the contract implies 48.
--
-- Recorded rather than quietly deleted, because the near-miss is the point. The
-- test that caught it counts triggers against the CONTRACT's tier-2/3/4 tables —
-- which is the same rule D54 says is scoped too narrowly to catch a DEFERRED
-- table's missing triggers. Here the scoping worked in the other direction, and
-- it is the only reason a doubled audit row did not ship.

SELECT pg_notify('pgrst', 'reload schema');
