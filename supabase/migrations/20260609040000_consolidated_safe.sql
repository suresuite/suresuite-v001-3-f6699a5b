-- ============================================================
-- CONSOLIDATED SAFE MIGRATION
-- Replaces all pending 20260609000003 through 20260609030000.
-- Uses CREATE IF NOT EXISTS / OR REPLACE / DROP IF EXISTS
-- throughout so the migration is idempotent.
-- ============================================================

-- ── 1. Policy table grants (20260609000010) ──────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_overrides TO authenticated;
GRANT ALL                             ON public.policy_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_defaults  TO authenticated;
GRANT ALL                             ON public.policy_defaults  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_presets   TO authenticated;
GRANT ALL                             ON public.policy_presets   TO service_role;

-- ── 2. disruption_scenarios extra columns (20260609000003) ───
-- Generated column: wrap in DO/EXCEPTION so duplicate-column never aborts.
DO $$
BEGIN
  ALTER TABLE public.disruption_scenarios
    ADD COLUMN sim_payload jsonb GENERATED ALWAYS AS (
      jsonb_build_object(
        'lever',             'node:' || node_id,
        'magnitude',         capacity_reduction_percent,
        'time_delay_weeks',  ROUND(time_delay_days / 7.0, 2),
        'description',       description
      )
    ) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
         WHEN OTHERS            THEN NULL;
END $$;

ALTER TABLE public.disruption_scenarios
  ADD COLUMN IF NOT EXISTS from_network boolean NOT NULL DEFAULT true;

-- ── 3. Drop orphaned sim_scenarios table (20260609000021) ────
DROP TABLE IF EXISTS public.sim_scenarios CASCADE;

-- ── 4. from_network badge on scenarios table (20260609000021) ─
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS from_network boolean NOT NULL DEFAULT false;

-- ── 5. Sync trigger: disruption → scenarios (20260609000021) ─
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
    364,
    105,
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

DROP TRIGGER IF EXISTS trg_sync_disruption_to_sim_scenario ON public.disruption_scenarios;
CREATE TRIGGER trg_sync_disruption_to_sim_scenario
  AFTER INSERT OR UPDATE ON public.disruption_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_disruption_to_sim_scenario();

-- ── 6. Recovery playbooks vocabulary fix (20260609000020) ─────
DELETE FROM public.recovery_playbooks WHERE is_system = true;

INSERT INTO public.recovery_playbooks
  (project_id, name, description, is_system, config)
VALUES
  (
    NULL,
    'Baseline (no recovery)',
    'No recovery actions applied. Use this to measure the raw disruption impact.',
    true,
    '{"responses":[],"detection_lag_days":0,"cost_cap":0,"recovery_target_days":null}'::jsonb
  ),
  (
    NULL,
    'Safety Buffer Drawdown',
    'Draw down safety stock before reordering. Low cost. Buys 3–4 weeks of breathing room.',
    true,
    '{"responses":["safety_stock_drawdown"],"detection_lag_days":2,"cost_cap":5000,"recovery_target_days":21}'::jsonb
  ),
  (
    NULL,
    'Expedite & Reroute',
    'Air freight and alternate routing. Fast (1–2 week TTR) but high logistics cost.',
    true,
    '{"responses":["mode_shift","reroute"],"detection_lag_days":1,"cost_cap":50000,"recovery_target_days":10}'::jsonb
  ),
  (
    NULL,
    'Activate Backup Supplier',
    'Switch to a pre-qualified secondary supplier. Medium cost, 2–3 week ramp-up.',
    true,
    '{"responses":["dual_source_activate"],"detection_lag_days":2,"cost_cap":20000,"recovery_target_days":14}'::jsonb
  ),
  (
    NULL,
    'Full Resilience Response',
    'Backup supplier + air freight + safety stock. Maximum speed. Highest cost.',
    true,
    '{"responses":["dual_source_activate","mode_shift","safety_stock_drawdown"],"detection_lag_days":1,"cost_cap":100000,"recovery_target_days":5}'::jsonb
  ),
  (
    NULL,
    'Demand-Side Flex',
    'Reshape demand instead of pushing supply. 4–5 week TTR, low cost.',
    true,
    '{"responses":["demand_shaping","safety_stock_drawdown"],"detection_lag_days":3,"cost_cap":8000,"recovery_target_days":28}'::jsonb
  ),
  (
    NULL,
    'Capacity Surge',
    'Overtime and flex capacity at production. 2–3 week TTR. Best for internal bottlenecks.',
    true,
    '{"responses":["capacity_flex","safety_stock_drawdown"],"detection_lag_days":2,"cost_cap":30000,"recovery_target_days":14}'::jsonb
  );

