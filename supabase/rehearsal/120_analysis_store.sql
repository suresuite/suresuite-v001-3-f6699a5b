-- WP 4.2 · THE ANALYSIS STORE — A REPEAT REQUEST ON AN UNCHANGED PROJECT IS A
-- HIT, AND THE RUN THAT PRODUCED IT NAMES ITS ACTOR.
--
-- §11's exit checks for this package are five sentences and every one of them is
-- a statement about what the DATABASE does rather than about what a file says:
--
--     "repeat request on an unchanged project is a hit with zero compute"
--     "a changed input is a miss, not a stale hit"
--     "reverting re-hits the original"
--     "two `code_version`s coexist"
--     "no analysis OUTPUT contributes to `graph_hash`"
--
-- SECTION 1 WAS WRITTEN RED. On `main` it fails on its first assertion with
-- "there is no analysis store", because there is no table in which a completed
-- analysis could be recognised a second time: every request recomputes from
-- scratch, and nothing anywhere records that it did. A test written after the
-- fix proves the fix compiles; this one proves the defect existed.
--
-- WHAT ONLY A DATABASE CAN SAY HERE, and each is a thing a static gate reads as
-- fine: whether a second request on unchanged inputs RETURNS THE FIRST RUN
-- rather than making a second; whether editing a row the engine reads moves the
-- key so the next request MISSES; whether reverting that edit lands back on the
-- ORIGINAL run rather than on a third; whether two `code_version`s coexist under
-- one input hash; whether a result row can be rewritten after the fact; and
-- whether the audit row that comes back names the person who asked.
--
-- EVERY NULLABLE COMPARISON IS `IS DISTINCT FROM`. WP 3.4's mutation run found a
-- bug in an ASSERTION rather than in the code — `NULL <> 'owner'` is NULL, which
-- an IF treats as false, so the test could never fail. Assume your own test is
-- the thing that is wrong until a mutation says otherwise.
--
-- AND THE GUC IS POISONED BEFORE EVERY CALL THAT CLAIMS TO SET IT. This file is
-- one `DO` block, therefore ONE TRANSACTION, and `set_config(..., true)` is
-- transaction-LOCAL. WP 4.1's section 7 asserted that four RPCs named their
-- actor and passed for exactly the wrong reason: an earlier section had already
-- put that user in `app.current_user_id` and left it there, so the mutation that
-- deleted `set_config` outright stayed GREEN (§16 · WP 4.1 · E). Here every call
-- is preceded by setting `app.current_user_id` to a DIFFERENT user, so a row
-- naming the right one can only have come from the RPC.

DO $wp42$
DECLARE
  v_owner     uuid := '00000000-0000-4000-8000-000000042200';
  v_analyst   uuid := '00000000-0000-4000-8000-000000042201';
  v_editor    uuid := '00000000-0000-4000-8000-000000042202';
  v_project   uuid := '00000000-0000-4000-8000-000000042203';
  v_other     uuid := '00000000-0000-4000-8000-000000042204';
  v_r1        jsonb;
  v_r2        jsonb;
  v_r3        jsonb;
  v_r4        jsonb;
  v_run1      uuid;
  v_run2      uuid;
  v_hash0     text;
  v_hash1     text;
  v_n         integer;
  v_actor     uuid;
  v_txt       text;
  v_ok        boolean;
