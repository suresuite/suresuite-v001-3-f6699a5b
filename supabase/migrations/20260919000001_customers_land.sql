-- Phase 6 / WP 6.2 / §4 D108 + D94: `customers` becomes a landable dataset.
--
-- ── WHY THIS MIGRATION EXISTS, AND WHAT FORCED IT ───────────────────────────
--
-- WP 6.1 built a GATE rather than a ratchet: "no engine-read field is
-- unreachable by both the grid and every upload", and it was EMPTY, so it was a
-- gate. §4 D94's declaration made it fire on the first commit that changed the
-- declared set — `customers.priority_weight` and `customers.segment` reach
-- `P-C.2 customer_allocation` on every run, and NOTHING in this product could
-- set them: no grid column, no CSV template, no RPC, no edge function. The two
-- values deciding who is served when supply is short could only arrive by hand in
-- the database.
--
-- The gate was right, and the fix is the surface rather than the gate. That is
-- what this migration is for: `customers` joins the nine datasets that land in
-- tier 0 + tier 1 and reach tier 2 only through `ingest_apply_run`, making TEN.
--
-- ── WHY THE LIST IS HERE AND NOT ONLY IN THE SIDECARS ───────────────────────
--
-- `20260916000020`'s own comment says it: the promotion builds dynamic SQL, and a
-- table name arriving from a caller is an injection with a migration around it.
-- The TypeScript half is GENERATED from the same sidecars and
-- `ingestSpecParity.test.ts` fails when the two disagree — so this widening and
-- `customers.contract.yaml`'s `ingest_dataset` block are one change in two
-- places that cannot drift apart, which is the only reason two places is
-- acceptable.
--
-- ── WHAT IT DOES NEED, AND THE REHEARSAL IS WHY IT WAS FOUND ────────────────
--
-- `customers` carries NEITHER provenance column. Every one of the nine landable
-- tables has `ingest_run_id` and `source_row_id`, added per table by
-- `20260916000019`, and this one was adopted in WP 3.0 as a table nothing read —
-- so it never got them. Comparing the two schemas is what found it; the sidecar
-- would have generated a page describing a landable table with no trace back to
-- the file, and A4's "a person is shown the LINE" would have had nothing to show.
--
-- ── WHAT THIS MIGRATION DOES *NOT* NEED, CHECKED RATHER THAN ASSUMED ────────
--
-- 1. NO audit triggers. `20260916000003_adopt_customers_drop_product_code_map`
--    created all three when the table was adopted, and `dataPlaneAudit.test.ts`
--    derives its rule from the contract's tier, so a tier-2 table without them is
--    already a failure. Recreating them is how `20260916000020` nearly shipped
--    nine duplicate triggers and audited every write twice.
-- 2. NO unique index. `customers_project_customer_key` on
--    `(project_id, customer_id)` already exists and is the arbiter
--    `ingest_apply_run` reads out of `pg_index`. Neither column is nullable, so
--    `NULLS NOT DISTINCT` would change nothing here (§4 D5 is about the three
--    keys that DO contain a nullable column).
-- 3. NO `plant_name`. `server_set` is `project_id` ALONE: a customer is a
--    property of the project, exactly as an item master is. `ingest_apply_run`
--    derives the server-set columns per target, which is what lets one promotion
--    serve ten datasets rather than nine plus a special case.
--
-- Invariants: `no-tier-skip` (I2) — the tenth dataset lands, it does not skip;
-- `natural-key` (I4) — the arbiter already exists and is read, not guessed;
-- `audit-actor` (G4) — the landing and the promotion each name their actor
-- through the parameters `ingest_land_file` and `ingest_apply_run` already take.
-- Proved behaviourally by `supabase/rehearsal/230_customers_land.sql`.

