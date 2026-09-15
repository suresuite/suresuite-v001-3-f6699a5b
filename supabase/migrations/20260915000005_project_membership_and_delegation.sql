-- Phase 2 / WP 2.2 / PLAN.md §9 — PROJECT MEMBERSHIP AND THE RESOLVER (D14).
--
-- Access in this platform has had exactly two levels: your global `app_role`, and
-- which organization you are in. There is nothing in between, so "let Dana read
-- this one project" has never been expressible — the only way to grant it is to
-- put Dana in the organization, which grants every project in it. That is D14,
-- and it is why `subtractive-delegation` (§2.1 G3) has had nowhere to attach.
--
-- WHAT THIS ADDS
--   · `project_members`            — who is on a project, and as what
--   · `project_role_capabilities`  — what each project role may do
--   · `delegation_grants`          — temporary, subtractive, expiring grants
--   · `effective_project_role()`   — the two resolved into one answer
--   · `capabilities_for_user(_user_id, _project_id)` — the resolver, extended
--
-- THE RESOLVER'S SIGNATURE PROPERTY IS PRESERVED, DELIBERATELY. The existing
-- `capabilities_for_user(_user_id)` takes its user EXPLICITLY rather than reading
-- `current_setting('app.current_user_id')`, which is the one thing in this access
-- layer that survives PostgREST connection pooling under the app's custom auth.
-- The project-aware version is an OVERLOAD, not a replacement: the one-argument
-- form keeps working unchanged for every existing caller, and the two-argument
-- form takes BOTH ids explicitly. Neither reads a GUC.
--
-- D28 DECIDED THE ENFORCEMENT POINT. Every policy in this schema is PERMISSIVE and
-- Postgres ORs permissive policies, so a "deny" policy added beside an "allow"
-- policy does not deny — the `approved_users` pair is the proof. Subtraction
-- therefore CANNOT be expressed as a policy here. It is enforced inside
-- `grant_project_delegation()`, which is where PLAN.md §9 says to put it, and the
-- RPC is the only granted path: the table's own INSERT/UPDATE/DELETE are left with
-- no policy at all, so RLS denies them by default rather than by a policy that
-- would not. This migration introduces no RESTRICTIVE policy; doing that across
-- the schema is WP 2.4's decision to take once, not this package's to take twice.

-- ── 0. preflight ─────────────────────────────────────────────────────────────
-- WP 2.1 learned this the expensive way (D31): a migration's first execution is
-- the production deploy, and `db push` reports only the FIRST statement that
-- fails. Naming every missing table up front costs one deploy instead of one per
-- table. It RAISEs rather than NOTICEs because the CLI's log keeps errors and
-- drops notices.
DO $preflight$
DECLARE missing text[];
BEGIN
  SELECT array_agg(t ORDER BY t) INTO missing
    FROM unnest(ARRAY['approved_users','organizations','projects',
                      'capabilities','role_capabilities','org_capabilities',
                      'user_capabilities']) t
   WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'this database is missing % table(s) that WP 2.2 needs: %. '
                    'See D32 and PLAN.md §16 — adopt them verbatim from their '
                    'original migration before this one can run.',
                    array_length(missing, 1), missing;
  END IF;
END
$preflight$;

-- ── 1. the project_role vocabulary ───────────────────────────────────────────
-- FOUR levels, ordered. This is a PROJECT vocabulary and it is NOT
-- `organization_members.org_role` (owner|admin|member), which is an ORG
-- vocabulary. They share the word "owner" and mean different things by it;
-- overloading one for the other is how a project grant would silently become an
-- organization grant.
--
-- The thirteen sidecars authored in WP 1.2 already declare `min_project_role`
-- against exactly these four names, and WP 2.1 added four more. This table is
-- made to match what they forward-declared, not the other way round.

