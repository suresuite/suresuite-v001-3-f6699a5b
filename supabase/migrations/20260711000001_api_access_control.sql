-- API Phase 0-2 / G15 / §12 guardrail: API keys, request audit, idempotency,
-- rate-limit config, and tenancy RPCs for the /v1 gateway.
--
-- Design: docs/design/public-api-and-access-control.md (§5 keys, §6 authz,
-- §7 quotas, §11 audit, §13 data model). The gateway edge function
-- (supabase/functions/api) is the only holder of the service role on the API
-- path; browsers never read these tables directly — every UI interaction goes
-- through the SECURITY DEFINER RPCs below, which follow the established
-- list_projects pattern (explicit p_user_id/p_user_email + set_current_user_context)
-- because pooled PostgREST connections do not carry the custom auth context.
--
-- Security posture (§10): secrets are hashed at rest (SHA-256 of a 256-bit
-- CSPRNG secret — Q3), shown exactly once at mint/rotate, revocable and
-- expirable. No table grant ever exposes secret_hash to anon/authenticated.

-- pgcrypto lives in the extensions schema on Supabase (snapshot_policy already
-- uses extensions.digest); this is a no-op there but keeps local dev working.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── api_keys (§5.2) ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_prefix   text NOT NULL UNIQUE,
  secret_hash  text NOT NULL,
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  name         text NOT NULL DEFAULT 'API key',
  note         text,
  scopes       text[] NOT NULL DEFAULT '{}',
  -- NULL = every project in the org; non-NULL = restricted set (§6.2)
  project_ids  uuid[],
  env          text NOT NULL DEFAULT 'live' CHECK (env IN ('live','test')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  rotated_from uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys (org_id);

-- Service role only. RLS on with no anon/authenticated policies: the UI path
-- is the RPC layer, so secret_hash has no readable path (§5.2).
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- ── api_request_logs (§11) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_request_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  org_id      uuid,
  method      text NOT NULL,
  route       text NOT NULL,
  status      integer NOT NULL,
  project_id  uuid,
  scope_used  text,
  latency_ms  integer,
  bytes_out   integer,
  request_id  text,
  error_code  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON public.api_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_key     ON public.api_request_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_org     ON public.api_request_logs (org_id, created_at DESC);

GRANT ALL ON public.api_request_logs TO service_role;
GRANT SELECT ON public.api_request_logs TO authenticated;
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_logs: super read" ON public.api_request_logs;
CREATE POLICY "api_logs: super read" ON public.api_request_logs FOR SELECT
  USING (public.current_is_super_admin());

-- ── api_idempotency (§7.3) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_idempotency (
  api_key_id      uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  run_id          uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, idempotency_key)
);
GRANT ALL ON public.api_idempotency TO service_role;
ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;

-- ── api_rate_limits (§7, §13 — extends the ai_budgets shape) ─────────────────
-- No row = the gateway's built-in defaults for the key's env. A row lets a
-- super admin tier a specific org or key up/down without a deploy.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                text NOT NULL CHECK (scope IN ('org','key')),
  scope_id             uuid NOT NULL,
  rpm                  integer,
  rpd                  integer,
  max_concurrent_runs  integer,
  max_replications     integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_id)
);
GRANT ALL ON public.api_rate_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limits TO authenticated;
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_limits: super full" ON public.api_rate_limits;
CREATE POLICY "api_limits: super full" ON public.api_rate_limits FOR ALL
  USING (public.current_is_super_admin()) WITH CHECK (public.current_is_super_admin());

DROP TRIGGER IF EXISTS trg_api_rate_limits_updated_at ON public.api_rate_limits;
CREATE TRIGGER trg_api_rate_limits_updated_at BEFORE UPDATE ON public.api_rate_limits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Key-management authorization helper ──────────────────────────────────────
-- Who may mint/rotate/revoke keys, and for which org (§5.2). Allowed: super
-- admins (any org via p_org_id), app-role admins, org owners/admins — and
-- app-role modelers, this app's developer persona; a modeler-led org would
-- otherwise have nobody who can mint a key. Plain 'user' accounts cannot.

