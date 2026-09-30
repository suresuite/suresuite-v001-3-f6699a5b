-- Access levels / §4 D215 — three levels, each role said once: PLATFORM, ORGANIZATION,
-- PROJECT — and the two reads that were missing to show them. Nothing here changes what
-- any policy admits, and nothing here writes.
--
-- The owner asked for the roles to be reconciled "so that I could do it appropriately".
-- Four role vocabularies live in three columns:
--
--   PLATFORM      approved_users.role = 'super_admin'          — operates every tenant
--   ORGANIZATION  approved_users.role ∈ admin | modeler | user — the ACCOUNT TIER. It is
--                   what every org-scoped write policy reads, and it applies in EVERY
--                   organization the account belongs to (D210)
--                 organization_members.org_role ∈ owner | admin | member — per membership;
--                   read by the API-key verbs and nothing else
--   PROJECT       project_members.project_role / delegation_grants ∈ owner | editor |
--                   analyst | viewer — read by the promotion (editor+) and the export
--                   decision, and by NO row-level policy (D66)
--
-- The decision D66 has waited on since WP 6.2 is taken (the owner, 2026-09-30): **an
-- organization admin is an OWNER of every project in its organization.** It is the target
-- vocabulary, recorded in PLAN.md; making it the RULE is WP 7.1's, because it changes what
-- ~60 policies admit and the owner chose "clarity now, rules later".
--
-- ── WHAT ALREADY EXISTS, AND IS NOT RESTATED ────────────────────────────────────
--   The WRITES are D211's (`admin_set_user_org_role`, `admin_set_project_member`,
--   `admin_remove_project_member`, `20260930000005`) and D212's (`admin_transfer_project`
--   moves the owner's membership, `20260930000006`). D211's read answers one account
--   across projects (`admin_get_user_memberships`, /admin/users/:userId).
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────────
--   admin_project_access(…)  — the other direction: everyone with standing on ONE
--                              project — the members of its organization, and anyone
--                              holding a project row or a live delegation on it — each
--                              with ALL THREE levels and `effective_role` as
--                              `effective_project_role()` says. /admin/projects › Access
--   list_my_project_roles(…) — the account's own, for each project of its ACTIVE
--                              organization (the projects it can see). /profile › My Access
--   Each returns FACTS only; what a combination of them lets someone do is written once,
--   in `src/lib/auth/accessLevels.ts`, beside the policies it restates and tested against
--   them.
--
-- ── WHAT IS NOT ─────────────────────────────────────────────────────────────────
--   No policy, and no resolver, reads anything new. A project role held by an account
--   outside the project's organization is REPORTED (`in_project_org = false`), not
--   removed. `list_my_project_roles` resolves its caller like every self-service RPC
--   (D28, D155).

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
  is_modeler boolean,
  member_role text,
  member_expires_at timestamptz,
  delegated_role text,
  delegation_expires_at timestamptz,
  effective_role text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org     uuid;
  v_modeler uuid;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT p.organization_id, p.modeler_id INTO v_org, v_modeler FROM public.projects p WHERE p.id = p_project_id;
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
         au.id IS NOT DISTINCT FROM v_modeler,
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
  'D215 — everyone with standing on one project (its organization''s members, and anyone '
  'holding a project row or a live delegation on it) with all three levels: the account '
  'tier, the role in the project''s organization, the project role, and effective_role.';
REVOKE ALL ON FUNCTION public.admin_project_access(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_project_access(uuid, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_my_project_roles(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  is_modeler boolean,
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
  'D215 — the signed-in account''s project role on each project of its ACTIVE organization '
  '(the projects it can see), and whether it owns each (modeler). The user is a parameter '
  'because the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.list_my_project_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_project_roles(uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
