-- Fix database functions to handle null/empty values properly

-- Update get_current_user_id to return NULL instead of empty string
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid;
  context_user_id text;
BEGIN
  -- First try app context
  context_user_id := current_setting('app.current_user_id', true);
  IF context_user_id IS NOT NULL AND context_user_id != '' THEN
    RETURN context_user_id::uuid;
  END IF;
  
  -- Fallback to JWT-based lookup
  SELECT user_id INTO current_user_id 
  FROM public.get_current_approved_user() 
  LIMIT 1;
  RETURN current_user_id;
END;
$$;

-- Update get_current_user_org to return NULL instead of empty string
CREATE OR REPLACE FUNCTION public.get_current_user_org()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_org text;
  context_user_id text;
BEGIN
  -- First try app context
  context_user_id := current_setting('app.current_user_id', true);
  IF context_user_id IS NOT NULL AND context_user_id != '' THEN
    SELECT au.organization INTO user_org
    FROM public.approved_users au
    WHERE au.id = context_user_id::uuid;
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

-- Update set_project_defaults to handle null values properly
CREATE OR REPLACE FUNCTION public.set_project_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_id uuid;
  current_org text;
BEGIN
  -- Get current user ID
  current_user_id := public.get_current_user_id();
  
  -- Ensure modeler_id defaults to current user when missing or when current user is available
  IF NEW.modeler_id IS NULL AND current_user_id IS NOT NULL THEN
    NEW.modeler_id := current_user_id;
  END IF;

  -- Get and set organization
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;

  RETURN NEW;
END;
$$;