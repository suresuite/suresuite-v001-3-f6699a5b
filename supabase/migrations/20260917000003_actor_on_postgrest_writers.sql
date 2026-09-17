-- =====================================================================
-- WP 4.1 — D36's remaining six, and why a line count never closed them
--                                                    (Phase 4 / G4 / §11)
--
-- `audit_tier_write()` reads `get_current_user_id()`, which resolves only when
-- the caller set `app.current_user_id`. WP 3.3 closed every writer that COULD
-- be closed by setting it — the SQL functions, which run in a transaction they
-- control. What was left is six edge functions that write through PostgREST,
-- and for those the GUC would have to survive into a DIFFERENT STATEMENT on a
-- POOLED CONNECTION, which `projectLanes.ts`'s own header records that it does
-- not. So the fix is not a line: each WRITE moves into an RPC that takes the
-- actor as a PARAMETER. `ingest_land_file` (`20260916000015`) is the pattern
-- and this file is four more of it.
--
-- WHAT MOVES, AND IT IS MORE THAN AUDIT:
--
--   1. `no-tier-skip` (I2) STOPS BEING A PROPERTY OF TODAY'S CODE. Three of the
--      six — `ingest-inbound-logistics`, `ingest-outbound-logistics`,
--      `ingest-bom-multi-level` — are reached from the /policies grid and write
--      tier-2 lane tables directly. While they hold a PostgREST client they are
--      one `.upsert()` away from any tier-2 table in the schema; once their
--      write is `ingest_legacy_upsert_lane` the set of tables they can reach is
--      a whitelist in a migration. The invariant was enforced for the nine CSV
--      datasets by the ABSENCE of another write path; for these three it is now
--      enforced by the schema.
--
--   2. THE PROMOTION GATE REACHES THEM. Every function here resolves
--      `effective_project_role` and refuses below `editor`, the way
--      `ingest_apply_run` does since WP 3.4. A service-role key previously made
--      the caller's project role irrelevant on these paths.
--
--   3. THE AUDIT STOPS BEING PER-ROW. `predict-critical-nodes` issued ONE
--      UPDATE PER PREDICTION — a statement-grain audit trigger turns that into
--      one audit row per row, which is the log-nobody-can-read WP 2.3 wrote the
--      statement grain to avoid. `erp-sync-orbit-mrp` upserted `products` one
--      row at a time for the same reason. Both become one statement.
--
--   4. `combine-project` BECOMES ATOMIC. It DELETEs both tier-3 tables and then
--      INSERTs in separate PostgREST calls, so a failure between them leaves a
--      project with no ETL output and no error anybody sees. One RPC, one
--      transaction.
--
-- WHAT DOES NOT MOVE: none of these functions gains or loses a row it did not
-- already write. The upserts keep WP 3.3's natural keys — read from `pg_index`
-- here rather than spelled out, so there is one copy of the key and not two.
-- =====================================================================

-- ── 0 · the shared preamble every writer below runs ─────────────────────────
--
-- Actor, GUC, role. Written once because three functions need the identical
-- three steps and a fourth copy is how one of them ends up different.

CREATE OR REPLACE FUNCTION public.assert_writer_may_act(
  _fn            text,
  _project_id    uuid,
  _actor_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_role text;
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION '%: this write must name its actor (invariant audit-actor)', _fn
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF _project_id IS NULL THEN
    RAISE EXCEPTION '%: this write must name its project', _fn
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCAL — `true` — so it belongs to this transaction and cannot leak onto the
  -- next caller of a pooled connection. This is also the AUTHORIZATION: it makes
  -- `has_project_access()` answer for the named actor rather than for whoever
  -- the connection last belonged to.
  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);

  v_role := public.effective_project_role(_actor_user_id, _project_id);
  IF public.project_role_rank(v_role) < public.project_role_rank('editor') THEN
    RAISE EXCEPTION
      '%: writing into project % needs project role editor or higher; % has %',
      _fn, _project_id, _actor_user_id, COALESCE(v_role, 'no role on this project')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $fn$;

