-- Admin users / §4 D211 — /admin/users/:userId shows WHICH organizations, WHICH projects
-- and WHAT the person may do on each, and a super admin can change them there.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
--
-- The user page (`get_user_access`) answered one question: which PAGES and FEATURES the
-- account's platform role grants, before any project is chosen. It returned the active
-- organization as a bare uuid the page never displayed, and nothing about projects at
-- all. So "is Dana on the Munich project, as what, and can she promote an upload there"
-- had no answer anywhere in the admin area, although these facts decide it:
--
--   · her ORGANIZATIONS (`organization_members`, many since D210) and her `org_role` in
--     each — owner/admin manage that organization's API keys (`_api_key_management_org`);
--   · her ACTIVE organization (`approved_users.organization_id`, D210) — the one RLS
--     reads: every project of it is visible to her ("Projects: org-wide view"), and the
--     projects of her other organizations become visible when she switches;
--   · her PROJECT ROLE (`project_members` + live `delegation_grants`, resolved by
--     `effective_project_role`, WP 2.2) — which gates promotion (editor+, D65) and is the
--     project layer of `capabilities_for_user(user, project)`;
--   · whether she OWNS the project (`projects.modeler_id`) or is an app `admin` — which,
--     with the active organization, is what every write policy on `projects` reads.
--
-- And there was no writer for two of them: `project_members` has had exactly two writers
-- in its life (WP 2.2's backfill and the WP 3.4 owner trigger), so a membership could not
-- be granted, changed or removed by anyone; `org_role` is set only when the membership is
-- created (the D205 mapping, or `admin_add_org_member`'s argument, D210).
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
--
--   · `admin_get_user_memberships` — the READ: every organization with the org role and
--     which one is active, and every project the account can reach or is recorded on,
--     each with where the access comes from and the resolved project capabilities
--     (`capabilities_for_user(user, project)`, so the page cannot compute the rights a
--     second way), plus the project role matrix so the page can say what each grants.
--   · `admin_set_user_org_role` — owner | admin | member in ONE of the account's
--     organizations, named by uuid.
--   · `admin_set_project_member` / `admin_remove_project_member` — grant, change, expire
--     or remove a standing project membership.
--
-- Adding and removing ORGANIZATION memberships is D210's `admin_add_org_member` /
-- `admin_remove_org_member`; the page calls those rather than a second writer. Which
-- organization is active is the account's own choice (`switch_my_organization`, D210)
-- and is shown, not set, here.
--
-- All four are active-super-admin only (`_assert_super_admin`, which also names the actor
-- for the audit), and every write logs through `log_admin_action`.
--
-- ── THE ONE REFUSAL THAT IS NOT OBVIOUS ──────────────────────────────────────
--
-- The project's MODELER's membership cannot be changed or removed here. `modeler_id` is
-- what the write policies on `projects` read as the owner, and `project_owner_membership`
-- (WP 3.4, D61) keeps the modeler an `owner` member. Demoting that row would leave the two
-- disagreeing — a user who may edit and delete the project by RLS and resolves as a viewer
-- everywhere the role is read — which is D66's disagreement manufactured on purpose.
-- Ownership moves with `admin_transfer_project` on /admin/projects; the refusal says so.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- A membership on a project of an organization the account does NOT belong to is
-- recorded and resolves (promotion, the capability resolver), but project VISIBILITY
-- follows the active organization — no policy on `projects` reads `project_members` — so
-- such a member never sees the project in the app. The read says so per project and the
-- page shows it. Delegations are shown, not granted here: a delegation is the grantor's
-- act and is subtractive from the grantor's own level (G3), which an admin verb would
-- bypass. Organization admins (non-super) cannot reach /admin; this is still a
-- super-admin screen.

-- ── 1 · the read ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_user_memberships(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_is_super boolean;
  v_orgs     jsonb;
  v_projects jsonb;
  v_keys     jsonb;
  v_matrix   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_target_user_id;
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  v_is_super := (v_user.role = 'super_admin'::public.app_role);

  -- Every organization the account belongs to (D210), the active one first.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status,
           'access_valid_until', o.access_valid_until,
           'org_role', m.org_role,
           'is_active', o.id = v_user.organization_id,
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
      'visible',           v_is_super OR (p.organization_id IS NOT NULL AND p.organization_id = v_user.organization_id),
      -- "Projects: org update by owner or admin" — active organization AND (modeler OR app admin).
      'can_edit_project',  v_is_super OR (p.organization_id IS NOT NULL AND p.organization_id = v_user.organization_id
                                          AND (p.modeler_id = v_user.id OR v_user.role = 'admin'::public.app_role)),
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
      -- The resolver's own answer, all four layers, so the page never recomputes it.
      'capabilities', (SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
                         FROM jsonb_each(public.capabilities_for_user(v_user.id, p.id) -> 'features') f
                        WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities))
    ) AS j
      FROM reach
      JOIN public.projects p ON p.id = reach.id
      LEFT JOIN public.organizations po ON po.id = p.organization_id
      LEFT JOIN public.approved_users ow ON ow.id = p.modeler_id
      LEFT JOIN public.project_members pm ON pm.project_id = p.id AND pm.user_id = v_user.id
      LEFT JOIN public.approved_users gb ON gb.id = pm.granted_by
  ) x;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'role', v_user.role::text,
    'is_super_admin', v_is_super,
    'active_organization_id', v_user.organization_id,
    'organizations', v_orgs,
    'projects', v_projects,
    'project_capabilities', v_keys,
    'role_matrix', v_matrix);
