-- scenario_templates: pre-built disruption scenarios users can clone with one click.
-- Eliminates the need to manually configure disruption parameters from scratch.

CREATE TABLE IF NOT EXISTS public.scenario_templates (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text        NOT NULL UNIQUE,
  name                    text        NOT NULL,
  description             text        NOT NULL DEFAULT '',
  category                text        NOT NULL CHECK (category IN ('supplier','logistics','demand','production','geopolitical')),
  severity                text        NOT NULL CHECK (severity IN ('low','medium','high','extreme')),
  icon                    text,                        -- lucide icon name or emoji
  disruption_schedule     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  suggested_playbook_name text,                        -- matches name in recovery_playbooks
  horizon_days            integer     NOT NULL DEFAULT 91,
  warmup_days             integer     NOT NULL DEFAULT 14,
  replications            integer     NOT NULL DEFAULT 30,
  seed                    integer     NOT NULL DEFAULT 42,
  is_system               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scenario_templates TO authenticated, service_role;

ALTER TABLE public.scenario_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read system templates"
  ON public.scenario_templates FOR SELECT TO authenticated
  USING (is_system = true);

-- ── Seed: 12 pre-built scenarios ────────────────────────────────────────────

INSERT INTO public.scenario_templates
  (slug, name, description, category, severity, icon, disruption_schedule,
   suggested_playbook_name, horizon_days, warmup_days, replications, seed)
VALUES

-- Supplier disruptions
(
  'supplier_outage_single',
  'Single Supplier Outage',
  'Primary supplier drops to 40% capacity for 6 weeks — a common scenario for single-sourced components after a factory fire, quality hold, or labour dispute.',
  'supplier', 'medium', 'Factory',
  '[{"target":"primary_supplier","target_type":"node","start_day":14,"duration_days":42,"magnitude_pct":60}]'::jsonb,
  'Activate Backup Supplier', 182, 28, 30, 42
),
(
  'supplier_bankruptcy',
  'Supplier Bankruptcy',
  'Primary supplier goes offline completely for 12 weeks. Models the worst-case qualification and re-sourcing timeline.',
  'supplier', 'extreme', 'AlertTriangle',
  '[{"target":"primary_supplier","target_type":"node","start_day":7,"duration_days":84,"magnitude_pct":100}]'::jsonb,
  'Full Resilience Response', 364, 28, 30, 42
),
(
  'dual_supplier_stress',
  'Dual Supplier Stress Test',
  'Both primary and backup suppliers simultaneously hit 50% capacity for 4 weeks. Tests whether your dual-source strategy truly provides resilience.',
  'supplier', 'high', 'Zap',
  '[{"target":"primary_supplier","target_type":"node","start_day":14,"duration_days":28,"magnitude_pct":50},{"target":"backup_supplier","target_type":"node","start_day":14,"duration_days":28,"magnitude_pct":50}]'::jsonb,
  'Capacity Surge', 182, 28, 30, 42
),

-- Logistics disruptions
(
  'port_congestion',
  'Port Congestion',
  'All inbound lead times extend by ~2 weeks for 8 weeks — mimics a major port backlog event. Fill rate drops as scheduled receipts arrive late.',
  'logistics', 'medium', 'Ship',
  '[{"target":"inbound_logistics","target_type":"edge","start_day":7,"duration_days":56,"magnitude_pct":30}]'::jsonb,
  'Expedite & Reroute', 182, 28, 30, 42
),
(
  'transport_disruption',
  'Transport Network Disruption',
  'All lead times increase 50% for 3 weeks — models a severe weather event, fuel crisis, or carrier capacity crunch across the full network.',
  'logistics', 'high', 'Truck',
  '[{"target":"inbound_logistics","target_type":"edge","start_day":0,"duration_days":21,"magnitude_pct":40}]'::jsonb,
  'Expedite & Reroute', 91, 14, 30, 42
),

-- Geopolitical disruptions
(
  'natural_disaster_t1',
  'Natural Disaster – Tier 1 Supplier Cluster',
  'An earthquake, flood, or typhoon takes out an entire cluster of tier-1 suppliers for 6 weeks. Tests geographic concentration risk.',
  'geopolitical', 'extreme', 'Globe',
  '[{"target":"primary_supplier","target_type":"node","start_day":0,"duration_days":42,"magnitude_pct":100},{"target":"supplier_cluster_a","target_type":"node","start_day":0,"duration_days":42,"magnitude_pct":80}]'::jsonb,
  'Full Resilience Response', 364, 28, 30, 42
),
(
  'geopolitical_tariff',
  'Geopolitical Tariff Shock',
  'Sudden tariff increase raises inbound material costs 30% for 12 weeks. Models trade-war or sanctions scenarios. Tests cost absorption vs. demand-side response.',
  'geopolitical', 'high', 'Landmark',
  '[{"target":"primary_supplier","target_type":"node","start_day":0,"duration_days":84,"magnitude_pct":20}]'::jsonb,
  'Demand-Side Flex', 364, 28, 30, 42
),

-- Demand disruptions
(
  'demand_spike',
  'Demand Spike',
  'Customer demand spikes to 2.5× normal for 4 weeks — common after a product launch, viral event, or competitor recall. Tests whether your inventory buffers can absorb.',
  'demand', 'medium', 'TrendingUp',
  '[{"target":"outbound_demand","target_type":"node","start_day":21,"duration_days":28,"magnitude_pct":-150}]'::jsonb,
  'Capacity Surge', 182, 28, 30, 42
),
(
  'demand_crash',
  'Demand Crash',
  'Customer demand drops to 30% of normal for 8 weeks — models a recession, product recall, or channel disruption. Tests overstock risk and cash-flow resilience.',
  'demand', 'medium', 'TrendingDown',
  '[{"target":"outbound_demand","target_type":"node","start_day":7,"duration_days":56,"magnitude_pct":70}]'::jsonb,
  'Demand-Side Flex', 182, 28, 30, 42
),

-- Production disruptions
(
  'quality_recall',
  'Quality Recall',
  'A quality issue reduces effective yield to 70% for 6 weeks. Every batch wastes 30% of materials. Tests whether safety stock survives a yield-loss shock.',
  'production', 'high', 'ShieldAlert',
  '[{"target":"production_plant","target_type":"node","start_day":7,"duration_days":42,"magnitude_pct":30}]'::jsonb,
  'Safety Buffer Drawdown', 182, 28, 30, 42
),
(
  'energy_crisis',
  'Energy Crisis',
  'Production capacity drops 40% for 10 weeks due to energy rationing or cost-driven curtailment. Tests whether overtime and demand-shaping can close the gap.',
  'production', 'high', 'Zap',
  '[{"target":"production_plant","target_type":"node","start_day":0,"duration_days":70,"magnitude_pct":40}]'::jsonb,
  'Capacity Surge', 364, 28, 30, 42
),

-- Combined stress test
(
  'combined_stress',
  'Combined Disruption Stress Test',
  'Supplier outage AND simultaneous demand spike. The two-sided squeeze: supply constrained while demand surges. The hardest scenario to survive with acceptable fill rate.',
  'supplier', 'extreme', 'Siren',
  '[{"target":"primary_supplier","target_type":"node","start_day":7,"duration_days":42,"magnitude_pct":80},{"target":"outbound_demand","target_type":"node","start_day":14,"duration_days":21,"magnitude_pct":-100}]'::jsonb,
  'Full Resilience Response', 364, 42, 30, 42
);
