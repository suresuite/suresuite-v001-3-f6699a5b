-- Admin users / §4 D205 — /admin/users listed nobody, suspension did nothing, and
-- "which organization is this person in" had three answers.
--
-- ── 1 · THE EMPTY LIST ──────────────────────────────────────────────────────
--
-- `/admin/users` and the Overview's "Top users" read `v_admin_user_usage`. Since
-- `20260916000009` (D38) that view ends in `WHERE public.current_is_super_admin()`,
-- which resolves the reader through `get_current_user_id()`: a Supabase session, else
-- the `app.current_user_id` GUC, else a JWT email. The browser has none of the three
-- on a plain SELECT — it calls as `anon` (D155), `set_current_user_context` sets the
-- GUC LOCAL to its own RPC's transaction, and the anon JWT carries no email. So the
-- predicate is false for every browser read and the view answers ZERO ROWS with no
-- error. The page renders "No users yet." over an `approved_users` that holds every
-- account. `rehearsal/030` passed because it set the GUC in the same transaction and
-- ran as `authenticated` — a reader shape the product never has.
--
-- The Overview has the same defect at every figure: it counts `approved_users`
-- (REVOKEd from anon — refused, rendered 0), `organizations` and `ai_usage_logs`
-- (policies on the same predicate — 0 rows). `/admin/usage` reads `ai_usage_logs`
-- and looks names up in `approved_users`, both the same way. This is D185's defect
-- (the audit log) and D194's class, on the three pages that describe people.
--
-- The fix is D185's: the reader is a PARAMETER and must be an active super admin
-- (`_assert_super_admin`, the pattern of every /admin RPC). `v_admin_user_usage` is
-- left in place and no page reads it any more.
--
-- ── 2 · SUSPENSION WAS DECORATIVE ────────────────────────────────────────────
--
-- `admin_set_user_active` writes `is_active`, and nothing on the server reads it at
-- sign-in: `authenticate_approved_user` checks the password and returns the row. The
-- only check was in the browser, through `get_my_profile()`, which resolves the
-- caller the same way as above, raises `not_authenticated` for anon — and the login
-- skips the check when the call errors. A suspended account signed in normally, and
-- `session-mint` would have minted it a session. `_assert_super_admin` did not read
-- `is_active` either, so a suspended super admin kept the whole admin area.
--
-- Now the login returns no row for a suspended account (so BOTH of its callers fail
-- closed by construction) and records `auth.sign_in_failed` with the reason; and the
-- admin gate requires `is_active`. Because the gate now depends on it, the admin
-- verbs refuse to suspend or demote the acting admin themselves or the LAST active
-- super admin — otherwise one click could leave the platform with nobody able to
-- administer it.
--
-- ── 3 · ONE ORGANIZATION, AUTHORED ONCE ──────────────────────────────────────
--
-- An account's organization had three authors: `approved_users.organization_id`
-- (the authority — D13, and what RLS and `capabilities_for_user` read), the
-- `organization` text copy (never refreshed on a rename), and `organization_members`
-- rows (what the Organizations page COUNTED as "Members"). `admin_update_user` adds a
-- membership row on a move and never removes the old one, and an account created
-- outside `admin_create_user` has none, so the Members figure and the Users page could
-- not agree by construction.
--
-- The rule this migration makes structural: an account is in at most ONE
-- organization, `approved_users.organization_id`; `organization_members` holds the
-- account's role IN THAT organization and has exactly one row for it, or none when
-- the account has no organization. A trigger keeps it so, the backfill below makes it
-- so for existing rows, and every admin figure counts by `organization_id` and
-- displays the organization NAME resolved through it (never the text copy).

-- ── 1 · the admin gate: an ACTIVE super admin ───────────────────────────────
CREATE OR REPLACE FUNCTION public._assert_super_admin(p_actor_id uuid, p_actor_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF p_actor_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.approved_users
        WHERE id = p_actor_id
          AND role = 'super_admin'::public.app_role
          AND is_active) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._assert_super_admin(uuid, text) FROM PUBLIC;

-- The number of super admins who could still administer the platform. The verbs below
-- call `_lock_active_super_admins()` first: without it, two super admins suspending EACH
-- OTHER at the same moment would each count two and both succeed, leaving none.
CREATE OR REPLACE FUNCTION public._lock_active_super_admins()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.approved_users
   WHERE role = 'super_admin'::public.app_role AND is_active
   ORDER BY id
   FOR UPDATE;
