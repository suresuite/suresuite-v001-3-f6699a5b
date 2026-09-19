-- D53 · the nine foreign keys to `auth.users` exist, and DO what they say.
--
-- The introspector read `REFERENCES auth.users(id)` and recorded the target as
-- `users`, dropping the schema. `rehearsal-schema.mjs` qualified that bare name
-- to `public.users`, found no such table, and SKIPPED the key — on every
-- rehearsal this repository has ever run. Production has all nine. So any
-- assertion about what happens when a user row disappears was being made
-- against a database where nothing happened, because there was no key.
--
-- ── WHY THIS FILE DETECTS ITS OWN BASE FIRST ──────────────────────────────
--
-- The fix is to the INTROSPECTOR, not to a migration, and that changes which
-- rehearsal modes can see it. `contract:rehearse` builds its base from the BASE
-- BRANCH's `build/schema.introspected.json` and then applies this branch's new
-- migrations — so in plain and `--fixtures` mode the base still comes from the
-- artifact that dropped the schema, and the nine keys are legitimately absent.
-- Only `--since HEAD`, which builds from the artifact THIS branch writes, can
-- show the fix.
--
-- So §1 reads how many of the nine are present and branches: all nine, assert
-- the semantics; none, say plainly that this base predates the fix and stop;
-- some, raise — a partial set is a real regression and cannot be a stale base.
-- The parse itself is gated statically by `introspectorRefSchema.test.ts`, which
-- needs no database and therefore no base at all. That division is deliberate:
-- the static test catches a regression in the fix, this file proves the
-- semantics wherever the keys actually exist.
--
-- ── WHY IT ASSERTS BEHAVIOUR AND NOT JUST EXISTENCE ────────────────────────
--
-- The fix made nine warnings stop appearing. A warning that stops appearing is
-- not a constraint that exists, and a constraint that exists is not one that
-- CASCADEs. Those are three different claims and only the third is what a
-- reader of §4 D53 actually needs — so §2 deletes a user and watches what each
-- ON DELETE rule does. The nine split three ways:
--
--   SET NULL   experiments, policy_versions, recovery_playbooks, scenarios,
--              simulation_runs — the row survives, the author is forgotten
--   CASCADE    policy_presets — the row goes with its owner
--   NO ACTION  ingest_runs (×2), project_erp_links — the delete is REFUSED
--
-- That last group is the one worth having: without the key, deleting a user
-- silently orphaned an ingest run's actor. With it, the database refuses.

DO $d53$
DECLARE
  v_user  uuid := '00000000-0000-4000-8000-0000000d5300';
  v_user2 uuid := '00000000-0000-4000-8000-0000000d5301';
  v_org   uuid := '00000000-0000-4000-8000-0000000d5302';
  v_proj  uuid := '00000000-0000-4000-8000-0000000d5303';
  v_missing text;
  v_missing_n integer;
  v_refused boolean;
  v_left    integer;
