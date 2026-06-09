
-- Extend policy_defaults with production + recovery + preset link
ALTER TABLE public.policy_defaults
  ADD COLUMN IF NOT EXISTS production jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recovery   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preset_id  uuid;

-- Presets catalog
CREATE TABLE public.policy_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, owner_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_presets TO authenticated;
GRANT ALL ON public.policy_presets TO service_role;

ALTER TABLE public.policy_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read system presets"
  ON public.policy_presets FOR SELECT TO authenticated
  USING (is_system = true OR owner_id = auth.uid());

CREATE POLICY "Users can create their own presets"
  ON public.policy_presets FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_system = false);

CREATE POLICY "Users can update their own presets"
  ON public.policy_presets FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete their own presets"
  ON public.policy_presets FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE TRIGGER trg_policy_presets_updated_at
  BEFORE UPDATE ON public.policy_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the 7 system presets
INSERT INTO public.policy_presets (slug, name, description, is_system, bundle) VALUES
('lean_jit', 'Lean / JIT', 'Low safety stock, daily review, single-source, FTL, no backorder.', true, '{
  "sourcing":{"strategy":"single","failover_threshold_pct":15},
  "inventory":{"type":"continuous_review","reorder_point":20,"order_up_to":80,"safety_stock_days":2,"review_period_days":1,"abc_class":"A"},
  "transport":{"mode":"road","lead_time_mean_days":2,"lead_time_std_days":0.3,"load_type":"FTL","min_fill_pct":85,"routing":"direct"},
  "fulfillment":{"allocation":"priority","backorder_allowed":false,"service_level_alpha":0.92,"service_level_beta":0.98},
  "production":{"lot_policy":"lot_for_lot","capacity_units_per_day":1000,"utilization_cap_pct":85,"scheduling":"fifo"},
  "recovery":{"enabled":false,"response":[],"detection_lag_days":1,"recovery_target_days":30}
}'::jsonb),
('resilient', 'Resilient', '14-day safety stock, dual-source 70/30, primary+backup, mode-shift recovery.', true, '{
  "sourcing":{"strategy":"dual_sourcing","ratios":{"primary":0.7,"backup":0.3},"failover_threshold_pct":20,"min_reliability":0.9},
  "inventory":{"type":"min_max","reorder_point":80,"order_up_to":300,"safety_stock_days":14,"safety_stock_method":"service_level","review_period_days":1,"abc_class":"A"},
  "transport":{"mode":"road","lead_time_mean_days":3,"lead_time_std_days":0.6,"load_type":"FTL","routing":"direct"},
  "fulfillment":{"allocation":"sla_tier","backorder_allowed":true,"max_backorder_days":10,"service_level_alpha":0.97,"service_level_beta":0.99},
  "production":{"lot_policy":"epq","capacity_units_per_day":1200,"utilization_cap_pct":80,"scheduling":"critical_ratio"},
  "recovery":{"enabled":true,"response":["dual_source_activate","mode_shift","safety_stock_drawdown"],"detection_lag_days":1,"recovery_target_days":14,"cost_cap":50000}
}'::jsonb),
('cost_optimized', 'Cost-optimized', 'EOQ inventory, milk-run routing, weekly consolidation, LTL.', true, '{
  "sourcing":{"strategy":"single","contract_type":"contract","order_consolidation":"weekly"},
  "inventory":{"type":"s_S","reorder_point":60,"order_up_to":400,"safety_stock_days":5,"holding_cost_pct":0.18,"ordering_cost":250},
  "transport":{"mode":"road","lead_time_mean_days":4,"load_type":"LTL","min_fill_pct":60,"routing":"milk_run","cost_per_unit":0.6},
  "fulfillment":{"allocation":"proportional","backorder_allowed":true,"max_backorder_days":21,"service_level_alpha":0.9},
  "production":{"lot_policy":"epq","scheduling":"spt","setup_cost":1500},
  "recovery":{"enabled":true,"response":["safety_stock_drawdown"],"cost_cap":10000,"recovery_target_days":45}
}'::jsonb),
('service_first', 'Service-first', '99% SLA, large safety stock, fair-share allocation, air backup mode.', true, '{
  "sourcing":{"strategy":"primary_backup","failover_threshold_pct":10,"min_reliability":0.95},
  "inventory":{"type":"base_stock","reorder_point":150,"order_up_to":500,"safety_stock_days":21,"safety_stock_method":"service_level"},
  "transport":{"mode":"road","lead_time_mean_days":2,"lead_time_std_days":0.4,"load_type":"FTL","routing":"direct"},
  "fulfillment":{"allocation":"fair_share","backorder_allowed":true,"max_backorder_days":3,"service_level_alpha":0.99,"service_level_beta":0.995},
  "production":{"lot_policy":"fixed","utilization_cap_pct":75,"scheduling":"edd"},
  "recovery":{"enabled":true,"response":["mode_shift","dual_source_activate"],"detection_lag_days":0,"recovery_target_days":7,"cost_cap":200000}
}'::jsonb),
('sustainable', 'Sustainable', 'Sea/rail bias, large batches, low cost-per-km, carbon-capped routing.', true, '{
  "sourcing":{"strategy":"multi","ratios":{"local":0.6,"regional":0.4},"order_consolidation":"weekly"},
  "inventory":{"type":"periodic_review","review_period_days":7,"safety_stock_days":10},
  "transport":{"mode":"sea","lead_time_mean_days":21,"lead_time_std_days":2.5,"load_type":"container","routing":"hub_spoke","carbon_intensity_kg_per_tkm":0.015,"cost_per_km":1.2},
  "fulfillment":{"allocation":"proportional","backorder_allowed":true,"max_backorder_days":30,"service_level_alpha":0.92},
  "production":{"lot_policy":"epq","utilization_cap_pct":78,"scheduling":"fifo"},
  "recovery":{"enabled":true,"response":["safety_stock_drawdown","demand_shaping"],"recovery_target_days":60}
}'::jsonb),
('agile_high_mix', 'Agile / High-mix', 's,S with short review, multi-source, parcel + LTL mix.', true, '{
  "sourcing":{"strategy":"multi","ratios":{"a":0.4,"b":0.35,"c":0.25},"order_consolidation":"daily"},
  "inventory":{"type":"s_S","reorder_point":40,"order_up_to":160,"safety_stock_days":4,"review_period_days":1,"abc_class":"B"},
  "transport":{"mode":"road","lead_time_mean_days":2,"load_type":"parcel","routing":"direct","cost_per_unit":1.8},
  "fulfillment":{"allocation":"priority","backorder_allowed":true,"max_backorder_days":5,"service_level_alpha":0.95},
  "production":{"lot_policy":"lot_for_lot","setup_time_hours":0.5,"scheduling":"critical_ratio"},
  "recovery":{"enabled":true,"response":["reroute","dual_source_activate"],"detection_lag_days":1,"recovery_target_days":10}
}'::jsonb),
('make_to_order', 'Make-to-order', 'Base-stock=0, priority allocation, full backorder, lot-for-lot production.', true, '{
  "sourcing":{"strategy":"single","contract_type":"spot"},
  "inventory":{"type":"base_stock","reorder_point":0,"order_up_to":0,"safety_stock_days":0},
  "transport":{"mode":"road","lead_time_mean_days":3,"load_type":"LTL","routing":"direct"},
  "fulfillment":{"allocation":"priority","backorder_allowed":true,"max_backorder_days":60,"service_level_alpha":0.85},
  "production":{"lot_policy":"lot_for_lot","scheduling":"edd","setup_time_hours":1.0},
  "recovery":{"enabled":false,"response":[]}
}'::jsonb);
