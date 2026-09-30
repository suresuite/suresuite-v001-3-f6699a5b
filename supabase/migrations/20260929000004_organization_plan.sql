-- Organization plan / §4 D207 — for each ORGANIZATION an administrator chooses how long
-- it may be used (1 week, 1 month, 1 quarter, 1 year), how many projects it may hold and
-- how many user accounts it may have (1, 2, 3, 5, unlimited), and the database enforces
-- all three. Every member sees their organization's plan on /profile.
--
-- ── 1 · WHAT IS AUTHORED, AND WHERE ─────────────────────────────────────────
--
-- Five columns on `organizations`, each with exactly one author:
--
--   access_period      — the administrator's choice: 'week' | 'month' | 'quarter' |
--                        'year', or NULL for an organization that does not expire
--                        (every organization that existed before this migration).
--   access_valid_from  — when the current period started. Stamped by the database when
--                        a period is set (never by the browser's clock), so choosing a
--                        period again RENEWS it from that moment.
--   access_valid_until — DERIVED, never written by a caller: the BEFORE trigger below
--                        computes it through `org_access_period_interval()`, the one
--                        statement of what each period means. A write naming it is
--                        overwritten.
--   project_limit      — 1 | 2 | 3 | 5, or NULL for unlimited.
--   user_limit         — 1 | 2 | 3 | 5, or NULL for unlimited.
--
-- The lists are the CHECKs below; `src/lib/auth/organizationPlan.ts` offers the same
-- lists and `organizationPlan.test.ts` compares them with this file.
--
-- What the limits COUNT is what /admin/organizations already shows: projects by
-- `projects.organization_id` and accounts by `approved_users.organization_id` (the
-- authority since D205) — so the figure beside a limit is the figure it is measured by.
--
-- ── 2 · WHAT IS ENFORCED ────────────────────────────────────────────────────
--
-- (a) Sign-in. `authenticate_approved_user` returns NO ROW for a member of an
--     organization whose period has ended — exactly what a wrong password and a
--     suspended account get (D205), so both callers (the browser login and
--     `session-mint`) refuse it without a change of their own. Recorded as
--     `auth.sign_in_failed`, reason 'organization access period ended'.
-- (b) A signed-in session. `get_my_profile` returns `access_expired` on the server
--     clock and the browser signs the user out on the next reload when it is true.
-- (c) Projects. A BEFORE INSERT / UPDATE OF organization_id trigger on `projects`
--     refuses a project into an organization at its project limit or whose period has
--     ended — every writer (`create_project`, `admin_copy_project`, any future one),
--     because a rule written in one of several writers is D150's shape.
-- (d) Users. A BEFORE INSERT / UPDATE trigger on `approved_users` refuses an account
--     into an organization at its user limit (`admin_create_user`, `admin_update_user`,
--     the D47 stamp, any direct write).
--
-- Lowering a limit below what an organization already has deletes nothing: it cannot
-- add another until it is under the limit. Both triggers are named `trg_tenant_allowance`
-- so they fire AFTER the triggers that stamp `organization_id` (`set_project_defaults`,
-- `trg_approved_users_stamp_org_id`; triggers fire in name order), and each locks the
-- organization row so two writes at the same moment cannot both take the last place.
--
-- ── 3 · SUPER ADMINS ARE NOT LOCKED OUT BY THEIR ORGANIZATION ───────────────
--
-- Since D205 the admin gate requires an active super admin and the verbs refuse to
-- suspend or demote the last one. An organization's period ending would lock the
-- platform out the same way, with nobody clicking anything. So sign-in (a) does not
-- apply an organization's period to a super admin, and `get_my_profile` says so
-- (`access_exempt`) — the exemption is shown, not silent. A super admin still counts
-- towards the user limit and their projects towards the project limit.
--
-- ── 4 · WHAT IS NOT ─────────────────────────────────────────────────────────
--
-- Every other RPC still accepts an `anon` caller with an asserted user id (D28), so a
-- client that ignores the sign-out in (b) is not stopped by the database until it signs
-- in again. An account with no organization has no plan and no limits. API keys belong
-- to an organization and are not refused by its period (they are by its `status`).

-- ── 1 · the columns ─────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS access_period text
    CONSTRAINT organizations_access_period_check
    CHECK (access_period IN ('week', 'month', 'quarter', 'year')),
  ADD COLUMN IF NOT EXISTS access_valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS access_valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS project_limit integer
    CONSTRAINT organizations_project_limit_check
    CHECK (project_limit IN (1, 2, 3, 5)),
  ADD COLUMN IF NOT EXISTS user_limit integer
    CONSTRAINT organizations_user_limit_check
    CHECK (user_limit IN (1, 2, 3, 5));

-- A period and its start are set together or not at all.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_access_period_start_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_access_period_start_check
  CHECK ((access_period IS NULL) = (access_valid_from IS NULL));

COMMENT ON COLUMN public.organizations.access_period IS
  'D207 — how long the organization may be used from access_valid_from: week, month, '
  'quarter or year. NULL = does not expire. Set by admin_set_org_access_period.';
COMMENT ON COLUMN public.organizations.access_valid_from IS
  'D207 — when the current access period started (the database clock when it was set). '
  'NULL exactly when access_period is NULL.';
COMMENT ON COLUMN public.organizations.access_valid_until IS
  'D207 — DERIVED by trg_organizations_access_valid_until: access_valid_from + the period. '
  'Members other than super admins cannot sign in at or after it. NULL = does not expire.';
COMMENT ON COLUMN public.organizations.project_limit IS
  'D207 — the most projects (projects.organization_id) the organization may hold: 1, 2, 3 '
  'or 5. NULL = unlimited. Enforced by trg_tenant_allowance on projects.';
COMMENT ON COLUMN public.organizations.user_limit IS
  'D207 — the most accounts (approved_users.organization_id) the organization may have: '
  '1, 2, 3 or 5. NULL = unlimited. Enforced by trg_tenant_allowance on approved_users.';

-- ── 2 · the one statement of what a period means ───────────────────────────
CREATE OR REPLACE FUNCTION public.org_access_period_interval(p_period text)
RETURNS interval
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_period
           WHEN 'week'    THEN interval '7 days'
           WHEN 'month'   THEN interval '1 month'
           WHEN 'quarter' THEN interval '3 months'
           WHEN 'year'    THEN interval '1 year'
         END;
$$;
COMMENT ON FUNCTION public.org_access_period_interval(text) IS
  'D207 — the length of each organization access period. The only place the lengths are written.';

CREATE OR REPLACE FUNCTION public.organizations_derive_access_valid_until()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.access_valid_until :=
    CASE WHEN NEW.access_period IS NULL THEN NULL
         ELSE NEW.access_valid_from + public.org_access_period_interval(NEW.access_period)
    END;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.organizations_derive_access_valid_until() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_organizations_access_valid_until ON public.organizations;
CREATE TRIGGER trg_organizations_access_valid_until
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_derive_access_valid_until();

-- ── 3 · sign-in refuses a member of an organization whose period has ended ──
-- Same signature and body as `20260929000002`, plus the organization's period.
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_name    text;
  v_role    text;
  v_active  boolean;
  v_until   timestamptz;
  v_current boolean;
  v_known   uuid;
BEGIN
  SELECT au.id, au.name, au.role::text, au.is_active, o.access_valid_until
    INTO v_id, v_name, v_role, v_active, v_until
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE lower(au.email) = lower(user_email)
     AND au.password_hash = extensions.crypt(user_password, au.password_hash)
   LIMIT 1;

  -- A super admin is not locked out by their organization's period (header §3).
  v_current := v_until IS NULL OR v_until > now() OR v_role = 'super_admin';

  BEGIN
    IF v_id IS NOT NULL AND v_active AND v_current THEN
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in'
                        AND actor_user_id = v_id
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', v_id, 'auth.sign_in', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'allowed'));
      END IF;
    ELSIF v_id IS NOT NULL THEN
      -- The right password on a suspended account, or one whose organization's period
      -- has ended. Refused, and said so on the record; the account is the TARGET.
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in_failed'
                        AND target_id = v_id::text
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', NULL, 'auth.sign_in_failed', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'refused',
                  'reason', CASE WHEN NOT v_active THEN 'account suspended'
                                 ELSE 'organization access period ended' END));
      END IF;
    ELSE
      -- Recorded only for an address that is registered: an unknown address has no
      -- person to attribute it to, and recording it would let anyone write rows.
      SELECT au.id INTO v_known FROM public.approved_users au
       WHERE lower(au.email) = lower(user_email) LIMIT 1;
      IF v_known IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.audit_logs
                          WHERE plane = 'access' AND action = 'auth.sign_in_failed'
                            AND target_id = v_known::text
                            AND created_at > now() - interval '1 minute') THEN
        -- The ACTOR is unknown — whoever typed the wrong password is not proven to be
        -- the account holder — so it is the TARGET that names the account.
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', NULL, 'auth.sign_in_failed', 'approved_users', v_known::text,
                jsonb_build_object('outcome', 'refused', 'reason', 'wrong password'));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sign-in audit skipped: %', SQLERRM;   -- never fail a login over it
  END;

  IF v_id IS NOT NULL AND v_active AND v_current THEN
    RETURN QUERY SELECT v_id, v_name, v_role;
  END IF;