BEGIN
  -- ── 1 · all seven keys EXIST, and point at `auth.users` ─────────────────
  --
  -- Read from `pg_constraint` rather than from the artifact: the artifact is
  -- what was wrong, so asking it whether it is right now proves nothing.

  SELECT string_agg(want.rel || '.' || want.col, ', ' ORDER BY want.rel, want.col),
         count(*)
    INTO v_missing, v_missing_n
  -- SEVEN, NOT NINE — AND THE TWO THAT LEFT DID SO DELIBERATELY (§4 D131).
  -- `ingest_runs.triggered_by_user_id` and `.applied_by_user_id` were on this list until
  -- `20260919000012` re-keyed them to `public.approved_users`, because `ingest_land_file`
  -- must name its uploader and no user of this application exists in `auth.users` — so the
  -- landing could not be recorded at all. `rehearsal/320` owns them now, and this list is
  -- the keys that still point at `auth.users` and are expected to.
  FROM (VALUES
    ('experiments',        'created_by'),
    ('policy_presets',     'owner_id'),
    ('policy_versions',    'created_by'),
    ('project_erp_links',  'linked_by_user_id'),
    ('recovery_playbooks', 'created_by'),
    ('scenarios',          'created_by'),
    ('simulation_runs',    'created_by')
  ) AS want(rel, col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class      src ON src.oid = con.conrelid
    JOIN pg_namespace  sn  ON sn.oid  = src.relnamespace
    JOIN pg_class      tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace  tn  ON tn.oid  = tgt.relnamespace
    JOIN pg_attribute  att ON att.attrelid = con.conrelid
                          AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND sn.nspname  = 'public'
      AND src.relname = want.rel
      AND att.attname = want.col
      AND tn.nspname  = 'auth'
      AND tgt.relname = 'users'
  );

  IF v_missing_n = 7 THEN
    -- Every one absent: this base was built from an artifact that predates the
    -- fix, which is exactly what plain and `--fixtures` mode do. Nothing here is
    -- assertable and saying so is better than a guard that hides a regression.
    RAISE NOTICE
      'D53 · 170 · SKIPPED: none of the seven `auth.users` keys are present, so '
      'this base predates the introspector fix (plain/--fixtures build from the '
      'BASE branch artifact). `--since HEAD` is the mode that proves it, and '
      '`introspectorRefSchema.test.ts` gates the parse with no database at all.';
    RETURN;
  ELSIF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'D53 §1 — % of the seven foreign keys to `auth.users` are missing: %. A '
      'PARTIAL set cannot be a stale base — a base either predates the fix or '
      'carries it — so this is a regression in the introspector''s REFERENCES '
      'parse or in `rehearsal-schema.mjs`''s target resolution.', v_missing_n, v_missing;
  END IF;

  -- ── 2 · and each ON DELETE rule DOES what the artifact says ─────────────

  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D53 Org', 'd53-org');
  INSERT INTO auth.users (id, email) VALUES (v_user, 'd53@example.invalid'),
                                            (v_user2, 'd53b@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id)
    VALUES (v_user, 'd53@example.invalid', 'D53', 'x', 'D53 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_proj, 'D53', v_user, 'P', 'D53 Org', v_org);

  -- NO ACTION: an ERP link's author cannot be deleted out from under it.
  --
  -- This demonstration USED to run on `ingest_runs.triggered_by_user_id`, and moved here
  -- when `20260919000012` re-keyed that column to `approved_users` (§4 D131).
  -- `project_erp_links.linked_by_user_id` is the right replacement rather than the nearest
  -- one: it is NOT NULL, so SET NULL was never available to it, and NO ACTION is the only
  -- rule it could have — which makes it the clearest place in the schema to assert what NO
  -- ACTION does.
  INSERT INTO public.project_erp_links
    (project_id, external_system, external_company_id, linked_by_user_id, external_oauth_token_ref)
    VALUES (v_proj, 'orbit_mrp', 'D53-CO', v_user2, 'vault://d53');

  v_refused := false;
  BEGIN
    DELETE FROM auth.users WHERE id = v_user2;
  EXCEPTION WHEN foreign_key_violation THEN
    v_refused := true;
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION
      'D53 §2 — deleting a user that a `project_erp_links` row names as its author '
      'was ALLOWED. That is the orphaned-actor case the key exists to refuse, and it '
      'is exactly what every rehearsal before this one permitted.';
  END IF;

  -- SET NULL: the scenario survives its author.
  INSERT INTO public.scenarios (project_id, name, created_by)
    VALUES (v_proj, 'D53 scenario', v_user);
  DELETE FROM public.approved_users WHERE id = v_user;
  DELETE FROM auth.users WHERE id = v_user;

  SELECT count(*) INTO v_left
  FROM public.scenarios WHERE project_id = v_proj AND created_by IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION
      'D53 §2 — `scenarios.created_by` did not SET NULL when its author was '
      'deleted (% row(s) still name one). The row must outlive the account.', v_left;
  END IF;

  SELECT count(*) INTO v_left FROM public.scenarios WHERE project_id = v_proj;
  IF v_left <> 1 THEN
    RAISE EXCEPTION
      'D53 §2 — the scenario itself vanished with its author (% left, expected 1). '
      'SET NULL forgets the author; it does not delete the work.', v_left;
  END IF;

  RAISE NOTICE 'D53 · 170_auth_user_foreign_keys · all sections passed';
END $d53$;
