-- Admin organizations / §4 D208 — an organization can be DELETED, permanently, and
-- that is a different verb from suspending it.
--
-- Until now /admin/organizations offered Suspend and Reactivate and nothing else.
-- Suspension is a reversible label (`organizations.status`); there was no way to
-- remove a tenant at all, and the schema would not have done it honestly if someone
-- had tried: `projects.organization_id` and `approved_users.organization_id` are both
-- `ON DELETE SET NULL`, so a bare `DELETE FROM organizations` would have left every
-- project and every account of the tenant in place, detached from any organization —
-- projects no admin could reach, and accounts that still sign in.
--
-- THE OWNER'S DECISION (2026-09-29): deleting an organization deletes its projects
-- (with all their data) AND its user accounts. One transaction: all of it or none of it.
--
-- ── 1 · ONE SWEEP, AUTHORED ONCE ────────────────────────────────────────────
-- What "delete a project" reaches is D170's answer, measured and rehearsed
-- (`rehearsal/370`): the project row first so the D142 rebuild skips it, then the
-- tables no foreign key reaches. Deleting an organization must delete each project
-- EXACTLY that way, and it cannot call `delete_project`: that gate admits the owner or
-- an admin of the project's organization and deliberately not a super admin. Writing
-- the list a second time here is D101's shape — one fact, two authors, nothing
-- comparing them — so the sweep moves into `_delete_project_rows`, which both call.
-- `delete_project` keeps its signature, its authorization and its grants; its body is
-- now the gate plus one call. `chains.mjs` (`deriveProjectDeletion`) and
-- `rehearsal/370` §6 read the sweep from the helper.
--
-- ── 2 · WHAT THE ORGANIZATION DELETE REMOVES ────────────────────────────────
--   · every project whose `organization_id` is this organization, and every project
--     with NO organization owned (`modeler_id`) by one of its accounts — nobody could
--     reach such a project once its owner is gone;
--   · every account whose `organization_id` is this organization (an account is in at
--     most one, D205), with what CASCADEs from it: memberships, project roles,
--     delegation grants, AI permissions, capabilities;
--   · AI budgets scoped to the organization, to one of its accounts or to one of its
--     projects (`ai_budgets.scope_id` carries no foreign key);
--   · the organization row, and what CASCADEs from it: API keys, capabilities,
--     memberships.
-- KEPT, on purpose: the audit log, and the usage logs (`ai_usage_logs`,
-- `ai_chat_events`, `api_request_logs`) — they record what happened, and deleting a
-- tenant does not unhappen it; their organization and user columns go NULL where a
-- foreign key says so. NOT reached: `chat_threads` and `user_files` rows of the
-- deleted accounts, and the storage objects behind uploaded files — neither table
-- has a foreign key to `approved_users`, and removing storage objects is not a thing
-- a SQL function can do atomically. Stated in D208 rather than implied.
--
-- ── 3 · WHAT IT REFUSES, BEFORE IT DELETES ANYTHING ─────────────────────────
--   · anyone but an active super admin (`_assert_super_admin`);
--   · a confirmation that is not the organization's slug, typed — the page asks for
--     it, and the server checks it, so a stale page or a replayed request cannot
--     delete a tenant the admin did not name;
--   · the acting admin's own organization — the deletion would delete them;
--   · an organization holding a super admin account — a platform administrator is
--     moved or demoted deliberately, not erased as a side effect of a tenant delete.
--     (The actor is an active super admin outside the organization, so the platform
--     always keeps one.)
--   · an account of the organization that is recorded as the actor on a row OUTSIDE
--     the projects being deleted (`analysis_runs.actor_user_id`,
--     `supply_chain_data.uploaded_by`, `ingest_files.uploaded_by` — the last is
--     D161: erasing it would UPDATE a write-once tier-0 row). Without this check the
--     delete fails on a foreign key with a message about some other table; with it,
--     the refusal names the account.
--
-- Attribution: the actor is set LOCAL by `_assert_super_admin` and again by the
-- helper for each project, so every audit row the deletion causes names them
-- (`audit-actor`, G4); `log_admin_action('org.delete', …)` records what was removed.

-- ── 1 · the sweep ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._delete_project_rows(
  p_project_id uuid,
  p_user_id    uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '_delete_project_rows: this delete must name its actor'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  -- 1) Disruption profiles and their children, and the legacy scenarios table.
  -- The disruption profile's children first: they reach the project only through
  -- the profile, and nothing rebuilds from them.
  DELETE FROM public.disruption_scenario_effects e USING public.disruption_scenario_profiles sp
   WHERE e.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_targets t USING public.disruption_scenario_profiles sp
   WHERE t.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_settings s USING public.disruption_scenario_profiles sp
   WHERE s.profile_id = sp.id AND sp.project_id = p_project_id;
  DELETE FROM public.disruption_scenario_profiles WHERE project_id = p_project_id;
  DELETE FROM public.disruption_scenarios         WHERE project_id = p_project_id;

  -- THE PROJECT ROW GOES BEFORE ITS LANE SOURCES (`20260922000009`). Every source
  -- delete fires `auto_rebuild_supply_chain_lanes` (D142); with the row gone, the
  -- cascade (D117) removes the sources and the rebuild skips a project that no longer
  -- exists — 0.5 s rather than 44 s on a project the size of production's largest.
  DELETE FROM public.projects WHERE id = p_project_id;

  -- What the cascade cannot reach: tables with no foreign key to `projects`, and a
  -- sweep of the rest, which is a no-op when the cascade already removed them.
  DELETE FROM public.simulation_results WHERE project_id = p_project_id;
  DELETE FROM public.network_edges      WHERE project_id = p_project_id;
  DELETE FROM public.network_nodes      WHERE project_id = p_project_id;

  DELETE FROM public.inbound_logistics       WHERE project_id = p_project_id;
  DELETE FROM public.outbound_logistics      WHERE project_id = p_project_id;
  DELETE FROM public.bom_single_level        WHERE project_id = p_project_id;
  DELETE FROM public.bom_multi_level         WHERE project_id = p_project_id;
  DELETE FROM public.multi_tier_supply_chain WHERE project_id = p_project_id;

  DELETE FROM public.supply_chain_data            WHERE project_id = p_project_id;
  DELETE FROM public.supply_chain_data_multi_tier WHERE project_id = p_project_id;
  DELETE FROM public.node_list                    WHERE project_id = p_project_id;
