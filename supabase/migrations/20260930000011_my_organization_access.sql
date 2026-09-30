-- Profile / §4 D217 — /profile shows an account WHO ELSE is in its organization and on its
-- projects, and what each of them may do there.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
--
-- D215 made "who is on this project, as what" readable — to an active super admin, on
-- /admin/projects. An ordinary account had no answer at all: /profile's "My Access" tab
-- lists the account's OWN pages, features and AI models, and nothing about the people it
-- shares an organization or a project with. The owner: "I want to be more transparent —
-- a tab 'my organization' with two subsections: my organization, to see who has access
-- and which access, and the project, to show all who have access and what access —
-- show the name and also the default organization".
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
--
--   · `project_access_read(project)` — D215's body, lifted out of
--     `admin_get_project_access` UNCHANGED except for two keys per person,
--     `default_org_id` / `default_org_name` (the membership D216 marks `is_default`).
--     Internal: no role may call it. `admin_get_project_access` becomes the super-admin
--     assertion plus this read, so the admin dialog and /profile read ONE authored
--     answer and cannot disagree about one person on one project (the D205 lesson).
--   · `get_my_organization_access(user)` — the account's ACTIVE organization (D210: the
--     one whose projects it sees), its members with their organization role, account
--     role and DEFAULT organization, and the organization's projects with the reader's
--     own effective role and the number of people holding a role on each.
--   · `get_my_project_access(user, project)` — `project_access_read` for one project the
--     reader may see: one of its active organization's, one it holds an effective role
--     on, or any for a super admin. Anything else is `forbidden`, so the read cannot be
--     used to enumerate another tenant's people.
--
-- Both self-service reads name the user because the browser calls as anon (D155), resolve
-- it through `account_self_resolve` (refusing a name that contradicts the session), and
-- refuse an inactive account, as `update_own_profile` does.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- No writer: the tab reads. Super admins are owner on every project and are listed only
-- when recorded on it (D215's rule, unchanged). The organization section is the ACTIVE
-- organization only; the account's other organizations are a switch away (D210) and each
-- reads the same way once it is the active one. Other members' default organizations are
-- shown BY NAME — the owner asked for it; that names an organization the reader may not
-- belong to, which is the stated cost of the transparency asked for.

-- ── 1 · the one read, lifted out of the admin RPC ───────────────────────────
CREATE OR REPLACE FUNCTION public.project_access_read(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_people  jsonb;
  v_keys    jsonb;
  v_matrix  jsonb;
BEGIN
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF v_project.id IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;

  -- The same two reads as `admin_get_user_memberships`, so the legend is one legend.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label)
                            ORDER BY c.sort_order, c.key), '[]'::jsonb)
    INTO v_keys
    FROM public.capabilities c
   WHERE c.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.project_role, r.caps), '{}'::jsonb) INTO v_matrix
    FROM (SELECT prc.project_role, jsonb_object_agg(prc.capability_key, prc.allowed) AS caps
            FROM public.project_role_capabilities prc
           GROUP BY prc.project_role) r;

  -- Every account recorded on the project or able to see it through its organization.
  WITH reach AS (
    SELECT v_project.modeler_id AS user_id WHERE v_project.modeler_id IS NOT NULL
    UNION
    SELECT pm.user_id FROM public.project_members pm WHERE pm.project_id = v_project.id
    UNION
    SELECT dg.grantee_user_id FROM public.delegation_grants dg
     WHERE dg.project_id = v_project.id AND dg.revoked_at IS NULL AND dg.expires_at > now()
    UNION
    SELECT om.user_id FROM public.organization_members om
     WHERE v_project.organization_id IS NOT NULL AND om.org_id = v_project.organization_id
  ), people AS (
    SELECT u.*,
           (u.role = 'super_admin'::public.app_role)                        AS is_super,
           public.effective_project_role(u.id, v_project.id)                AS eff,
           (v_project.organization_id IS NOT NULL
            AND u.organization_id = v_project.organization_id)              AS active_here
      FROM reach
      JOIN public.approved_users u ON u.id = reach.user_id
  )
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.is_modeler DESC, x.rank DESC, x.sort_key, x.user_id), '[]'::jsonb)
    INTO v_people
  FROM (
    SELECT u.id AS user_id,
           (u.id = v_project.modeler_id) AS is_modeler,
           COALESCE(public.project_role_rank(u.eff), 0) AS rank,
           lower(COALESCE(u.name, u.email, '')) AS sort_key,
           jsonb_build_object(
      'user_id',             u.id,
      'name',                u.name,
      'email',               u.email,
      'account_active',      COALESCE(u.is_active, true),
      'role',                u.role::text,
      'is_super_admin',      u.is_super,
      'is_modeler',          u.id = v_project.modeler_id,
      -- The account's role in THIS project's organization, NULL when it is not a member.
      'org_role',            om.org_role,
      'in_project_org',      om.user_id IS NOT NULL,
      -- "Projects: org-wide view" reads the ACTIVE organization and nothing else (D210).
      'active_in_project_org', u.active_here,
      -- D217 — the account's DEFAULT organization (D216), wherever it is; NULL when none.
      'default_org_id',      dm.org_id,
      'default_org_name',    dmo.name,
      'visible',             u.is_super OR u.active_here,
      -- "Projects: org update by owner or admin" — active organization AND (modeler OR app admin).
      'can_edit_project',    u.is_super OR (u.active_here
                                            AND (u.id = v_project.modeler_id OR u.role = 'admin'::public.app_role)),
      'member', CASE WHEN pm.project_id IS NULL THEN NULL ELSE jsonb_build_object(
                  'project_role', pm.project_role,
                  'expires_at',   pm.expires_at,
                  'expired',      pm.expires_at IS NOT NULL AND pm.expires_at <= now(),
                  'rationale',    pm.rationale,
                  'granted_by',   COALESCE(gb.name, gb.email),
                  'updated_at',   pm.updated_at) END,
      'delegations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', dg.id, 'project_role', dg.project_role, 'expires_at', dg.expires_at,
                   'rationale', dg.rationale, 'grantor', COALESCE(g.name, g.email))
                   ORDER BY dg.expires_at)
            FROM public.delegation_grants dg
            LEFT JOIN public.approved_users g ON g.id = dg.grantor_user_id
           WHERE dg.grantee_user_id = u.id AND dg.project_id = v_project.id
             AND dg.revoked_at IS NULL AND dg.expires_at > now()), '[]'::jsonb),
      'effective_role',      u.eff,
      -- The resolver's own answer, all four layers, so no page recomputes it.
      'capabilities', (SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
                         FROM jsonb_each(public.capabilities_for_user(u.id, v_project.id) -> 'features') f
                        WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities))
    ) AS j
      FROM people u
      LEFT JOIN public.organization_members om
             ON om.user_id = u.id AND om.org_id = v_project.organization_id
      LEFT JOIN public.organization_members dm ON dm.user_id = u.id AND dm.is_default
      LEFT JOIN public.organizations dmo ON dmo.id = dm.org_id
      LEFT JOIN public.project_members pm ON pm.project_id = v_project.id AND pm.user_id = u.id
      LEFT JOIN public.approved_users gb ON gb.id = pm.granted_by
  ) x;

  RETURN jsonb_build_object(
    'project_id',          v_project.id,
    'name',                v_project.name,
    'organization_id',     v_project.organization_id,
    'organization_name',   (SELECT o.name FROM public.organizations o WHERE o.id = v_project.organization_id),
    'modeler_id',          v_project.modeler_id,
    'people',              v_people,
    'project_capabilities', v_keys,
    'role_matrix',         v_matrix);
