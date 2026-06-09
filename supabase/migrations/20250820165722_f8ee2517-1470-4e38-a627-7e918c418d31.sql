-- Fix RLS policies to work with custom authentication by using user context
-- Update the get_current_approved_user function to handle both JWT and direct user context

-- Create a function to set current user context (called by app after custom auth)
CREATE OR REPLACE FUNCTION public.set_current_user_context(user_id UUID, user_email TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- This will be used by application to set context after custom auth
  SELECT set_config('app.current_user_id', user_id::text, true);
  SELECT set_config('app.current_user_email', user_email, true);
$$;

-- Update get_current_approved_user to check app context first, then JWT
CREATE OR REPLACE FUNCTION public.get_current_approved_user()
RETURNS TABLE(user_id uuid, user_email text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- First try app context (set by custom auth)
  IF current_setting('app.current_user_id', true) IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role
    FROM public.approved_users au
    WHERE au.id = current_setting('app.current_user_id', true)::uuid;
    RETURN;
  END IF;
  
  -- Fallback to JWT token if available
  IF auth.jwt() IS NOT NULL AND auth.jwt() ->> 'email' IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role
    FROM public.approved_users au
    WHERE au.email = (auth.jwt() ->> 'email'::text);
    RETURN;
  END IF;
  
  -- Return empty if no valid authentication
  RETURN;
END;
$$;

-- Update get_current_user_id to use the new approach
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- First try app context
  IF current_setting('app.current_user_id', true) IS NOT NULL THEN
    RETURN current_setting('app.current_user_id', true)::uuid;
  END IF;
  
  -- Fallback to JWT-based lookup
  SELECT user_id INTO current_user_id 
  FROM public.get_current_approved_user() 
  LIMIT 1;
  RETURN current_user_id;
END;
$$;

-- Update get_current_user_org to use the new approach
CREATE OR REPLACE FUNCTION public.get_current_user_org()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_org text;
BEGIN
  -- First try app context
  IF current_setting('app.current_user_id', true) IS NOT NULL THEN
    SELECT au.organization INTO user_org
    FROM public.approved_users au
    WHERE au.id = current_setting('app.current_user_id', true)::uuid;
    RETURN user_org;
  END IF;
  
  -- Fallback to JWT-based lookup
  SELECT au.organization INTO user_org
  FROM public.approved_users au
  WHERE au.email = (auth.jwt() ->> 'email')
  LIMIT 1;
  RETURN user_org;
END;
$$;