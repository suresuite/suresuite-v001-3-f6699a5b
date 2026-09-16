-- Phase 3 / WP 3.3 / §10 — DEDUPLICATE, BEFORE ANYTHING CAN ENFORCE.
--
-- D5 is that no lane table has uniqueness on the key its grain implies, so
-- re-uploading a file duplicates every row in it. `20260916000018` lands the
-- seven unique indexes that end that. This file is what has to run first,
-- because `CREATE UNIQUE INDEX` on a table that already holds duplicates does
-- not warn — it fails, and the migration deploy fails with it.
--
-- THE BEFORE-NUMBER, MEASURED RATHER THAN ASSUMED (§15 run `35146894995`,
-- 2026-09-16, every project):
--
--     inbound_logistics        1 787 rows · 7 projects ·  96 rows a unique index rejects
--     bom_multi_level            794 rows · 2 projects ·   2
--     bom_single_level         2 907 rows · 5 projects ·   0
--     outbound_logistics          38 rows · 7 projects ·   0
--     tier2_suppliers              0 rows ·................ 0
--     tier3_suppliers              0 rows ·................ 0
--     multi_tier_supply_chain      0 rows ·................ 0
--
-- So 98 rows across two tables, and the other five are already clean. That
-- reading was taken for THIS package, hours after the one the plan inherited
-- and on the far side of WP 3.2's merge: the inherited number was measured
-- before a package that changed what reaches tier 2, and a dedup sized from a
-- stale count cannot be checked afterwards. Both readings are in §16.
--
-- AND NOT WHERE YOU WOULD LOOK FOR IT. None of the 96 is in `Project TRON -
-- ver2`, the project `seed-project.yml` seeds and the one §15 used to tell a
-- reader to measure — which is D42, and the reason this file deletes nothing
-- on the largest project in the database.
--
-- WHY A FUNCTION AND NOT SEVEN DELETE STATEMENTS. A one-shot `DO` block is
-- code that runs once, in production, unwitnessed — the exact shape D31 exists
-- to end. As a function it can be CALLED by `supabase/rehearsal/080` against a
-- database holding planted duplicates, so the rule below ("which copy
-- survives") is asserted rather than described. The same statements then run in
-- production because the migration calls the same function.

-- ── 1 · the rule, as a callable thing ───────────────────────────────────────
--
-- WHICH ROW OF A DUPLICATE GROUP SURVIVES, AND WHY NOT SIMPLY THE NEWEST.
-- A duplicate group is the same fact stored twice, so any choice loses nothing
-- IF the copies agree. They do not always: D7 put 376 null volumes, 414 null
-- lead times and 30 null prices into `inbound_logistics`, and a group can hold
-- one complete row and one a field-shift emptied. "Keep the newest" would then
-- throw away the only row carrying the data. So the order is:
--
--   1. the row with the MOST non-null payload columns  — keep the data
--   2. then the most recently updated                  — the later upload wins
--   3. then the most recently created
--   4. then the id                                     — so the result is a
--                                                        function of the data
--                                                        and not of the plan
--
-- Step 4 matters more than it looks: without it the same input can produce two
-- different databases, and then nothing downstream is reproducible (§5 T4).
--
-- GROUP-BY NULL SEMANTICS, NOT `=`. Three of the seven keys contain a nullable
-- column — `bom_multi_level.higher_level_component_id` (NULL at the root of the
-- tree, and §15 counts 4 level-0 rows) and `tier2_suppliers.material_id` /
-- `tier3_suppliers.material_id`. `PARTITION BY` compares with IS NOT DISTINCT
-- FROM, so two root rows for the same material land in one partition and one of
-- them goes. A `WHERE a = b` self-join would silently skip exactly those rows —
-- the ones most likely to be duplicated, since they are the ones no constraint
-- has ever touched. `20260916000018` carries the matching half: every index is
-- `NULLS NOT DISTINCT`, without which the constraint would not hold them either.

CREATE OR REPLACE FUNCTION public.ingest_dedup_natural_key(
  _target       text,
  _key_cols     text[],
  _payload_cols text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_before  integer;
  v_deleted integer;
  v_ident   text;
  v_score   text;
BEGIN
  -- The target is interpolated into dynamic SQL, so it is checked against the
  -- contract's own list rather than trusted. `multi_tier_supply_chain` is not a
  -- promotion target (D58 — nothing writes it) but it IS one of the seven the
  -- unique indexes cover, so it is named here explicitly.
  IF NOT (public.ingest_target_is_promotable(_target) OR _target = 'multi_tier_supply_chain') THEN
    RAISE EXCEPTION 'ingest_dedup_natural_key: % is not a table this contract deduplicates', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _key_cols IS NULL OR array_length(_key_cols, 1) IS NULL THEN
    RAISE EXCEPTION 'ingest_dedup_natural_key: % was given no natural key', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Every identifier goes through quote_ident, so a column name cannot carry SQL.
  SELECT string_agg(quote_ident(c), ', ') INTO v_ident FROM unnest(_key_cols) AS c;
  -- The completeness score is built from the column list rather than written out
  -- per table, so a column added to a lane tomorrow counts without this file
  -- being edited into disagreement with the schema. No payload at all (a pure
  -- key table) scores 0 for every row and the tie-break falls through to time.
  SELECT COALESCE(string_agg(format('(%I IS NOT NULL)::int', c), ' + '), '0')
    INTO v_score FROM unnest(COALESCE(_payload_cols, '{}'::text[])) AS c;

  EXECUTE format('SELECT count(*) FROM public.%I', _target) INTO v_before;

  EXECUTE format($sql$
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY project_id, plant_name, %s
               ORDER BY (%s) DESC,
                        updated_at DESC NULLS LAST,
                        created_at DESC NULLS LAST,
                        id
             ) AS rn
        FROM public.%I
    )
    DELETE FROM public.%I t USING ranked r
     WHERE t.id = r.id AND r.rn > 1
  $sql$, v_ident, v_score, _target, _target);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'target',       _target,
    'natural_key',  array_to_string(ARRAY['project_id', 'plant_name'] || _key_cols, ' + '),
    'rows_before',  v_before,
    'rows_deleted', v_deleted,
    'rows_after',   v_before - v_deleted);
