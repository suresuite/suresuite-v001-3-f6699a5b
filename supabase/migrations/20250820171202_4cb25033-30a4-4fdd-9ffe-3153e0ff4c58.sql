-- 1) Fix get_current_approved_user to avoid casting empty string to uuid
CREATE OR REPLACE FUNCTION public.get_current_approved_user()
RETURNS TABLE(user_id uuid, user_email text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ctx_user text;
BEGIN
  -- Prefer app context set by custom auth
  ctx_user := current_setting('app.current_user_id', true);
  IF ctx_user IS NOT NULL AND ctx_user <> '' THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role::text
    FROM public.approved_users au
    WHERE au.id = ctx_user::uuid
    LIMIT 1;
    RETURN;
  END IF;

  -- Fallback to JWT when available
  IF auth.jwt() IS NOT NULL AND auth.jwt() ->> 'email' IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role::text
    FROM public.approved_users au
    WHERE au.email = (auth.jwt() ->> 'email'::text)
    LIMIT 1;
    RETURN;
  END IF;

  -- No valid auth context
  RETURN;
END;
$$;

-- 2) Ensure projects get defaults (organization/modeler_id) on insert
DROP TRIGGER IF EXISTS trg_projects_set_defaults ON public.projects;
CREATE TRIGGER trg_projects_set_defaults
BEFORE INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.set_project_defaults();