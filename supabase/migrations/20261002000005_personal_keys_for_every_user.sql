-- Phase 12 / WP 12.7 / G15 §12: every user may create a personal, READ-ONLY API key.
--
-- WP 12.3's gap check left a product question open: "a plain `user` still cannot
-- mint a key at all (`_api_key_management_org`: admin or modeler)". The product
-- owner answered it (2026-10-02): any user — a viewer included — may create a key
-- to pull the data they can already see and run the library on their own machine.
--
-- What a non-manager gets, and nothing more:
--   * a PERSONAL key only — it acts as them, names them on every request and dies
--     when they are deactivated or leave the organization (WP 12.3). An
--     organization key names nobody, so it stays an administrator's tool;
--   * READ scopes only — `api_key_self_service_scopes()`, authored here once and
--     read by the RPCs, the gateway and /developer. Pulling a dataset, a policy
--     version and the engine needs nothing else (WP 12.2, 12.4);
--   * their OWN keys — they list, rotate and revoke only keys they created.
--
-- The read-only rule is applied where the key is USED as well as where it is
-- made: `api_personal_key_grant` answers the scopes a personal key may use NOW,
-- cutting a key to the read scopes when its owner no longer manages keys. So a
-- modeler's write-scoped personal key stops writing the day they become a plain
-- user, rather than keeping the role they used to have.
--
-- Managers (admin, modeler, super admin, organization owner/admin) are unchanged:
-- they go through `_api_key_management_org` exactly as before, and only when that
-- refuses does the member path run.

-- ── the scopes anyone may hold ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_key_self_service_scopes()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['read:data','read:policies','read:runs','read:experiments']::text[] $$;
COMMENT ON FUNCTION public.api_key_self_service_scopes() IS
  'The scopes a user who does not manage API keys may put on (and use through) a personal key (WP 12.7).';
GRANT EXECUTE ON FUNCTION public.api_key_self_service_scopes() TO anon, authenticated, service_role;

