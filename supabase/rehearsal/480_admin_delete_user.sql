-- WP 7.2 (a) · §4 D161 + D213 · ONE ACCOUNT CAN BE DELETED, AND WHAT IT DID STAYS —
-- WITH ITS ACTOR UNKNOWN AND EVERYTHING ELSE UNCHANGED.
--
-- `20260930000007` lets each actor key SET NULL through its table's immutability guard,
-- and adds `admin_delete_user`. What only a running database can settle, the verb called
-- AS anon — the browser's role (D155):
--
--   §1 REFUSALS, each leaving the account in place: a non-super-admin; a confirmation
--      that is not the email; an unknown account; the admin's own account; a super admin;
--      an account that owns a project (named in the refusal).
--   §2 THE GUARDS STILL GUARD: while the account exists, neither `ingest_files` nor
--      `analysis_runs` lets its actor go to NULL; neither lets any OTHER column change;
--      and a run still cannot be CREATED without an actor.
--   §3 ATOMIC: a failure at the last step leaves the account, its memberships and every
--      actor column as they were.
--   §4 THE DELETE: the account and what CASCADEs from it are gone; its landed file, both
--      ingest runs, its analysis run and its lane row survive with the actor NULL and
--      every other column identical; the other accounts are untouched.
--   §5 ATTRIBUTION: one `user.delete` admin row naming the super admin, carrying the
--      counts and NOT the person's email or name; the data-plane rows the anonymisation
--      wrote name the super admin, with the session actor blanked first.
--   §6 GRANTS: the browser (anon) may call the verb.

