-- Organizations / §4 D210 — one user account may belong to MORE THAN ONE organization,
-- and works in one of them at a time.
--
-- Until now an account was in at most one organization, by construction (D205):
-- `approved_users.organization_id` was the account's organization, a trigger kept
-- exactly one `organization_members` row in it, deleted any other on a move, and
-- refused a row naming a second. A consultant working for two tenants needed two
-- accounts, two e-mail addresses and two passwords, and nothing tied them together.
--
-- ── 1 · THE MODEL: MEMBERSHIPS, AND ONE ACTIVE ORGANIZATION ─────────────────
--
--   `organization_members`        — WHICH organizations the account belongs to, and
--                                   its role in each. Many rows per account. The
--                                   authority for membership.
--   `approved_users.organization_id` — the ACTIVE organization: the one the account
--                                   is working in now. Still the one thing RLS reads
--                                   (`get_current_user_org_id`, `org_is_current_user_org`
--                                   and every policy that calls them), what a new project
--                                   is stamped with, and what `capabilities_for_user`
--                                   and the API-key verbs resolve.
--
-- The alternative — every policy admitting ANY of the account's organizations — was
-- rejected: it would change what 59 project-scoped policies return, all at once, and
-- mix two tenants' projects on one screen. With an active organization, a single-org
-- account sees exactly what it saw before this migration, and a multi-org account sees
-- one tenant at a time and switches between them.
--
-- The invariant, kept by the triggers below and asserted by `rehearsal/450`:
--   `organization_id` is NULL exactly when the account has no membership; otherwise
--   `(organization_id, id)` IS a membership row.
--
--   · Setting `organization_id` (any writer: `admin_create_user`, `admin_update_user`,
--     the D47 stamp, `switch_my_organization`) ADDS the membership if it is missing —
--     `approved_users_sync_org_membership`, which no longer deletes the others.
--   · Adding a membership to an account with no active organization makes it active.
--   · Removing the membership of the ACTIVE organization re-points `organization_id`
--     to the account's earliest remaining membership, or NULL when none remains.
--   · Writing NULL while memberships remain re-points the same way (this is what an
--     `ON DELETE SET NULL` from `organizations` does).
--   · The `organization` text copy is refreshed to the active organization's name
--     whenever the active organization changes (it was never refreshed before, D205).
--
-- ── 2 · WHAT MOVES WITH IT ──────────────────────────────────────────────────
--
-- (a) The user limit (D207) counts MEMBERSHIPS — a seat is a membership, not an active
--     organization; otherwise a member who switched away would free a seat they still
--     hold. `trg_tenant_allowance` moves from `approved_users` to `organization_members`
--     (BEFORE INSERT). Every path that adds an account to an organization adds the row
--     there, so every writer is still covered — and one that only SWITCHES to an
--     organization the account already belongs to takes no seat.
-- (b) Sign-in (D207): an account whose ACTIVE organization's period has ended, but that
--     belongs to another organization whose period has not, signs in and is switched to
--     that organization (recorded on the `auth.sign_in` row). Refused only when no
--     membership is current. Super admins stay exempt; an account with no organization
--     is unchanged.
-- (c) `admin_delete_organization` (D208) deletes the accounts that belong to NO OTHER
--     organization, as before, and DETACHES the ones that do: their membership goes and
--     their active organization re-points. The super-admin guard applies to the accounts
--     it would delete; the own-organization guard to any membership of the actor.
-- (d) The reads: `admin_list_organizations.members` counts memberships and gains
--     `members_only_here` (the accounts a delete would remove); `admin_list_users` gains
--     `memberships`; `get_my_profile` counts users by membership and names the active
--     organization through its uuid.
--
-- ── 3 · THE NEW VERBS ───────────────────────────────────────────────────────
--
--   list_my_organizations(p_user_id)            — the account's organizations, which is active
--   switch_my_organization(p_org_id, p_user_id) — change the active organization; a member only,
--                                                 and not into an ended period (super admins exempt)
--   admin_add_org_member(…)                     — a super admin adds an account to an organization
--   admin_remove_org_member(…)                  — …and removes it
--
-- ── 4 · WHAT IS NOT ─────────────────────────────────────────────────────────
--
-- `switch_my_organization` resolves its caller the way every self-service RPC does
-- (`account_self_resolve`): an `anon` call NAMES its user (D28, D155), so a client can
-- switch another account's active organization — only ever to one that account already
-- belongs to, which grants nothing it did not have. `organization_members.org_role` is
-- still read only by the API-key verbs. The audit-log reader's "same organization as the
-- actor" is the actor's ACTIVE organization today, so an actor's history follows the
-- organization they are working in rather than the one they were in when they acted.

