-- Phase 3 / WP 3.1 / §8.1–8.4 — TIER 0 EXISTS NOW.
--
-- PLAN.md §2 lists six tiers and this repository has had five. Tier 0 is
-- "Landing — raw bytes as received, write-once, never mutated", and its absence
-- is why `UploadWizard` parses a file in the browser and throws the file away:
-- nothing in the database has ever held what the user actually uploaded. When a
-- column comes out wrong there is no artifact to go back to, which makes every
-- parse defect (D6, D7, D8, D46) unreproducible after the fact.
--
-- WP 3.2 writes this table — upload lands the bytes, opens a run, parses
-- SERVER-SIDE. This migration gives it somewhere to land, so that the package
-- that writes the parser is not also the package inventing the schema under it.
--
-- WHAT A ROW IS: one file, as received, in one run. The bytes themselves live in
-- storage; this row is the manifest — where they are, how many there were, and
-- the SHA-256 of exactly the sequence received. The hash is the anchor: it is
-- what lets "the file you uploaded on Tuesday" be a checkable claim, and it is
-- the same shape as the `input-hash` invariant (I5) one tier down.
--
-- WRITE-ONCE IS ENFORCED, not asserted. A BEFORE UPDATE trigger refuses every
-- update. §2's tier rule has been a sentence in a plan for three phases; a
-- sentence that nothing enforces drifts within two months, which is the lesson
-- of the two orphan tables. DELETE is deliberately NOT refused: a tier-0 row is
-- immutable, not immortal, and refusing DELETE would make it impossible to
-- delete a project (`ingest_runs` cascades from `projects`, and these cascade
-- from the run). `supabase/rehearsal/060` asserts both halves.

CREATE TABLE IF NOT EXISTS public.ingest_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The run is the owner. No `project_id` column here on purpose: the run has
  -- one, and two copies of the same fact are two chances to disagree (I1). It
  -- also means a file cannot belong to one project while its run belongs to
  -- another, which no CHECK could have expressed.
  ingest_run_id     uuid NOT NULL REFERENCES public.ingest_runs(id) ON DELETE CASCADE,
  source_kind       text NOT NULL CHECK (source_kind IN ('csv', 'orbit-mrp', 'api')),
  -- What the user called it, kept verbatim. Never a key: two projects upload
  -- `inbound.csv` on the same afternoon (G1's rule applied to filenames).
  original_filename text NOT NULL,
  -- Where the bytes are. UNIQUE because it addresses one stored object; the
  -- writer generates it, the user never supplies it.
  storage_bucket    text NOT NULL,
  storage_path      text NOT NULL,
  content_type      text,
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  -- Lowercase hex SHA-256 of the bytes as received, before any parse. The CHECK
  -- is on the SHAPE because a truncated or upper-cased hash compares unequal to
  -- itself and would quietly break every later lineage claim.
  content_sha256    text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Who uploaded it. `audit-actor` (G4) in the row itself: the service-role
  -- writer cannot name an actor in an audit row (D36), so the landing records
  -- the actor where it is known — at the point the browser hands the file over.
  uploaded_by       uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS ingest_files_run_idx  ON public.ingest_files (ingest_run_id);
-- "You have uploaded these bytes before" is a question WP 3.2/3.4 will ask, and
-- it is asked by hash, not by name.
CREATE INDEX IF NOT EXISTS ingest_files_hash_idx ON public.ingest_files (content_sha256);

CREATE OR REPLACE FUNCTION public.ingest_files_write_once()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION
    'ingest_files is tier 0 (PLAN.md §2): rows are write-once and never mutated. '
    'Row % was updated; land a new file and open a new run instead.', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS ingest_files_no_update ON public.ingest_files;
CREATE TRIGGER ingest_files_no_update BEFORE UPDATE ON public.ingest_files
  FOR EACH ROW EXECUTE FUNCTION public.ingest_files_write_once();

ALTER TABLE public.ingest_files ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ingest_files TO service_role;
GRANT SELECT, INSERT ON public.ingest_files TO authenticated;

-- SELECT and INSERT only for `authenticated`, and the policy is FOR ALL so the
-- UPDATE and DELETE the grant withholds are refused at both layers. The trigger
-- is the backstop for the service role, which holds every grant by definition.
DROP POLICY IF EXISTS "ingest_files: project access" ON public.ingest_files;
CREATE POLICY "ingest_files: project access" ON public.ingest_files
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingest_runs r
                  WHERE r.id = ingest_files.ingest_run_id
                    AND public.has_project_access(r.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingest_runs r
                       WHERE r.id = ingest_files.ingest_run_id
                         AND public.has_project_access(r.project_id)));

COMMENT ON TABLE public.ingest_files IS
  'Tier 0 (PLAN.md §2) — one row per file as received, the manifest for bytes '
  'held in storage. Write-once: a BEFORE UPDATE trigger refuses every update, '
  'and the row is removed only when its run or its project is. Created in '
  'Phase 3 / WP 3.1 so that WP 3.2''s server-side parse has somewhere to land '
  'the artifact it parses; nothing writes it yet.';

COMMENT ON COLUMN public.ingest_files.content_sha256 IS
  'SHA-256 of the bytes AS RECEIVED, lowercase hex, computed before any parse. '
  'The anchor for every later claim about what was uploaded.';

SELECT pg_notify('pgrst', 'reload schema');
