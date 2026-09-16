-- Phase 3 / WP 3.3 / §10 — THE SEVEN NATURAL KEYS, AND THE END OF D5.
--
-- Since WP 1.4 every one of these tables has carried a `natural_key_intended`
-- in its sidecar and no constraint behind it. `contract:check` R5 has warned
-- about that on four tables since WP 2.4 and on seven since WP 3.2. This file
-- lands the constraints; the same commit turns R5 from `warn` to `fail`, so the
-- gate and the thing it asserts cannot outlive each other. The plan previously
-- split those two halves across WP 2.4 and WP 3.3 and that split is unexecutable
-- in either order (§16 · Phase 2→3) — it is not recreated here.
--
-- `20260916000017` MUST HAVE RUN. It deletes the 98 rows (§15 run `35146894995`)
-- that would make every statement below fail. `supabase/rehearsal/080` asserts
-- the two files agree by doing exactly this over exactly that.
--
-- ── WHY EVERY INDEX SAYS `NULLS NOT DISTINCT`, INCLUDING THE FOUR THAT DO NOT
--    NEED IT TODAY ──────────────────────────────────────────────────────────
--
-- Three of the seven keys contain a NULLABLE column, and in each case the NULL
-- is meaningful rather than missing — the sidecars say so themselves:
--
--   bom_multi_level.higher_level_component_id  "Empty at the top of the tree,
--                                               where the parent is the finished
--                                               product itself"
--   tier2_suppliers.material_id                "NULLABLE, and the NULL is
--   tier3_suppliers.material_id                 meaningful: it says the
--                                               relationship is known but what
--                                               it carries is not"
--
-- PostgreSQL's default is that NULLs are DISTINCT from each other, so a plain
-- unique index on those keys constrains every row EXCEPT the ones with a null —
-- which for `bom_multi_level` is the roots, the rows no constraint has ever
-- touched. And the damage does not stop at a missing check: `ON CONFLICT`
-- infers its arbiter from the same index, so the upsert in `20260916000019`
-- would INSERT a duplicate rather than update, reporting success while doing
-- the one thing this package exists to stop. Demonstrated, not argued:
--
--     create table t(a text, b text); create unique index on t(a,b);
--     insert into t values ('x',null),('x',null);   -- BOTH accepted
--
-- `NULLS NOT DISTINCT` (PostgreSQL 15+) refuses the second and makes
-- `ON CONFLICT (a,b)` match it. It is applied to ALL SEVEN rather than to the
-- three that need it today, because a column's nullability is a schema property
-- that a later `ALTER` can change, and because not one of the seven grains has a
-- "a null is its own row" clause. A key that means different things on different
-- tables is the kind of fact that is true when written and false within a
-- quarter.
--
-- ── ALL SEVEN, INCLUDING `multi_tier_supply_chain` ─────────────────────────
--
-- §10 allows that one to be honestly excluded: D58 records that nothing in
-- `src/` or `supabase/functions/` reads or writes it, so a unique index on it
-- protects nothing. It is included anyway, and the reason is a number rather
-- than a preference: §15 run `35146894995` counts **0 rows across 0 projects**,
-- so the index costs one statement and no risk, while excluding it would mean
-- writing the exclusion into R5 — a permanent hole in a gate, carried for a
-- table that may well be dropped by WP 6.2. Seven constraints and no exception
-- is a smaller thing to maintain than six and a footnote.

-- ── 1 · the four lane tables ────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS inbound_logistics_natural_key
  ON public.inbound_logistics (project_id, plant_name, supplier_id, material_id)
  NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS outbound_logistics_natural_key
  ON public.outbound_logistics (project_id, plant_name, customer_id, product_id)
  NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS bom_single_level_natural_key
  ON public.bom_single_level (project_id, plant_name, product_id, material_id)
  NULLS NOT DISTINCT;

-- `level` is part of the key on purpose: the same material can be consumed by
-- the same parent at two depths of a deep BOM, and those are different facts.
CREATE UNIQUE INDEX IF NOT EXISTS bom_multi_level_natural_key
  ON public.bom_multi_level (project_id, plant_name, material_id, higher_level_component_id, level)
  NULLS NOT DISTINCT;

