-- Profile / §4 D279 — on a project where a person holds a role, the PROJECT role decides the
-- four project rights, and an Editor's uploads are accepted like the owner's.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- D276 (`20261002000004`) made the account role a CEILING over the project role: a right held
-- only when the project role granted it AND the account allowed it. In production the 'user'
-- account role allows Run Simulations and nothing else, so the OWNER of a project — the person
-- who created it, shown as "Owner (fixed)" — held Run Simulations there and not Edit Input
-- Data, Edit Policies or Export. Every Editor with a 'user' account was capped the same way.
--
-- And Edit Input Data had a second gate after the rule: `has_project_access`, which every
-- upload passes, admitted the project's owner and app admins only. An Editor whose role
-- granted Edit Input Data was refused by it on every project (decided by `upload_gate`).
--
-- Owner-reported, on an owner shown with Run Simulations on and the other three off: "if he is
-- the editor or the owner, we must be able to Edit Input Data, Edit Policies, Export".
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `project_right_decide` — the one rule every reader applies (the resolver, the per-person
--     explanation, the agent approval, D275's policy writers, /admin/roles and its preview):
--     super admin → yes; a person override → its value; NO project role → the account's
--     answer; otherwise → the project role's grant. The `account_ceiling` branch is gone, so
--     the account role and an organization switch decide only for people who hold no role on
--     the project. Owner and Editor grant all four; Analyst grants Run Simulations; Viewer
--     grants none.
--   · `has_project_access` — the upload gate — admits a person whose effective project role is
--     Editor or Owner, beside the project's modeler and app admins. `ingest_apply_run` already
--     required Editor or higher, so the landing and the promotion now agree.
--   · `project_rights_for_user` — `may_land_uploads` is that same gate, so the page and the
--     upload cannot disagree.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- A person override on /admin/users/:userId still beats the project role — the one deliberate
-- per-person switch. The project-role matrix (`project_role_capabilities`) is unchanged. The
-- rule's signature is unchanged, so `get_role_access`, `admin_preview_role_capability` and
-- `project_right_decisions` follow it without being redefined; the "capped" list they return
-- is now always empty. Opening a project still follows its organization (D231), and editing
-- project settings is still the owner's or an app admin's.

-- ── 1 · the rule ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_right_decide(
  p_is_super      boolean,
  p_override      boolean,
  p_project_role  text,
  p_project_grant boolean,
  p_account       boolean)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_is_super, false)
      THEN jsonb_build_object('allowed', true,  'decided_by', 'super_admin')
    WHEN p_override IS NOT NULL
      THEN jsonb_build_object('allowed', p_override, 'decided_by', 'person_override')
    WHEN p_project_role IS NULL OR p_project_grant IS NULL
      THEN jsonb_build_object('allowed', COALESCE(p_account, false), 'decided_by', 'account_role')
    ELSE jsonb_build_object('allowed', p_project_grant, 'decided_by', 'project_role')
  END;
$$;
COMMENT ON FUNCTION public.project_right_decide(boolean, boolean, text, boolean, boolean) IS
  'D276, D279 — the one rule for a project-scoped right: super admin → yes; a person override → '
  'its value; no project role → the account''s answer; otherwise the project role''s grant. '
  'Returns {allowed, decided_by}. capabilities_for_user, project_rights_for_user, '
  'get_role_access and admin_preview_role_capability all read it.';

-- ── 2 · the upload gate admits Editors ──────────────────────────────────────
-- `20261001000017`'s body, plus the project-role branch.
CREATE OR REPLACE FUNCTION public.has_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.modeler_id = public.get_current_user_id()
           OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) IN ('admin', 'super_admin')
           OR public.project_role_rank(public.effective_project_role(public.get_current_user_id(), p.id))
              >= public.project_role_rank('editor'))
  );
$$;
COMMENT ON FUNCTION public.has_project_access(uuid) IS
  'D279 — the upload gate: the current user (app.current_user_id) is the project''s modeler, an '
  'app admin, or holds Editor or Owner on the project. Every upload (ingest_land_file, '
  'ingest_apply_run) and the reads behind its review pass it.';