CREATE OR REPLACE FUNCTION public.project_role_rank(_project_role text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _project_role
    WHEN 'viewer'  THEN 1
    WHEN 'analyst' THEN 2
    WHEN 'editor'  THEN 3
    WHEN 'owner'   THEN 4
    ELSE 0                      -- unknown or NULL ranks below every real role
  END;
$$;
COMMENT ON FUNCTION public.project_role_rank(text) IS
  'Total order on project_role. The ONE place the ordering is written: '
  'delegation subtraction and capability gating both read it, so "is this grant '
  'bigger than mine" cannot be answered two different ways (§2.1 single-source).';

-- ── 2. project_members ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_members (
  project_id   uuid NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  project_role text NOT NULL CHECK (project_role IN ('owner','editor','analyst','viewer')),
  granted_by   uuid          REFERENCES public.approved_users(id) ON DELETE SET NULL,
  expires_at   timestamptz,
  rationale    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
COMMENT ON TABLE public.project_members IS
  'One person''s standing on one project. The PK is the natural key (§2.1 I4): a '
  'person is on a project once, and re-granting is an UPSERT rather than a second '
  'row that silently wins by insertion order.';

GRANT SELECT ON public.project_members TO authenticated, anon;
GRANT ALL    ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- Read your own membership, and any membership on a project you are on. There is
-- deliberately NO INSERT/UPDATE/DELETE policy: writes go through the RPCs below,
-- and with no policy RLS denies them outright. A deny-all policy here would be
-- PERMISSIVE and would therefore deny nothing (D28) — the absence of a policy is
-- the enforcement, and it is stated here so the next reader does not "fix" it.
DROP POLICY IF EXISTS "project_members: read own and co-members" ON public.project_members;
CREATE POLICY "project_members: read own and co-members" ON public.project_members
  FOR SELECT USING (
    user_id = public.get_current_user_id()
    OR EXISTS (SELECT 1 FROM public.project_members m
                WHERE m.project_id = project_members.project_id
                  AND m.user_id = public.get_current_user_id())
    OR public.current_is_super_admin()
  );

-- Backfill: every project's modeler becomes its owner. `modeler_id` has been the
-- de-facto project owner all along — every write policy in the schema reads it —
-- so this records a fact that already held rather than granting anything new.
INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
SELECT p.id, p.modeler_id, 'owner',
       'backfilled from projects.modeler_id by WP 2.2 — the de-facto owner'
  FROM public.projects p
 WHERE p.modeler_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = p.modeler_id)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── 3. project_role_capabilities ─────────────────────────────────────────────
-- The project layer of the resolver, shaped exactly like `role_capabilities` so
-- the four layers read the same way.

CREATE TABLE IF NOT EXISTS public.project_role_capabilities (
  project_role   text NOT NULL CHECK (project_role IN ('owner','editor','analyst','viewer')),
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE CASCADE,
  allowed        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_role, capability_key)
);
GRANT SELECT ON public.project_role_capabilities TO authenticated, anon;
GRANT ALL    ON public.project_role_capabilities TO service_role;
ALTER TABLE public.project_role_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "project_role_capabilities: read all" ON public.project_role_capabilities;
CREATE POLICY "project_role_capabilities: read all" ON public.project_role_capabilities
  FOR SELECT USING (true);

-- ── 4. split `data_editing` (§9) ─────────────────────────────────────────────
-- ONE flag has governed editing both tier-2 inputs (item master, BOM, logistics)
-- and tier-4 decisions (policies, overrides, scenarios). An analyst who may retune
-- a policy must currently also be handed the right to rewrite the measured data
-- the policy is evaluated against, which is what makes "analyst" mean nothing.
--
-- BOTH NEW KEYS ARE ADDED AND `data_editing` IS KEPT. Same dual-read discipline as
-- WP 2.1's org identity: the new grants are seeded FROM the old flag so nobody's
-- access changes on deploy, every call site migrates to a new key in its own
-- change, and `data_editing` is removed only once none reads it. Removing it here
-- would revoke editing from every caller that still asks for it — eight of them.

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('data_edit_inputs',   'feature', 'Edit Input Data',
   'Create and edit tier-2 project data — item master, BOM, logistics lanes', 241),
  ('data_edit_policies', 'feature', 'Edit Policies',
   'Create and edit tier-4 decisions — policies, overrides and scenarios',    242)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- Seed each new key from `data_editing` at every existing layer, so effective
-- access on the day of deploy is identical to the day before.
INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT rc.role, k.key, rc.allowed
  FROM public.role_capabilities rc
  CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies')) AS k(key)
 WHERE rc.capability_key = 'data_editing'
