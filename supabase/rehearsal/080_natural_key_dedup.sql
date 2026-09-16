-- WP 3.3 · THE DEDUP RULE, AND THE NULL CASE A `=` JOIN WOULD MISS.
--
-- `20260916000017` deletes 98 rows in production and then `20260916000018`
-- creates seven unique indexes over what is left. If the dedup is wrong, the
-- index creation fails on the deploy and the migration that was supposed to end
-- D5 is the one that breaks the database — which is D31's shape with the
-- rehearsal already built to prevent it.
--
-- WHAT ONLY A DATABASE CAN SAY. Three of these claims are about SQL semantics
-- rather than about this repository's code:
--
--   · `PARTITION BY` compares NULLs with IS NOT DISTINCT FROM, so two BOM root
--     rows (`higher_level_component_id IS NULL`) are ONE group. A self-join on
--     `a = b` would leave both, and `CREATE UNIQUE INDEX … NULLS NOT DISTINCT`
--     would then fail on exactly the rows nothing has ever constrained.
--   · the tie-break keeps the row with the most non-null payload, not the
--     newest — so a later, emptier re-upload does not erase the data (D7).
--   · the result is a function of the DATA: same rows in, same row out, whatever
--     order the planner reads them in.
--
-- Section 5 is the one that would have caught the whole package being wrong:
-- it runs the dedup and then CREATES THE REAL INDEX over the result.
--
-- WHY IT DROPS THE INDEXES FIRST. By the time a rehearsal runs, BOTH migrations
-- have been applied, so the tables already carry the constraints and no duplicate
-- can be planted — the assertion would be testing a database the dedup can never
-- meet. Production's order is the opposite one: `20260916000017` runs against
-- tables with no constraint, and `20260916000018` follows. Dropping the two
-- indexes reproduces that order, and re-creating them at the end is the claim
-- itself: the dedup leaves a table the real index can be built on.

