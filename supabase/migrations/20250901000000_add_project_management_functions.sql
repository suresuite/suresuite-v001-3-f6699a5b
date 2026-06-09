BEGIN;

CREATE OR REPLACE FUNCTION public.delete_project(
  p_project_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  DELETE FROM public.projects
  WHERE id = p_project_id
    AND organization = public.get_current_user_org();
END;
$$;

CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid,
  p_name text,
  p_plant text,
  p_model text,
  p_user_id uuid,
  p_user_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  UPDATE public.projects
  SET name = p_name,
      plant_name = p_plant,
      supply_chain_model = p_model
  WHERE id = p_project_id
    AND organization = public.get_current_user_org();
END;
$$;

COMMIT;
