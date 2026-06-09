-- Add disruption event start and end dates to disruption_scenario_profiles table
ALTER TABLE public.disruption_scenario_profiles 
ADD COLUMN disruption_start date,
ADD COLUMN disruption_end date;

-- Update the create_disruption_scenario_v2 function to include disruption dates
CREATE OR REPLACE FUNCTION public.create_disruption_scenario_v2(
  p_project_id uuid, 
  p_plant_name text, 
  p_scenario_name text, 
  p_user_id uuid, 
  p_user_email text, 
  p_status disruption_status DEFAULT 'draft'::disruption_status, 
  p_description text DEFAULT NULL::text, 
  p_tags text[] DEFAULT '{}'::text[], 
  p_targets jsonb DEFAULT NULL::jsonb, 
  p_effects jsonb DEFAULT NULL::jsonb, 
  p_settings jsonb DEFAULT NULL::jsonb,
  p_disruption_start date DEFAULT NULL::date,
  p_disruption_end date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_modeler uuid;
  v_role text;
  new_profile_id uuid;
  t jsonb;
  e jsonb;
  k text;
  v jsonb;
BEGIN
  -- Set user context
  PERFORM public.set_current_user_context(p_user_id, p_user_email);

  -- Validate project and authorization
  SELECT organization, modeler_id INTO v_org, v_modeler
  FROM public.projects
  WHERE id = p_project_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'project_not_found'; END IF;

  SELECT user_role INTO v_role FROM public.get_current_approved_user() LIMIT 1;
  IF v_org <> public.get_current_user_org() OR NOT (v_modeler = public.get_current_user_id() OR v_role = 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Insert profile with disruption dates
  INSERT INTO public.disruption_scenario_profiles (
    project_id, plant_name, scenario_name, status, description, tags, 
    created_by, organization, disruption_start, disruption_end
  ) VALUES (
    p_project_id, p_plant_name, p_scenario_name, COALESCE(p_status, 'draft'), 
    p_description, COALESCE(p_tags, '{}'), p_user_id, v_org, 
    p_disruption_start, p_disruption_end
  ) RETURNING id INTO new_profile_id;

  -- Insert targets
  IF p_targets IS NOT NULL AND jsonb_typeof(p_targets) = 'array' THEN
    FOR t IN SELECT * FROM jsonb_array_elements(p_targets) LOOP
      INSERT INTO public.disruption_scenario_targets (
        profile_id, target_type, node_ids, edge_list, selector
      ) VALUES (
        new_profile_id,
        COALESCE((t->>'target_type')::public.disruption_target_type, 'node'),
        CASE WHEN (t ? 'node_ids') THEN ARRAY(SELECT jsonb_array_elements_text(t->'node_ids')) ELSE NULL END,
        CASE WHEN (t ? 'edges') THEN t->'edges' ELSE NULL END,
        CASE WHEN (t ? 'selector') THEN t->'selector' ELSE NULL END
      );
    END LOOP;
  END IF;

  -- Insert effects
  IF p_effects IS NOT NULL AND jsonb_typeof(p_effects) = 'array' THEN
    FOR e IN SELECT * FROM jsonb_array_elements(p_effects) LOOP
      INSERT INTO public.disruption_scenario_effects (
        profile_id, effect_type, magnitude, unit
      ) VALUES (
        new_profile_id,
        (e->>'effect_type')::public.disruption_effect_type,
        COALESCE((e->>'magnitude')::numeric, 0),
        (e->>'unit')
      );
    END LOOP;
  END IF;

  -- Insert settings: accept object map or array of {key,value}
  IF p_settings IS NOT NULL THEN
    IF jsonb_typeof(p_settings) = 'object' THEN
      FOR k, v IN SELECT key, value FROM jsonb_each(p_settings) LOOP
        INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
        VALUES (new_profile_id, k, v)
        ON CONFLICT (profile_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END LOOP;
    ELSIF jsonb_typeof(p_settings) = 'array' THEN
      FOR e IN SELECT * FROM jsonb_array_elements(p_settings) LOOP
        INSERT INTO public.disruption_scenario_settings (profile_id, key, value)
        VALUES (new_profile_id, e->>'key', COALESCE(e->'value', 'null'::jsonb))
        ON CONFLICT (profile_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END LOOP;
    END IF;
  END IF;

  RETURN new_profile_id;
END;
$function$;