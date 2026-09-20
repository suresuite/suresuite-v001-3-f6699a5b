-- WP 6.5a precondition · A REAL UPLOADER CAN LAND A FILE — AND COULD NOT BEFORE.
--
-- This file reproduces production's shape rather than the rehearsal's habit, which is the
-- whole point of D156. Every other file that exercises the landing INSERTs its actor into
-- `auth.users` first — `050`, `060`, `070`, `080`, `090`, `100`, `110`, `120` all do — so
-- each proves the path in a world where `approved_users.id ∈ auth.users.id`. Production has
-- never been in that world: 1 `auth.users` row, 14 approved users, overlap ZERO.
--
-- So §1 creates an uploader who exists ONLY in `approved_users`, exactly as all fourteen
-- real ones do, and lands a file as them. Before `20260919000012` that raises
-- `foreign_key_violation`; after it, it works. §2 pins the keys themselves, and §3 pins the
-- `ON DELETE SET NULL` semantics — deleting a person must not delete the record of what
-- they did.

DO $wp65pre$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_run     uuid;
  v_landed  jsonb;
  v_user2   uuid := gen_random_uuid();
  v_run2    uuid;
  v_seen    uuid;
  v_rows    integer;
BEGIN
  -- ══ §1 · an uploader who is NOT in auth.users can land a file ══
  --
  -- NOTE WHAT IS DELIBERATELY ABSENT: no `INSERT INTO auth.users`. That single omission is
  -- the difference between this file and every other landing rehearsal, and it is the
  -- difference between the rehearsal suite and production.
  INSERT INTO public.approved_users (id, name, email, password_hash, role) VALUES
    (v_user,  'WP65 uploader', 'wp65@example.invalid',  'x', 'user'),
    -- A second actor who triggers a run and uploads no file. §3 needs one (see the note
    -- there): the uploader from §1 cannot be deleted at all, which is D161.
    (v_user2, 'WP65 trigger',  'wp65b@example.invalid', 'x', 'user');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP65 landing', v_user, 'WP65');

  IF NOT public.ingest_target_is_promotable('suppliers') THEN
    RAISE EXCEPTION 'WP 6.5a/320 §1: `suppliers` is not a promotable target, so this file cannot ask its question';
  END IF;

  -- Positional, matching the other landing rehearsals: the signature is
  -- (project, actor, source_kind, fact_class, target, filename, bucket, path,
  --  content_type, bytes, sha256, rows).
  v_landed := public.ingest_land_file(
    v_project, v_user, 'csv', 'master', 'suppliers',
    'wp65.csv', 'ingest', 'wp65/wp65.csv', 'text/csv', 42,
    repeat('a', 64), '[]'::jsonb);

  v_run := (v_landed ->> 'run_id')::uuid;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'WP 6.5a/320 §1: the landing returned no run id — it returned %', v_landed;
  END IF;

  -- And the run RECORDS them, which is the half `audit-actor` is about: a landing that
  -- succeeded while forgetting who did it would satisfy the foreign key and defeat the
  -- invariant.
  SELECT triggered_by_user_id INTO v_seen FROM public.ingest_runs WHERE id = v_run;
  IF v_seen IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION
      'WP 6.5a/320 §1: the run records % as its actor, expected % — the landing worked and the attribution did not',
      coalesce(v_seen::text, 'NULL'), v_user;
  END IF;

  RAISE NOTICE 'WP 6.5a/320 §1: an uploader who exists only in approved_users landed a file, and the run names them';

  -- ══ §2 · the keys point at approved_users and NOT at auth.users ══
  SELECT count(*) INTO v_rows
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class fre ON fre.oid = con.confrelid
    JOIN pg_namespace fns ON fns.oid = fre.relnamespace
   WHERE con.contype = 'f' AND rel.relname = 'ingest_runs'
     AND fns.nspname = 'auth' AND fre.relname = 'users';

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'WP 6.5a/320 §2: ingest_runs still carries % foreign key(s) to auth.users — a real uploader cannot be recorded (D156)',
      v_rows;
  END IF;

  SELECT count(*) INTO v_rows
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class fre ON fre.oid = con.confrelid
    JOIN pg_namespace fns ON fns.oid = fre.relnamespace
   WHERE con.contype = 'f' AND rel.relname = 'ingest_runs'
     AND fns.nspname = 'public' AND fre.relname = 'approved_users';

  IF v_rows <> 2 THEN
    RAISE EXCEPTION
      'WP 6.5a/320 §2: ingest_runs has % foreign key(s) to approved_users, expected 2 — dropping the old keys without adding these leaves the actor columns unconstrained',
      v_rows;
  END IF;

  RAISE NOTICE 'WP 6.5a/320 §2: both actor columns key to approved_users, neither to auth.users';

  -- ══ §3 · ON DELETE SET NULL — the record outlives the person ══
  --
  -- `CASCADE` here would mean that removing somebody erases what they did, which is the
  -- opposite of what an audit trail is for. This asserts the SEMANTICS rather than the
  -- keyword, because a keyword is what a later migration changes by accident.
  --
  -- TWO TRAPS, BOTH HIT BY THE FIRST DRAFT AND BOTH WORTH THE COMMENT.
  --
  -- (1) The PROJECT must stay. `ingest_runs.project_id` is `ON DELETE CASCADE` from
  --     `projects` — correctly, a run belongs to a project — so deleting the project
  --     deletes the run and this section would report a CASCADE on the actor key that is
  --     not there. Two cascades in one assertion, and the error accused the wrong one.
  --
  -- (2) The run used here is one with NO FILE, and that is not tidiness — it is §4 D161.
  --     `ingest_files.uploaded_by` is also `ON DELETE SET NULL`, and `ingest_files` is
  --     TIER 0 and write-once, enforced by `ingest_files_write_once()`. So deleting a user
  --     who has ever uploaded a file makes PostgreSQL attempt an UPDATE on a tier-0 row and
  --     the trigger REFUSES it: **that user cannot be deleted at all.** Using the landed
  --     run from §1 here would have measured that collision instead of this key. It is
  --     recorded as its own defect rather than worked around silently.
  INSERT INTO public.ingest_runs (project_id, source_kind, triggered_by, triggered_by_user_id)
    VALUES (v_project, 'csv', 'manual', v_user2)
    RETURNING id INTO v_run2;

  DELETE FROM public.approved_users WHERE id = v_user2;

  SELECT count(*) INTO v_rows FROM public.ingest_runs WHERE id = v_run2;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'WP 6.5a/320 §3: deleting the actor removed the run — the actor key must be ON DELETE SET NULL, not CASCADE';
  END IF;

  SELECT triggered_by_user_id INTO v_seen FROM public.ingest_runs WHERE id = v_run2;
  IF v_seen IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.5a/320 §3: the run still names a deleted user (%)', v_seen;
  END IF;

  RAISE NOTICE 'WP 6.5a/320 §3: deleting the actor leaves the run with an unknown actor rather than deleting it';

  -- ══ §4 · D161, PINNED AS THE COLLISION IT IS ══
  --
  -- The uploader from §1 has an `ingest_files` row, so deleting them is refused by the
  -- tier-0 write-once trigger rather than by anything about identity. This asserts that
  -- refusal so the defect cannot be "fixed" by accident without this file noticing, and so
  -- the day somebody decides what erasure means for tier-0 provenance, the assertion tells
  -- them which decision they changed.
  BEGIN
    DELETE FROM public.approved_users WHERE id = v_user;
    RAISE EXCEPTION
      'WP 6.5a/320 §4: a user with an ingest_files row WAS deleted. D161 says the tier-0 write-once trigger refuses the SET NULL that deletion requires — if that changed, the tier-0 immutability rule or the key changed with it, and this file needs rewriting rather than passing.';
  EXCEPTION WHEN restrict_violation THEN
    -- `ingest_files_write_once()` raises `USING ERRCODE = 'restrict_violation'`
    -- (`20260916000013`). The first draft caught `raise_exception` — the default for a bare
    -- RAISE — so it caught nothing and the error escaped the block, which is how this was
    -- found. The message is checked as well as the code, so an unrelated
    -- `restrict_violation` cannot read as this one.
    IF position('tier 0' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'WP 6.5a/320 §4: a user who has uploaded a file cannot be deleted — D161, pinned not fixed';

  RAISE NOTICE 'WP 6.5a · 320: a real uploader can land, both keys point at approved_users, and the record outlives the person; D161 pinned — 4 section(s)';
END $wp65pre$;
