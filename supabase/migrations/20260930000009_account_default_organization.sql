-- Organizations / §4 D216 — an account's DEFAULT organization: where it signs in, every
-- time, however often it switches in between.
--
-- D210 gave an account several organizations and ONE active one
-- (`approved_users.organization_id`, what RLS reads). The active organization is the
-- account's own choice and it is sticky: a switch is kept until the next switch, so an
-- account that switched to a client's organization on Friday signs in there on Monday.
-- /admin/users labelled that active organization "Default organization" and the
-- memberships dialog said "the one it switches to becomes its default" — so the one
-- thing an administrator could not say was which organization an account BELONGS to
-- first. The owner, of `phu.nguyen@hwr-berlin.de` (a member of ACCURATE-Aumovio,
-- ACCURATE-AA, ACCURATE-TRON and HWR, shown as "default" ACCURATE-Aumovio): "the default
-- organization must be HWR — he could move around and around but the only single and
-- always default access is HWR".
--
-- ── 1 · THE MODEL ───────────────────────────────────────────────────────────
--
--   `organization_members.is_default` — the account's DEFAULT organization: at most one
--                                       per account (a partial unique index), always one
--                                       of its memberships because it IS a membership row.
--                                       Set by a super admin only (`admin_set_default_org`).
--   `approved_users.organization_id`  — still the ACTIVE organization, still what RLS reads.
--                                       Unchanged in meaning; D210's invariant stands.
--
-- The default is a PROPERTY OF A MEMBERSHIP rather than a second uuid on `approved_users`
-- so that "the default is one of the account's organizations" is structural: removing the
-- membership removes the default with it, and no trigger has to keep a second column in
-- step with `organization_members` (the D205 lesson — two authors of one fact).
--
-- What the default DOES:
--   (a) Sign-in lands in it. `authenticate_approved_user` makes the default the active
--       organization when it is not already, provided its access period has not ended
--       (a super admin is exempt, as everywhere since `20260929000004`). Recorded on the
--       `auth.sign_in` row as `switched_to_organization` with reason `default organization`.
--       Between sign-ins the account switches freely (`switch_my_organization` is unchanged).
--   (b) When the active organization goes away (its membership removed, the organization
--       deleted) the account re-points to its DEFAULT, and only when it has none to the
--       earliest remaining membership (D210's rule).
--   (c) When the active organization's period has ended at sign-in, the default is tried
--       first by (a); only when the default is ended too does D210's earliest-current
--       fallback apply.
--
-- An account with NO default behaves exactly as before this migration: it signs in to
-- the organization it last worked in. No default is assigned to anyone implicitly — a
-- guess would be the D13 mistake — except the one the owner named (§5).
--
-- ── 2 · WHAT IS NOT ─────────────────────────────────────────────────────────
--
-- The account cannot change its own default: the owner's words are "the only single and
-- always default", which is an administrator's statement about the account, not the
-- account's preference. The session (localStorage) outlives a switch: a page reload does
-- not sign in again, so the default applies at the next SIGN-IN, not the next page load.
-- `admin_set_default_org` does not move the active organization — it would change what an
-- account already signed in sees mid-session, under it.

-- ── 1 · the column, at most one per account ─────────────────────────────────
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS organization_members_one_default_per_user
  ON public.organization_members (user_id) WHERE is_default;

COMMENT ON COLUMN public.organization_members.is_default IS
  'D216 — this membership is the account''s DEFAULT organization: where it signs in, every '
  'time (authenticate_approved_user), and where it re-points when its active organization '
  'goes away. At most one per account (organization_members_one_default_per_user). Set by a '
  'super admin through admin_set_default_org; the account switches freely in between.';

-- ── 2 · re-pointing prefers the default ─────────────────────────────────────
-- `20260930000004`'s body with one change: the ORDER BY reads `is_default` first (§1b).
CREATE OR REPLACE FUNCTION public.approved_users_track_active_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.organization_id IS NULL AND TG_OP = 'UPDATE' THEN
    -- NULL while memberships remain: the DEFAULT one, else the earliest, whose
    -- organization still exists (an `ON DELETE SET NULL` from `organizations` runs after
    -- the row is gone).
    SELECT m.org_id INTO NEW.organization_id
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = NEW.id
     ORDER BY m.is_default DESC, m.joined_at, m.org_id
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
  'D210, D216 — keeps approved_users.organization_id (the ACTIVE organization) one of the '
  'account''s memberships: a NULL written while memberships remain re-points to the '
  'account''s DEFAULT organization, else the earliest one, and the organization text copy '
  'follows the active organization''s name.';

-- ── 3 · sign-in lands in the default ────────────────────────────────────────
-- `20260930000004`'s body; header §1a and §1c for what changed.
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
  v_org      uuid;
  v_until    timestamptz;
  v_current  boolean;
  v_known    uuid;
  v_switched uuid;
  v_reason   text;
BEGIN
  SELECT au.id, au.name, au.role::text, au.is_active, au.organization_id, o.access_valid_until
    INTO v_id, v_name, v_role, v_active, v_org, v_until
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE lower(au.email) = lower(user_email)
     AND au.password_hash = extensions.crypt(user_password, au.password_hash)
   LIMIT 1;

  -- A super admin is not locked out by their organization's period (`20260929000004` §3).
  v_current := v_until IS NULL OR v_until > now() OR v_role = 'super_admin';

  IF v_id IS NOT NULL AND v_active THEN
    -- D216 — the DEFAULT organization, when it is not the active one and is within its
    -- period (a super admin is exempt): every sign-in lands there.
    SELECT m.org_id INTO v_switched
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = v_id
       AND m.is_default
       AND m.org_id IS DISTINCT FROM v_org
       AND (o.access_valid_until IS NULL OR o.access_valid_until > now() OR v_role = 'super_admin');
    IF v_switched IS NOT NULL THEN
      v_reason := 'default organization';
    ELSIF NOT v_current THEN
      -- D210 — the active organization's period ended and the default cannot take its
      -- place: another membership may still be current.
      SELECT m.org_id INTO v_switched
        FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.org_id
       WHERE m.user_id = v_id
         AND (o.access_valid_until IS NULL OR o.access_valid_until > now())
       ORDER BY m.joined_at, m.org_id
       LIMIT 1;
      v_reason := 'active organization access period ended';
    END IF;

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
                                                'reason', v_reason) END);
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

