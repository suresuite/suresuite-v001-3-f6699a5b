-- Fix disruption scenarios trigger issue
-- The disruption_scenarios table uses 'created_by' not 'uploaded_by'

-- Create proper trigger function for disruption_scenarios
CREATE OR REPLACE FUNCTION public.set_disruption_scenario_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_org text;
BEGIN
  -- Get user's organization and set it
  current_org := public.get_current_user_org();
  IF current_org IS NOT NULL THEN
    NEW.organization := current_org;
  END IF;
  
  -- Set created_by to current user if not set (note: created_by, not uploaded_by)
  IF NEW.created_by IS NULL THEN
    NEW.created_by := public.get_current_user_id();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop any existing triggers on disruption_scenarios that might be causing the issue
DROP TRIGGER IF EXISTS set_disruption_scenarios_defaults ON public.disruption_scenarios;
DROP TRIGGER IF EXISTS set_supply_chain_data_defaults_trigger ON public.disruption_scenarios;
DROP TRIGGER IF EXISTS update_disruption_scenarios_updated_at ON public.disruption_scenarios;

-- Create proper triggers for disruption_scenarios
CREATE TRIGGER set_disruption_scenarios_defaults
  BEFORE INSERT ON public.disruption_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.set_disruption_scenario_defaults();

CREATE TRIGGER update_disruption_scenarios_updated_at
  BEFORE UPDATE ON public.disruption_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();