END; $$;
REVOKE ALL ON FUNCTION public._lock_active_super_admins() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._active_super_admin_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.approved_users
   WHERE role = 'super_admin'::public.app_role AND is_active;
$$;
REVOKE ALL ON FUNCTION public._active_super_admin_count() FROM PUBLIC;

-- ── 2 · sign-in refuses a suspended account ─────────────────────────────────
-- Same signature and body as `20260929000001`, plus `is_active`. A suspended account
-- with the right password gets NO ROW — exactly what a wrong password gets, so every
-- caller that treats "a row came back" as "authenticated" (the browser login and
-- `session-mint`) refuses it without a change of its own.
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id     uuid;
  v_name   text;
  v_role   text;
  v_active boolean;
  v_known  uuid;
BEGIN
  SELECT au.id, au.name, au.role::text, au.is_active INTO v_id, v_name, v_role, v_active
    FROM public.approved_users au
   WHERE lower(au.email) = lower(user_email)
     AND au.password_hash = extensions.crypt(user_password, au.password_hash)
   LIMIT 1;

  BEGIN
    IF v_id IS NOT NULL AND v_active THEN
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in'
                        AND actor_user_id = v_id
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', v_id, 'auth.sign_in', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'allowed'));
      END IF;
    ELSIF v_id IS NOT NULL THEN
      -- The right password on a suspended account. Refused, and said so on the record
      -- so an administrator can see the attempt; the account is the TARGET.
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in_failed'
                        AND target_id = v_id::text
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', NULL, 'auth.sign_in_failed', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'refused', 'reason', 'account suspended'));
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

  IF v_id IS NOT NULL AND v_active THEN
    RETURN QUERY SELECT v_id, v_name, v_role;
  END IF;
END;
$$;

-- ── 3 · the verbs cannot lock the platform out ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text; v_active boolean;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_role NOT IN ('super_admin','admin','modeler','user') THEN RAISE EXCEPTION 'invalid role %', p_role; END IF;
  SELECT role::text, is_active INTO v_before, v_active FROM public.approved_users WHERE id = p_target_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF v_before = 'super_admin' AND p_role <> 'super_admin' THEN
    IF p_target_user_id = p_actor_id THEN
      RAISE EXCEPTION 'you cannot remove your own super_admin role — ask another super admin';
    END IF;
    PERFORM public._lock_active_super_admins();
    IF v_active AND public._active_super_admin_count() <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last active super admin';
    END IF;
  END IF;
  UPDATE public.approved_users SET role = p_role::public.app_role WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.role_change', 'approved_users', p_target_user_id::text,
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before boolean; v_role text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_is_active IS NULL THEN RAISE EXCEPTION 'is_active must be true or false'; END IF;
  SELECT is_active, role::text INTO v_before, v_role FROM public.approved_users WHERE id = p_target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;
  IF NOT p_is_active THEN
    IF p_target_user_id = p_actor_id THEN
      RAISE EXCEPTION 'you cannot suspend your own account';
    END IF;
    PERFORM public._lock_active_super_admins();
    IF v_role = 'super_admin' AND v_before AND public._active_super_admin_count() <= 1 THEN
      RAISE EXCEPTION 'cannot suspend the last active super admin';
    END IF;
  END IF;
  UPDATE public.approved_users SET is_active = p_is_active WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.set_active', 'approved_users', p_target_user_id::text,
    jsonb_build_object('is_active', v_before), jsonb_build_object('is_active', p_is_active));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, text, uuid, boolean) TO anon, authenticated;

-- ── 4 · membership follows organization_id ──────────────────────────────────
-- AFTER every INSERT and UPDATE rather than `UPDATE OF organization_id`: the BEFORE
-- trigger `trg_approved_users_stamp_org_id` can set the uuid from the text copy, and a
-- column list fires only for columns the STATEMENT names.
CREATE OR REPLACE FUNCTION public.approved_users_sync_org_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.organization_members m
   WHERE m.user_id = NEW.id AND m.org_id IS DISTINCT FROM NEW.organization_id;
  IF NEW.organization_id IS NOT NULL THEN
    -- The same role mapping as the `20260709000002` backfill and `admin_create_user`.
    INSERT INTO public.organization_members (org_id, user_id, org_role)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN NEW.role = 'admin'::public.app_role THEN 'admin' ELSE 'member' END)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.approved_users_sync_org_membership() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_approved_users_sync_org_membership ON public.approved_users;
