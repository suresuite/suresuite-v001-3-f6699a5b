-- PLAN.md §23 WP 13.4 · §4 D204 (a) — THE POLICY SNAPSHOT STORES THE DEFAULTS THE PAGE SHOWS.
--
-- `policy_defaults` is seeded `{}` per family (`create_default_policy_defaults`). The
-- policies page parses every stored family through the Zod bundle, which fills every
-- key the project never saved, so the page SHOWS a value for it. The snapshot a run
-- binds was built here and copied the stored JSON RAW, so the engine read each missing
-- key with ITS default instead: backorders allowed on the page and lost sales in the
-- run, a κ of 8 on the page and the 8-10-12 strip in the run, a 1 000 units/day line
-- rate on the page and the max(2·demand, 1000) floor in the run (§15 run `36629798467`:
-- the fulfillment family is empty in 9 of 10 projects).
--
-- The snapshot now merges each stored family OVER the page's defaults — the stored
-- value wins key by key, a key nobody saved is the value the page shows. The defaults
-- are `src/lib/policies/schemas.ts`'s `DEFAULT_BUNDLE`, carried here as a GENERATED
-- literal (`scripts/gen-policy-bundle-defaults.mts`); `policyBundleDefaultsSql.test.ts`
-- fails when it and the Zod bundle differ, so the page and the snapshot cannot drift.
--
-- CONSEQUENCES, stated rather than discovered. (1) `current_policy_hash` digests this
-- builder, so every project whose stored defaults omit a key gets a NEW current policy
-- hash at deploy: a Validated Model recorded on the old snapshot reads stale on
-- /policies (policy drift) until re-validated. That is honest — its results came from
-- defaults the page did not show — and the model still REPLAYS its own frozen policy
-- version (WP 13.3), so nothing recorded becomes unreproducible. (2) Existing
-- `policy_versions` rows are immutable and keep their raw snapshots; a run of one
-- computes exactly as it did. (3) Results move for new versions of such projects, by
-- design: the run now uses the values the page shows.
--
-- `supabase/rehearsal/780` proves it, mutation-tested.

CREATE OR REPLACE FUNCTION public.policy_bundle_defaults()
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $pd$
  SELECT '{"sourcing": {"strategy": "single", "ratios": {}, "primary_supplier": "", "backup_supplier": "", "tertiary_supplier": "", "failover_trigger": "stockout", "failover_threshold_pct": 20, "failover_cooldown_days": 7, "min_reliability": 0.85, "max_lead_time_variance_days": 3, "contract_type": "contract", "order_consolidation": "none", "supply_share": 0, "primary_source": false, "material_price": 0, "supplier_capacity_per_day": 0}, "inventory": {"type": "min_max", "basis": "days_of_supply", "reorder_point": 50, "order_up_to": 200, "rop_q_quantity": 0, "coverage_weeks": 8, "max_stock": 500, "min_stock": 0, "safety_stock_method": "fixed_days", "safety_stock_days": 7, "service_level_target": 0.95, "review_period_days": 1, "abc_class": "B", "holding_cost_pct": 0.2, "stockout_cost_per_unit": 5, "ordering_cost": 100, "shelf_life_days": 0, "rotation": "FIFO", "fg_safety_stock": "none", "fg_service_level_target": 0.95, "fg_safety_stock_days": 2, "moq": 0}, "transport": {"mode": "road", "lead_time_mean_days": 3, "lead_time_std_days": 0.5, "lead_time_distribution": "normal", "lead_time_shape": 2, "lead_time_scale": 1, "lead_time_min": 0, "lead_time_mode": 1, "lead_time_max": 2, "vehicles": 5, "capacity_weight_kg": 20000, "capacity_volume_m3": 80, "load_type": "FTL", "min_fill_pct": 70, "cost_per_unit": 1, "cost_per_km": 1.5, "fixed_dispatch_cost": 50, "routing": "direct", "carbon_intensity_kg_per_tkm": 0.062}, "fulfillment": {"allocation": "priority", "backorder_allowed": true, "max_backorder_days": 14, "backorder_cost_per_day": 2, "lost_sales_cost_per_unit": 20, "service_level_alpha": 0.95, "service_level_beta": 0.98, "order_batching_window_hours": 0, "tier_overrides": {}, "sourcing_firm": "", "primary_source": false, "price": 0}, "production": {"lot_policy": "epq", "allocation_priority_weight": 1, "setup_time_hours": 1, "setup_cost": 500, "capacity_units_per_day": 1000, "utilization_cap_pct": 85, "scheduling": "fifo", "capacity_machine_per_day": 0, "capacity_labor_per_day": 0, "production_cost_per_unit": 0, "production_lead_time_mean_days": 1, "production_lead_time_std_days": 0.2, "lead_time_distribution": "normal", "production_lead_time_shape": 2, "production_lead_time_scale": 1, "production_lead_time_min": 0, "production_lead_time_mode": 1, "production_lead_time_max": 2}, "recovery": {"enabled": true, "trigger_magnitude_pct": 25, "trigger_duration_days": 2, "trigger_geography": "", "response": [], "detection_lag_days": 1, "recovery_target_days": 21, "cost_cap": 25000}, "demand": {"pattern": "stationary", "mean_per_day": 100, "cv": 0.3, "seasonality_period_days": 0, "seasonality_amplitude_pct": 0, "trend_pct_per_period": 0, "forecast_method": "exp_smoothing", "forecast_horizon_days": 14, "forecast_bias_pct": 0, "order_size_distribution": "poisson", "priority_tier": "B", "delivery_window_days": 3, "late_penalty_per_day": 5, "delivery_schedule": ""}}'::jsonb;
