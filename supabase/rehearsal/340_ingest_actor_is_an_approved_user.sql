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
  v_file    jsonb;
BEGIN
  -- ══ §1 · an uploader who is NOT in auth.users can land a file ══
  --
  -- NOTE WHAT IS DELIBERATELY ABSENT: no `INSERT INTO auth.users`. That single omission is
  -- the difference between this file and every other landing rehearsal, and it is the
  -- difference between the rehearsal suite and production.
  INSERT INTO public.approved_users (id, name, email, password_hash, role) VALUES
    (v_user,  'WP65 uploader', 'wp65@example.invalid',  'x', 'user'),
    -- A second actor who triggers a run and uploads no file. §3 needs one (see the note
    -- there): deleting the uploader from §1 is D161's question, answered in §4.
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
  --     the trigger REFUSED it: **that user could not be deleted at all.** Using the landed
  --     run from §1 here would have measured that collision instead of this key. It was
  --     recorded as its own defect rather than worked around silently, and §4 is where
  --     its decision (WP 7.2 (a), `20260930000007`) is asserted.
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

  -- ══ §4 · D161, DECIDED: THE UPLOADER IS ANONYMISED, THE FILE IS NOT TOUCHED ══
  --
  -- Until `20260930000007` this section asserted the COLLISION: the uploader from §1 has
  -- an `ingest_files` row, so deleting them was refused by the tier-0 write-once trigger
  -- rather than by anything about identity. It was pinned so that the day somebody
  -- decided what erasure means for tier-0 provenance, this file would say which decision
  -- they changed — and it did, the first time it ran against that migration.
  --
  -- The decision is WP 7.2's option (a): content is immutable, the ACTOR may be
  -- anonymised. So the delete now succeeds, and what this asserts is the half that keeps
  -- tier 0 meaning something: the file row survives with `uploaded_by` NULL and every
  -- other column exactly as it was. `rehearsal/480` §2 asserts the other half — that the
  -- guard still refuses the same UPDATE while the uploader's account exists.
  SELECT to_jsonb(f) - 'uploaded_by' INTO v_file
    FROM public.ingest_files f JOIN public.ingest_runs r ON r.id = f.ingest_run_id
   WHERE r.id = v_run;

  DELETE FROM public.approved_users WHERE id = v_user;

  SELECT count(*) INTO v_rows
    FROM public.ingest_files f
   WHERE f.ingest_run_id = v_run
     AND f.uploaded_by IS NULL
     AND (to_jsonb(f) - 'uploaded_by') = v_file;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'WP 6.5a/320 §4: after deleting the uploader, the landed file is gone, still names them, or changed in some other column — WP 7.2 (a) anonymises the actor and nothing else (D161)';
  END IF;

  RAISE NOTICE 'WP 6.5a/320 §4: deleting the uploader leaves the tier-0 file intact with an unknown uploader — D161, decided as WP 7.2 (a)';

  RAISE NOTICE 'WP 6.5a · 320: a real uploader can land, both keys point at approved_users, and the record outlives the person; D161 decided as (a) — 4 section(s)';
END $wp65pre$;