-- ── 4 · the administrator's verb ────────────────────────────────────────────
-- Make one of the account's organizations its default, or (`p_org_id` NULL) clear it.
-- Does not move the active organization (header §2).
CREATE OR REPLACE FUNCTION public.admin_set_default_org(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before uuid;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  IF p_org_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.organization_members
        WHERE org_id = p_org_id AND user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'not_a_member: the default organization must be one the account belongs to — add it first'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT org_id INTO v_before FROM public.organization_members
   WHERE user_id = p_target_user_id AND is_default;
  IF v_before IS NOT DISTINCT FROM p_org_id THEN
    RETURN;
  END IF;

  -- Clear first: the partial unique index admits one default per account at any moment.
  UPDATE public.organization_members SET is_default = false
   WHERE user_id = p_target_user_id AND is_default;
  IF p_org_id IS NOT NULL THEN
    UPDATE public.organization_members SET is_default = true
     WHERE user_id = p_target_user_id AND org_id = p_org_id;
  END IF;

  PERFORM public.log_admin_action('org.default_set', 'approved_users', p_target_user_id::text,
    jsonb_build_object('default_org_id', v_before),
    jsonb_build_object('default_org_id', p_org_id));
END; $$;
COMMENT ON FUNCTION public.admin_set_default_org(uuid, text, uuid, uuid) IS
  'D216 — a super admin makes one of an account''s organizations its DEFAULT (where every '
  'sign-in lands), or clears it with a NULL organization. Refuses an organization the account '
  'does not belong to. Does not move the active organization. Logged as org.default_set.';
REVOKE ALL ON FUNCTION public.admin_set_default_org(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_default_org(uuid, text, uuid, uuid) TO anon, authenticated;

-- ── 5 · the reads say which one is the default ──────────────────────────────

-- The account's own list — `20260930000004`'s columns plus `is_default`. A changed column
-- list is a DROP and CREATE, which takes the grants with it; they are restated.
DROP FUNCTION IF EXISTS public.list_my_organizations(uuid);

CREATE FUNCTION public.list_my_organizations(p_user_id uuid DEFAULT NULL)
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
  access_expired boolean,
  is_default boolean
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
         COALESCE(o.access_valid_until <= now(), false) AND au.role <> 'super_admin'::public.app_role,
         m.is_default
    FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.approved_users au ON au.id = m.user_id
   WHERE m.user_id = v_uid
   ORDER BY lower(o.name), o.id;
END;
$$;
COMMENT ON FUNCTION public.list_my_organizations(uuid) IS
  'D210, D216 — the organizations the signed-in account belongs to, its role in each, which one '
  'is active (is_current), which one is its default (is_default — where it signs in), and '
  'whether each one''s access period has ended for this account. The user is a parameter '
  'because the browser calls as anon (D155).';
REVOKE ALL ON FUNCTION public.list_my_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_organizations(uuid) TO anon, authenticated;

-- /admin/users — `20260930000004`'s body; each membership gains `is_default`.
CREATE OR REPLACE FUNCTION public.admin_list_users(p_actor_id uuid, p_actor_email text)
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
                             'org_role', mm.org_role, 'is_current', mo.id = au.organization_id,
                             'is_default', mm.is_default)
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
  'D205, D210, D216 — /admin/users''s read. The reader is a parameter and must be an active '
  'super admin. organization_id / organization are the ACTIVE organization, resolved through '
  'the uuid; memberships lists every organization the account belongs to, with its role, '
  'which is active (is_current) and which is the default (is_default).';

-- /admin/users/:userId — `20260930000005`'s body; each organization gains `is_default`,
-- and the account's `default_organization_id` is returned beside the active one.
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
    'default_organization_id', v_default,
    'organizations', v_orgs,
    'projects', v_projects,
    'project_capabilities', v_keys,
    'role_matrix', v_matrix);