$pd$;
REVOKE ALL ON FUNCTION public.policy_bundle_defaults() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.policy_bundle_defaults() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._build_policy_snapshot(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row       public.policy_defaults%ROWTYPE;
  v_overrides jsonb;
  v_def       jsonb := public.policy_bundle_defaults();
BEGIN
  SELECT * INTO v_row
  FROM public.policy_defaults
  WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No policy_defaults found for project %', p_project_id;
  END IF;

  -- Deterministic ordering so snapshot::text is stable for hashing.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'scope', o.scope,
        'target_key', o.target_key,
        'family', o.family,
        'patch', o.patch
      )
      ORDER BY o.scope, o.target_key, o.family
    ),
    '[]'::jsonb
  )
  INTO v_overrides
  FROM public.policy_overrides o
  WHERE o.project_id = p_project_id;

  -- §4 D204 (a): each family is the page's defaults with the stored values over them.
  RETURN jsonb_build_object(
    'schema_version', 2,
    'defaults', jsonb_build_object(
      'sourcing',    public._resolve_policy_family(v_def -> 'sourcing',    v_row.sourcing),
      'inventory',   public._resolve_policy_family(v_def -> 'inventory',   v_row.inventory),
      'transport',   public._resolve_policy_family(v_def -> 'transport',   v_row.transport),
      'fulfillment', public._resolve_policy_family(v_def -> 'fulfillment', v_row.fulfillment),
      'production',  public._resolve_policy_family(v_def -> 'production',  v_row.production),
      'recovery',    public._resolve_policy_family(v_def -> 'recovery',    v_row.recovery),
      'demand',      public._resolve_policy_family(v_def -> 'demand',      v_row.demand)
    ),
    'fulfillment_strategy', COALESCE(v_row.fulfillment_strategy, 'make_to_stock'),
    'overrides', v_overrides
  );
END;
$$;

-- A stored family that is not an object (SQL NULL, JSON null, a scalar) has no keys
-- of its own, so the page's defaults stand for all of them.
CREATE OR REPLACE FUNCTION public._resolve_policy_family(p_defaults jsonb, p_stored jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT COALESCE(p_defaults, '{}'::jsonb)
         || CASE WHEN jsonb_typeof(p_stored) = 'object' THEN p_stored ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public._resolve_policy_family(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._resolve_policy_family(jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public._build_policy_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._build_policy_snapshot(uuid) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