CREATE OR REPLACE FUNCTION public._api_key_management_org(p_user_id uuid, p_org_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_user  public.approved_users%ROWTYPE;
  v_org   uuid;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_user_id;
  IF NOT FOUND OR COALESCE(v_user.is_active, true) = false THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_user.role::text = 'super_admin' THEN
    v_org := COALESCE(p_org_id, v_user.organization_id);
    IF v_org IS NULL THEN
      SELECT o.id INTO v_org FROM public.organizations o
      WHERE o.name = v_user.organization OR o.slug = v_user.organization
      LIMIT 1;
    END IF;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no organization resolved for key'; END IF;
    RETURN v_org;
  END IF;

  v_org := v_user.organization_id;
  IF v_org IS NULL THEN
    SELECT o.id INTO v_org FROM public.organizations o
    WHERE o.name = v_user.organization OR o.slug = v_user.organization
    LIMIT 1;
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'user has no organization'; END IF;
  IF p_org_id IS NOT NULL AND p_org_id <> v_org THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_allowed := v_user.role::text IN ('admin', 'modeler')
    OR EXISTS (SELECT 1 FROM public.organization_members m
               WHERE m.org_id = v_org AND m.user_id = p_user_id
                 AND m.org_role IN ('owner','admin'));
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN v_org;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._api_key_management_org(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Audit writer for key lifecycle: log_admin_action() requires super_admin, but
-- org admins also manage keys, so this inserts with the verified actor id.
CREATE OR REPLACE FUNCTION public._api_key_audit(
  p_actor uuid, p_action text, p_key_id uuid, p_before jsonb, p_after jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.admin_audit_logs (actor_user_id, action, target_type, target_id, before, after)
  VALUES (p_actor, p_action, 'api_keys', p_key_id::text, p_before, p_after);
$$;
REVOKE EXECUTE ON FUNCTION public._api_key_audit(uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── create_api_key (§5.2): mints a key, returns the plaintext exactly once ───

CREATE OR REPLACE FUNCTION public.create_api_key(
  p_user_id     uuid,
  p_user_email  text,
  p_name        text,
  p_scopes      text[],
  p_env         text DEFAULT 'live',
  p_project_ids uuid[] DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL,
  p_org_id      uuid DEFAULT NULL
) RETURNS TABLE (id uuid, key_prefix text, plaintext_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org     uuid;
  v_prefix  text;
  v_secret  text;
  v_hash    text;
  v_id      uuid;
  v_scope   text;
  v_bad     uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  v_org := public._api_key_management_org(p_user_id, p_org_id);

  IF p_env NOT IN ('live','test') THEN RAISE EXCEPTION 'env must be live or test'; END IF;
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one scope is required';
  END IF;
  FOREACH v_scope IN ARRAY p_scopes LOOP
    IF v_scope NOT IN ('read:data','write:data','read:policies','write:policies',
                       'read:runs','write:runs','read:experiments','write:experiments',
                       'admin:keys') THEN
      RAISE EXCEPTION 'unknown scope: %', v_scope;
    END IF;
  END LOOP;

  -- A restricted key may only name projects inside its own org (§6.2).
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
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');   -- 256-bit secret (Q3)
  v_hash   := encode(extensions.digest(v_secret, 'sha256'), 'hex');

  INSERT INTO public.api_keys
    (key_prefix, secret_hash, org_id, created_by, name, scopes, project_ids, env, expires_at)
  VALUES
    (v_prefix, v_hash, v_org, p_user_id, COALESCE(NULLIF(trim(p_name), ''), 'API key'),
     p_scopes, p_project_ids, p_env, p_expires_at)
  RETURNING api_keys.id INTO v_id;

  PERFORM public._api_key_audit(p_user_id, 'api_key.create', v_id, NULL,
    jsonb_build_object('name', p_name, 'env', p_env, 'scopes', p_scopes,
                       'project_ids', p_project_ids, 'expires_at', p_expires_at, 'org_id', v_org));

  RETURN QUERY SELECT v_id, v_prefix, 'sk_' || p_env || '_' || v_prefix || '_' || v_secret;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_api_key(uuid, text, text, text[], text, uuid[], timestamptz, uuid) TO anon, authenticated;

-- ── list_api_keys: everything except the hash ────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_api_keys(p_user_id uuid, p_user_email text)
RETURNS TABLE (
  id uuid, key_prefix text, org_id uuid, org_name text, name text, note text,
  scopes text[], project_ids uuid[], env text, status text,
  expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz,
  rotated_from uuid, created_at timestamptz, created_by_email text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  IF public.is_super_admin(p_user_id) THEN
    RETURN QUERY
    SELECT k.id, k.key_prefix, k.org_id, o.name, k.name, k.note, k.scopes, k.project_ids,
           k.env, k.status, k.expires_at, k.last_used_at, k.revoked_at, k.rotated_from,
           k.created_at, u.email
    FROM public.api_keys k
    JOIN public.organizations o ON o.id = k.org_id
    LEFT JOIN public.approved_users u ON u.id = k.created_by
    ORDER BY k.created_at DESC;
    RETURN;
  END IF;
  v_org := public._api_key_management_org(p_user_id, NULL);
  RETURN QUERY
  SELECT k.id, k.key_prefix, k.org_id, o.name, k.name, k.note, k.scopes, k.project_ids,
         k.env, k.status, k.expires_at, k.last_used_at, k.revoked_at, k.rotated_from,
         k.created_at, u.email
  FROM public.api_keys k
  JOIN public.organizations o ON o.id = k.org_id
  LEFT JOIN public.approved_users u ON u.id = k.created_by
  WHERE k.org_id = v_org
  ORDER BY k.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_api_keys(uuid, text) TO anon, authenticated;

-- ── revoke_api_key (§5.4): immediate, audited ────────────────────────────────

CREATE OR REPLACE FUNCTION public.revoke_api_key(p_user_id uuid, p_user_email text, p_key_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_key public.api_keys%ROWTYPE;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  SELECT * INTO v_key FROM public.api_keys WHERE id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'key not found'; END IF;
  PERFORM public._api_key_management_org(p_user_id, v_key.org_id);

  UPDATE public.api_keys
     SET status = 'revoked', revoked_at = now(), revoked_by = p_user_id
   WHERE id = p_key_id AND status = 'active';

  PERFORM public._api_key_audit(p_user_id, 'api_key.revoke', p_key_id,
    jsonb_build_object('status', v_key.status), jsonb_build_object('status', 'revoked'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid, text, uuid) TO anon, authenticated;

-- ── rotate_api_key (§5.4): new secret, same grants, overlap window ───────────

CREATE OR REPLACE FUNCTION public.rotate_api_key(
  p_user_id uuid, p_user_email text, p_key_id uuid, p_overlap_hours integer DEFAULT 72
) RETURNS TABLE (id uuid, key_prefix text, plaintext_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_key     public.api_keys%ROWTYPE;
  v_prefix  text;
  v_secret  text;
  v_id      uuid;
  v_cutoff  timestamptz;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  -- k.* qualified throughout: the RETURNS TABLE declares an `id` variable,
  -- so an unqualified `id` here would be ambiguous.
  SELECT k.* INTO v_key FROM public.api_keys k WHERE k.id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'key not found'; END IF;
  IF v_key.status <> 'active' THEN RAISE EXCEPTION 'cannot rotate a revoked key'; END IF;
  PERFORM public._api_key_management_org(p_user_id, v_key.org_id);

  v_prefix := substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.api_keys
    (key_prefix, secret_hash, org_id, created_by, name, note, scopes, project_ids, env,
     expires_at, rotated_from)
  VALUES
    (v_prefix, encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_key.org_id, p_user_id,
     v_key.name, v_key.note, v_key.scopes, v_key.project_ids, v_key.env,
     v_key.expires_at, v_key.id)
  RETURNING api_keys.id INTO v_id;

  -- Old secret keeps working through the overlap window so clients rotate
  -- without downtime, then expires (§5.4).
  v_cutoff := now() + make_interval(hours => GREATEST(0, COALESCE(p_overlap_hours, 0)));
  UPDATE public.api_keys k
     SET expires_at = LEAST(COALESCE(k.expires_at, v_cutoff), v_cutoff)
   WHERE k.id = p_key_id;

  PERFORM public._api_key_audit(p_user_id, 'api_key.rotate', p_key_id,
    jsonb_build_object('key_prefix', v_key.key_prefix),
    jsonb_build_object('replacement_id', v_id, 'old_key_expires_at', v_cutoff));

  RETURN QUERY SELECT v_id, v_prefix, 'sk_' || v_key.env || '_' || v_prefix || '_' || v_secret;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rotate_api_key(uuid, text, uuid, integer) TO anon, authenticated;

-- ── api_key_usage: per-key traffic rollup for the developer page (§11) ───────

CREATE OR REPLACE FUNCTION public.api_key_usage(p_user_id uuid, p_user_email text)
RETURNS TABLE (
  api_key_id uuid, requests_24h bigint, requests_30d bigint,
  errors_30d bigint, last_request_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_org uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  IF NOT public.is_super_admin(p_user_id) THEN
    v_org := public._api_key_management_org(p_user_id, NULL);
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
    AND (v_org IS NULL OR k.org_id = v_org)
  GROUP BY l.api_key_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.api_key_usage(uuid, text) TO anon, authenticated;

-- ── Gateway-side authorization RPCs (§6.3 defense in depth) ──────────────────
-- Service-role only: the DB re-verifies tenancy so a gateway bug is not
-- automatically a data-crossing bug (R1). Never callable from clients.

CREATE OR REPLACE FUNCTION public.api_can_access_project(p_org_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.organization_id = p_org_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.api_can_access_project(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_can_access_project(uuid, uuid) TO service_role;

-- Concurrent-run quota input (§7.2): queued/running runs across the org.
CREATE OR REPLACE FUNCTION public.api_count_active_runs(p_org_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
  FROM public.simulation_runs r
  JOIN public.projects p ON p.id = r.project_id
  WHERE p.organization_id = p_org_id AND r.status IN ('queued','running');
$$;
REVOKE EXECUTE ON FUNCTION public.api_count_active_runs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_count_active_runs(uuid) TO service_role;

-- Flush PostgREST schema cache so the new RPCs are visible immediately
SELECT pg_notify('pgrst', 'reload schema');
