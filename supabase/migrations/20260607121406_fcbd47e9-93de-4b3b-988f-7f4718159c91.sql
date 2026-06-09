
CREATE TABLE public.scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  horizon_days integer NOT NULL DEFAULT 90,
  time_step text NOT NULL DEFAULT 'day',
  warmup_mode text NOT NULL DEFAULT 'auto',
  warmup_days integer NOT NULL DEFAULT 14,
  replications integer NOT NULL DEFAULT 10,
  seed bigint NOT NULL DEFAULT 42,
  crn boolean NOT NULL DEFAULT true,
  demand_model jsonb NOT NULL DEFAULT '{"kind":"poisson","lambda":50}'::jsonb,
  disruption_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  recovery_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  stopping_rule jsonb NOT NULL DEFAULT '{"kind":"fixed_horizon","max_wall_seconds":600}'::jsonb,
  primary_kpi text NOT NULL DEFAULT 'fill_rate',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;
GRANT ALL ON public.scenarios TO service_role;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scenarios_auth_all" ON public.scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER scenarios_updated_at BEFORE UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX scenarios_project_idx ON public.scenarios(project_id);

CREATE TABLE public.simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  policy_hash text DEFAULT '',
  code_version text DEFAULT '',
  aggregate_kpis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ci_half_widths jsonb NOT NULL DEFAULT '{}'::jsonb,
  warmup_detected_at integer,
  rep_count_target integer NOT NULL DEFAULT 0,
  rep_count_done integer NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.simulation_runs TO authenticated;
GRANT ALL ON public.simulation_runs TO service_role;
ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sim_runs_auth_all" ON public.simulation_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER sim_runs_updated_at BEFORE UPDATE ON public.simulation_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX sim_runs_scenario_idx ON public.simulation_runs(scenario_id);
CREATE INDEX sim_runs_project_idx ON public.simulation_runs(project_id);

CREATE TABLE public.run_replications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.simulation_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rep_index integer NOT NULL,
  seed_used bigint NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  kpis jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_series jsonb NOT NULL DEFAULT '{}'::jsonb,
  warmup_at integer,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_replications TO authenticated;
GRANT ALL ON public.run_replications TO service_role;
ALTER TABLE public.run_replications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep_auth_all" ON public.run_replications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX rep_run_idx ON public.run_replications(run_id);
CREATE UNIQUE INDEX rep_run_index_uq ON public.run_replications(run_id, rep_index);

CREATE TABLE public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  design_type text NOT NULL DEFAULT 'factorial',
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experiments TO authenticated;
GRANT ALL ON public.experiments TO service_role;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "experiments_auth_all" ON public.experiments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER experiments_updated_at BEFORE UPDATE ON public.experiments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX experiments_project_idx ON public.experiments(project_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.simulation_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.run_replications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scenarios;