END;
$$;

COMMENT ON FUNCTION public._delete_project_rows(uuid, uuid, text) IS
  'D170/D208 — THE project sweep: removes one project and everything scoped to it, '
  'project row first so the D142 rebuild skips it. Authorizes NOTHING; its two callers '
  '(delete_project, admin_delete_organization) do. Logs are kept.';

-- Internal: only the two SECURITY DEFINER callers reach it, as its owner.
REVOKE ALL ON FUNCTION public._delete_project_rows(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._delete_project_rows(uuid, uuid, text) FROM anon, authenticated;

-- ── delete_project: the same gate, the sweep by call ────────────────────────
CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id    uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists  boolean;
  v_org_id  uuid;
  v_modeler uuid;
  v_role    text;
  v_user_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_project: this delete must name its actor'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT true, p.organization_id, p.modeler_id
    INTO v_exists, v_org_id, v_modeler
    FROM public.projects p
   WHERE p.id = p_project_id;
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'delete_project: project % not found', p_project_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_user_org
    FROM public.approved_users au WHERE au.id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'delete_project: % is not an approved user', p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
       v_modeler = p_user_id
    OR (v_role = 'admin' AND v_org_id IS NOT DISTINCT FROM v_user_org AND v_org_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'delete_project: % may not delete project % (only its owner or an admin of its organization may)',
      p_user_id, p_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The actor, LOCAL to this transaction, so every trigger below names them.
  PERFORM public.set_current_user_context(p_user_id, COALESCE(p_user_email, ''));

  PERFORM public._delete_project_rows(p_project_id, p_user_id, p_user_email);
END;
$$;

COMMENT ON FUNCTION public.delete_project(uuid, uuid, text) IS
  'D170 — deletes ONE project and everything scoped to it in a single transaction: '
  'all of it or none of it. The owner or an admin of the project''s organization '
  'may call it; the actor is set LOCAL so every audit row names them. '
  'The sweep itself is _delete_project_rows (D208), shared with admin_delete_organization.';

REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(uuid, uuid, text) TO service_role;

-- ── 2 · admin_delete_organization ───────────────────────────────────────────
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

  IF EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_actor_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'you cannot delete your own organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The accounts, locked so none can be moved in or out while this runs.
  PERFORM 1 FROM public.approved_users WHERE organization_id = p_org_id ORDER BY id FOR UPDATE;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_users
    FROM public.approved_users WHERE organization_id = p_org_id;

  SELECT string_agg(email, ', ' ORDER BY email) INTO v_blocker
    FROM public.approved_users
   WHERE organization_id = p_org_id AND role = 'super_admin'::public.app_role;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'this organization holds super admin account(s) (%): move them to another organization or change their role first', v_blocker
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_projects
    FROM public.projects
   WHERE organization_id = p_org_id
      OR (organization_id IS NULL AND modeler_id = ANY (v_users));

  -- An account recorded as the actor on a row that is NOT being deleted cannot be
  -- deleted either (no foreign key there lets go; `ingest_files` is D161).
  SELECT string_agg(DISTINCT au.email, ', ') INTO v_blocker
    FROM public.approved_users au
   WHERE au.id = ANY (v_users)
     AND (   EXISTS (SELECT 1 FROM public.analysis_runs r
                      WHERE r.actor_user_id = au.id AND NOT (r.project_id = ANY (v_projects)))
          OR EXISTS (SELECT 1 FROM public.supply_chain_data s
                      WHERE s.uploaded_by = au.id AND NOT (s.project_id = ANY (v_projects)))
          OR EXISTS (SELECT 1 FROM public.ingest_files f JOIN public.ingest_runs ir ON ir.id = f.ingest_run_id
                      WHERE f.uploaded_by = au.id AND NOT (ir.project_id = ANY (v_projects))));
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'account(s) % recorded work in a project outside this organization, so they cannot be deleted with it: move them to that organization first', v_blocker
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_before := to_jsonb(v_org) || jsonb_build_object(
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'role', u.role) ORDER BY u.email)
                         FROM public.approved_users u WHERE u.id = ANY (v_users)), '[]'::jsonb),
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

  DELETE FROM public.approved_users WHERE id = ANY (v_users);
  DELETE FROM public.organizations  WHERE id = p_org_id;

  PERFORM public.log_admin_action('org.delete', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('deleted', true,
                       'projects', cardinality(v_projects),
                       'users', cardinality(v_users)));

  RETURN jsonb_build_object(
    'organization', v_org.name,
    'projects', cardinality(v_projects),
    'users', cardinality(v_users));
END;
$$;

COMMENT ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) IS
  'D208 — PERMANENTLY deletes an organization, its projects (each through '
  '_delete_project_rows) and its user accounts, in one transaction. Active super admin '
  'only; the organization''s slug must be passed back as confirmation. Refuses the '
  'actor''s own organization, one holding a super admin, and accounts recorded as the '
  'actor on rows outside the deleted projects. Suspension (admin_set_org_status) is the '
  'reversible verb; this one is not.';

REVOKE ALL ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
