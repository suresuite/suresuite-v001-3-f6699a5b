-- D71 · three SECURITY DEFINER writers that already took the actor now NAME it.
--
-- `audit-actor` (G4) says every tier transition writes an audit row naming the
-- actor. `apply_policy_bundle`, `assign_bom_line` and `assign_outbound_customer`
-- have taken `p_user_id` since the day they were written and never passed it to
-- the trigger, so every row they wrote recorded `actor_known: false` beside an
-- actor the caller had supplied. That is `assign_material_supplier`'s shape
-- before `20260916000021`, three more times.
--
-- ── THE POISON, AND IT IS THE ONLY REASON THIS FILE IS TRUSTWORTHY ────────
--
-- `set_config(..., true)` is TRANSACTION-local and this whole file is one
-- transaction. Asserting that an audit row names the actor proves nothing if the
-- GUC already held that value when the call was made — `rehearsal/110` §7 was
-- written that way first and the mutation removing `set_config` left it GREEN.
--
-- So before every call the GUC is set to a STRANGER, and each function is called
-- with a DIFFERENT actor. A row naming the caller's actor can then only have
-- come from the function setting it.
--
-- §4 is the inverse and matters as much: called with a NULL actor, the guard
-- must leave the poison alone rather than clearing it, because `p_user_id` is
-- `DEFAULT NULL` on `apply_policy_bundle` and a function that blanks the GUC
-- would make an audit row LESS attributable than before.

DO $d71$
DECLARE
  v_org       uuid := '00000000-0000-4000-8000-0000000d7100';
  v_actor     uuid := '00000000-0000-4000-8000-0000000d7101';
  v_stranger  uuid := '00000000-0000-4000-8000-0000000d7102';
  v_project   uuid := '00000000-0000-4000-8000-0000000d7103';
  v_before    integer;
  v_named     integer;
  v_res       jsonb;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D71 Org', 'd71-org');
  -- `policy_versions.created_by` REFERENCES `auth.users` — one of the nine keys
  -- D53 restored, and it bites here: `apply_policy_bundle` snapshots a version,
  -- so an actor with no `auth.users` row is REFUSED. Before WP 6.2 slice 8 the
  -- rehearsed database had no such key and this file would have passed without
  -- the two rows below.
  INSERT INTO auth.users (id, email) VALUES
    (v_actor,    'd71-actor@example.invalid'),
    (v_stranger, 'd71-stranger@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash, organization, organization_id) VALUES
    (v_actor,    'd71-actor@example.invalid',    'D71 Actor',    'x', 'D71 Org', v_org),
    (v_stranger, 'd71-stranger@example.invalid', 'D71 Stranger', 'x', 'D71 Org', v_org);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id)
    VALUES (v_project, 'D71', v_actor, 'D71P', 'D71 Org', v_org);

  -- ── 1 · assign_bom_line ─────────────────────────────────────────────────
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'bom_single_level';

  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  PERFORM public.assign_bom_line(v_project, 'P1', 'M1', 2.5, v_actor, 'd71-actor@example.invalid');

  SELECT count(*) INTO v_named FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'bom_single_level'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_named < 1 THEN
    RAISE EXCEPTION
      'D71 §1 — `assign_bom_line` wrote no `bom_single_level` audit row naming %. '
      'The GUC held % when the call was made, so a row naming the stranger means '
      'the function still does not tell the trigger about its own parameter.',
      v_actor, v_stranger;
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
       WHERE plane = 'data' AND target_type = 'bom_single_level') - v_before < 1 THEN
    RAISE EXCEPTION 'D71 §1 — `assign_bom_line` wrote no audit row at all.';
  END IF;

  -- …and the SECOND table it writes is named too. `assign_bom_line` writes
  -- `supply_chain_data` as well, and one line set before both is the whole
  -- point of setting it at the top rather than beside one INSERT.
  SELECT count(*) INTO v_named FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'supply_chain_data'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_named < 1 THEN
    RAISE EXCEPTION
      'D71 §1 — the `supply_chain_data` row written by the same call names no actor. '
      'The GUC must be set before EVERY tier write in the function, not one of them.';
  END IF;

  -- ── 2 · assign_outbound_customer ────────────────────────────────────────
  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  PERFORM public.assign_outbound_customer(v_project, 'P1', 'C1', v_actor, 'd71-actor@example.invalid');

  SELECT count(*) INTO v_named FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'outbound_logistics'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_named < 1 THEN
    RAISE EXCEPTION
      'D71 §2 — `assign_outbound_customer` wrote no `outbound_logistics` audit row '
      'naming %. The GUC held %.', v_actor, v_stranger;
  END IF;

  -- ── 3 · apply_policy_bundle ─────────────────────────────────────────────
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_defaults';

  PERFORM set_config('app.current_user_id', v_stranger::text, true);
  v_res := public.apply_policy_bundle(
    p_project_id := v_project,
    p_defaults   := jsonb_build_object('sourcing', jsonb_build_object('lead_time_days', 7)),
    p_user_id    := v_actor,
    p_user_email := 'd71-actor@example.invalid');

  IF (SELECT count(*) FROM public.audit_logs
       WHERE plane = 'data' AND target_type = 'policy_defaults') - v_before < 1 THEN
    RAISE EXCEPTION 'D71 §3 — `apply_policy_bundle` wrote no `policy_defaults` audit row (%).', v_res;
  END IF;

  SELECT count(*) INTO v_named FROM public.audit_logs a
   WHERE a.plane = 'data' AND a.target_type = 'policy_defaults'
     AND a.actor_user_id IS NOT DISTINCT FROM v_actor
     AND COALESCE((a.after ->> 'actor_known')::boolean, false);
  IF v_named < 1 THEN
    RAISE EXCEPTION
      'D71 §3 — `apply_policy_bundle` wrote no `policy_defaults` audit row naming %. '
      'The GUC held %.', v_actor, v_stranger;
  END IF;

  -- ── 4 · A NULL ACTOR MUST NOT CLEAR THE GUC ─────────────────────────────
  --
  -- `apply_policy_bundle`'s `p_user_id` is `DEFAULT NULL`, so an unguarded
  -- `set_config(..., p_user_id::text, true)` would write an empty string over
  -- whatever the caller's transaction had already established — making the row
  -- LESS attributable than before this migration. The guard is what stops that,
  -- and a guard nothing exercises is a belief.
  PERFORM set_config('app.current_user_id', v_actor::text, true);
  SELECT count(*) INTO v_before FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_defaults'
     AND actor_user_id IS NOT DISTINCT FROM v_actor;

  PERFORM public.apply_policy_bundle(
    p_project_id := v_project,
    p_defaults   := jsonb_build_object('inventory', jsonb_build_object('safety_stock_days', 3)));

  SELECT count(*) INTO v_named FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'policy_defaults'
     AND actor_user_id IS NOT DISTINCT FROM v_actor;
  IF v_named - v_before < 1 THEN
    RAISE EXCEPTION
      'D71 §4 — called with NO actor, `apply_policy_bundle` lost the actor the '
      'caller''s transaction had already set. The `IF p_user_id IS NOT NULL` guard '
      'is what prevents a NULL parameter from blanking `app.current_user_id`.';
  END IF;

  RAISE NOTICE 'D71 · 200 — three writers name their actor, and a NULL actor does not blank it.';
END
$d71$;
