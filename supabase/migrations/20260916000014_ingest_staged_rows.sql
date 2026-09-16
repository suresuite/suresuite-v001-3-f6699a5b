-- Phase 3 / WP 3.2 / §8.1–8.4 — TIER 1 FOR A ROW-SHAPED SOURCE.
--
-- WP 3.1 generalized the connector's three staging tables and landed tier 0.
-- What it could not land is the shape a CSV has. `ingest_staged_products`,
-- `_bom_versions` and `_bom_lines` are TYPED against one source's entities —
-- `external_id`, `sku`, `cycle_time_seconds` — because the connector knows what
-- an orbit-mrp product is. A CSV of `inbound_logistics` is none of those things,
-- and widening those three to hold it would have made each of them a table about
-- two unrelated grains.
--
-- So this is the fourth staging table and the last one of its kind: ONE ROW OF A
-- FILE, for any file, for any target. It is deliberately generic where the other
-- three are specific, and the generality is the point — `ingestion-contract` (I7)
-- says a new source implements the contract and never touches a TIER 2 schema.
-- A CSV of a lane now has somewhere to land that is not `inbound_logistics`.
--
-- WHY THE ROW KEEPS BOTH `raw` AND `parsed`, which looks like duplication and is
-- not. `raw` is the cells exactly as the file gave them, untrimmed and untyped;
-- `parsed` is what validation made of them. D8 is the difference between
-- `" MAT-1 "` and `"MAT-1"`, and a table that keeps only the second cannot show
-- anybody why two ids merged. D46 is the difference between the token `21` and
-- the NULL it must NOT silently become. Every parse defect in §4 is
-- unreproducible today precisely because nothing kept the left-hand side.
--
-- WHY FINDINGS ARE PER ROW AND NOT PER FILE. D7 measured the cost of the other
-- answer: 376 null `volume`s in production, landed by a validator that checked
-- the file and not the cell. A finding names the row and the field, so the run's
-- report can say "row 42, volume, blank" instead of "some rows were bad", and so
-- that one bad row does not reject 1 786 good ones.
--
-- NO DEFAULT ON `source_kind` OR `fact_class`, for WP 3.1's reason exactly: a
-- column that guesses its own provenance is the §5 T1 failure inside the table
-- that exists to record provenance.

CREATE TABLE IF NOT EXISTS public.ingest_staged_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The run is the owner and the only route to a project, exactly as for the
  -- other three staging tables and for `ingest_files`. One fact, one place (I1).
  ingest_run_id     uuid NOT NULL REFERENCES public.ingest_runs(id) ON DELETE CASCADE,
  source_kind       text NOT NULL CHECK (source_kind IN ('csv', 'orbit-mrp', 'api')),
  fact_class        text NOT NULL CHECK (fact_class IN ('master', 'transactional')),
  -- The TIER 2 table these rows are destined for, by name. Not a foreign key —
  -- there is no table of tables — so the landing function checks it against the
  -- set it knows how to promote and refuses anything else.
  target_table      text NOT NULL,
  -- The physical line in the file, 1-based, counting the header as line 1. This
  -- is what makes "click from a cell through to the source row" (WP 3.4) a
  -- lookup rather than a reconstruction, and it is what `source_row_id` on tier 2
  -- will point at (WP 3.3).
  source_row_number integer NOT NULL CHECK (source_row_number > 1),
  -- The cells AS RECEIVED, keyed by the header the file carried. Untrimmed,
  -- untyped, verbatim.
  raw               jsonb NOT NULL,
  -- What validation made of them, keyed by TIER 2 COLUMN NAME. A field that
  -- failed validation is ABSENT here rather than present as null: absent says
  -- "no value was established", null says "the file said empty", and D7 is what
  -- happens when those two are spelled the same way.
  parsed            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{level, field, code, message}] — the same four-key shape as
  -- `ingest_runs.mapping_warnings` and scsim's MappingWarning, so WP 3.4 renders
  -- it with MappingWarningsCard unmodified. A row carrying any `error` finding
  -- is never promoted; `warn` and `info` are promoted and shown.
  findings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff_state        text NOT NULL DEFAULT 'new'
                      CHECK (diff_state IN ('new', 'changed', 'unchanged', 'removed_upstream')),
  staged_at         timestamptz NOT NULL DEFAULT now(),
  -- Idempotence at the grain the file actually has: one run, one target, one
  -- line. Re-landing the same run is a no-op rather than a duplicate, which is
  -- `natural-key` (I4) applied one tier above the place WP 3.3 lands it.
  UNIQUE (ingest_run_id, target_table, source_row_number)
);

CREATE INDEX IF NOT EXISTS ingest_staged_rows_run_idx
  ON public.ingest_staged_rows (ingest_run_id, target_table, source_row_number);
-- The review screen's first question is "what went wrong", and it is asked of a
-- minority of rows. Partial, so the index is the size of the problem and not of
-- the file.
CREATE INDEX IF NOT EXISTS ingest_staged_rows_rejected_idx
  ON public.ingest_staged_rows (ingest_run_id)
  WHERE findings @> '[{"level": "error"}]'::jsonb;

ALTER TABLE public.ingest_staged_rows ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ingest_staged_rows TO service_role;
GRANT SELECT ON public.ingest_staged_rows TO authenticated;

-- RLS through the RUN's project, never through `project_erp_links`: a CSV run
-- has no link, and WP 3.1's whole reason for adding `ingest_runs.project_id` was
-- that a link-less run was otherwise ungoverned rather than merely unsupported.
-- `supabase/rehearsal/060` asserts that shape; `070` asserts it for this table.
DROP POLICY IF EXISTS "ingest_staged_rows: project access" ON public.ingest_staged_rows;
CREATE POLICY "ingest_staged_rows: project access" ON public.ingest_staged_rows
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingest_runs r
                  WHERE r.id = ingest_staged_rows.ingest_run_id
                    AND public.has_project_access(r.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingest_runs r
                       WHERE r.id = ingest_staged_rows.ingest_run_id
                         AND public.has_project_access(r.project_id)));

COMMENT ON TABLE public.ingest_staged_rows IS
  'Tier 1 (PLAN.md §2) — one row of one uploaded file, for any row-shaped '
  'source. Generic where the three ingest_staged_* connector tables are typed: '
  'a CSV of a lane lands here and never in the tier-2 table itself '
  '(invariant no-tier-skip). Keeps the cells as received (`raw`) beside what '
  'validation made of them (`parsed`), because every parse defect in PLAN.md §4 '
  'is unreproducible today for want of the left-hand side.';

COMMENT ON COLUMN public.ingest_staged_rows.source_row_number IS
  'The physical line in the file, 1-based, header = line 1. The anchor WP 3.4 '
  'clicks through and WP 3.3''s `source_row_id` points at.';

-- The private bucket the bytes land in. Same guarded shape as the `workspace`
-- bucket (20260723000001) so the migration also applies on a cluster with no
-- storage schema, which every rehearsal database is. No `storage.objects`
-- policies: uploads run under the service role and nothing reads an object
-- directly — a tier-0 artifact is reached through its manifest row or not at all.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $ins$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('ingest', 'ingest', false)
      ON CONFLICT (id) DO UPDATE SET public = false
    $ins$;
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
