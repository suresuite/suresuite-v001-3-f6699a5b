-- Fix the security warning by setting search_path for the function
DROP FUNCTION IF EXISTS public.get_current_approved_user();

CREATE OR REPLACE FUNCTION public.get_current_approved_user()
RETURNS TABLE(user_id uuid, user_email text, user_role text) 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  -- Try to get user from JWT first
  IF auth.jwt() IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role
    FROM public.approved_users au
    WHERE au.email = (auth.jwt() ->> 'email'::text);
  END IF;
  
  -- Return nothing if no valid JWT
  RETURN;
END;
$$;