-- Profile / §4 D231 — a person's rights on a project are stated as they hold them IN THAT
-- PROJECT, not as they hold them in whichever organization they happen to be working in.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- D230 made /profile's, /admin/projects' and /admin/users/:userId's rights the app's own
-- answer. Two of that answer's inputs read the account's ACTIVE organization (D210):
--
--   · `visible` and `can_edit_project` were true only while the account was working in
--     the project's organization right now. Every sign-in lands in the DEFAULT one (D216),
--     so a member of ACCURATE-TRON whose default is HWR — Aliona, Anna — read "⊘ Sees
--     project" beside "Viewer member", and the same row would flip to ✓ the moment they
--     switched. The page answered "what can they do from where they stand this minute",
--     and the owner asked what they can do IN THE PROJECT: "this view should show with
--     assumption that users are in the current project".
--   · the resolver's organization layer (`capabilities_for_user(user, project)`) read the
--     ACTIVE organization's `org_capabilities`, so for a person with no project role the
--     four project rights followed whichever organization they were in, not the project's.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `capabilities_for_user(user, project)`: the organization layer is the PROJECT's
--     organization (the account's active one only for a project with none). The project is
--     used only while its organization is the active one, so this is the same answer the
--     app applies there; for the signed-in account on a project it can open, the two were
--     already equal. Everything else in the resolver is `20260915000005`'s, verbatim.
--   · `project_rights_for_user`: `visible` = a member of the project's organization (or a
--     super admin); `can_edit_project` = that AND (owner OR app admin); and a new
--     `working_in_project_org` says whether the account is in it right now, so a page can
--     add "switch to use it" without the ticks depending on it.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- The projects list and the `projects` policies still follow the ACTIVE organization
-- (D210): a member working elsewhere switches before the project appears. Someone who holds
-- a role but is not a member of the project's organization still does not see it, and the
-- rows still say so. An account that cannot sign in still holds nothing (D230).

-- ── 1 · the resolver's organization layer is the project's ─────────────────
CREATE OR REPLACE FUNCTION public.capabilities_for_user(_user_id uuid, _project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base         jsonb;
  v_role         text;
  v_org_id       uuid;
  v_is_super     boolean;
  v_project_role text;
  v_pages        jsonb;
  v_features     jsonb;
BEGIN
  -- everything that is not project-scoped comes from the one-argument form, so
  -- the two can never drift on models, budgets or the empty-user case.
  v_base := public.capabilities_for_user(_user_id);
  IF (v_base ->> 'role') IS NULL THEN
    RETURN v_base || jsonb_build_object('project', jsonb_build_object(
      'project_id', _project_id, 'project_role', NULL, 'is_member', false));
  END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
    FROM public.approved_users au WHERE au.id = _user_id;
  -- D231 — the organization layer is the PROJECT's organization: a project is used only
  -- while its organization is the one the account works in (D210), so that is the
  -- organization whose settings apply there, whichever one the account is in right now.
  SELECT COALESCE(p.organization_id, v_org_id) INTO v_org_id
    FROM public.projects p WHERE p.id = _project_id;
  v_is_super := (v_role = 'super_admin');
  v_project_role := public.effective_project_role(_user_id, _project_id);

  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_pages
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      WHEN c.key = '/profile' THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc
          WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT prc.allowed FROM public.project_role_capabilities prc
          WHERE prc.project_role = v_project_role AND prc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities oc
          WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc
          WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'page';

  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_features
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc
          WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT prc.allowed FROM public.project_role_capabilities prc
          WHERE prc.project_role = v_project_role AND prc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities oc
          WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc
          WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'feature';

  RETURN v_base
      || jsonb_build_object('pages', v_pages, 'features', v_features)
      || jsonb_build_object('project', jsonb_build_object(
           'project_id',   _project_id,
           'project_role', v_project_role,
           'is_member',    v_project_role IS NOT NULL));
END; $$;
REVOKE ALL ON FUNCTION public.capabilities_for_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capabilities_for_user(uuid, uuid) TO service_role;

-- ── 2 · the rights, stated in the project ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_rights_for_user(p_user_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user     public.approved_users%ROWTYPE;
  v_project  public.projects%ROWTYPE;
  v_active   boolean;
  v_super    boolean;
  v_member   boolean;
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
  -- D231 — rights are stated as the account has them WHILE WORKING IN THE PROJECT'S
  -- ORGANIZATION: a member of it sees the project there, whichever organization it is
  -- in right now (`working_in_project_org` says which, for a page that wants to).
  v_member := v_project.organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                 WHERE om.org_id = v_project.organization_id AND om.user_id = v_user.id);
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
    'visible',               v_active AND (v_super OR v_member),
    'can_edit_project',      v_active AND (v_super OR (v_member AND (v_project.modeler_id = v_user.id
                                                                     OR v_user.role = 'admin'::public.app_role))),
    'working_in_project_org', v_here,
    'may_land_uploads',      v_active AND v_land,
    'capabilities',          v_caps,
    'resolved_capabilities', v_resolved);
END; $$;
COMMENT ON FUNCTION public.project_rights_for_user(uuid, uuid) IS
  'D230, D231 — one person''s rights on one project, as the app applies them while the person '
  'works in the project''s organization: visible, working_in_project_org, '
  'can_edit_project, may_land_uploads, capabilities (the resolver''s project answer, refused '
  'to a suspended account, and data_edit_inputs also requiring the upload gate) and '
  'resolved_capabilities (the resolver before those gates). Internal: project_access_read, '
  'admin_get_user_memberships and get_my_project_rights read it; no role may call it.';
REVOKE ALL ON FUNCTION public.project_rights_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
