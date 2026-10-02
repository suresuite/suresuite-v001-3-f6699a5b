-- Profile / §4 D278 — an ACCOUNT role change on /admin/users reaches the organization role,
-- says what it did not change, and is visible to the accounts it would contradict.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- `admin_set_user_role` wrote `approved_users.role` and nothing else. Three things a super
-- admin reasonably expects from "user → admin" did not happen, and the page said nothing:
--
--   · THE ORGANIZATION ROLE STAYED. `approved_users_sync_org_membership` maps account role
--     `admin` to organization role `admin` — but only when a membership is CREATED (it
--     returns early unless `organization_id` changes), so a promotion left the active
--     organization's membership at `member`, and a DEMOTION left an `admin` membership in
--     place. The demotion is the half that holds a right: `_api_key_management_org` admits
--     an organization owner/admin whatever the account role, so an `admin` demoted to
--     `user` kept managing the organization's API keys and kept every scope on a personal
--     key (`_api_key_caller.can_manage`). The promotion half was a contradiction on screen:
--     /profile's My organization tab and /admin/users listed an account admin as a member.
--   · OVERRIDES STILL DECIDED. A person override (`user_capabilities`) or an organization
--     override (`org_capabilities`) beats the account role in `capabilities_for_user`, so
--     a switch that is off for the person stays off however the role moves.
--   · PROJECT ROLES STILL LIMIT. Since D276 a project role narrows the account role on the
--     four project-scoped rights; a Viewer member stays a viewer on that project.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `admin_set_user_role` keeps every guard (super-admin assertion, last-super-admin
--     lock, self-demotion refusal, the `user.role_change` audit row) and now:
--       – moves the ACTIVE organization's membership (`approved_users.organization_id`,
--         D210) and no other: becoming `admin` lifts `member` → `admin`; leaving `admin`
--         lowers `admin` → `member`. `owner` is never touched, and the account's other
--         organizations are never touched — a role in one tenant is not a role in another.
--         Each change writes `user.org_role_change` in the shape `admin_set_user_org_role`
--         writes it.
--       – RETURNS what it did and what still decides instead (jsonb, so DROP and CREATE):
--         `{role_before, role_after, org: {org_id, name, org_role_before, org_role_after},
--          overrides: [{key, label, kind, layer, allowed, role_default}],
--          narrowed_projects: [{project_id, name, project_role, keys: [{key, label}]}]}`.
--         `overrides` lists only the person / organization overrides that now DIFFER from
--         the new role's default (the one that decides: a person override hides an
--         organization one). `narrowed_projects` reads `project_right_decisions` — the
--         D276 rule's own inputs and answer — and keeps the keys the PROJECT ROLE refuses
--         while the account allows them. The rule is not re-authored here.
--   · `admin_list_account_role_gaps` — read-only: every account whose role is `admin` and
--     whose ACTIVE organization membership is `member`, which is what this function's
--     earlier body left behind. No backfill: the page offers the one-click fix through the
--     existing `admin_set_user_org_role`, so each correction is a super admin's, audited.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- `admin` is still not `super_admin`: the administration area (/admin, every `admin_*`
-- RPC) stays super-admin-only, and the page says so beside the picker. An account whose
-- active organization is not the one an admin meant is moved in that one only — the other
-- memberships are `admin_set_user_org_role`'s, on /admin/users/:userId. An open session
-- learns of the change from the browser's own refresh (focus, visibility, five minutes),
-- not from a push: nothing in this database can reach a browser.