-- ── 7. Scenario templates (20260609000022) ───────────────────
CREATE TABLE IF NOT EXISTS public.scenario_templates (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text        NOT NULL UNIQUE,
  name                    text        NOT NULL,
  description             text        NOT NULL DEFAULT '',
  category                text        NOT NULL CHECK (category IN ('supplier','logistics','demand','production','geopolitical')),
  severity                text        NOT NULL CHECK (severity IN ('low','medium','high','extreme')),
  icon                    text,
  disruption_schedule     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  suggested_playbook_name text,
  horizon_days            integer     NOT NULL DEFAULT 91,
  warmup_days             integer     NOT NULL DEFAULT 14,
  replications            integer     NOT NULL DEFAULT 30,
  seed                    integer     NOT NULL DEFAULT 42,
  is_system               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scenario_templates TO authenticated, service_role;

ALTER TABLE public.scenario_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read system templates" ON public.scenario_templates;
CREATE POLICY "Anyone authenticated can read system templates"
  ON public.scenario_templates FOR SELECT TO authenticated
  USING (is_system = true);

INSERT INTO public.scenario_templates
  (slug, name, description, category, severity, icon,
   disruption_schedule, suggested_playbook_name, horizon_days, warmup_days, replications, seed)
VALUES
  (
    'supplier_outage_single', 'Single Supplier Outage',
    'Primary supplier drops to 40% capacity for 6 weeks.',
    'supplier', 'medium', 'Factory',
    '[{"target":"primary_supplier","target_type":"node","start_day":14,"duration_days":42,"magnitude_pct":60}]'::jsonb,
    'Activate Backup Supplier', 182, 28, 30, 42
  ),
  (
    'supplier_bankruptcy', 'Supplier Bankruptcy',
    'Primary supplier goes offline completely for 12 weeks.',
    'supplier', 'extreme', 'AlertTriangle',
    '[{"target":"primary_supplier","target_type":"node","start_day":7,"duration_days":84,"magnitude_pct":100}]'::jsonb,
    'Full Resilience Response', 364, 28, 30, 42
  ),
  (
    'dual_supplier_stress', 'Dual Supplier Stress Test',
    'Both primary and backup suppliers simultaneously hit 50% capacity for 4 weeks.',
    'supplier', 'high', 'Zap',
    '[{"target":"primary_supplier","target_type":"node","start_day":14,"duration_days":28,"magnitude_pct":50},{"target":"backup_supplier","target_type":"node","start_day":14,"duration_days":28,"magnitude_pct":50}]'::jsonb,
    'Capacity Surge', 182, 28, 30, 42
  ),
  (
    'port_congestion', 'Port Congestion',
    'All inbound lead times extend by ~2 weeks for 8 weeks.',
    'logistics', 'medium', 'Ship',
    '[{"target":"inbound_logistics","target_type":"edge","start_day":7,"duration_days":56,"magnitude_pct":30}]'::jsonb,
    'Expedite & Reroute', 182, 28, 30, 42
  ),
  (
    'transport_disruption', 'Transport Network Disruption',
    'All lead times increase 50% for 3 weeks.',
    'logistics', 'high', 'Truck',
    '[{"target":"inbound_logistics","target_type":"edge","start_day":0,"duration_days":21,"magnitude_pct":40}]'::jsonb,
    'Expedite & Reroute', 91, 14, 30, 42
  ),
  (
    'natural_disaster_t1', 'Natural Disaster – Tier 1 Supplier Cluster',
    'An earthquake or flood takes out an entire cluster of tier-1 suppliers for 6 weeks.',
    'geopolitical', 'extreme', 'Globe',
    '[{"target":"primary_supplier","target_type":"node","start_day":0,"duration_days":42,"magnitude_pct":100},{"target":"supplier_cluster_a","target_type":"node","start_day":0,"duration_days":42,"magnitude_pct":80}]'::jsonb,
    'Full Resilience Response', 364, 28, 30, 42
  ),
  (
    'geopolitical_tariff', 'Geopolitical Tariff Shock',
    'Sudden tariff increase raises inbound material costs 30% for 12 weeks.',
    'geopolitical', 'high', 'Landmark',
    '[{"target":"primary_supplier","target_type":"node","start_day":0,"duration_days":84,"magnitude_pct":20}]'::jsonb,
    'Demand-Side Flex', 364, 28, 30, 42
  ),
  (
    'demand_spike', 'Demand Spike',
    'Customer demand spikes to 2.5× normal for 4 weeks.',
    'demand', 'medium', 'TrendingUp',
    '[{"target":"outbound_demand","target_type":"node","start_day":21,"duration_days":28,"magnitude_pct":-150}]'::jsonb,
    'Capacity Surge', 182, 28, 30, 42
  ),
  (
    'demand_crash', 'Demand Crash',
    'Customer demand drops to 30% of normal for 8 weeks.',
    'demand', 'medium', 'TrendingDown',
    '[{"target":"outbound_demand","target_type":"node","start_day":7,"duration_days":56,"magnitude_pct":70}]'::jsonb,
    'Demand-Side Flex', 182, 28, 30, 42
  ),
  (
    'quality_recall', 'Quality Recall',
    'A quality issue reduces effective yield to 70% for 6 weeks.',
    'production', 'high', 'ShieldAlert',
    '[{"target":"production_plant","target_type":"node","start_day":7,"duration_days":42,"magnitude_pct":30}]'::jsonb,
    'Safety Buffer Drawdown', 182, 28, 30, 42
  ),
  (
    'energy_crisis', 'Energy Crisis',
    'Production capacity drops 40% for 10 weeks due to energy rationing.',
    'production', 'high', 'Zap',
    '[{"target":"production_plant","target_type":"node","start_day":0,"duration_days":70,"magnitude_pct":40}]'::jsonb,
    'Capacity Surge', 364, 28, 30, 42
  ),
  (
    'combined_stress', 'Combined Disruption Stress Test',
    'Supplier outage AND simultaneous demand spike.',
    'supplier', 'extreme', 'Siren',
    '[{"target":"primary_supplier","target_type":"node","start_day":7,"duration_days":42,"magnitude_pct":80},{"target":"outbound_demand","target_type":"node","start_day":14,"duration_days":21,"magnitude_pct":-100}]'::jsonb,
    'Full Resilience Response', 364, 42, 30, 42
  )
ON CONFLICT (slug) DO NOTHING;

-- ── 8. Auto-create policy_defaults on new project (20260609000023) ─
CREATE OR REPLACE FUNCTION public.create_default_policy_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.policy_defaults (
    project_id, sourcing, inventory, transport, fulfillment,
    production, recovery, demand, created_at, updated_at
  )
  VALUES (
    NEW.id,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    now(), now()
  )
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_policy_defaults ON public.projects;
CREATE TRIGGER trg_create_policy_defaults
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.create_default_policy_defaults();

INSERT INTO public.policy_defaults (
  project_id, sourcing, inventory, transport, fulfillment,
  production, recovery, demand, created_at, updated_at
)
SELECT
  p.id,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now(), now()
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_defaults pd WHERE pd.project_id = p.id
)
ON CONFLICT (project_id) DO NOTHING;

