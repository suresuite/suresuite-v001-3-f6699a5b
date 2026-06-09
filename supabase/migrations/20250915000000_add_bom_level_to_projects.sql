-- Add bom_level to projects and update project creation/update functions
BEGIN;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS bom_level text DEFAULT 'single';

CREATE OR REPLACE FUNCTION public.create_project(
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  INSERT INTO public.projects (name, plant_name, supply_chain_model, bom_level, modeler_id, modeler_name)
  VALUES (p_name, p_plant, p_model, p_bom_level, p_user_id, p_user_name)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_project(
  p_project_id uuid,
  p_name text,
  p_plant text,
  p_model text,
  p_bom_level text,
  p_user_id uuid,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  UPDATE public.projects
  SET name = p_name,
      plant_name = p_plant,
      supply_chain_model = p_model,
      bom_level = p_bom_level,
      updated_at = now()
  WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;
END;
$function$;

COMMIT;

