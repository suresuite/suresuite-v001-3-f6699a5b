-- D71 · the remaining nine name their actor, AND every grant survived the DROP.
--
-- Two claims, and the second is the one that could break a product.
--
-- `CREATE OR REPLACE FUNCTION` cannot change a parameter count, so adding
-- `_actor_user_id` means DROP and CREATE — and DROP takes a function's grants
-- with it. The artifact records functions, not privileges, so a grant that fails
-- to come back is invisible to every static gate in this repository and shows up
-- as the anon role silently losing an RPC. §2 is the only thing standing between
-- that and production.

DO $d71b$
DECLARE
  v_org      uuid := '00000000-0000-4000-8000-0000000d71b0';
  v_actor    uuid := '00000000-0000-4000-8000-0000000d71b1';
  v_stranger uuid := '00000000-0000-4000-8000-0000000d71b2';
  v_project  uuid := '00000000-0000-4000-8000-0000000d71b3';
  v_name     text;
  v_missing  text;
  v_named    integer;
  v_before   integer;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D71b Org', 'd71b-org');
  INSERT INTO auth.users (id, email) VALUES
    (v_actor, 'd71b-actor@example.invalid'), (v_stranger, 'd71b-stranger@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_actor,    'd71b-actor@example.invalid',    'D71b Actor',    'x', 'D71b Org', v_org),
    (v_stranger, 'd71b-stranger@example.invalid', 'D71b Stranger', 'x', 'D71b Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'D71b', v_actor, 'D71bP', 'D71b Org', v_org);

  -- ── 1 · every one of the nine TAKES the actor ───────────────────────────
  --
  -- Read from `pg_proc`, not from the migration text: the question is whether
  -- the database has the parameter, and a migration that failed to apply one of
  -- nine would still contain the line.
  SELECT string_agg(want.fn, ', ' ORDER BY want.fn) INTO v_missing
  FROM (VALUES
    ('bulk_upsert_materials'), ('bulk_upsert_policy_overrides'), ('bulk_upsert_products'),
    ('bulk_upsert_suppliers'), ('clear_policy_preset'), ('delete_policy_override'),
    ('ensure_item_masters'), ('restore_policy_version'), ('save_policy_defaults')
  ) AS want(fn)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = want.fn
      AND p.proargnames[p.pronargs] = '_actor_user_id'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'D71 §1 — % do not take `_actor_user_id` as their last parameter.', v_missing;
  END IF;

  -- …and exactly ONE overload each. A `CREATE OR REPLACE` instead of DROP+CREATE
  -- would leave two, which makes the unqualified GRANT below ambiguous and the
  -- PostgREST call a coin toss.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_missing
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('bulk_upsert_materials','bulk_upsert_policy_overrides','bulk_upsert_products',
                      'bulk_upsert_suppliers','clear_policy_preset','delete_policy_override',
                      'ensure_item_masters','restore_policy_version','save_policy_defaults')
  GROUP BY p.proname HAVING count(*) > 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'D71 §1 — % have more than one overload; the old signature was not dropped.', v_missing;
  END IF;

  -- ── 2 · AND EVERY GRANT CAME BACK, AS AN EXPLICIT GRANT ────────────────
  --
  -- THE HALF THAT COULD BREAK THE PRODUCT, and the first draft of it could not
  -- fail. It asked `has_function_privilege('anon', …, 'EXECUTE')`, and the
  -- mutation that removed `anon` from a GRANT came back GREEN — because
  -- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so every
  -- role already has it and the question answers itself.
  --
  -- **So the explicit grants on these nine are belt-and-braces TODAY**, over a
  -- PUBLIC default that nothing here revokes. That is a fact worth stating
  -- rather than a reason to drop the assertion: three migrations already
  -- `REVOKE ... FROM PUBLIC` for other functions (`get_my_profile`,
  -- `update_own_profile`, `change_own_password`), so the day that pattern
  -- reaches one of these, the explicit grant becomes the only thing keeping the
  -- anon role able to call it — and a DROP that silently ate it would then be a
  -- feature that stops working with no error any static gate would see.
  --
  -- The assertion is therefore about `proacl`: each role must appear as an
  -- EXPLICIT grantee, which is exactly what the migration writes and exactly
  -- what DROP removes.
  SELECT string_agg(want.fn || ' → ' || want.role, ', ' ORDER BY want.fn, want.role)
    INTO v_missing
  FROM (VALUES
    ('bulk_upsert_materials','anon'),        ('bulk_upsert_materials','authenticated'),
    ('bulk_upsert_materials','service_role'),
    ('bulk_upsert_policy_overrides','anon'), ('bulk_upsert_policy_overrides','authenticated'),
    ('bulk_upsert_products','anon'),         ('bulk_upsert_products','authenticated'),
    ('bulk_upsert_products','service_role'),
    ('bulk_upsert_suppliers','anon'),        ('bulk_upsert_suppliers','authenticated'),
    ('bulk_upsert_suppliers','service_role'),
    ('clear_policy_preset','anon'),          ('clear_policy_preset','authenticated'),
    ('delete_policy_override','anon'),       ('delete_policy_override','authenticated'),
    ('ensure_item_masters','anon'),          ('ensure_item_masters','authenticated'),
    ('ensure_item_masters','service_role'),
    ('restore_policy_version','anon'),       ('restore_policy_version','authenticated'),
    ('save_policy_defaults','anon'),         ('save_policy_defaults','authenticated')
  ) AS want(fn, role)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    WHERE n.nspname = 'public'
      AND p.proname = want.fn
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee = want.role::regrole::oid          -- NOT 0, which is PUBLIC
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'D71 §2 — DROP took these EXPLICIT grants and the migration did not restore '
      'them: %. They are redundant only while PUBLIC keeps EXECUTE, and three '
      'migrations already revoke that for other functions.', v_missing;
  END IF;

  -- ── 3 · and the actor REACHES THE AUDIT ROW, with the GUC poisoned ──────
  --
  -- `set_config(..., true)` is transaction-local and this file is one
  -- transaction, so the GUC is set to a STRANGER before the call. A row naming
  -- the actor can then only have come from the function.
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'materials';

  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  PERFORM public.bulk_upsert_materials(
    v_project,
    jsonb_build_array(jsonb_build_object('material_id','D71B-M1','name','D71b material')),
    v_actor);

  IF (SELECT count(*) FROM public.audit_logs
       WHERE plane = 'data' AND target_type = 'materials') - v_before < 1 THEN
    RAISE EXCEPTION 'D71 §3 — `bulk_upsert_materials` wrote no `materials` audit row at all.';
  END IF;

  SELECT count(*) INTO v_named FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'materials'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_named < 1 THEN
    RAISE EXCEPTION
      'D71 §3 — `bulk_upsert_materials` wrote no audit row naming %. The GUC held % '
      'when the call was made, so the parameter is not reaching the trigger.',
      v_actor, v_stranger;
  END IF;

  -- ── 4 · a NULL actor must NOT blank the GUC ─────────────────────────────
  --
  -- `_actor_user_id` is DEFAULT NULL precisely so every existing caller keeps
  -- working. An unguarded `set_config(..., NULL::text, true)` writes an empty
  -- string over whatever the caller's transaction had established — making the
  -- row LESS attributable than before this migration, which would turn a
  -- nine-function improvement into a nine-function regression.
  PERFORM set_config('app.current_user_id', v_actor::text, true);
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'materials'
     AND actor_user_id IS NOT DISTINCT FROM v_actor;

  PERFORM public.bulk_upsert_materials(
    v_project,
    jsonb_build_array(jsonb_build_object('material_id','D71B-M2','name','D71b second')));

  SELECT count(*) INTO v_named FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'materials'
     AND actor_user_id IS NOT DISTINCT FROM v_actor;
  IF v_named - v_before < 1 THEN
    RAISE EXCEPTION
      'D71 §4 — called with no actor, `bulk_upsert_materials` lost the one the '
      'caller''s transaction had already set. The `IF _actor_user_id IS NOT NULL` '
      'guard is what stops a DEFAULT NULL parameter blanking `app.current_user_id`.';
  END IF;

  -- ── 5 · the trigger function is NOT in this class ───────────────────────
  --
  -- `create_default_policy_defaults` sat on the ratchet beside the nine and
  -- cannot take the parameter: PostgreSQL refuses a trigger function with
  -- declared arguments. It must still be a zero-argument trigger function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_default_policy_defaults'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype
  ) THEN
    RAISE EXCEPTION
      'D71 §5 — `create_default_policy_defaults` is no longer a zero-argument '
      'trigger function. It fires FOR EACH ROW inside someone else''s statement, '
      'so the actor is that statement''s to set and never this function''s.';
  END IF;

  RAISE NOTICE 'D71 · 210 — nine take the actor, every grant survived the DROP, '
               'the actor reaches the audit row, and NULL does not blank it.';
END
$d71b$;
