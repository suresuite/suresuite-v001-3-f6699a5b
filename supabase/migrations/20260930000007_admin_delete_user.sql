-- Admin users / §4 D161 + D213 — ONE ACCOUNT CAN BE DELETED, AND WHAT IT DID STAYS.
--
-- Until now an account could be suspended (`admin_set_user_active`) and never deleted:
-- there was no verb, and a bare `DELETE FROM approved_users` could not have succeeded
-- for anyone who had ever done anything. Three actor keys refused it:
--
--   · `ingest_files.uploaded_by` — `ON DELETE SET NULL`, but `ingest_files` is TIER 0 and
--     `ingest_files_write_once()` refuses every UPDATE, so the SET NULL raised an error
--     about tier-0 immutability that never named the user (§4 D161);
--   · `analysis_runs.actor_user_id` — NOT NULL with no ON DELETE rule, and
--     `analysis_runs_identity_is_immutable()` freezes the actor: D161's shape exactly,
--     in tier 3 (§4 D213);
--   · `supply_chain_data.uploaded_by` — no ON DELETE rule, so NO ACTION (§4 D213).
--
-- THE OWNER'S DECISION (2026-09-30), WP 7.2's option (a): CONTENT IS IMMUTABLE; THE
-- ACTOR MAY BE ANONYMISED. Deleting a person leaves every fact they recorded in place
-- and makes its actor unknown. It is what a data-protection erasure request needs, and
-- it is the same answer `20260929000001` gave the audit log, one step further: there
-- the uuid stays and the name and email leave with the account; here the actor
-- column itself goes NULL, because those columns carry a foreign key and the log's no
-- longer does.
--
-- ── 1 · ONE EXCEPTION IN EACH IMMUTABILITY TRIGGER, AND ONLY ONE ───────────────
-- Each guard now lets exactly one UPDATE through: the actor column going from a value
-- to NULL, with every other column unchanged, AND only once that account no longer
-- exists. The second condition is what keeps the exception an erasure rather than an
-- edit: a direct `UPDATE … SET uploaded_by = NULL` while the person still has an
-- account is refused as before. The ON DELETE SET NULL action runs after the account
-- row is deleted, so by the time the guard fires the account is gone.
--
-- ── 2 · THE TWO OTHER KEYS ──────────────────────────────────────────────────────
-- `analysis_runs.actor_user_id` loses NOT NULL so that the key can SET NULL, and a
-- BEFORE INSERT trigger keeps what NOT NULL was for: a run that cannot name who asked
-- for it still cannot be CREATED. Only erasure can make it NULL.
-- `supply_chain_data.uploaded_by` becomes ON DELETE SET NULL; it had no guard to adjust.
-- Both constraint names are the ones PostgreSQL gave the inline keys at creation, in
-- production and in a rehearsed base alike — neither table was renamed (contrast D160).
--
-- ── 3 · admin_delete_user ────────────────────────────────────────────────────────
-- Active super admin only. The account's email must be typed back, and the server
-- checks it, so a stale page or a replayed request cannot delete an account the admin
-- did not name. It refuses, BEFORE deleting anything:
--   · the acting admin's own account;
--   · a super admin — demote first, which is where the last-super-admin guard lives
--     (`admin_set_user_role`), so this verb cannot bypass it;
--   · an account that OWNS projects (`projects.modeler_id`, which carries no foreign
--     key): deleting the owner would leave projects nobody owns, so the refusal names
--     them and the admin transfers (`admin_transfer_project`, D212) or deletes them.
-- Then it deletes the account's AI budget and the account. CASCADE removes its
-- organization and project memberships, delegation grants, AI permissions and
-- capabilities; SET NULL anonymises the rest. It logs `user.delete` WITHOUT the
-- person's name or email — the log keeps the uuid, as the audit log does for every
-- other row that person wrote, so the admin page shows "deleted user".
-- NOT reached, and said rather than implied (as D208 does): `chat_threads` and
-- `user_files` rows, which carry no foreign key to `approved_users`, and the storage
-- objects behind uploaded files, which a SQL function cannot remove atomically.
--
-- ── 4 · admin_delete_organization, brought in line ───────────────────────────────
-- D208 refused an organization whose accounts had recorded work in ANOTHER
-- organization's project, because "no foreign key there lets go; `ingest_files` is
-- D161". Every one of those keys now lets go, so the refusal is removed and that work
-- is anonymised exactly as a single account's is. Two verbs that erase an account
-- must erase it the same way. Otherwise the same body as `20260930000004`.
--
-- Revert: restore the two trigger functions' previous bodies, drop
-- `analysis_runs_actor_required`, put NOT NULL back (only possible while no run has
-- been anonymised), restore both keys without an ON DELETE rule, drop
-- `admin_delete_user`, and re-create `admin_delete_organization` from `20260930000004`.

