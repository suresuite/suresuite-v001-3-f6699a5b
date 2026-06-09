-- Fix parameter defaults issue in create_disruption_scenario_v2
-- All parameters after the first default must also have defaults

-- Disruption Scenario v2 schema redesign
-- 1) Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disruption_status') THEN
    CREATE TYPE public.disruption_status AS ENUM ('draft','active','archived');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disruption_target_type') THEN
    CREATE TYPE public.disruption_target_type AS ENUM ('node','edge');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disruption_effect_type') THEN
    CREATE TYPE public.disruption_effect_type AS ENUM ('capacity_reduction','time_delay');
  END IF;
END $$;

-- 2) Tables
CREATE TABLE IF NOT EXISTS public.disruption_scenario_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  plant_name text NOT NULL,
  scenario_name text NOT NULL,
  status public.disruption_status NOT NULL DEFAULT 'draft',
  description text,
  tags text[] DEFAULT '{}',
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disruption_scenario_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.disruption_scenario_profiles(id) ON DELETE CASCADE,
  target_type public.disruption_target_type NOT NULL,
  node_ids text[],                                  -- for node targets
  edge_list jsonb,                                  -- array of {from_node, to_node}
  selector jsonb,                                   -- optional saved query/criteria
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disruption_scenario_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.disruption_scenario_profiles(id) ON DELETE CASCADE,
  effect_type public.disruption_effect_type NOT NULL,
  magnitude numeric NOT NULL,
  unit text NOT NULL,                               -- validated by trigger per effect_type
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disruption_scenario_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.disruption_scenario_profiles(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  organization text NOT NULL DEFAULT 'default_org',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disruption_setting_unique UNIQUE (profile_id, key)
);

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_dscenario_profiles_project_plant_status ON public.disruption_scenario_profiles(project_id, plant_name, status);
CREATE INDEX IF NOT EXISTS idx_dscenario_targets_profile_type ON public.disruption_scenario_targets(profile_id, target_type);
CREATE INDEX IF NOT EXISTS idx_dscenario_effects_profile_type ON public.disruption_scenario_effects(profile_id, effect_type);
CREATE INDEX IF NOT EXISTS idx_dscenario_settings_profile_key ON public.disruption_scenario_settings(profile_id, key);

-- 4) Triggers: defaults and updated_at
CREATE OR REPLACE FUNCTION public.set_scenario_profile_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_org text;
BEGIN
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.get_current_user_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_scenario_child_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_org text;
BEGIN
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.get_current_user_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_disruption_effect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  unit_ok boolean := false;
BEGIN
  -- Basic validations
  IF NEW.magnitude IS NULL OR NEW.magnitude < 0 THEN
    RAISE EXCEPTION 'Invalid magnitude %', NEW.magnitude;
  END IF;

  -- Validate unit by effect_type
  IF NEW.effect_type = 'capacity_reduction' THEN
    unit_ok := NEW.unit IN ('percent','units');
    IF NEW.unit = 'percent' AND (NEW.magnitude < 0 OR NEW.magnitude > 100) THEN
      RAISE EXCEPTION 'Percent magnitude must be between 0 and 100';
    END IF;
  ELSIF NEW.effect_type = 'time_delay' THEN
    unit_ok := NEW.unit IN ('hours','days','weeks');
  ELSE
    unit_ok := false;
  END IF;

  IF NOT unit_ok THEN
    RAISE EXCEPTION 'Invalid unit % for effect type %', NEW.unit, NEW.effect_type;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach triggers
DROP TRIGGER IF EXISTS set_dscenario_profile_defaults ON public.disruption_scenario_profiles;
CREATE TRIGGER set_dscenario_profile_defaults
  BEFORE INSERT ON public.disruption_scenario_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scenario_profile_defaults();

DROP TRIGGER IF EXISTS update_dscenario_profiles_updated_at ON public.disruption_scenario_profiles;
CREATE TRIGGER update_dscenario_profiles_updated_at
  BEFORE UPDATE ON public.disruption_scenario_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_dscenario_target_defaults ON public.disruption_scenario_targets;
CREATE TRIGGER set_dscenario_target_defaults
  BEFORE INSERT ON public.disruption_scenario_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scenario_child_defaults();

DROP TRIGGER IF EXISTS update_dscenario_targets_updated_at ON public.disruption_scenario_targets;
CREATE TRIGGER update_dscenario_targets_updated_at
  BEFORE UPDATE ON public.disruption_scenario_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_dscenario_effect_defaults ON public.disruption_scenario_effects;
CREATE TRIGGER set_dscenario_effect_defaults
  BEFORE INSERT ON public.disruption_scenario_effects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scenario_child_defaults();

DROP TRIGGER IF EXISTS validate_dscenario_effect ON public.disruption_scenario_effects;
CREATE TRIGGER validate_dscenario_effect
  BEFORE INSERT OR UPDATE ON public.disruption_scenario_effects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_disruption_effect();

DROP TRIGGER IF EXISTS update_dscenario_effects_updated_at ON public.disruption_scenario_effects;
CREATE TRIGGER update_dscenario_effects_updated_at
  BEFORE UPDATE ON public.disruption_scenario_effects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_dscenario_setting_defaults ON public.disruption_scenario_settings;
CREATE TRIGGER set_dscenario_setting_defaults
  BEFORE INSERT ON public.disruption_scenario_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_scenario_child_defaults();

DROP TRIGGER IF EXISTS update_dscenario_settings_updated_at ON public.disruption_scenario_settings;
CREATE TRIGGER update_dscenario_settings_updated_at
  BEFORE UPDATE ON public.disruption_scenario_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5) RLS Policies
