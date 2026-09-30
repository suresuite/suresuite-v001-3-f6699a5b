-- Organization plan · more limit options / §4 D218 — an organization's project limit and
-- user limit may now each be 1, 2, 3, 5, 10, 20, 50 or 100, or NULL for unlimited.
-- D207 (`20260929000004`) offered 1, 2, 3 or 5 only, so an organization needing six
-- projects or twelve users had to be unlimited — the plan could not state its size.
--
-- ── 1 · WHAT CHANGES ────────────────────────────────────────────────────────
--
-- The list lives in three statements, and all three move together:
--   (a) the CHECKs `organizations_project_limit_check` / `organizations_user_limit_check`
--       — the authority, and what `organizationPlan.test.ts` reads;
--   (b) `admin_set_org_limits`, which refuses an off-list limit with a readable message;
--   (c) `admin_create_organization`, likewise.
-- Their bodies are `20260929000004`'s with the list widened and nothing else changed;
-- same signatures, so `CREATE OR REPLACE` keeps their grants.
--
-- ── 2 · WHAT DOES NOT ───────────────────────────────────────────────────────
--
-- Every existing value (1, 2, 3, 5, NULL) stays valid, so the wider CHECKs validate
-- against every row without touching one. Enforcement (`trg_tenant_allowance`), what
-- each limit counts (D207, D210) and NULL meaning unlimited are unchanged.
-- `src/lib/auth/organizationPlan.ts` offers the same list; the test compares them.

-- ── 1 · the CHECKs ──────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_project_limit_check,
  DROP CONSTRAINT IF EXISTS organizations_user_limit_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_project_limit_check
    CHECK (project_limit IN (1, 2, 3, 5, 10, 20, 50, 100)),
  ADD CONSTRAINT organizations_user_limit_check
    CHECK (user_limit IN (1, 2, 3, 5, 10, 20, 50, 100));

COMMENT ON COLUMN public.organizations.project_limit IS
  'D207/D218 — the most projects (projects.organization_id) the organization may hold: 1, 2, 3, '
  '5, 10, 20, 50 or 100. NULL = unlimited. Enforced by trg_tenant_allowance on projects.';
COMMENT ON COLUMN public.organizations.user_limit IS
  'D207/D218 — the most accounts (organization_members) the organization may have: 1, 2, 3, '
  '5, 10, 20, 50 or 100. NULL = unlimited. Enforced by trg_tenant_allowance on organization_members.';

-- ── 2 · the verbs ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_org_limits(
  p_actor_id uuid, p_actor_email text, p_org_id uuid,
  p_project_limit integer, p_user_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_project_limit IS NOT NULL AND p_project_limit NOT IN (1, 2, 3, 5, 10, 20, 50, 100) THEN
    RAISE EXCEPTION 'invalid project limit %', p_project_limit;
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit NOT IN (1, 2, 3, 5, 10, 20, 50, 100) THEN
    RAISE EXCEPTION 'invalid user limit %', p_user_limit;
  END IF;
  SELECT jsonb_build_object('project_limit', project_limit, 'user_limit', user_limit)
    INTO v_before FROM public.organizations WHERE id = p_org_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;

  UPDATE public.organizations
     SET project_limit = p_project_limit, user_limit = p_user_limit, updated_at = now()
   WHERE id = p_org_id;

  PERFORM public.log_admin_action('org.limits', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('project_limit', p_project_limit, 'user_limit', p_user_limit));
END; $$;
COMMENT ON FUNCTION public.admin_set_org_limits(uuid, text, uuid, integer, integer) IS
  'D207/D218 — set how many projects and user accounts an organization may have: 1, 2, 3, 5, '
  '10, 20, 50 or 100; NULL = unlimited. Lowering a limit deletes nothing; nothing can be added '
  'until under it.';

CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_actor_id uuid, p_actor_email text, p_name text, p_slug text,
  p_access_period text DEFAULT NULL, p_project_limit integer DEFAULT NULL,
  p_user_limit integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_slug text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF p_access_period IS NOT NULL AND p_access_period NOT IN ('week', 'month', 'quarter', 'year') THEN
    RAISE EXCEPTION 'invalid access period %', p_access_period;
  END IF;
  IF p_project_limit IS NOT NULL AND p_project_limit NOT IN (1, 2, 3, 5, 10, 20, 50, 100) THEN
    RAISE EXCEPTION 'invalid project limit %', p_project_limit;
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit NOT IN (1, 2, 3, 5, 10, 20, 50, 100) THEN
    RAISE EXCEPTION 'invalid user limit %', p_user_limit;
  END IF;
  v_slug := lower(regexp_replace(COALESCE(NULLIF(btrim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'an organization with slug "%" already exists', v_slug;
  END IF;
  INSERT INTO public.organizations
    (name, slug, status, access_period, access_valid_from, project_limit, user_limit)
  VALUES (btrim(p_name), v_slug, 'active',
          p_access_period, CASE WHEN p_access_period IS NULL THEN NULL ELSE now() END,
          p_project_limit, p_user_limit)
  RETURNING id INTO v_id;
  PERFORM public.log_admin_action('org.create', 'organizations', v_id::text, NULL,
    jsonb_build_object('name', btrim(p_name), 'slug', v_slug, 'access_period', p_access_period,
                       'project_limit', p_project_limit, 'user_limit', p_user_limit));
  RETURN v_id;
END; $$;