REVOKE ALL ON FUNCTION public.assert_writer_may_act(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_writer_may_act(text,uuid,uuid) TO service_role;

-- ── 1 · the three legacy `ingest-*` lane writers ────────────────────────────
--
-- ONE function for three callers, because WP 3.1's finding was that a path
-- written against a TARGET rather than against a SOURCE needs no second copy.
-- The arbiter comes from `ingest_target_natural_key`, which reads `pg_index` —
-- so the key is not restated here and cannot drift from the index `ON CONFLICT`
-- infers from. The target is checked against `ingest_target_is_promotable`
-- BEFORE it reaches `format()`: a dynamic INSERT whose table name came from a
-- caller is an injection with a migration around it.
--
-- `project_id` and `plant_name` ARE SET FROM THE PROJECT, never from the
-- payload. The lane tables have carried `ensure_dataset_plant_matches_project`
-- since `20250820145017`, so this can only agree with what the trigger would
-- have accepted — it moves the rule from "the row is refused if the client got
-- it wrong" to "the client cannot get it wrong".

CREATE OR REPLACE FUNCTION public.ingest_legacy_upsert_lane(
  _project_id    uuid,
  _actor_user_id uuid,
  _target        text,
  _rows          jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_key      text[];
  v_file_key text;
  v_cols     text;
  v_update   text;
  v_plant    text;
  v_written  integer;
  v_updated  integer;
BEGIN
  PERFORM public.assert_writer_may_act('ingest_legacy_upsert_lane', _project_id, _actor_user_id);

  IF NOT public.ingest_target_is_promotable(_target) THEN
    RAISE EXCEPTION 'ingest_legacy_upsert_lane: % is not a writable lane', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'ingest_legacy_upsert_lane: rows must be a json array, got %',
      COALESCE(jsonb_typeof(_rows), 'null') USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(_rows) = 0 THEN
    RETURN jsonb_build_object('rows_written', 0, 'rows_updated', 0, 'target', _target);
  END IF;

  SELECT plant_name INTO v_plant FROM public.projects WHERE id = _project_id;

  v_key := public.ingest_target_natural_key(_target);

  -- The arbiter columns the PAYLOAD supplies — the server-set two are excluded
  -- because they are the same value for every row and cannot discriminate.
  SELECT string_agg(quote_ident(c), ', ' ORDER BY c) INTO v_file_key
    FROM unnest(v_key) AS c WHERE c NOT IN ('project_id','plant_name');

  -- Which columns to write: the union of the payload's keys, intersected with
  -- the target's real columns, minus everything the server owns. A key the
  -- table does not have is DROPPED rather than raising — these are legacy
  -- callers and a new field in a client payload must not take the grid down.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attname) INTO v_cols
    FROM (SELECT DISTINCT k FROM jsonb_array_elements(_rows) e, jsonb_object_keys(e) k) p
    JOIN pg_attribute a
      ON a.attrelid = format('public.%I', _target)::regclass
     AND a.attname  = p.k AND a.attnum > 0 AND NOT a.attisdropped
   WHERE a.attname NOT IN ('id','project_id','plant_name','created_at','updated_at',
                           'ingest_run_id','source_row_id');

  IF v_cols IS NULL THEN
    RAISE EXCEPTION
      'ingest_legacy_upsert_lane: the payload carries no column of %. Writing nothing '
      'and reporting success is how a silent data loss looks.', _target
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A key column must NOT appear in DO UPDATE SET: `ON CONFLICT` forbids
  -- assigning to what it matched on, and it would be meaningless anyway.
  SELECT COALESCE(string_agg(format('%I = EXCLUDED.%I,', c, c), ' ' ORDER BY c), '')
    INTO v_update
    FROM (SELECT DISTINCT trim(both '"' FROM c) AS c
            FROM unnest(string_to_array(v_cols, ', ')) AS c) u
   WHERE u.c <> ALL (v_key);

  -- ONE STATEMENT, which is what makes the tier-2 audit trigger write ONE row
  -- saying "n rows" rather than n rows saying one (WP 2.3). `DISTINCT ON` is
  -- not decoration: `ON CONFLICT DO UPDATE` raises 21000 when one statement
  -- carries two rows with the same arbiter key, which a grid that assigns the
  -- same supplier twice produces. Last one wins, the same rule
  -- `ingest_apply_run` applies.
  EXECUTE format(
    'WITH up AS (
       INSERT INTO public.%I (project_id, plant_name, %s)
         SELECT DISTINCT ON (%s) $1, $2, %s
           FROM jsonb_populate_recordset(null::public.%I, $3) AS r
          ORDER BY %s
       ON CONFLICT (%s) DO UPDATE SET %s updated_at = now()
       RETURNING (xmax = 0) AS inserted
     )
     SELECT count(*)::int, count(*) FILTER (WHERE NOT inserted)::int FROM up',
    _target, v_cols,
    COALESCE(v_file_key, '1'),
    (SELECT string_agg('r.' || quote_ident(trim(both '"' FROM c)), ', ')
       FROM unnest(string_to_array(v_cols, ', ')) WITH ORDINALITY AS t(c, o)),
    _target,
    COALESCE(v_file_key, '1'),
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_key) AS c),
    v_update)
    INTO v_written, v_updated
    USING _project_id, v_plant, _rows;

  RETURN jsonb_build_object(
    'target', _target, 'rows_written', v_written, 'rows_updated', v_updated);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_legacy_upsert_lane(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_legacy_upsert_lane(uuid,uuid,text,jsonb) TO service_role;

-- ── 2 · `erp-sync-orbit-mrp`'s promotion ────────────────────────────────────
--
-- `applyStagedRun` read `ingest_staged_products` and upserted `products` ONE
-- ROW AT A TIME over PostgREST — a tier-1 → tier-2 promotion that never went
-- through `ingest_apply_run`, carried no actor, and answered to no project
-- role. It is a real second promotion path and this is it, closed: one
-- statement, the actor named, role ≥ editor, and the arbiter read from the
-- catalog rather than spelled `project_id,product_id` in TypeScript.

CREATE OR REPLACE FUNCTION public.mrp_apply_staged_products(
  _run_id        uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run     public.ingest_runs%ROWTYPE;
  v_written integer;
  v_updated integer;
BEGIN
  SELECT * INTO v_run FROM public.ingest_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mrp_apply_staged_products: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.assert_writer_may_act('mrp_apply_staged_products', v_run.project_id, _actor_user_id);

  WITH up AS (
    INSERT INTO public.products (project_id, product_id, name,
                                 source_system, source_external_id, source_synced_at)
      SELECT DISTINCT ON (COALESCE(s.sku, s.external_id))
             v_run.project_id, COALESCE(s.sku, s.external_id), s.name,
             'orbit-mrp', s.external_id, s.staged_at
        FROM public.ingest_staged_products s
       WHERE s.ingest_run_id = _run_id
         AND s.diff_state IS DISTINCT FROM 'removed_upstream'
         AND COALESCE(s.sku, s.external_id) IS NOT NULL
       ORDER BY COALESCE(s.sku, s.external_id), s.staged_at DESC
    ON CONFLICT (project_id, product_id) DO UPDATE
       SET name               = EXCLUDED.name,
           source_system      = EXCLUDED.source_system,
           source_external_id = EXCLUDED.source_external_id,
           source_synced_at   = EXCLUDED.source_synced_at,
           updated_at         = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*)::int, count(*) FILTER (WHERE NOT inserted)::int
    INTO v_written, v_updated FROM up;

  UPDATE public.ingest_runs
     SET status = 'applied', applied_at = now(), applied_by_user_id = _actor_user_id
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'run_id', _run_id, 'rows_promoted', v_written, 'rows_updated', v_updated);
END; $fn$;

REVOKE ALL ON FUNCTION public.mrp_apply_staged_products(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mrp_apply_staged_products(uuid,uuid) TO service_role;

-- ── 3 · `combine-project`'s ETL write ───────────────────────────────────────
--
-- Delete-then-insert on two tier-3 tables, in ONE transaction. The DELETE and
-- the INSERT were separate PostgREST calls, so a failure between them emptied a
-- project's ETL output with nothing to notice — a data loss whose only symptom
-- is a page that renders zero rows.

CREATE OR REPLACE FUNCTION public.etl_replace_supply_chain(
  _project_id       uuid,
  _actor_user_id    uuid,
  _rows             jsonb,
  _multi_tier_rows  jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_deleted integer;
  v_mt_del  integer;
  v_ins     integer;
  v_mt_ins  integer;
BEGIN
  PERFORM public.assert_writer_may_act('etl_replace_supply_chain', _project_id, _actor_user_id);

  IF jsonb_typeof(_rows) <> 'array' OR jsonb_typeof(_multi_tier_rows) <> 'array' THEN
    RAISE EXCEPTION 'etl_replace_supply_chain: both row payloads must be json arrays'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM public.supply_chain_data WHERE project_id = _project_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = _project_id;
  GET DIAGNOSTICS v_mt_del = ROW_COUNT;

  INSERT INTO public.supply_chain_data (
    project_id, plant_name, data_source, data_source_group,
    from_location, to_location, weighted, material_consumption_rate, sourcing_ratio,
    uploaded_by, organization)
  SELECT _project_id, r.plant_name, r.data_source, r.data_source_group,
         r.from_location, r.to_location, r.weighted, r.material_consumption_rate,
         r.sourcing_ratio, r.uploaded_by, r.organization
    FROM jsonb_populate_recordset(null::public.supply_chain_data, _rows) AS r;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  INSERT INTO public.supply_chain_data_multi_tier (
    project_id, plant_name, data_source, from_location, to_location,
    material_consumption_rate, sourcing_ratio, weighted, level, path_root,
    uploaded_by, organization)
  SELECT _project_id, r.plant_name, r.data_source, r.from_location, r.to_location,
         r.material_consumption_rate, r.sourcing_ratio, r.weighted, r.level,
         r.path_root, r.uploaded_by, r.organization
    FROM jsonb_populate_recordset(null::public.supply_chain_data_multi_tier, _multi_tier_rows) AS r;
  GET DIAGNOSTICS v_mt_ins = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_deleted, 'inserted', v_ins,
    'multi_tier_deleted', v_mt_del, 'multi_tier_inserted', v_mt_ins);
END; $fn$;

REVOKE ALL ON FUNCTION public.etl_replace_supply_chain(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.etl_replace_supply_chain(uuid,uuid,jsonb,jsonb) TO service_role;

-- ── 4 · `predict-critical-nodes`'s scores ───────────────────────────────────
--
-- The analyzer issued one UPDATE per prediction. On the largest project in this
-- database that is ~1 800 statements and, since WP 2.3, ~1 800 audit rows for
-- one analysis — the log-nobody-can-read the statement grain exists to prevent.
-- One statement, one audit row, the actor named.
--
-- The rows are addressed by `supply_chain_data.id` and the project is taken from
-- the ROWS rather than from the caller, then checked: an id set spanning two
-- projects is refused rather than half-written under one project's authority.

CREATE OR REPLACE FUNCTION public.analysis_mark_critical_nodes(
  _actor_user_id uuid,
  _scores        jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_project uuid;
  v_projects integer;
  v_updated integer;
BEGIN
  IF jsonb_typeof(_scores) <> 'array' THEN
    RAISE EXCEPTION 'analysis_mark_critical_nodes: scores must be a json array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(_scores) = 0 THEN
    RETURN jsonb_build_object('rows_updated', 0);
  END IF;

  -- `min(uuid)` DOES NOT EXIST in PostgreSQL — there is no ordering aggregate
  -- for the type — and the first draft of this line used it. The rehearsal is
  -- what said so; nothing static would have.
  SELECT count(*), (array_agg(p))[1]
    INTO v_projects, v_project
    FROM (SELECT DISTINCT d.project_id AS p
            FROM public.supply_chain_data d
           WHERE d.id IN (SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(_scores) e)) q;

  IF COALESCE(v_projects, 0) = 0 THEN
    RAISE EXCEPTION 'analysis_mark_critical_nodes: none of the % scored id(s) exists',
      jsonb_array_length(_scores) USING ERRCODE = 'no_data_found';
  END IF;
  IF v_projects > 1 THEN
    RAISE EXCEPTION
      'analysis_mark_critical_nodes: the scored rows span % projects. One call writes '
      'under one project''s authority or it writes nothing.', v_projects
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM public.assert_writer_may_act('analysis_mark_critical_nodes', v_project, _actor_user_id);

  UPDATE public.supply_chain_data d
     SET is_critical_node      = s.is_critical,
         critical_node_score   = s.score,
         prediction_timestamp  = now(),
         updated_at            = now()
    FROM jsonb_to_recordset(_scores) AS s(id uuid, is_critical boolean, score numeric)
   WHERE d.id = s.id AND d.project_id = v_project;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('project_id', v_project, 'rows_updated', v_updated);
END; $fn$;

REVOKE ALL ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analysis_mark_critical_nodes(uuid,jsonb) TO service_role;

-- 5. Flush PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');
