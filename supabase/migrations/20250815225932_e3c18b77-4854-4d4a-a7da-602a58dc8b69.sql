-- Fix the function security issue by setting search_path
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(
    user_id uuid,
    user_name text,
    user_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.id,
        au.name,
        au.role
    FROM public.approved_users au
    WHERE au.email = user_email 
    AND au.password_hash = crypt(user_password, au.password_hash);
END;
$$;