CREATE TRIGGER trg_approved_users_sync_org_membership
  AFTER INSERT OR UPDATE ON public.approved_users
  FOR EACH ROW EXECUTE FUNCTION public.approved_users_sync_org_membership();

-- …and a membership row cannot name an organization its account is not in.
CREATE OR REPLACE FUNCTION public.organization_members_match_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.approved_users u
                  WHERE u.id = NEW.user_id AND u.organization_id = NEW.org_id) THEN
    RAISE EXCEPTION 'organization_members: account % is not in organization % — set approved_users.organization_id, the membership follows it',
      NEW.user_id, NEW.org_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.organization_members_match_account() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_organization_members_match_account ON public.organization_members;
CREATE TRIGGER trg_organization_members_match_account
  BEFORE INSERT OR UPDATE OF org_id, user_id ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.organization_members_match_account();

-- The backfill: remove rows that contradict the account's organization, add the row
-- an account is missing. Measured before by §15 run `36641092611` (D205).
DELETE FROM public.organization_members m
 USING public.approved_users u
 WHERE u.id = m.user_id
   AND m.org_id IS DISTINCT FROM u.organization_id;

INSERT INTO public.organization_members (org_id, user_id, org_role)
SELECT u.organization_id, u.id,
       CASE WHEN u.role = 'admin'::public.app_role THEN 'admin' ELSE 'member' END
  FROM public.approved_users u
 WHERE u.organization_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- ── 5 · the reads ───────────────────────────────────────────────────────────
-- Month and day boundaries are the DATABASE's (`date_trunc(…, now())`, UTC), for every
-- figure on every admin page, so the Overview's MTD and the Users page's MTD are the
-- same window. The Overview used to take them from the browser's local clock.

-- /admin/users — every account, with the organization resolved through its uuid.
CREATE OR REPLACE FUNCTION public.admin_list_users(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  user_id uuid, name text, email text, role text, is_active boolean,
  organization_id uuid, organization text, organization_status text, org_role text,
  mtd_requests bigint, mtd_tokens bigint, mtd_cost_usd numeric,
  monthly_budget_usd numeric, created_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT au.id, au.name, au.email, au.role::text, au.is_active,
         au.organization_id, o.name, o.status, m.org_role,
         COALESCE(mtd.requests, 0)::bigint,
         COALESCE(mtd.tokens, 0)::bigint,
         COALESCE(mtd.cost_usd, 0)::numeric,
         (SELECT b.budget_usd FROM public.ai_budgets b
           WHERE b.scope = 'user' AND b.scope_id = au.id AND b.period = 'monthly' LIMIT 1),
         au.created_at
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
    LEFT JOIN public.organization_members m ON m.user_id = au.id AND m.org_id = au.organization_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS requests, SUM(l.total_tokens) AS tokens, SUM(l.cost_usd) AS cost_usd
        FROM public.ai_usage_logs l
       WHERE l.user_id = au.id AND l.created_at >= date_trunc('month', now())
    ) mtd ON true
   ORDER BY COALESCE(mtd.cost_usd, 0) DESC, lower(COALESCE(au.name, au.email));
END; $$;
COMMENT ON FUNCTION public.admin_list_users(uuid, text) IS
  'D205 — /admin/users''s read. The reader is a parameter and must be an active super '
  'admin, because the browser calls as anon and v_admin_user_usage answers it nothing. '
  'Organization is resolved through approved_users.organization_id, never the text copy.';
