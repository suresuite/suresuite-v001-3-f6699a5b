-- WP 6.3 · THE DUAL READ, AND IT SAYS WHICH HALF ANSWERED.
--
-- §4 D88 blocked WP 5.3's drop: 1 385 `network_nodes` rows predate provenance and
-- can never be backfilled, because inventing a `computed_from_hash` is the
-- fabricated provenance `declared-fallback` (I6) forbids. So the entity columns
-- stay, the store fills up as projects are re-run, and a reader gets an answer from
-- whichever half has one — WHICH MEANS A READER MUST BE TOLD WHICH.
--
-- WHAT ONLY A DATABASE CAN SAY HERE. Every claim is about what one SELECT returns
-- for rows in three different states at once, which is the state production is
-- actually in:
--
--   1. the store preferred over a column that also has a value, and the numbers
--      being the STORE's rather than the mirror's;
--   2. the column standing in where the store has no row for that node, reported
--      as `column` and not silently as `store`;
--   3. neither half having a number — `none`, which is not zero (§4 D17);
--   4. a store row whose metrics are all null STILL reporting `store`, because the
--      run answered and a legacy provenance would be a lie about a reproducible
--      result;
--   5. `hash_is_current` being three-valued: true, false, and NULL for a row with
--      no hash to compare — unknown is not stale (D70);
--   6. the grants surviving a DROP and CREATE, checked as EXPLICIT grantees.

DO $wp63dr$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000063300';
  v_project uuid := '00000000-0000-4000-8000-000000063301';
  v_org     uuid;
  v_run     uuid;
  v_hash    text;
  v_row     record;
  v_n       integer;
