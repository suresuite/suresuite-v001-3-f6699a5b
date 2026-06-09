-- Fix recovery_playbooks vocabulary.
--
-- The original seeds used non-canonical response names (safety_stock_boost,
-- dual_source, demand_shift, promo_throttle) that do not match:
--   a) RESPONSE_WEIGHTS in sim-command/index.ts
--   b) _inventory_review() handler names in engine.py
--
-- This migration replaces all system playbooks with 7 canonical entries so
-- that playbook selection in SimulationLab has a real effect on simulation output.
--
-- Canonical response vocabulary (engine-authoritative):
--   dual_source_activate  – activate backup supplier when primary is disrupted
--   mode_shift            – expedited freight; sampled LT × 0.5
--   expedite_freight      – alias for mode_shift (same engine branch)
--   safety_stock_drawdown – draw down safety buffer before reordering
--   reroute               – switch to next-best supplier arc in graph
--   capacity_flex         – overtime / temporary capacity increase
--   demand_shaping        – throttle or shift demand by up to 20 %

DELETE FROM public.recovery_playbooks WHERE is_system = true;

INSERT INTO public.recovery_playbooks
  (project_id, name, description, is_system, config)
VALUES
  (
    NULL,
    'Baseline (no recovery)',
    'No recovery actions applied. Use this to measure the raw disruption impact — fill rate and revenue drop with nothing to cushion the shock.',
    true,
    '{"responses":[],"detection_lag_days":0,"cost_cap":0,"recovery_target_days":null}'::jsonb
  ),
  (
    NULL,
    'Safety Buffer Drawdown',
    'Draw down safety stock before reordering. Low cost, zero lead-time impact. Buys 3–4 weeks of breathing room for moderate disruptions.',
    true,
    '{"responses":["safety_stock_drawdown"],"detection_lag_days":2,"cost_cap":5000,"recovery_target_days":21}'::jsonb
  ),
  (
    NULL,
    'Expedite & Reroute',
    'Air freight and alternate routing. Fast response (1–2 week TTR) but significantly higher logistics cost. Best for high-value products.',
    true,
    '{"responses":["mode_shift","reroute"],"detection_lag_days":1,"cost_cap":50000,"recovery_target_days":10}'::jsonb
  ),
  (
    NULL,
    'Activate Backup Supplier',
    'Switch orders to a pre-qualified secondary supplier. Medium cost, 2–3 week ramp-up. Requires backup supplier to be configured in the network.',
    true,
    '{"responses":["dual_source_activate"],"detection_lag_days":2,"cost_cap":20000,"recovery_target_days":14}'::jsonb
  ),
  (
    NULL,
    'Full Resilience Response',
    'All high-speed levers: backup supplier + air freight + safety stock. Maximum recovery speed (<1 week TTR). Highest cost. Reserve for critical disruptions.',
    true,
    '{"responses":["dual_source_activate","mode_shift","safety_stock_drawdown"],"detection_lag_days":1,"cost_cap":100000,"recovery_target_days":5}'::jsonb
  ),
  (
    NULL,
    'Demand-Side Flex',
    'Throttle promotions and reshape demand instead of pushing supply. Effective when supply-side options are exhausted. 4–5 week TTR, low cost.',
    true,
    '{"responses":["demand_shaping","safety_stock_drawdown"],"detection_lag_days":3,"cost_cap":8000,"recovery_target_days":28}'::jsonb
  ),
  (
    NULL,
    'Capacity Surge',
    'Overtime and flex capacity at production. Draws down safety stock simultaneously. 2–3 week TTR. Works best when the bottleneck is internal production, not supply.',
    true,
    '{"responses":["capacity_flex","safety_stock_drawdown"],"detection_lag_days":2,"cost_cap":30000,"recovery_target_days":14}'::jsonb
  );
