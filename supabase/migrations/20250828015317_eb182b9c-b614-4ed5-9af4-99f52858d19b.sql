-- Update get_disruption_scenarios function to include disruption dates
CREATE OR REPLACE FUNCTION public.get_disruption_scenarios(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text)
 RETURNS TABLE(id uuid, scenario_name text, description text, status disruption_status, created_at timestamp with time zone, disruption_start date, disruption_end date, targets jsonb, effects jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Set user context for RLS policies
  PERFORM public.set_current_user_context(p_user_id, p_user_email);
  
  -- Return scenario profiles with their targets, effects, and disruption dates
  RETURN QUERY
  SELECT 
    dsp.id,
    dsp.scenario_name,
    dsp.description,
    dsp.status,
    dsp.created_at,
    dsp.disruption_start,
    dsp.disruption_end,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'target_type', dst.target_type,
          'node_ids', dst.node_ids,
          'edge_list', dst.edge_list
        )
      )
      FROM disruption_scenario_targets dst 
      WHERE dst.profile_id = dsp.id),
      '[]'::jsonb
    ) as targets,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'effect_type', dse.effect_type,
          'magnitude', dse.magnitude,
          'unit', dse.unit
        )
      )
      FROM disruption_scenario_effects dse 
      WHERE dse.profile_id = dsp.id),
      '[]'::jsonb
    ) as effects
  FROM disruption_scenario_profiles dsp
  WHERE dsp.project_id = p_project_id
    AND (p_plant_name IS NULL OR dsp.plant_name = p_plant_name)
  ORDER BY dsp.created_at DESC;
END;
$function$