DO $wp33dedup$
DECLARE
  v_project uuid := '00000000-0000-4000-8000-000000033100';
  v_user    uuid := '00000000-0000-4000-8000-000000033101';
  v_result  jsonb;
  v_n       integer;
  v_num     numeric;
  v_txt     text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp33@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp33@example.invalid', 'WP33', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP33 dedup', v_user, 'WP33');

  -- ── 0a · THE INDEX THIS DATABASE ACTUALLY HAS, whatever built it ──────────
  --
  -- This runs BEFORE section 0 drops anything, so what it inspects is the index
  -- the rehearsal arrived with: in the fresh modes, the one `20260916000018`
  -- created; in the third mode, the one `rehearsal-schema.mjs` REBUILT from
  -- `build/schema.introspected.json`. That difference is the whole point.
  --
  -- D60: the introspector read a `CREATE UNIQUE INDEX`'s columns and its WHERE
  -- and dropped `NULLS NOT DISTINCT` in between, and the rebuild emitted a PLAIN
  -- unique index. The migration would be right, the artifact would be wrong, and
  -- the database `main` meets after the merge would hold a constraint weaker than
  -- the one the migration wrote — with every fresh-mode gate green. Same family
  -- as D49, D52 and D59: the introspector incomplete about a dependent detail,
  -- one kind at a time. Asserting it HERE, rather than on an index this file
  -- creates itself, is what makes the third mode able to see it.
  SELECT count(*) INTO v_n
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tc.relnamespace
   WHERE ns.nspname = 'public'
     AND ic.relname IN ('inbound_logistics_natural_key', 'outbound_logistics_natural_key',
                        'bom_single_level_natural_key', 'bom_multi_level_natural_key',
                        'tier2_suppliers_natural_key', 'tier3_suppliers_natural_key',
                        'multi_tier_supply_chain_natural_key')
     AND i.indisunique
     AND i.indnullsnotdistinct;
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'WP 3.3: % of 7 natural-key indexes are NULLS NOT DISTINCT. If this is green in the fresh modes and red here, the artifact lost the clause and the rebuilt index is weaker than the migration (D60)', v_n;
  END IF;

  -- And behaviourally, on the index as it stands: two BOM root rows are ONE row.
  INSERT INTO public.bom_multi_level
    (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
  VALUES (v_project, 'WP33', 'MAT-PRE', 0, NULL, 1.0);
  BEGIN
    INSERT INTO public.bom_multi_level
      (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
    VALUES (v_project, 'WP33', 'MAT-PRE', 0, NULL, 2.0);
    RAISE EXCEPTION 'WP 3.3: the natural-key index THIS DATABASE HAS accepted a second NULL-parent root row — it is not NULLS NOT DISTINCT';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  DELETE FROM public.bom_multi_level WHERE project_id = v_project;

  -- ── 0 · back to the shape the dedup actually meets ────────────────────────
  --
  -- See the header: production runs `20260916000017` BEFORE the indexes exist.
  -- A rehearsal has both migrations applied, so without this the duplicates
  -- below cannot even be inserted and nothing about the dedup is tested.
  DROP INDEX public.inbound_logistics_natural_key;
  DROP INDEX public.bom_multi_level_natural_key;

  -- ── 1 · the completeness tie-break beats recency ──────────────────────────
  --
  -- Two copies of one arc. The OLDER one carries the data; the NEWER one is what
  -- a field-shift leaves behind — same key, empty payload. "Keep the newest"
  -- keeps the empty one, and the project silently loses a volume, a lead time
  -- and a price. That is D7 and D5 meeting, and it is why the rule is not
  -- "newest wins".
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit, lead_time, unit_price, created_at, updated_at)
  VALUES
    (v_project, 'WP33', 'SUP-1', 'MAT-1', 100, 'week', 2, 5,
     now() - interval '2 days', now() - interval '2 days'),
    (v_project, 'WP33', 'SUP-1', 'MAT-1', NULL, NULL, NULL, NULL,
     now(), now());

  v_result := public.ingest_dedup_natural_key(
    'inbound_logistics',
    ARRAY['supplier_id','material_id'],
    ARRAY['volume','time_unit','lead_time','unit_price','lead_time_unit']);

  IF (v_result ->> 'rows_deleted')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: the dedup removed % row(s) of a 2-row duplicate group, expected 1',
      v_result ->> 'rows_deleted';
  END IF;

  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-1';
  IF v_num IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'WP 3.3: the dedup kept the NEWER, EMPTIER copy (volume %) — the surviving row must be the one carrying the data', v_num;
  END IF;

  -- ── 2 · recency decides when both copies are equally complete ─────────────
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit, lead_time, unit_price, created_at, updated_at)
  VALUES
    (v_project, 'WP33', 'SUP-2', 'MAT-2', 10, 'week', 1, 1,
     now() - interval '2 days', now() - interval '2 days'),
    (v_project, 'WP33', 'SUP-2', 'MAT-2', 20, 'week', 1, 1,
     now(), now());

  PERFORM public.ingest_dedup_natural_key(
    'inbound_logistics',
    ARRAY['supplier_id','material_id'],
    ARRAY['volume','time_unit','lead_time','unit_price','lead_time_unit']);

  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-2';
  IF v_num IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'WP 3.3: with both copies equally complete the LATER upload must win; kept volume %', v_num;
  END IF;

  -- ── 3 · THE NULL CASE — the one a `=` join silently skips ─────────────────
  --
  -- `higher_level_component_id` is NULL at the root of the tree ("Empty at the
  -- top of the tree, where the parent is the finished product itself" — the
  -- sidecar's own words), and §15 counts 4 level-0 rows in production. Two
  -- identical root rows are ONE fact stored twice and must collapse to one.
  INSERT INTO public.bom_multi_level
    (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate, created_at, updated_at)
  VALUES
    (v_project, 'WP33', 'MAT-R', 0, NULL, 1.5, now() - interval '2 days', now() - interval '2 days'),
    (v_project, 'WP33', 'MAT-R', 0, NULL, 1.5, now(), now()),
    -- and a row that differs ONLY in `level`, which the sidecar says is part of
    -- the key on purpose: the same material under the same parent at two depths
    -- is two facts, not one. If the dedup collapses these, the key is wrong.
    (v_project, 'WP33', 'MAT-D', 1, 'PARENT-1', 2.0, now(), now()),
    (v_project, 'WP33', 'MAT-D', 2, 'PARENT-1', 2.0, now(), now());

  v_result := public.ingest_dedup_natural_key(
    'bom_multi_level',
    ARRAY['material_id','higher_level_component_id','level'],
    ARRAY['consumption_rate']);

  IF (v_result ->> 'rows_deleted')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: the dedup removed % bom_multi_level row(s), expected exactly 1 — two NULL-parent root rows are ONE group, and the two `level`s are TWO facts',
      v_result ->> 'rows_deleted';
  END IF;

  SELECT count(*) INTO v_n FROM public.bom_multi_level
   WHERE project_id = v_project AND material_id = 'MAT-R';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.3: % root row(s) survived, expected 1 — NULL parents were compared with `=` somewhere', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.bom_multi_level
   WHERE project_id = v_project AND material_id = 'MAT-D';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.3: % row(s) survived for the two-depth material, expected 2 — `level` is part of the key', v_n;
  END IF;

  -- ── 4 · THE POINT: 20260916000018 now runs, exactly as it does on deploy ──
  --
  -- The real statements from the real migration, over rows the dedup has just
  -- collapsed. This is the only thing that says the two migrations agree, and it
  -- is the failure that would otherwise happen in production: `CREATE UNIQUE
  -- INDEX` on a table still holding duplicates does not warn, it aborts the
  -- deploy.
  BEGIN
    CREATE UNIQUE INDEX inbound_logistics_natural_key
      ON public.inbound_logistics (project_id, plant_name, supplier_id, material_id)
      NULLS NOT DISTINCT;
    CREATE UNIQUE INDEX bom_multi_level_natural_key
      ON public.bom_multi_level (project_id, plant_name, material_id, higher_level_component_id, level)
      NULLS NOT DISTINCT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'WP 3.3: the unique index could NOT be built on the deduplicated table — 20260916000017 and 20260916000018 disagree, and the production deploy would fail here';
  END;

  -- And the index bites on the case it exists for: a second ROOT row, whose key
  -- carries a NULL. A plain unique index accepts this insert.
  BEGIN
    INSERT INTO public.bom_multi_level
      (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
    VALUES (v_project, 'WP33', 'MAT-R', 0, NULL, 9.9);
    RAISE EXCEPTION 'WP 3.3: a duplicate ROOT row was accepted — the index is not NULLS NOT DISTINCT, so D5 is still open for every row with a null key column';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ── 5 · the function refuses a table the contract does not name ───────────
  --
  -- It interpolates its argument into dynamic SQL. Nothing but the seven.
  BEGIN
    PERFORM public.ingest_dedup_natural_key('audit_logs', ARRAY['id'], ARRAY[]::text[]);
    RAISE EXCEPTION 'WP 3.3: ingest_dedup_natural_key deleted rows from an arbitrary table';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- ── 6 · it is a no-op the second time ─────────────────────────────────────
  --
  -- Which is what makes it safe to re-run, and is the same property the upsert
  -- claims one migration later.
  v_result := public.ingest_dedup_natural_key(
    'inbound_logistics',
    ARRAY['supplier_id','material_id'],
    ARRAY['volume','time_unit','lead_time','unit_price','lead_time_unit']);
  IF (v_result ->> 'rows_deleted')::int <> 0 THEN
    RAISE EXCEPTION 'WP 3.3: a second dedup pass deleted % more row(s) — the rule is not idempotent',
      v_result ->> 'rows_deleted';
  END IF;

  RAISE NOTICE 'WP 3.3: the dedup keeps the most complete copy, treats NULL key columns as equal, and leaves a table the unique index can be built on';
END $wp33dedup$;
