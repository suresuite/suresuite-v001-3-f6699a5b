-- WP 4.4 · A HASH CHANGE IS A REVERSIBLE DISPLAY STATE, AND THERE IS ONE RULE.
--
-- §11's WP 4.4 has one sentence and one clause, and the clause is D70:
--
--     "ONE staleness rule everywhere: stale iff `computed_from_hash <>
--      current_graph_hash()`; delete the three ad-hoc ones."
--     "…a hash change is a REVERSIBLE display state, never a persisted status
--      write."
--
-- SECTION 2 IS THE RED ONE. On every commit before this package it fails with
-- "the proposal was EXPIRED by a READ" — because `list_agent_proposals` calls
-- `expire_agent_proposals`, which UPDATEd `status` for grounding drift. Merely
-- LISTING proposals rewrote them, one-way, and moving the project back did not
-- bring them back. That is not a test of a fix; it is a demonstration of the
-- defect, which is what the plan asks a red assertion to be.
--
-- REVERSIBILITY CANNOT BE ASSERTED BY READING CODE. "Computed, not stored" is a
-- claim about what happens when the world moves and moves back, and the only
-- instrument for it is a database you can move twice.
--
-- EVERY NULLABLE COMPARISON IS `IS DISTINCT FROM` (WP 3.4's lesson).

DO $wp44$
DECLARE
  v_owner    uuid := '00000000-0000-4000-8000-000000044400';
  v_editor   uuid := '00000000-0000-4000-8000-000000044401';
  v_project  uuid := '00000000-0000-4000-8000-000000044402';
  v_org      uuid := '00000000-0000-4000-8000-000000044403';
  v_prop     uuid := '00000000-0000-4000-8000-000000044404';
  v_ttl      uuid := '00000000-0000-4000-8000-000000044405';
  v_typed    uuid := '00000000-0000-4000-8000-000000044406';
  v_seeded   uuid := '00000000-0000-4000-8000-000000044407';
  v_h0       text;
  v_h1       text;
  v_state    text;
  v_status   text;
  v_reason   text;
  v_fresh    jsonb;
  v_n        integer;
  v_needs    boolean;
  v_dlm      timestamptz;
BEGIN
  -- ── 0 · a project with a dataset, a graph and a grounded proposal ────────

  IF to_regprocedure('public.freshness_of(text,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'WP 4.4 §0 — THERE IS NO ONE RULE. `freshness_of` does not exist, so every '
      'surface that wants to know whether a number is current is still asking a '
      'clock (§4 D12).';
  END IF;

  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP44 Org', 'wp44-org');
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'wp44owner@example.invalid'), (v_editor, 'wp44editor@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_owner,  'wp44owner@example.invalid',  'WP44 owner',  'x', 'WP44 Org', v_org),
    (v_editor, 'wp44editor@example.invalid', 'WP44 editor', 'x', 'WP44 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP44 staleness', v_owner, 'WP44P', 'WP44 Org', v_org);

  INSERT INTO public.suppliers (project_id, supplier_id) VALUES (v_project, 'S1');
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_project, 'M1', 10);
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    VALUES (v_project, 'WP44P', 'S1', 'M1', 7, 'days', 100, 10);

  -- `project_freshness` refuses a project the caller cannot reach, so the
  -- fixture has to BE somebody. The owner, and the refusal itself is asserted in
  -- §8 rather than taken on trust.
  PERFORM set_config('app.current_user_id', v_owner::text, true);

  v_h0 := public.current_graph_hash(v_project);
  IF v_h0 IS NULL THEN
    RAISE EXCEPTION 'WP 4.4 §0 — the project has no graph hash; nothing below means anything.';
  END IF;

  -- ── 1 · THE RULE IS THREE-STATE, AND `unknown` IS NOT `stale` ───────────
  --
  -- §11 says "stale iff computed_from_hash <> current_graph_hash()", which is
  -- exactly right for a row that HAS a hash. WP 4.3 shipped the columns
  -- nullable on purpose, so a third state exists whether or not a rule names
  -- it — and reporting "we cannot tell" as "out of date" answers T1 with a
  -- guess that happens to be cautious.

  IF public.freshness_of(v_h0, v_project) IS DISTINCT FROM 'fresh' THEN
    RAISE EXCEPTION 'WP 4.4 §1 — the project''s own current hash did not read as fresh.';
  END IF;
  IF public.freshness_of('some other world', v_project) IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'WP 4.4 §1 — a different hash did not read as stale.';
  END IF;
  IF public.freshness_of(NULL, v_project) IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION
      'WP 4.4 §1 — a row with NO provenance read as %, and it must read as '
      '`unknown`. A row written before WP 4.3 carries no hash; calling it stale '
      'tells a user a number is out of date when the truth is that nothing can '
      'say. That is T1 answered with a guess.', public.freshness_of(NULL, v_project);
  END IF;

  -- and `is_stale` collapses the third state the SAFE way, which is the only
  -- direction a boolean may collapse it.
  IF public.is_stale(NULL, v_project) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WP 4.4 §1 — `is_stale(NULL)` must be true: a caller that can only branch two ways must not trust an unattributed row.';
  END IF;
  IF public.is_stale(v_h0, v_project) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WP 4.4 §1 — `is_stale` reported the current hash as stale.';
  END IF;

  -- ── 2 · THE RED ONE · D70 · A READ MUST NOT REWRITE A ROW ───────────────

  INSERT INTO public.proposals
    (id, project_id, agent_id, artifact_type, title, payload, provenance, grounding, idempotency_key, status, expires_at)
  VALUES
    (v_prop, v_project, 'policy-configurator', 'policy_bundle_diff', 'WP44 grounded proposal',
     '{}'::jsonb, '{}'::jsonb, jsonb_build_object('graph_hash', v_h0), 'wp44-grounded', 'proposed',
     now() + interval '30 days');

  -- Move the project. Any tier-2 edit does it; this is a user changing a cost.
  UPDATE public.materials SET cost = 11 WHERE project_id = v_project AND material_id = 'M1';
  v_h1 := public.current_graph_hash(v_project);
  IF v_h1 IS NOT DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION 'WP 4.4 §2 — editing a hashed tier-2 value did not move the graph hash; §2 cannot test anything.';
  END IF;

  -- THE READ. This is the whole defect: listing proposals used to expire them.
  PERFORM public.list_agent_proposals(v_project);

  SELECT status, status_reason INTO v_status, v_reason
    FROM public.proposals WHERE id = v_prop;

  IF v_status IS DISTINCT FROM 'proposed' THEN
    RAISE EXCEPTION
      'WP 4.4 §2 — THE PROPOSAL WAS REWRITTEN BY A READ. Its status is now `%` '
      '(reason `%`): `list_agent_proposals` calls `expire_agent_proposals`, which '
      'UPDATEd it because the project''s graph hash moved. Nobody edited the '
      'proposal; somebody OPENED A PAGE. And the write is one-way — the row said '
      '`proposed` and that is now unrecoverable, which is what §4 D70 means by '
      'one-way and why WP 4.1 had to measure the blast radius of a '
      '`schema_version` bump before taking one.',
      v_status, v_reason;
  END IF;

  -- The drift IS reported — computed, at read time.
  v_state := public.proposal_grounding_state(p) FROM public.proposals p WHERE p.id = v_prop;
  IF v_state IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION
      'WP 4.4 §2 — the proposal''s grounding state reads % and the project has '
      'drifted. Not persisting the drift is only correct if the drift is still '
      'REPORTED; otherwise this package has hidden it rather than un-persisted '
      'it.', v_state;
  END IF;

  -- ── 3 · AND IT COMES BACK ───────────────────────────────────────────────
  --
  -- The half that cannot be read off the source. Undo the edit, and a computed
  -- state returns to `fresh` while a persisted one stays `expired` forever.

  UPDATE public.materials SET cost = 10 WHERE project_id = v_project AND material_id = 'M1';
  IF public.current_graph_hash(v_project) IS DISTINCT FROM v_h0 THEN
    RAISE EXCEPTION 'WP 4.4 §3 — undoing the edit did not restore the graph hash, so the anchor is not a function of the data.';
  END IF;

  PERFORM public.list_agent_proposals(v_project);

  v_state := public.proposal_grounding_state(p) FROM public.proposals p WHERE p.id = v_prop;
  SELECT status INTO v_status FROM public.proposals WHERE id = v_prop;

  IF v_state IS DISTINCT FROM 'fresh' THEN
    RAISE EXCEPTION
      'WP 4.4 §3 — the project drifted and drifted BACK and the proposal still '
      'reads %. A reversible state that does not reverse is a persisted state '
      'wearing a function''s clothes.', v_state;
  END IF;
  IF v_status IS DISTINCT FROM 'proposed' THEN
    RAISE EXCEPTION 'WP 4.4 §3 — the proposal''s status is % after a round trip.', v_status;
  END IF;

  -- ── 4 · TIME IS STILL ONE-WAY, AND TTL MUST STILL EXPIRE ────────────────
  --
  -- The correction is not "stop expiring proposals". A TTL that has passed is a
  -- record of something that happened and does not un-happen; removing that
  -- write would be over-correcting D70 into a second defect.

  INSERT INTO public.proposals
    (id, project_id, agent_id, artifact_type, title, payload, provenance, grounding, idempotency_key, status, expires_at)
  VALUES
    (v_ttl, v_project, 'policy-configurator', 'policy_bundle_diff', 'WP44 expired proposal',
     '{}'::jsonb, '{}'::jsonb, jsonb_build_object('graph_hash', v_h0), 'wp44-ttl', 'proposed',
     now() - interval '1 day');

  PERFORM public.list_agent_proposals(v_project);

  SELECT status, status_reason INTO v_status, v_reason FROM public.proposals WHERE id = v_ttl;
  IF v_status IS DISTINCT FROM 'expired' OR v_reason IS DISTINCT FROM 'ttl' THEN
    RAISE EXCEPTION
      'WP 4.4 §4 — a proposal past its `expires_at` reads %/%. Time only moves '
      'forwards, so this write is a record and not a guess; dropping it would be '
      'D70 over-corrected into a second defect.', v_status, v_reason;
  END IF;

  -- ── 5 · `seeded_from_hash` · a TYPED override does not go stale ──────────
  --
  -- The engine reads OVERRIDES, not the grid, so this one is a
  -- simulation-correctness fact. And the distinction matters in both
  -- directions: a seeded override is a COPY of a number the dataset had, and a
  -- typed one is a DECISION. A decision does not expire when the data moves.

  INSERT INTO public.policy_overrides (id, project_id, scope, target_key, family, patch, seeded_from_hash)
  VALUES (v_seeded, v_project, 'node', 'S1', 'sourcing', '{"lead_time_days": 7}'::jsonb, v_h0),
         (v_typed,  v_project, 'node', 'S2', 'sourcing', '{"lead_time_days": 9}'::jsonb, NULL);

  v_fresh := public.project_freshness(v_project);
  IF (v_fresh #>> '{tables,policy_overrides,fresh}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 4.4 §5 — the seeded override did not read as fresh (%).',
      v_fresh #>> '{tables,policy_overrides,fresh}';
  END IF;
  IF (v_fresh #>> '{tables,policy_overrides,typed}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'WP 4.4 §5 — the TYPED override was not counted as typed. Folding it into '
      '`unknown` would report a person''s decision as a row with missing '
      'provenance; it has none to miss.';
  END IF;

  -- Re-upload. The seeded copy is now stale; the decision is not.
  UPDATE public.materials SET cost = 12 WHERE project_id = v_project AND material_id = 'M1';
  v_fresh := public.project_freshness(v_project);

  IF (v_fresh #>> '{tables,policy_overrides,stale}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'WP 4.4 §5 — after the dataset moved, % seeded override(s) read as stale '
      'and exactly 1 should. THE ENGINE READS OVERRIDES: this is what a '
      'simulation would silently compute from a number the project no longer '
      'holds.', v_fresh #>> '{tables,policy_overrides,stale}';
  END IF;
  IF (v_fresh #>> '{tables,policy_overrides,typed}')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 4.4 §5 — the typed override changed state when the dataset moved. A decision does not expire.';
  END IF;

  UPDATE public.materials SET cost = 10 WHERE project_id = v_project AND material_id = 'M1';

  -- ── 5b · THE WRITER · the flag travels, the HASH does not ───────────────
  --
  -- A column nothing fills is a promise. `bulk_upsert_policy_overrides` is the
  -- only path into this table, and it stamps the hash ITSELF from the project —
  -- the client sends a boolean. A caller that could supply the provenance could
  -- supply the WRONG provenance, and a column that is confidently wrong is worse
  -- than one that is absent (WP 4.3 took the same stance for the run mirror).

  PERFORM public.bulk_upsert_policy_overrides(v_project, jsonb_build_array(
    jsonb_build_object('scope','node','target_key','S3','family','sourcing',
                       'patch', '{"lead_time_days": 5}'::jsonb, 'seeded', true),
    jsonb_build_object('scope','node','target_key','S4','family','sourcing',
                       'patch', '{"lead_time_days": 6}'::jsonb)));

  SELECT count(*) INTO v_n FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'S3'
     AND seeded_from_hash = public.current_graph_hash(v_project);
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.4 §5b — the seeded override did not receive the project''s current '
      'graph hash. `seeded_from_hash` is written by the RPC from '
      '`current_graph_hash`, so a miss here means the column is a promise rather '
      'than a fact.';
  END IF;

  SELECT count(*) INTO v_n FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'S4' AND seeded_from_hash IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.4 §5b — an override written WITHOUT the seeded flag was stamped '
      'anyway. An older caller that cannot say must write NULL, not a hash it '
      'did not mean.';
  END IF;

  -- TYPING OVER A SEEDED OVERRIDE TURNS A COPY INTO A DECISION. If the stamp
  -- survived, the person''s deliberate value would be reported stale the next
  -- time the dataset moved — which is the engine being told to distrust the one
  -- number somebody actually chose.
  PERFORM public.bulk_upsert_policy_overrides(v_project, jsonb_build_array(
    jsonb_build_object('scope','node','target_key','S3','family','sourcing',
                       'patch', '{"lead_time_days": 21}'::jsonb)));

  SELECT count(*) INTO v_n FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'S3' AND seeded_from_hash IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WP 4.4 §5b — typing over a seeded override left `seeded_from_hash` in '
      'place, so a value a person chose deliberately will be reported stale the '
      'next time the dataset moves.';
  END IF;

  -- ── 6 · the ad-hoc rule now answers from the one rule ────────────────────
  --
  -- `should_recalculate_network_metrics` compared `last_data_time >
  -- last_calc_time` — whether a CLOCK moved. An UPDATE writing the same value
  -- made it say stale; a restored backup made it say fresh (§4 D12). Its return
  -- shape is unchanged because the deployed frontend still calls it, so what
  -- has to be asserted is the ANSWER, not the signature.

  -- THE STAMP IS TAKEN AFTER THE INSERT, and WP 5.3 is why. `network_nodes` is
  -- IN the anchor since `20260917000009` (D75), so inserting a node MOVES
  -- `current_graph_hash` — and a fixture that reads the hash in the same
  -- statement stamps the row with the value from before its own insert. The row
  -- then reads stale the instant it is written, and §6 failed on a fixture
  -- rather than on the rule it is testing.
  INSERT INTO public.network_nodes (project_id, plant_name, uid, name)
    VALUES (v_project, 'WP44P', 'N1', 'Node one');
  UPDATE public.network_nodes
     SET computed_from_hash = public.current_graph_hash(v_project), computed_at = now()
   WHERE project_id = v_project AND uid = 'N1';

  SELECT needs_recalculation, data_last_modified INTO v_needs, v_dlm
    FROM public.should_recalculate_network_metrics(v_project);
  IF v_needs IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WP 4.4 §6 — a node naming the current hash still reported needs_recalculation.';
  END IF;
  IF v_dlm IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 4.4 §6 — `data_last_modified` returned a value. There is no honest '
      'answer to "when did the data last change" — that is the question D12 says '
      'is the wrong one — and returning `now()` would be a fabricated source (T1). '
      'NULL, with the reason string saying why.';
  END IF;

  -- THE TOUCH THAT PROVES THE CLOCK IS GONE. Write the SAME value back: an
  -- `updated_at` moves, no data changes, and the old rule reported stale.
  UPDATE public.materials SET cost = 10 WHERE project_id = v_project AND material_id = 'M1';

  SELECT needs_recalculation INTO v_needs
    FROM public.should_recalculate_network_metrics(v_project);
  IF v_needs IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'WP 4.4 §6 — writing a row''s EXISTING value back reported the metrics as '
      'needing recalculation. That is the timestamp rule surviving: it asks '
      'whether a clock moved, and a no-op UPDATE moves one (§4 D12).';
  END IF;

  -- and a genuinely changed input still reports stale, or the rule has been
  -- softened into uselessness rather than corrected.
  UPDATE public.materials SET cost = 99 WHERE project_id = v_project AND material_id = 'M1';
  SELECT needs_recalculation INTO v_needs
    FROM public.should_recalculate_network_metrics(v_project);
  IF v_needs IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WP 4.4 §6 — a genuinely changed input did not report as needing recalculation.';
  END IF;
  UPDATE public.materials SET cost = 10 WHERE project_id = v_project AND material_id = 'M1';

  -- ── 7 · `project_freshness` reads ONE hash for the whole report ─────────
  --
  -- Six tables classified against six separate `current_graph_hash` calls would
  -- let a concurrent write land between two of them and produce a report whose
  -- rows disagree about what "now" is — which is exactly what §15 saw when a run
  -- raced a deploy and read 1 787 rows in one query and 1 691 in another. The
  -- observable consequence: every table's counts must add up to its row count.

  v_fresh := public.project_freshness(v_project);
  IF (v_fresh ->> 'graph_hash') IS DISTINCT FROM public.current_graph_hash(v_project) THEN
    RAISE EXCEPTION 'WP 4.4 §7 — the report names a graph hash the project does not have.';
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_each(v_fresh -> 'tables') t
   WHERE (t.value ->> 'rows')::int
      <> (t.value ->> 'fresh')::int + (t.value ->> 'stale')::int
       + (t.value ->> 'unknown')::int + COALESCE((t.value ->> 'typed')::int, 0);
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 4.4 §7 — % table(s) report counts that do not sum to their row count, '
      'so a row is classified twice or not at all and the badge is arithmetic '
      'nobody can reproduce (T1).', v_n;
  END IF;

  -- ── 8 · the report refuses a project the caller cannot reach ────────────
  --
  -- `project_freshness` is `SECURITY DEFINER` and returns per-table row counts
  -- for one project, which is exactly the shape that leaks a competitor's
  -- dataset size if it forgets to ask. Asserted rather than assumed.

  PERFORM set_config('app.current_user_id', v_editor::text, true);
  BEGIN
    PERFORM public.project_freshness(v_project);
    RAISE EXCEPTION
      'WP 4.4 §8 — `project_freshness` answered for a caller with no access to '
      'the project. It is SECURITY DEFINER and returns row counts per table, so '
      'an unguarded one reports a dataset''s size to anyone who asks.';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- refused, which is the assertion
  END;
  PERFORM set_config('app.current_user_id', v_owner::text, true);

  RAISE NOTICE 'WP 4.4 · 140_one_staleness_rule · all sections passed';
END $wp44$;