-- ── 1 · approved_users: membership follows the active organization — it ADDS, never deletes
CREATE OR REPLACE FUNCTION public.approved_users_sync_org_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NULL;
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    -- The same role mapping as the `20260709000002` backfill and `admin_create_user`.
    -- A seat is taken here, so the user limit is enforced here (§2a).
    INSERT INTO public.organization_members (org_id, user_id, org_role)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN NEW.role = 'admin'::public.app_role THEN 'admin' ELSE 'member' END)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.approved_users_sync_org_membership() FROM PUBLIC;
COMMENT ON FUNCTION public.approved_users_sync_org_membership() IS
  'D205, D210 — when approved_users.organization_id (the ACTIVE organization) is set, '
  'adds the account''s membership of it if missing. Never removes another membership: '
  'an account may belong to several organizations (D210).';

-- …and the active organization is always one of the account's memberships.
-- Named to fire AFTER `trg_approved_users_stamp_org_id` (triggers fire in name order),
-- so a uuid the D47 stamp fills from the text copy is kept rather than re-pointed.
CREATE OR REPLACE FUNCTION public.approved_users_track_active_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.organization_id IS NULL AND TG_OP = 'UPDATE' THEN
    -- NULL while memberships remain: the earliest one whose organization still exists
    -- (an `ON DELETE SET NULL` from `organizations` runs after the row is gone).
    SELECT m.org_id INTO NEW.organization_id
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = NEW.id
     ORDER BY m.joined_at, m.org_id
     LIMIT 1;
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    SELECT o.name INTO v_name FROM public.organizations o WHERE o.id = NEW.organization_id;
    IF v_name IS NOT NULL THEN
      NEW.organization := v_name;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.approved_users_track_active_org() FROM PUBLIC;
COMMENT ON FUNCTION public.approved_users_track_active_org() IS
  'D210 — keeps approved_users.organization_id (the ACTIVE organization) one of the '
  'account''s memberships: a NULL written while memberships remain re-points to the '
  'earliest one, and the organization text copy follows the active organization''s name.';

DROP TRIGGER IF EXISTS trg_approved_users_track_active_org ON public.approved_users;
CREATE TRIGGER trg_approved_users_track_active_org
  BEFORE INSERT OR UPDATE OF organization, organization_id ON public.approved_users
  FOR EACH ROW EXECUTE FUNCTION public.approved_users_track_active_org();

-- ── 2 · organization_members: more than one per account ─────────────────────
-- D205's refusal of a row naming a second organization goes.
DROP TRIGGER IF EXISTS trg_organization_members_match_account ON public.organization_members;
DROP FUNCTION IF EXISTS public.organization_members_match_account();

