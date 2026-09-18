-- D59 · an inline column CHECK REACHES THE DATABASE, and D49's other two
-- indexes are NOT in it.
--
-- `introspect.mjs` read a column's type, its NOT NULL and its DEFAULT and threw
-- the rest away, so 65 CHECKs written inline across the migration history were
-- recorded nowhere. `rehearsal-schema.mjs` rebuilds constraints FROM the
-- artifact, so the rehearsed database did not refuse what production refuses —
-- and an assertion that a bad value is rejected passed against the migration
-- and failed against the artifact. That is why `20260916000014` writes every
-- NEW check table-level; a convention is not a gate, and it did nothing for the
-- 65 already written.
--
-- ── WHY THIS FILE DETECTS ITS OWN BASE FIRST ──────────────────────────────
--
-- Same shape as `170`, and for the same reason: the fix is to the INTROSPECTOR,
-- and `contract:rehearse` builds its base from the BASE BRANCH's artifact. In
-- plain and `--fixtures` mode the three `ingest_files` CHECKs are legitimately
-- absent until this merges; only `--since HEAD` can see them. So §1 branches on
-- how many are present — all three, assert; none, say plainly that the base
-- predates the fix; some, raise, because a partial set cannot be a stale base.
--
-- The skip is only safe because the parse is gated with NO DATABASE at all, by
-- `introspectorDependents.test.ts`. That gate was written and mutation-tested
-- FIRST. Slice 8 justified this same skip with a static test that did not yet
-- exist, and reverting the introspector left its rehearsal green in every mode.

DO $d59$
DECLARE
  v_present integer;
  v_user    uuid := '00000000-0000-4000-8000-0000000d5900';
  v_project uuid := '00000000-0000-4000-8000-0000000d5901';
  v_run     uuid := '00000000-0000-4000-8000-0000000d5902';
  v_refused boolean;
  v_bad     text;