BEGIN
  INSERT INTO public.organizations (name, slug)
    VALUES ('WP63 DualRead', 'wp63-dualread') RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp63dr@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization_id)
    VALUES (v_user, 'wp63dr@example.invalid', 'WP63 dual read', 'x', v_org);
  PERFORM set_config('app.current_user_id', v_user::text, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization_id)
    VALUES (v_project, 'WP63 dual read', v_user, 'WP63D', v_org);

  -- FIVE NODES, one for each state the read has to distinguish. They are material
  -- nodes because the RPC's predicate is "an end of a `bom`-sourced arc", which
  -- this package deliberately did not redefine.
  --
  -- THE FIRST FIXTURE COULD NOT TEST PREFERENCE, and the rehearsal said so on its
  -- second run. It gave one node a column value and then a DIFFERENT store value —
  -- but `analysis_apply_node_metrics` is the dual WRITE, so it stamped the mirror
  -- with the store's number and the two agreed. A fixture where both halves hold
  -- the same value cannot tell which one answered.
  --
  -- So `N-DIVERGED` has its mirror overwritten AFTER the run, which is not a
  -- contrivance: it is what a direct write to the entity table looks like, and
  -- `geocode-locations` does exactly that today with no run at all (D36's class).
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue)
    VALUES (v_project, 'WP63D', 'N-STORE',    'Both agree',        100),
           (v_project, 'WP63D', 'N-DIVERGED', 'Mirror overwritten', 200),
           (v_project, 'WP63D', 'N-LEGACY',   'Column only',       300),
           (v_project, 'WP63D', 'N-NONE',     'Nothing known',     400),
           (v_project, 'WP63D', 'N-EMPTY',    'Store, no metrics', 500);
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, from_location, to_location, data_source)
    VALUES (v_project, 'WP63D', 'N-STORE',  'N-DIVERGED', 'bom'),
           (v_project, 'WP63D', 'N-LEGACY', 'N-NONE',     'bom'),
           (v_project, 'WP63D', 'N-EMPTY',  'N-STORE',    'bom');

  -- ── THE LEGACY HALF: mirror values with NO hash, which is what 1 385 rows look
  -- like. Written directly because that is how they got there — before any run
  -- existed to write them. `N-LEGACY` is never named in the run below.
  UPDATE public.network_nodes
     SET degree_centrality = 0.11, betweenness_centrality = 0.12, prominence = 0.13
   WHERE project_id = v_project AND uid = 'N-LEGACY';

  -- ── THE STORE HALF: a real run, succeeded, with results.
  v_run := (public.analysis_get_or_start(
              v_project, 'network_metrics',
              jsonb_build_object('weighted', true),
              'network_metrics@wp43.1', v_user) ->> 'run_id')::uuid;
  SELECT input_hash INTO v_hash FROM public.analysis_runs WHERE id = v_run;

  PERFORM public.analysis_apply_node_metrics(
    v_run,
    jsonb_build_array(
      jsonb_build_object('uid', 'N-STORE', 'degree_centrality', 0.91,
                         'betweenness_centrality', 0.92, 'prominence', 0.93),
      jsonb_build_object('uid', 'N-DIVERGED', 'degree_centrality', 0.81)),
    v_user);

  PERFORM public.analysis_complete_run(
    v_run,
    jsonb_build_array(
      jsonb_build_object('entity_type', 'node', 'entity_id', 'N-STORE',
        'metrics', jsonb_build_object('degree_centrality', 0.91,
                                      'betweenness_centrality', 0.92,
                                      'prominence', 0.93)),
      -- ONLY `degree_centrality`, so section 1 can prove the preference is per
      -- METRIC: the other two must still come from the mirror.
      jsonb_build_object('entity_type', 'node', 'entity_id', 'N-DIVERGED',
        'metrics', jsonb_build_object('degree_centrality', 0.81)),
      -- A store row with NO metrics at all — section 4's subject.
      jsonb_build_object('entity_type', 'node', 'entity_id', 'N-EMPTY',
        'metrics', '{}'::jsonb)),
    jsonb_build_object('nodes', 2),
    '[]'::jsonb,
    v_user);

  -- AFTER the run: the mirror is overwritten, so the two halves disagree. Without
  -- this the dual write has made them equal and no assertion below can tell which
  -- one the read returned.
  UPDATE public.network_nodes
     SET degree_centrality = 0.11, betweenness_centrality = 0.12, prominence = 0.13
   WHERE project_id = v_project AND uid = 'N-DIVERGED';

  -- ── 1 · THE STORE IS PREFERRED, AND THE NUMBER PROVES IT ──────────────────
  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-DIVERGED';
  IF v_row.metrics_source <> 'store' THEN
    RAISE EXCEPTION 'WP 6.3: N-DIVERGED has a store row and reported source=%, expected store',
      v_row.metrics_source;
  END IF;
  IF round(v_row.degree_centrality, 4) <> 0.81 THEN
    RAISE EXCEPTION
      'WP 6.3: N-DIVERGED returned degree_centrality %, expected the STORE''s 0.81 '
      'and not the mirror''s 0.11 — the preference is the wrong way round', v_row.degree_centrality;
  END IF;
  -- PER METRIC, NOT PER ROW. The store row carries only `degree_centrality`;
  -- `betweenness` and `prominence` must still come from the mirror, because the two
  -- analyzers write different subsets and a row-level preference would blank
  -- whatever the newer run did not compute.
  IF round(v_row.betweenness_centrality, 4) <> 0.12 THEN
    RAISE EXCEPTION
      'WP 6.3: N-DIVERGED''s betweenness came back % — the store row does not carry '
      'it, so the mirror must. A row-level preference blanks it.', v_row.betweenness_centrality;
  END IF;
  IF round(v_row.prominence, 4) <> 0.13 THEN
    RAISE EXCEPTION 'WP 6.3: N-DIVERGED''s prominence came back %, expected the mirror''s 0.13', v_row.prominence;
  END IF;
  IF v_row.run_id IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'WP 6.3: a store answer names run %, expected %', v_row.run_id, v_run;
  END IF;
  IF v_row.computed_from_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'WP 6.3: a store answer carries hash %, expected the run''s %',
      v_row.computed_from_hash, v_hash;
  END IF;

  -- ── 2 · THE COLUMN STANDS IN, AND SAYS SO ─────────────────────────────────
  --
  -- `N-LEGACY` was never named in the run, so it has mirror values and no store
  -- row — the shape every project that has not been re-run is entirely made of.
  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-LEGACY';
  IF v_row.metrics_source <> 'column' THEN
    RAISE EXCEPTION
      'WP 6.3: N-LEGACY has no store row and reported source=%, expected column. '
      'Reporting a legacy mirror value as `store` is the lie this package exists '
      'to prevent.', v_row.metrics_source;
  END IF;
  IF round(v_row.degree_centrality, 4) <> 0.11 THEN
    RAISE EXCEPTION 'WP 6.3: with no store row, N-LEGACY returned %, expected the mirror''s 0.11',
      v_row.degree_centrality;
  END IF;
  IF v_row.run_id IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.3: a COLUMN answer names run %, and it must name none — a legacy value '
      'attributed to a run is provenance that was invented (I6)', v_row.run_id;
  END IF;
  -- These rows have NO hash, and that is the point of D88: it cannot be invented.
  IF v_row.computed_from_hash IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.3: a legacy column answer carries hash %, and it has none', v_row.computed_from_hash;
  END IF;
  IF v_row.hash_is_current IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.3: hash_is_current is % for a row with no hash; it must be NULL. '
      'Unknown is not stale (D70), and `false` here would report every legacy row '
      'as out of date.', v_row.hash_is_current;
  END IF;

  -- ── 3 · NEITHER HALF: `none`, WHICH IS NOT ZERO ───────────────────────────
  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-NONE';
  IF v_row.metrics_source <> 'none' THEN
    RAISE EXCEPTION 'WP 6.3: N-NONE has no value anywhere and reported source=%, expected none',
      v_row.metrics_source;
  END IF;
  IF v_row.degree_centrality IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.3: N-NONE returned degree_centrality % — an absent metric must stay '
      'NULL. §4 D17 is this exact substitution in the other direction: sixty '
      'suppliers'' null capacity rendered as 0.', v_row.degree_centrality;
  END IF;

  -- ── 4 · A STORE ROW WITH NO METRICS IS STILL THE STORE ANSWERING ──────────
  --
  -- The tempting implementation reports `store` only when a COALESCE took the
  -- left branch. That would call N-EMPTY a column read, attributing a legacy
  -- provenance to a row a reproducible run wrote — the inverse of section 2's
  -- defect and just as wrong.
  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-EMPTY';
  IF v_row.metrics_source <> 'store' THEN
    RAISE EXCEPTION
      'WP 6.3: N-EMPTY has a store row with no metrics and reported source=%, '
      'expected store. The run answered; the answer was "nothing".', v_row.metrics_source;
  END IF;
  IF v_row.degree_centrality IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.3: N-EMPTY''s store row carries no metrics and the read returned %',
      v_row.degree_centrality;
  END IF;
  IF v_row.run_id IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'WP 6.3: N-EMPTY is a store answer and names run %', v_row.run_id;
  END IF;

  -- ── 5 · `hash_is_current` IS THREE-VALUED ─────────────────────────────────
  --
  -- The run's `input_hash` is the project's hash at the moment it started, so a
  -- store answer is CURRENT until the dataset moves. Moving it must flip the flag
  -- to false — not to NULL, which would lose the distinction between "stale" and
  -- "we cannot tell".
  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-STORE';
  IF v_row.hash_is_current IS NOT TRUE THEN
    RAISE EXCEPTION
      'WP 6.3: a store answer taken against the current dataset reports '
      'hash_is_current=%, expected true (run hash %, project hash %)',
      v_row.hash_is_current, v_hash, public.current_graph_hash(v_project);
  END IF;

  -- Move the dataset. One inbound arc is enough: `current_graph_hash` covers
  -- eleven tier-2 tables and this is one of them.
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, volume, time_unit)
    VALUES (v_project, 'WP63D', 'SUP-NEW', 'MAT-NEW', 5, 'week');

  SELECT * INTO v_row FROM public.get_network_metrics_for_materials(
    v_project, v_user, 'wp63dr@example.invalid') WHERE uid = 'N-STORE';
  IF v_row.hash_is_current IS NOT FALSE THEN
    RAISE EXCEPTION
      'WP 6.3: the dataset moved and a store answer still reports '
      'hash_is_current=%, expected false. A stale number that does not say so is '
      'the whole of what this column is for.', v_row.hash_is_current;
  END IF;
  -- And it still returns the NUMBER. Staleness is reported, not withheld: a screen
  -- that blanked the cell would lose the only figure the user has.
  IF round(v_row.degree_centrality, 4) <> 0.91 THEN
    RAISE EXCEPTION 'WP 6.3: a stale store answer stopped returning its value (%)', v_row.degree_centrality;
  END IF;

  -- ── 6 · THE GRANTS SURVIVED THE DROP AND CREATE ───────────────────────────
  --
  -- The signature changed, so this was a DROP and a CREATE, and a DROP takes the
  -- function's grants with it. Checked as EXPLICIT grantees in `proacl` rather
  -- than with `has_function_privilege`, which cannot fail while PUBLIC holds
  -- EXECUTE — the reason `rehearsal/210` §2 was rewritten.
  FOR v_row IN
    SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid = 'public.get_network_metrics_for_materials(uuid,uuid,text)'::regprocedure
       AND r.rolname = v_row.role
       AND a.privilege_type = 'EXECUTE';
    IF v_n < 1 THEN
      RAISE EXCEPTION
        'WP 6.3: % is not an EXPLICIT grantee of get_network_metrics_for_materials '
        'after the DROP and CREATE — the grants did not come back', v_row.role;
    END IF;
  END LOOP;

  -- And `analysis_latest_run` prefers a SUCCEEDED run — the token this schema's
  -- CHECK actually uses (`running | succeeded | failed`). The first draft of the
  -- migration filtered on `completed`, which is a reasonable word and not this
  -- one's: the lookup found nothing and every node came back as a column answer.
  -- Section 1 caught it, which is why the fixture gives N-COLUMN a store value
  -- that DIFFERS from its column value.
  IF public.analysis_latest_run(v_project, 'network_metrics') IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION 'WP 6.3: analysis_latest_run returned %, expected the succeeded run %',
      public.analysis_latest_run(v_project, 'network_metrics'), v_run;
  END IF;
  IF public.analysis_latest_run(v_project, 'prominence') IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.3: analysis_latest_run found a `prominence` run and none was created. '
      'NULL is a legitimate answer and is why the read has a second half.';
  END IF;

  RAISE NOTICE 'WP 6.3 · 250: the dual read prefers the store per metric and names the half that answered — 6 section(s)';
END $wp63dr$;