-- The user limit, now on the row that IS the seat. Named `trg_tenant_allowance` like
-- its `projects` twin. Locks the organization row so two adds at the same moment
-- cannot both take the last place (D207).
CREATE OR REPLACE FUNCTION public.organization_members_enforce_org_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   public.organizations%ROWTYPE;
  v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'organization_members: a membership''s organization and account are fixed — remove it and add another'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An `ON CONFLICT DO NOTHING` re-add of an existing member (every switch of the active
  -- organization makes one) fires this trigger too. It takes no seat — and must not be
  -- refused when a lowered limit leaves the organization over it (D207: lowering a limit
  -- removes nobody).
  IF EXISTS (SELECT 1 FROM public.organization_members m
              WHERE m.org_id = NEW.org_id AND m.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = NEW.org_id FOR UPDATE;
  IF NOT FOUND OR v_org.user_limit IS NULL THEN RETURN NEW; END IF;

  SELECT count(*)::int INTO v_count FROM public.organization_members m
   WHERE m.org_id = NEW.org_id;
  IF v_count >= v_org.user_limit THEN
    RAISE EXCEPTION 'org_user_limit_reached: % may have % user(s) and already has % — remove one, or raise the organization''s user limit',
      v_org.name, v_org.user_limit, v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.organization_members_enforce_org_allowance() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_tenant_allowance ON public.organization_members;
CREATE TRIGGER trg_tenant_allowance
  BEFORE INSERT OR UPDATE OF org_id, user_id ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.organization_members_enforce_org_allowance();

-- The old seat check on `approved_users` counted ACTIVE organizations; it goes.
DROP TRIGGER IF EXISTS trg_tenant_allowance ON public.approved_users;
DROP FUNCTION IF EXISTS public.approved_users_enforce_org_allowance();

-- A first membership becomes the active organization.
CREATE OR REPLACE FUNCTION public.organization_members_activate_first()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.approved_users
     SET organization_id = NEW.org_id
   WHERE id = NEW.user_id AND organization_id IS NULL;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.organization_members_activate_first() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_organization_members_activate_first ON public.organization_members;
CREATE TRIGGER trg_organization_members_activate_first
  AFTER INSERT ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.organization_members_activate_first();

-- Leaving the ACTIVE organization re-points the account. The text copy is set to the
-- `'default_org'` sentinel first, so the D47 stamp cannot re-stamp the organization
-- just left from its own name; `approved_users_track_active_org` then picks the next
-- membership, or leaves NULL.
CREATE OR REPLACE FUNCTION public.organization_members_repoint_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.approved_users
     SET organization_id = NULL,
         organization    = 'default_org'
   WHERE id = OLD.user_id AND organization_id = OLD.org_id;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.organization_members_repoint_active() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_organization_members_repoint_active ON public.organization_members;
CREATE TRIGGER trg_organization_members_repoint_active
  AFTER DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.organization_members_repoint_active();

-- ── 3 · sign-in: an ended ACTIVE organization is not the end when another is current
-- Same signature and body as `20260929000004`, plus the switch (header §2b).
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id       uuid;
  v_name     text;
  v_role     text;
  v_active   boolean;
  v_until    timestamptz;
  v_current  boolean;
  v_known    uuid;
  v_switched uuid;
BEGIN
  SELECT au.id, au.name, au.role::text, au.is_active, o.access_valid_until
    INTO v_id, v_name, v_role, v_active, v_until
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE lower(au.email) = lower(user_email)
     AND au.password_hash = extensions.crypt(user_password, au.password_hash)
   LIMIT 1;

  -- A super admin is not locked out by their organization's period (`20260929000004` §3).
  v_current := v_until IS NULL OR v_until > now() OR v_role = 'super_admin';

  -- The active organization's period ended: another membership may still be current.
  IF v_id IS NOT NULL AND v_active AND NOT v_current THEN
    SELECT m.org_id INTO v_switched
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = v_id
       AND (o.access_valid_until IS NULL OR o.access_valid_until > now())
     ORDER BY m.joined_at, m.org_id
     LIMIT 1;
    IF v_switched IS NOT NULL THEN
      -- The account is the actor of its own switch (`audit-actor`), LOCAL to this call.
      PERFORM set_config('app.current_user_id', v_id::text, true);
      UPDATE public.approved_users SET organization_id = v_switched WHERE id = v_id;
      v_current := true;
    END IF;
  END IF;

  BEGIN
    IF v_id IS NOT NULL AND v_active AND v_current THEN
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in'
                        AND actor_user_id = v_id
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', v_id, 'auth.sign_in', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'allowed')
                || CASE WHEN v_switched IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('switched_to_organization', v_switched,
                                                'reason', 'active organization access period ended') END);
      END IF;
    ELSIF v_id IS NOT NULL THEN
      -- The right password on a suspended account, or one none of whose organizations
      -- is within its period. Refused, and said so on the record; the account is the TARGET.
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

-- ── 4 · the account's own verbs ─────────────────────────────────────────────

