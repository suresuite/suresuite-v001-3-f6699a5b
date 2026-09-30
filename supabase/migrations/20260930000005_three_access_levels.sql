-- Access levels / §4 D211 — three levels, each role said once: PLATFORM, ORGANIZATION,
-- PROJECT. Nothing here changes what any policy admits.
--
-- The owner asked for the roles to be reconciled "so that I could do it appropriately".
-- Five role vocabularies were live and the screens named two of them, with one word:
--
--   PLATFORM      approved_users.role = 'super_admin'          — operates every tenant
--   ORGANIZATION  approved_users.role ∈ admin | modeler | user — the ACCOUNT TIER. It is
--                   what every org-scoped write policy reads, and it applies in EVERY
--                   organization the account belongs to (D210)
--                 organization_members.org_role ∈ owner | admin | member — per membership;
--                   read by the API-key verbs and nothing else
--   PROJECT       project_members.project_role / delegation_grants ∈ owner | editor |
--                   analyst | viewer — read by the promotion (editor+) and the export
--                   audit, and by NO row-level policy (D66)
--
-- The decision D66 has waited on since WP 6.2 is taken (the owner, 2026-09-30): **an
-- organization admin is an OWNER of every project in its organization.** It is the
-- target vocabulary, recorded in PLAN.md; making it the RULE is WP 7.1's, because it
-- changes what ~60 policies admit and the owner chose "clarity now, rules later".
-- So this migration makes the levels VISIBLE and MANAGEABLE, and keeps every rule:
--
-- ── 1 · the creator stays an owner when a project changes hands ─────────────────
--   `projects_owner_membership` (D61) makes a new project's modeler its owner, AFTER
--   INSERT only. `admin_transfer_project` can hand a project to a new modeler — who then
--   passes every write policy (they read `modeler_id`) while holding no project role, so
--   they cannot promote an upload into their own project. An AFTER UPDATE OF modeler_id
--   trigger closes that; the previous modeler's row stays for a super admin to decide.
--   The backfill fills the owner row wherever it is missing, and demotes nobody.
--
-- ── 2 · the super admin's verbs ─────────────────────────────────────────────────
--   admin_set_org_member_role(…)   — change a membership's org role in place. Until now
--                                     the only way was remove-and-re-add, which moves the
--                                     account's ACTIVE organization when it was that one
--   admin_set_project_member(…)    — give or change a project role. The account must be
--                                     a member of the project's organization: a project
--                                     role never crosses the tenant wall (D210)
--   admin_remove_project_member(…) — take it away
--   Both project verbs refuse to leave the project's CREATOR without the owner role
--   (`creator_is_owner` — transfer the project to change its creator) and to leave a
--   project with no owner at all (`last_owner`). All three are logged through
--   `log_admin_action`.
--
-- ── 3 · the reads ───────────────────────────────────────────────────────────────
--   admin_project_access(…)     — everyone with any standing on one project: the members
--                                 of its organization, and anyone holding a project row
--                                 or a live delegation on it, each with ALL THREE levels
--                                 and `effective_role` as `effective_project_role()` says
--   admin_user_project_roles(…) — the same, for one account across projects
--   list_my_project_roles(…)    — the account's own, for the projects of its ACTIVE
--                                 organization (what it can see)
--   Each returns FACTS only; what a combination of them lets someone do is written once,
--   in `src/lib/auth/accessLevels.ts`, beside the policies it restates.
--
-- ── 4 · what is NOT ─────────────────────────────────────────────────────────────
--   No policy, and no resolver, reads anything new. A project role held by an account
--   that has since LEFT the project's organization (or whose project was transferred)
--   is left in place and REPORTED (`in_project_org = false`) rather than deleted: that
--   is the rule WP 7.1 would enforce and it is not this migration's to impose.
--   `list_my_project_roles` resolves its caller like every self-service RPC (D28, D155).