-- ── who is asking: their organization, and whether they manage its keys ─────
CREATE OR REPLACE FUNCTION public._api_key_caller(p_user_id uuid, p_org_id uuid DEFAULT NULL)
RETURNS TABLE (org_id uuid, can_manage boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- A manager resolves exactly as before WP 12.7.
  BEGIN
    v_org := public._api_key_management_org(p_user_id, p_org_id);
    RETURN QUERY SELECT v_org, true;
    RETURN;
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  -- Anyone else: an ACTIVE member of an organization, for that organization only —
  -- the same test `api_personal_key_actor` applies when the key is used.
  SELECT u.organization_id INTO v_org
    FROM public.approved_users u
   WHERE u.id = p_user_id AND COALESCE(u.is_active, false) AND u.organization_id IS NOT NULL;
  IF v_org IS NULL OR (p_org_id IS NOT NULL AND p_org_id <> v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT v_org, false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._api_key_caller(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- /developer asks this once, so the page offers only what the database will accept.
CREATE OR REPLACE FUNCTION public.api_key_caller(p_user_id uuid, p_user_email text)
RETURNS TABLE (org_id uuid, can_manage boolean, self_service_scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  RETURN QUERY SELECT c.org_id, c.can_manage, public.api_key_self_service_scopes()
                 FROM public._api_key_caller(p_user_id, NULL) c;
END;
$$;
COMMENT ON FUNCTION public.api_key_caller(uuid, text) IS
  'The caller''s key-management standing: their organization, whether they manage its keys, '
  'and the scopes a personal key may carry without managing them (WP 12.7).';
GRANT EXECUTE ON FUNCTION public.api_key_caller(uuid, text) TO anon, authenticated;

-- ── create: a non-manager may mint a personal, read-only key ─────────────────
CREATE OR REPLACE FUNCTION public.create_api_key(
  p_user_id     uuid,
  p_user_email  text,
  p_name        text,
  p_scopes      text[],
  p_env         text DEFAULT 'live',
  p_project_ids uuid[] DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL,
  p_org_id      uuid DEFAULT NULL,
  p_principal   text DEFAULT 'org'
) RETURNS TABLE (id uuid, key_prefix text, plaintext_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org     uuid;
  v_manage  boolean;
  v_prefix  text;
  v_secret  text;
  v_hash    text;
  v_id      uuid;
  v_scope   text;
  v_bad     uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  SELECT c.org_id, c.can_manage INTO v_org, v_manage FROM public._api_key_caller(p_user_id, p_org_id) c;

  IF p_env NOT IN ('live','test') THEN RAISE EXCEPTION 'env must be live or test'; END IF;
  IF COALESCE(p_principal, '') NOT IN ('org','personal') THEN
    RAISE EXCEPTION 'principal must be org or personal';
  END IF;
  IF NOT v_manage AND p_principal <> 'personal' THEN
    RAISE EXCEPTION 'forbidden: only an admin or modeler can create an organization key';
  END IF;
  -- A personal key acts as its creator, so its creator must be a member of the
  -- organization it is minted for — a super admin minting for another org gets
  -- an organization key or nothing.
  IF p_principal = 'personal' AND NOT EXISTS (
       SELECT 1 FROM public.approved_users u
        WHERE u.id = p_user_id AND u.organization_id = v_org AND COALESCE(u.is_active, false)) THEN
    RAISE EXCEPTION 'a personal key can only be created for your own organization';
  END IF;
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one scope is required';
  END IF;
  FOREACH v_scope IN ARRAY p_scopes LOOP
    IF v_scope NOT IN ('read:data','write:data','read:policies','write:policies',
                       'read:runs','write:runs','read:experiments','write:experiments',
                       'admin:keys') THEN
      RAISE EXCEPTION 'unknown scope: %', v_scope;
    END IF;
    IF NOT v_manage AND v_scope <> ALL (public.api_key_self_service_scopes()) THEN
      RAISE EXCEPTION 'forbidden: % needs an admin or modeler role — your keys are read-only', v_scope;
    END IF;
  END LOOP;

  IF p_project_ids IS NOT NULL THEN
    SELECT pid INTO v_bad FROM unnest(p_project_ids) AS pid
    WHERE NOT EXISTS (SELECT 1 FROM public.projects pr
                      WHERE pr.id = pid AND pr.organization_id = v_org)
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'project % is not in your organization', v_bad;
    END IF;
  END IF;

  v_prefix := substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash   := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  INSERT INTO public.api_keys
    (key_prefix, secret_hash, org_id, created_by, name, scopes, project_ids, env, expires_at, principal)
  VALUES
    (v_prefix, v_hash, v_org, p_user_id, COALESCE(NULLIF(trim(p_name), ''), 'API key'),
     p_scopes, p_project_ids, p_env, p_expires_at, p_principal)
  RETURNING api_keys.id INTO v_id;

  PERFORM public._api_key_audit(p_user_id, 'api_key.create', v_id, NULL,
    jsonb_build_object('name', p_name, 'env', p_env, 'scopes', p_scopes, 'principal', p_principal,
                       'project_ids', p_project_ids, 'expires_at', p_expires_at, 'org_id', v_org,
                       'self_service', NOT v_manage));

  RETURN QUERY SELECT v_id, v_prefix, 'sk_' || p_env || '_' || v_prefix || '_' || v_secret;
END;
$$;

-- ── list: a non-manager sees their own personal keys ─────────────────────────
CREATE OR REPLACE FUNCTION public.list_api_keys(p_user_id uuid, p_user_email text)
RETURNS TABLE (
  id uuid, key_prefix text, org_id uuid, org_name text, name text, note text,
  scopes text[], project_ids uuid[], env text, status text,
  expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz,
  rotated_from uuid, created_at timestamptz, created_by_email text, principal text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org    uuid;
  v_manage boolean;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  IF public.is_super_admin(p_user_id) THEN
    RETURN QUERY
    SELECT k.id, k.key_prefix, k.org_id, o.name, k.name, k.note, k.scopes, k.project_ids,
           k.env, k.status, k.expires_at, k.last_used_at, k.revoked_at, k.rotated_from,
           k.created_at, u.email, k.principal
    FROM public.api_keys k
    JOIN public.organizations o ON o.id = k.org_id
    LEFT JOIN public.approved_users u ON u.id = k.created_by
    ORDER BY k.created_at DESC;
    RETURN;
  END IF;
  SELECT c.org_id, c.can_manage INTO v_org, v_manage FROM public._api_key_caller(p_user_id, NULL) c;
  RETURN QUERY
  SELECT k.id, k.key_prefix, k.org_id, o.name, k.name, k.note, k.scopes, k.project_ids,
         k.env, k.status, k.expires_at, k.last_used_at, k.revoked_at, k.rotated_from,
         k.created_at, u.email, k.principal
  FROM public.api_keys k
  JOIN public.organizations o ON o.id = k.org_id
  LEFT JOIN public.approved_users u ON u.id = k.created_by
  WHERE k.org_id = v_org
    AND (v_manage OR (k.principal = 'personal' AND k.created_by = p_user_id))
  ORDER BY k.created_at DESC;
END;
$$;

-- ── usage: the same rows list_api_keys shows ────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_key_usage(p_user_id uuid, p_user_email text)
RETURNS TABLE (
  api_key_id uuid, requests_24h bigint, requests_30d bigint,
  errors_30d bigint, last_request_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_super  boolean;
  v_org    uuid;
  v_manage boolean := true;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  v_super := public.is_super_admin(p_user_id);
  IF NOT v_super THEN
    SELECT c.org_id, c.can_manage INTO v_org, v_manage FROM public._api_key_caller(p_user_id, NULL) c;
  END IF;
  RETURN QUERY
  SELECT l.api_key_id,
         count(*) FILTER (WHERE l.created_at >= now() - interval '24 hours'),
         count(*),
         count(*) FILTER (WHERE l.status >= 400),
         max(l.created_at)
  FROM public.api_request_logs l
  JOIN public.api_keys k ON k.id = l.api_key_id
  WHERE l.created_at >= now() - interval '30 days'
    AND (v_super OR k.org_id = v_org)
    AND (v_manage OR (k.principal = 'personal' AND k.created_by = p_user_id))
  GROUP BY l.api_key_id;
END;
$$;

-- ── revoke: a non-manager may revoke their own personal key ──────────────────
CREATE OR REPLACE FUNCTION public.revoke_api_key(p_user_id uuid, p_user_email text, p_key_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_key    public.api_keys%ROWTYPE;
  v_manage boolean;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  SELECT * INTO v_key FROM public.api_keys WHERE id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'key not found'; END IF;
  SELECT c.can_manage INTO v_manage FROM public._api_key_caller(p_user_id, v_key.org_id) c;
  IF NOT v_manage AND (v_key.principal <> 'personal' OR v_key.created_by IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.api_keys
     SET status = 'revoked', revoked_at = now(), revoked_by = p_user_id
   WHERE id = p_key_id AND status = 'active';

  PERFORM public._api_key_audit(p_user_id, 'api_key.revoke', p_key_id,
    jsonb_build_object('status', v_key.status), jsonb_build_object('status', 'revoked'));
END;
$$;

-- ── rotate: the owner, and a non-manager only into a read-only key ───────────
CREATE OR REPLACE FUNCTION public.rotate_api_key(
  p_user_id uuid, p_user_email text, p_key_id uuid, p_overlap_hours integer DEFAULT 72
) RETURNS TABLE (id uuid, key_prefix text, plaintext_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_key     public.api_keys%ROWTYPE;
  v_manage  boolean;
  v_prefix  text;
  v_secret  text;
  v_id      uuid;
  v_cutoff  timestamptz;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  SELECT k.* INTO v_key FROM public.api_keys k WHERE k.id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'key not found'; END IF;
  IF v_key.status <> 'active' THEN RAISE EXCEPTION 'cannot rotate a revoked key'; END IF;
  SELECT c.can_manage INTO v_manage FROM public._api_key_caller(p_user_id, v_key.org_id) c;
  IF v_key.principal = 'personal' AND v_key.created_by IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only its owner can rotate a personal key (an administrator can revoke it)';
  END IF;
  IF NOT v_manage AND v_key.principal <> 'personal' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- A replacement is a NEW key: a non-manager cannot mint write scopes this way either.
  IF NOT v_manage AND NOT (v_key.scopes <@ public.api_key_self_service_scopes()) THEN
    RAISE EXCEPTION 'forbidden: this key carries scopes that need an admin or modeler role — revoke it and create a read-only key';
  END IF;

  v_prefix := substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.api_keys
    (key_prefix, secret_hash, org_id, created_by, name, note, scopes, project_ids, env,
     expires_at, rotated_from, principal)
  VALUES
    (v_prefix, encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_key.org_id, p_user_id,
     v_key.name, v_key.note, v_key.scopes, v_key.project_ids, v_key.env,
     v_key.expires_at, v_key.id, v_key.principal)
  RETURNING api_keys.id INTO v_id;

  v_cutoff := now() + make_interval(hours => GREATEST(0, COALESCE(p_overlap_hours, 0)));
  UPDATE public.api_keys k
     SET expires_at = LEAST(COALESCE(k.expires_at, v_cutoff), v_cutoff)
   WHERE k.id = p_key_id;

  PERFORM public._api_key_audit(p_user_id, 'api_key.rotate', p_key_id,
    jsonb_build_object('key_prefix', v_key.key_prefix),
    jsonb_build_object('replacement_id', v_id, 'old_key_expires_at', v_cutoff, 'principal', v_key.principal));

  RETURN QUERY SELECT v_id, v_prefix, 'sk_' || v_key.env || '_' || v_prefix || '_' || v_secret;
END;
$$;

-- ── the gateway: who a personal key acts as, and with which scopes NOW ───────
CREATE OR REPLACE FUNCTION public.api_personal_key_grant(p_key_id uuid)
RETURNS TABLE (actor_user_id uuid, scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_actor  uuid;
  v_org    uuid;
  v_scopes text[];
  v_manage boolean;
BEGIN
  v_actor := public.api_personal_key_actor(p_key_id);
  IF v_actor IS NULL THEN RETURN; END IF;           -- no row: the gateway refuses the key
  SELECT k.org_id, k.scopes INTO v_org, v_scopes FROM public.api_keys k WHERE k.id = p_key_id;
  SELECT c.can_manage INTO v_manage FROM public._api_key_caller(v_actor, v_org) c;
  IF NOT v_manage THEN
    SELECT COALESCE(array_agg(s ORDER BY s), ARRAY[]::text[]) INTO v_scopes
      FROM unnest(v_scopes) s WHERE s = ANY (public.api_key_self_service_scopes());
  END IF;
  RETURN QUERY SELECT v_actor, v_scopes;
END;
$$;
COMMENT ON FUNCTION public.api_personal_key_grant(uuid) IS
  'The active user a personal key acts as and the scopes it may use now — cut to '
  'api_key_self_service_scopes() when that user does not manage keys. No row: refuse the key (WP 12.7).';
REVOKE EXECUTE ON FUNCTION public.api_personal_key_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_personal_key_grant(uuid) TO service_role;

-- ── /developer is a page for every role ─────────────────────────────────────
-- The role DEFAULT moves; an organization or user override a super admin set
-- (org_capabilities, user_capabilities) still wins over it.
UPDATE public.role_capabilities
   SET allowed = true, updated_at = now()
 WHERE role = 'user' AND capability_key = '/developer';

SELECT pg_notify('pgrst', 'reload schema');
