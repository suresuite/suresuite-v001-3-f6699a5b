-- Create function to delete individual disruption scenario
CREATE OR REPLACE FUNCTION public.delete_disruption_scenario(p_scenario_id uuid, p_user_id uuid, p_user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  v_project_id uuid;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get project info from the scenario
  SELECT dsp.project_id, p.organization, p.modeler_id 
  INTO v_project_id, v_org, v_modeler
  FROM public.disruption_scenario_profiles dsp
  JOIN public.projects p ON p.id = dsp.project_id
  WHERE dsp.id = p_scenario_id;

  IF v_org IS NULL THEN 
    RAISE EXCEPTION 'scenario_not_found'; 
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete the scenario (cascading deletes will handle related tables)
  DELETE FROM public.disruption_scenario_profiles 
  WHERE id = p_scenario_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario_not_found';
  END IF;
END;
$$;