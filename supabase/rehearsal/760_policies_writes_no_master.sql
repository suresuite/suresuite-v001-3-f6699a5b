-- PLAN.md §23 WP 13.1 · §4 D280 — /POLICIES NEVER WRITES THE ITEM MASTERS.
--
-- `20261002000008` takes the supplier-master insert out of
-- `assign_material_supplier`, the one SQL writer the /policies grid calls. What
-- only a running database can settle:
--
--   §1 Assigning a supplier writes the LANE (inbound row + edge) and NO master
--      row — `suppliers`, `materials`, `products`, `customers` are unchanged.
--   §2 A supplier row that already exists is untouched (no value migrated).
--   §3 The audit row still names the actor, and a second assignment is a no-op.
--   §4 THE EXIT TEST'S DATABASE HALF: a cost edited on /policies is a Supplier-row
--      override, the policy snapshot a version freezes carries it, and
--      `materials` is unchanged.

DO $wp131$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_before  bigint;
  v_n       bigint;
  v_audit   public.audit_logs%ROWTYPE;
  v_cap     numeric;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp131@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp131@example.invalid', 'WP 13.1', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization)
    VALUES (v_project, 'WP 13.1', v_user, 'P131', 'WP131 Org');
  -- §2's existing master row: a supplier with an uploaded capacity.
  INSERT INTO public.suppliers (project_id, supplier_id, capacity_per_week)
    VALUES (v_project, 'SUP-OLD', 120);

  SELECT (SELECT count(*) FROM public.suppliers WHERE project_id = v_project)
       + (SELECT count(*) FROM public.materials WHERE project_id = v_project)
       + (SELECT count(*) FROM public.products  WHERE project_id = v_project)
       + (SELECT count(*) FROM public.customers WHERE project_id = v_project)
    INTO v_before;

  ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_guard_change;
  DELETE FROM public.audit_logs WHERE plane = 'data';
  ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_guard_change;

  -- §1 a NEW supplier: the lane lands, no master row does.
  PERFORM public.assign_material_supplier(v_project, 'MAT-A', 'SUP-NEW', v_user, 'wp131@example.invalid');
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-NEW' AND material_id = 'MAT-A';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 13.1 §1: assign_material_supplier wrote % lane row(s), expected 1', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.suppliers WHERE project_id = v_project AND supplier_id = 'SUP-NEW') THEN
    RAISE EXCEPTION 'WP 13.1 §1: assign_material_supplier wrote a supplier MASTER row — /policies must never write the item masters';
  END IF;

  -- §2 an EXISTING supplier: its master row is untouched.
  PERFORM public.assign_material_supplier(v_project, 'MAT-A', 'SUP-OLD', v_user, 'wp131@example.invalid');
  SELECT capacity_per_week INTO v_cap FROM public.suppliers
   WHERE project_id = v_project AND supplier_id = 'SUP-OLD';
  IF v_cap IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'WP 13.1 §2: the existing supplier master changed (capacity %)', v_cap;
  END IF;

  SELECT (SELECT count(*) FROM public.suppliers WHERE project_id = v_project)
       + (SELECT count(*) FROM public.materials WHERE project_id = v_project)
       + (SELECT count(*) FROM public.products  WHERE project_id = v_project)
       + (SELECT count(*) FROM public.customers WHERE project_id = v_project)
    INTO v_n;
  IF v_n <> v_before THEN
    RAISE EXCEPTION 'WP 13.1 §1: the item masters went from % to % row(s)', v_before, v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE plane = 'data'
               AND target_type IN ('suppliers', 'materials', 'products', 'customers')) THEN
    RAISE EXCEPTION 'WP 13.1 §1: an item-master write was audited during a supplier assignment';
  END IF;

  -- §3 the actor is still named, and the second assignment is a no-op.
  SELECT * INTO v_audit FROM public.audit_logs
   WHERE plane = 'data' AND target_type = 'inbound_logistics' AND action = 'insert'
   ORDER BY created_at LIMIT 1;
  IF v_audit.actor_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'WP 13.1 §3: the lane audit row names actor %, expected %', v_audit.actor_user_id, v_user;
  END IF;
  PERFORM public.assign_material_supplier(v_project, 'MAT-A', 'SUP-NEW', v_user, 'wp131@example.invalid');
  SELECT count(*) INTO v_n FROM public.inbound_logistics
   WHERE project_id = v_project AND supplier_id = 'SUP-NEW' AND material_id = 'MAT-A';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 13.1 §3: assigning twice left % lane row(s)', v_n;
  END IF;

  -- §4 the grid's save of a cost: an override on the row, in the version, and
  -- the master row as uploaded.
  INSERT INTO public.materials (project_id, material_id, cost) VALUES (v_project, 'MAT-A', 2.0);
  -- The row the grid's save sends to `bulk_upsert_policy_overrides` (its
  -- Edit-Policies gate is D275's and `710`'s subject, not this file's).
  INSERT INTO public.policy_overrides (project_id, scope, target_key, family, patch)
    VALUES (v_project, 'node', 'SUP-NEW::MAT-A', 'sourcing', jsonb_build_object('material_cost', 3.5));
  IF NOT (public._build_policy_snapshot(v_project) -> 'overrides') @> jsonb_build_array(jsonb_build_object(
      'target_key', 'SUP-NEW::MAT-A', 'family', 'sourcing', 'patch', jsonb_build_object('material_cost', 3.5))) THEN
    RAISE EXCEPTION 'WP 13.1 §4: the policy snapshot does not carry the /policies cost override: %',
      public._build_policy_snapshot(v_project) -> 'overrides';
  END IF;
  SELECT cost INTO v_cap FROM public.materials WHERE project_id = v_project AND material_id = 'MAT-A';
  IF v_cap IS DISTINCT FROM 2.0 THEN
    RAISE EXCEPTION 'WP 13.1 §4: the material master changed to % — /policies must never write it', v_cap;
  END IF;

  RAISE NOTICE 'WP 13.1: assign_material_supplier writes the lane, names its actor, and writes no item master; a /policies cost is an override in the version';
END $wp131$;
