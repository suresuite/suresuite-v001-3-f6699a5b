-- WP 4.1 · THE TRUST ANCHOR COVERS WHAT THE ENGINE READS, AND THE WRITE NAMES
-- ITS ACTOR.
--
-- §11's exit checks for this package are three sentences, and every one of them
-- is a statement about what the DATABASE does rather than what a file says:
--
--     "editing a multi-level BOM moves the hash (failing test first)"
--     "existing runs still resolve their dataset_version_id"
--     "every remaining D36 path writes an audit row naming its actor, proved by
--      a rehearsal assertion that reads the row back rather than by counting
--      changed lines"
--
-- THE FIRST SECTION BELOW WAS WRITTEN RED. On `main` it fails with
-- "the hash did not move", because `_build_dataset_snapshot` hashes
-- `bom_single_level` and not `bom_multi_level` (§4 D11) while `datamap.py`
-- reads BOTH and prefers the deep one. A test written after the fix proves the
-- fix compiles; this one proves the defect existed.
--
-- WHAT ONLY A DATABASE CAN SAY HERE, and each is a thing a static gate reads as
-- fine: whether a hash MOVES when a row the engine reads changes; whether
-- `snapshot_dataset` inserts or dedups after that change; whether the composite
-- actually decomposes into the two domains it claims; whether a row written
-- through an RPC carries the actor into the trigger's `app.current_user_id` on
-- the SAME connection; and whether the audit row that comes back names a
-- person the database agreed could write.
--
-- EVERY NULLABLE COMPARISON IS `IS DISTINCT FROM`. WP 3.4's mutation run found
-- a bug in an ASSERTION rather than in the code — `NULL <> 'owner'` is NULL,
-- which an IF treats as false, so the test could never fail. Assume your own
-- test is the thing that is wrong.