END; $$;
COMMENT ON FUNCTION public.admin_get_user_memberships(uuid, text, uuid) IS
  'D211 — /admin/users/:userId''s organization and project read. Active super admin only. '
  'Every organization (which is active) and, per project, where access comes from '
  '(active organization, another organization, ownership, membership, delegation), the '
  'effective project role and the resolver''s project capabilities.';
REVOKE ALL ON FUNCTION public.admin_get_user_memberships(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_memberships(uuid, text, uuid) TO anon, authenticated, service_role;

-- ── 2 · the role in one organization ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_org_role(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_org_id uuid, p_org_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_org_role IS NULL OR p_org_role NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'invalid organization role %', p_org_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  SELECT org_role INTO v_before FROM public.organization_members
   WHERE org_id = p_org_id AND user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: the account does not belong to that organization';
  END IF;
  IF v_before = p_org_role THEN RETURN; END IF;
  UPDATE public.organization_members SET org_role = p_org_role
   WHERE org_id = p_org_id AND user_id = p_target_user_id;
  PERFORM public.log_admin_action('user.org_role_change', 'organization_members', p_target_user_id::text,
    jsonb_build_object('org_id', p_org_id, 'org_role', v_before),
    jsonb_build_object('org_id', p_org_id, 'org_role', p_org_role));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_org_role(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_org_role(uuid, text, uuid, uuid, text) TO anon, authenticated;

-- ── 3 · project membership ──────────────────────────────────────────────────
-- An UPSERT on the natural key (I4). `expires_at` NULL is a standing membership.
CREATE OR REPLACE FUNCTION public.admin_set_project_member(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_project_id uuid,
  p_project_role text, p_expires_at timestamptz DEFAULT NULL, p_rationale text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_modeler uuid; v_found boolean; v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_project_role IS NULL OR public.project_role_rank(p_project_role) = 0 THEN
    RAISE EXCEPTION 'invalid project role %', p_project_role;
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at % is already in the past', p_expires_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  SELECT modeler_id, true INTO v_modeler, v_found FROM public.projects WHERE id = p_project_id;
  IF v_found IS NULL THEN RAISE EXCEPTION 'project not found'; END IF;
  IF v_modeler = p_target_user_id AND (p_project_role <> 'owner' OR p_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this user owns the project (its modeler) and stays a standing owner — transfer the project on /admin/projects first';
  END IF;

  SELECT to_jsonb(pm) INTO v_before FROM public.project_members pm
   WHERE pm.project_id = p_project_id AND pm.user_id = p_target_user_id;
  INSERT INTO public.project_members (project_id, user_id, project_role, granted_by, expires_at, rationale)
  VALUES (p_project_id, p_target_user_id, p_project_role, p_actor_id, p_expires_at,
          NULLIF(btrim(COALESCE(p_rationale, '')), ''))
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET project_role = EXCLUDED.project_role,
        granted_by   = EXCLUDED.granted_by,
        expires_at   = EXCLUDED.expires_at,
        rationale    = COALESCE(EXCLUDED.rationale, project_members.rationale),
        updated_at   = now();
  PERFORM public.log_admin_action('project.member_set', 'project_members',
    p_project_id::text || ':' || p_target_user_id::text, v_before,
    jsonb_build_object('project_id', p_project_id, 'user_id', p_target_user_id,
                       'project_role', p_project_role, 'expires_at', p_expires_at));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_project_member(uuid, text, uuid, uuid, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_project_member(uuid, text, uuid, uuid, text, timestamptz, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_project_member(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND modeler_id = p_target_user_id) THEN
    RAISE EXCEPTION 'this user owns the project (its modeler) and stays a standing owner — transfer the project on /admin/projects first';
  END IF;
  DELETE FROM public.project_members pm
   WHERE pm.project_id = p_project_id AND pm.user_id = p_target_user_id
  RETURNING to_jsonb(pm) INTO v_before;
  IF v_before IS NULL THEN RAISE EXCEPTION 'no membership to remove'; END IF;
  PERFORM public.log_admin_action('project.member_remove', 'project_members',
    p_project_id::text || ':' || p_target_user_id::text, v_before, NULL);
END; $$;
REVOKE ALL ON FUNCTION public.admin_remove_project_member(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_project_member(uuid, text, uuid, uuid) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
