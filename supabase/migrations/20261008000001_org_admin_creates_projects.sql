-- Profile / §4 D303 — an ADMIN or OWNER of an organization may create a project in it,
-- whatever the account role.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- Owner-reported: `phu.nguyen@hwr-berlin.de` is an Admin of ACCURATE-AA ("Admin · User
-- account" on /profile) and could not add a project there. Two gates read the ACCOUNT role
-- alone and nothing read the organization role:
--
--   · /project-manager — `capabilities_for_user(uuid)` resolves the page person override →
--     organization override → account role, and the `user` account role's default for
--     `/project-manager` is off (`20260711000002`). The page did not open.
--   · the New Project button — `useUserRole().canModify`, `modeler`/`admin`/`super_admin`.
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `project_creation_right(user)` — the RULE, authored once: super admin → yes; a
--     `modeler` or `admin` account → yes; otherwise an `owner` or `admin` membership of the
--     ACTIVE organization (`approved_users.organization_id`, D210) → yes; otherwise no. It
--     returns which of those decided and the organization a new project would land in,
--     because `create_project` takes no organization: `set_project_defaults` stamps the
--     active one. The organization is the ACTIVE one and only that one — an admin of
--     ACCURATE-AA who signs in to HWR (the default, D216) switches to ACCURATE-AA first.
--   · `capabilities_for_user(uuid)` — `20260905000001`'s body with the lines marked D303:
--     `/project-manager` is granted to a caller the rule admits BY ORGANIZATION ROLE, below
--     the person and organization overrides and above the account-role default — so an
--     explicit "off" for the person or the organization still closes the page — and the
--     rule's answer is returned as `project_creation`, which the New Project button reads
--     instead of the account role.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- `create_project` still checks nothing, as before: the rule is read by the page and the
-- button, not enforced by the writer. Enforcing it would REFUSE callers that work today —
-- `rehearsal/420` and `520` create projects as plain `user` accounts — which is a
-- tightening nobody asked for, so it is named here and left for a decision. The identity on
-- `create_project` is client-asserted either way (D28).
--
-- The organization role grants ONLY project creation and the page it happens on. Editing or
-- deleting a project's settings on /project-manager still reads the account role in the
-- browser, and the four project rights stay the project role's (D279); the creator is the
-- new project's `owner` (D61's trigger), so a project an organization admin creates is
-- theirs to fill.

-- ── 1 · the rule ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_creation_right(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role     text;
  v_org_id   uuid;
  v_org_name text;
  v_org_role text;
  v_allowed  boolean;
  v_by       text;
BEGIN
  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
    FROM public.approved_users au WHERE au.id = _user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'decided_by', 'no_account', 'account_role', NULL,
      'organization_id', NULL, 'organization_name', NULL, 'org_role', NULL);
  END IF;

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_org_id;
  SELECT m.org_role INTO v_org_role FROM public.organization_members m
   WHERE m.user_id = _user_id AND m.org_id = v_org_id;

  IF v_role = 'super_admin' THEN
    v_allowed := true;  v_by := 'super_admin';
  ELSIF v_role IN ('admin', 'modeler') THEN
    v_allowed := true;  v_by := 'account_role';
  ELSIF v_org_role IN ('owner', 'admin') THEN
    v_allowed := true;  v_by := 'organization_role';
  ELSE
    v_allowed := false; v_by := 'none';
  END IF;

  RETURN jsonb_build_object('allowed', v_allowed, 'decided_by', v_by, 'account_role', v_role,
    'organization_id', v_org_id, 'organization_name', v_org_name, 'org_role', v_org_role);
