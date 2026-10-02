-- Phase 12 / WP 12.3 / G15 §5–§6: personal API keys.
--
-- An API key was an ORGANIZATION principal: it reached every project of its org
-- and named nobody when it acted (§4 D28's API half — "the API principal is a
-- key, not a person"). Phase 12 lets advanced users pull data and, later, push
-- it back; both need a person behind the key.
--
-- A PERSONAL key is bound to the user who created it:
--   * it reaches what that user can see in the app — every project of the
--     user's organization (`list_projects`), within the key's own project
--     restriction. Project ROLES gate writes in the app, not reads, so they gate
--     nothing here until the API writes (a later package reads
--     `effective_project_role` there);
--   * it stops working the moment its owner is deactivated or moves to another
--     organization — `api_personal_key_actor` answers NULL and the gateway
--     refuses the key;
--   * every request it makes names its owner (`api_request_logs.actor_user_id`).
--
-- Existing keys stay `org` and behave exactly as before. Only the owner may
-- ROTATE a personal key: rotation hands its caller a working secret, and an
-- administrator rotating someone else's personal key would receive a secret
-- that acts as that person. Administrators can still revoke it.
--
-- create_api_key and list_api_keys change their signatures, so each is a DROP
-- and CREATE — which drops the function's grants — and each grant is restated.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS principal text NOT NULL DEFAULT 'org'
    CONSTRAINT api_keys_principal_check CHECK (principal IN ('org', 'personal'));
COMMENT ON COLUMN public.api_keys.principal IS
  'org = acts for the organization, names no person; personal = acts as created_by, '
  'refused once that user is inactive or no longer in the key''s organization (WP 12.3).';

ALTER TABLE public.api_request_logs
  ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES public.approved_users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.api_request_logs.actor_user_id IS
  'The person a personal key acted as (WP 12.3); NULL for an organization key.';

-- ── the person behind a key ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_personal_key_actor(p_key_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT u.id
    FROM public.api_keys k
    JOIN public.approved_users u ON u.id = k.created_by
   WHERE k.id = p_key_id
     AND k.principal = 'personal'
     AND COALESCE(u.is_active, false)
     AND u.organization_id = k.org_id;
$$;
COMMENT ON FUNCTION public.api_personal_key_actor(uuid) IS
  'The active user a personal key acts as, or NULL — the gateway refuses a personal key '
  'whose owner is inactive or has left the key''s organization (WP 12.3).';
REVOKE EXECUTE ON FUNCTION public.api_personal_key_actor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_personal_key_actor(uuid) TO service_role;

-- ── create_api_key gains the choice ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_api_key(uuid, text, text, text[], text, uuid[], timestamptz, uuid);
CREATE FUNCTION public.create_api_key(
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
  IF COALESCE(p_principal, '') NOT IN ('org','personal') THEN
    RAISE EXCEPTION 'principal must be org or personal';
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
                       'project_ids', p_project_ids, 'expires_at', p_expires_at, 'org_id', v_org));

  RETURN QUERY SELECT v_id, v_prefix, 'sk_' || p_env || '_' || v_prefix || '_' || v_secret;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_api_key(uuid, text, text, text[], text, uuid[], timestamptz, uuid, text)
  TO anon, authenticated;

-- ── list_api_keys says which kind each key is ───────────────────────────────
DROP FUNCTION IF EXISTS public.list_api_keys(uuid, text);
CREATE FUNCTION public.list_api_keys(p_user_id uuid, p_user_email text)
RETURNS TABLE (
  id uuid, key_prefix text, org_id uuid, org_name text, name text, note text,
  scopes text[], project_ids uuid[], env text, status text,
  expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz,
  rotated_from uuid, created_at timestamptz, created_by_email text, principal text
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
           k.created_at, u.email, k.principal
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
         k.created_at, u.email, k.principal
  FROM public.api_keys k
  JOIN public.organizations o ON o.id = k.org_id
  LEFT JOIN public.approved_users u ON u.id = k.created_by
  WHERE k.org_id = v_org
  ORDER BY k.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_api_keys(uuid, text) TO anon, authenticated;

-- ── rotation keeps the kind, and a personal key is its owner's to rotate ────
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
  SELECT k.* INTO v_key FROM public.api_keys k WHERE k.id = p_key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'key not found'; END IF;
  IF v_key.status <> 'active' THEN RAISE EXCEPTION 'cannot rotate a revoked key'; END IF;
  PERFORM public._api_key_management_org(p_user_id, v_key.org_id);
  IF v_key.principal = 'personal' AND v_key.created_by IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only its owner can rotate a personal key (an administrator can revoke it)';
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
GRANT EXECUTE ON FUNCTION public.rotate_api_key(uuid, text, uuid, integer) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
