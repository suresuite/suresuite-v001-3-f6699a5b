
CREATE TABLE public.recovery_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_playbooks_project_idx ON public.recovery_playbooks(project_id);
CREATE INDEX recovery_playbooks_system_idx ON public.recovery_playbooks(is_system);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recovery_playbooks TO authenticated;
GRANT ALL ON public.recovery_playbooks TO service_role;

ALTER TABLE public.recovery_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playbooks_select_all_auth"
  ON public.recovery_playbooks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "playbooks_insert_own"
  ON public.recovery_playbooks FOR INSERT
  TO authenticated
  WITH CHECK (
    is_system = false
    AND project_id IS NOT NULL
    AND created_by = auth.uid()
  );

CREATE POLICY "playbooks_update_own"
  ON public.recovery_playbooks FOR UPDATE
  TO authenticated
  USING (is_system = false AND created_by = auth.uid())
  WITH CHECK (is_system = false AND created_by = auth.uid());

CREATE POLICY "playbooks_delete_own"
  ON public.recovery_playbooks FOR DELETE
  TO authenticated
  USING (is_system = false AND created_by = auth.uid());

CREATE TRIGGER recovery_playbooks_updated_at
  BEFORE UPDATE ON public.recovery_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.scenarios
  ADD COLUMN recovery_playbook_id uuid REFERENCES public.recovery_playbooks(id) ON DELETE SET NULL;

-- Seed system playbooks
INSERT INTO public.recovery_playbooks (project_id, name, description, is_system, config) VALUES
  (NULL, 'None', 'No recovery actions; baseline disruption impact.', true, '{"responses":[],"triggers":[],"detection_lag_days":0,"cost_cap":0,"target_recovery_days":0}'::jsonb),
  (NULL, 'Lean', 'Minimal, low-cost responses prioritizing inventory smoothing.', true, '{"responses":["safety_stock_boost"],"triggers":["fill_rate_drop"],"detection_lag_days":3,"cost_cap":5000,"target_recovery_days":14}'::jsonb),
  (NULL, 'Aggressive', 'Fast, high-cost recovery using expedited freight and reroutes.', true, '{"responses":["expedite_freight","reroute","safety_stock_boost"],"triggers":["lead_time_spike","fill_rate_drop"],"detection_lag_days":1,"cost_cap":50000,"target_recovery_days":5}'::jsonb),
  (NULL, 'Cost-capped reroute', 'Reroute first, but stop spending once cost cap is hit.', true, '{"responses":["reroute"],"triggers":["lead_time_spike"],"detection_lag_days":2,"cost_cap":15000,"target_recovery_days":10}'::jsonb),
  (NULL, 'Dual-source first', 'Activate secondary suppliers before paying for expedites.', true, '{"responses":["dual_source","safety_stock_boost"],"triggers":["supplier_outage"],"detection_lag_days":2,"cost_cap":20000,"target_recovery_days":12}'::jsonb),
  (NULL, 'Demand-side flex', 'Throttle promotions and shift demand instead of pushing supply.', true, '{"responses":["demand_shift","promo_throttle"],"triggers":["fill_rate_drop"],"detection_lag_days":2,"cost_cap":8000,"target_recovery_days":10}'::jsonb);
