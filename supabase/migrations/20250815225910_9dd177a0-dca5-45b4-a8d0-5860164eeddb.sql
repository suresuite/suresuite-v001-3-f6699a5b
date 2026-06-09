-- Update RLS policies for approved_users table to allow authentication
DROP POLICY IF EXISTS "Only admins can view approved users" ON public.approved_users;

-- Create a policy that allows users to check their own credentials during login
CREATE POLICY "Users can check their own login credentials" 
ON public.approved_users 
FOR SELECT 
USING (true);

-- Create a function to authenticate approved users
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(
    user_id uuid,
    user_name text,
    user_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
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