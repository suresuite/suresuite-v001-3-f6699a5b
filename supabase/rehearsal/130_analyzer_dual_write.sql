-- WP 4.3 · THE ANALYZERS DUAL-WRITE, AND EVERY DERIVED ROW NAMES THE WORLD IT
-- CAME FROM.
--
-- §11's WP 4.3 is three sentences and each one is a claim about what the
-- DATABASE does:
--
--     "Each writes BOTH destinations and gains a `code_version`."
--     "Add `computed_from_hash` + `computed_at` to every T3 table."
--     "Do not drop any entity column here."
--
-- SECTION 1 IS THE RED ONE AND IT IS NOT ABOUT THE DUAL-WRITE. It asserts the
-- finding this package was built on: that `current_graph_hash` CANNOT SEE the
-- inputs the two centrality analyzers read. Change the graph — add an edge, move
-- a revenue — and the anchor does not move. On a branch where the analyzers key
-- their cache on that hash alone, a re-uploaded network serves the PREVIOUS
-- graph's centralities and reports a hit. §1 fails on a database where
-- `network_topology_hash` does not exist, which is every commit before this one.
--
-- EVERY NULLABLE COMPARISON IS `IS DISTINCT FROM` (WP 3.4's lesson: `NULL <> x`
-- is NULL, which an IF reads as false, so the assertion can never fail).
--
-- AND THE GUC IS POISONED BEFORE EVERY CALL THAT CLAIMS TO SET IT (WP 4.1 · E:
-- a section passed because an earlier one had left the right user in
-- `app.current_user_id`, so deleting `set_config` outright stayed green).

DO $wp43$
DECLARE
  v_owner    uuid := '00000000-0000-4000-8000-000000043300';
  v_editor   uuid := '00000000-0000-4000-8000-000000043301';
  v_analyst  uuid := '00000000-0000-4000-8000-000000043302';
  v_project  uuid := '00000000-0000-4000-8000-000000043303';
  v_other    uuid := '00000000-0000-4000-8000-000000043304';
  v_graph0   text;
  v_graph1   text;
  v_topo0    text;
  v_topo1    text;
  v_topo2    text;
  v_r        jsonb;
  v_r2       jsonb;
  v_run      uuid;
  v_run2     uuid;
  v_other_run uuid;
  v_res      jsonb;
  v_n        integer;
  v_actor    uuid;
  v_hash     text;
  v_prom     numeric;
  v_deg      numeric;
  v_scd      uuid;
  v_ok       boolean;
  v_before   bigint;
  v_org      uuid := '00000000-0000-4000-8000-000000043305';