-- ── 1 · tier 0: the uploader may be anonymised, the file may not change ─────────
CREATE OR REPLACE FUNCTION public.ingest_files_write_once()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- WP 7.2 (a), §4 D161: the ON DELETE SET NULL of an erased account, and nothing else.
  IF OLD.uploaded_by IS NOT NULL
     AND NEW.uploaded_by IS NULL
     AND (to_jsonb(NEW) - 'uploaded_by') = (to_jsonb(OLD) - 'uploaded_by')
     AND NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = OLD.uploaded_by) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'ingest_files is tier 0 (PLAN.md §2): rows are write-once and never mutated. '
    'Row % was updated; land a new file and open a new run instead.', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ── 2 · tier 3: a run's actor may be anonymised, nothing else about it ──────────
CREATE OR REPLACE FUNCTION public.analysis_runs_identity_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id    IS DISTINCT FROM OLD.project_id
  OR NEW.analysis_kind IS DISTINCT FROM OLD.analysis_kind
  OR NEW.input_hash    IS DISTINCT FROM OLD.input_hash
  OR NEW.params_hash   IS DISTINCT FROM OLD.params_hash
  OR NEW.params        IS DISTINCT FROM OLD.params
  OR NEW.code_version  IS DISTINCT FROM OLD.code_version
  OR NEW.started_at    IS DISTINCT FROM OLD.started_at
  -- WP 7.2 (a), §4 D213: the actor may go to NULL once their account is gone.
  OR (NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
      AND NOT (NEW.actor_user_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = OLD.actor_user_id))) THEN
    RAISE EXCEPTION
      'analysis_runs: the key and the actor are immutable (WP 4.2). A run names '
      'the world, the parameters, the code and the person it belongs to; change '
      'any of them and it is a different run.'
      USING ERRCODE = 'P0A01';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- What NOT NULL was for, kept: a run is created naming who asked for it.
CREATE OR REPLACE FUNCTION public.analysis_runs_actor_is_required() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'analysis_runs: a run must name the person who asked for it (audit-actor, G4). '
      'Only the deletion of that person''s account may later make it unknown (§4 D213).'
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS analysis_runs_actor_required ON public.analysis_runs;
CREATE TRIGGER analysis_runs_actor_required BEFORE INSERT ON public.analysis_runs
  FOR EACH ROW EXECUTE FUNCTION public.analysis_runs_actor_is_required();

ALTER TABLE public.analysis_runs ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_actor_user_id_fkey;
ALTER TABLE public.analysis_runs
  ADD CONSTRAINT analysis_runs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES public.approved_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.analysis_runs.actor_user_id IS
  'Who asked for this run, as public.approved_users(id). Required when the run is created '
  '(analysis_runs_actor_required); NULL only after that person''s account was deleted, '
  'which anonymises the actor and keeps the run (WP 7.2 (a), §4 D213).';

-- ── 3 · the legacy lane table ───────────────────────────────────────────────────
ALTER TABLE public.supply_chain_data DROP CONSTRAINT IF EXISTS supply_chain_data_uploaded_by_fkey;
ALTER TABLE public.supply_chain_data
  ADD CONSTRAINT supply_chain_data_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.approved_users(id) ON DELETE SET NULL;