ALTER TABLE public.disruption_scenario_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disruption_scenario_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disruption_scenario_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disruption_scenario_settings ENABLE ROW LEVEL SECURITY;

-- Profiles: view within org
DROP POLICY IF EXISTS "Scenario profiles: organization access view" ON public.disruption_scenario_profiles;
CREATE POLICY "Scenario profiles: organization access view"
ON public.disruption_scenario_profiles
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND p.organization = public.get_current_user_org()
));

-- Profiles: modify by owner or admin
DROP POLICY IF EXISTS "Scenario profiles: project access modify" ON public.disruption_scenario_profiles;
CREATE POLICY "Scenario profiles: project access modify"
ON public.disruption_scenario_profiles
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = disruption_scenario_profiles.project_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

-- Targets: view within org via profile/project
DROP POLICY IF EXISTS "Scenario targets: organization access view" ON public.disruption_scenario_targets;
CREATE POLICY "Scenario targets: organization access view"
ON public.disruption_scenario_targets
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND p.organization = public.get_current_user_org()
));

-- Targets: modify by owner or admin via profile/project
DROP POLICY IF EXISTS "Scenario targets: project access modify" ON public.disruption_scenario_targets;
CREATE POLICY "Scenario targets: project access modify"
ON public.disruption_scenario_targets
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_targets.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

-- Effects: view within org via profile/project
DROP POLICY IF EXISTS "Scenario effects: organization access view" ON public.disruption_scenario_effects;
CREATE POLICY "Scenario effects: organization access view"
ON public.disruption_scenario_effects
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND p.organization = public.get_current_user_org()
));

-- Effects: modify by owner or admin via profile/project
DROP POLICY IF EXISTS "Scenario effects: project access modify" ON public.disruption_scenario_effects;
CREATE POLICY "Scenario effects: project access modify"
ON public.disruption_scenario_effects
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_effects.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

-- Settings: view within org via profile/project
DROP POLICY IF EXISTS "Scenario settings: organization access view" ON public.disruption_scenario_settings;
CREATE POLICY "Scenario settings: organization access view"
ON public.disruption_scenario_settings
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND p.organization = public.get_current_user_org()
));

-- Settings: modify by owner or admin via profile/project
DROP POLICY IF EXISTS "Scenario settings: project access modify" ON public.disruption_scenario_settings;
CREATE POLICY "Scenario settings: project access modify"
ON public.disruption_scenario_settings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.disruption_scenario_profiles sp
  JOIN public.projects p ON p.id = sp.project_id
  WHERE sp.id = disruption_scenario_settings.profile_id
    AND p.organization = public.get_current_user_org()
    AND (p.modeler_id = public.get_current_user_id() OR (
      SELECT g.user_role FROM public.get_current_approved_user() g LIMIT 1
    ) = 'admin')
));

-- 6) RPC to create scenario with targets/effects/settings
-- FIXED: Put all parameters with defaults at the end
CREATE OR REPLACE FUNCTION public.create_disruption_scenario_v2(
  p_project_id uuid,
  p_plant_name text,
  p_scenario_name text,
  p_user_id uuid,
  p_user_email text,
  p_status public.disruption_status DEFAULT 'draft',
  p_description text DEFAULT NULL,
  p_tags text[] DEFAULT '{}',
  p_targets jsonb DEFAULT NULL,
  p_effects jsonb DEFAULT NULL,
  p_settings jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Insert profile
  INSERT INTO public.disruption_scenario_profiles (
    project_id, plant_name, scenario_name, status, description, tags, created_by, organization
  ) VALUES (
    p_project_id, p_plant_name, p_scenario_name, COALESCE(p_status, 'draft'), p_description, COALESCE(p_tags, '{}'), p_user_id, v_org
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
$$;

-- 7) Backfill from legacy disruption_scenarios table if it exists
DO $$
DECLARE
  r record;
  new_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'disruption_scenarios'
  ) THEN
    FOR r IN 
      SELECT id, project_id, plant_name, node_id, scenario_name, capacity_reduction_percent, time_delay_days, description, created_by, organization, created_at, updated_at
      FROM public.disruption_scenarios
    LOOP
      INSERT INTO public.disruption_scenario_profiles (
        project_id, plant_name, scenario_name, status, description, tags, created_by, organization, created_at, updated_at
      ) VALUES (
        r.project_id, r.plant_name, r.scenario_name, 'active', r.description, '{}', r.created_by, r.organization, r.created_at, r.updated_at
      ) RETURNING id INTO new_id;

      -- Target: node list with single node
      INSERT INTO public.disruption_scenario_targets (profile_id, target_type, node_ids)
      VALUES (new_id, 'node', ARRAY[r.node_id]);

      -- Effect: capacity reduction if present
      IF r.capacity_reduction_percent IS NOT NULL AND r.capacity_reduction_percent > 0 THEN
        INSERT INTO public.disruption_scenario_effects (profile_id, effect_type, magnitude, unit)
        VALUES (new_id, 'capacity_reduction', r.capacity_reduction_percent, 'percent');
      END IF;

      -- Effect: time delay if present
      IF r.time_delay_days IS NOT NULL AND r.time_delay_days > 0 THEN
        INSERT INTO public.disruption_scenario_effects (profile_id, effect_type, magnitude, unit)
        VALUES (new_id, 'time_delay', r.time_delay_days, 'days');
      END IF;
    END LOOP;
  END IF;
END $$;

-- End of migration