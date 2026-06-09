-- Create a security definer function to verify user exists (bypasses RLS)
CREATE OR REPLACE FUNCTION public.verify_user_exists(p_user_id uuid, p_user_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE id = p_user_id AND email = p_user_email
  );
END;
$$;