-- The account's organizations. `is_current` marks the active one; `access_expired` is
-- FOR THIS ACCOUNT (a super admin is exempt, as in `get_my_profile`).
CREATE OR REPLACE FUNCTION public.list_my_organizations(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  org_id uuid,
  name text,
  slug text,
  status text,
  org_role text,
  is_current boolean,
  joined_at timestamptz,
  access_period text,
  access_valid_until timestamptz,
  access_expired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.status, m.org_role,
         (o.id = au.organization_id),
         m.joined_at,
         o.access_period, o.access_valid_until,
         COALESCE(o.access_valid_until <= now(), false) AND au.role <> 'super_admin'::public.app_role
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.approved_users au ON au.id = m.user_id
   WHERE m.user_id = v_uid
   ORDER BY lower(o.name), o.id;
END;
$$;
COMMENT ON FUNCTION public.list_my_organizations(uuid) IS
  'D210 — the organizations the signed-in account belongs to, its role in each, which one '
  'is active (is_current), and whether each one''s access period has ended for this account. '
  'The user is a parameter because the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.list_my_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_organizations(uuid) TO anon, authenticated;

-- Change the active organization. Returns its name.
CREATE OR REPLACE FUNCTION public.switch_my_organization(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := public.account_self_resolve(p_user_id);
  v_role   text;
  v_active boolean;
  v_before uuid;
  v_org    public.organizations%ROWTYPE;
BEGIN
  SELECT au.role::text, au.is_active, au.organization_id INTO v_role, v_active, v_before
    FROM public.approved_users au WHERE au.id = v_uid;
  IF NOT v_active THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.* INTO v_org
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.org_id
   WHERE m.user_id = v_uid AND m.org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: this account does not belong to that organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_org.access_valid_until IS NOT NULL AND v_org.access_valid_until <= now()
     AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'org_access_ended: the access period for % ended on % — an administrator must renew it before it can be used',
      v_org.name, to_char(v_org.access_valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_before IS DISTINCT FROM p_org_id THEN
    UPDATE public.approved_users SET organization_id = p_org_id, updated_at = now() WHERE id = v_uid;

    BEGIN
      INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, before, after)
      VALUES ('access', v_uid, 'org.switch', 'approved_users', v_uid::text,
              jsonb_build_object('organization_id', v_before),
              jsonb_build_object('organization_id', p_org_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'organization-switch audit skipped: %', SQLERRM;   -- never fail the switch over it
    END;
  END IF;

  RETURN v_org.name;
END;
$$;
COMMENT ON FUNCTION public.switch_my_organization(uuid, uuid) IS
  'D210 — makes one of the signed-in account''s organizations its ACTIVE one (what RLS and '
  'new projects use). Refuses an organization the account does not belong to, and one whose '
  'access period has ended (super admins exempt). Recorded as access-plane org.switch.';
REVOKE ALL ON FUNCTION public.switch_my_organization(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_my_organization(uuid, uuid) TO anon, authenticated;

-- ── 5 · the administrator's verbs ──────────────────────────────────────────

-- Add an account to an organization. `p_org_role` NULL = the backfill's mapping (an app
-- `admin` is an org `admin`, everyone else a `member`). The user limit applies.
CREATE OR REPLACE FUNCTION public.admin_add_org_member(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_org_id uuid,
  p_org_role text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_org_role text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF p_org_role IS NOT NULL AND p_org_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'invalid organization role %', p_org_role;
  END IF;
  SELECT role::text INTO v_role FROM public.approved_users WHERE id = p_target_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members
              WHERE org_id = p_org_id AND user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'already_a_member: the account already belongs to that organization';
  END IF;

  v_org_role := COALESCE(p_org_role, CASE WHEN v_role = 'admin' THEN 'admin' ELSE 'member' END);
  INSERT INTO public.organization_members (org_id, user_id, org_role)
  VALUES (p_org_id, p_target_user_id, v_org_role);

  PERFORM public.log_admin_action('org.member_add', 'organization_members', p_target_user_id::text, NULL,
    jsonb_build_object('org_id', p_org_id, 'org_role', v_org_role));
END; $$;
COMMENT ON FUNCTION public.admin_add_org_member(uuid, text, uuid, uuid, text) IS
  'D210 — a super admin adds an account to an organization (it may already belong to others). '
  'The organization''s user limit applies. An account with no active organization is switched to it.';
REVOKE ALL ON FUNCTION public.admin_add_org_member(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_org_member(uuid, text, uuid, uuid, text) TO anon, authenticated;

-- Remove an account from an organization. When it was the active one, the account moves
-- to its earliest remaining membership, or to none.
CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  SELECT to_jsonb(m) INTO v_before FROM public.organization_members m
   WHERE m.org_id = p_org_id AND m.user_id = p_target_user_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'not_a_member: the account does not belong to that organization';
  END IF;

  DELETE FROM public.organization_members WHERE org_id = p_org_id AND user_id = p_target_user_id;

  PERFORM public.log_admin_action('org.member_remove', 'organization_members', p_target_user_id::text, v_before,
    jsonb_build_object('organization_id',
      (SELECT organization_id FROM public.approved_users WHERE id = p_target_user_id)));
END; $$;
COMMENT ON FUNCTION public.admin_remove_org_member(uuid, text, uuid, uuid) IS
  'D210 — a super admin removes an account from one organization. If it was the account''s '
  'active organization, the account moves to its earliest remaining membership, or none.';
REVOKE ALL ON FUNCTION public.admin_remove_org_member(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_org_member(uuid, text, uuid, uuid) TO anon, authenticated;

-- ── 6 · the reads ───────────────────────────────────────────────────────────

-- /admin/users — `20260929000002`'s columns, plus every membership. `organization_id` /
-- `organization` are the ACTIVE organization. A changed column list is a DROP and CREATE.
DROP FUNCTION IF EXISTS public.admin_list_users(uuid, text);

CREATE FUNCTION public.admin_list_users(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  user_id uuid, name text, email text, role text, is_active boolean,
  organization_id uuid, organization text, organization_status text, org_role text,
  mtd_requests bigint, mtd_tokens bigint, mtd_cost_usd numeric,
  monthly_budget_usd numeric, created_at timestamptz,
  memberships jsonb)
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
         au.created_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'org_id', mo.id, 'name', mo.name, 'status', mo.status,
                             'org_role', mm.org_role, 'is_current', mo.id = au.organization_id)
                           ORDER BY lower(mo.name), mo.id)
                     FROM public.organization_members mm
                     JOIN public.organizations mo ON mo.id = mm.org_id
                    WHERE mm.user_id = au.id), '[]'::jsonb)
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
  'D205, D210 — /admin/users''s read. The reader is a parameter and must be an active super '
  'admin. organization_id / organization are the ACTIVE organization, resolved through the '
  'uuid; memberships lists every organization the account belongs to, with its role.';
REVOKE ALL ON FUNCTION public.admin_list_users(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users(uuid, text) TO anon, authenticated, service_role;

-- /admin/organizations — `20260929000004`'s columns; `members` now counts memberships
-- (the count the user limit is measured by), and `members_only_here` counts the accounts
-- that belong to no other organization — the ones a delete would remove (D208).
DROP FUNCTION IF EXISTS public.admin_list_organizations(uuid, text);

CREATE FUNCTION public.admin_list_organizations(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, name text, slug text, status text, created_at timestamptz,
  members bigint, projects bigint, cost_mtd numeric,
  access_period text, access_valid_from timestamptz, access_valid_until timestamptz,
  access_expired boolean, project_limit integer, user_limit integer,
  members_only_here bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.status, o.created_at,
         (SELECT count(*) FROM public.organization_members m WHERE m.org_id = o.id),
         (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id),
         COALESCE((SELECT sum(l.cost_usd) FROM public.ai_usage_logs l
                    WHERE l.org_id = o.id
                      AND l.created_at >= date_trunc('month', now())), 0),
         o.access_period, o.access_valid_from, o.access_valid_until,
         COALESCE(o.access_valid_until <= now(), false),
         o.project_limit, o.user_limit,
         (SELECT count(*) FROM public.organization_members m
           WHERE m.org_id = o.id
             AND NOT EXISTS (SELECT 1 FROM public.organization_members x
                              WHERE x.user_id = m.user_id AND x.org_id <> o.id))
  FROM public.organizations o
  ORDER BY o.name;
END; $$;
COMMENT ON FUNCTION public.admin_list_organizations(uuid, text) IS
  'D205, D207, D210 — /admin/organizations''s read. members counts memberships (what the '
  'user limit is measured by; an account may belong to several organizations), '
  'members_only_here the accounts that belong to no other (what a delete removes); '
  'projects are counted by uuid; the access period''s expiry is on the server clock.';
REVOKE ALL ON FUNCTION public.admin_list_organizations(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organizations(uuid, text) TO anon, authenticated;

-- The account's own read — `20260930000003`'s columns unchanged; the organization is
-- the ACTIVE one, named through its uuid, and `users_used` counts its memberships.
CREATE OR REPLACE FUNCTION public.get_my_profile(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  first_name text,
  last_name text,
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
  SELECT au.id, au.email, au.name, au.first_name, au.last_name,
         au.display_name, au.phone, au.avatar_color,
         au.role::text, COALESCE(o.name, au.organization), au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at,
         (au.password_expires_at <= now()),
         extract(day FROM public.password_max_age())::integer,
         o.access_period, o.access_valid_from, o.access_valid_until,
         -- Expired FOR THIS ACCOUNT: the ACTIVE organization's period ended and the
         -- account is not a super admin (`20260929000004` header §3).
         COALESCE(o.access_valid_until <= now(), false) AND au.role <> 'super_admin'::public.app_role,
         au.role = 'super_admin'::public.app_role,
         o.project_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id) END,
         o.user_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.organization_members m WHERE m.org_id = o.id) END
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE au.id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.get_my_profile(uuid) IS
  'D206, D207, D209, D210 — the signed-in user''s own account row: their name whole and as '
  'first/last parts (read-only, D209), password_expired computed on the server clock, the '
  'password policy''s max age in days, and the plan of the account''s ACTIVE organization '
  '(named through its uuid): its access period and end, whether it has ended for this '
  'account (access_expired; a super admin is exempt, access_exempt), and its project and '
  'user limits with the counts they are measured by (users = memberships, D210). The user '
  'is a parameter because the browser calls as anon (D155); a contradicting session is refused.';

-- ── 7 · deleting an organization detaches the accounts that belong elsewhere ──
-- Same signature as `20260930000002`; header §2c for what changed.
CREATE OR REPLACE FUNCTION public.admin_delete_organization(
  p_actor_id     uuid,
  p_actor_email  text,
  p_org_id       uuid,
  p_confirm_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      public.organizations%ROWTYPE;
  v_users    uuid[];
  v_detached uuid[];
  v_projects uuid[];
  v_pid      uuid;
  v_blocker  text;
  v_before   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  -- Said again in this body: `_assert_super_admin` sets it, but the attribution scan
  -- in `dataPlaneAudit.test.ts` reads text and cannot follow a call.
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_confirm_slug IS DISTINCT FROM v_org.slug THEN
    RAISE EXCEPTION 'confirmation does not match: type the slug "%" to delete this organization', v_org.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = p_actor_id AND org_id = p_org_id)
     OR EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_actor_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'you cannot delete your own organization (you belong to it — remove yourself from it first)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every account in it, locked so none can be moved in or out while this runs.
  PERFORM 1 FROM public.approved_users au
   WHERE au.organization_id = p_org_id
      OR EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = au.id AND m.org_id = p_org_id)
   ORDER BY au.id FOR UPDATE;

  -- Deleted: the accounts that belong to NO other organization. Detached: the rest.
  SELECT COALESCE(array_agg(au.id ORDER BY au.id) FILTER (WHERE NOT elsewhere), '{}'),
         COALESCE(array_agg(au.id ORDER BY au.id) FILTER (WHERE elsewhere), '{}')
    INTO v_users, v_detached
    FROM (SELECT au.id,
                 EXISTS (SELECT 1 FROM public.organization_members x
                          WHERE x.user_id = au.id AND x.org_id <> p_org_id) AS elsewhere
            FROM public.approved_users au
           WHERE au.organization_id = p_org_id
              OR EXISTS (SELECT 1 FROM public.organization_members m
                          WHERE m.user_id = au.id AND m.org_id = p_org_id)) au;

  SELECT string_agg(email, ', ' ORDER BY email) INTO v_blocker
    FROM public.approved_users
   WHERE id = ANY (v_users) AND role = 'super_admin'::public.app_role;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'this organization holds super admin account(s) (%): move them to another organization or change their role first', v_blocker
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_projects
    FROM public.projects
   WHERE organization_id = p_org_id
      OR (organization_id IS NULL AND modeler_id = ANY (v_users));

  -- An account recorded as the actor on a row that is NOT being deleted cannot be
  -- deleted either (no foreign key there lets go; `ingest_files` is D161).
  SELECT string_agg(DISTINCT au.email, ', ') INTO v_blocker
    FROM public.approved_users au
   WHERE au.id = ANY (v_users)
     AND (   EXISTS (SELECT 1 FROM public.analysis_runs r
                      WHERE r.actor_user_id = au.id AND NOT (r.project_id = ANY (v_projects)))
          OR EXISTS (SELECT 1 FROM public.supply_chain_data s
                      WHERE s.uploaded_by = au.id AND NOT (s.project_id = ANY (v_projects)))
          OR EXISTS (SELECT 1 FROM public.ingest_files f JOIN public.ingest_runs ir ON ir.id = f.ingest_run_id
                      WHERE f.uploaded_by = au.id AND NOT (ir.project_id = ANY (v_projects))));
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'account(s) % recorded work in a project outside this organization, so they cannot be deleted with it: move them to that organization first', v_blocker
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_before := to_jsonb(v_org) || jsonb_build_object(
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'role', u.role) ORDER BY u.email)
                         FROM public.approved_users u WHERE u.id = ANY (v_users)), '[]'::jsonb),
    'detached', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email) ORDER BY u.email)
                            FROM public.approved_users u WHERE u.id = ANY (v_detached)), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
                            FROM public.projects p WHERE p.id = ANY (v_projects)), '[]'::jsonb));

  -- Projects first: each through THE sweep, so a project leaves exactly as D170 says.
  FOREACH v_pid IN ARRAY v_projects LOOP
    PERFORM public._delete_project_rows(v_pid, p_actor_id, p_actor_email);
  END LOOP;

  DELETE FROM public.ai_budgets
   WHERE (scope = 'org'     AND scope_id = p_org_id)
      OR (scope = 'user'    AND scope_id = ANY (v_users))
      OR (scope = 'project' AND scope_id = ANY (v_projects));

  -- The memberships go BEFORE the organization, so each detached account re-points to
  -- its next organization through `trg_organization_members_repoint_active` rather than
  -- through the `ON DELETE SET NULL`, which cannot refresh the text copy.
  DELETE FROM public.organization_members WHERE org_id = p_org_id;
  DELETE FROM public.approved_users WHERE id = ANY (v_users);
  DELETE FROM public.organizations  WHERE id = p_org_id;

  PERFORM public.log_admin_action('org.delete', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('deleted', true,
                       'projects', cardinality(v_projects),
                       'users', cardinality(v_users),
                       'detached', cardinality(v_detached)));

  RETURN jsonb_build_object(
    'organization', v_org.name,
    'projects', cardinality(v_projects),
    'users', cardinality(v_users),
    'detached', cardinality(v_detached));
END;
$$;

COMMENT ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) IS
  'D208, D210 — PERMANENTLY deletes an organization, its projects (each through '
  '_delete_project_rows) and the user accounts that belong to no other organization, in one '
  'transaction; accounts that also belong elsewhere are detached (they lose this membership '
  'and keep the others). Active super admin only; the organization''s slug must be passed '
  'back as confirmation. Refuses an organization the actor belongs to, one whose deletion '
  'would delete a super admin, and accounts recorded as the actor on rows outside the '
  'deleted projects. Suspension (admin_set_org_status) is the reversible verb.';

REVOKE ALL ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization(uuid, text, uuid, text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