BEGIN
  -- ── 0 · a project with BOTH a tier-2 dataset and a deep-tier graph ───────
  --
  -- Both halves are required and the pairing is the point: `current_graph_hash`
  -- reads the first, the centrality analyzers read the second, and §1 is the
  -- assertion that those are different worlds.

  IF to_regclass('public.analysis_runs') IS NULL THEN
    RAISE EXCEPTION 'WP 4.3 §0 — WP 4.2''s store is absent; nothing below can run.';
  END IF;

  -- An organization on both sides, because §10 exercises a legacy bulk RPC whose
  -- own authorization is `org_is_current_user_org(...) AND (modeler OR admin)`.
  -- The predicate is uuid-only since WP 3.0 (D29), so a fixture that sets only
  -- the display string is refused — correctly.
  INSERT INTO public.organizations (id, name, slug)
    VALUES (v_org, 'WP43 Org', 'wp43-org');

  INSERT INTO auth.users (id, email) VALUES
    (v_owner,   'wp43owner@example.invalid'),
    (v_editor,  'wp43editor@example.invalid'),
    (v_analyst, 'wp43analyst@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_owner,   'wp43owner@example.invalid',   'WP43 owner',   'x', 'WP43 Org', v_org),
    (v_editor,  'wp43editor@example.invalid',  'WP43 editor',  'x', 'WP43 Org', v_org),
    (v_analyst, 'wp43analyst@example.invalid', 'WP43 analyst', 'x', 'WP43 Org', v_org);

  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP43 dual write', v_owner, 'WP43P', 'WP43 Org', v_org),
           (v_other,   'WP43 other',      v_owner, 'WP43O', 'WP43 Org', v_org);

  -- Tier 2 — what `current_graph_hash` can see.
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_project, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_project, 'M1', 10);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    VALUES (v_project, 'WP43P', 'S1', 'M1', 7, 'days', 100, 10);

  -- Deep tier — what the centrality analyzers actually read.
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue, depth)
    VALUES (v_project, 'WP43P', 'N1', 'Node one',   100, 0),
           (v_project, 'WP43P', 'N2', 'Node two',    50, 1),
           (v_project, 'WP43P', 'N3', 'Node three',  25, 2);
  INSERT INTO public.network_edges (project_id, plant_name, src_uid, dst_uid, relative_revenue, depth)
    VALUES (v_project, 'WP43P', 'N1', 'N2', 0.5, 1),
           (v_project, 'WP43P', 'N2', 'N3', 0.25, 2);

  v_graph0 := public.current_graph_hash(v_project);
  IF v_graph0 IS NULL THEN
    RAISE EXCEPTION 'WP 4.3 §0 — the project has no graph hash; nothing below keys on anything.';
  END IF;

  -- ── 1 · THE ANCHOR SEES THE TOPOLOGY (D75 closed by WP 5.3) ────────────
  --
  -- THIS SECTION USED TO ASSERT THE OPPOSITE, and it is worth saying why rather
  -- than quietly editing it. WP 4.3 wrote it as the RED assertion for D75: that
  -- `current_graph_hash` does NOT move when `network_edges` changes, so the two
  -- centrality analyzers keyed their cache on an anchor blind to their own
  -- inputs. Its failure message named the way out —
  --
  --     "That is a better world than the one this package was written for, and
  --      it means the topology is already in the anchor: delete the params-borne
  --      digest and key on the hash directly."
  --
  -- — and `20260917000009` made that world, so the assertion fired exactly as
  -- designed and is now inverted. What it tests is unchanged in substance: the
  -- anchor must distinguish two different graphs, and must NOT move for an edit
  -- no analysis reads.

  v_topo0 := public.network_topology_hash(v_project);

  -- half one: change the graph. The ANCHOR moves now, not just the digest.
  UPDATE public.network_edges SET relative_revenue = 0.9
   WHERE project_id = v_project AND src_uid = 'N1' AND dst_uid = 'N2';

  v_graph1 := public.current_graph_hash(v_project);
  v_topo1  := public.network_topology_hash(v_project);

  IF v_graph1 IS NOT DISTINCT FROM v_graph0 THEN
    RAISE EXCEPTION
      'WP 5.3 §1 — `current_graph_hash` did NOT move when an edge weight changed, '
      'so the anchor is blind to the inputs the two centrality analyzers read and '
      'D75 is open again. A re-uploaded network is served the previous graph''s '
      'centralities as a cache hit.';
  END IF;
  IF v_topo1 IS NOT DISTINCT FROM v_topo0 THEN
    RAISE EXCEPTION
      'WP 4.3 §1 — the topology digest did NOT move when an edge weight changed. '
      'It is deprecated but still live for the deploy window, and a deprecated '
      'function that has silently stopped working is worse than a deleted one.';
  END IF;

  -- half two: put it back. A hash that only ever changes is a version counter.
  UPDATE public.network_edges SET relative_revenue = 0.5
   WHERE project_id = v_project AND src_uid = 'N1' AND dst_uid = 'N2';

  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_graph0 THEN
    RAISE EXCEPTION
      'WP 5.3 §1 — reverting the edge did not restore the anchor. The hash is '
      'order-dependent or time-dependent, which makes every repeat request a miss '
      'and every analysis a full recomputation.';
  END IF;
  v_topo2 := public.network_topology_hash(v_project);
  IF v_topo2 IS DISTINCT FROM v_topo0 THEN
    RAISE EXCEPTION
      'WP 4.3 §1 — reverting the edge did not restore the digest (% then %).',
      v_topo0, v_topo2;
  END IF;

  -- AND IT MUST STAY NARROWER THAN THE TABLE. `country` is an uploaded column on
  -- `network_nodes`; no analyzer reads it and the engine never sees it. Folding
  -- the topology in was a chance to hash the whole table by accident, which
  -- would make every unrelated edit cost a full recomputation of every
  -- centrality in the project.
  UPDATE public.network_nodes SET country = 'Narnia'
   WHERE project_id = v_project AND uid = 'N1';
  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_graph0 THEN
    RAISE EXCEPTION
      'WP 5.3 §1 — the ANCHOR moved when `country` changed, and no analyzer reads '
      '`country`. The fold took the whole table instead of the six columns the '
      'prominence RPCs return, so every unrelated edit now invalidates every '
      'centrality in the project.';
  END IF;
  IF public.network_topology_hash(v_project) IS DISTINCT FROM v_topo0 THEN
    RAISE EXCEPTION 'WP 4.3 §1 — the digest moved when `country` changed.';
  END IF;

  -- ── 2 · the dual-write · both destinations, one run, one hash ───────────

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r := public.analysis_get_or_start(
           v_project, 'network_metrics',
           jsonb_build_object('weighted', true, 'topology_digest', v_topo0),
           'nm@wp43', v_editor);
  v_run := (v_r ->> 'run_id')::uuid;

  IF (v_r ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WP 4.3 §2 — a cold key reported a hit.';
  END IF;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_res := public.analysis_apply_node_metrics(
             v_run,
             '[{"uid":"N1","prominence":0.90,"degree_centrality":0.66,
                "weighted_degree_centrality":0.50,"eigenvector_centrality":0.71,
                "betweenness_centrality":0.00,"closeness_centrality":0.50},
               {"uid":"N2","prominence":0.55,"degree_centrality":1.00,
                "weighted_degree_centrality":0.75,"eigenvector_centrality":0.63,
                "betweenness_centrality":1.00,"closeness_centrality":0.66}]'::jsonb,
             v_editor);

  IF (v_res ->> 'rows_updated')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 4.3 §2 — the entity mirror updated % rows, expected 2.',
      v_res ->> 'rows_updated';
  END IF;

  PERFORM public.analysis_complete_run(
    v_run,
    '[{"entity_type":"node","entity_id":"N1","metrics":{"prominence":0.90,"degree_centrality":0.66,"weighted_degree_centrality":0.50,"eigenvector_centrality":0.71,"betweenness_centrality":0.00,"closeness_centrality":0.50}},
      {"entity_type":"node","entity_id":"N2","metrics":{"prominence":0.55,"degree_centrality":1.00,"weighted_degree_centrality":0.75,"eigenvector_centrality":0.63,"betweenness_centrality":1.00,"closeness_centrality":0.66}}]'::jsonb,
    '{"nodes": 2}'::jsonb, '[]'::jsonb, v_editor);

  -- THE GAP CHECK, IN SQL. §11 asks for a field-by-field numeric comparison of
  -- the old columns against `analysis_results` on a real project. Doing it here
  -- rather than by hand is what makes it repeatable: a later change that writes
  -- one destination and not the other fails on the commit that makes them
  -- disagree, instead of being noticed in WP 5.3 when the columns are dropped.
  SELECT count(*) INTO v_n
    FROM public.analysis_results r
    JOIN public.network_nodes n
      ON n.project_id = v_project AND n.uid = r.entity_id
   WHERE r.run_id = v_run AND r.entity_type = 'node'
     AND (  n.prominence                 IS DISTINCT FROM (r.metrics ->> 'prominence')::numeric
         OR n.degree_centrality          IS DISTINCT FROM (r.metrics ->> 'degree_centrality')::numeric
         OR n.weighted_degree_centrality IS DISTINCT FROM (r.metrics ->> 'weighted_degree_centrality')::numeric
         OR n.eigenvector_centrality     IS DISTINCT FROM (r.metrics ->> 'eigenvector_centrality')::numeric
         OR n.betweenness_centrality     IS DISTINCT FROM (r.metrics ->> 'betweenness_centrality')::numeric
         OR n.closeness_centrality       IS DISTINCT FROM (r.metrics ->> 'closeness_centrality')::numeric);
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 4.3 §2 — THE TWO DESTINATIONS DISAGREE on % node(s). The entity columns '
      'and `analysis_results` were written by the same run and hold different '
      'numbers, so WP 5.3 would drop the columns and change what the product '
      'reports. That is the one failure a dual-write exists to catch.', v_n;
  END IF;

  -- and the mirror must have COVERED every result row, not merely agreed with
  -- the ones it happened to write. A join proves agreement; a count proves
  -- reach.
  SELECT count(*) INTO v_n FROM public.analysis_results WHERE run_id = v_run;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 4.3 §2 — the run stored % result rows, expected 2.', v_n;
  END IF;

  -- ── 3 · I5 · the derived row carries the hash it came from ──────────────

  SELECT computed_from_hash, computed_at IS NOT NULL
    INTO v_hash, v_ok
    FROM public.network_nodes WHERE project_id = v_project AND uid = 'N1';

  IF v_hash IS DISTINCT FROM (v_r ->> 'input_hash') THEN
    RAISE EXCEPTION
      'WP 4.3 §3 — the node carries computed_from_hash % and the run ran against '
      '%. `input-hash` (I5) says a derived row names the world it came from, and '
      'a row naming a DIFFERENT world is worse than one naming none.',
      COALESCE(v_hash, '<null>'), v_r ->> 'input_hash';
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'WP 4.3 §3 — computed_at was not stamped.';
  END IF;

  -- The third node was not in the metrics array and must be untouched — a
  -- statement that stamps provenance onto rows it did not compute is claiming
  -- the run produced values it never saw.
  SELECT computed_from_hash INTO v_hash
    FROM public.network_nodes WHERE project_id = v_project AND uid = 'N3';
  IF v_hash IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 4.3 §3 — node N3 was not in the metrics array and was stamped with % '
      'anyway.', v_hash;
  END IF;

  -- ── 4 · a partial analysis does not blank what another run computed ─────
  --
  -- `calculate-node-prominence` computes `prominence` and nothing else. If its
  -- write nulls the five centralities, the two live analyzers destroy each
  -- other's output and the product shows blanks after whichever ran last.

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'prominence',
            jsonb_build_object('topology_digest', v_topo0),
            'prom@wp43', v_editor);
  v_run2 := (v_r2 ->> 'run_id')::uuid;

  PERFORM public.analysis_apply_node_metrics(
    v_run2, '[{"uid":"N1","prominence":0.42}]'::jsonb, v_editor);

  SELECT prominence, degree_centrality INTO v_prom, v_deg
    FROM public.network_nodes WHERE project_id = v_project AND uid = 'N1';

  IF v_prom IS DISTINCT FROM 0.42 THEN
    RAISE EXCEPTION 'WP 4.3 §4 — the prominence-only write stored % not 0.42.', v_prom;
  END IF;
  IF v_deg IS DISTINCT FROM 0.66 THEN
    RAISE EXCEPTION
      'WP 4.3 §4 — a prominence-only run BLANKED `degree_centrality` (now %). The '
      'two live analyzers write the same table and would destroy each other''s '
      'output on every alternating run.', COALESCE(v_deg::text, '<null>');
  END IF;

  PERFORM public.analysis_complete_run(
    v_run2, '[{"entity_type":"node","entity_id":"N1","metrics":{"prominence":0.42}}]'::jsonb,
    '{"nodes": 1}'::jsonb, '[]'::jsonb, v_editor);

  -- ── 5 · the mirror cannot be written after the run is frozen ────────────

  BEGIN
    PERFORM public.analysis_apply_node_metrics(
      v_run2, '[{"uid":"N2","prominence":0.11}]'::jsonb, v_editor);
    RAISE EXCEPTION
      'WP 4.3 §5 — the entity mirror accepted a write against a SUCCEEDED run. A '
      'finished run''s answer is frozen (WP 4.2); letting the mirror move '
      'afterwards lets the two halves drift with the run still claiming both.';
  EXCEPTION WHEN sqlstate 'P0A01' THEN
    NULL;  -- refused, which is the assertion
  END;

  -- ── 6 · a run may not stamp another project's rows ──────────────────────

  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_other, 'S9');
  INSERT INTO public.supply_chain_data (project_id, plant_name, from_location, to_location)
    VALUES (v_other, 'WP43O', 'A', 'B') RETURNING id INTO v_scd;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  BEGIN
    PERFORM public.analysis_mark_critical_nodes(
      v_editor,
      jsonb_build_array(jsonb_build_object('id', v_scd, 'is_critical', true, 'score', 0.9)),
      v_run);   -- v_run belongs to v_project, the row to v_other
    RAISE EXCEPTION
      'WP 4.3 §6 — a run from project % stamped a row from project %. A '
      'provenance column that can be confidently wrong is worse than one that is '
      'absent.', v_project, v_other;
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;  -- invalid_parameter_value, which is the assertion
  END;

  -- and the in-project call stamps correctly.
  INSERT INTO public.supply_chain_data (project_id, plant_name, from_location, to_location)
    VALUES (v_project, 'WP43P', 'N1', 'N2') RETURNING id INTO v_scd;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_res := public.analysis_mark_critical_nodes(
             v_editor,
             jsonb_build_array(jsonb_build_object('id', v_scd, 'is_critical', true, 'score', 0.9)),
             v_run);

  SELECT computed_from_hash INTO v_hash FROM public.supply_chain_data WHERE id = v_scd;
  IF v_hash IS DISTINCT FROM (v_r ->> 'input_hash') THEN
    RAISE EXCEPTION
      'WP 4.3 §6 — the scored row carries % and the run ran against %.',
      COALESCE(v_hash, '<null>'), v_r ->> 'input_hash';
  END IF;

  -- the two-argument form still works — it has to, across the deploy window —
  -- and records NULL provenance rather than inventing one.
  UPDATE public.supply_chain_data SET computed_from_hash = NULL WHERE id = v_scd;
  PERFORM public.analysis_mark_critical_nodes(
    v_editor,
    jsonb_build_array(jsonb_build_object('id', v_scd, 'is_critical', false, 'score', 0.1)));
  SELECT computed_from_hash INTO v_hash FROM public.supply_chain_data WHERE id = v_scd;
  IF v_hash IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 4.3 §6 — the deprecated two-argument form invented a provenance hash '
      '(%). It cannot know one; NULL is the honest record.', v_hash;
  END IF;

  -- ── 7 · G4 · the audit row names the person, on tables that had no trigger ─
  --
  -- `network_nodes` had NO audit triggers before this package — it was deferred
  -- in `coverage.yaml`, and `dataPlaneAudit.test.ts` scopes the rule to tables
  -- in the contract, so its writes were unaudited with nothing to notice (D54).
  -- The GUC is poisoned with the analyst immediately before the call, so a row
  -- naming the editor can only have come from inside the RPC.

  -- CLEARED rather than counted-before-and-after, and the difference matters:
  -- `now()` is TRANSACTION-constant, so every audit row this file writes shares
  -- one `created_at` and `ORDER BY created_at DESC LIMIT 1` returns an ARBITRARY
  -- row. The first draft of this section did exactly that and read §1's
  -- unattributed `country` edit instead of the RPC's row — a test that failed
  -- for the right reason by luck. `rehearsal/010` clears for the same reason.
  v_before := 0;

  v_r2 := public.analysis_get_or_start(
            v_project, 'network_metrics',
            jsonb_build_object('weighted', false, 'topology_digest', v_topo0),
            'nm@wp43', v_editor);

  -- POISONED BETWEEN THE TWO CALLS, NOT BEFORE THEM, and the difference is the
  -- whole assertion. `analysis_get_or_start` sets the GUC itself, so a poison
  -- placed before IT leaves the editor in `app.current_user_id` when
  -- `analysis_apply_node_metrics` runs — and the mutation that deletes the
  -- mirror's `assert_writer_may_act` outright stays GREEN. It did: the first
  -- draft of this section passed that mutation, which is §16 · WP 4.1 · E
  -- happening again to the package that quoted it.
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  DELETE FROM public.audit_logs WHERE plane = 'data' AND target_type = 'network_nodes';

  PERFORM public.analysis_apply_node_metrics(
    (v_r2 ->> 'run_id')::uuid, '[{"uid":"N3","prominence":0.33}]'::jsonb, v_editor);

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_nodes';
  IF v_n - v_before <> 1 THEN
    RAISE EXCEPTION
      'WP 4.3 §7 — the mirror write produced % audit row(s) for `network_nodes`, '
      'expected exactly 1. This is the whole point of replacing the per-node '
      '`.update()` loop: §15 measured 1 385 nodes in one project, and one '
      'prominence run over it wrote 1 385 rows into the log that statement grain '
      'exists to keep readable.', v_n - v_before;
  END IF;

  SELECT actor_user_id INTO v_actor FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_nodes';
  IF v_actor IS DISTINCT FROM v_editor THEN
    RAISE EXCEPTION
      'WP 4.3 §7 — the audit row names % and the write was made by %. The GUC was '
      'poisoned with the analyst before the call, so a row naming anyone else '
      'means the RPC did not set `app.current_user_id` at all.',
      COALESCE(v_actor::text, '<null>'), v_editor;
  END IF;

  -- ── 8 · the store did not swallow the topology · a changed graph MISSES ──
  --
  -- The whole reason the digest exists. Same project, same kind, same code
  -- version, same declared params — and a graph the analyzer would read
  -- differently. It must be a MISS.

  UPDATE public.network_edges SET relative_revenue = 0.77
   WHERE project_id = v_project AND src_uid = 'N2' AND dst_uid = 'N3';

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'network_metrics',
            jsonb_build_object('weighted', true,
                               'topology_digest', public.network_topology_hash(v_project)),
            'nm@wp43', v_editor);

  IF (v_r2 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.3 §8 — A CHANGED GRAPH WAS SERVED FROM CACHE. The edge weight moved, '
      'so every centrality in the project changed, and the store reported a hit '
      'on run %. That is a stale answer presented as a reproducible one, which '
      'is `input-hash` (I5) and T4 broken in the same request.', v_r2 ->> 'run_id';
  END IF;

  -- and reverting the graph re-hits the ORIGINAL run, which is what makes the
  -- digest an identity rather than a version counter.
  UPDATE public.network_edges SET relative_revenue = 0.25
   WHERE project_id = v_project AND src_uid = 'N2' AND dst_uid = 'N3';

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'network_metrics',
            jsonb_build_object('weighted', true,
                               'topology_digest', public.network_topology_hash(v_project)),
            'nm@wp43', v_editor);

  IF (v_r2 ->> 'run_id')::uuid IS DISTINCT FROM v_run THEN
    RAISE EXCEPTION
      'WP 4.3 §8 — reverting the graph landed on run % rather than the original '
      '%. A digest that never returns to a previous value is a clock.',
      v_r2 ->> 'run_id', v_run;
  END IF;

  -- ── 9 · no analysis OUTPUT has entered `graph_hash` ─────────────────────
  --
  -- WP 4.2 §7 asserted this and this package is the one with a motive to break
  -- it: `network_nodes` now carries `computed_from_hash`, and folding the table
  -- into the anchor would make an analysis's output part of its own inputs'
  -- identity. Re-asserted here rather than trusted.

  v_graph0 := public.current_graph_hash(v_project);
  UPDATE public.network_nodes SET prominence = 0.99, computed_from_hash = 'tampered'
   WHERE project_id = v_project AND uid = 'N1';
  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_graph0 THEN
    RAISE EXCEPTION
      'WP 4.3 §9 — writing a CENTRALITY moved `graph_hash`. An analysis output is '
      'now part of the identity of its own inputs, so every run invalidates '
      'itself and no cache can ever hit twice.';
  END IF;

  -- ── 10 · `set_current_user_context` REALLY DOES NAME THE ACTOR ──────────
  --
  -- WP 4.3 taught `dataPlaneAudit.test.ts`'s ratchet that a function calling
  -- `set_current_user_context` attributes, which removed TEN names from
  -- `UNATTRIBUTED` without a line of SQL. A scan widened on a reading is a
  -- ratchet that has started lying about its own method, so the reading is
  -- proved here against a real database — the same standard `rehearsal/110` §7
  -- set for `assert_writer_may_act`, after that one first passed for the wrong
  -- reason (§16 · WP 4.1 · E).
  --
  -- The GUC is poisoned with the ANALYST immediately before the call, and the
  -- call names the OWNER, so a row naming the owner can only have come from
  -- inside `bulk_insert_network_nodes`. The owner and not the editor because
  -- this RPC carries its own authorization — same org AND (project owner or
  -- admin) — and refuses anyone else with `forbidden`. That refusal is not this
  -- assertion's subject; it is D66's, and WP 6.2 owns making `min_project_role`
  -- the one answer to who may write.

  DELETE FROM public.audit_logs WHERE plane = 'data' AND target_type = 'network_nodes';
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON

  PERFORM public.bulk_insert_network_nodes(
    v_project, 'WP43P', v_owner, 'wp43owner@example.invalid',
    jsonb_build_array(jsonb_build_object('uid', 'N9', 'name', 'Node nine', 'depth', 3)));

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_nodes';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.3 §10 — the bulk insert produced % audit row(s) on `network_nodes`, '
      'expected 1. Before this package the table had NO audit triggers at all, '
      'because it was deferred in `coverage.yaml` and the rule is scoped to '
      'tables in the contract (D54).', v_n;
  END IF;

  SELECT actor_user_id INTO v_actor FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'network_nodes';
  IF v_actor IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION
      'WP 4.3 §10 — the audit row names % and the insert named %. The ratchet in '
      '`dataPlaneAudit.test.ts` now treats `set_current_user_context` as '
      'attributing and removed TEN functions from UNATTRIBUTED on the strength '
      'of it. If this assertion is red, that reading was wrong and those ten '
      'names must go back.', COALESCE(v_actor::text, '<null>'), v_owner;
  END IF;

  -- ── 11 · D72 · THE UPSERT THE ANALYZER HAS ALWAYS NAMED NOW WORKS ──────
  --
  -- `calculate-network-science-metrics`'s fallback path — the one that derives a
  -- graph from `supply_chain_data` when the network tables are empty — has
  -- called `.upsert(rows, { onConflict: 'project_id,uid' })` since it was
  -- written. PostgREST passes that through as `ON CONFLICT (project_id, uid)`,
  -- and with no matching unique index PostgreSQL refuses the STATEMENT with
  -- 42P10. The function logged and carried on, updated zero rows, and reported
  -- success.
  --
  -- Asserted as the statement the analyzer actually issues, not as a catalog
  -- lookup: an index can exist and still not be inferrable (a partial one is
  -- not, without a matching WHERE), and what matters is whether the upsert runs.

  BEGIN
    INSERT INTO public.network_nodes (project_id, plant_name, uid, name, revenue)
    VALUES (v_project, 'WP43P', 'N1', 'Node one renamed', 111)
    ON CONFLICT (project_id, uid) DO UPDATE SET revenue = EXCLUDED.revenue;
  EXCEPTION WHEN sqlstate '42P10' THEN
    RAISE EXCEPTION
      'WP 4.3 §11 — D72 IS STILL OPEN. `ON CONFLICT (project_id, uid)` on '
      '`network_nodes` was refused with 42P10, which is the error the analyzer''s '
      'fallback upsert has been swallowing on every run since it was written.';
  END;

  SELECT count(*) INTO v_n FROM public.network_nodes
   WHERE project_id = v_project AND uid = 'N1';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.3 §11 — the upsert INSERTED rather than updating: % rows now carry '
      'uid N1. An arbiter that does not match is how `ON CONFLICT` silently '
      'duplicates (§4 D5).', v_n;
  END IF;

  SELECT revenue INTO v_prom FROM public.network_nodes
   WHERE project_id = v_project AND uid = 'N1';
  IF v_prom IS DISTINCT FROM 111 THEN
    RAISE EXCEPTION 'WP 4.3 §11 — the upsert did not update the row (revenue is %).', v_prom;
  END IF;

  -- and the key really is unique, which a successful upsert alone does not say.
  BEGIN
    INSERT INTO public.network_nodes (project_id, plant_name, uid, name)
    VALUES (v_project, 'WP43P', 'N1', 'duplicate');
    RAISE EXCEPTION
      'WP 4.3 §11 — a second row with uid N1 was ACCEPTED, so the index is not '
      'unique and the upsert above succeeded against something else.';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- refused, which is the assertion
  END;

  RAISE NOTICE 'WP 4.3 · 130_analyzer_dual_write · all sections passed';
END $wp43$;