ON CONFLICT (role, capability_key) DO NOTHING;

INSERT INTO public.org_capabilities (org_id, capability_key, allowed)
SELECT oc.org_id, k.key, oc.allowed
  FROM public.org_capabilities oc
  CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies')) AS k(key)
 WHERE oc.capability_key = 'data_editing'
ON CONFLICT (org_id, capability_key) DO NOTHING;

INSERT INTO public.user_capabilities (user_id, capability_key, allowed)
SELECT uc.user_id, k.key, uc.allowed
  FROM public.user_capabilities uc
  CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies')) AS k(key)
 WHERE uc.capability_key = 'data_editing'
ON CONFLICT (user_id, capability_key) DO NOTHING;

-- The project layer's own defaults. THIS is where the split earns its keep:
-- an analyst may retune decisions and read everything, and may not rewrite the
-- measured inputs those decisions are judged against.
INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
  ('owner',   'data_edit_inputs',   true),
  ('owner',   'data_edit_policies', true),
  ('owner',   'export',             true),
  ('owner',   'simulation_lab',     true),
  ('editor',  'data_edit_inputs',   true),
  ('editor',  'data_edit_policies', true),
  ('editor',  'export',             true),
  ('editor',  'simulation_lab',     true),
  ('analyst', 'data_edit_inputs',   false),
  ('analyst', 'data_edit_policies', true),
  ('analyst', 'export',             true),
  ('analyst', 'simulation_lab',     true),
  ('viewer',  'data_edit_inputs',   false),
  ('viewer',  'data_edit_policies', false),
  ('viewer',  'export',             false),
  ('viewer',  'simulation_lab',     false)
ON CONFLICT (project_role, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ── 5. delegation_grants ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.delegation_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id)       ON DELETE CASCADE,
  grantor_user_id  uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  grantee_user_id  uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  project_role     text NOT NULL CHECK (project_role IN ('owner','editor','analyst','viewer')),
  -- NOT NULL on purpose: a delegation without an end is a membership, and the
  -- product already has a table for those. §2.1 G3 says grants EXPIRE.
  expires_at       timestamptz NOT NULL,
  rationale        text NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (grantor_user_id <> grantee_user_id)
);
CREATE INDEX IF NOT EXISTS delegation_grants_active_idx
  ON public.delegation_grants (grantee_user_id, project_id)
  WHERE revoked_at IS NULL;

GRANT SELECT ON public.delegation_grants TO authenticated, anon;
GRANT ALL    ON public.delegation_grants TO service_role;
ALTER TABLE public.delegation_grants ENABLE ROW LEVEL SECURITY;

-- Read grants you gave or received. As with project_members there is NO write
-- policy: `grant_project_delegation` is the only way in, because subtraction has
-- to be CHECKED and a policy cannot check it (D28).
DROP POLICY IF EXISTS "delegation_grants: read own" ON public.delegation_grants;
CREATE POLICY "delegation_grants: read own" ON public.delegation_grants
  FOR SELECT USING (
    grantor_user_id = public.get_current_user_id()
    OR grantee_user_id = public.get_current_user_id()
    OR public.current_is_super_admin()
  );

-- ── 6. the effective project role ────────────────────────────────────────────
-- Membership and delegation resolved into ONE answer, which is what every caller
-- actually wants. Expiry is applied HERE, once, so no caller can forget it.