-- ── 1 · the creator stays an owner ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_new_modeler_is_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.modeler_id IS NOT NULL
     AND NEW.modeler_id IS DISTINCT FROM OLD.modeler_id
     AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = NEW.modeler_id) THEN
    INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
    VALUES (NEW.id, NEW.modeler_id, 'owner',
            'the project''s new modeler, by projects_new_modeler_is_owner (D211)')
    ON CONFLICT (project_id, user_id) DO UPDATE
      SET project_role = 'owner', expires_at = NULL, updated_at = now(),
          rationale = EXCLUDED.rationale
      WHERE public.project_members.project_role <> 'owner'
         OR public.project_members.expires_at IS NOT NULL;
  END IF;
  RETURN NEW;
END; $fn$;
COMMENT ON FUNCTION public.project_new_modeler_is_owner() IS
  'D211 — when a project changes modeler (admin_transfer_project), the new modeler becomes '
  'an owner in project_members, as D61''s trigger does for the creator at INSERT. The '
  'previous modeler''s row is left for a super admin to decide.';

DROP TRIGGER IF EXISTS projects_new_modeler_is_owner ON public.projects;
CREATE TRIGGER projects_new_modeler_is_owner
  AFTER UPDATE OF modeler_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_new_modeler_is_owner();

INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
SELECT p.id, p.modeler_id, 'owner',
       'backfilled by D211 — the project''s modeler held no project row'
  FROM public.projects p
 WHERE p.modeler_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = p.modeler_id)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── 2 · the super admin's verbs ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_org_member_role(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_org_id uuid, p_org_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF p_org_role IS NULL OR p_org_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'invalid organization role %', COALESCE(p_org_role, 'NULL');
  END IF;
  SELECT org_role INTO v_before FROM public.organization_members
   WHERE org_id = p_org_id AND user_id = p_target_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: the account does not belong to that organization';
  END IF;
  IF v_before = p_org_role THEN
    RETURN;
  END IF;

  UPDATE public.organization_members SET org_role = p_org_role
   WHERE org_id = p_org_id AND user_id = p_target_user_id;

  PERFORM public.log_admin_action('org.member_role', 'organization_members', p_target_user_id::text,
    jsonb_build_object('org_id', p_org_id, 'org_role', v_before),
    jsonb_build_object('org_id', p_org_id, 'org_role', p_org_role));
END; $$;
COMMENT ON FUNCTION public.admin_set_org_member_role(uuid, text, uuid, uuid, text) IS
  'D211 — a super admin changes an account''s role in one of its organizations, in place '
  '(owner | admin | member). The membership, the seat and the active organization do not move.';
