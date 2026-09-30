-- Profile / §4 D219 — a person's rights on a project are ONE answer, and it is the answer the
-- app acts on.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- /profile's "My organization" tab, /admin/projects and /admin/users/:userId list, per
-- person per project, six rights: sees the project, edits its settings, Run Simulations,
-- Edit Input Data, Edit Policies, Export. The last four were the TWO-argument resolver's
-- answer, `capabilities_for_user(user, project)` — the project role layer. Nothing the app
-- does read that answer except `record_export`, behind one button:
--
--   · the browser's gates read `get_my_capabilities(user)`, the ONE-argument resolver,
--     which has no project layer — so /simulation-lab's run button followed the account
--     role and a Viewer member whose account is a modeler could run;
--   · `data_edit_inputs` and `data_edit_policies` were read by nothing at all;
--   · uploads land through `ingest_land_file`, whose gate is `has_project_access` — the
--     project's owner or an app `admin` — so an Editor member who is neither was shown
--     "Edit Input Data" and could not upload;
--   · a suspended account, which cannot sign in, was shown every right its role carries.
--
-- Reported by the owner on /profile ("please carefully check and ensure that the rights
-- are correctly reflected and align with the real right of the user"): Viewer members of
-- Project TRON shown with every right refused while the app refused them almost nothing.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
--
--   · `project_rights_for_user(user, project)` — internal, the one statement of a person's
--     rights on a project:
--        visible            active AND (super admin OR the project's organization is the
--                           one the account works in — "Projects: org-wide view", D210)
--        can_edit_project   active AND (super admin OR (visible AND (owner OR app admin)))
--                           — "Projects: org update by owner or admin"
--        capabilities       active AND the resolver's project answer, and for
--                           `data_edit_inputs` ALSO the upload gate (`may_land_uploads`:
--                           owner OR app admin, `has_project_access`'s predicate), because
--                           an input edit the server refuses is not a right
--        resolved_capabilities  the resolver's answer before those gates, so a page can say
--                           WHY a role's right does not hold
--   · `project_access_read` and `admin_get_user_memberships` read their rights from it, so
--     /profile and both admin pages say one thing about one person on one project.
--   · `get_my_project_rights(project, user)` — the same answer for the signed-in account,
--     for the browser's gates (`useProjectRights`): /simulation-lab, the /policies run and
--     edit paths, /project-manager's upload / item-master / settings actions and every
--     export button read it instead of the account-wide set. Authorized as
--     `get_my_project_access` is.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- The SERVER gates are unchanged, by the owner's choice: `sim-command`, the policy RPCs and
-- the item-master RPCs still check no project role, so a client that ignores the browser's
-- gates is not stopped (D28's asserted actor, D66's two predicates). The upload gate is
-- still owner-or-admin: an Editor member who is neither holds Edit Input Data in the role
-- matrix and not in fact, and every page now says so rather than hiding it. An
-- organization whose access period has ended is not folded in (its members are switched
-- away at sign-in, D210).

-- ── 1 · the one answer ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_rights_for_user(p_user_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_active   boolean;
  v_super    boolean;
  v_here     boolean;
  v_land     boolean;
  v_resolved jsonb;
  v_caps     jsonb;
BEGIN
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_user_id;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF v_user.id IS NULL OR v_project.id IS NULL THEN RETURN NULL; END IF;

  -- A suspended account cannot sign in (D205), so it holds nothing, whatever its role says.
  v_active := COALESCE(v_user.is_active, true);
  v_super  := (v_user.role = 'super_admin'::public.app_role);
  v_here   := v_project.organization_id IS NOT NULL AND v_user.organization_id = v_project.organization_id;
  -- `has_project_access` — the gate `ingest_land_file` applies to every upload.
  v_land   := v_project.modeler_id = v_user.id OR v_user.role = 'admin'::public.app_role;

  -- The resolver's project answer, for the keys its project layer has an opinion on.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_resolved
    FROM jsonb_each(public.capabilities_for_user(v_user.id, v_project.id) -> 'features') f
   WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.key,
           to_jsonb(v_active AND COALESCE((r.value #>> '{}')::boolean, false)
                    AND (r.key <> 'data_edit_inputs' OR v_land))), '{}'::jsonb)
    INTO v_caps
    FROM jsonb_each(v_resolved) r;

  RETURN jsonb_build_object(
    'account_active',        v_active,
    'visible',               v_active AND (v_super OR v_here),
    'can_edit_project',      v_active AND (v_super OR (v_here AND (v_project.modeler_id = v_user.id
                                                                   OR v_user.role = 'admin'::public.app_role))),
    'may_land_uploads',      v_active AND v_land,
    'capabilities',          v_caps,
    'resolved_capabilities', v_resolved);
END; $$;
COMMENT ON FUNCTION public.project_rights_for_user(uuid, uuid) IS
  'D219 — one person''s rights on one project, as the app applies them: visible, '
  'can_edit_project, may_land_uploads, capabilities (the resolver''s project answer, refused '
  'to a suspended account, and data_edit_inputs also requiring the upload gate) and '
  'resolved_capabilities (the resolver before those gates). Internal: project_access_read, '
  'admin_get_user_memberships and get_my_project_rights read it; no role may call it.';
REVOKE ALL ON FUNCTION public.project_rights_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2 · the signed-in account's own rights, for the browser's gates ─────────
CREATE OR REPLACE FUNCTION public.get_my_project_rights(
  p_project_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := public.account_self_resolve(p_user_id);
  v_me     public.approved_users%ROWTYPE;
  v_org_id uuid;
BEGIN
  SELECT * INTO v_me FROM public.approved_users WHERE id = v_uid;
  IF NOT COALESCE(v_me.is_active, true) THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.organization_id INTO v_org_id FROM public.projects p WHERE p.id = p_project_id;
  -- `get_my_project_access`'s rule: an unknown project and one the reader may not see
  -- answer alike.
  IF NOT FOUND OR NOT (
       v_me.role = 'super_admin'::public.app_role
       OR (v_org_id IS NOT NULL AND v_org_id = v_me.organization_id)
       OR public.effective_project_role(v_uid, p_project_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.project_rights_for_user(v_uid, p_project_id)
      || jsonb_build_object(
           'project_id',     p_project_id,
           'effective_role', public.effective_project_role(v_uid, p_project_id),
           'is_modeler',     EXISTS (SELECT 1 FROM public.projects p
                                      WHERE p.id = p_project_id AND p.modeler_id = v_uid));
END; $$;
COMMENT ON FUNCTION public.get_my_project_rights(uuid, uuid) IS
  'D219 — the signed-in account''s rights on one project (project_rights_for_user), for the '
  'browser''s gates on /simulation-lab, /policies, /project-manager and the export buttons. '
  'Authorized as get_my_project_access: its active organization''s project, one it holds an '
  'effective role on, or any for a super admin. The user is a parameter because the browser '
  'calls as anon (D155).';
REVOKE ALL ON FUNCTION public.get_my_project_rights(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_project_rights(uuid, uuid) TO anon, authenticated;

-- ── 3 · /profile and /admin/projects: `20260930000011`'s read, rights from § 1 ──
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
           public.project_rights_for_user(u.id, v_project.id)               AS rights,
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
      -- D219 — the rights are `project_rights_for_user`'s, the answer the app's gates read.
      'visible',             (u.rights ->> 'visible')::boolean,
      'can_edit_project',    (u.rights ->> 'can_edit_project')::boolean,
      'may_land_uploads',    (u.rights ->> 'may_land_uploads')::boolean,
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
      -- What the person may do (D219), and what the resolver's four layers alone would say.
      'capabilities',          u.rights -> 'capabilities',
      'resolved_capabilities', u.rights -> 'resolved_capabilities'
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
  'D215, D217, D219 — who is on a project and what each may do there: every account that owns it, '
  'holds a membership or live delegation on it, or belongs to its organization, with where the '
  'access comes from, the effective project role, the rights project_rights_for_user gives (D219) and the '
  'account''s default organization. Internal and unauthorized: admin_get_project_access and '
  'get_my_project_access decide who may read it; no role may call it directly.';
REVOKE ALL ON FUNCTION public.project_access_read(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4 · /admin/users/:userId: `20260930000009`'s read, rights from § 1 ──────
CREATE OR REPLACE FUNCTION public.admin_get_user_memberships(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_is_super boolean;
  v_default  uuid;
  v_orgs     jsonb;
  v_projects jsonb;
  v_keys     jsonb;
  v_matrix   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_target_user_id;
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  v_is_super := (v_user.role = 'super_admin'::public.app_role);
  SELECT m.org_id INTO v_default FROM public.organization_members m
   WHERE m.user_id = v_user.id AND m.is_default;

  -- Every organization the account belongs to (D210), the active one first.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status,
           'access_valid_until', o.access_valid_until,
           'org_role', m.org_role,
           'is_active', o.id = v_user.organization_id,
           'is_default', m.is_default,
           'members', (SELECT count(*) FROM public.organization_members mm WHERE mm.org_id = o.id),
           'projects', (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id))
           ORDER BY (o.id = v_user.organization_id) DESC, lower(o.name), o.id), '[]'::jsonb)
    INTO v_orgs
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.org_id
   WHERE m.user_id = v_user.id;

  -- The project-scoped capabilities: the keys the project layer of the resolver has an
  -- opinion on. Read from `project_role_capabilities`, so a key added there appears here.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label)
                            ORDER BY c.sort_order, c.key), '[]'::jsonb)
    INTO v_keys
    FROM public.capabilities c
   WHERE c.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.project_role, r.caps), '{}'::jsonb) INTO v_matrix
    FROM (SELECT prc.project_role, jsonb_object_agg(prc.capability_key, prc.allowed) AS caps
            FROM public.project_role_capabilities prc
           GROUP BY prc.project_role) r;

  -- Every project the account can reach or is recorded on: the projects of any of its
  -- organizations, projects it owns, and projects it holds a membership or a live
  -- delegation on — expired memberships included, so an admin can see and clear them.
  WITH my_orgs AS (
    SELECT m.org_id FROM public.organization_members m WHERE m.user_id = v_user.id
  ), reach AS (
    SELECT p.id FROM public.projects p
     WHERE p.organization_id IN (SELECT org_id FROM my_orgs)
        OR p.modeler_id = v_user.id
    UNION
    SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = v_user.id
    UNION
    SELECT dg.project_id FROM public.delegation_grants dg
     WHERE dg.grantee_user_id = v_user.id AND dg.revoked_at IS NULL AND dg.expires_at > now()
  )
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.sort_key), '[]'::jsonb) INTO v_projects
  FROM (
    SELECT lower(p.name) AS sort_key, jsonb_build_object(
      'project_id',        p.id,
      'name',              p.name,
      'plant_name',        p.plant_name,
      'organization_id',   p.organization_id,
      'organization_name', po.name,
      -- "Projects: org-wide view" reads the ACTIVE organization and nothing else (D210).
      'in_active_org',     p.organization_id IS NOT NULL AND p.organization_id = v_user.organization_id,
      'in_member_org',     p.organization_id IN (SELECT org_id FROM my_orgs),
      'is_modeler',        p.modeler_id = v_user.id,
      'owner_name',        COALESCE(ow.name, ow.email),
      -- D219 — the rights are `project_rights_for_user`'s, the answer the app's gates read.
      'visible',           (r.rights ->> 'visible')::boolean,
      'can_edit_project',  (r.rights ->> 'can_edit_project')::boolean,
      'may_land_uploads',  (r.rights ->> 'may_land_uploads')::boolean,
      'member', CASE WHEN pm.project_id IS NULL THEN NULL ELSE jsonb_build_object(
                  'project_role',   pm.project_role,
                  'expires_at',     pm.expires_at,
                  'expired',        pm.expires_at IS NOT NULL AND pm.expires_at <= now(),
                  'rationale',      pm.rationale,
                  'granted_by',     COALESCE(gb.name, gb.email),
                  'updated_at',     pm.updated_at) END,
      'delegations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'id', dg.id, 'project_role', dg.project_role, 'expires_at', dg.expires_at,
                   'rationale', dg.rationale, 'grantor', COALESCE(g.name, g.email))
                   ORDER BY dg.expires_at)
            FROM public.delegation_grants dg
            LEFT JOIN public.approved_users g ON g.id = dg.grantor_user_id
           WHERE dg.grantee_user_id = v_user.id AND dg.project_id = p.id
             AND dg.revoked_at IS NULL AND dg.expires_at > now()), '[]'::jsonb),
      'effective_role',    public.effective_project_role(v_user.id, p.id),
      -- What the account may do (D219), and what the resolver's four layers alone would say.
      'capabilities',          r.rights -> 'capabilities',
      'resolved_capabilities', r.rights -> 'resolved_capabilities'
    ) AS j
      FROM reach
      JOIN public.projects p ON p.id = reach.id
      LEFT JOIN public.organizations po ON po.id = p.organization_id
      LEFT JOIN public.approved_users ow ON ow.id = p.modeler_id
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = v_user.id
      LEFT JOIN public.approved_users gb ON gb.id = pm.granted_by
      CROSS JOIN LATERAL (SELECT public.project_rights_for_user(v_user.id, p.id) AS rights) r
  ) x;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'role', v_user.role::text,
    'is_super_admin', v_is_super,
    'active_organization_id', v_user.organization_id,
    'default_organization_id', v_default,
    'organizations', v_orgs,
    'projects', v_projects,
    'project_capabilities', v_keys,
    'role_matrix', v_matrix);
END; $$;
COMMENT ON FUNCTION public.admin_get_user_memberships(uuid, text, uuid) IS
  'D211, D216, D219 — /admin/users/:userId''s organization and project read. Active super admin only. '
  'Every organization (which is active, which is the default) and, per project, where access '
  'comes from (active organization, another organization, ownership, membership, delegation), '
  'the effective project role and the rights project_rights_for_user gives (D219).';

SELECT pg_notify('pgrst', 'reload schema');
