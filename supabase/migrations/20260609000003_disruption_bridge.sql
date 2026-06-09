-- disruption_bridge: links disruption_scenarios → sim engine payloads.
--
-- Adds a JSONB column to disruption_scenarios so the sim-worker can read
-- a structured { lever, magnitude, start_week, end_week } payload directly,
-- and keeps it in sync via trigger.
--
-- Also creates a scenarios table for the SimulationLab if not already present.

-- Add structured payload column to disruption_scenarios
ALTER TABLE public.disruption_scenarios
  ADD COLUMN IF NOT EXISTS sim_payload jsonb GENERATED ALWAYS AS (
    jsonb_build_object(
      'lever',      'node:' || node_id,
      'magnitude',  capacity_reduction_percent,
      'time_delay_weeks', ROUND(time_delay_days / 7.0, 2),
      'description', description
    )
  ) STORED;

-- Add "from_network" badge flag so SimulationLab can show the origin
ALTER TABLE public.disruption_scenarios
  ADD COLUMN IF NOT EXISTS from_network boolean NOT NULL DEFAULT true;

-- scenarios table for the SimulationLab (if not exists)
CREATE TABLE IF NOT EXISTS public.sim_scenarios (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  description      text,
  horizon_weeks    integer     NOT NULL DEFAULT 52,
  warmup_weeks     integer     NOT NULL DEFAULT 15,
  replications     integer     NOT NULL DEFAULT 30,
  seed             integer     NOT NULL DEFAULT 42,
  disruption_schedule jsonb    NOT NULL DEFAULT '[]'::jsonb,
  recovery_overrides  jsonb    NOT NULL DEFAULT '{}'::jsonb,
  from_network     boolean     NOT NULL DEFAULT false,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_scenarios_project
  ON public.sim_scenarios(project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sim_scenarios TO authenticated;
GRANT ALL ON public.sim_scenarios TO service_role;

ALTER TABLE public.sim_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project scenarios"
  ON public.sim_scenarios FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = sim_scenarios.project_id
        AND (p.modeler_id = auth.uid()
             OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin')
    )
  );

-- Function: sync a disruption_scenario into sim_scenarios
-- Called automatically by trigger on INSERT/UPDATE of disruption_scenarios.
CREATE OR REPLACE FUNCTION public.sync_disruption_to_sim_scenario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.sim_scenarios (
    project_id,
    name,
    description,
    horizon_weeks,
    warmup_weeks,
    disruption_schedule,
    from_network,
    created_by
  )
  VALUES (
    NEW.project_id,
    COALESCE(NEW.scenario_name, 'Disruption: ' || NEW.node_id),
    NEW.description,
    52,
    15,
    jsonb_build_array(NEW.sim_payload),
    true,
    NEW.created_by
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_disruption_to_sim_scenario ON public.disruption_scenarios;
CREATE TRIGGER trg_sync_disruption_to_sim_scenario
  AFTER INSERT OR UPDATE ON public.disruption_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_disruption_to_sim_scenario();

-- updated_at
CREATE OR REPLACE TRIGGER trg_sim_scenarios_updated_at
  BEFORE UPDATE ON public.sim_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
