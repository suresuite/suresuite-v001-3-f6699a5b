
-- Create an RPC that updates magnitude by profile_id with proper RLS context and authorization
CREATE OR REPLACE FUNCTION public.update_scenario_effect_magnitude_by_profile(
  p_profile_id uuid,
  p_user_id uuid,
  p_user_email text,
  p_magnitude numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_role text;
BEGIN
  -- Establish caller context for RLS helper functions
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Authorization: same org AND (project owner or admin)
  IF NOT EXISTS (
    SELECT 1
    FROM public.disruption_scenario_profiles sp
    JOIN public.projects p ON p.id = sp.project_id
    WHERE sp.id = p_profile_id
      AND p.organization = public.get_current_user_org()
      AND (
        p.modeler_id = public.get_current_user_id()
        OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
      )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Update magnitude for all effects belonging to the profile_id
  UPDATE public.disruption_scenario_effects dse
  SET magnitude = p_magnitude,
      updated_at = now()
  WHERE dse.profile_id = p_profile_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
