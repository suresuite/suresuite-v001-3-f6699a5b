-- Fix login: make email comparison case-insensitive
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    au.id AS user_id,
    au.name AS user_name,
    au.role::text AS user_role
  FROM public.approved_users au
  WHERE lower(au.email) = lower(user_email)
    AND au.password_hash = extensions.crypt(user_password, au.password_hash);
END;
$$;