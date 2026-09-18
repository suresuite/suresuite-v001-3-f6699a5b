-- WP 6.4 · the disruption plane writes audit rows, at statement grain, naming
-- the actor — and the profile CASCADE writes one per child table.
--
-- `dataPlaneAudit.test.ts` reads the MIGRATIONS and asserts that each of these
-- five tables has three triggers. That is a structural claim. Three triggers
-- existing is not three audit rows being written, and an audit row existing is
-- not one that names anybody — three different claims, and only the third is
-- what `audit-actor` (G4) is about.
--
-- §3 is the one that could not be written before this package: a DELETE of one
-- profile cascades into `_targets`, `_effects` and `_settings`, so ONE statement
-- by a person removes rows from four tables. Before WP 6.4 described them, three
-- of those four were deferred and therefore unaudited, and the cascade left no
-- record at all (D54).

DO $wp64$
DECLARE
  v_org      uuid := '00000000-0000-4000-8000-000000064000';
  v_actor    uuid := '00000000-0000-4000-8000-000000064001';
  v_stranger uuid := '00000000-0000-4000-8000-000000064002';
  v_project  uuid := '00000000-0000-4000-8000-000000064003';
  v_profile  uuid := '00000000-0000-4000-8000-000000064004';
  v_before   integer;
  v_n        integer;
  v_missing  text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'WP64 Org', 'wp64-org');
  INSERT INTO auth.users (id, email) VALUES
    (v_actor, 'wp64@example.invalid'), (v_stranger, 'wp64s@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_actor,    'wp64@example.invalid',  'WP64 Actor',    'x', 'WP64 Org', v_org),
    (v_stranger, 'wp64s@example.invalid', 'WP64 Stranger', 'x', 'WP64 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'WP64', v_actor, 'WP64P', 'WP64 Org', v_org);

  -- ── 1 · all five tables carry all three triggers ────────────────────────
  --
  -- Read from `pg_trigger`, not from the migration text. The static test already
  -- reads the migrations; asking the same source twice proves nothing new.
  SELECT string_agg(want.rel || '.' || want.act, ', ' ORDER BY want.rel, want.act)
    INTO v_missing
  FROM (
    SELECT t.rel, a.act
    FROM unnest(ARRAY['disruption_scenarios','disruption_scenario_profiles',
                      'disruption_scenario_targets','disruption_scenario_effects',
                      'disruption_scenario_settings']) AS t(rel)
    CROSS JOIN unnest(ARRAY['insert','update','delete']) AS a(act)
  ) AS want
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c  ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = want.rel
      AND tg.tgname = 'audit_' || want.rel || '_' || want.act
      AND NOT tg.tgisinternal
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'WP 6.4 §1 — missing audit trigger(s): %', v_missing;
  END IF;

  -- ── 2 · a write produces ONE row, at statement grain, naming the actor ──
  --
  -- The GUC is poisoned with a stranger first: `set_config(..., true)` is
  -- transaction-local and this file is one transaction, so a row naming the
  -- actor could otherwise be a value left lying around by an earlier section.
  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  PERFORM set_config('app.current_user_id', v_actor::text, true);

  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'disruption_scenario_profiles';

  INSERT INTO public.disruption_scenario_profiles
    (id, project_id, plant_name, scenario_name, created_by, organization)
  VALUES (v_profile, v_project, 'WP64P', 'WP64 profile', v_actor, 'WP64 Org');

  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'disruption_scenario_profiles';
  IF v_n - v_before <> 1 THEN
    RAISE EXCEPTION
      'WP 6.4 §2 — inserting ONE profile wrote % audit row(s); the statement grain '
      'says exactly 1.', v_n - v_before;
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'disruption_scenario_profiles'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WP 6.4 §2 — the profile audit row names no actor.';
  END IF;

  -- ── 3 · THE CASCADE. One DELETE, four tables, four audit rows ───────────
  --
  -- This is what the package buys. `_targets`, `_effects` and `_settings` all
  -- cascade from `profile_id`, so deleting a profile is one statement by a
  -- person that removes rows from four tables — and until these sidecars
  -- existed, three of the four were deferred and therefore unaudited, so the
  -- cascade left a record of one quarter of what it did (D54).
  INSERT INTO public.disruption_scenario_targets (profile_id, target_type, node_ids, created_by, organization)
    VALUES (v_profile, 'node', ARRAY['N1'], v_actor, 'WP64 Org');
  INSERT INTO public.disruption_scenario_effects (profile_id, effect_type, magnitude, unit, created_by, organization)
    VALUES (v_profile, 'capacity_reduction', 25, 'percent', v_actor, 'WP64 Org');
  INSERT INTO public.disruption_scenario_settings (profile_id, key, value, created_by, organization)
    VALUES (v_profile, 'horizon_weeks', '52'::jsonb, v_actor, 'WP64 Org');

  CREATE TEMP TABLE wp64_before ON COMMIT DROP AS
    SELECT target_type AS t, count(*) AS n FROM public.audit_logs
     WHERE plane = 'data'
       AND target_type IN ('disruption_scenario_profiles','disruption_scenario_targets',
                           'disruption_scenario_effects','disruption_scenario_settings')
     GROUP BY target_type;

  DELETE FROM public.disruption_scenario_profiles WHERE id = v_profile;

  SELECT string_agg(x.t, ', ' ORDER BY x.t) INTO v_missing
  FROM (
    SELECT a.target_type AS t,
           count(*) - COALESCE((SELECT b.n FROM wp64_before b WHERE b.t = a.target_type), 0) AS delta
    FROM public.audit_logs a
    WHERE a.plane = 'data'
      AND a.target_type IN ('disruption_scenario_profiles','disruption_scenario_targets',
                            'disruption_scenario_effects','disruption_scenario_settings')
    GROUP BY a.target_type
  ) AS x
  WHERE x.delta < 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.4 §3 — deleting one profile cascaded into four tables and % wrote no '
      'audit row. A cascade that records a quarter of what it did is D54 exactly.',
      v_missing;
  END IF;

  -- …and each cascade row names the actor too. A trigger that fires inside a
  -- cascade runs in the same transaction, so the GUC is still set — asserting it
  -- is what proves the cascade is inside the rule rather than beside it.
  SELECT string_agg(want.t, ', ' ORDER BY want.t) INTO v_missing
  FROM unnest(ARRAY['disruption_scenario_targets','disruption_scenario_effects',
                    'disruption_scenario_settings']) AS want(t)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs a
    WHERE a.plane = 'data' AND a.target_type = want.t
      -- `audit_tier_write` writes `lower(TG_OP)`, so the value is 'delete'.
      -- The first draft of this compared against 'DELETE' and failed for its own
      -- reason rather than the code's.
      AND a.action = 'delete'
      AND a.actor_user_id IS NOT DISTINCT FROM v_actor
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.4 §3 — the cascade DELETE on % recorded no actor. The trigger runs in '
      'the deleting transaction, so `app.current_user_id` is still set.', v_missing;
  END IF;

  RAISE NOTICE 'WP 6.4 · 220 — five tables audited, statement grain held, and the '
               'profile cascade records all four.';
END
$wp64$;
