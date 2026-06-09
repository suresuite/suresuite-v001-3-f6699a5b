-- Fix disruption bridge: wire network disruption_scenarios to the correct
-- scenarios table (the one SimulationLab reads) and drop the orphaned
-- sim_scenarios table that was created by mistake in migration 20260609000003.

-- 1. Add from_network badge column to the real scenarios table
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS from_network boolean NOT NULL DEFAULT false;

-- 2. Drop the orphaned sim_scenarios table (never read by any UI component)
DROP TABLE IF EXISTS public.sim_scenarios CASCADE;

-- 3. Replace the trigger function to write into scenarios (not sim_scenarios).
--    Column mapping:
--      disruption_scenarios.project_id     → scenarios.project_id
--      disruption_scenarios.scenario_name  → scenarios.name
--      disruption_scenarios.description    → scenarios.description
--      disruption_scenarios.sim_payload    → scenarios.disruption_schedule (wrapped in array)
--      disruption_scenarios.created_by     → scenarios.created_by
--      horizon 52 weeks                   → scenarios.horizon_days = 364
--      warmup  15 weeks                   → scenarios.warmup_days  = 105
--      from_network                        → true (badge for SimulationLab)

CREATE OR REPLACE FUNCTION public.sync_disruption_to_sim_scenario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.scenarios (
    project_id,
    name,
    description,
    horizon_days,
    warmup_days,
    replications,
    seed,
    crn,
    disruption_schedule,
    recovery_overrides,
    stopping_rule,
    primary_kpi,
    from_network,
    created_by
  )
  VALUES (
    NEW.project_id,
    COALESCE(NEW.scenario_name, 'Disruption: ' || NEW.node_id),
    COALESCE(NEW.description, ''),
    364,    -- 52 weeks × 7 days
    105,    -- 15 weeks × 7 days (warmup)
    30,
    42,
    true,
    jsonb_build_array(
      jsonb_build_object(
        'target',        NEW.node_id,
        'target_type',   'node',
        'start_day',     COALESCE((NEW.time_delay_days)::int, 0),
        'duration_days', COALESCE(NEW.capacity_reduction_percent::int * 1, 42),
        'magnitude_pct', COALESCE(NEW.capacity_reduction_percent, 0)
      )
    ),
    '{}'::jsonb,
    '{"kind":"fixed_horizon","max_wall_seconds":600}'::jsonb,
    'fill_rate',
    true,
    NEW.created_by
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Re-attach the trigger (drop + recreate to refresh function reference)
DROP TRIGGER IF EXISTS trg_sync_disruption_to_sim_scenario ON public.disruption_scenarios;
CREATE TRIGGER trg_sync_disruption_to_sim_scenario
  AFTER INSERT OR UPDATE ON public.disruption_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_disruption_to_sim_scenario();
