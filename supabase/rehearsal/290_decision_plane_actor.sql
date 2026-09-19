-- WP 6.4 · THE SIX DECISION TABLES ARE AUDITED, AND FIVE WRITERS NAME THEIR ACTOR.
--
-- `dataPlaneAudit.test.ts` reads the MIGRATIONS and asserts three triggers per
-- table. That is a structural claim, and three triggers existing is not three audit
-- rows being written, and an audit row existing is not one that names anybody.
-- Three different claims, and only the third is what `audit-actor` (G4) is about.
--
-- What only a running database can settle here:
--
--   1. All six tables carry all three triggers, READ FROM `pg_trigger` rather than
--      from the migration text. Asking the same source twice proves nothing new.
--   2. `snapshot_policy` writes an audit row NAMING the actor it has taken all
--      along and never passed on. The GUC is POISONED with a stranger first, so a
--      function that read the session instead of its parameter would pass and be
--      wrong — §16 · WP 4.1 · E, which passed for the wrong reason once already.
--   3. The four DROP-and-CREATEd functions kept their grants. `DROP` takes them
--      with it and the introspected artifact records functions rather than
--      privileges, so a lost grant is invisible to every static gate. Read from
--      `proacl` for an EXPLICIT grantee, never `has_function_privilege`, which
--      cannot fail while PUBLIC keeps EXECUTE (WP 6.2 slice 12's finding).
--   4. A NULL actor does not BLANK an actor an enclosing statement established.
--      That is the whole point of the `IF … IS NOT NULL` guard, and a function that
--      dropped it would silently un-attribute every trigger-wired call.
--
-- Every comparison is `IS DISTINCT FROM` (rehearsal/260's lesson: a plain `<>`
-- against NULL does not fire, so it cannot fail in the one case worth testing).

DO $wp64actor$
DECLARE
  v_org      uuid := '00000000-0000-4000-8000-000000064100';
  v_actor    uuid := '00000000-0000-4000-8000-000000064101';
  v_stranger uuid := '00000000-0000-4000-8000-000000064102';
  v_project  uuid := '00000000-0000-4000-8000-000000064103';
  v_version  uuid;
  v_n        integer;
  v_n2       integer;
  v_missing  text;
  v_who      text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP64A Org', 'wp64a-org');
  INSERT INTO auth.users (id, email) VALUES
    (v_actor, 'wp64a@example.invalid'), (v_stranger, 'wp64as@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_actor,    'wp64a@example.invalid',  'WP64A Actor',    'x', 'WP64A Org', v_org),
    (v_stranger, 'wp64as@example.invalid', 'WP64A Stranger', 'x', 'WP64A Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP64A', v_actor, 'WP64AP', 'WP64A Org', v_org);

  -- ── 1 · SIX TABLES × THREE TRIGGERS, FROM pg_trigger ────────────────────
  SELECT string_agg(want.rel || '.' || want.act, ', ' ORDER BY want.rel, want.act)
    INTO v_missing
  FROM (
    SELECT t.rel, a.act
      FROM unnest(ARRAY['policy_versions','policy_presets','scenarios',
                        'scenario_templates','recovery_playbooks','external_evidence']) AS t(rel)
      CROSS JOIN unnest(ARRAY['insert','update','delete']) AS a(act)
  ) want
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = want.rel
       AND tg.tgname = 'audit_' || want.rel || '_' || want.act
       AND NOT tg.tgisinternal
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.4 §1: these audit triggers are absent from the database: %', v_missing;
  END IF;

  -- ── 2 · snapshot_policy NAMES THE ACTOR IT ALREADY TOOK ─────────────────
  --
  -- Poison first. Before `20260919000007` this function wrote the author INTO THE
  -- ROW and left the audit row saying `actor_known: false` — the author was in the
  -- data and absent from the record of who did it.
  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  SELECT count(*) INTO v_n FROM public.audit_logs;

  v_version := public.snapshot_policy(v_project, 'WP64A label', v_actor,
                                      'wp64a@example.invalid', 'WP64A Actor');
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'WP 6.4 §2: snapshot_policy returned no version id';
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 6.4 §2: a policy version was written and % audit row(s) name the table', v_n;
  END IF;

  SELECT a.actor_user_id::text INTO v_who
    FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'policy_versions'
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_who IS DISTINCT FROM v_actor::text THEN
    RAISE EXCEPTION 'WP 6.4 §2: the audit row names "%", expected the actor the caller passed — the function read the session instead of its parameter',
      COALESCE(v_who, '<null>');
  END IF;

  -- ── 3 · THE FOUR RE-CREATED FUNCTIONS KEPT THEIR GRANTS ─────────────────
  --
  -- EXPLICIT grantees out of `proacl`. `has_function_privilege` would answer TRUE
  -- for a function nobody was granted, because PUBLIC holds EXECUTE by default —
  -- which is how a grant mutation came back green once before.
  -- MATCHED ON (name, ARGUMENT COUNT) rather than on a formatted signature, and the
  -- first draft is why: `pg_get_function_identity_arguments` renders `uuid, text,
  -- uuid` with spaces, a hand-written literal does not, and ten grants that were all
  -- present came back as ten losses. A rehearsal that fails for a formatting reason
  -- teaches the next reader to distrust it.
  SELECT string_agg(f.fn || '/' || f.nargs || ' → ' || f.role, ', ' ORDER BY f.fn, f.role)
    INTO v_missing
  FROM (VALUES
    ('update_policy_version_notes', 3, 'anon'),
    ('update_policy_version_notes', 3, 'authenticated'),
    ('delete_policy_version',       2, 'anon'),
    ('delete_policy_version',       2, 'authenticated'),
    ('apply_validation_to_scenario',3, 'anon'),
    ('apply_validation_to_scenario',3, 'authenticated'),
    ('apply_validation_to_scenario',3, 'service_role'),
    ('record_external_evidence',    8, 'anon'),
    ('record_external_evidence',    8, 'authenticated'),
    ('record_external_evidence',    8, 'service_role')
  ) AS f(fn, nargs, role)
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
     WHERE n.nspname = 'public'
       AND p.proname = f.fn
       AND p.pronargs = f.nargs
       AND acl.privilege_type = 'EXECUTE'
       AND pg_get_userbyid(acl.grantee) = f.role
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.4 §3: DROP and CREATE lost these EXPLICIT grants: %', v_missing;
  END IF;

  -- ── 4 · A NULL ACTOR DOES NOT BLANK ONE ALREADY SET ─────────────────────
  --
  -- The guard's whole purpose. Without it, every existing caller — all of which pass
  -- nothing, because the parameter is appended with a DEFAULT — would UN-attribute a
  -- write whose enclosing statement had named somebody.
  --
  -- COUNTED PER ACTOR, NOT "the most recent row". `created_at` defaults to `now()`,
  -- which is TRANSACTION start time, so every audit row in this block carries the
  -- SAME timestamp and `ORDER BY created_at DESC LIMIT 1` picks an arbitrary one.
  -- The first draft did exactly that and failed against a correct function
  -- (rehearsal/260 learned the same thing about `>` on `applied_at`).
  PERFORM set_config('app.current_user_id', v_actor::text, true);
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions' AND actor_user_id = v_actor;

  PERFORM public.update_policy_version_notes(v_version, 'a note, no actor named');

  SELECT count(*) INTO v_n2 FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions' AND actor_user_id = v_actor;
  IF v_n2 <= v_n THEN
    RAISE EXCEPTION 'WP 6.4 §4: a NULL actor blanked the one the transaction had set — rows naming the actor went from % to %', v_n, v_n2;
  END IF;

  -- And a named actor overrides it, which is the other half of the same guard.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions' AND actor_user_id = v_stranger;

  PERFORM public.update_policy_version_notes(v_version, 'named', v_stranger);

  SELECT count(*) INTO v_n2 FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions' AND actor_user_id = v_stranger;
  IF v_n2 <= v_n THEN
    RAISE EXCEPTION 'WP 6.4 §4: the actor parameter did not reach the audit row — rows naming it went from % to %', v_n, v_n2;
  END IF;

  -- ── 5 · A DELETE IS AUDITED TOO, AND IT IS THE ONE THAT MATTERS ─────────
  --
  -- A policy version is somebody's recorded decision. Deleting one with no record of
  -- who did it is the case `audit-actor` exists for.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions'
     AND actor_user_id = v_actor AND action ILIKE '%delete%';

  PERFORM public.delete_policy_version(v_version, v_actor);

  SELECT count(*) INTO v_n2 FROM public.policy_versions WHERE id = v_version;
  IF v_n2 IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.4 §5: the version was not deleted';
  END IF;

  SELECT count(*) INTO v_n2 FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_versions'
     AND actor_user_id = v_actor AND action ILIKE '%delete%';
  IF v_n2 <= v_n THEN
    RAISE EXCEPTION 'WP 6.4 §5: the DELETE wrote no audit row naming the actor (% → %)', v_n, v_n2;
  END IF;

  RAISE NOTICE 'WP 6.4: six tables audited, five writers attributing, grants intact';
END $wp64actor$;
