-- Create RPC function to delete a single simulation result
CREATE OR REPLACE FUNCTION public.delete_simulation_result(
  p_simulation_id uuid,
  p_user_id uuid,
  p_user_email text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate simulation exists and get project info for authorization
  SELECT p.organization, p.modeler_id INTO v_org, v_modeler
  FROM public.simulation_results sr
  JOIN public.projects p ON p.id = sr.project_id
  WHERE sr.id = p_simulation_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'simulation_not_found';
  END IF;

  -- Authorization: same org AND (project owner or admin)
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Delete the simulation result
  DELETE FROM public.simulation_results WHERE id = p_simulation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'simulation_not_found';
  END IF;
END;
$function$;

-- Create RPC function to delete multiple simulation results
CREATE OR REPLACE FUNCTION public.delete_simulation_results_batch(
  p_simulation_ids uuid[],
  p_user_id uuid,
  p_user_email text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  deleted_count integer := 0;
  sim_id uuid;
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Get user role once
  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  
  -- Delete each simulation with proper authorization check
  FOREACH sim_id IN ARRAY p_simulation_ids LOOP
    -- Check authorization for this specific simulation
    SELECT p.organization, p.modeler_id INTO v_org, v_modeler
    FROM public.simulation_results sr
    JOIN public.projects p ON p.id = sr.project_id
    WHERE sr.id = sim_id;

    -- Skip if simulation not found or not authorized
    IF v_org IS NULL OR 
       v_org <> public.get_current_user_org() OR 
       NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
      CONTINUE;
    END IF;

    -- Delete the simulation result
    DELETE FROM public.simulation_results WHERE id = sim_id;
    IF FOUND THEN
      deleted_count := deleted_count + 1;
    END IF;
  END LOOP;

  RETURN deleted_count;
END;
$function$;