CREATE OR REPLACE FUNCTION public.effective_project_role(_user_id uuid, _project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.project_role
  FROM (
    -- standing membership, unless it has lapsed
    SELECT pm.project_role
      FROM public.project_members pm
     WHERE pm.user_id = _user_id AND pm.project_id = _project_id
       AND (pm.expires_at IS NULL OR pm.expires_at > now())
    UNION ALL
    -- live delegations: not revoked, not expired
    SELECT dg.project_role
      FROM public.delegation_grants dg
     WHERE dg.grantee_user_id = _user_id AND dg.project_id = _project_id
       AND dg.revoked_at IS NULL AND dg.expires_at > now()
    UNION ALL
    -- a super admin is an owner everywhere, matching capabilities_for_user
    SELECT 'owner'
     WHERE public.is_super_admin(_user_id)
  ) r
  ORDER BY public.project_role_rank(r.project_role) DESC
  LIMIT 1;
$$;
COMMENT ON FUNCTION public.effective_project_role(uuid, uuid) IS
  'The highest project role this user currently holds on this project, from '
  'membership OR a live delegation. NULL means not a member. Expiry is applied '
  'here so no caller can forget it.';

-- ── 7. the resolver, extended ────────────────────────────────────────────────
-- An OVERLOAD. `capabilities_for_user(_user_id)` is untouched and every existing
-- caller keeps its behaviour; this form adds the project layer.
--
-- Resolution is role -> org -> project -> user, least specific first, which as a
-- COALESCE reads most-specific-first: user, then project, then org, then role,
-- then false. `/profile` stays non-deniable and super_admin still short-circuits —
-- both are load-bearing (a deniable /profile is a self-lockout loop).

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

-- ── 8. delegation, enforced ──────────────────────────────────────────────────
-- SUBTRACTIVE: a grant may not exceed what the grantor holds. Checked here and
-- nowhere else, because a PERMISSIVE policy cannot subtract (D28) and the UI is
-- not an enforcement point.

CREATE OR REPLACE FUNCTION public.grant_project_delegation(
  _grantor_user_id uuid,
  _project_id      uuid,
  _grantee_user_id uuid,
  _project_role    text,
  _expires_at      timestamptz,
  _rationale       text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grantor_role text;
  v_id           uuid;
BEGIN
  IF _project_role IS NULL OR public.project_role_rank(_project_role) = 0 THEN
    RAISE EXCEPTION 'unknown project_role %', _project_role USING ERRCODE = '22023';
  END IF;
  IF _rationale IS NULL OR btrim(_rationale) = '' THEN
    RAISE EXCEPTION 'a delegation must say why it exists' USING ERRCODE = '22023';
  END IF;

  -- EXPIRING: no end date, no grant.
  IF _expires_at IS NULL THEN
    RAISE EXCEPTION 'a delegation must expire — expires_at is required'
      USING ERRCODE = '22023';
  END IF;
  IF _expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at % is already in the past', _expires_at
      USING ERRCODE = '22023';
  END IF;

  v_grantor_role := public.effective_project_role(_grantor_user_id, _project_id);
  IF v_grantor_role IS NULL THEN
    RAISE EXCEPTION 'grantor holds nothing on this project and cannot delegate'
      USING ERRCODE = '42501';
  END IF;

  -- SUBTRACTIVE: never more than the grantor's own level.
  IF public.project_role_rank(_project_role) > public.project_role_rank(v_grantor_role) THEN
    RAISE EXCEPTION 'a grant may not exceed the grantor''s own level (% > %)',
      _project_role, v_grantor_role USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.delegation_grants
    (project_id, grantor_user_id, grantee_user_id, project_role, expires_at, rationale)
  VALUES (_project_id, _grantor_user_id, _grantee_user_id, _project_role, _expires_at, _rationale)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.grant_project_delegation(uuid, uuid, uuid, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_project_delegation(uuid, uuid, uuid, text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_project_delegation(_actor_user_id uuid, _grant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grant public.delegation_grants;
BEGIN
  SELECT * INTO v_grant FROM public.delegation_grants WHERE id = _grant_id;
  IF v_grant.id IS NULL THEN
    RAISE EXCEPTION 'grant not found' USING ERRCODE = '42704';
  END IF;
  -- the grantor, anyone who outranks them on the project, or a super admin
  IF NOT (v_grant.grantor_user_id = _actor_user_id
          OR public.is_super_admin(_actor_user_id)
          OR public.project_role_rank(public.effective_project_role(_actor_user_id, v_grant.project_id))
             >= public.project_role_rank(v_grant.project_role)) THEN
    RAISE EXCEPTION 'not entitled to revoke this grant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.delegation_grants SET revoked_at = now()
   WHERE id = _grant_id AND revoked_at IS NULL;
END; $$;

REVOKE ALL ON FUNCTION public.revoke_project_delegation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_project_delegation(uuid, uuid) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