-- ── 1 · the two provenance columns, on the pattern of the other nine ────────

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS ingest_run_id uuid REFERENCES public.ingest_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_source_row_fk;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_source_row_fk FOREIGN KEY (source_row_id)
  REFERENCES public.ingest_staged_rows(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.customers.ingest_run_id IS
  'The ingestion run that last wrote this row (WP 6.2, on WP 3.3''s pattern). '
  'NULL for every row that predates the CSV landing path — and on this table that '
  'is EVERY row written before this migration, because nothing wrote it but a '
  'hand at the database. A null here means the provenance is unknown, never that '
  'there was none.';
COMMENT ON COLUMN public.customers.source_row_id IS
  'The tier-1 staged row this was promoted from (WP 6.2). Its source_row_number '
  'is the physical line of the uploaded file, header = line 1, so a person can be '
  'shown the line rather than told a file name.';

-- ── 2 · the tenth promotable target ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ingest_target_is_promotable(_target_table text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _target_table IN (
    'bom_multi_level',
    'bom_single_level',
    'customers',
    'inbound_logistics',
    'materials',
    'outbound_logistics',
    'products',
    'suppliers',
    'tier2_suppliers',
    'tier3_suppliers');
$$;

COMMENT ON FUNCTION public.ingest_target_is_promotable(text) IS
  'Phase 6 / WP 6.2 (§4 D108) — the TEN tables a staged row may be promoted '
  'into. The list is in SQL because the promotion builds dynamic SQL and a '
  'target name from a caller is an injection; the TypeScript half is generated '
  'from the same sidecars and ingestSpecParity.test.ts holds the two together. '
  '`customers` joined here because P-C.2 reads two of its columns on every run '
  'and no surface in the product could set either (§4 D94).';

-- ── 3 · D120 · A BLANK OPTIONAL CELL MUST NOT ABORT THE WHOLE PROMOTION ─────
--
-- FOUND BY `supabase/rehearsal/230`, ON ITS FIRST RUN, AND IT IS NOT THIS
-- PACKAGE'S DEFECT — IT IS LIVE ON `suppliers` AND HAS BEEN SINCE WP 3.3.
--
-- `ingest_promotion_plan` builds ONE column list for the whole run: the union of
-- every parsed key across every staged row. That is correct — one statement per
-- target is what makes the tier-2 audit trigger write one row saying "n rows"
-- (WP 2.3) — but it means a column ONE row supplies is written for EVERY row, and
-- a row that left it blank contributes `(s.parsed ->> 'col')::type` = NULL.
--
-- For a NULLABLE column that is exactly right: an absence lands as an absence.
-- For a column that is NOT NULL WITH A DEFAULT it aborts the entire statement, so
-- the user loses a whole upload to a constraint message naming a column they
-- deliberately left empty. Three columns are in that shape today:
--
--     suppliers.reliability_score   NOT NULL DEFAULT 1.0     ← LIVE since WP 3.3
--     customers.segment             NOT NULL DEFAULT 'default'
--     customers.priority_weight     NOT NULL DEFAULT 1.0
--
-- The shipped `suppliers.csv` template fills `reliability_score` on all three of
-- its rows, which is why nobody has hit it: the template never exercises the
-- case the contract explicitly permits (`required: false`).
--
-- THE FIX READS THE DEFAULT FROM THE DATABASE, it does not restate it. That is
-- this function's existing idiom in three other places — the arbiter comes from
-- `pg_index`, the cast from `format_type`, the server-set columns from
-- `pg_attribute` — and it is the only version of the fix that cannot drift from
-- the column it is about. A `COALESCE(<value>, 1.0)` typed here would be a second
-- authority for the default, which is `single-source` (I1) and §4 D101 exactly.
--
-- IT GOES IN THE PLAN AND NOT IN `ingest_apply_run`. `ingest_diff_run` reads the
-- same plan, and `diff-before-decision` says the review screen's diff is computed
-- with the columns and values the promotion WOULD write. A fix in the promotion
-- alone would make the diff disagree with the upsert for exactly these cells —
-- the disagreement `rehearsal/100` §6 exists to catch.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not make a re-upload with a blank
-- cell PRESERVE the existing value: `ON CONFLICT DO UPDATE SET col =
-- EXCLUDED.col` now assigns the default, so a blank cell RESETS the column. That
-- is the right reading of an upsert from a file — the file is the statement of
-- record for the rows it names, and a blank cell means "no declared value", whose
-- declared substitution is the default (§5 T2). Silently keeping an older value a
-- newer file does not mention would make the row a merge of two files with
-- nothing saying so.

CREATE OR REPLACE FUNCTION public.ingest_promotion_plan(
  _run_id uuid,
  _target text,
  OUT natural_key text[],
  OUT file_key    text,
  OUT server_cols text,
  OUT server_vals text,
  OUT write_cols  text,
  OUT write_vals  text,
  OUT write_names text[],
  OUT write_exprs text[])
LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_seen  integer;
  v_known integer;
BEGIN
  natural_key := public.ingest_target_natural_key(_target);

  SELECT string_agg(quote_ident(c), ', ' ORDER BY c),
         string_agg(CASE c WHEN 'project_id' THEN '$1' ELSE '$2' END, ', ' ORDER BY c)
    INTO server_cols, server_vals
    FROM unnest(ARRAY['project_id','plant_name']) AS c
   WHERE EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = format('public.%I', _target)::regclass
                    AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);

  WITH parsed_keys AS (
    SELECT DISTINCT k AS key
      FROM public.ingest_staged_rows s, jsonb_object_keys(s.parsed) k
     WHERE s.ingest_run_id = _run_id
       AND s.target_table = _target
       AND NOT (s.findings @> '[{"level": "error"}]'::jsonb)
  ),
  checked AS (
    SELECT pk.key, a.attname
      FROM parsed_keys pk
      LEFT JOIN pg_attribute a
             ON a.attrelid = format('public.%I', _target)::regclass
            AND a.attname  = pk.key
            AND a.attnum   > 0
            AND NOT a.attisdropped
  ),
  unit_cols AS (
    SELECT DISTINCT n.unit_column AS attname
      FROM public.ingest_normalize_at_promotion(_target) n
     WHERE n.column_name IN (SELECT attname FROM checked WHERE attname IS NOT NULL)
  ),
  writing AS (
    SELECT attname FROM checked WHERE attname IS NOT NULL
    UNION
    SELECT attname FROM unit_cols
  ),
  -- THE VALUE EXPRESSION, in two steps rather than one. `based` is unchanged from
  -- WP 3.4 — normalization happens here (I3) and nowhere downstream. `resolved`
  -- then wraps it, and splitting the two is what keeps the base expression
  -- written ONCE instead of three times inside a nested CASE.
  based AS (
    SELECT w.attname,
           a.attnotnull,
           CASE
             WHEN uc.canonical IS NOT NULL THEN
               format('%L::%s', uc.canonical, format_type(a.atttypid, a.atttypmod))
             WHEN nc.conversion = 'rate' THEN
               format('public.rate_to_weekly((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                      w.attname, nc.unit_column, format_type(a.atttypid, a.atttypmod))
             WHEN nc.conversion = 'duration' THEN
               format('public.duration_to_weeks((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                      w.attname, nc.unit_column, format_type(a.atttypid, a.atttypmod))
             ELSE
               format('(s.parsed ->> %L)::%s', w.attname, format_type(a.atttypid, a.atttypmod))
           END AS base,
           -- The column's OWN default expression, from the catalog. NULL when the
           -- column has none, which is the case the wrap must leave alone: a row
           -- missing a NOT NULL column with no default SHOULD fail, loudly, and a
           -- COALESCE to nothing would only move the error.
           (SELECT pg_get_expr(ad.adbin, ad.adrelid)
              FROM pg_attrdef ad
             WHERE ad.adrelid = a.attrelid AND ad.adnum = a.attnum) AS coldefault,
           -- A unit column's value is a literal token, never NULL, so it is never
           -- wrapped. Carried explicitly rather than re-derived below.
           (uc.canonical IS NOT NULL) AS is_unit_token
      FROM writing w
      JOIN pg_attribute a
        ON a.attrelid = format('public.%I', _target)::regclass
       AND a.attname  = w.attname
      LEFT JOIN LATERAL (SELECT n.canonical FROM public.ingest_normalize_at_promotion(_target) n
                          WHERE n.unit_column = w.attname LIMIT 1) uc ON true
      LEFT JOIN LATERAL (SELECT n.conversion, n.unit_column FROM public.ingest_normalize_at_promotion(_target) n
                          WHERE n.column_name = w.attname LIMIT 1) nc ON true
  ),
  resolved AS (
    SELECT attname,
           CASE
             WHEN attnotnull AND coldefault IS NOT NULL AND NOT is_unit_token
               THEN format('COALESCE(%s, %s)', base, coldefault)
             ELSE base
           END AS expr
      FROM based
  )
  SELECT (SELECT count(*)::int        FROM checked),
         (SELECT count(attname)::int  FROM checked),
         string_agg(quote_ident(attname), ', ' ORDER BY attname),
         string_agg(expr, ', ' ORDER BY attname),
         array_agg(attname ORDER BY attname),
         array_agg(expr    ORDER BY attname)
    INTO v_seen, v_known, write_cols, write_vals, write_names, write_exprs
    FROM resolved;

  IF v_seen IS NOT NULL AND v_known <> v_seen THEN
    RAISE EXCEPTION 'ingest_promotion_plan: staged rows for % name % column(s) that table does not have',
      _target, v_seen - v_known USING ERRCODE = 'undefined_column';
  END IF;

  SELECT string_agg(format('s.parsed ->> %L', c), ', ' ORDER BY c)
    INTO file_key
    FROM unnest(natural_key) AS c
   WHERE c <> ALL (ARRAY['project_id', 'plant_name']);

  RETURN;
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_promotion_plan(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_promotion_plan(uuid,text) TO service_role;

COMMENT ON FUNCTION public.ingest_promotion_plan(uuid,text) IS
  'Phase 6 / WP 6.2 (§4 D120) — the columns a promotion of this run into this '
  'target would write, and the expression for each. One list serves the whole '
  'run, so a column ONE row supplies is written for every row; a NOT NULL column '
  'carrying a DEFAULT is therefore wrapped in COALESCE against its OWN default, '
  'read from pg_attrdef rather than restated, so a blank optional cell takes the '
  'default instead of aborting the statement. Read by BOTH ingest_apply_run and '
  'ingest_diff_run, which is why the fix is here: diff-before-decision says the '
  'review screen computes with the values the promotion would write.';