END; $$;
COMMENT ON FUNCTION public.project_access_read(uuid) IS
  'D215, D217 — who is on a project and what each may do there: every account that owns it, '
  'holds a membership or live delegation on it, or belongs to its organization, with where the '
  'access comes from, the effective project role, the resolver''s project capabilities and the '
  'account''s default organization. Internal and unauthorized: admin_get_project_access and '
  'get_my_project_access decide who may read it; no role may call it directly.';
REVOKE ALL ON FUNCTION public.project_access_read(uuid) FROM PUBLIC, anon, authenticated;

-- `20260930000008`'s signature, now the assertion plus the shared read.
CREATE OR REPLACE FUNCTION public.admin_get_project_access(
  p_actor_id uuid, p_actor_email text, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN public.project_access_read(p_project_id);
END; $$;
COMMENT ON FUNCTION public.admin_get_project_access(uuid, text, uuid) IS
  'D215 — /admin/projects'' members read. Active super admin only. The body is '
  'project_access_read (D217), the same read /profile''s My organization tab reaches through '
  'get_my_project_access, so the two pages cannot disagree about one person on one project.';

-- ── 2 · the reader's organization ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_organization_access(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := public.account_self_resolve(p_user_id);
  v_me      public.approved_users%ROWTYPE;
  v_org     public.organizations%ROWTYPE;
  v_members jsonb;
  v_projects jsonb;
BEGIN
  SELECT * INTO v_me FROM public.approved_users WHERE id = v_uid;
  IF NOT COALESCE(v_me.is_active, true) THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_me.organization_id;
  IF v_org.id IS NULL THEN
    RETURN jsonb_build_object('organization', NULL, 'members', '[]'::jsonb, 'projects', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id',        u.id,
           'name',           u.name,
           'email',          u.email,
           'role',           u.role::text,
           'is_super_admin', u.role = 'super_admin'::public.app_role,
           'account_active', COALESCE(u.is_active, true),
           'org_role',       m.org_role,
           'joined_at',      m.joined_at,
           'is_you',         u.id = v_uid,
           -- Working in this organization now (D210's active organization).
           'working_here',   u.organization_id = v_org.id,
           'default_org_id',   dm.org_id,
           'default_org_name', dmo.name)
         ORDER BY CASE m.org_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                  lower(COALESCE(u.name, u.email, '')), u.id), '[]'::jsonb)
    INTO v_members
    FROM public.organization_members m
    JOIN public.approved_users u ON u.id = m.user_id
    LEFT JOIN public.organization_members dm ON dm.user_id = u.id AND dm.is_default
    LEFT JOIN public.organizations dmo ON dmo.id = dm.org_id
   WHERE m.org_id = v_org.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'project_id',  p.id,
           'name',        p.name,
           'owner_id',    p.modeler_id,
           'owner_name',  COALESCE(ow.name, ow.email),
           'my_role',     public.effective_project_role(v_uid, p.id),
           -- The owner, unexpired members and live delegates, each counted once.
           'role_holders', (SELECT count(*) FROM (
               SELECT p.modeler_id AS u WHERE p.modeler_id IS NOT NULL
               UNION
               SELECT pm.user_id FROM public.project_members pm
                WHERE pm.project_id = p.id AND (pm.expires_at IS NULL OR pm.expires_at > now())
               UNION
               SELECT dg.grantee_user_id FROM public.delegation_grants dg
                WHERE dg.project_id = p.id AND dg.revoked_at IS NULL AND dg.expires_at > now()) r))
         ORDER BY lower(COALESCE(p.name, '')), p.id), '[]'::jsonb)
    INTO v_projects
    FROM public.projects p
    LEFT JOIN public.approved_users ow ON ow.id = p.modeler_id
   WHERE p.organization_id = v_org.id;

  RETURN jsonb_build_object(
    'organization', jsonb_build_object(
      'id',         v_org.id,
      'name',       v_org.name,
      'my_org_role', (SELECT m.org_role FROM public.organization_members m
                       WHERE m.org_id = v_org.id AND m.user_id = v_uid),
      'is_my_default', EXISTS (SELECT 1 FROM public.organization_members m
                                WHERE m.org_id = v_org.id AND m.user_id = v_uid AND m.is_default)),
    'members',  v_members,
    'projects', v_projects);