REVOKE ALL ON FUNCTION public.admin_list_users(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users(uuid, text) TO anon, authenticated, service_role;

-- /admin — the Overview's figures, all from one statement's snapshot.
CREATE OR REPLACE FUNCTION public.admin_platform_overview(p_actor_id uuid, p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month timestamptz := date_trunc('month', now());
  v_day   timestamptz := date_trunc('day', now());
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN jsonb_build_object(
    'month_start', v_month,
    'day_start',   v_day,
    'organizations', (SELECT count(*) FROM public.organizations),
    'projects',      (SELECT count(*) FROM public.projects),
    'users',         (SELECT count(*) FROM public.approved_users),
    'users_suspended', (SELECT count(*) FROM public.approved_users WHERE NOT is_active),
    'requests',      (SELECT count(*) FROM public.ai_usage_logs),
    'cost_today',    (SELECT COALESCE(sum(cost_usd), 0) FROM public.ai_usage_logs WHERE created_at >= v_day),
    'cost_mtd',      (SELECT COALESCE(sum(cost_usd), 0) FROM public.ai_usage_logs WHERE created_at >= v_month),
    'requests_mtd',  (SELECT count(*) FROM public.ai_usage_logs WHERE created_at >= v_month),
    'active_users_7d', (SELECT count(DISTINCT user_id) FROM public.ai_usage_logs
                         WHERE created_at >= now() - interval '7 days' AND user_id IS NOT NULL),
    'top_users', COALESCE((
      SELECT jsonb_agg(t ORDER BY (t ->> 'cost')::numeric DESC, (t ->> 'requests')::bigint DESC)
        FROM (SELECT jsonb_build_object(
                       'user_id', l.user_id,
                       'label', COALESCE(u.name, u.email, 'Deleted account'),
                       'requests', count(*),
                       'cost', COALESCE(sum(l.cost_usd), 0)) AS t
                FROM public.ai_usage_logs l
                LEFT JOIN public.approved_users u ON u.id = l.user_id
               WHERE l.created_at >= v_month AND l.user_id IS NOT NULL
               GROUP BY l.user_id, u.name, u.email
               ORDER BY COALESCE(sum(l.cost_usd), 0) DESC, count(*) DESC
               LIMIT 10) s), '[]'::jsonb),
    'top_orgs', COALESCE((
      SELECT jsonb_agg(t ORDER BY (t ->> 'cost')::numeric DESC, (t ->> 'requests')::bigint DESC)
        FROM (SELECT jsonb_build_object(
                       'org_id', l.org_id,
                       'label', CASE WHEN l.org_id IS NULL THEN 'Unassigned'
                                     ELSE COALESCE(o.name, 'Deleted organization') END,
                       'requests', count(*),
                       'cost', COALESCE(sum(l.cost_usd), 0)) AS t
                FROM public.ai_usage_logs l
                LEFT JOIN public.organizations o ON o.id = l.org_id
               WHERE l.created_at >= v_month
               GROUP BY l.org_id, o.name
               ORDER BY COALESCE(sum(l.cost_usd), 0) DESC, count(*) DESC
               LIMIT 10) s), '[]'::jsonb));
END; $$;
COMMENT ON FUNCTION public.admin_platform_overview(uuid, text) IS
  'D205 — /admin''s figures. Reader is a parameter and must be an active super admin; '
  'MTD and today are the database''s UTC boundaries, the same as admin_list_users.';
REVOKE ALL ON FUNCTION public.admin_platform_overview(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_platform_overview(uuid, text) TO anon, authenticated, service_role;

-- /admin/usage — the newest usage rows, each with its person's name.
CREATE OR REPLACE FUNCTION public.admin_usage_log_read(
  p_actor_id uuid, p_actor_email text, p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid, user_id uuid, user_name text, model_code text, provider_code text,
  prompt_tokens integer, completion_tokens integer, total_tokens integer,
  cost_usd numeric, latency_ms integer, status text, created_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT l.id, l.user_id,
         CASE WHEN l.user_id IS NULL THEN NULL
              ELSE COALESCE(u.name, u.email, 'Deleted account') END,
         l.model_code, l.provider_code,
         l.prompt_tokens, l.completion_tokens, l.total_tokens,
         l.cost_usd::numeric, l.latency_ms, l.status, l.created_at
    FROM public.ai_usage_logs l
    LEFT JOIN public.approved_users u ON u.id = l.user_id
   ORDER BY l.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
END; $$;
COMMENT ON FUNCTION public.admin_usage_log_read(uuid, text, integer) IS
  'D205 — /admin/usage''s read. Reader is a parameter and must be an active super admin.';
REVOKE ALL ON FUNCTION public.admin_usage_log_read(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_usage_log_read(uuid, text, integer) TO anon, authenticated, service_role;

-- /admin/organizations — Members counted by the authority, so the figure equals the
-- number of rows /admin/users shows under that organization. Same signature and
-- columns as `20260712000002`.
CREATE OR REPLACE FUNCTION public.admin_list_organizations(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, name text, slug text, status text, created_at timestamptz,
  members bigint, projects bigint, cost_mtd numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.status, o.created_at,
         (SELECT count(*) FROM public.approved_users u WHERE u.organization_id = o.id),
         (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id),
         COALESCE((SELECT sum(l.cost_usd) FROM public.ai_usage_logs l
                    WHERE l.org_id = o.id
                      AND l.created_at >= date_trunc('month', now())), 0)
  FROM public.organizations o
  ORDER BY o.name;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_organizations(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations(uuid, text) TO anon, authenticated;