REVOKE ALL ON FUNCTION public.admin_set_org_member_role(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_member_role(uuid, text, uuid, uuid, text) TO anon, authenticated;

-- Whether taking the owner role from `p_user_id` would leave `p_project_id` wrong:
-- raises `creator_is_owner` or `last_owner`, or returns quietly.
CREATE OR REPLACE FUNCTION public._project_owner_guard(p_project_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND modeler_id = p_user_id) THEN
    RAISE EXCEPTION 'creator_is_owner: the account created this project and is always its owner — transfer the project to change its creator'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_members
                  WHERE project_id = p_project_id AND user_id <> p_user_id
                    AND project_role = 'owner') THEN
    RAISE EXCEPTION 'last_owner: the project would have no owner left'
      USING ERRCODE = 'check_violation';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._project_owner_guard(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_project_member(
  p_actor_id uuid, p_actor_email text, p_project_id uuid, p_target_user_id uuid,
  p_project_role text, p_rationale text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org    uuid;
  v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF public.project_role_rank(p_project_role) = 0 THEN
    RAISE EXCEPTION 'invalid project role %', COALESCE(p_project_role, 'NULL');
  END IF;
  SELECT organization_id INTO v_org FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  -- The tenant wall (D210): a project role is standing INSIDE an organization.
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organization_members
                                   WHERE org_id = v_org AND user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'not_in_organization: the account is not a member of this project''s organization — add it to the organization first'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT to_jsonb(pm) INTO v_before FROM public.project_members pm
   WHERE pm.project_id = p_project_id AND pm.user_id = p_target_user_id
   FOR UPDATE;
  IF v_before IS NOT NULL AND v_before ->> 'project_role' = 'owner' AND p_project_role <> 'owner' THEN
    PERFORM public._project_owner_guard(p_project_id, p_target_user_id);
  END IF;

  INSERT INTO public.project_members (project_id, user_id, project_role, granted_by, rationale)
  VALUES (p_project_id, p_target_user_id, p_project_role, p_actor_id,
          COALESCE(NULLIF(btrim(p_rationale), ''), 'set by a super admin on /admin/projects'))
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET project_role = EXCLUDED.project_role, granted_by = EXCLUDED.granted_by,
        rationale = EXCLUDED.rationale, expires_at = NULL, updated_at = now();

  PERFORM public.log_admin_action('project.member_set', 'project_members', p_target_user_id::text,
    v_before, jsonb_build_object('project_id', p_project_id, 'project_role', p_project_role));
END; $$;
COMMENT ON FUNCTION public.admin_set_project_member(uuid, text, uuid, uuid, text, text) IS
  'D211 — a super admin gives an account a project role (owner | editor | analyst | viewer), '
  'or changes it. The account must belong to the project''s organization. The creator keeps '
  'owner, and a project keeps at least one owner.';
REVOKE ALL ON FUNCTION public.admin_set_project_member(uuid, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_project_member(uuid, text, uuid, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_project_member(
  p_actor_id uuid, p_actor_email text, p_project_id uuid, p_target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  SELECT to_jsonb(pm) INTO v_before FROM public.project_members pm
   WHERE pm.project_id = p_project_id AND pm.user_id = p_target_user_id
   FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'not_a_member: the account holds no role on that project';
  END IF;
  IF v_before ->> 'project_role' = 'owner' THEN
    PERFORM public._project_owner_guard(p_project_id, p_target_user_id);
  END IF;

  DELETE FROM public.project_members WHERE project_id = p_project_id AND user_id = p_target_user_id;

  PERFORM public.log_admin_action('project.member_remove', 'project_members', p_target_user_id::text,
    v_before, jsonb_build_object('project_id', p_project_id));
END; $$;
COMMENT ON FUNCTION public.admin_remove_project_member(uuid, text, uuid, uuid) IS
  'D211 — a super admin takes an account''s project role away. The creator keeps owner, '
  'and a project keeps at least one owner. A live delegation is not touched.';
REVOKE ALL ON FUNCTION public.admin_remove_project_member(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_project_member(uuid, text, uuid, uuid) TO anon, authenticated;

-- ── 3 · the reads ───────────────────────────────────────────────────────────────

-- The highest LIVE delegation an account holds on a project, and when it ends.
CREATE OR REPLACE FUNCTION public._live_delegation(p_user_id uuid, p_project_id uuid)
RETURNS TABLE(project_role text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dg.project_role, dg.expires_at
    FROM public.delegation_grants dg
   WHERE dg.grantee_user_id = p_user_id AND dg.project_id = p_project_id
     AND dg.revoked_at IS NULL AND dg.expires_at > now()
   ORDER BY public.project_role_rank(dg.project_role) DESC, dg.expires_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._live_delegation(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_project_access(
  p_actor_id uuid, p_actor_email text, p_project_id uuid)
RETURNS TABLE(
  user_id uuid,
  name text,
  email text,
  account_role text,
  is_active boolean,
  org_role text,
  in_project_org boolean,
  is_creator boolean,
  member_role text,
  member_expires_at timestamptz,
  delegated_role text,
  delegation_expires_at timestamptz,
  effective_role text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org     uuid;
  v_creator uuid;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT p.organization_id, p.modeler_id INTO v_org, v_creator FROM public.projects p WHERE p.id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;

  RETURN QUERY
  WITH who AS (
    SELECT m.user_id AS uid FROM public.organization_members m WHERE m.org_id = v_org
    UNION
    SELECT pm.user_id FROM public.project_members pm WHERE pm.project_id = p_project_id
    UNION
    SELECT dg.grantee_user_id FROM public.delegation_grants dg
     WHERE dg.project_id = p_project_id AND dg.revoked_at IS NULL AND dg.expires_at > now()
  )
  SELECT au.id, au.name, au.email, au.role::text, au.is_active,
         om.org_role,
         om.org_role IS NOT NULL,
         au.id IS NOT DISTINCT FROM v_creator,
         pm.project_role, pm.expires_at,
         ld.project_role, ld.expires_at,
         public.effective_project_role(au.id, p_project_id)
    FROM who
    JOIN public.approved_users au ON au.id = who.uid
    LEFT JOIN public.organization_members om ON om.org_id = v_org AND om.user_id = au.id
    LEFT JOIN public.project_members pm ON pm.project_id = p_project_id AND pm.user_id = au.id
    LEFT JOIN LATERAL public._live_delegation(au.id, p_project_id) ld ON true
   ORDER BY public.project_role_rank(public.effective_project_role(au.id, p_project_id)) DESC,
            lower(COALESCE(au.name, au.email)), au.id;
END; $$;
COMMENT ON FUNCTION public.admin_project_access(uuid, text, uuid) IS
  'D211 — everyone with standing on one project (its organization''s members, and anyone '
  'holding a project row or a live delegation on it) with all three levels: the account '
  'tier, the role in the project''s organization, the project role, and effective_role.';
REVOKE ALL ON FUNCTION public.admin_project_access(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_project_access(uuid, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_user_project_roles(
  p_actor_id uuid, p_actor_email text, p_user_id uuid)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  organization_id uuid,
  organization text,
  in_project_org boolean,
  is_creator boolean,
  member_role text,
  member_expires_at timestamptz,
  delegated_role text,
  delegation_expires_at timestamptz,
  effective_role text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT p.id, p.name, p.organization_id, o.name,
         EXISTS (SELECT 1 FROM public.organization_members m
                  WHERE m.org_id = p.organization_id AND m.user_id = p_user_id),
         p.modeler_id IS NOT DISTINCT FROM p_user_id,
         pm.project_role, pm.expires_at,
         ld.project_role, ld.expires_at,
         public.effective_project_role(p_user_id, p.id)
    FROM public.projects p
    LEFT JOIN public.organizations o ON o.id = p.organization_id
    LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = p_user_id
    LEFT JOIN LATERAL public._live_delegation(p_user_id, p.id) ld ON true
   WHERE pm.user_id IS NOT NULL OR ld.project_role IS NOT NULL OR p.modeler_id = p_user_id
   ORDER BY lower(COALESCE(o.name, '')), lower(p.name), p.id;
END; $$;
COMMENT ON FUNCTION public.admin_user_project_roles(uuid, text, uuid) IS
  'D211 — every project one account holds a role on (a project row, a live delegation, or '
  'as its creator), in any organization, and whether it still belongs to that organization.';
REVOKE ALL ON FUNCTION public.admin_user_project_roles(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_project_roles(uuid, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_my_project_roles(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  is_creator boolean,
  member_role text,
  member_expires_at timestamptz,
  delegated_role text,
  delegation_expires_at timestamptz,
  effective_role text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
  v_org uuid;
BEGIN
  SELECT au.organization_id INTO v_org FROM public.approved_users au WHERE au.id = v_uid;
  RETURN QUERY
  SELECT p.id, p.name,
         p.modeler_id IS NOT DISTINCT FROM v_uid,
         pm.project_role, pm.expires_at,
         ld.project_role, ld.expires_at,
         public.effective_project_role(v_uid, p.id)
    FROM public.projects p
    LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = v_uid
    LEFT JOIN LATERAL public._live_delegation(v_uid, p.id) ld ON true
   WHERE v_org IS NOT NULL AND p.organization_id = v_org
   ORDER BY lower(p.name), p.id;
END; $$;
COMMENT ON FUNCTION public.list_my_project_roles(uuid) IS
  'D211 — the signed-in account''s project role on each project of its ACTIVE organization '
  '(the projects it can see), and whether it created each. The user is a parameter because '
  'the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.list_my_project_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_project_roles(uuid) TO anon, authenticated;
