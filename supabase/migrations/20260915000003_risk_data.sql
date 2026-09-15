-- Phase 1 / WP 1.4 / §8.3 — `risk_data`, the country-risk reference table (D4).
--
-- The second orphan. Two pages read it (`/product-level-network` and
-- `/firm-level-network`, through `MapView`'s risk shading); no migration creates
-- it. WP 0.2 made the failure visible (`RiskDataNotice`); this file decides it.
--
-- KEPT, NOT DELETED, and the reason is that the pages are right to want it. A
-- supply-chain map whose nodes carry no country risk is not a simpler map, it is
-- a map with a dimension silently missing — which is the failure mode §5 exists
-- to end. The read stays; the table becomes real.
--
-- ── AND IT IS NOT ABSENT. IT IS UNTRACKED. ──────────────────────────────────
--
-- The first version of this file was a plain CREATE TABLE IF NOT EXISTS, on the
-- reasonable-sounding assumption that a table no migration creates is a table
-- that does not exist. CI disproved it in one line:
--
--     Applying migration 20260915000003_risk_data.sql...
--     ERROR: column "source" of relation "public.risk_data" does not exist
--     At statement: 2
--
-- Statement 1 was the CREATE, and IF NOT EXISTS made it a NO-OP — because
-- `public.risk_data` is already there, in the production database, with the
-- spreadsheet-header columns the pages read (`COUNTRY`, `"RISK CLASS"`). It is
-- the same class as `approved_users`: an object that predates migration
-- tracking and was created outside it. WP 1.1's introspector cannot see that
-- class; it can only see "no migration creates this", which is true of a table
-- that does not exist AND of a table nobody wrote a migration for.
--
-- So this file has two jobs, and says which is which at every step:
--   · build the table on a database that does not have it (the CREATE below);
--   · ADOPT the one that is already there, without losing its rows.
--
-- The adoption runs through `EXECUTE`, and that is deliberate rather than
-- stylistic. A guarded `IF ... THEN ALTER TABLE ... RENAME COLUMN` would be
-- unwrapped by the introspector's DO descent and applied UNCONDITIONALLY to the
-- freshly-replayed table, where the legacy column does not exist — so the
-- artifact would be wrong about the very schema this migration defines.
-- `EXECUTE` is opaque to the replay by construction, and since WP 1.4 opacity is
-- RECORDED (`dynamic_ddl`) rather than silently dropped. The CREATE above it is
-- what the contract describes, and it is what a fresh database gets.
--
-- WHAT CHANGES FROM THE SHAPE THE CODE ASSUMED:
--
--   1. The columns are renamed. The pages read `COUNTRY` and `"RISK CLASS"` — an
--      upper-case identifier and a quoted one WITH A SPACE, i.e. the header row of
--      whatever spreadsheet was pasted into the table. Every reference to
--      `"RISK CLASS"` has to be quoted forever, and `COUNTRY` folds to `country`
--      unquoted, so the same table answers to two spellings depending on who
--      writes the query. `country` / `risk_class`.
--
--   2. It gets NO `project_id`, deliberately. Country risk is a property of the
--      world, not of one customer's model: two projects that both source from
--      Vietnam must see the same risk class, and a per-project copy guarantees
--      they eventually do not. This is PLAN.md §2's `reference` tier — the row
--      is versioned by VINTAGE, not by project.
--
--   3. It gains the four provenance columns the tier requires. `source`,
--      `vintage` and `licence` are NOT NULL because a country-risk figure with no
--      named origin is an assertion the product cannot defend, and this table's
--      whole output is a colour on a map that a reader will take for fact
--      (§5 T1: no number without a source). `licence` in particular: country-risk
--      indices are mostly commercial, and a row whose licence is unrecorded is a
--      row nobody can tell you may republish.
--
-- NATURAL KEY: `country`. One live vintage at a time — refreshing the dataset
-- UPSERTs each country and moves its `vintage` forward. History is NOT retained:
-- the pages build a country -> risk_class map, so two vintages of the same
-- country would make the rendered colour depend on row order. Keeping the
-- superseded rows is bitemporal reference data, which is PLAN.md §2's tier 2-O
-- and Phase 7+ — recorded in the sidecar as `natural_key_intended`, not smuggled
-- in here.
--
-- The CHECK on `country` is what makes that key real: without it 'Vietnam' and
-- 'VIETNAM' are two countries to the unique index and one country to the page,
-- which normalizes with `.trim().toUpperCase()` before the lookup. The constraint
-- moves that normalization to the only place both writers must pass through.

CREATE TABLE IF NOT EXISTS public.risk_data (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country      text NOT NULL,
  risk_class   text NOT NULL,
  source       text NOT NULL,
  vintage      text NOT NULL,
  licence      text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_data_country_key UNIQUE (country),
  -- The page looks up `location_text.split(',').pop().trim().toUpperCase()`, so
  -- the stored spelling must already be that form or the lookup misses.
  CONSTRAINT risk_data_country_normalized CHECK (country = upper(btrim(country))),
  -- The five classes `MapView.tsx`'s RISK_COLORS renders. 'Unknown' is NOT one of
  -- them: it is what the page shows when no row matches, and storing it would
  -- turn "we have no figure for this country" into a figure (§5 T1, D17's class
  -- of defect).
  CONSTRAINT risk_data_risk_class_known
    CHECK (risk_class IN ('Very Low', 'Low', 'Medium', 'High', 'Very High'))
);

-- ── adopting the untracked table ────────────────────────────────────────────
--
-- A no-op on a database that just ran the CREATE above. On the one that already
-- had `risk_data`, this brings it to the same shape without dropping a row.
--
-- THREE THINGS IT WILL NOT DO:
--
--  1. It will not invent provenance. The existing rows have no recorded source,
--     vintage or licence, and there is no way to recover them — so they get the
--     literal string 'unrecorded (loaded before the reference-tier contract)'.
--     That is not a placeholder pretending to be data; it is the answer, and it
--     renders on the generated page as the answer. An operator replacing the
--     dataset overwrites it with a real publisher (§5 T1).
--  2. It will not validate the old rows against the new CHECKs. They land
--     NOT VALID: enforced for every future insert and update, not retroactively
--     asserted about rows nobody has looked at. `ALTER TABLE public.risk_data
--     VALIDATE CONSTRAINT ...` is the one-line follow-up once the data is
--     checked — and it belongs to whoever checks it, not to this file.
--  3. It will not fail the migration over duplicate countries. If the legacy
--     table has two rows for one country the unique index cannot be created;
--     that is a data question, and the migration raises a WARNING and carries
--     on rather than blocking every later migration behind it.
DO $adopt$
DECLARE
  has_legacy_country boolean;
  has_legacy_class   boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'risk_data'
                    AND column_name = 'COUNTRY'),
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'risk_data'
                    AND column_name = 'RISK CLASS')
    INTO has_legacy_country, has_legacy_class;

  IF has_legacy_country THEN
    EXECUTE 'ALTER TABLE public.risk_data RENAME COLUMN "COUNTRY" TO country';
    RAISE NOTICE 'risk_data: renamed "COUNTRY" -> country';
  END IF;
  IF has_legacy_class THEN
    EXECUTE 'ALTER TABLE public.risk_data RENAME COLUMN "RISK CLASS" TO risk_class';
    RAISE NOTICE 'risk_data: renamed "RISK CLASS" -> risk_class';
  END IF;

  EXECUTE 'ALTER TABLE public.risk_data
             ADD COLUMN IF NOT EXISTS id           uuid DEFAULT gen_random_uuid(),
             ADD COLUMN IF NOT EXISTS source       text,
             ADD COLUMN IF NOT EXISTS vintage      text,
             ADD COLUMN IF NOT EXISTS licence      text,
             ADD COLUMN IF NOT EXISTS refreshed_at timestamptz NOT NULL DEFAULT now(),
             ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now(),
             ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now()';

  EXECUTE $sql$
    UPDATE public.risk_data
       SET source  = COALESCE(source,  'unrecorded (loaded before the reference-tier contract)'),
           vintage = COALESCE(vintage, 'unrecorded'),
           licence = COALESCE(licence, 'unrecorded — do not republish until this is established'),
           id      = COALESCE(id, gen_random_uuid())
     WHERE source IS NULL OR vintage IS NULL OR licence IS NULL OR id IS NULL
  $sql$;

  EXECUTE 'ALTER TABLE public.risk_data
             ALTER COLUMN id      SET NOT NULL,
             ALTER COLUMN source  SET NOT NULL,
             ALTER COLUMN vintage SET NOT NULL,
             ALTER COLUMN licence SET NOT NULL';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.risk_data'::regclass AND contype = 'p') THEN
    EXECUTE 'ALTER TABLE public.risk_data ADD CONSTRAINT risk_data_pkey PRIMARY KEY (id)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.risk_data'::regclass
                    AND conname = 'risk_data_country_normalized') THEN
    EXECUTE 'ALTER TABLE public.risk_data
               ADD CONSTRAINT risk_data_country_normalized
               CHECK (country = upper(btrim(country))) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.risk_data'::regclass
                    AND conname = 'risk_data_risk_class_known') THEN
    EXECUTE $sql$ALTER TABLE public.risk_data
               ADD CONSTRAINT risk_data_risk_class_known
               CHECK (risk_class IN ('Very Low', 'Low', 'Medium', 'High', 'Very High')) NOT VALID$sql$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.risk_data'::regclass
                    AND conname = 'risk_data_country_key') THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.risk_data ADD CONSTRAINT risk_data_country_key UNIQUE (country)';
    EXCEPTION WHEN unique_violation OR not_null_violation THEN
      RAISE WARNING 'risk_data: cannot add UNIQUE (country) — the existing rows are not unique by country. '
                    'Deduplicate, then: ALTER TABLE public.risk_data ADD CONSTRAINT risk_data_country_key UNIQUE (country);';
    END;
  END IF;
