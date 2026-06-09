-- Helper functions to perform project actions within a single DB session
-- so that app context (user id/email) is reliably set for RLS checks
BEGIN;

-- Create a SECURITY DEFINER function to create a project
CREATE OR REPLACE FUNCTION public.create_project(
  p_name text,
  p_plant text,
  p_model text,
  p_user_id uuid,
  p_user_email text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  -- Set app context for this session so RLS helper functions work
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Insert project (BEFORE INSERT trigger sets organization/modeler defaults too)
  INSERT INTO public.projects (name, plant_name, supply_chain_model, modeler_id)
  VALUES (p_name, p_plant, p_model, p_user_id)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

-- Create a SECURITY DEFINER function to list projects for the caller's org
CREATE OR REPLACE FUNCTION public.list_projects(
  p_user_id uuid,
  p_user_email text
) RETURNS SETOF public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Ensure RLS helper functions have context inside this call
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  RETURN QUERY
  SELECT p.*
  FROM public.projects p
  WHERE p.organization = public.get_current_user_org()
  ORDER BY p.created_at DESC;
END;
$function$;

COMMIT;