BEGIN
  -- ── 0 · the world these assertions run in ────────────────────────────────
  --
  -- A real project with real tier-2 rows, because `current_graph_hash` is what
  -- keys the store and a project with no inputs hashes an empty domain — which
  -- would make sections 2 and 3 assert nothing at all.

  IF to_regclass('public.analysis_runs') IS NULL THEN
    RAISE EXCEPTION
      'WP 4.2 §1 — THERE IS NO ANALYSIS STORE. `analysis_runs` does not exist, so '
      'a repeat request on an unchanged project has nowhere to be recognised: '
      'every analysis recomputes from scratch and nothing records that it did. '
      'This is the RED assertion §11 asks for, and it is the whole of the '
      'package in one message.';
  END IF;
  IF to_regclass('public.analysis_results') IS NULL THEN
    RAISE EXCEPTION 'WP 4.2 §1 — `analysis_results` does not exist.';
  END IF;

  INSERT INTO auth.users (id, email) VALUES
    (v_owner,   'wp42owner@example.invalid'),
    (v_analyst, 'wp42analyst@example.invalid'),
    (v_editor,  'wp42editor@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_owner,   'wp42owner@example.invalid',   'WP42 owner',   'x'),
    (v_analyst, 'wp42analyst@example.invalid', 'WP42 analyst', 'x'),
    (v_editor,  'wp42editor@example.invalid',  'WP42 editor',  'x');

  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP42 analysis store', v_owner, 'WP42P');

  -- Tier-2 input rows, so the project has a non-empty `hash_inputs` to key on.
  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_project, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_project, 'M1', 10);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    VALUES (v_project, 'WP42P', 'S1', 'M1', 7, 'days', 100, 10);

  v_hash0 := public.current_graph_hash(v_project);
  IF v_hash0 IS NULL THEN
    RAISE EXCEPTION 'WP 4.2 §0 — the project has no graph hash, so nothing below keys on anything.';
  END IF;

  -- ── 1 · THE RED ONE · a repeat request on an unchanged project is a HIT ───
  --
  -- Two requests, same project, same kind, same params, same code version, and
  -- NOTHING changed between them. The second must return the FIRST run and must
  -- not create a second one. On `main` this section never reaches here.

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r1 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@1', v_editor);

  IF (v_r1 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.2 §1 — the FIRST request on a cold key reported cache_hit=%, and a '
      'key nothing has ever computed cannot be a hit.', v_r1 ->> 'cache_hit';
  END IF;
  v_run1 := (v_r1 ->> 'run_id')::uuid;

  -- The caller computes here. The store's contract is that it claimed the key.
  PERFORM public.analysis_complete_run(
    v_run1,
    '[{"entity_type":"node","entity_id":"S1","metrics":{"degree":0.5}},
      {"entity_type":"node","entity_id":"M1","metrics":{"degree":0.25}}]'::jsonb,
    '{"nodes": 2}'::jsonb, '[]'::jsonb, v_editor);

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@1', v_editor);

  IF (v_r2 ->> 'cache_hit')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'WP 4.2 §1 — A REPEAT REQUEST ON AN UNCHANGED PROJECT RECOMPUTED. The '
      'second request on an identical key reported cache_hit=%, so the analysis '
      'ran again although no input, no parameter and no code version moved. That '
      'is the defect this package exists to close.', v_r2 ->> 'cache_hit';
  END IF;
  IF (v_r2 ->> 'run_id')::uuid IS DISTINCT FROM v_run1 THEN
    RAISE EXCEPTION
      'WP 4.2 §1 — the repeat request returned run % and not the original run %; '
      'a hit must return the run that already holds the answer.',
      v_r2 ->> 'run_id', v_run1;
  END IF;

  SELECT count(*) INTO v_n FROM public.analysis_runs
   WHERE project_id = v_project AND analysis_kind = 'network_metrics';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'WP 4.2 §1 — two requests on one key left % run rows; a hit computes '
      'nothing and therefore records nothing.', v_n;
  END IF;

  -- And the results came back with the hit, not just the run id.
  SELECT count(*) INTO v_n FROM public.analysis_results WHERE run_id = v_run1;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 4.2 §1 — the completed run holds % result row(s), expected 2.', v_n;
  END IF;

  -- ── 2 · a CHANGED input is a MISS, not a stale hit ───────────────────────
  --
  -- The half that makes the cache safe rather than merely fast. `unit_price` is
  -- a value column of a tier-2 input table, so WP 4.1's rule puts it inside
  -- `hash_inputs` and editing it must move the key.

  UPDATE public.inbound_logistics SET unit_price = 11
   WHERE project_id = v_project AND supplier_id = 'S1' AND material_id = 'M1';

  v_hash1 := public.current_graph_hash(v_project);
  IF v_hash1 IS NOT DISTINCT FROM v_hash0 THEN
    RAISE EXCEPTION
      'WP 4.2 §2 — editing `unit_price` did not move `current_graph_hash`, so the '
      'store cannot tell a changed project from an unchanged one and every hit '
      'below is meaningless. This is `graph_hash` failing, not the store.';
  END IF;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r3 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@1', v_editor);

  IF (v_r3 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.2 §2 — A STALE HIT. The input changed and the store still answered '
      'cache_hit=%, so a user would be shown a centrality computed from data '
      'that no longer exists. A cache that cannot miss is worse than no cache.',
      v_r3 ->> 'cache_hit';
  END IF;
  IF (v_r3 ->> 'run_id')::uuid IS NOT DISTINCT FROM v_run1 THEN
    RAISE EXCEPTION 'WP 4.2 §2 — the miss reused the original run id.';
  END IF;
  v_run2 := (v_r3 ->> 'run_id')::uuid;
  IF (v_r3 ->> 'input_hash') IS DISTINCT FROM v_hash1 THEN
    RAISE EXCEPTION
      'WP 4.2 §2 — the new run recorded input_hash % but the project hashes %; a '
      'run that does not name the world it ran against cannot be reproduced (I5).',
      v_r3 ->> 'input_hash', v_hash1;
  END IF;

  PERFORM public.analysis_complete_run(
    v_run2, '[{"entity_type":"node","entity_id":"S1","metrics":{"degree":0.75}}]'::jsonb,
    '{"nodes": 1}'::jsonb, '[]'::jsonb, v_editor);

  -- ── 3 · REVERTING re-hits the ORIGINAL run ───────────────────────────────
  --
  -- The property that makes the key an IDENTITY rather than a timestamp. Put
  -- the row back and the original answer must come back with it — not a third
  -- run, and not the run computed from the edited value.

  UPDATE public.inbound_logistics SET unit_price = 10
   WHERE project_id = v_project AND supplier_id = 'S1' AND material_id = 'M1';

  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_hash0 THEN
    RAISE EXCEPTION
      'WP 4.2 §3 — reverting the edit did not restore the original hash, so the '
      'hash is a function of history and not of state. `graph_hash` would not be '
      'an identity and §11''s third exit check cannot hold.';
  END IF;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r4 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@1', v_editor);

  IF (v_r4 ->> 'cache_hit')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'WP 4.2 §3 — reverting the input did not re-hit: cache_hit=%.', v_r4 ->> 'cache_hit';
  END IF;
  IF (v_r4 ->> 'run_id')::uuid IS DISTINCT FROM v_run1 THEN
    RAISE EXCEPTION
      'WP 4.2 §3 — reverting re-hit run % instead of the ORIGINAL run %.',
      v_r4 ->> 'run_id', v_run1;
  END IF;

  SELECT count(*) INTO v_n FROM public.analysis_runs
   WHERE project_id = v_project AND analysis_kind = 'network_metrics';
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'WP 4.2 §3 — four requests over two distinct input hashes left % runs, '
      'expected exactly 2.', v_n;
  END IF;

  -- ── 4 · two `code_version`s COEXIST under one input hash ─────────────────
  --
  -- §11's fourth exit check. A new engine version must not evict the old one's
  -- answer: both are true, each about its own code.

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r1 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@2', v_editor);
  IF (v_r1 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.2 §4 — a NEW code_version hit an OLD run. `code_version` is part of '
      'the key precisely so a changed analyzer does not serve its predecessor''s '
      'answer.';
  END IF;
  PERFORM public.analysis_complete_run(
    (v_r1 ->> 'run_id')::uuid,
    '[{"entity_type":"node","entity_id":"S1","metrics":{"degree":0.5}}]'::jsonb,
    '{"nodes": 1}'::jsonb, '[]'::jsonb, v_editor);

  -- The `nm@1` answer is still there and still reachable.
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": true}'::jsonb, 'nm@1', v_editor);
  IF (v_r2 ->> 'run_id')::uuid IS DISTINCT FROM v_run1
     OR (v_r2 ->> 'cache_hit')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'WP 4.2 §4 — computing nm@2 disturbed nm@1: the older version now resolves '
      'to run % (hit=%) instead of %.',
      v_r2 ->> 'run_id', v_r2 ->> 'cache_hit', v_run1;
  END IF;

  -- Params are part of the key too, on the same argument.
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r3 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": false}'::jsonb, 'nm@1', v_editor);
  IF (v_r3 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WP 4.2 §4 — different params hit the same run.';
  END IF;
  -- …and jsonb key ORDER is not part of it, because a caller writing the same
  -- params differently must not miss. `jsonb` normalises key order, which is
  -- why the hash is taken over `jsonb` and never over the text a caller sent.
  PERFORM public.analysis_complete_run(
    (v_r3 ->> 'run_id')::uuid, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, v_editor);
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r4 := public.analysis_get_or_start(
            v_project, 'network_metrics', '{"weighted": false}'::jsonb, 'nm@1', v_editor);
  IF (v_r4 ->> 'cache_hit')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WP 4.2 §4 — the same params written once more did not hit.';
  END IF;

  -- ── 5 · THE AUDIT ROW, READ BACK, WITH THE GUC POISONED ──────────────────
  --
  -- §11 asks that each run be audited. A line count cannot say whether the
  -- actor reached the trigger; this performs the write and SELECTs the row.
  -- `v_analyst` is put in the GUC immediately before the call and the call is
  -- made as `v_editor`, so a row naming `v_editor` can only have come from the
  -- RPC setting it (§16 · WP 4.1 · E is what happens when it is not poisoned).

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r1 := public.analysis_get_or_start(
            v_project, 'prominence', '{}'::jsonb, 'pr@1', v_editor);

  -- `action = 'insert'` SPECIFICALLY. A mutation that removed the INSERT trigger
  -- left this section green, because `analysis_complete_run`'s UPDATE writes an
  -- `analysis_runs` audit row too and an untyped count cannot tell them apart.
  -- The claim here is that CLAIMING a run is audited, so the claim names the
  -- statement that does it.
  SELECT count(*) INTO v_n
    FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'analysis_runs' AND action = 'insert'
     AND (after ->> 'actor_known')::boolean IS NOT DISTINCT FROM true;
  IF v_n < 1 THEN
    RAISE EXCEPTION
      'WP 4.2 §5 — claiming a run wrote no attributed `insert` audit row for '
      '`analysis_runs`. The GUC was poisoned with % immediately before the call, '
      'so this is the RPC failing to set `app.current_user_id` or the INSERT '
      'trigger being absent — not a stale value.', v_analyst;
  END IF;

  -- The RESULTS are audited too, and on their own statement. Same argument.
  SELECT count(*) INTO v_n
    FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'analysis_results' AND action = 'insert'
     AND (after ->> 'actor_known')::boolean IS NOT DISTINCT FROM true;
  IF v_n < 1 THEN
    RAISE EXCEPTION
      'WP 4.2 §5 — writing results wrote no attributed `insert` audit row for '
      '`analysis_results`.';
  END IF;

  -- The actor lives in the `actor_user_id` COLUMN, not inside `after` — `after`
  -- carries `actor_known`, `tier` and the row counts. Reading the wrong one is
  -- how an assertion passes on a NULL that never matched anything.
  SELECT actor_user_id INTO v_actor
    FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'analysis_runs' AND action = 'insert'
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_actor IS DISTINCT FROM v_editor THEN
    RAISE EXCEPTION
      'WP 4.2 §5 — the audit row names % but the RPC was called as %. The GUC '
      'held % before the call, so a row naming that user means the RPC never set '
      'it and the trigger read the poison.', v_actor, v_editor, v_analyst;
  END IF;

  -- And the run row itself names the actor, which is what makes the audit row
  -- checkable against something rather than merely present.
  SELECT actor_user_id INTO v_actor FROM public.analysis_runs
   WHERE id = (v_r1 ->> 'run_id')::uuid;
  IF v_actor IS DISTINCT FROM v_editor THEN
    RAISE EXCEPTION 'WP 4.2 §5 — the run row records actor %, expected %.', v_actor, v_editor;
  END IF;

  -- A run that cannot name its actor is refused outright, the way
  -- `assert_writer_may_act` refuses one (WP 4.1's `20260917000005`).
  BEGIN
    PERFORM public.analysis_get_or_start(
      v_project, 'prominence', '{}'::jsonb, 'pr@1', NULL);
    RAISE EXCEPTION 'WP 4.2 §5 — a NULL actor was accepted.';
  EXCEPTION WHEN null_value_not_allowed THEN
    NULL;  -- the expected refusal
  END;

  -- ── 6 · NEVER UPDATE, NEVER DELETE — as a property of the SCHEMA ─────────
  --
  -- §11 says the store never updates and never deletes. Written here as a
  -- constraint rather than as a habit, because a habit is a property of today's
  -- callers: WP 4.1's own lesson is that an invariant enforced by the absence of
  -- another write path is not enforced at all.

  BEGIN
    UPDATE public.analysis_results SET metrics = '{"degree": 99}'::jsonb
     WHERE run_id = v_run1;
    RAISE EXCEPTION 'WP 4.2 §6 — a result row was REWRITTEN. `analysis_results` must be immutable.';
  EXCEPTION WHEN sqlstate 'P0A01' THEN
    NULL;  -- the expected refusal
  END;

  -- The identity of a run is immutable too: re-pointing an existing run at a
  -- different input hash would make every stored answer unfalsifiable.
  BEGIN
    UPDATE public.analysis_runs SET input_hash = 'deadbeef' WHERE id = v_run1;
    RAISE EXCEPTION 'WP 4.2 §6 — a run''s input_hash was REWRITTEN.';
  EXCEPTION WHEN sqlstate 'P0A01' THEN
    NULL;  -- the expected refusal
  END;

  -- …while the run's own lifecycle columns remain writable, or no run could
  -- ever finish. This is the line between identity and state.
  UPDATE public.analysis_runs SET warnings = '["late"]'::jsonb WHERE id = v_run1;

  -- ── 7 · NO ANALYSIS OUTPUT CONTRIBUTES TO `graph_hash` ───────────────────
  --
  -- WP 4.2's exit check, from WP 4.2's side. `graphHashCoverage.test.ts` asserts
  -- it against the migration TEXT; this asserts it against a running database,
  -- which is the half a text scan cannot reach: writing an analysis result must
  -- not move the anchor its own inputs are identified by. The moment
  -- `analysis_results` exists, "just hash the outputs too" becomes a tempting
  -- one-liner, and this is what would catch it.

  v_hash1 := public.current_graph_hash(v_project);
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'critical_nodes', '{}'::jsonb, 'cn@1', v_editor);
  PERFORM public.analysis_complete_run(
    (v_r2 ->> 'run_id')::uuid,
    '[{"entity_type":"node","entity_id":"S1","metrics":{"critical":true}}]'::jsonb,
    '{"nodes": 1}'::jsonb, '[]'::jsonb, v_editor);

  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_hash1 THEN
    RAISE EXCEPTION
      'WP 4.2 §7 — WRITING AN ANALYSIS RESULT MOVED `graph_hash`. A derived row '
      'is a function of tier 2; folding it back into the identity of its own '
      'inputs makes the anchor circular and is the confusion `input-hash` (I5) '
      'exists to prevent.';
  END IF;

  -- ── 8 · `should_recalculate_network_metrics` is DEPRECATED IN PLACE ──────
  --
  -- §11 says deprecate it with a comment naming D12. In PLACE: it is still
  -- called by `auto_calculate_network_metrics_on_completion` on every completion
  -- flip, so dropping it here would break a live trigger. The assertion is that
  -- it still exists AND that it now says what replaces it.

  IF to_regproc('public.should_recalculate_network_metrics') IS NULL THEN
    RAISE EXCEPTION
      'WP 4.2 §8 — `should_recalculate_network_metrics` was DROPPED, not '
      'deprecated in place. `auto_calculate_network_metrics_on_completion` still '
      'calls it inside every projects-row UPDATE that flips completed=true.';
  END IF;

  SELECT obj_description(to_regproc('public.should_recalculate_network_metrics')::oid, 'pg_proc')
    INTO v_txt;
  IF v_txt IS NULL OR position('D12' in v_txt) = 0 THEN
    RAISE EXCEPTION
      'WP 4.2 §8 — the deprecation carries no comment naming D12. A function '
      'deprecated without a pointer to what replaces it is a function the next '
      'reader extends. Comment is: %', COALESCE(v_txt, '(none)');
  END IF;

  -- ── 9 · A FAILED RUN RELEASES THE KEY AND IS KEPT AS A ROW ──────────────
  --
  -- THIS SECTION EXISTS BECAUSE THIS PACKAGE DEVIATED FROM §11, and a deviation
  -- with no test is a claim. §11 writes the key as a flat
  -- `UNIQUE (project_id, analysis_kind, input_hash, params_hash, code_version)`.
  -- Taken literally the first FAILED attempt owns that key forever: the retry
  -- cannot insert, so an analysis that crashed once can never be run again on
  -- that input. The index is therefore partial — `WHERE status <> 'failed'` —
  -- and these are the two halves of what that buys: the failure is still on
  -- record (nothing is deleted, `audit-actor` still has its row), and the key is
  -- free.

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r1 := public.analysis_get_or_start(
            v_project, 'lead_time_fit', '{}'::jsonb, 'lt@1', v_editor);
  PERFORM public.analysis_fail_run((v_r1 ->> 'run_id')::uuid, '["boom"]'::jsonb, v_editor);

  -- the failure is KEPT
  SELECT count(*) INTO v_n FROM public.analysis_runs
   WHERE project_id = v_project AND analysis_kind = 'lead_time_fit' AND status = 'failed';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'WP 4.2 §9 — the failed run was not kept (% row(s)). The store never '
      'deletes: a failure is evidence, and deleting it would take its audit row''s '
      'subject with it.', v_n;
  END IF;

  -- …and the key is FREE, so the retry can claim it
  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'lead_time_fit', '{}'::jsonb, 'lt@1', v_editor);
  IF (v_r2 ->> 'run_id')::uuid IS NOT DISTINCT FROM (v_r1 ->> 'run_id')::uuid THEN
    RAISE EXCEPTION 'WP 4.2 §9 — the retry reused the failed run rather than claiming a new one.';
  END IF;
  IF (v_r2 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.2 §9 — the retry after a failure reported cache_hit=%; a failed run '
      'holds no answer and must never be served as one.', v_r2 ->> 'cache_hit';
  END IF;
  PERFORM public.analysis_complete_run((v_r2 ->> 'run_id')::uuid, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, v_editor);

  -- A run is finished ONCE. Completing a completed run would rewrite an answer
  -- through the front door, which sections 6 and 9 exist together to prevent.
  BEGIN
    PERFORM public.analysis_complete_run((v_r2 ->> 'run_id')::uuid, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, v_editor);
    RAISE EXCEPTION 'WP 4.2 §9 — a succeeded run was completed a second time.';
  EXCEPTION WHEN sqlstate 'P0A01' THEN
    NULL;  -- the expected refusal
  END;

  -- ── 10 · A CLAIM IN FLIGHT IS NOT AN ANSWER ────────────────────────────
  --
  -- Both halves here were added because a MUTATION SURVIVED, which is the only
  -- reason worth adding an assertion.
  --
  -- The first: a `running` row is a claim somebody else is still working on and
  -- holds no results. A lookup written `status <> 'failed'` instead of
  -- `status = 'succeeded'` would hand it back as a HIT — a run id with nothing
  -- behind it — and every section above stayed green when it did. This is also
  -- the in-transaction half of §11's concurrency gap check: the two-session half
  -- cannot be written here and is `scripts/wp42-concurrency.mjs`.

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r1 := public.analysis_get_or_start(
            v_project, 'inflight', '{}'::jsonb, 'if@1', v_editor);   -- claims, does NOT complete
  IF (v_r1 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WP 4.2 §10 — a cold key reported a hit.';
  END IF;

  PERFORM set_config('app.current_user_id', v_analyst::text, true);  -- POISON
  v_r2 := public.analysis_get_or_start(
            v_project, 'inflight', '{}'::jsonb, 'if@1', v_editor);   -- asks again, mid-flight
  IF (v_r2 ->> 'cache_hit')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.2 §10 — AN UNFINISHED RUN WAS SERVED AS A HIT (status=%). The caller '
      'would be handed a run id with no results behind it and would render an '
      'empty analysis as a complete one.', v_r2 ->> 'status';
  END IF;
  IF (v_r2 ->> 'status') IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'WP 4.2 §10 — the in-flight claim reports status %, expected running.', v_r2 ->> 'status';
  END IF;
  -- and it is the SAME claim, not a second one: the unique index is what makes
  -- the second caller find the first rather than start a duplicate computation.
  IF (v_r2 ->> 'run_id')::uuid IS DISTINCT FROM (v_r1 ->> 'run_id')::uuid THEN
    RAISE EXCEPTION 'WP 4.2 §10 — a second request on an in-flight key started a SECOND run.';
  END IF;
  SELECT count(*) INTO v_n FROM public.analysis_runs
   WHERE project_id = v_project AND analysis_kind = 'inflight';
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 4.2 §10 — two requests on one cold key left % runs.', v_n;
  END IF;

  -- The second: one row per entity per run. Without the unique index a retried
  -- or duplicated completion writes two metrics rows for one node and every
  -- reader has to guess which is current — D19 rebuilt inside the table that
  -- exists to end it. `analysis_complete_run` refuses a second completion, so
  -- the only way to reach this is a direct INSERT, which is what a future writer
  -- would do.
  BEGIN
    INSERT INTO public.analysis_results (run_id, entity_type, entity_id, metrics)
      VALUES (v_run1, 'node', 'S1', '{"degree": 0.9}'::jsonb);
    RAISE EXCEPTION
      'WP 4.2 §10 — a SECOND metrics row was written for one entity in one run. '
      'Nothing then says which is current.';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- the expected refusal
  END;

  RAISE NOTICE 'WP 4.2 · rehearsal/120 — all ten sections passed.';
END $wp42$;
