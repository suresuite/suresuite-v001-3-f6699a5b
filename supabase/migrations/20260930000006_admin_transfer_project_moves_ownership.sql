-- Admin projects / §4 D212 — transferring a project to another organization and naming a
-- new owner MOVES THE OWNERSHIP, not just the column that displays it.
--
-- ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────
--
-- `admin_transfer_project` (`20260712000002`) was written before a project had any
-- notion of a role. It rewrote `projects.organization_id`, the `organization` text copy,
-- `modeler_id` and `modeler_name`, and returned success. Since WP 2.2 / 3.4 the project
-- role lives in `project_members` (+ live `delegation_grants`), resolved by
-- `effective_project_role`, and the only writer that makes an owner an `owner` member is
-- `project_owner_membership` — AFTER INSERT, so it never runs on a transfer. Measured
-- against PostgreSQL 16 on the rehearsal schema, a transfer to org B naming B's user:
--
--   · the NEW owner resolved to NO project role (`effective_project_role` NULL), so every
--     reader of the role refused them on the project they now own — promotion of an
--     upload (editor+, D65), the resolver's project layer (`capabilities_for_user(user,
--     project)`), and /admin/users/:userId showed them as not a member of it;
--   · the PREVIOUS owner, in another tenant, stayed a standing `owner` — and D211's
--     `admin_set_project_member` refuses any role but `owner` for the modeler, so the
--     admin screen could not repair the new owner either except by re-granting `owner`;
--   · nothing checked that the owner belongs to the target organization. Project
--     visibility follows the ACTIVE organization (D210), so a transfer that kept the
--     current owner, or named a user of another organization, produced a project its
--     owner could never see — and the dialog offered every account on the platform;
--   · members and delegations of the organization the project LEFT kept their roles.
--
-- ── WHAT THE TRANSFER DOES NOW, IN ONE STATEMENT OF THE RULE ─────────────────
--
--   1. The owner (the new one, or the current one when none is named) must be an ACTIVE
--      account and a MEMBER of the target organization (`organization_members`, D210).
--      Otherwise the transfer is refused and nothing changes — the super admin adds the
--      account to the organization first (/admin/users/:userId) or picks someone there.
--   2. `projects` is rewritten as before; the target organization's project limit and
--      access period still refuse it through `trg_tenant_allowance` (D207).
--   3. The owner is a standing `owner` member (upsert; an expiry is cleared).
--   4. When the owner CHANGES, the previous owner's membership is removed and every live
--      delegation they granted on the project is revoked — a delegation is subtractive
--      from its grantor's level (G3) and the grantor no longer holds one.
--   5. When the organization CHANGES, every membership held by an account that does not
--      belong to the target organization is removed, and every live delegation to such an
--      account is revoked. The project left that tenant; its people leave with it.
--   6. The same target organization is allowed — that is "change the owner" — but a call
--      that changes neither organization nor owner is refused rather than logged as a
--      transfer that did nothing.
--
-- It returns what it did (jsonb), so the page can say it — including whether the owner's
-- ACTIVE organization is the target, because otherwise they see the project only after
-- switching to it (D210). Every removal and revocation is in the admin log row.
--
-- `admin_list_users_basic` gains `org_ids` — the account's memberships — so the dialog
-- offers only accounts that belong to the target organization. Its `organization_id` is
-- the ACTIVE organization, and filtering on that would hide a member who is working in
-- another of their organizations.
--
-- A one-time REPAIR (§3) gives every project's current modeler a standing `owner` row —
-- the owner an earlier transfer left without one — and removes the `owner` rows the
-- system wrote for an account only because it WAS the modeler and no longer is. A row an
-- administrator granted on purpose is kept.
--
-- ── WHAT IS NOT ─────────────────────────────────────────────────────────────
--
-- The child rows' `organization` text copies (network_*, node_list, simulation_*, …) are
-- not rewritten: no policy reads them (the project-scoped policies join `projects`, and
-- the one family that compares text compares `projects.organization`, which moves). The
-- actor is still D28's client assertion. `admin_copy_project` keeps its behaviour; its
-- new row's owner is made an `owner` member by the insert trigger already.

-- ── 1 · the transfer ────────────────────────────────────────────────────────
-- The return type changes (void → jsonb), which CREATE OR REPLACE cannot do; DROP takes
-- the grants with it and they are restated below.
DROP FUNCTION IF EXISTS public.admin_transfer_project(uuid, text, uuid, uuid, uuid);

CREATE FUNCTION public.admin_transfer_project(
  p_actor_id uuid, p_actor_email text, p_project_id uuid,
  p_org_id uuid, p_new_owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project     public.projects%ROWTYPE;
  v_before      jsonb;
  v_org_name    text;
  v_owner       public.approved_users%ROWTYPE;
  v_owner_id    uuid;
  v_owner_name  text;
  v_org_changed boolean;
  v_own_changed boolean;
  v_removed     jsonb := '[]'::jsonb;
  v_revoked     jsonb := '[]'::jsonb;
  v_rows        jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);

  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;
  v_before := to_jsonb(v_project);

  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;
  IF v_org_name IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;

  -- (1) the owner: named, or the current one kept
  v_owner_id := COALESCE(p_new_owner_id, v_project.modeler_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'owner_required: the project has no owner — pick a new owner from %', v_org_name;
  END IF;
  SELECT * INTO v_owner FROM public.approved_users WHERE id = v_owner_id;
  IF NOT FOUND THEN
    IF p_new_owner_id IS NOT NULL THEN RAISE EXCEPTION 'new owner not found'; END IF;
    RAISE EXCEPTION 'owner_required: the current owner is not a user account — pick a new owner from %', v_org_name;
  END IF;
  v_owner_name := COALESCE(NULLIF(btrim(COALESCE(v_owner.name, '')), ''), v_owner.email);
  IF NOT COALESCE(v_owner.is_active, false) THEN
    RAISE EXCEPTION 'owner_suspended: % is suspended and cannot own a project — reactivate the account or pick another owner', v_owner_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m
                  WHERE m.org_id = p_org_id AND m.user_id = v_owner_id) THEN
    RAISE EXCEPTION 'owner_not_in_organization: % does not belong to % and would never see the project — add them to % on /admin/users first, or pick an owner who belongs to it',
      v_owner_name, v_org_name, v_org_name;
  END IF;

  v_org_changed := v_project.organization_id IS DISTINCT FROM p_org_id;
  v_own_changed := v_project.modeler_id IS DISTINCT FROM v_owner_id;
  IF NOT v_org_changed AND NOT v_own_changed THEN
    RAISE EXCEPTION 'nothing_to_change: the project is already in % and owned by %', v_org_name, v_owner_name;
  END IF;

  -- (2) the project row — `trg_tenant_allowance` refuses a full or ended organization
  BEGIN
    UPDATE public.projects SET
      organization_id = p_org_id,
      organization    = v_org_name,
      modeler_id      = v_owner_id,
      modeler_name    = v_owner_name,
      updated_at      = now()
    WHERE id = p_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the new owner already has a project named "%" for plant "%"',
      v_project.name, v_project.plant_name;
  END;

  -- (4) the previous owner's standing, and what they delegated
  IF v_own_changed AND v_project.modeler_id IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.project_members pm
       WHERE pm.project_id = p_project_id AND pm.user_id = v_project.modeler_id
      RETURNING pm.user_id, pm.project_role)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'project_role', project_role,
                                                 'reason', 'previous owner')), '[]'::jsonb)
      INTO v_rows FROM d;
    v_removed := v_removed || v_rows;

    WITH r AS (
      UPDATE public.delegation_grants dg SET revoked_at = now()
       WHERE dg.project_id = p_project_id AND dg.grantor_user_id = v_project.modeler_id
         AND dg.revoked_at IS NULL AND dg.expires_at > now()
      RETURNING dg.id, dg.grantee_user_id, dg.project_role)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'grantee_user_id', grantee_user_id,
                                                 'project_role', project_role,
                                                 'reason', 'granted by the previous owner')), '[]'::jsonb)
      INTO v_rows FROM r;
    v_revoked := v_revoked || v_rows;
  END IF;

  -- (5) the organization the project left
  IF v_org_changed THEN
    WITH d AS (
      DELETE FROM public.project_members pm
       WHERE pm.project_id = p_project_id
         AND pm.user_id <> v_owner_id
         AND NOT EXISTS (SELECT 1 FROM public.organization_members m
                          WHERE m.org_id = p_org_id AND m.user_id = pm.user_id)
      RETURNING pm.user_id, pm.project_role)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'project_role', project_role,
                                                 'reason', 'not in the target organization')), '[]'::jsonb)
      INTO v_rows FROM d;
    v_removed := v_removed || v_rows;

    WITH r AS (
      UPDATE public.delegation_grants dg SET revoked_at = now()
       WHERE dg.project_id = p_project_id
         AND dg.revoked_at IS NULL AND dg.expires_at > now()
         AND NOT EXISTS (SELECT 1 FROM public.organization_members m
                          WHERE m.org_id = p_org_id AND m.user_id = dg.grantee_user_id)
      RETURNING dg.id, dg.grantee_user_id, dg.project_role)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'grantee_user_id', grantee_user_id,
                                                 'project_role', project_role,
                                                 'reason', 'grantee not in the target organization')), '[]'::jsonb)
      INTO v_rows FROM r;
    v_revoked := v_revoked || v_rows;
  END IF;

  -- (3) the owner is a standing owner — after the removals, so no rule above can take it
  INSERT INTO public.project_members (project_id, user_id, project_role, granted_by, expires_at, rationale)
  VALUES (p_project_id, v_owner_id, 'owner', p_actor_id, NULL,
          'the project''s owner, by admin_transfer_project (D212)')
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET project_role = 'owner',
        granted_by   = EXCLUDED.granted_by,
        expires_at   = NULL,
        rationale    = EXCLUDED.rationale,
        updated_at   = now();

  v_rows := jsonb_build_object(
    'org_id', p_org_id, 'org_name', v_org_name,
    'organization_changed', v_org_changed,
    'owner_id', v_owner_id, 'owner_name', v_owner_name,
    'owner_changed', v_own_changed,
    'previous_owner_id', v_project.modeler_id,
    'owner_active_org_is_target', v_owner.organization_id IS NOT DISTINCT FROM p_org_id,
    'memberships_removed', v_removed,
    'delegations_revoked', v_revoked);
  PERFORM public.log_admin_action('project.transfer', 'projects', p_project_id::text, v_before, v_rows);
  RETURN v_rows;
END; $$;
COMMENT ON FUNCTION public.admin_transfer_project(uuid, text, uuid, uuid, uuid) IS
  'D212 — move a project to an organization and/or hand it to a new owner. The owner must be '
  'an active member of the target organization; they become a standing owner member; the '
  'previous owner''s membership and delegations go; on an organization change, memberships '
  'and delegations of accounts outside the target organization go. Returns what it did.';
REVOKE ALL ON FUNCTION public.admin_transfer_project(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transfer_project(uuid, text, uuid, uuid, uuid) TO anon, authenticated;

-- ── 2 · the owner picker's directory: every organization an account belongs to ──
DROP FUNCTION IF EXISTS public.admin_list_users_basic(uuid, text);

CREATE FUNCTION public.admin_list_users_basic(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (id uuid, name text, email text, role text, organization_id uuid,
               is_active boolean, org_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT u.id, u.name, u.email, u.role::text, u.organization_id, u.is_active,
         COALESCE((SELECT array_agg(m.org_id ORDER BY m.org_id)
                     FROM public.organization_members m WHERE m.user_id = u.id),
                  ARRAY[]::uuid[])
  FROM public.approved_users u
  ORDER BY COALESCE(u.name, u.email);
END; $$;
COMMENT ON FUNCTION public.admin_list_users_basic(uuid, text) IS
  'Owner pickers on /admin/projects. organization_id is the ACTIVE organization (D210); '
  'org_ids is every organization the account belongs to (D212), which is what decides '
  'whether it may own a project there.';
REVOKE ALL ON FUNCTION public.admin_list_users_basic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users_basic(uuid, text) TO anon, authenticated;

-- ── 3 · repair: every project's owner is a standing owner member ─────────────
-- Projects transferred before this migration left their new owner with no membership
-- (and D61's backfill only ran for the modelers of its day). Idempotent; a project whose
-- modeler is not an account is left alone, as `project_owner_membership` leaves it.
INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
SELECT p.id, p.modeler_id, 'owner',
       'backfilled from projects.modeler_id by D212 — the owner an earlier transfer left without a role'
  FROM public.projects p
 WHERE p.modeler_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = p.modeler_id)
ON CONFLICT (project_id, user_id) DO UPDATE
  SET project_role = 'owner', expires_at = NULL, updated_at = now()
  WHERE project_members.project_role IS DISTINCT FROM 'owner'
     OR project_members.expires_at IS NOT NULL;

-- …and the PREVIOUS owner an earlier transfer left as a standing owner. Only the rows the
-- system itself wrote BECAUSE that account was the modeler (the WP 2.2 / WP 3.4 backfills,
-- `project_owner_membership`, this function) — identified by the rationale each of those
-- writers stamps. An `owner` row an administrator granted on purpose
-- (`admin_set_project_member`, D211) carries its own rationale or none, and is kept.
DELETE FROM public.project_members pm
 USING public.projects p
 WHERE p.id = pm.project_id
   AND pm.user_id IS DISTINCT FROM p.modeler_id
   AND pm.project_role = 'owner'
   AND (pm.rationale LIKE 'backfilled from projects.modeler_id by %'
        OR pm.rationale LIKE 'the project''s modeler, by projects_owner_membership%'
        OR pm.rationale LIKE 'the project''s owner, by admin_transfer_project%');