-- ── 3 · the rights read the same gate ───────────────────────────────────────
-- `20261002000004`'s body; only `v_land` changes.
CREATE OR REPLACE FUNCTION public.project_rights_for_user(p_user_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user      public.approved_users%ROWTYPE;
  v_project   public.projects%ROWTYPE;
  v_active    boolean;
  v_super     boolean;
  v_member    boolean;
  v_here      boolean;
  v_land      boolean;
  v_resolved  jsonb;
  v_caps      jsonb;
  v_decisions jsonb;
BEGIN
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_user_id;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF v_user.id IS NULL OR v_project.id IS NULL THEN RETURN NULL; END IF;

  -- A suspended account cannot sign in (D205), so it holds nothing, whatever its role says.
  v_active := COALESCE(v_user.is_active, true);
  v_super  := (v_user.role = 'super_admin'::public.app_role);
  -- D231 — rights are stated as the account has them WHILE WORKING IN THE PROJECT'S
  -- ORGANIZATION.
  v_member := v_project.organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                 WHERE om.org_id = v_project.organization_id AND om.user_id = v_user.id);
  v_here   := v_project.organization_id IS NOT NULL AND v_user.organization_id = v_project.organization_id;
  -- `has_project_access` — the gate `ingest_land_file` applies to every upload (D279: the
  -- modeler, an app admin, or Editor/Owner on the project).
  v_land   := v_project.modeler_id = v_user.id
              OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
              OR public.project_role_rank(public.effective_project_role(v_user.id, v_project.id))
                 >= public.project_role_rank('editor');

  -- The resolver's project answer, for the keys its project layer has an opinion on.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_resolved
    FROM jsonb_each(public.capabilities_for_user(v_user.id, v_project.id) -> 'features') f
   WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.key,
           to_jsonb(v_active AND COALESCE((r.value #>> '{}')::boolean, false)
                    AND (r.key <> 'data_edit_inputs' OR v_land))), '{}'::jsonb)
    INTO v_caps
    FROM jsonb_each(v_resolved) r;

  -- D276 — why each right holds or not. The rule's own decider, then the two gates applied
  -- after it: suspension and, for Edit Input Data, the upload gate.
  SELECT COALESCE(jsonb_object_agg(d.key,
           d.value || jsonb_build_object(
             'allowed', COALESCE((v_caps ->> d.key)::boolean, false),
             'decided_by', CASE
               WHEN NOT v_active THEN 'suspended'
               WHEN d.key = 'data_edit_inputs' AND (d.value ->> 'allowed')::boolean AND NOT v_land
                 THEN 'upload_gate'
               ELSE d.value ->> 'decided_by' END)), '{}'::jsonb)
    INTO v_decisions
    FROM jsonb_each(public.project_right_decisions(v_user.id, v_project.id)) d;

  RETURN jsonb_build_object(
    'account_active',        v_active,
    'visible',               v_active AND (v_super OR v_member),
    'can_edit_project',      v_active AND (v_super OR (v_member AND (v_project.modeler_id = v_user.id
                                                                     OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)))),
    'working_in_project_org', v_here,
    'may_land_uploads',      v_active AND v_land,
    'capabilities',          v_caps,
    'resolved_capabilities', v_resolved,
    'decisions',             v_decisions);
END; $$;
COMMENT ON FUNCTION public.project_rights_for_user(uuid, uuid) IS
  'D230, D231, D276, D279 — one person''s rights on one project, as the app applies them while '
  'the person works in the project''s organization: visible, working_in_project_org, '
  'can_edit_project, may_land_uploads (the upload gate: modeler, app admin, or Editor/Owner), '
  'capabilities (project_right_decide''s answer, refused to a suspended account, and '
  'data_edit_inputs also requiring the upload gate), resolved_capabilities (the rule before '
  'those gates) and decisions (each right''s inputs and what decided it). Internal: '
  'project_access_read, admin_get_user_memberships and get_my_project_rights read it; no role '
  'may call it.';
REVOKE ALL ON FUNCTION public.project_rights_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
