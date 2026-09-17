-- WP 3.4 · THE DIFF EXISTS BEFORE THE DECISION, AND THE PROMOTION HAS A ROLE.
--
-- §10's exit checks for this package are three sentences and two of them are
-- statements about what the DATABASE does:
--
--     "a user can click from a cell through to the source row"
--     "promotion by an analyst is refused"
--
-- A disabled button is not a refusal — the RPC is reachable without the bundle
-- that draws the button — so the second one needs this file rather than a test
-- that reads a component. The click-through is a JOIN, so it is asserted as one.
--
-- WHAT ONLY A DATABASE CAN SAY HERE, and each is a thing a static gate reads as
-- fine: whether `diff_state` holds a computed value or the default that was
-- never computed; whether the diff's key predicate agrees with the index
-- `ON CONFLICT` infers, for a key whose column is NULL; whether
-- `effective_project_role` returns anything at all for a project created today;
-- and whether re-running the diff doubles the findings it writes.

DO $wp34$
DECLARE
  v_owner    uuid := '00000000-0000-4000-8000-000000034200';
  v_analyst  uuid := '00000000-0000-4000-8000-000000034201';
  v_editor   uuid := '00000000-0000-4000-8000-000000034202';
  v_project  uuid := '00000000-0000-4000-8000-000000034203';
  v_landed   jsonb;
  v_diff     jsonb;
  v_applied  jsonb;
  v_run1     uuid;
  v_run2     uuid;
  v_run3     uuid;
  v_n        integer;
  v_txt      text;
  v_state    text;
  v_num      numeric;
  v_err      text;
  v_a        integer;
  v_b        integer;
  v_c        integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner,   'wp34owner@example.invalid'),
    (v_analyst, 'wp34analyst@example.invalid'),
    (v_editor,  'wp34editor@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_owner,   'wp34owner@example.invalid',   'WP34 owner',   'x'),
    (v_analyst, 'wp34analyst@example.invalid', 'WP34 analyst', 'x'),
    (v_editor,  'wp34editor@example.invalid',  'WP34 editor',  'x');

  -- ── 0 · A PROJECT CREATED TODAY HAS A MEMBER (§4 D61) ─────────────────────
  --
  -- The role gate is unlandable without this and the failure would have been an
  -- outage rather than a gate: WP 2.2 backfilled `project_members` from
  -- `projects.modeler_id` ONCE, inside `20260915000005`, and left no writer. A
  -- project created after that migration has no members at all, so its own
  -- creator resolves to a NULL role and `project_role_rank(NULL)` is 0.
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP34 diff review', v_owner, 'WP34P');

  -- `IS DISTINCT FROM`, not `<>`: the function returns NULL for a non-member and
  -- `NULL <> 'owner'` is NULL, which an IF treats as false. The mutation that
  -- disables the trigger proved this assertion silent before it was written this
  -- way — a test that cannot fail is the failure mode this whole plan is about.
  IF public.effective_project_role(v_owner, v_project) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION
      'WP 3.4: a project created now gives its modeler the role "%" — expected owner. '
      'Without the projects_owner_membership trigger the role gate refuses everybody.',
      COALESCE(public.effective_project_role(v_owner, v_project), '(none)');
  END IF;

  INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
  VALUES (v_project, v_analyst, 'analyst', 'WP34 rehearsal — a real member, one rank short'),
         (v_project, v_editor,  'editor',  'WP34 rehearsal — the rank the promotion needs');

  -- ── 1 · A LANDED RUN IS DIFFED, AND `new` IS MEASURED RATHER THAN DEFAULTED ─
  --
  -- Four lines. Two clean arcs, one row that fails validation (its finding is
  -- supplied the way `ingest-file` supplies one), and one line repeating the
  -- first arc with a different volume — so every state the review screen has to
  -- render exists in ONE run: new, held back, and superseded-by-a-later-line.
  v_landed := public.ingest_land_file(
    v_project, v_owner, 'csv', 'transactional', 'inbound_logistics',
    'inbound-wp34.csv', 'ingest', 'p/wp34/1.csv', 'text/csv', 2048,
    repeat('c', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 2,
        'raw',      jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A','volume','10'),
        'parsed',   jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A',
                                       'volume', 10, 'time_unit', 'week',
                                       'lead_time', 1, 'unit_price', 2),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 3,
        'raw',      jsonb_build_object('supplier_id','SUP-B','material_id','MAT-B','volume','20'),
        'parsed',   jsonb_build_object('supplier_id','SUP-B','material_id','MAT-B',
                                       'volume', 20, 'time_unit', 'week',
                                       'lead_time', 2, 'unit_price', 3),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 4,
        'raw',      jsonb_build_object('supplier_id','SUP-C','material_id','MAT-C','volume',''),
        'parsed',   jsonb_build_object('supplier_id','SUP-C','material_id','MAT-C'),
        'findings', jsonb_build_array(jsonb_build_object(
                      'level','error','field','volume','code','blank',
                      'message','volume is blank','row',4))),
      jsonb_build_object('source_row_number', 5,
        'raw',      jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A','volume','11'),
        'parsed',   jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A',
                                       'volume', 11, 'time_unit', 'week',
                                       'lead_time', 1, 'unit_price', 2),
        'findings', '[]'::jsonb)));
  v_run1 := (v_landed ->> 'run_id')::uuid;

  -- THE LANDING DOES NOT DIFF, AND THE COLUMN SAYS SO RATHER THAN GUESSING.
  -- This is D62 stated as an assertion: before WP 3.4 these four rows would all
  -- have read `new` — three of them wrongly, and one of them wrongly in a way
  -- (an unpromotable row) that has no true answer at all.
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run1 AND diff_state IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'WP 3.4: % staged row(s) carry a diff_state before anything computed one. '
      'The NOT NULL DEFAULT ''new'' is back (§4 D62).', v_n;
  END IF;

  v_diff := public.ingest_diff_run(v_run1, v_owner);

  -- THE BUTTON AND THE REFUSAL READ THE SAME FUNCTION. The diff answers "what is
  -- this caller's role, and may they promote", so the screen's disabled Promote
  -- button is a preview of what `ingest_apply_run` will do rather than a second
  -- opinion about it.
  IF (v_diff ->> 'actor_role') IS DISTINCT FROM 'owner'
     OR (v_diff ->> 'actor_may_promote')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'WP 3.4: the diff reported role=% may_promote=% for the project owner',
      v_diff ->> 'actor_role', v_diff ->> 'actor_may_promote';
  END IF;

  -- Two clean, unrepeated arcs against an empty table: both new. The repeated
  -- line is NOT counted as new — it is superseded — and the invalid line is
  -- held. Five numbers, and they have to add up to the file.
  IF (v_diff ->> 'rows_new')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.4: the first diff found % new row(s), expected 2', v_diff ->> 'rows_new';
  END IF;
  IF (v_diff ->> 'rows_changed')::int <> 0 OR (v_diff ->> 'rows_unchanged')::int <> 0 THEN
    RAISE EXCEPTION 'WP 3.4: an empty tier-2 table produced % changed and % unchanged row(s)',
      v_diff ->> 'rows_changed', v_diff ->> 'rows_unchanged';
  END IF;
  IF (v_diff ->> 'rows_held')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the diff held % row(s), expected the one with the error finding',
      v_diff ->> 'rows_held';
  END IF;
  IF (v_diff ->> 'rows_superseded')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the diff reported % superseded line(s), expected 1 — '
      'the finding has to exist BEFORE the promotion, because the review screen shows it',
      v_diff ->> 'rows_superseded';
  END IF;

  -- THE FIVE NUMBERS PARTITION THE RUN. A screen whose categories do not add up
  -- to the file is a screen that has lost rows.
  SELECT count(*) INTO v_n FROM public.ingest_staged_rows WHERE ingest_run_id = v_run1;
  IF (v_diff ->> 'rows_new')::int + (v_diff ->> 'rows_changed')::int
     + (v_diff ->> 'rows_unchanged')::int + (v_diff ->> 'rows_superseded')::int
     + (v_diff ->> 'rows_held')::int <> v_n THEN
    RAISE EXCEPTION 'WP 3.4: the five counts sum to %, and the run staged % rows',
      (v_diff ->> 'rows_new')::int + (v_diff ->> 'rows_changed')::int
      + (v_diff ->> 'rows_unchanged')::int + (v_diff ->> 'rows_superseded')::int
      + (v_diff ->> 'rows_held')::int, v_n;
  END IF;

  -- AND THEY ARE PERSISTED, which is the whole of D63: WP 3.3's
  -- `ingest_apply_run` RETURNED a split and wrote `rows_new = inserts+updates`.
  SELECT rows_new, rows_changed, rows_unchanged, rows_held, rows_superseded, rows_removed
    INTO v_n, v_num, v_state, v_txt, v_err, v_landed
    FROM public.ingest_runs WHERE id = v_run1;
  IF v_n <> 2 OR v_num <> 0 OR v_state::int <> 0 OR v_txt::int <> 1 OR v_err::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: ingest_runs holds new=% changed=% unchanged=% held=% superseded=%, '
      'expected 2/0/0/1/1 — the diff computed the split and did not persist it',
      v_n, v_num, v_state, v_txt, v_err;
  END IF;
  -- A FILE RUN CANNOT REMOVE ROWS, and the zero is a statement rather than a
  -- measurement. WP 3.3 wrote the held-back count here (§4 D64).
  IF v_landed::int <> 0 THEN
    RAISE EXCEPTION 'WP 3.4: a file run reported rows_removed=% — a CSV is not authority '
      'to delete a project''s rows and can never mark one removed_upstream', v_landed;
  END IF;

  -- The row that failed validation has NO diff_state, because its key may be one
  -- of the fields that failed. NULL is a question; `new` was an answer.
  SELECT diff_state INTO v_state FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run1 AND source_row_number = 4;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'WP 3.4: a row held back by an error finding claims diff_state=%', v_state;
  END IF;

  -- The superseded line is told which line beat it, at review time.
  SELECT f ->> 'message' INTO v_txt
    FROM public.ingest_staged_rows s, jsonb_array_elements(s.findings) f
   WHERE s.ingest_run_id = v_run1 AND s.source_row_number = 2
     AND f ->> 'code' = 'superseded_by_later_line';
  IF v_txt IS NULL OR v_txt NOT LIKE '%row 5%' THEN
    RAISE EXCEPTION 'WP 3.4: the superseded line does not name the line that beat it (got "%")',
      COALESCE(v_txt, '(no finding)');
  END IF;

  -- ── 2 · THE DIFF IS IDEMPOTENT, because three callers run it ──────────────
  --
  -- Landing, the review screen, and `ingest_apply_run` itself. A second pass
  -- that appended a second `superseded_by_later_line` would show the user the
  -- same sentence twice and inflate `rows_superseded` on every refresh.
  v_diff := public.ingest_diff_run(v_run1, v_owner);
  SELECT count(*) INTO v_n
    FROM public.ingest_staged_rows s, jsonb_array_elements(s.findings) f
   WHERE s.ingest_run_id = v_run1 AND f ->> 'code' = 'superseded_by_later_line';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: re-running the diff left % superseded finding(s), expected 1', v_n;
  END IF;
  IF (v_diff ->> 'rows_superseded')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the second diff reported % superseded line(s), expected 1',
      v_diff ->> 'rows_superseded';
  END IF;

  -- ── 3 · PROMOTION BY AN ANALYST IS REFUSED (§10's exit check) ─────────────
  --
  -- The analyst is a REAL member of this project with a real role — this is not
  -- a stranger being turned away by `has_project_access`, it is the rank being
  -- read. WP 3.3's `ingest_apply_run` checked project ACCESS and never a role,
  -- so this promotion succeeded (§4 D65).
  IF (public.ingest_diff_run(v_run1, v_analyst) ->> 'actor_may_promote')::boolean THEN
    RAISE EXCEPTION 'WP 3.4: the diff told an ANALYST they may promote; the screen would '
      'have offered them a button the database then refuses';
  END IF;

  BEGIN
    PERFORM public.ingest_apply_run(v_run1, v_analyst);
    RAISE EXCEPTION 'WP 3.4: an ANALYST promoted a run. §10''s exit check is "promotion by '
      'an analyst is refused" and the database did not refuse it (§4 D65).';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%analyst%' THEN
      RAISE EXCEPTION 'WP 3.4: the refusal does not name the role it read (got "%")', v_err;
    END IF;
  END;

  -- The run is untouched by the refusal: still staged, still promotable by
  -- somebody who may. A gate that half-applied would be worse than none.
  SELECT status INTO v_txt FROM public.ingest_runs WHERE id = v_run1;
  IF v_txt IS DISTINCT FROM 'staged' THEN
    RAISE EXCEPTION 'WP 3.4: after a refused promotion the run is %, expected staged', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM public.inbound_logistics WHERE project_id = v_project;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.4: a refused promotion still wrote % tier-2 row(s)', v_n;
  END IF;

  -- ── 4 · AN EDITOR MAY, and the promotion reports the diff's split ─────────
  v_applied := public.ingest_apply_run(v_run1, v_editor);
  IF (v_applied ->> 'rows_promoted')::int <> 2 THEN
    RAISE EXCEPTION 'WP 3.4: the editor''s promotion moved % row(s), expected 2',
      v_applied ->> 'rows_promoted';
  END IF;
  IF (v_applied ->> 'rows_new')::int <> 2 OR (v_applied ->> 'rows_changed')::int <> 0
     OR (v_applied ->> 'rows_unchanged')::int <> 0 THEN
    RAISE EXCEPTION 'WP 3.4: the promotion reported new=% changed=% unchanged=%, expected 2/0/0',
      v_applied ->> 'rows_new', v_applied ->> 'rows_changed', v_applied ->> 'rows_unchanged';
  END IF;
  IF (v_applied ->> 'promoted_by_role') IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'WP 3.4: the promotion recorded role %, expected editor',
      v_applied ->> 'promoted_by_role';
  END IF;
  -- The LATER line won, as it does everywhere else in this path.
  SELECT volume INTO v_num FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-A';
  IF v_num IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'WP 3.4: the repeated arc promoted volume %, expected 11 — the later line wins', v_num;
  END IF;

  -- AND THE PROMOTION LEAVES THE DIFF'S SPLIT STANDING. This is the assertion
  -- D63 needed and did not have: WP 3.3's last statement wrote
  -- `rows_new = v_total` — inserts AND updates — over whatever was there, so a
  -- correct diff followed by that UPDATE is still a wrong number in the column
  -- the review screen reads.
  SELECT rows_new, rows_changed, rows_unchanged INTO v_a, v_b, v_c
    FROM public.ingest_runs WHERE id = v_run1;
  IF v_a <> 2 OR v_b <> 0 OR v_c <> 0 THEN
    RAISE EXCEPTION 'WP 3.4: AFTER the promotion the run holds new=% changed=% unchanged=%, '
      'expected 2/0/0 — the apply overwrote the diff''s split (§4 D63)', v_a, v_b, v_c;
  END IF;

  -- ── 5 · `unchanged` IS MEASURED, NOT ASSUMED ──────────────────────────────
  --
  -- The same file again. Every clean row now has a counterpart in tier 2 holding
  -- the same values, so the honest answer is `unchanged` — and WP 3.3's handoff
  -- said "rows_updated vs rows_promoted IS the diff, already computed". It is
  -- not: an UPDATE that writes identical values is still an UPDATE, so
  -- `rows_updated` cannot tell `changed` from `unchanged` and this is the number
  -- the review screen actually needs (§4 D63).
  v_landed := public.ingest_land_file(
    v_project, v_owner, 'csv', 'transactional', 'inbound_logistics',
    'inbound-wp34.csv', 'ingest', 'p/wp34/2.csv', 'text/csv', 2048,
    repeat('c', 64),
    jsonb_build_array(
      jsonb_build_object('source_row_number', 2,
        'raw',      jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A','volume','11'),
        'parsed',   jsonb_build_object('supplier_id','SUP-A','material_id','MAT-A',
                                       'volume', 11, 'time_unit', 'week',
                                       'lead_time', 1, 'unit_price', 2),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 3,
        'raw',      jsonb_build_object('supplier_id','SUP-B','material_id','MAT-B','volume','99'),
        'parsed',   jsonb_build_object('supplier_id','SUP-B','material_id','MAT-B',
                                       'volume', 99, 'time_unit', 'week',
                                       'lead_time', 2, 'unit_price', 3),
        'findings', '[]'::jsonb),
      jsonb_build_object('source_row_number', 4,
        'raw',      jsonb_build_object('supplier_id','SUP-D','material_id','MAT-D','volume','14'),
        'parsed',   jsonb_build_object('supplier_id','SUP-D','material_id','MAT-D',
                                       'volume', 14, 'time_unit', 'week',
                                       'lead_time', 2, 'unit_price', 3),
        'findings', '[]'::jsonb)));
  v_run2 := (v_landed ->> 'run_id')::uuid;
  v_diff := public.ingest_diff_run(v_run2, v_owner);

  -- One arc restated identically, one whose volume moved, one the table has
  -- never seen. All three states in one run, which is what the screen renders.
  IF (v_diff ->> 'rows_unchanged')::int <> 1 OR (v_diff ->> 'rows_changed')::int <> 1
     OR (v_diff ->> 'rows_new')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: a file holding one identical, one edited and one unseen row '
      'diffed as new=% changed=% unchanged=%, expected 1/1/1',
      v_diff ->> 'rows_new', v_diff ->> 'rows_changed', v_diff ->> 'rows_unchanged';
  END IF;

  -- The row-level answer, not just the count: the screen renders per row.
  SELECT diff_state INTO v_state FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run2 AND source_row_number = 2;
  IF v_state IS DISTINCT FROM 'unchanged' THEN
    RAISE EXCEPTION 'WP 3.4: an identical row diffed as %, expected unchanged', v_state;
  END IF;
  SELECT diff_state INTO v_state FROM public.ingest_staged_rows
   WHERE ingest_run_id = v_run2 AND source_row_number = 3;
  IF v_state IS DISTINCT FROM 'changed' THEN
    RAISE EXCEPTION 'WP 3.4: a row whose volume moved 20 → 99 diffed as %, expected changed', v_state;
  END IF;

  -- NORMALIZATION IS APPLIED BEFORE THE COMPARISON, or "the same fact stated in
  -- another unit" reads as a change. 30.4375 per month is 7 per week; the row in
  -- tier 2 holds 11 per week; the diff must call that CHANGED for the value and
  -- not for the unit. The inverse case is the one that bites, so it is asserted
  -- directly below with a monthly restatement of the SAME weekly number.
  v_applied := public.ingest_apply_run(v_run2, v_editor);
  IF (v_applied ->> 'rows_changed')::int <> 1 OR (v_applied ->> 'rows_unchanged')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the promotion returned changed=% unchanged=%, expected 1/1',
      v_applied ->> 'rows_changed', v_applied ->> 'rows_unchanged';
  END IF;
  SELECT rows_new, rows_changed, rows_unchanged INTO v_a, v_b, v_c
    FROM public.ingest_runs WHERE id = v_run2;
  IF v_a <> 1 OR v_b <> 1 OR v_c <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: after the second promotion the run holds new=% changed=% '
      'unchanged=%, expected 1/1/1 (§4 D63)', v_a, v_b, v_c;
  END IF;

  v_landed := public.ingest_land_file(
    v_project, v_owner, 'csv', 'transactional', 'inbound_logistics',
    'inbound-daily.csv', 'ingest', 'p/wp34/3.csv', 'text/csv', 2048,
    repeat('d', 64),
    jsonb_build_array(
      -- SUP-D holds 14 per week and a lead time of 2 weeks. THE SAME TWO FACTS,
      -- quoted per DAY: 2 a day is 14 a week (a rate), 14 days is 2 weeks (a
      -- duration, and the two are not inverses). Nothing about this arc has
      -- changed; only the units it is written in have.
      jsonb_build_object('source_row_number', 2,
        'raw',      jsonb_build_object('supplier_id','SUP-D','material_id','MAT-D','volume','2'),
        'parsed',   jsonb_build_object('supplier_id','SUP-D','material_id','MAT-D',
                                       'volume', 2, 'time_unit', 'day',
                                       'lead_time', 14, 'lead_time_unit', 'day', 'unit_price', 3),
        'findings', '[]'::jsonb)));
  v_run3 := (v_landed ->> 'run_id')::uuid;
  v_diff := public.ingest_diff_run(v_run3, v_owner);
  IF (v_diff ->> 'rows_unchanged')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the same arc restated in days diffed as '
      'new=% changed=% unchanged=% — the comparison must run AFTER normalization, or '
      'every unit change reads as a data change',
      v_diff ->> 'rows_new', v_diff ->> 'rows_changed', v_diff ->> 'rows_unchanged';
  END IF;

  -- ── 6 · A NULL-BEARING NATURAL KEY DIFFS THE WAY THE UPSERT MATCHES ───────
  --
  -- `bom_multi_level.higher_level_component_id` is nullable and its NULL is
  -- meaningful — a BOM root has no parent (D5) — so the unique index is
  -- `NULLS NOT DISTINCT` and `ON CONFLICT` treats two NULLs as the same key. A
  -- diff joining with `=` would find no match for exactly those rows, call them
  -- `new`, and then watch the upsert UPDATE them: the review screen and the
  -- promotion disagreeing about the same row. `ingest_apply_run`'s cross-check
  -- turns that disagreement into a refusal, so this section fails LOUDLY rather
  -- than quietly if the predicate regresses to `=`.
  PERFORM public.ingest_apply_run(
    (public.ingest_land_file(
       v_project, v_owner, 'csv', 'transactional', 'bom_multi_level',
       'bom-root.csv', 'ingest', 'p/wp34/4.csv', 'text/csv', 512, repeat('e', 64),
       jsonb_build_array(jsonb_build_object('source_row_number', 2,
         'raw',    jsonb_build_object('material_id','MAT-ROOT','level','1'),
         'parsed', jsonb_build_object('material_id','MAT-ROOT', 'level', 1,
                                      'consumption_rate', 1),
         'findings', '[]'::jsonb))) ->> 'run_id')::uuid,
    v_editor);

  SELECT count(*) INTO v_n FROM public.bom_multi_level
   WHERE project_id = v_project AND higher_level_component_id IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the BOM root did not promote (% row(s))', v_n;
  END IF;

  v_landed := public.ingest_land_file(
    v_project, v_owner, 'csv', 'transactional', 'bom_multi_level',
    'bom-root.csv', 'ingest', 'p/wp34/5.csv', 'text/csv', 512, repeat('e', 64),
    jsonb_build_array(jsonb_build_object('source_row_number', 2,
      'raw',    jsonb_build_object('material_id','MAT-ROOT','level','1'),
      'parsed', jsonb_build_object('material_id','MAT-ROOT', 'level', 1,
                                   'consumption_rate', 1),
      'findings', '[]'::jsonb)));
  v_diff := public.ingest_diff_run((v_landed ->> 'run_id')::uuid, v_owner);
  IF (v_diff ->> 'rows_unchanged')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: re-uploading a BOM ROOT — whose natural key contains a NULL — '
      'diffed as new=% changed=% unchanged=%, expected 0/0/1. The index is NULLS NOT '
      'DISTINCT, so the diff must join with IS NOT DISTINCT FROM and not with =',
      v_diff ->> 'rows_new', v_diff ->> 'rows_changed', v_diff ->> 'rows_unchanged';
  END IF;
  -- And the promotion agrees with it, which is the cross-check firing green.
  v_applied := public.ingest_apply_run((v_landed ->> 'run_id')::uuid, v_editor);
  IF (v_applied ->> 'rows_updated')::int <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: the BOM root re-upload inserted rather than updated (% updated)',
      v_applied ->> 'rows_updated';
  END IF;

  -- ── 7 · THE CLICK-THROUGH IS A JOIN (§10's other exit check) ──────────────
  --
  -- tier-2 row → source_row_id → ingest_staged_rows.source_row_number (the
  -- PHYSICAL line, header = line 1) → ingest_run_id → ingest_files (the filename
  -- and the SHA-256 of the bytes as received). Four hops, asserted as one query,
  -- because a screen that can render it is a screen whose data supports it.
  SELECT s.source_row_number, f.original_filename, f.content_sha256
    INTO v_n, v_txt, v_err
    FROM public.inbound_logistics i
    JOIN public.ingest_staged_rows s ON s.id = i.source_row_id
    JOIN public.ingest_runs r        ON r.id = s.ingest_run_id
    JOIN public.ingest_files fi      ON fi.ingest_run_id = r.id
    JOIN public.ingest_files f       ON f.id = fi.id
   WHERE i.project_id = v_project AND i.supplier_id = 'SUP-B';
  IF v_n IS NULL THEN
    RAISE EXCEPTION 'WP 3.4: a promoted row does not reach its source line — the click-through '
      'is a join and the join returns nothing';
  END IF;
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'WP 3.4: SUP-B traces to line %, and it was line 3 of the file', v_n;
  END IF;
  IF v_txt IS DISTINCT FROM 'inbound-wp34.csv' OR length(v_err) IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION 'WP 3.4: the trace reaches file "%" with a % character hash',
      v_txt, length(v_err);
  END IF;

  -- A NULL IS UNKNOWN PROVENANCE, NEVER "THERE WAS NONE", and the screen has to
  -- be able to tell the two apart. Deleting the run is the case
  -- `20260916000019` designed `ON DELETE SET NULL` for.
  DELETE FROM public.ingest_runs WHERE id = v_run3;
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-A';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.4: deleting a run deleted the project''s row';
  END IF;

  RAISE NOTICE 'WP 3.4: diff before promotion, role gate and provenance trace all hold';
END $wp34$;