END
$adopt$;

COMMENT ON TABLE public.risk_data IS
  'Country-risk reference data (PLAN.md §2 reference tier, D4). Project-independent '
  'and versioned by vintage. One live vintage per country; refreshing upserts.';
COMMENT ON COLUMN public.risk_data.source IS 'Who published the figure — the named index or provider.';
COMMENT ON COLUMN public.risk_data.vintage IS 'The edition the figure is from, as the publisher labels it (e.g. "2025-H1").';
COMMENT ON COLUMN public.risk_data.licence IS 'The licence the row is held under. Unrecorded means unpublishable.';
COMMENT ON COLUMN public.risk_data.refreshed_at IS 'When this row was last written from the source.';

ALTER TABLE public.risk_data ENABLE ROW LEVEL SECURITY;

-- Readable by everyone who can see the app; there is no per-project scoping to
-- apply, because there is no project. Writes have no user-facing path at all:
-- the table is loaded by an operator through the service role, which bypasses
-- RLS, so the absence of an INSERT/UPDATE/DELETE policy IS the write rule.
--
-- On the adopted table this is a change: it had no policies, so enabling RLS
-- without the SELECT policy below would cut off the reads that work today. The
-- two land together and are read-equivalent for `authenticated` and `anon`.
DROP POLICY IF EXISTS risk_data_read ON public.risk_data;
CREATE POLICY risk_data_read ON public.risk_data FOR SELECT TO authenticated, anon USING (true);

GRANT SELECT ON public.risk_data TO authenticated, anon, service_role;

CREATE INDEX IF NOT EXISTS idx_risk_data_vintage ON public.risk_data(vintage);