-- ── 1 · the verb ─────────────────────────────────────────────────────────────
-- The return type changes, which `CREATE OR REPLACE` refuses, so DROP and CREATE — and the
-- DROP takes the grants with it; they are re-issued exactly as `20260929000002` issued them.
DROP FUNCTION IF EXISTS public.admin_set_user_role(uuid, text, uuid, text);
CREATE FUNCTION public.admin_set_user_role(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before     text;
  v_active     boolean;
  v_org        uuid;
  v_org_name   text;
  v_org_before text;
  v_org_after  text;
  v_overrides  jsonb;
  v_narrowed   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_role NOT IN ('super_admin','admin','modeler','user') THEN RAISE EXCEPTION 'invalid role %', p_role; END IF;
  SELECT role::text, is_active INTO v_before, v_active FROM public.approved_users WHERE id = p_target_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_before = 'super_admin' AND p_role <> 'super_admin' THEN
    IF p_target_user_id = p_actor_id THEN
      RAISE EXCEPTION 'you cannot remove your own super_admin role — ask another super admin';
    END IF;
    PERFORM public._lock_active_super_admins();
    IF v_active AND public._active_super_admin_count() <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last active super admin';
    END IF;
  END IF;
  UPDATE public.approved_users SET role = p_role::public.app_role WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.role_change', 'approved_users', p_target_user_id::text,
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));

  -- D278 — the ACTIVE organization's member/admin role follows; owner and every other
  -- membership are not this verb's (D210).
  SELECT u.organization_id, o.name INTO v_org, v_org_name
    FROM public.approved_users u
    LEFT JOIN public.organizations o ON o.id = u.organization_id
   WHERE u.id = p_target_user_id;
  IF v_org IS NOT NULL THEN
    SELECT m.org_role INTO v_org_before FROM public.organization_members m
     WHERE m.org_id = v_org AND m.user_id = p_target_user_id
       FOR UPDATE;
    v_org_after := CASE
      WHEN v_org_before = 'member' AND p_role = 'admin'                        THEN 'admin'
      WHEN v_org_before = 'admin'  AND v_before = 'admin' AND p_role <> 'admin' THEN 'member'
      ELSE v_org_before END;
    IF v_org_after IS DISTINCT FROM v_org_before THEN
      UPDATE public.organization_members SET org_role = v_org_after
       WHERE org_id = v_org AND user_id = p_target_user_id;
      PERFORM public.log_admin_action('user.org_role_change', 'organization_members', p_target_user_id::text,
        jsonb_build_object('org_id', v_org, 'org_role', v_org_before),
        jsonb_build_object('org_id', v_org, 'org_role', v_org_after));
    END IF;
  END IF;

  -- What still decides instead: the override that decides each key, where it now differs
  -- from the new role's default. A super admin skips every layer, so none decides.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', c.key, 'label', c.label, 'kind', c.kind,
           'layer', CASE WHEN y.user_ IS NOT NULL THEN 'person' ELSE 'organization' END,
           'allowed', COALESCE(y.user_, y.org_),
           'role_default', y.default_)
           ORDER BY c.sort_order, c.key), '[]'::jsonb)
    INTO v_overrides
    FROM public.capabilities c
    CROSS JOIN LATERAL (SELECT
      (SELECT uc.allowed FROM public.user_capabilities uc
        WHERE uc.user_id = p_target_user_id AND uc.capability_key = c.key) AS user_,
      (SELECT oc.allowed FROM public.org_capabilities oc
        WHERE oc.org_id = v_org AND oc.capability_key = c.key)            AS org_,
      COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
        WHERE rc.role = p_role AND rc.capability_key = c.key), false)     AS default_) y
   WHERE p_role <> 'super_admin'
     AND c.key <> '/profile'
     AND COALESCE(y.user_, y.org_) IS NOT NULL
     AND COALESCE(y.user_, y.org_) IS DISTINCT FROM y.default_;

  -- …and every project whose ROLE refuses a right the account now allows, as D276's rule
  -- answers it (`project_right_decisions`), not as this function would guess it.
  WITH reach AS (
    SELECT pm.project_id AS id FROM public.project_members pm WHERE pm.user_id = p_target_user_id
    UNION
    SELECT dg.project_id FROM public.delegation_grants dg
     WHERE dg.grantee_user_id = p_target_user_id AND dg.revoked_at IS NULL AND dg.expires_at > now()
    UNION
    SELECT p.id FROM public.projects p WHERE p.modeler_id = p_target_user_id
  ), narrowed AS (
    SELECT p.id, p.name, d.value ->> 'project_role' AS project_role,
           jsonb_agg(jsonb_build_object('key', d.key, 'label', COALESCE(c.label, d.key))
                     ORDER BY c.sort_order, d.key) AS keys
      FROM reach
      JOIN public.projects p ON p.id = reach.id
      CROSS JOIN LATERAL jsonb_each(public.project_right_decisions(p_target_user_id, p.id)) d
      LEFT JOIN public.capabilities c ON c.key = d.key
     WHERE d.value ->> 'decided_by' = 'project_role'
       AND (d.value ->> 'allowed')::boolean IS FALSE
       AND (d.value ->> 'account_allows')::boolean IS TRUE
     GROUP BY p.id, p.name, d.value ->> 'project_role'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'project_id', n.id, 'name', n.name, 'project_role', n.project_role, 'keys', n.keys)
           ORDER BY lower(n.name), n.id), '[]'::jsonb)
    INTO v_narrowed
    FROM narrowed n;

  RETURN jsonb_build_object(
    'role_before', v_before,
    'role_after',  p_role,
    'org', CASE WHEN v_org IS NULL THEN NULL ELSE jsonb_build_object(
             'org_id', v_org, 'name', v_org_name,
             'org_role_before', v_org_before, 'org_role_after', v_org_after) END,
    'overrides', v_overrides,
    'narrowed_projects', v_narrowed);
END; $$;
COMMENT ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) IS
  'D205, D278 — a super admin sets an account role. Refuses self-demotion and demoting the '
  'last active super admin. The ACTIVE organization''s membership follows (member → admin on '
  'becoming admin, admin → member on leaving it; owner and other organizations untouched), '
  'audited as user.org_role_change. Returns {role_before, role_after, org, overrides, '
  'narrowed_projects}: what changed, and the overrides and project roles that still decide.';
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) TO anon, authenticated;

-- ── 2 · the accounts the old body left behind ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_account_role_gaps(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (user_id uuid, org_id uuid, org_name text, role text, org_role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT u.id, m.org_id, o.name, u.role::text, m.org_role
    FROM public.approved_users u
    JOIN public.organization_members m ON m.user_id = u.id AND m.org_id = u.organization_id
    JOIN public.organizations o ON o.id = m.org_id
   WHERE u.role = 'admin'::public.app_role
     AND m.org_role = 'member'
   ORDER BY lower(o.name), u.id;
END; $$;
COMMENT ON FUNCTION public.admin_list_account_role_gaps(uuid, text) IS
  'D278 — read-only, active super admin only: accounts whose role is admin while their ACTIVE '
  'organization membership is member (what admin_set_user_role left before D278). /admin/users '
  'flags them and fixes each through admin_set_user_org_role.';
REVOKE ALL ON FUNCTION public.admin_list_account_role_gaps(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_account_role_gaps(uuid, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
