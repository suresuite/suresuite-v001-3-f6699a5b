-- AI chat project access guard.
-- The project-ai-chat edge function (tools mode) queries with the service-role key, which
-- bypasses RLS, and previously only filtered by project_id without verifying the caller can
-- access that project. This SECURITY DEFINER function mirrors the "Projects: select within
-- organization" RLS policy so the edge function can authorize a (user, project) pair before
-- running any tool.

CREATE OR REPLACE FUNCTION public.ai_can_access_project(
  p_user_id uuid,
  p_user_email text,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_plant_name text;
  v_role text;
BEGIN
  -- Establish the user context the get_current_* helpers read from.
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  SELECT organization, modeler_id, plant_name
    INTO v_org, v_modeler, v_plant_name
  FROM public.projects
  WHERE id = p_project_id;

  -- Unknown project -> no access.
  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  -- Must be in the same organization.
  IF v_org IS DISTINCT FROM public.get_current_user_org() THEN
    RETURN false;
  END IF;

  SELECT user_role INTO v_role
  FROM public.get_current_approved_user()
  LIMIT 1;

  -- Owner, admin, or plant-granted viewer (mirrors the projects SELECT policy).
  RETURN (
    v_modeler = public.get_current_user_id()
    OR v_role = 'admin'
    OR v_plant_name IN (
      SELECT upa.plant
      FROM public.user_plant_access upa
      WHERE upa.user_id = public.get_current_user_id()
        AND upa.can_view = true
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_can_access_project(uuid, text, uuid) TO anon, authenticated;