-- ── 3b · §4 D214: a lane refresh names the statement's actor, not the owner ─────
-- The SET NULL above is an UPDATE of `supply_chain_data`, which fires the D143 lane
-- trigger, which calls this one-argument form — and it passed NULL, so the two-argument
-- form fell back to the project's OWNER and set `app.current_user_id` to them, LOCAL to
-- the transaction. Everything after it in the caller's transaction was then attributed
-- to the owner: here, `log_admin_action` saw the owner rather than the super admin and
-- refused with `forbidden`, so any account with a lane row could not be deleted. The
-- same was true of every other statement that touches a lane: the node_list rows the
-- refresh wrote, and whatever the caller wrote next, named somebody who did not act.
-- The statement's own actor when it has one; the owner remains the fallback only when
-- nobody is named, which is what the two-argument form's COALESCE was written for.
CREATE OR REPLACE FUNCTION public.refresh_node_list_for_project(p_project_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.refresh_node_list_for_project(p_project_id, public.get_current_user_id());
$function$;

-- ── 4 · admin_delete_user ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_actor_id       uuid,
  p_actor_email    text,
  p_target_user_id uuid,
  p_confirm_email  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_owned    text;
  v_n_owned  integer;
  v_before   jsonb;
  v_anon     jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  -- Said again in this body: `_assert_super_admin` sets it, but the attribution scan
  -- in `dataPlaneAudit.test.ts` reads text and cannot follow a call.
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);

  SELECT * INTO v_user FROM public.approved_users WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_confirm_email IS NULL OR lower(btrim(p_confirm_email)) IS DISTINCT FROM lower(v_user.email) THEN
    RAISE EXCEPTION 'confirmation does not match: type the email "%" to delete this account', v_user.email
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_target_user_id = p_actor_id THEN
    RAISE EXCEPTION 'you cannot delete your own account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_user.role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION '% is a super admin: change their role first, then delete the account', v_user.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*)::int,
         string_agg(format('"%s"', name), ', ' ORDER BY name) FILTER (WHERE rn <= 5)
    INTO v_n_owned, v_owned
    FROM (SELECT name, row_number() OVER (ORDER BY name) AS rn
            FROM public.projects WHERE modeler_id = p_target_user_id) p;
  IF v_n_owned > 0 THEN
    RAISE EXCEPTION '% owns % project(s) (%): transfer them to another owner or delete them first',
      v_user.email, v_n_owned, v_owned || CASE WHEN v_n_owned > 5 THEN ', …' ELSE '' END
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;

  -- What the delete will anonymise, counted BEFORE it happens (the rows keep no trace
  -- of whose they were afterwards, which is the point).
  v_anon := jsonb_build_object(
    'files_uploaded',    (SELECT count(*) FROM public.ingest_files      WHERE uploaded_by = p_target_user_id),
    'ingest_runs',       (SELECT count(*) FROM public.ingest_runs       WHERE p_target_user_id IN (triggered_by_user_id, applied_by_user_id)),
    'analysis_runs',     (SELECT count(*) FROM public.analysis_runs     WHERE actor_user_id = p_target_user_id),
    'supply_chain_rows', (SELECT count(*) FROM public.supply_chain_data WHERE uploaded_by = p_target_user_id));

  -- No name and no email: the log keeps the uuid, as the audit log does (header §3).
  v_before := jsonb_build_object(
    'id', v_user.id,
    'role', v_user.role,
    'organization_ids', COALESCE((SELECT jsonb_agg(m.org_id ORDER BY m.org_id)
                                    FROM public.organization_members m
                                   WHERE m.user_id = p_target_user_id), '[]'::jsonb),
    'project_memberships', (SELECT count(*) FROM public.project_members WHERE user_id = p_target_user_id));

  DELETE FROM public.ai_budgets WHERE scope = 'user' AND scope_id = p_target_user_id;
  DELETE FROM public.approved_users WHERE id = p_target_user_id;

  PERFORM public.log_admin_action('user.delete', 'approved_users', p_target_user_id::text, v_before,
    jsonb_build_object('deleted', true, 'anonymised', v_anon));

  RETURN jsonb_build_object('email', v_user.email, 'anonymised', v_anon);
END;
$$;

COMMENT ON FUNCTION public.admin_delete_user(uuid, text, uuid, text) IS
  'WP 7.2 (a), §4 D161/D213 — PERMANENTLY deletes one account. Active super admin only; '
  'the account''s email must be passed back as confirmation. Refuses the actor''s own '
  'account, a super admin, and an account that owns projects (named). Memberships, '
  'delegations, AI permissions and capabilities cascade; every file, run and lane the '
  'person recorded is kept with its actor set to NULL. Logged as user.delete without the '
  'person''s name or email. Suspension (admin_set_user_active) is the reversible verb.';

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid, text, uuid, text) TO anon, authenticated;

