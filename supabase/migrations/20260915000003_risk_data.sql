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
CREATE POLICY risk_data_read ON public.risk_data FOR SELECT TO authenticated, anon USING (true);

GRANT SELECT ON public.risk_data TO authenticated, anon, service_role;

CREATE INDEX IF NOT EXISTS idx_risk_data_vintage ON public.risk_data(vintage);
