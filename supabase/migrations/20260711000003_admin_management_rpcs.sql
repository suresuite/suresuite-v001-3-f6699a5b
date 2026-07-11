-- Admin management RPCs — create/edit users & organizations from the super-admin UI.
--
-- Why RPCs instead of direct table writes: the browser talks to PostgREST as anon
-- with custom app auth, and set_current_user_context is transaction-local, so a bare
-- `.from('approved_users').update(...)` never carries the super-admin context and its
-- RLS `current_is_super_admin()` check fails — the write silently does nothing. Every
-- mutation below re-establishes context from an explicit (p_actor_id, p_actor_email)
-- pair, gates on is_super_admin(actor), performs the write with definer rights, and
-- logs it via log_admin_action — the same pattern as 20260711000001_api_access_control.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── helper: assert the actor is a super admin (after setting context) ─────────
CREATE OR REPLACE FUNCTION public._assert_super_admin(p_actor_id uuid, p_actor_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF p_actor_id IS NULL OR NOT public.is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._assert_super_admin(uuid, text) FROM PUBLIC;

-- ── users ─────────────────────────────────────────────────────────────────────

-- Create an approved user with a bcrypt password hash. New users must change
-- their password on first login. Returns the new user id.
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_actor_id uuid, p_actor_email text,
  p_name text, p_email text, p_password text, p_role text, p_org_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_org_name text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);

  IF p_email IS NULL OR btrim(p_email) = '' THEN RAISE EXCEPTION 'email required'; END IF;
  IF p_role NOT IN ('super_admin','admin','modeler','user') THEN RAISE EXCEPTION 'invalid role %', p_role; END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN RAISE EXCEPTION 'password_too_short'; END IF;
  IF EXISTS (SELECT 1 FROM public.approved_users WHERE lower(email) = lower(btrim(p_email))) THEN
    RAISE EXCEPTION 'email already in use';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;
  END IF;

  INSERT INTO public.approved_users
    (name, email, role, organization, organization_id, password_hash, is_active, force_password_change)
  VALUES (
    NULLIF(btrim(coalesce(p_name, '')), ''), lower(btrim(p_email)), p_role::public.app_role,
    v_org_name, p_org_id,
    extensions.crypt(p_password, extensions.gen_salt('bf')), true, true)
  RETURNING id INTO v_id;

  IF p_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (org_id, user_id, org_role)
    VALUES (p_org_id, v_id, CASE WHEN p_role = 'admin' THEN 'admin' ELSE 'member' END)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  PERFORM public.log_admin_action('user.create', 'approved_users', v_id::text, NULL,
    jsonb_build_object('name', p_name, 'email', lower(btrim(p_email)), 'role', p_role, 'org_id', p_org_id));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_create_user(uuid, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(uuid, text, text, text, text, text, uuid) TO anon, authenticated;

-- Edit a user's display name and/or organization.
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_name text, p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_org_name text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT to_jsonb(u) INTO v_before FROM public.approved_users u WHERE u.id = p_target_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;
  END IF;

  UPDATE public.approved_users
     SET name = NULLIF(btrim(coalesce(p_name, '')), ''),
         organization = COALESCE(v_org_name, organization),
         organization_id = COALESCE(p_org_id, organization_id)
   WHERE id = p_target_user_id;

  IF p_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (org_id, user_id, org_role)
    VALUES (p_org_id, p_target_user_id, 'member') ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  PERFORM public.log_admin_action('user.update', 'approved_users', p_target_user_id::text, v_before,
    jsonb_build_object('name', p_name, 'org_id', p_org_id));
END; $$;
REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, uuid, text, uuid) TO anon, authenticated;

-- Change a user's role.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_role NOT IN ('super_admin','admin','modeler','user') THEN RAISE EXCEPTION 'invalid role %', p_role; END IF;
  SELECT role::text INTO v_before FROM public.approved_users WHERE id = p_target_user_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  UPDATE public.approved_users SET role = p_role::public.app_role WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.role_change', 'approved_users', p_target_user_id::text,
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text, uuid, text) TO anon, authenticated;

-- Suspend / reactivate a user.
CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before boolean;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT is_active INTO v_before FROM public.approved_users WHERE id = p_target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;
  UPDATE public.approved_users SET is_active = p_is_active WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.set_active', 'approved_users', p_target_user_id::text,
    jsonb_build_object('is_active', v_before), jsonb_build_object('is_active', p_is_active));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, text, uuid, boolean) TO anon, authenticated;

-- Reset a user's password (admin-initiated); forces a change on next login.
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN RAISE EXCEPTION 'password_too_short'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  UPDATE public.approved_users
     SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         password_changed_at = now(),
         password_expires_at = now() + interval '90 days',
         force_password_change = true
   WHERE id = p_target_user_id;
  PERFORM public.log_admin_action('user.reset_password', 'approved_users', p_target_user_id::text, NULL, NULL);
END; $$;
REVOKE ALL ON FUNCTION public.admin_reset_user_password(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, text, uuid, text) TO anon, authenticated;

-- ── organizations ──────────────────────────────────────────────────────────────

-- Create an organization. Slug defaults to a slugified name; must be unique.
CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_actor_id uuid, p_actor_email text, p_name text, p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_slug text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'name required'; END IF;
  v_slug := lower(regexp_replace(COALESCE(NULLIF(btrim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'an organization with slug "%" already exists', v_slug;
  END IF;
  INSERT INTO public.organizations (name, slug, status)
  VALUES (btrim(p_name), v_slug, 'active') RETURNING id INTO v_id;
  PERFORM public.log_admin_action('org.create', 'organizations', v_id::text, NULL,
    jsonb_build_object('name', btrim(p_name), 'slug', v_slug));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_create_organization(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_organization(uuid, text, text, text) TO anon, authenticated;

-- Rename an organization.
CREATE OR REPLACE FUNCTION public.admin_update_organization(
  p_actor_id uuid, p_actor_email text, p_org_id uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  SELECT to_jsonb(o) INTO v_before FROM public.organizations o WHERE o.id = p_org_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'name required'; END IF;
  UPDATE public.organizations SET name = btrim(p_name) WHERE id = p_org_id;
  PERFORM public.log_admin_action('org.update', 'organizations', p_org_id::text, v_before,
    jsonb_build_object('name', btrim(p_name)));
END; $$;
REVOKE ALL ON FUNCTION public.admin_update_organization(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_organization(uuid, text, uuid, text) TO anon, authenticated;

-- Suspend / reactivate an organization.
CREATE OR REPLACE FUNCTION public.admin_set_org_status(
  p_actor_id uuid, p_actor_email text, p_org_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  SELECT status INTO v_before FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization not found'; END IF;
  UPDATE public.organizations SET status = p_status WHERE id = p_org_id;
  PERFORM public.log_admin_action('org.set_status', 'organizations', p_org_id::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_org_status(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_org_status(uuid, text, uuid, text) TO anon, authenticated;