END; $$;
-- internal: reached through `capabilities_for_user`. Supabase's default privileges grant
-- `anon` and `authenticated` EXECUTE on every new function (D278's §7), so both are named.
REVOKE ALL ON FUNCTION public.project_creation_right(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.project_creation_right(uuid) IS
  'D303 — who may create a project, authored once: super admin; a modeler or admin account; '
  'otherwise an owner or admin of the ACTIVE organization (where create_project stamps the new '
  'project). Read by capabilities_for_user: the /project-manager page and the project_creation '
  'answer the New Project button reads. create_project does not enforce it.';

-- ── 2 · the page, and the answer the button reads ────────────────────────────
CREATE OR REPLACE FUNCTION public.capabilities_for_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role        text;
  v_org_id      uuid;
  v_is_super    boolean;
  v_pages       jsonb;
  v_features    jsonb;
  v_models      jsonb;
  v_budgets     jsonb;
  v_allowed_ids uuid[];
  v_all_models  boolean;
  v_creation    jsonb;     -- D303
  v_org_grant   boolean;   -- D303
BEGIN
  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
  FROM public.approved_users au WHERE au.id = _user_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', _user_id, 'role', NULL, 'is_super_admin', false,
      'pages', '{}'::jsonb, 'features', '{}'::jsonb,
      'models', jsonb_build_object('all_allowed', false, 'allowed_codes', '[]'::jsonb,
                                   'default_code', NULL, 'fallback_code', NULL),
      'budgets', '{}'::jsonb,
      'project_creation', public.project_creation_right(_user_id));   -- D303
  END IF;
  v_is_super := (v_role = 'super_admin');

  -- D303 (change 1 of 2): the creation rule, and whether it admits by ORGANIZATION role.
  v_creation  := public.project_creation_right(_user_id);
  v_org_grant := (v_creation ->> 'decided_by') = 'organization_role';

  -- pages
  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_pages
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      WHEN c.key = '/profile' THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities  oc WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        -- D303 (change 2 of 2): an organization admin/owner opens the page projects are
        -- created on — below both overrides, above the account-role default.
        CASE WHEN c.key = '/project-manager' AND v_org_grant THEN true END,
        (SELECT rc.allowed FROM public.role_capabilities rc WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'page';

  -- features
  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_features
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities  oc WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'feature';

  -- models (empty/absent allow-list = all enabled models allowed, preserving prior behaviour)
  SELECT uap.allowed_model_ids INTO v_allowed_ids
  FROM public.user_ai_permissions uap WHERE uap.user_id = _user_id;
  v_all_models := v_is_super OR v_allowed_ids IS NULL OR array_length(v_allowed_ids, 1) IS NULL;

  SELECT jsonb_build_object(
    'all_allowed', v_all_models,
    'allowed_codes', CASE WHEN v_all_models
        THEN (SELECT COALESCE(jsonb_agg(m.code ORDER BY m.display_name), '[]'::jsonb)
                FROM public.ai_models m WHERE m.enabled)
        ELSE (SELECT COALESCE(jsonb_agg(m.code ORDER BY m.display_name), '[]'::jsonb)
                FROM public.ai_models m WHERE m.enabled AND m.id = ANY(v_allowed_ids)) END,
    'default_code',  (SELECT m.code FROM public.ai_models m
                        JOIN public.user_ai_permissions u ON u.default_model_id = m.id  WHERE u.user_id = _user_id),
    'fallback_code', (SELECT m.code FROM public.ai_models m
                        JOIN public.user_ai_permissions u ON u.fallback_model_id = m.id WHERE u.user_id = _user_id)
  ) INTO v_models;

  -- budgets + live usage
  SELECT jsonb_build_object(
    'monthly_usd', (SELECT budget_usd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'daily_usd',   (SELECT budget_usd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='daily'),
    'token_limit', (SELECT token_limit FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'rpm',         (SELECT rpm FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='monthly'),
    'rpd',         (SELECT rpd FROM public.ai_budgets WHERE scope='user' AND scope_id=_user_id AND period='daily'),
    'mtd_cost_usd',  COALESCE((SELECT SUM(cost_usd)     FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'mtd_requests',  COALESCE((SELECT COUNT(*)          FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'mtd_tokens',    COALESCE((SELECT SUM(total_tokens) FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('month', now())), 0),
    'today_cost_usd',COALESCE((SELECT SUM(cost_usd)     FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('day', now())), 0),
    'today_requests',COALESCE((SELECT COUNT(DISTINCT COALESCE(request_id, id::text)) FROM public.ai_usage_logs WHERE user_id=_user_id AND created_at>=date_trunc('day', now())), 0)
  ) INTO v_budgets;

  RETURN jsonb_build_object(
    'user_id', _user_id, 'role', v_role, 'is_super_admin', v_is_super,
    'pages', v_pages, 'features', v_features, 'models', v_models, 'budgets', v_budgets,
    'project_creation', v_creation);
END; $$;
-- internal only — reached through `get_my_capabilities` / `get_effective_capabilities`
REVOKE ALL ON FUNCTION public.capabilities_for_user(uuid) FROM PUBLIC;
SELECT pg_notify('pgrst', 'reload schema');