-- ── 2 · the three WP 3.2 described ──────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS tier2_suppliers_natural_key
  ON public.tier2_suppliers (project_id, plant_name, supplier_id, upstream_supplier_id, material_id)
  NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS tier3_suppliers_natural_key
  ON public.tier3_suppliers (project_id, plant_name, supplier_id, upstream_supplier_id, material_id)
  NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS multi_tier_supply_chain_natural_key
  ON public.multi_tier_supply_chain (project_id, plant_name, from_firm_id, to_firm_id)
  NULLS NOT DISTINCT;

-- ── 3 · the key, resolved FROM THE DATABASE rather than restated ────────────
--
-- `20260916000019`'s upsert needs the arbiter column list for whatever target it
-- is promoting into. It could carry a second copy of the seven lists above; it
-- does not, because a second copy is what `single-source` (I1) forbids and what
-- D33 looks like once it has aged. The index IS the key, so the function reads
-- the catalog.
--
-- THE RULE, stated so it is falsifiable: a table's natural key is its ONE unique,
-- non-partial, non-expression index that does NOT contain the surrogate column
-- `id`. The lane tables' `<table>_pkey` is on `id` alone and is therefore not a
-- natural key — which is precisely D5 restated. The three item masters have no
-- `id` column at all: their composite PRIMARY KEY is their natural key and this
-- function returns it with nothing added, which is why `20260916000019` can
-- promote into them (D55) without a second code path.
--
-- IT RAISES RATHER THAN GUESSING when there is no candidate or more than one.
-- A promotion that silently picked one of two keys would upsert on the wrong
-- grain and the rows would look right.

CREATE OR REPLACE FUNCTION public.ingest_target_natural_key(_target text)
RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_key   text[];
  v_count integer;
BEGIN
  -- Collected in a LOOP rather than with `(array_agg(cols ORDER BY …))[1]`,
  -- and the reason is a real bug this file shipped once: a PostgreSQL array of
  -- arrays is ONE MULTIDIMENSIONAL array, not a nested one, so subscripting the
  -- aggregate returns a scalar element and not the inner list. `v_key` came back
  -- NULL, the promotion built `ON CONFLICT ()`, and it was a syntax error at run
  -- time that no static gate can see — which is D31, caught by `rehearsal/070`
  -- exactly where the plan says it should be.
  v_count := 0;
  FOR v_key IN
    SELECT cols FROM (
      SELECT ic.relname AS index_name,
             array_agg(a.attname ORDER BY k.ord) AS cols
        FROM pg_index i
        JOIN pg_class ic     ON ic.oid = i.indexrelid
        JOIN pg_class tc     ON tc.oid = i.indrelid
        JOIN pg_namespace n  ON n.oid  = tc.relnamespace
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a  ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE n.nspname = 'public'
         AND tc.relname = _target
         AND i.indisunique
         AND i.indpred  IS NULL      -- a partial index constrains only some rows
         AND i.indexprs IS NULL      -- an expression index is not a column list
       GROUP BY i.indexrelid, ic.relname
    ) AS candidate
     WHERE NOT ('id' = ANY(cols))
     ORDER BY index_name
  LOOP
    v_count := v_count + 1;
    EXIT WHEN v_count > 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'ingest_target_natural_key: % has no natural-key unique index — only a surrogate key, which is D5', _target
      USING ERRCODE = 'undefined_object';
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'ingest_target_natural_key: % has more than one candidate natural key; a promotion cannot choose', _target
      USING ERRCODE = 'ambiguous_column';
  END IF;

  RETURN v_key;
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_target_natural_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_target_natural_key(text) TO service_role;

COMMENT ON FUNCTION public.ingest_target_natural_key(text) IS
  'Phase 3 / WP 3.3 — the columns a promotion upserts on, read from pg_index '
  'rather than restated: the one unique, non-partial, non-expression index that '
  'does not contain the surrogate `id`. Raises when there is none or more than '
  'one, because a promotion that guessed would upsert on the wrong grain.';

SELECT pg_notify('pgrst', 'reload schema');
