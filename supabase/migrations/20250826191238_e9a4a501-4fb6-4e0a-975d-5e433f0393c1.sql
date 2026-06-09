-- Create RPC to insert disruption scenarios with proper app context and authorization
CREATE OR REPLACE FUNCTION public.create_disruption_scenario(
  p_project_id uuid,
  p_plant_name text,
  p_node_id text,
  p_scenario_name text,
  p_capacity_reduction_percent numeric,
  p_time_delay_days numeric,
  p_description text,
  p_user_id uuid,
  p_user_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  new_id uuid;
BEGIN
  -- Set user context so helper funcs and RLS checks use caller identity
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  SELECT user_role INTO v_role
  FROM public.get_current_approved_user()
  LIMIT 1;

  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert scenario, ensuring org and creator are set
  INSERT INTO public.disruption_scenarios (
    project_id,
    plant_name,
    node_id,
    scenario_name,
    capacity_reduction_percent,
    time_delay_days,
    description,
    created_by,
    organization
  ) VALUES (
    p_project_id,
    p_plant_name,
    p_node_id,
    p_scenario_name,
    COALESCE(p_capacity_reduction_percent, 0),
    COALESCE(p_time_delay_days, 0),
    p_description,
    p_user_id,
    v_org
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;