END;
$$;

-- ── 4 · the allowances, on every writer ─────────────────────────────────────

-- Projects: the organization's project limit and period.
CREATE OR REPLACE FUNCTION public.projects_enforce_org_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   public.organizations%ROWTYPE;
  v_count integer;
BEGIN
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;

  -- Locked: two projects created at the same moment would otherwise each count the
  -- other as absent and both take the last place.
  SELECT * INTO v_org FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_org.access_valid_until IS NOT NULL AND v_org.access_valid_until <= now() THEN
    RAISE EXCEPTION 'org_access_ended: the access period for % ended on % — an administrator must renew it before it can hold a new project',
      v_org.name, to_char(v_org.access_valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_org.project_limit IS NOT NULL THEN
    SELECT count(*)::int INTO v_count FROM public.projects p
     WHERE p.organization_id = NEW.organization_id AND p.id IS DISTINCT FROM NEW.id;
    IF v_count >= v_org.project_limit THEN
      RAISE EXCEPTION 'org_project_limit_reached: % may hold % project(s) and already holds % — delete one, or ask an administrator to raise the limit',
        v_org.name, v_org.project_limit, v_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.projects_enforce_org_allowance() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_tenant_allowance ON public.projects;
CREATE TRIGGER trg_tenant_allowance
  BEFORE INSERT OR UPDATE OF organization_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_enforce_org_allowance();

-- Accounts: the organization's user limit. On every UPDATE rather than `UPDATE OF
-- organization_id`, because the D47 stamp can set the uuid from the text copy and a
-- column list fires only for columns the STATEMENT names.
CREATE OR REPLACE FUNCTION public.approved_users_enforce_org_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   public.organizations%ROWTYPE;
  v_count integer;
BEGIN
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;
  IF NOT FOUND OR v_org.user_limit IS NULL THEN RETURN NEW; END IF;

  SELECT count(*)::int INTO v_count FROM public.approved_users u
   WHERE u.organization_id = NEW.organization_id AND u.id IS DISTINCT FROM NEW.id;
  IF v_count >= v_org.user_limit THEN
    RAISE EXCEPTION 'org_user_limit_reached: % may have % user(s) and already has % — remove one, or raise the organization''s user limit',
      v_org.name, v_org.user_limit, v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.approved_users_enforce_org_allowance() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_tenant_allowance ON public.approved_users;
CREATE TRIGGER trg_tenant_allowance
  BEFORE INSERT OR UPDATE ON public.approved_users
  FOR EACH ROW EXECUTE FUNCTION public.approved_users_enforce_org_allowance();

-- ── 5 · the administrator's verbs ──────────────────────────────────────────

-- Set, renew or clear an organization's access period. Setting any period (including
-- the one it already has) starts it NOW, so this is also the "renew" action.
CREATE OR REPLACE FUNCTION public.admin_set_org_access_period(
  p_actor_id uuid, p_actor_email text, p_org_id uuid, p_period text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_until timestamptz;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_period IS NOT NULL AND p_period NOT IN ('week', 'month', 'quarter', 'year') THEN
    RAISE EXCEPTION 'invalid access period %', p_period;
  END IF;
  SELECT jsonb_build_object('access_period', access_period,
                            'access_valid_from', access_valid_from,
                            'access_valid_until', access_valid_until)
    INTO v_before FROM public.organizations WHERE id = p_org_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;

  UPDATE public.organizations
     SET access_period     = p_period,
         access_valid_from = CASE WHEN p_period IS NULL THEN NULL ELSE now() END,
         updated_at        = now()
   WHERE id = p_org_id
  RETURNING access_valid_until INTO v_until;

  PERFORM public.log_admin_action('org.access_period', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('access_period', p_period, 'access_valid_until', v_until));
  RETURN v_until;
END; $$;
COMMENT ON FUNCTION public.admin_set_org_access_period(uuid, text, uuid, text) IS
  'D207 — set (or renew, from now) an organization''s access period: week, month, quarter '
  'or year; NULL = no expiry. Returns the new access_valid_until.';
REVOKE ALL ON FUNCTION public.admin_set_org_access_period(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_access_period(uuid, text, uuid, text) TO anon, authenticated;

-- Both limits in one call; NULL = unlimited. The page always sends both.
CREATE OR REPLACE FUNCTION public.admin_set_org_limits(
  p_actor_id uuid, p_actor_email text, p_org_id uuid,
  p_project_limit integer, p_user_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_project_limit IS NOT NULL AND p_project_limit NOT IN (1, 2, 3, 5) THEN
    RAISE EXCEPTION 'invalid project limit %', p_project_limit;
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit NOT IN (1, 2, 3, 5) THEN
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
  'D207 — set how many projects and user accounts an organization may have: 1, 2, 3 or 5; '
  'NULL = unlimited. Lowering a limit deletes nothing; nothing can be added until under it.';
REVOKE ALL ON FUNCTION public.admin_set_org_limits(uuid, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_limits(uuid, text, uuid, integer, integer) TO anon, authenticated;

-- Creation takes all three choices. A new signature, so the old one is dropped:
-- leaving it would keep a second way to create an organization that never asks.
DROP FUNCTION IF EXISTS public.admin_create_organization(uuid, text, text, text);

CREATE FUNCTION public.admin_create_organization(
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
  IF p_project_limit IS NOT NULL AND p_project_limit NOT IN (1, 2, 3, 5) THEN
    RAISE EXCEPTION 'invalid project limit %', p_project_limit;
  END IF;
  IF p_user_limit IS NOT NULL AND p_user_limit NOT IN (1, 2, 3, 5) THEN
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
REVOKE ALL ON FUNCTION public.admin_create_organization(uuid, text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_organization(uuid, text, text, text, text, integer, integer) TO anon, authenticated;

-- ── 6 · the reads ───────────────────────────────────────────────────────────

-- /admin/organizations — `20260929000002`'s columns, plus the plan. `members` and
-- `projects` are the counts the limits are measured by. A changed column list is a
-- DROP and CREATE.
DROP FUNCTION IF EXISTS public.admin_list_organizations(uuid, text);

CREATE FUNCTION public.admin_list_organizations(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, name text, slug text, status text, created_at timestamptz,
  members bigint, projects bigint, cost_mtd numeric,
  access_period text, access_valid_from timestamptz, access_valid_until timestamptz,
  access_expired boolean, project_limit integer, user_limit integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.status, o.created_at,
         (SELECT count(*) FROM public.approved_users u WHERE u.organization_id = o.id),
         (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id),
         COALESCE((SELECT sum(l.cost_usd) FROM public.ai_usage_logs l
                    WHERE l.org_id = o.id
                      AND l.created_at >= date_trunc('month', now())), 0),
         o.access_period, o.access_valid_from, o.access_valid_until,
         COALESCE(o.access_valid_until <= now(), false),
         o.project_limit, o.user_limit
  FROM public.organizations o
  ORDER BY o.name;
END; $$;
COMMENT ON FUNCTION public.admin_list_organizations(uuid, text) IS
  'D205, D207 — /admin/organizations''s read. Members and projects are counted by the '
  'uuid, and they are the counts the user and project limits are measured by; the '
  'access period''s expiry is on the server clock.';
REVOKE ALL ON FUNCTION public.admin_list_organizations(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations(uuid, text) TO anon, authenticated;

-- The account's own read — `20260929000003`'s columns, plus its organization's plan and
-- usage, so /profile can show them and the browser can sign an expired session out.
DROP FUNCTION IF EXISTS public.get_my_profile(uuid);

CREATE FUNCTION public.get_my_profile(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  display_name text,
  phone text,
  avatar_color text,
  role text,
  organization text,
  is_active boolean,
  force_password_change boolean,
  password_changed_at timestamptz,
  password_expires_at timestamptz,
  password_expired boolean,
  password_max_age_days integer,
  access_period text,
  access_valid_from timestamptz,
  access_valid_until timestamptz,
  access_expired boolean,
  access_exempt boolean,
  project_limit integer,
  projects_used bigint,
  user_limit integer,
  users_used bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
BEGIN
  RETURN QUERY
  SELECT au.id, au.email, au.name, au.display_name, au.phone, au.avatar_color,
         au.role::text, au.organization, au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at,
         (au.password_expires_at <= now()),
         extract(day FROM public.password_max_age())::integer,
         o.access_period, o.access_valid_from, o.access_valid_until,
         -- Expired FOR THIS ACCOUNT: the organization's period ended and the account is
         -- not a super admin (header §3). `access_exempt` says when the second applies.
         COALESCE(o.access_valid_until <= now(), false) AND au.role <> 'super_admin'::public.app_role,
         au.role = 'super_admin'::public.app_role,
         o.project_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id) END,
         o.user_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.approved_users u WHERE u.organization_id = o.id) END
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE au.id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.get_my_profile(uuid) IS
  'D206, D207 — the signed-in user''s own account row, with password_expired computed on '
  'the server clock, the password policy''s max age in days, and the plan of the account''s '
  'organization: its access period and end, whether it has ended for this account '
  '(access_expired; a super admin is exempt, access_exempt), and its project and user '
  'limits with the counts they are measured by. The user is a parameter because the '
  'browser calls as anon (D155); a contradicting session is refused.';
REVOKE ALL ON FUNCTION public.get_my_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile(uuid) TO anon, authenticated;