DO $d213$
DECLARE
  v_org     uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();   -- active super admin
  v_super2  uuid := gen_random_uuid();   -- a second super admin, the §1 target
  v_owner   uuid := gen_random_uuid();   -- owns the project
  v_target  uuid := gen_random_uuid();   -- the account deleted in §4 (an org admin)
  v_admin   uuid := gen_random_uuid();   -- org admin, not a super admin
  v_p       uuid := gen_random_uuid();
  v_landed  jsonb;
  v_run     uuid;                        -- the ingest run the landing opened
  v_arun    uuid := gen_random_uuid();   -- the analysis run
  v_file    jsonb;                       -- the ingest_files row, as it was
  v_ar      jsonb;                       -- the analysis_runs row, as it was
  v_out     jsonb;
  v_code    text;
  v_msg     text;
  v_n       integer;
  v_seq     bigint;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'D213 Org', 'd213-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,  'd213s@example.invalid',  'D213 Super',  'x', 'super_admin', 'D213 Org', v_org, true),
    (v_super2, 'd213s2@example.invalid', 'D213 Super2', 'x', 'super_admin', 'D213 Org', v_org, true),
    (v_owner,  'd213o@example.invalid',  'D213 Owner',  'x', 'modeler',     'D213 Org', v_org, true),
    -- An org `admin`: the landing's access check admits a project's owner or an admin,
    -- not a member (`has_project_access`, D66's disagreement), and the uploader must
    -- not OWN the project or §1's owner refusal would stop §4.
    (v_target, 'd213t@example.invalid',  'D213 Target', 'x', 'admin',       'D213 Org', v_org, true),
    (v_admin,  'd213a@example.invalid',  'D213 Admin',  'x', 'admin',       'D213 Org', v_org, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D213 project', v_owner, 'D213P', 'D213 Org', v_org, 'single');
  INSERT INTO public.project_members (project_id, user_id, project_role, rationale) VALUES
    (v_p, v_target, 'editor', 'D213 editor');
  INSERT INTO public.ai_budgets (scope, scope_id, period) VALUES ('user', v_target, 'monthly');

  -- The target's work — one of each actor column this migration concerns.
  v_landed := public.ingest_land_file(v_p, v_target, 'csv', 'master', 'customers',
    'd213.csv', 'ingest', 'd213/d213.csv', 'text/csv', 10, repeat('d', 64),
    jsonb_build_array(jsonb_build_object('source_row_number', 2,
      'raw', jsonb_build_object('customer_id', 'C'), 'parsed', jsonb_build_object('customer_id', 'C'),
      'findings', '[]'::jsonb)));
  v_run := (v_landed ->> 'run_id')::uuid;
  UPDATE public.ingest_runs SET applied_by_user_id = v_target WHERE id = v_run;
  INSERT INTO public.analysis_runs (id, project_id, analysis_kind, input_hash, params_hash, code_version, actor_user_id)
    VALUES (v_arun, v_p, 'd213_kind', 'ih', 'ph', 'cv', v_target);
  INSERT INTO public.supply_chain_data (project_id, plant_name, from_location, to_location, uploaded_by)
    VALUES (v_p, 'D213P', 'X', 'Y', v_target);

  SELECT to_jsonb(f) INTO v_file FROM public.ingest_files f WHERE f.storage_path = 'd213/d213.csv';
  IF v_file IS NULL OR (v_file ->> 'uploaded_by')::uuid IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'D213/480 setup: the landing did not record the target as the uploader (%)', v_file;
  END IF;
  SELECT to_jsonb(r) INTO v_ar FROM public.analysis_runs r WHERE r.id = v_arun;

  -- The browser's shape: no GUC, no session.
  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · refusals ══
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_admin, 'd213a@example.invalid', v_target, 'd213t@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; RESET ROLE; END;
  IF v_msg IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D213/480 §1: an org admin (not a super admin) got %, expected forbidden', COALESCE(v_msg, '(no error — it deleted)');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', v_target, 'D213 Target');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; RESET ROLE; END;
  IF v_code IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'D213/480 §1: a confirmation that is the NAME rather than the email ended with %, expected 22023', COALESCE(v_code, '(no error — it deleted)');
  END IF;

  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', gen_random_uuid(), 'd213t@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; RESET ROLE; END;
  IF v_code IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'D213/480 §1: an unknown account ended with %, expected P0002', COALESCE(v_code, '(none)');
  END IF;

  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', v_super, 'd213s@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; RESET ROLE; END;
  IF v_msg IS NULL OR v_msg NOT LIKE '%your own account%' THEN
    RAISE EXCEPTION 'D213/480 §1: a super admin deleting THEMSELVES got %', COALESCE(v_msg, '(no error — they deleted themselves)');
  END IF;

  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', v_super2, 'D213S2@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; RESET ROLE; END;
  IF v_msg IS NULL OR v_msg NOT LIKE '%super admin%change their role%' THEN
    RAISE EXCEPTION 'D213/480 §1: deleting another super admin got %, expected a refusal pointing at the role', COALESCE(v_msg, '(no error — a super admin was erased)');
  END IF;

  v_code := NULL; v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', v_owner, 'd213o@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; v_msg := SQLERRM; RESET ROLE; END;
  IF v_code IS DISTINCT FROM '2BP01' OR v_msg NOT LIKE '%"D213 project"%' THEN
    RAISE EXCEPTION 'D213/480 §1: deleting a project owner ended with % (%), expected 2BP01 naming the project',
      COALESCE(v_code, '(none — the project now has no owner)'), COALESCE(v_msg, '');
  END IF;

  IF (SELECT count(*) FROM public.approved_users WHERE id IN (v_super2, v_owner, v_target)) <> 3 THEN
    RAISE EXCEPTION 'D213/480 §1: a refused delete removed an account';
  END IF;

  -- ══ §2 · the guards still guard ══
  -- While the account exists, the actor may not be blanked by hand …
  v_code := NULL;
  BEGIN UPDATE public.ingest_files SET uploaded_by = NULL WHERE storage_path = 'd213/d213.csv';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '23001' THEN
    RAISE EXCEPTION 'D213/480 §2: blanking a LIVE uploader on a tier-0 row ended with %, expected 23001 (restrict_violation)', COALESCE(v_code, '(no error — tier 0 is editable)');
  END IF;
  v_code := NULL;
  BEGIN UPDATE public.analysis_runs SET actor_user_id = NULL WHERE id = v_arun;
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM 'P0A01' THEN
    RAISE EXCEPTION 'D213/480 §2: blanking a LIVE run actor ended with %, expected P0A01', COALESCE(v_code, '(no error — the actor is editable)');
  END IF;
  -- … nor re-attributed …
  v_code := NULL;
  BEGIN UPDATE public.analysis_runs SET actor_user_id = v_owner WHERE id = v_arun;
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM 'P0A01' THEN
    RAISE EXCEPTION 'D213/480 §2: re-attributing a run ended with %, expected P0A01', COALESCE(v_code, '(no error)');
  END IF;
  -- … and any other column of a tier-0 row still cannot change.
  v_code := NULL;
  BEGIN UPDATE public.ingest_files SET original_filename = 'renamed.csv' WHERE storage_path = 'd213/d213.csv';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '23001' THEN
    RAISE EXCEPTION 'D213/480 §2: renaming a tier-0 file ended with %, expected 23001', COALESCE(v_code, '(no error — tier 0 is editable)');
  END IF;
  -- A run is still CREATED with an actor, or not at all.
  v_code := NULL;
  BEGIN
    INSERT INTO public.analysis_runs (project_id, analysis_kind, input_hash, params_hash, code_version, actor_user_id)
      VALUES (v_p, 'd213_kind', 'ih2', 'ph', 'cv', NULL);
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; END;
  IF v_code IS DISTINCT FROM '23502' THEN
    RAISE EXCEPTION 'D213/480 §2: a run with NO actor was created (%), expected 23502', COALESCE(v_code, 'no error');
  END IF;

  -- ══ §3 · atomic: fail at the last step, after the account is gone ══
  CREATE FUNCTION pg_temp.d213_refuse() RETURNS trigger LANGUAGE plpgsql AS
    $f$ BEGIN IF NEW.action = 'user.delete' THEN RAISE EXCEPTION 'd213 forced failure'; END IF; RETURN NEW; END $f$;
  CREATE TRIGGER d213_refuse BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.d213_refuse();
  v_msg := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_delete_user(v_super, 'd213s@example.invalid', v_target, 'd213t@example.invalid');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; RESET ROLE; END;
  DROP TRIGGER d213_refuse ON public.audit_logs;
  IF v_msg IS NULL OR v_msg NOT LIKE '%forced failure%' THEN
    RAISE EXCEPTION 'D213/480 §3: the forced failure did not surface (got %)', COALESCE(v_msg, '(no error)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_target)
     OR NOT EXISTS (SELECT 1 FROM public.project_members WHERE user_id = v_target)
     OR NOT EXISTS (SELECT 1 FROM public.ai_budgets WHERE scope = 'user' AND scope_id = v_target)
     OR (SELECT uploaded_by FROM public.ingest_files WHERE storage_path = 'd213/d213.csv') IS DISTINCT FROM v_target
     OR (SELECT actor_user_id FROM public.analysis_runs WHERE id = v_arun) IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'D213/480 §3: a delete that FAILED removed the account or anonymised its work — it is not atomic';
  END IF;

  -- ══ §4 · the delete ══
  PERFORM set_config('app.current_user_id', '', true);   -- §5 must not read a value left behind
  SELECT COALESCE(max(seq), 0) INTO v_seq FROM public.audit_logs;
  SET LOCAL ROLE anon;
  -- Case and whitespace in the confirmation are forgiven; the email itself is not.
  v_out := public.admin_delete_user(v_super, 'd213s@example.invalid', v_target, '  D213T@example.invalid ');
  RESET ROLE;

  IF v_out ->> 'email' IS DISTINCT FROM 'd213t@example.invalid'
     OR (v_out -> 'anonymised' ->> 'files_uploaded')::int <> 1
     OR (v_out -> 'anonymised' ->> 'ingest_runs')::int <> 1
     OR (v_out -> 'anonymised' ->> 'analysis_runs')::int <> 1
     OR (v_out -> 'anonymised' ->> 'supply_chain_rows')::int <> 1 THEN
    RAISE EXCEPTION 'D213/480 §4: expected one of each anonymised, the function reported %', v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_target) THEN
    RAISE EXCEPTION 'D213/480 §4: the account survived its own deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_members WHERE user_id = v_target)
     OR EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_target)
     OR EXISTS (SELECT 1 FROM public.ai_budgets WHERE scope = 'user' AND scope_id = v_target) THEN
    RAISE EXCEPTION 'D213/480 §4: a membership or an AI budget outlived the account';
  END IF;

  -- The file: kept, actor gone, every other column byte-identical.
  SELECT count(*) INTO v_n FROM public.ingest_files f
   WHERE f.storage_path = 'd213/d213.csv'
     AND f.uploaded_by IS NULL
     AND (to_jsonb(f) - 'uploaded_by') = (v_file - 'uploaded_by');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D213/480 §4: the landed file is gone, still names the deleted uploader, or CHANGED otherwise (D161 was to anonymise, not to edit)';
  END IF;
  IF (SELECT count(*) FROM public.ingest_runs
       WHERE id = v_run AND triggered_by_user_id IS NULL AND applied_by_user_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'D213/480 §4: the ingest run is gone or still names the deleted account';
  END IF;
  -- The run: kept, actor gone, its identity unchanged (`updated_at` is the guard's own stamp).
  SELECT count(*) INTO v_n FROM public.analysis_runs r
   WHERE r.id = v_arun
     AND r.actor_user_id IS NULL
     AND (to_jsonb(r) - 'actor_user_id' - 'updated_at') = (v_ar - 'actor_user_id' - 'updated_at');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D213/480 §4: the analysis run is gone, still names the deleted account, or changed otherwise';
  END IF;
  IF (SELECT count(*) FROM public.supply_chain_data
       WHERE project_id = v_p AND from_location = 'X' AND to_location = 'Y' AND uploaded_by IS NULL) <> 1 THEN
    RAISE EXCEPTION 'D213/480 §4: the lane row is gone or still names the deleted account';
  END IF;
  IF (SELECT count(*) FROM public.approved_users WHERE id IN (v_super, v_super2, v_owner, v_admin)) <> 4
     OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_p) THEN
    RAISE EXCEPTION 'D213/480 §4: the delete reached another account or the project';
  END IF;

  -- ══ §5 · attribution ══
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'user.delete' AND target_id = v_target::text AND actor_user_id = v_super
     AND (after -> 'anonymised' ->> 'files_uploaded')::int = 1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D213/480 §5: expected ONE user.delete admin row naming the super admin and the counts, found %', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'user.delete' AND target_id = v_target::text
     AND (COALESCE(before::text, '') || COALESCE(after::text, '')) ~* 'd213t@|D213 Target';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D213/480 §5: the user.delete row keeps the erased person''s email or name';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND seq > v_seq AND target_type IN ('analysis_runs', 'supply_chain_data')
     AND actor_user_id IS DISTINCT FROM v_super;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'D213/480 §5: % data-plane row(s) written by the anonymisation do not name the super admin', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND seq > v_seq AND target_type = 'analysis_runs' AND actor_user_id = v_super;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'D213/480 §5: anonymising the analysis run wrote no attributed data-plane row';
  END IF;

  -- ══ §6 · grants ══
  IF NOT has_function_privilege('anon', 'public.admin_delete_user(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D213/480 §6: anon cannot EXECUTE admin_delete_user, so the page (which calls as anon, D155) cannot delete';
  END IF;

  RAISE NOTICE 'D213/480: one account is deleted by a super admin who names its email; its file, runs and lane stay with the actor unknown — 6 section(s)';
END $d213$;