BEGIN
  -- ── 1 · the three CHECKs `ingest_files` lost are on the table ───────────
  --
  -- Read from `pg_constraint`, not from the artifact: the artifact is the thing
  -- that was wrong, so asking it whether it is right now proves nothing.
  SELECT count(*) INTO v_present
  FROM pg_constraint con
  JOIN pg_class      rel ON rel.oid = con.conrelid
  JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
  WHERE con.contype = 'c'
    AND ns.nspname  = 'public'
    AND rel.relname = 'ingest_files'
    AND (pg_get_constraintdef(con.oid) LIKE '%source_kind%'
      OR pg_get_constraintdef(con.oid) LIKE '%byte_size%'
      OR pg_get_constraintdef(con.oid) LIKE '%content_sha256%');

  IF v_present = 0 THEN
    RAISE NOTICE
      'D59 · 180 · SKIPPED: none of `ingest_files`'' three inline CHECKs are '
      'present, so this base was built from an artifact that predates the fix '
      '(plain/--fixtures build from the BASE branch artifact). `--since HEAD` '
      'is the mode that proves it, and `introspectorDependents.test.ts` gates '
      'the parse with no database at all.';
  ELSIF v_present <> 3 THEN
    RAISE EXCEPTION
      'D59 §1 — % of `ingest_files`'' three inline CHECKs are present. A PARTIAL '
      'set cannot be a stale base: a base either predates the fix or carries it. '
      'This is a regression in the inline-CHECK parse or in `emitConstraints`.', v_present;
  ELSE
    -- ── 2 · and each one REFUSES the value it exists to refuse ────────────
    --
    -- Existence is not enforcement. A CHECK that is recorded, emitted and then
    -- created NOT VALID would satisfy §1 and reject nothing.
    INSERT INTO public.approved_users (id, email, name, password_hash)
      VALUES (v_user, 'd59@example.invalid', 'D59', 'x');
    INSERT INTO public.projects (id, name, modeler_id, plant_name)
      VALUES (v_project, 'D59', v_user, 'P');
    INSERT INTO public.ingest_runs (id, project_id, source_kind, triggered_by)
      VALUES (v_run, v_project, 'csv', 'manual');

    -- source_kind's vocabulary
    v_refused := false;
    BEGIN
      INSERT INTO public.ingest_files
        (ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
         byte_size, content_sha256, uploaded_by)
      VALUES (v_run, 'spreadsheet', 'a.csv', 'b', 'p/1', 10, repeat('a', 64), v_user);
    EXCEPTION WHEN check_violation THEN v_refused := true;
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'D59 §2 — `ingest_files.source_kind` accepted ''spreadsheet''. '
                      'The CHECK is recorded but does not bite.';
    END IF;

    -- byte_size >= 0
    v_refused := false;
    BEGIN
      INSERT INTO public.ingest_files
        (ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
         byte_size, content_sha256, uploaded_by)
      VALUES (v_run, 'csv', 'a.csv', 'b', 'p/2', -1, repeat('a', 64), v_user);
    EXCEPTION WHEN check_violation THEN v_refused := true;
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'D59 §2 — `ingest_files.byte_size` accepted -1.';
    END IF;

    -- the SHA-256 shape
    v_refused := false;
    BEGIN
      INSERT INTO public.ingest_files
        (ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
         byte_size, content_sha256, uploaded_by)
      VALUES (v_run, 'csv', 'a.csv', 'b', 'p/3', 10, 'NOT-A-DIGEST', v_user);
    EXCEPTION WHEN check_violation THEN v_refused := true;
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION 'D59 §2 — `ingest_files.content_sha256` accepted ''NOT-A-DIGEST''.';
    END IF;

    -- and the good row lands, or the CHECKs are refusing everything
    INSERT INTO public.ingest_files
      (ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
       byte_size, content_sha256, uploaded_by)
    VALUES (v_run, 'csv', 'a.csv', 'b', 'p/4', 10, repeat('a', 64), v_user);

    RAISE NOTICE 'D59 · 180 §2 — three inline CHECKs present and each one refuses.';
  END IF;

  -- ── 3 · the two indexes that CANNOT exist are not in this database ──────
  --
  -- This half needs no base detection: it asserts an ABSENCE, and the base that
  -- predates the fix has them while every corrected one does not — so a stale
  -- base FAILS here, which is the right way round. `20250909153130` indexes
  -- `supply_chain_data_multi_tier(material_id)`, a column that table has never
  -- had in any definition; PostgreSQL raises 42703 and the file rolls back.
  SELECT string_agg(i.relname, ', ' ORDER BY i.relname) INTO v_bad
  FROM pg_class i
  JOIN pg_namespace ns ON ns.oid = i.relnamespace
  WHERE ns.nspname = 'public'
    AND i.relkind  = 'i'
    AND i.relname IN ('idx_supply_chain_data_multi_tier_material_id',
                      'idx_supply_chain_data_multi_tier_higher_level_component_id');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'D49 §3 — % exists. It names a column `supply_chain_data_multi_tier` has '
      'never had, so PostgreSQL could not have created it and neither should '
      'this base. `20250909153130` aborted; `20250909153231` is its retry.', v_bad;
  END IF;

  -- ── 4 · and the ONE index a rename really did move is on the new name ───
  SELECT pg_get_indexdef(i.oid) INTO v_bad
  FROM pg_class i
  JOIN pg_namespace ns ON ns.oid = i.relnamespace
  WHERE ns.nspname = 'public' AND i.relkind = 'i'
    AND i.relname = 'idx_supply_chain_data_plant';
  IF v_bad IS NULL THEN
    RAISE NOTICE 'D49 · 180 §4 · SKIPPED: `idx_supply_chain_data_plant` is absent '
                 '— a base built before the rename was followed skips it.';
  ELSIF v_bad NOT LIKE '%plant_name%' THEN
    RAISE EXCEPTION 'D49 §4 — `idx_supply_chain_data_plant` is %, not on `plant_name`. '
                    '`20250822025432` renamed the column and PostgreSQL renames the '
                    'index entry with it.', v_bad;
  ELSE
    RAISE NOTICE 'D49 · 180 §4 — the index follows the rename: %', v_bad;
  END IF;
END
$d59$;