-- ── 9. Drop old family constraint on policy_overrides (20260609005659) ─
ALTER TABLE public.policy_overrides
  DROP CONSTRAINT IF EXISTS policy_overrides_family_check;

-- Also refresh the constraint to include all families (from 20260607133944)
ALTER TABLE public.policy_overrides
  DROP CONSTRAINT IF EXISTS policy_overrides_family_chk;
ALTER TABLE public.policy_overrides
  ADD CONSTRAINT policy_overrides_family_chk
  CHECK (family IN ('sourcing','inventory','transport','fulfillment','production','recovery','demand'));

-- ── 10. Broad grants (20260609010118) ────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'policy_defaults','policy_overrides','policy_presets',
    'recovery_playbooks','scenarios','experiments',
    'simulation_runs','run_replications'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ── 11. anon read grants + RLS policies (20260609000025) ─────
GRANT SELECT ON public.policy_defaults  TO anon;
GRANT SELECT ON public.policy_overrides TO anon;
GRANT SELECT ON public.policy_presets   TO anon;

DROP POLICY IF EXISTS "Anon can read policy defaults"  ON public.policy_defaults;
DROP POLICY IF EXISTS "Anon can read policy overrides" ON public.policy_overrides;
DROP POLICY IF EXISTS "Anon can read policy presets"   ON public.policy_presets;

