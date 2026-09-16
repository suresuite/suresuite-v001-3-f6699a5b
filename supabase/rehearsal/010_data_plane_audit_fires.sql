-- D45 · ONE TIER-2 WRITE MUST PRODUCE ONE `plane='data'` AUDIT ROW.
--
-- `audit-actor` (§2.1 G4) has been claimed since WP 2.3 on the strength of a
-- migration that landed. §15's first execution measured what the claim is worth:
-- `audit_logs` holds 18 rows in production and EVERY ONE is `plane='admin'`. No
-- data-plane row has ever been observed. `dataPlaneAudit.test.ts` reads the
-- migration text and passed throughout — a structural gate cannot tell a trigger
-- that fires from a trigger that is merely declared.
--
-- This file is the missing half, and it needs a database, which is why it could
-- not be written before D31. It runs inside a transaction the rehearsal rolls
-- back, so nothing it inserts survives the run.
--
-- WP 3.3's promotion is specified as an AUDITED upsert. It is not safe to build
-- that on an audit nobody has watched fire.

DO $d45$
DECLARE
  v_project uuid := gen_random_uuid();
  v_actor   uuid := gen_random_uuid();
  v_rows    integer;
  v_row     public.audit_logs%ROWTYPE;
BEGIN
  -- The actor the trigger is supposed to name. `get_current_user_id()` reads
  -- `app.current_user_id` first, which is exactly how the RPC paths set it.
  PERFORM set_config('app.current_user_id', v_actor::text, true);

  -- A REAL project, because `ensure_dataset_plant_matches_project` refuses a
  -- lane whose project does not exist or whose plant disagrees. Discovering
  -- that took one run of this file, and it is the kind of thing no reading of
  -- the migration would have told anyone.
  INSERT INTO public.approved_users (id, email, name, password_hash)
  VALUES (v_actor, 'rehearsal@example.invalid', 'Rehearsal', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
  VALUES (v_project, 'Rehearsal', v_actor, 'REHEARSAL');

  DELETE FROM public.audit_logs WHERE plane = 'data';

  -- ── one statement, three rows ───────────────────────────────────────────
  -- Three, not one, because the trigger is STATEMENT-level by design: the
  -- assertion has to show that a three-row insert writes ONE audit row saying
  -- three, not three audit rows. A bulk upload otherwise writes tens of
  -- thousands and an audit log nobody can read is no audit log.
  INSERT INTO public.inbound_logistics (project_id, plant_name, supplier_id, material_id)
  VALUES (v_project, 'REHEARSAL', 'SUP-1', 'MAT-1'),
         (v_project, 'REHEARSAL', 'SUP-1', 'MAT-2'),
         (v_project, 'REHEARSAL', 'SUP-2', 'MAT-1');

  SELECT count(*) INTO v_rows FROM public.audit_logs WHERE plane = 'data';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'D45: one tier-2 INSERT of 3 rows produced % data-plane audit row(s), expected exactly 1', v_rows;
  END IF;

  SELECT * INTO v_row FROM public.audit_logs WHERE plane = 'data';

  IF v_row.action <> 'insert' THEN
    RAISE EXCEPTION 'D45: the audit row says action=%, expected insert', v_row.action;
  END IF;
  IF v_row.target_type <> 'inbound_logistics' THEN
    RAISE EXCEPTION 'D45: the audit row says target_type=%, expected inbound_logistics', v_row.target_type;
  END IF;
  IF (v_row.after ->> 'rows_after')::int <> 3 THEN
    RAISE EXCEPTION 'D45: the audit row counts % rows, expected 3 — the statement grain is wrong',
      v_row.after ->> 'rows_after';
  END IF;
  IF (v_row.after ->> 'tier') <> '2' THEN
    RAISE EXCEPTION 'D45: the audit row says tier=%, expected 2', v_row.after ->> 'tier';
  END IF;

  -- D36's other half: the row must NAME the actor, not merely exist. The
  -- trigger records `actor_known` so a NULL actor is stated rather than
  -- inferred; here the actor IS set, so both must agree.
  IF v_row.actor_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'D45: the audit row names actor %, expected % — `audit-actor` is about WHO',
      v_row.actor_user_id, v_actor;
  END IF;
  IF (v_row.after ->> 'actor_known') <> 'true' THEN
    RAISE EXCEPTION 'D45: the audit row says actor_known=%, expected true', v_row.after ->> 'actor_known';
  END IF;

  -- ── UPDATE and DELETE are separate triggers and are asserted separately ──
  DELETE FROM public.audit_logs WHERE plane = 'data';
  UPDATE public.inbound_logistics SET volume = 1 WHERE project_id = v_project;
  SELECT count(*) INTO v_rows FROM public.audit_logs WHERE plane = 'data' AND action = 'update';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'D45: a tier-2 UPDATE produced % data-plane audit row(s), expected 1', v_rows;
  END IF;

  DELETE FROM public.audit_logs WHERE plane = 'data';
  DELETE FROM public.inbound_logistics WHERE project_id = v_project;
  SELECT count(*) INTO v_rows FROM public.audit_logs WHERE plane = 'data' AND action = 'delete';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'D45: a tier-2 DELETE produced % data-plane audit row(s), expected 1', v_rows;
  END IF;

  -- ── a statement that touches nothing is not a tier transition ────────────
  DELETE FROM public.audit_logs WHERE plane = 'data';
  UPDATE public.inbound_logistics SET volume = 2 WHERE project_id = v_project;  -- matches nothing now
  SELECT count(*) INTO v_rows FROM public.audit_logs WHERE plane = 'data';
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'D45: an UPDATE matching no rows wrote % audit row(s), expected 0', v_rows;
  END IF;

  RAISE NOTICE 'D45: the data-plane audit fires — insert, update and delete each write exactly one row';
END $d45$;
