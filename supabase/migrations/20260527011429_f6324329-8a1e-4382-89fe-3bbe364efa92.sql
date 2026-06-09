
-- Phase 1: Profile & password self-service
-- Extend approved_users with profile + password policy columns
ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS password_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- RPC: get current user's profile (reads context set on login)
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  display_name text,
  phone text,
  avatar_url text,
  role text,
  organization text,
  is_active boolean,
  force_password_change boolean,
  password_changed_at timestamptz,
  password_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := public.get_current_user_id();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  RETURN QUERY
  SELECT au.id, au.email, au.name, au.display_name, au.phone, au.avatar_url,
         au.role::text, au.organization, au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at
  FROM public.approved_users au
  WHERE au.id = uid;
END;
$$;

-- RPC: update own profile (display_name, phone, avatar_url)
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_display_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := public.get_current_user_id();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.approved_users
     SET display_name = COALESCE(p_display_name, display_name),
         phone        = COALESCE(p_phone, phone),
         avatar_url   = COALESCE(p_avatar_url, avatar_url),
         updated_at   = now()
   WHERE id = uid;
END;
$$;

-- RPC: change own password (verifies old password using pgcrypto crypt)
CREATE OR REPLACE FUNCTION public.change_own_password(
  p_old_password text,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := public.get_current_user_id();
  current_hash text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'password_too_short';
  END IF;

  SELECT password_hash INTO current_hash
    FROM public.approved_users WHERE id = uid;

  IF current_hash IS NULL OR current_hash <> extensions.crypt(p_old_password, current_hash) THEN
    RAISE EXCEPTION 'invalid_current_password';
  END IF;

  UPDATE public.approved_users
     SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         password_changed_at = now(),
         password_expires_at = now() + interval '90 days',
         force_password_change = false,
         updated_at = now()
   WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_own_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_own_password(text, text) TO anon, authenticated;

-- Avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: avatars are publicly readable; writes restricted by folder == user id
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = COALESCE(public.get_current_user_id()::text, '__none__')
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = COALESCE(public.get_current_user_id()::text, '__none__')
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = COALESCE(public.get_current_user_id()::text, '__none__')
  );