END; $$;
COMMENT ON FUNCTION public.admin_get_user_memberships(uuid, text, uuid) IS
  'D211, D216 — /admin/users/:userId''s organization and project read. Active super admin only. '
  'Every organization (which is active, which is the default) and, per project, where access '
  'comes from (active organization, another organization, ownership, membership, delegation), '
  'the effective project role and the resolver''s project capabilities.';

-- ── 6 · the owner's instruction of 2026-09-30: phu.nguyen@hwr-berlin.de → HWR ────
-- Resolved by NAME because the organization was created after the last §15 read and its
-- uuid is known to nobody writing this file. Refuses to guess (D13): the organization is
-- the ONE whose name or slug is `HWR` (case and surrounding blanks ignored); none or
-- several leaves the account without a default, and says so. The account is added to it
-- if it is not already a member (the owner lists HWR among its organizations). The active
-- organization is not moved (header §2): the next sign-in lands in HWR.
-- The outcome is written to `audit_logs`, because a migration's notices reach nobody (D152).
-- A database without the account — the rehearsal schema, a fresh project — does nothing.
DO $default216$
DECLARE
  v_user uuid;
  v_org  uuid;
  v_n    integer;
BEGIN
  SELECT au.id INTO v_user FROM public.approved_users au
   WHERE lower(au.email) = 'phu.nguyen@hwr-berlin.de';
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*), (array_agg(o.id))[1] INTO v_n, v_org
    FROM public.organizations o
   WHERE lower(btrim(o.name)) = 'hwr' OR lower(btrim(o.slug)) = 'hwr';

  IF v_n <> 1 THEN
    INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
    VALUES ('admin', NULL, 'org.default_unresolved', 'approved_users', v_user::text,
            jsonb_build_object('wanted', 'HWR', 'organizations_matching', v_n,
                               'source', 'migration 20260930000009 (D216)'));
    RAISE WARNING 'D216: % organizations are named HWR — no default set for phu.nguyen@hwr-berlin.de', v_n;
    RETURN;
  END IF;

  -- A new membership takes a seat (D207), and a full organization refuses it. That is
  -- recorded, not raised: failing the deploy would hold back every migration after this.
  BEGIN
    INSERT INTO public.organization_members (org_id, user_id, org_role)
    SELECT v_org, v_user, CASE WHEN au.role = 'admin'::public.app_role THEN 'admin' ELSE 'member' END
      FROM public.approved_users au WHERE au.id = v_user
    ON CONFLICT (org_id, user_id) DO NOTHING;
  EXCEPTION WHEN check_violation THEN
    INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
    VALUES ('admin', NULL, 'org.default_unresolved', 'approved_users', v_user::text,
            jsonb_build_object('wanted', 'HWR', 'org_id', v_org, 'refused', SQLERRM,
                               'source', 'migration 20260930000009 (D216)'));
    RAISE WARNING 'D216: phu.nguyen@hwr-berlin.de could not be added to HWR: %', SQLERRM;
    RETURN;
  END;

  UPDATE public.organization_members SET is_default = false
   WHERE user_id = v_user AND is_default AND org_id <> v_org;
  UPDATE public.organization_members SET is_default = true
   WHERE user_id = v_user AND org_id = v_org;

  INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
  VALUES ('admin', NULL, 'org.default_set', 'approved_users', v_user::text,
          jsonb_build_object('default_org_id', v_org,
                             'source', 'migration 20260930000009 (D216): the owner''s instruction of 2026-09-30'));
END;
$default216$;
