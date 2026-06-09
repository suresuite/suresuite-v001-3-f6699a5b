-- Lock down approved_users and expose safe RPCs
-- 1) Ensure RLS is enabled and remove direct SELECT access
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved users can select only themselves" ON public.approved_users;

-- Further harden privileges so clients cannot select the base table at all
REVOKE ALL ON TABLE public.approved_users FROM anon, authenticated;

-- 2) Safe RPC: get the caller's own public profile (no password_hash exposure)
CREATE OR REPLACE FUNCTION public.get_self_profile()
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  role text,
  organization text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Prefer app context set by the app after custom auth
  IF current_setting('app.current_user_id', true) IS NOT NULL
     AND current_setting('app.current_user_id', true) <> '' THEN
    v_id := current_setting('app.current_user_id', true)::uuid;
  ELSIF auth.jwt() IS NOT NULL AND (auth.jwt() ->> 'email') IS NOT NULL THEN
    SELECT au.id INTO v_id
    FROM public.approved_users au
    WHERE lower(au.email) = lower(auth.jwt() ->> 'email')
    LIMIT 1;
  ELSE
    RETURN; -- no context available
  END IF;

  RETURN QUERY
  SELECT au.id, au.email, au.name, au.role::text, au.organization, au.created_at, au.updated_at
  FROM public.approved_users au
  WHERE au.id = v_id
  LIMIT 1;
END;
$$;

-- 3) Ensure the admin-only listing RPC exists and exposes only non-sensitive fields
CREATE OR REPLACE FUNCTION public.list_approved_users_safe()
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  role text,
  organization text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_role text;
BEGIN
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT au.id, au.email, au.name, au.role::text, au.organization, au.created_at, au.updated_at
  FROM public.approved_users au
  ORDER BY au.created_at DESC;
END;
$$;