END; $$;
COMMENT ON FUNCTION public.get_my_organization_access(uuid) IS
  'D217 — /profile''s My organization tab. The signed-in account''s ACTIVE organization, its '
  'members (organization role, account role, whether they work in it now, their default '
  'organization) and its projects (owner, the reader''s effective role, role holders). The '
  'user is a parameter because the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.get_my_organization_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_organization_access(uuid) TO anon, authenticated;

-- ── 3 · one project the reader may see ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_project_access(
  p_project_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := public.account_self_resolve(p_user_id);
  v_me      public.approved_users%ROWTYPE;
  v_org_id  uuid;
BEGIN
  SELECT * INTO v_me FROM public.approved_users WHERE id = v_uid;
  IF NOT COALESCE(v_me.is_active, true) THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.organization_id INTO v_org_id FROM public.projects p WHERE p.id = p_project_id;
  -- An unknown project and one the reader may not see answer alike, so the read does not
  -- say which project ids exist in another tenant.
  IF NOT FOUND OR NOT (
       v_me.role = 'super_admin'::public.app_role
       OR (v_org_id IS NOT NULL AND v_org_id = v_me.organization_id)
       OR public.effective_project_role(v_uid, p_project_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.project_access_read(p_project_id);
END; $$;
COMMENT ON FUNCTION public.get_my_project_access(uuid, uuid) IS
  'D217 — /profile''s My organization tab, one project: project_access_read for a project the '
  'signed-in account may see (its active organization''s, one it holds an effective role on, '
  'or any for a super admin); anything else, unknown included, is forbidden. The user is a '
  'parameter because the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.get_my_project_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_project_access(uuid, uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