DO $wp41$
DECLARE
  v_owner    uuid := '00000000-0000-4000-8000-000000041200';
  v_analyst  uuid := '00000000-0000-4000-8000-000000041201';
  v_editor   uuid := '00000000-0000-4000-8000-000000041202';
  v_project  uuid := '00000000-0000-4000-8000-000000041203';
  v_h0       text;
  v_h1       text;
  v_h2       text;
  v_v1       uuid;
  v_v2       uuid;
  v_n        integer;
  v_before   integer;
  v_res      jsonb;
  v_scores   jsonb;
  v_txt      text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner,   'wp41owner@example.invalid'),
    (v_analyst, 'wp41analyst@example.invalid'),
    (v_editor,  'wp41editor@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_owner,   'wp41owner@example.invalid',   'WP41 owner',   'x'),
    (v_analyst, 'wp41analyst@example.invalid', 'WP41 analyst', 'x'),
    (v_editor,  'wp41editor@example.invalid',  'WP41 editor',  'x');

  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP41 graph hash', v_owner, 'WP41P');

  -- A multi-level project: the single-level BOM the v1 hash covers is EMPTY,
  -- and the whole bill of materials lives in `bom_multi_level`. That is not a
  -- contrived fixture — it is what an upload through `ingest-bom-multi-level`
  -- produces, and `datamap.py` prefers the deep table when it has rows.
  INSERT INTO public.materials (project_id, material_id, cost)
    VALUES (v_project, 'M1', 10), (v_project, 'M2', 20);
  INSERT INTO public.products (project_id, product_id, sell_price)
    VALUES (v_project, 'P1', 100);
  INSERT INTO public.bom_multi_level
      (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
    VALUES (v_project, 'WP41P', 'M1', 1, 'P1', 2),
           (v_project, 'WP41P', 'M2', 2, 'M1', 3);

  -- ── 1 · EDITING A MULTI-LEVEL BOM MOVES THE HASH (§4 D11) ─────────────────
  --
  -- THE FAILING TEST. `consumption_rate` is a number the engine multiplies
  -- demand by: doubling it changes every material requirement in the run. If
  -- the hash does not move, a run stamped with the old one claims to have read
  -- data it did not read, which is `input-hash` (I5) inverted — the anchor says
  -- "same inputs" about inputs that differ.
  v_h0 := public.current_graph_hash(v_project);

  UPDATE public.bom_multi_level SET consumption_rate = 4
   WHERE project_id = v_project AND material_id = 'M1';

  v_h1 := public.current_graph_hash(v_project);

  IF v_h1 IS NOT DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION
      'WP 4.1: editing a multi-level BOM did not move the hash — it is still %. '
      '`_build_dataset_snapshot` hashes `bom_single_level` only (§4 D11) while '
      '`datamap.py` reads `bom_multi_level` and prefers it, so every run on a '
      'multi-level project is bound to an identity that ignores its own bill of '
      'materials.', COALESCE(left(v_h0, 12), '(null)');
  END IF;

  -- …and a row ADDED to the deep BOM moves it too. The UPDATE above and an
  -- INSERT reach the snapshot by different routes (a changed value versus a
  -- changed row count), and a hash that caught only one would be worse than
  -- one that caught neither, because it would look like it worked.
  INSERT INTO public.bom_multi_level
      (project_id, plant_name, material_id, level, higher_level_component_id, consumption_rate)
    VALUES (v_project, 'WP41P', 'M2', 1, 'P1', 5);

  v_h2 := public.current_graph_hash(v_project);
  IF v_h2 IS NOT DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION
      'WP 4.1: adding a multi-level BOM line did not move the hash (still %).',
      COALESCE(left(v_h1, 12), '(null)');
  END IF;

  -- ── 2 · AND `snapshot_dataset` STOPS REPORTING "unchanged" ────────────────
  --
  -- The hash is the mechanism; this is the consequence a user sees. Freeze a
  -- version, edit the deep BOM, freeze again: the second call must INSERT a new
  -- version rather than dedup against the latest and hand back the first id.
  v_v1 := public.snapshot_dataset(v_project, 'WP41 before', v_owner, 'wp41owner@example.invalid');

  UPDATE public.bom_multi_level SET consumption_rate = 9
   WHERE project_id = v_project AND material_id = 'M2' AND level = 2;

  v_v2 := public.snapshot_dataset(v_project, 'WP41 after', v_owner, 'wp41owner@example.invalid');

  IF v_v2 IS NOT DISTINCT FROM v_v1 THEN
    RAISE EXCEPTION
      'WP 4.1: `snapshot_dataset` deduped against the latest version after a '
      'multi-level BOM edit — it returned the SAME version id (%), so the UI '
      'reports "unchanged" for a dataset that changed.', v_v1;
  END IF;

  SELECT count(*) INTO v_n FROM public.dataset_versions WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 4.1: expected 2 dataset versions after two freezes across an edit, found %.', v_n;
  END IF;

  -- ── 3 · THE COMPOSITE DECOMPOSES INTO THE TWO DOMAINS IT CLAIMS ──────────
  --
  -- A "composite" that is really a hash of the whole text, with two domain
  -- columns computed beside it and never checked against it, would pass every
  -- static gate and every assertion above. This is the check that the three
  -- numbers are one object: recompose the composite from the two halves the
  -- version row stored and require it to equal the composite the row stored.
  SELECT count(*) INTO v_n FROM public.dataset_versions WHERE id = v_v2
     AND hash_inputs IS NOT NULL AND hash_network IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: the version just frozen has a NULL domain hash. `snapshot_dataset` '
      'must write all three or the split is decoration.';
  END IF;

  SELECT v.graph_hash INTO v_h0 FROM public.dataset_versions v WHERE v.id = v_v2;
  IF v_h0 IS DISTINCT FROM public.current_graph_hash(v_project) THEN
    RAISE EXCEPTION
      'WP 4.1: the frozen version''s graph_hash (%) is not the project''s current hash (%) '
      'although nothing changed between the freeze and this line.',
      COALESCE(left(v_h0, 12), '(null)'),
      COALESCE(left(public.current_graph_hash(v_project), 12), '(null)');
  END IF;

  SELECT encode(extensions.digest(
           jsonb_build_object(
             'schema_version', to_jsonb(2),
             'hash_inputs',  v.hash_inputs,
             'hash_network', v.hash_network)::text, 'sha256'), 'hex')
    INTO v_h1
    FROM public.dataset_versions v WHERE v.id = v_v2;

  IF v_h1 IS DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION
      'WP 4.1: the composite does not decompose. Recomposing it from the row''s own '
      '`hash_inputs` and `hash_network` gives % but the row stores %. The two domain '
      'columns and the composite are not describing the same snapshot.',
      COALESCE(left(v_h1, 12), '(null)'), COALESCE(left(v_h0, 12), '(null)');
  END IF;

  -- The domains are INDEPENDENT, which is the whole reason for splitting them.
  -- A deep-BOM edit is a simulation input: it must move `hash_inputs` and the
  -- composite, and leave `hash_network` exactly where it was.
  v_h1 := public.current_hash_inputs(v_project);
  v_h2 := public.current_hash_network(v_project);

  UPDATE public.bom_multi_level SET consumption_rate = 11
   WHERE project_id = v_project AND material_id = 'M1';

  IF public.current_hash_inputs(v_project) IS NOT DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION 'WP 4.1: a deep-BOM edit did not move `hash_inputs`.';
  END IF;
  IF public.current_hash_network(v_project) IS DISTINCT FROM v_h2 THEN
    RAISE EXCEPTION
      'WP 4.1: a deep-BOM edit moved `hash_network`. The domains are not independent, '
      'so a stale network analysis cannot be told apart from a stale simulation.';
  END IF;

  -- …and the converse. A tier-2 network row must move `hash_network` and the
  -- composite, and leave `hash_inputs` alone. This is the half §11 records as
  -- UNEXERCISED in production — all three tables hold zero rows — so the only
  -- place it is ever exercised is here.
  v_h1 := public.current_hash_inputs(v_project);
  v_h2 := public.current_hash_network(v_project);

  INSERT INTO public.tier2_suppliers
      (project_id, plant_name, supplier_id, upstream_supplier_id, material_id, volume)
    VALUES (v_project, 'WP41P', 'S1', 'S2', 'M1', 7);

  IF public.current_hash_network(v_project) IS NOT DISTINCT FROM v_h2 THEN
    RAISE EXCEPTION 'WP 4.1: a `tier2_suppliers` row did not move `hash_network`.';
  END IF;
  IF public.current_hash_inputs(v_project) IS DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION
      'WP 4.1: a `tier2_suppliers` row moved `hash_inputs`. A deep-tier upload would '
      'invalidate every simulation on the project, which is the false dirty the split exists to avoid.';
  END IF;

  -- ── 4 · THE COLUMNS v1 MISSED, EACH ASSERTED ON ITS OWN (§4 D67) ─────────
  --
  -- `lead_time_unit` first, because it is the one with a behavioural
  -- consequence a reader can state: 14 days and 14 weeks are different
  -- datasets, and v1 hashed them identically.
  INSERT INTO public.inbound_logistics
      (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    VALUES (v_project, 'WP41P', 'S1', 'M1', 14, 'days', 100, 5);

  v_h1 := public.current_hash_inputs(v_project);
  UPDATE public.inbound_logistics SET lead_time_unit = 'weeks'
   WHERE project_id = v_project AND supplier_id = 'S1' AND material_id = 'M1';
  IF public.current_hash_inputs(v_project) IS NOT DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION
      'WP 4.1: changing `lead_time_unit` from days to weeks did not move the hash. '
      '`datamap.py` projects the column (its own comment names D9) and the engine '
      'resolves `lead_time` against it, so v1 hashed 14 days and 14 weeks the same.';
  END IF;

  -- `demand_min` / `demand_max` — read by `datamap.py`, added to `products`
  -- after v1 was written, never hashed.
  v_h1 := public.current_hash_inputs(v_project);
  UPDATE public.products SET demand_min = 1, demand_max = 99
   WHERE project_id = v_project AND product_id = 'P1';
  IF public.current_hash_inputs(v_project) IS NOT DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION 'WP 4.1: setting `demand_min`/`demand_max` did not move the hash.';
  END IF;

  -- `customers` — hashed although no reader loads it (§4 D69). The assertion
  -- is here so that the day somebody deletes it from the snapshot as "unread",
  -- this file says why it was there.
  v_h1 := public.current_hash_inputs(v_project);
  INSERT INTO public.customers (project_id, customer_id, segment, priority_weight)
    VALUES (v_project, 'C1', 'strategic', 10);
  IF public.current_hash_inputs(v_project) IS NOT DISTINCT FROM v_h1 THEN
    RAISE EXCEPTION 'WP 4.1: adding a customer with economics did not move the hash.';
  END IF;

  -- ── 5 · §11 EXIT CHECK — EXISTING RUNS STILL RESOLVE THEIR VERSION ───────
  --
  -- §11 flags that `snapshot_dataset` dedups against the LATEST version only,
  -- and asks what that does to this check. The answer is nothing, and it is
  -- worth asserting rather than reasoning about: a run is bound to a
  -- `dataset_versions` ROW, the rows are append-only, and the bump changes what
  -- the NEXT freeze computes — not any row already written. So a run frozen
  -- before the bump must still resolve, and its stored hash must still be the
  -- hash its own version holds.
  INSERT INTO public.scenarios (id, project_id, name)
    VALUES ('00000000-0000-4000-8000-000000041204', v_project, 'WP41 scenario')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.simulation_runs (id, project_id, scenario_id, status, dataset_version_id, graph_hash)
    SELECT '00000000-0000-4000-8000-000000041205', v_project,
           '00000000-0000-4000-8000-000000041204', 'completed', v.id, v.graph_hash
      FROM public.dataset_versions v WHERE v.id = v_v1;

  -- Now move the data underneath it, the way a CSV re-upload would.
  UPDATE public.bom_multi_level SET consumption_rate = 13
   WHERE project_id = v_project AND material_id = 'M1';

  SELECT count(*) INTO v_n
    FROM public.simulation_runs r
    JOIN public.dataset_versions v ON v.id = r.dataset_version_id
   WHERE r.id = '00000000-0000-4000-8000-000000041205'
     AND r.graph_hash IS NOT DISTINCT FROM v.graph_hash;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: a run no longer resolves its dataset version, or its stored hash no '
      'longer matches the version it points at. The bump must not rewrite history.';
  END IF;

  -- …and the run now reads DIRTY against the live project, which is the point.
  SELECT count(*) INTO v_n
    FROM public.simulation_runs r
   WHERE r.id = '00000000-0000-4000-8000-000000041205'
     AND r.graph_hash IS DISTINCT FROM public.current_graph_hash(r.project_id);
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: the data moved under a completed run and the run still reads clean. '
      'Dirty detection is the anchor''s whole job.';
  END IF;

  -- ── 6 · `snapshot_dataset` NAMES ITS ACTOR (audit-actor, G4) ─────────────
  --
  -- A SEVENTH unattributed writer that D36's list of six never held: the
  -- function has taken the author as a parameter since `20260703000001` and
  -- never told the tier-3 trigger. THE ROW IS READ BACK; a line count proves
  -- nothing (§16 · WP 3.3 · I).
  SELECT count(*) INTO v_n
    FROM public.audit_logs a
   WHERE a.plane = 'data'
     AND a.target_type = 'dataset_versions'
     AND a.action = 'insert'
     AND a.actor_user_id IS NOT DISTINCT FROM v_owner
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION
      'WP 4.1: freezing a dataset version wrote no audit row naming % as its actor. '
      '`dataset_versions` carries all three `audit_tier_write` triggers and '
      '`snapshot_dataset` is SECURITY DEFINER, so the actor it was handed must reach '
      'the trigger through `app.current_user_id` set LOCAL.', v_owner;
  END IF;

  -- ── 7 · D36's SIX, AND THE ROW IS READ BACK ─────────────────────────────
  --
  -- §11's exit check says this in as many words: "proved by a rehearsal
  -- assertion that reads the row BACK rather than by counting changed lines".
  -- A line count cannot tell a GUC that reaches the trigger from one that does
  -- not, and D36 sat open for two packages precisely because the one-line fix
  -- LOOKED like it worked. So every writer below performs its write and then
  -- SELECTs the audit row it caused.
  --
  -- The analyst exists and is a genuine member — a refusal that only proves the
  -- person is unknown proves nothing about the role gate.
  INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
    VALUES (v_project, v_analyst, 'analyst', 'WP41 rehearsal'),
           (v_project, v_editor,  'editor',  'WP41 rehearsal')
    ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = EXCLUDED.project_role;

  -- THE POISON, AND IT IS THE REASON THIS SECTION IS TRUSTWORTHY AT ALL.
  --
  -- `set_config(..., true)` is TRANSACTION-local and this whole file is one
  -- transaction, so `snapshot_dataset` — which sets the GUC in section 6 — left
  -- `app.current_user_id` holding v_owner for everything after it. Asserting
  -- that a later audit row names v_owner therefore proves NOTHING about the RPC
  -- that wrote it: the value was already there. The first draft of section 7 did
  -- exactly that, and the mutation removing `set_config` from
  -- `assert_writer_may_act` left the file GREEN — a test that could not fail,
  -- which is the failure mode this plan exists to end (§16 · WP 3.4 · F).
  --
  -- So every write below is made by v_editor while the GUC holds v_analyst. A
  -- row naming v_editor can only have come from the RPC setting it. The poison
  -- is re-applied before each call because each RPC overwrites it.
  PERFORM set_config('app.current_user_id', v_analyst::text, true);

  -- 7a · the three legacy lane writers, through one RPC ---------------------
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics';

  PERFORM set_config('app.current_user_id', v_analyst::text, true);
  v_res := public.ingest_legacy_upsert_lane(
    v_project, v_editor, 'inbound_logistics',
    jsonb_build_array(
      jsonb_build_object('supplier_id','S9','material_id','M1','lead_time',3,
                         'lead_time_unit','weeks','volume',10,'unit_price',1),
      jsonb_build_object('supplier_id','S9','material_id','M2','lead_time',4,
                         'lead_time_unit','weeks','volume',20,'unit_price',2)));

  IF (v_res ->> 'rows_written')::int <> 2 THEN
    RAISE EXCEPTION 'WP 4.1: the legacy lane RPC wrote % row(s), expected 2 (%).',
      COALESCE(v_res ->> 'rows_written','(null)'), v_res;
  END IF;

  -- ONE audit row for the whole statement, not one per row. WP 2.3 chose the
  -- statement grain because an audit log nobody can read is no audit log, and
  -- the PostgREST loop this replaces defeated it one batch at a time.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics';
  IF v_n - v_before <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: upserting 2 lane rows wrote % audit row(s); the statement grain says exactly 1.',
      v_n - v_before;
  END IF;

  -- …and THE ROW NAMES THE ACTOR. `IS NOT DISTINCT FROM` because
  -- `actor_user_id` is nullable and `NULL <> x` is NULL, which an IF reads as
  -- false — the bug WP 3.4's mutation run found in an assertion rather than in
  -- code.
  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'inbound_logistics'
     AND a.actor_user_id IS NOT DISTINCT FROM v_editor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false)
     AND (a.after ->> 'rows_after')::int = 2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: the lane upsert''s audit row does not name % as its actor. The RPC takes '
      'the actor as a parameter and must set `app.current_user_id` LOCAL before the write; '
      'a PostgREST call cannot, which is the whole of D36. The GUC held % when the call was '
      'made, so a row naming that user is the RPC NOT setting it.', v_editor, v_analyst;
  END IF;

  -- THE RPC AUTHENTICATES AND DOES NOT AUTHORIZE, and this assertion pins that
  -- as a DECISION rather than leaving it as an absence somebody later reads as
  -- an oversight (`20260917000005`).
  --
  -- An earlier draft refused below project role `editor` here. It came out: an
  -- ORGANIZATION admin who is not a project member resolves to NULL from
  -- `effective_project_role` — `is_super_admin` reads `role = 'super_admin'` —
  -- while `combine-project` has always permitted exactly that user, so the gate
  -- would have silently refused the ETL for a class of caller who can run it
  -- today. §11 asks for no such check, and WP 3.3's precedent on the identical
  -- fix (`assign_material_supplier`) added none.
  --
  -- So an analyst IS accepted here, deliberately, and each caller keeps the
  -- authorization it already had. Making `min_project_role` the one live answer
  -- is D66, and it is WP 6.2's per table. The day somebody adds a gate here,
  -- this assertion fails and points at that decision instead of looking like a
  -- hole they have just closed.
  PERFORM set_config('app.current_user_id', v_owner::text, true);
  v_res := public.ingest_legacy_upsert_lane(
    v_project, v_analyst, 'inbound_logistics',
    jsonb_build_array(jsonb_build_object('supplier_id','S9','material_id','M3','volume',1)));
  IF (v_res ->> 'rows_written')::int <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: the legacy RPC refused an analyst, or wrote % rows instead of 1. The RPC '
      'authenticates and does NOT authorize (`20260917000005`); if a role gate has been '
      'added here, read that migration''s header before keeping it — it refuses an '
      'organization admin on `combine-project`''s live path. (%)',
      COALESCE(v_res ->> 'rows_written','(null)'), v_res;
  END IF;

  -- …and the row it just wrote names the ANALYST, not the owner the GUC held a
  -- line ago. Same poison, same reason.
  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'inbound_logistics'
     AND a.actor_user_id IS NOT DISTINCT FROM v_analyst
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION
      'WP 4.1: the analyst''s lane write wrote no audit row naming %. The GUC held % '
      'when the call was made.', v_analyst, v_owner;
  END IF;

  -- …and it refuses a target outside the whitelist rather than interpolating it
  -- into `format()`. A dynamic INSERT whose table name came from a caller is an
  -- injection with a migration around it.
  BEGIN
    PERFORM public.ingest_legacy_upsert_lane(
      v_project, v_editor, 'approved_users',
      jsonb_build_array(jsonb_build_object('email','x@example.invalid')));
    RAISE EXCEPTION 'WP 4.1: the legacy RPC wrote to a table outside its whitelist.';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- …and a NULL actor is refused outright, which is `audit-actor` as a
  -- constraint rather than as an intention.
  BEGIN
    PERFORM public.ingest_legacy_upsert_lane(
      v_project, NULL, 'inbound_logistics',
      jsonb_build_array(jsonb_build_object('supplier_id','S9','material_id','M4','volume',1)));
    RAISE EXCEPTION 'WP 4.1: a lane write with no actor succeeded.';
  EXCEPTION WHEN null_value_not_allowed THEN
    NULL;
  END;

  -- 7b · `erp-sync-orbit-mrp`'s promotion ------------------------------------
  --
  -- This was a tier-1 → tier-2 promotion that never went through
  -- `ingest_apply_run`: a second promotion path, per-row over PostgREST, with
  -- no actor and no role.
  INSERT INTO public.ingest_runs (id, project_id, source_kind, status, triggered_by)
    VALUES ('00000000-0000-4000-8000-000000041206', v_project, 'api', 'staged', 'schedule');
  INSERT INTO public.ingest_staged_products (ingest_run_id, external_id, sku, name, diff_state, raw, source_kind, fact_class)
    VALUES ('00000000-0000-4000-8000-000000041206', 'EXT-1', 'SKU-1', 'Widget', 'new', '{}'::jsonb, 'api', 'master'),
           ('00000000-0000-4000-8000-000000041206', 'EXT-2', 'SKU-2', 'Gadget', 'new', '{}'::jsonb, 'api', 'master'),
           ('00000000-0000-4000-8000-000000041206', 'EXT-3', 'SKU-3', 'Gone',   'removed_upstream', '{}'::jsonb, 'api', 'master');

  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'products';

  PERFORM set_config('app.current_user_id', v_analyst::text, true);
  v_res := public.mrp_apply_staged_products('00000000-0000-4000-8000-000000041206', v_editor);

  IF (v_res ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION
      'WP 4.1: the MRP promotion wrote % product(s), expected 2 — the third is '
      '`removed_upstream` and an upstream deletion is not a tier-2 write. (%)',
      COALESCE(v_res ->> 'rows_promoted','(null)'), v_res;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'products'
     AND a.actor_user_id IS NOT DISTINCT FROM v_editor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 4.1: the MRP promotion wrote no audit row naming % as its actor.', v_editor;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'products';
  IF v_n - v_before <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: promoting 2 products wrote % audit row(s). The PostgREST loop this '
      'replaces wrote one per row.', v_n - v_before;
  END IF;

  SELECT status INTO v_txt FROM public.ingest_runs
   WHERE id = '00000000-0000-4000-8000-000000041206';
  IF v_txt IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'WP 4.1: the MRP run is "%" after a successful promotion, expected applied.',
      COALESCE(v_txt, '(null)');
  END IF;

  -- 7c · `combine-project`'s ETL write, and it is ATOMIC now -----------------
  INSERT INTO public.supply_chain_data (project_id, plant_name, data_source, from_location, to_location, weighted)
    VALUES (v_project, 'WP41P', 'inbound', 'STALE', 'M1', 1);

  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'supply_chain_data';

  PERFORM set_config('app.current_user_id', v_analyst::text, true);
  v_res := public.etl_replace_supply_chain(
    v_project, v_editor,
    jsonb_build_array(
      jsonb_build_object('plant_name','WP41P','data_source','inbound',
                         'from_location','S1','to_location','M1','weighted',10),
      jsonb_build_object('plant_name','WP41P','data_source','inbound',
                         'from_location','S2','to_location','M1','weighted',20)),
    jsonb_build_array(
      jsonb_build_object('plant_name','WP41P','data_source','multi_tier',
                         'from_location','S2','to_location','S1','level',2,'weighted',5,
                         'organization','WP41 Org')));

  IF (v_res ->> 'deleted')::int <> 1 OR (v_res ->> 'inserted')::int <> 2
     OR (v_res ->> 'multi_tier_inserted')::int <> 1 THEN
    RAISE EXCEPTION 'WP 4.1: the ETL replace reported %, expected 1 deleted / 2 inserted / 1 multi-tier.', v_res;
  END IF;

  SELECT count(*) INTO v_n FROM public.supply_chain_data
   WHERE project_id = v_project AND from_location = 'STALE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 4.1: the ETL replace left % stale row(s) behind.', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'supply_chain_data'
     AND a.actor_user_id IS NOT DISTINCT FROM v_editor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 2 THEN
    RAISE EXCEPTION
      'WP 4.1: the ETL replace wrote % attributed audit row(s) on `supply_chain_data`; '
      'the delete and the insert are both tier transitions and both must name %.',
      v_n, v_editor;
  END IF;

  -- 7d · `predict-critical-nodes`'s scores -----------------------------------
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'supply_chain_data';

  SELECT jsonb_agg(jsonb_build_object('id', d.id, 'is_critical', true, 'score', 0.9))
    INTO v_scores
    FROM public.supply_chain_data d WHERE d.project_id = v_project;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);
  v_res := public.analysis_mark_critical_nodes(v_editor, v_scores);
  IF (v_res ->> 'rows_updated')::int <> 2 THEN
    RAISE EXCEPTION 'WP 4.1: the critical-node write updated % row(s), expected 2 (%).',
      COALESCE(v_res ->> 'rows_updated','(null)'), v_res;
  END IF;

  -- ONE statement for N predictions. The loop this replaces wrote one audit row
  -- PER PREDICTION — ~1 800 on the largest project in this database, for one
  -- analysis.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'supply_chain_data';
  IF v_n - v_before <> 1 THEN
    RAISE EXCEPTION
      'WP 4.1: scoring 2 rows wrote % audit row(s); one statement is one row.', v_n - v_before;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'supply_chain_data'
     AND a.action = 'update'
     AND a.actor_user_id IS NOT DISTINCT FROM v_editor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 4.1: the critical-node write wrote no audit row naming % as its actor.', v_editor;
  END IF;

  -- …and it refuses a score set spanning two projects rather than writing half
  -- of it under one project's authority.
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES ('00000000-0000-4000-8000-000000041207', 'WP41 other', v_owner, 'WP41Q');
  INSERT INTO public.supply_chain_data (id, project_id, plant_name, data_source, from_location, to_location, weighted)
    VALUES ('00000000-0000-4000-8000-000000041208',
            '00000000-0000-4000-8000-000000041207', 'WP41Q', 'inbound', 'X', 'Y', 1);
  BEGIN
    PERFORM public.analysis_mark_critical_nodes(
      v_editor,
      v_scores || jsonb_build_array(jsonb_build_object(
        'id','00000000-0000-4000-8000-000000041208','is_critical',false,'score',0.1)));
    RAISE EXCEPTION 'WP 4.1: a cross-project score set was accepted.';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  RAISE NOTICE 'WP 4.1 §1-7 OK — the anchor covers what its readers read, and every D36 path names its actor.';
END
$wp41$;