-- ── 5 · admin_delete_organization: the outside-work refusal goes ─────────────────
-- Same signature and body as `20260930000004`, less the refusal (header §4).
CREATE OR REPLACE FUNCTION public.admin_delete_organization(
  p_actor_id     uuid,
  p_actor_email  text,
  p_org_id       uuid,
  p_confirm_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      public.organizations%ROWTYPE;
  v_users    uuid[];
  v_detached uuid[];
  v_projects uuid[];
  v_pid      uuid;
  v_blocker  text;
  v_before   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  -- Said again in this body: `_assert_super_admin` sets it, but the attribution scan
  -- in `dataPlaneAudit.test.ts` reads text and cannot follow a call.
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_confirm_slug IS DISTINCT FROM v_org.slug THEN
    RAISE EXCEPTION 'confirmation does not match: type the slug "%" to delete this organization', v_org.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = p_actor_id AND org_id = p_org_id)
     OR EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_actor_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'you cannot delete your own organization (you belong to it — remove yourself from it first)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every account in it, locked so none can be moved in or out while this runs.
  PERFORM 1 FROM public.approved_users au
   WHERE au.organization_id = p_org_id
      OR EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = au.id AND m.org_id = p_org_id)
   ORDER BY au.id FOR UPDATE;

  -- Deleted: the accounts that belong to NO other organization. Detached: the rest.
  SELECT COALESCE(array_agg(au.id ORDER BY au.id) FILTER (WHERE NOT elsewhere), '{}'),
         COALESCE(array_agg(au.id ORDER BY au.id) FILTER (WHERE elsewhere), '{}')
    INTO v_users, v_detached
    FROM (SELECT au.id,
                 EXISTS (SELECT 1 FROM public.organization_members x
                          WHERE x.user_id = au.id AND x.org_id <> p_org_id) AS elsewhere
            FROM public.approved_users au
           WHERE au.organization_id = p_org_id
              OR EXISTS (SELECT 1 FROM public.organization_members m
                          WHERE m.user_id = au.id AND m.org_id = p_org_id)) au;

  SELECT string_agg(email, ', ' ORDER BY email) INTO v_blocker
    FROM public.approved_users
   WHERE id = ANY (v_users) AND role = 'super_admin'::public.app_role;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'this organization holds super admin account(s) (%): move them to another organization or change their role first', v_blocker
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_projects
    FROM public.projects
   WHERE organization_id = p_org_id
      OR (organization_id IS NULL AND modeler_id = ANY (v_users));

  -- Work a deleted account recorded in a project that is NOT being deleted stays, with
  -- its actor anonymised by the keys' ON DELETE SET NULL (WP 7.2 (a), §4 D213).

  v_before := to_jsonb(v_org) || jsonb_build_object(
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'role', u.role) ORDER BY u.email)
                         FROM public.approved_users u WHERE u.id = ANY (v_users)), '[]'::jsonb),
    'detached', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email) ORDER BY u.email)
                            FROM public.approved_users u WHERE u.id = ANY (v_detached)), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
                            FROM public.projects p WHERE p.id = ANY (v_projects)), '[]'::jsonb));

  -- Projects first: each through THE sweep, so a project leaves exactly as D170 says.
  FOREACH v_pid IN ARRAY v_projects LOOP
    PERFORM public._delete_project_rows(v_pid, p_actor_id, p_actor_email);
  END LOOP;

  DELETE FROM public.ai_budgets
   WHERE (scope = 'org'     AND scope_id = p_org_id)
      OR (scope = 'user'    AND scope_id = ANY (v_users))
      OR (scope = 'project' AND scope_id = ANY (v_projects));

  -- The memberships go BEFORE the organization, so each detached account re-points to
  -- its next organization through `trg_organization_members_repoint_active` rather than
  -- through the `ON DELETE SET NULL`, which cannot refresh the text copy.
  DELETE FROM public.organization_members WHERE org_id = p_org_id;
  DELETE FROM public.approved_users WHERE id = ANY (v_users);
  DELETE FROM public.organizations  WHERE id = p_org_id;

  PERFORM public.log_admin_action('org.delete', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('deleted', true,
                       'projects', cardinality(v_projects),
                       'users', cardinality(v_users),
                       'detached', cardinality(v_detached)));

  RETURN jsonb_build_object(
    'organization', v_org.name,
    'projects', cardinality(v_projects),
    'users', cardinality(v_users),
    'detached', cardinality(v_detached));
END;
$$;

COMMENT ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) IS
  'D208, D210, D213 — PERMANENTLY deletes an organization, its projects (each through '
  '_delete_project_rows) and the user accounts that belong to no other organization, in one '
  'transaction; accounts that also belong elsewhere are detached (they lose this membership '
  'and keep the others). Active super admin only; the organization''s slug must be passed '
  'back as confirmation. Refuses an organization the actor belongs to and one whose deletion '
  'would delete a super admin. Work a deleted account recorded outside the deleted projects '
  'is kept with its actor anonymised (WP 7.2 (a)). Suspension (admin_set_org_status) is the '
  'reversible verb.';

REVOKE ALL ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