END; $fn$;

-- Nobody holds this. It is a migration's tool and a rehearsal's subject; no
-- application role has any business deleting rows by rule.
REVOKE ALL ON FUNCTION public.ingest_dedup_natural_key(text, text[], text[]) FROM PUBLIC;

COMMENT ON FUNCTION public.ingest_dedup_natural_key(text, text[], text[]) IS
  'Phase 3 / WP 3.3 — collapses each natural-key group of a tier-2 table to one '
  'row, keeping the most complete copy and then the most recent. Prepares the '
  'table for the unique index 20260916000018 creates (D5). Asserted in '
  'supabase/rehearsal/080, including the NULL-bearing keys a `=` join would miss.';

-- ── 2 · run it, once, over the seven ────────────────────────────────────────
--
-- The key lists are the seven `natural_key_intended` values the sidecars have
-- carried since WP 1.4. `ingestSpecParity.test.ts` reads this file and fails if
-- any of them stops matching its sidecar, which is what keeps a key from being
-- corrected in one place and enforced from the other.
--
-- IT IS AUDITED, AND THE AUDIT SAYS `actor_known: false` RATHER THAN GUESSING.
-- A migration has no user. D36's rule is that a path which cannot name an actor
-- records that it cannot, instead of inventing one or omitting the row; this is
-- the honest case of it, not a gap. The row carries the per-table counts so the
-- deletion is readable from the database afterwards and not only from a deploy
-- log that scrolls away.

DO $dedup$
DECLARE
  v_spec   record;
  v_result jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_total  integer := 0;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('inbound_logistics',
       ARRAY['supplier_id','material_id'],
       ARRAY['volume','time_unit','lead_time','unit_price','lead_time_unit']),
      ('outbound_logistics',
       ARRAY['customer_id','product_id'],
       ARRAY['volume','time_unit','expected_lead_time','unit_price']),
      ('bom_single_level',
       ARRAY['product_id','material_id'],
       ARRAY['consumption_rate']),
      ('bom_multi_level',
       ARRAY['material_id','higher_level_component_id','level'],
       ARRAY['consumption_rate']),
      ('tier2_suppliers',
       ARRAY['supplier_id','upstream_supplier_id','material_id'],
       ARRAY['relationship_type','volume','unit_price','lead_time','time_unit']),
      ('tier3_suppliers',
       ARRAY['supplier_id','upstream_supplier_id','material_id'],
       ARRAY['relationship_type','volume','unit_price','lead_time','time_unit']),
      ('multi_tier_supply_chain',
       ARRAY['from_firm_id','to_firm_id'],
       ARRAY['to_firm_tier','to_firm_relationship'])
    ) AS s(target, key_cols, payload_cols)
  LOOP
    v_result := public.ingest_dedup_natural_key(v_spec.target, v_spec.key_cols, v_spec.payload_cols);
    v_counts := v_counts || jsonb_build_object(v_spec.target, v_result);
    v_total  := v_total + (v_result ->> 'rows_deleted')::int;

    RAISE NOTICE 'WP 3.3 dedup · % · % row(s) before, % deleted, % after',
      v_result ->> 'target', v_result ->> 'rows_before',
      v_result ->> 'rows_deleted', v_result ->> 'rows_after';
  END LOOP;

  PERFORM public.log_data_action(
    NULL, 'data', 'natural_key_dedup', 'tier2_lane_tables', NULL, NULL,
    jsonb_build_object(
      'migration',    '20260916000017_dedup_natural_keys',
      'work_package', 'Phase 3 / WP 3.3',
      'defect',       'D5',
      'reason',       'duplicates removed so 20260916000018 can create the unique indexes',
      'tie_break',    'most non-null payload columns, then updated_at, created_at, id',
      'rows_deleted', v_total,
      'by_table',     v_counts,
      -- A migration has no user and says so, rather than naming one (D36).
      'actor_known',  false));

  RAISE NOTICE 'WP 3.3 dedup · % row(s) deleted in total', v_total;
END $dedup$;