CREATE POLICY "Anon can read policy defaults"
  ON public.policy_defaults  FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read policy overrides"
  ON public.policy_overrides FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read policy presets"
  ON public.policy_presets   FOR SELECT TO anon USING (true);

-- ── 12. Write RPCs (20260609000025) ──────────────────────────
CREATE OR REPLACE FUNCTION public.save_policy_defaults(
  p_project_id        uuid,
  p_family            text,
  p_value             jsonb,
  p_strategy          text        DEFAULT NULL,
  p_active_preset     text        DEFAULT NULL,
  p_preset_applied_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.policy_defaults (project_id, updated_at)
  VALUES (p_project_id, now())
  ON CONFLICT (project_id) DO NOTHING;

  EXECUTE format(
    'UPDATE public.policy_defaults SET %I = $1, updated_at = now() WHERE project_id = $2',
    p_family
  ) USING p_value, p_project_id;

  IF p_strategy IS NOT NULL THEN
    UPDATE public.policy_defaults
       SET fulfillment_strategy = p_strategy, updated_at = now()
     WHERE project_id = p_project_id;
  END IF;

  IF p_active_preset IS NOT NULL THEN
    UPDATE public.policy_defaults
       SET active_preset     = p_active_preset,
           preset_applied_at = p_preset_applied_at,
           updated_at        = now()
     WHERE project_id = p_project_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_policy_defaults TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bulk_upsert_policy_overrides(
  p_project_id uuid,
  p_rows       jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.policy_overrides
    (project_id, scope, target_key, family, patch, updated_at)
  SELECT
    p_project_id,
    r->>'scope',
    r->>'target_key',
    r->>'family',
    r->'patch',
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (project_id, scope, target_key, family)
  DO UPDATE SET patch = excluded.patch, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_policy_overrides TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_policy_override(
  p_project_id uuid,
  p_scope      text,
  p_target_key text,
  p_family     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.policy_overrides
   WHERE project_id = p_project_id
     AND scope       = p_scope
     AND target_key  = p_target_key
     AND family      = p_family;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_policy_override TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.clear_policy_preset(
  p_project_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.policy_defaults
     SET active_preset     = NULL,
         preset_applied_at = NULL,
         updated_at        = now()
   WHERE project_id = p_project_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_policy_preset TO anon, authenticated;

-- ── 13. Flush PostgREST schema cache ─────────────────────────
SELECT pg_notify('pgrst', 'reload schema');
