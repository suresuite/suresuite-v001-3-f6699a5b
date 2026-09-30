-- Admin projects / §4 D215 — /admin/projects shows WHO is on a project and WHAT each of
-- them may do there.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
--
-- D211 answered the question one PERSON at a time: /admin/users/:userId lists every
-- project an account can reach, with its role and rights on each. The same facts read
-- the other way — "who is on the Munich project, as what, and who can promote an upload
-- there" — had no answer anywhere. /admin/projects showed the owner and nothing else, so
-- an administrator had to open every account in turn and look for the project in each.
-- The facts are the same ones D211 reads:
--
--   · the project's OWNER (`projects.modeler_id`), what every write policy reads;
--   · its MEMBERS (`project_members`, expired rows included) and live DELEGATIONS
--     (`delegation_grants`), resolved by `effective_project_role`;
--   · the MEMBERS OF ITS ORGANIZATION (`organization_members`) — every one of them sees
--     the project while that organization is their ACTIVE one ("Projects: org-wide
--     view", D210), with or without a project role.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
--
--   · `admin_get_project_access` — the READ, active super admin only. Every account that
--     owns the project, holds a membership or a live delegation on it, or belongs to its
--     organization; per account where the access comes from, the effective project role,
--     `visible` / `can_edit_project` computed exactly as D211 computes them, and the
--     RESOLVER's project capabilities (`capabilities_for_user(user, project)`) — so the
--     two admin pages cannot disagree about one person on one project.
--
-- No new writer. The page grants, changes and removes memberships with D211's
-- `admin_set_project_member` / `admin_remove_project_member`, which already refuse
-- touching the modeler's own row, and ownership moves with D212's
-- `admin_transfer_project`.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- Super admins are owner on every project and are NOT listed unless they are recorded on
-- this one (owner, member, delegate or organization member); the page says so rather
-- than listing every super admin on every project. Delegations are shown, not granted (G3).

CREATE OR REPLACE FUNCTION public.admin_get_project_access(
  p_actor_id uuid, p_actor_email text, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_people  jsonb;
  v_keys    jsonb;
  v_matrix  jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
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
      -- The resolver's own answer, all four layers, so the page never recomputes it.
      'capabilities', (SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
                         FROM jsonb_each(public.capabilities_for_user(u.id, v_project.id) -> 'features') f
                        WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities))
    ) AS j
      FROM people u
      LEFT JOIN public.organization_members om
             ON om.user_id = u.id AND om.org_id = v_project.organization_id
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
COMMENT ON FUNCTION public.admin_get_project_access(uuid, text, uuid) IS
  'D215 — /admin/projects'' members read. Active super admin only. Every account that owns '
  'the project, holds a membership or live delegation on it, or belongs to its organization, '
  'with where access comes from, the effective project role and the resolver''s project '
  'capabilities — the per-project reading of admin_get_user_memberships (D211).';
REVOKE ALL ON FUNCTION public.admin_get_project_access(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_project_access(uuid, text, uuid) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
