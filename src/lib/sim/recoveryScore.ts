// Deterministic recovery-impact scoring. Mirrors the logic embedded in the
// sim-command edge function so the Results view can render a faithful
// "with vs without recovery" comparison without a second round-trip.

export type RecoveryResponseKey =
  | "reroute"
  | "dual_source_activate"
  | "safety_stock_drawdown"
  | "mode_shift"
  | "capacity_flex"
  | "demand_shaping";

export interface RecoveryConfig {
  enabled: boolean;
  response: RecoveryResponseKey[];
  // legacy generic fields (kept for backward compat with scoring function)
  detection_lag_days?: number;
  trigger_magnitude_pct?: number;
  trigger_duration_days?: number;
  recovery_target_days?: number;
  cost_cap?: number;
  // per-strategy params (from research model)
  backup_lead_time_weeks?: number;    // dual_source_activate: Ts' default 6
  holding_cost_pct?: number;          // safety_stock_drawdown: hm default 20%
  overtime_cost_pct?: number;         // capacity_flex: Cop default 5%
  allocation_horizon_weeks?: number;  // demand_shaping: W default 4
  annual_labor_cost?: number;         // demand_shaping: Calc default 6240
  expedite_cost_pct?: number;         // mode_shift: Cexp default 3%
}

export interface DisruptionEvent {
  start_day?: number;
  duration_days?: number;
  magnitude_pct?: number;
  node?: string;
}

export const RESPONSE_WEIGHTS: Record<RecoveryResponseKey, number> = {
  reroute: 0.2,
  dual_source_activate: 0.3,
  safety_stock_drawdown: 0.15,
  mode_shift: 0.2,
  capacity_flex: 0.25,
  demand_shaping: 0.15,
};

export const RESPONSE_LABELS: Record<RecoveryResponseKey, string> = {
  dual_source_activate: "Backup supplier",
  safety_stock_drawdown: "Safety stock",
  capacity_flex: "Overtime production",
  demand_shaping: "Material reallocation",
  mode_shift: "Expedite shipments",
  reroute: "Network rerouting",
};

// per-class utilization deltas when recovery is active
export const RESPONSE_CLASS_DELTA: Record<RecoveryResponseKey, Record<string, number>> = {
  capacity_flex: { production: 0.08 },
  mode_shift: { transport: 0.06 },
  reroute: { transport: 0.04 },
  safety_stock_drawdown: { warehouse: 0.05 },
  dual_source_activate: { suppliers: 0.07 },
  demand_shaping: { production: -0.02 },
};

export interface ScoredKpis {
  fill_rate: number;
  otif: number;
  lead_time_days: number;
  utilization: number;
  backorder_days: number;
  ttr_days: number;
  resilience_index: number;
  revenue: number;
  cost: number;
  profit: number;
  utilization_by_class: Record<string, number>;
}

const BASE = {
  fill_rate: 0.94,
  otif: 0.91,
  lead_time_days: 7.0,
  utilization: 0.78,
  backorder_days: 2.4,
  resilience_index: 0.85,
  revenue: 1_000_000,
  cost: 720_000,
};

const BASE_CLASS_UTIL: Record<string, number> = {
  suppliers: 0.72,
  production: 0.81,
  warehouse: 0.66,
  transport: 0.74,
};

function tanh(x: number) { return Math.tanh(x); }

export function baseLoss(disruptions: DisruptionEvent[]): number {
  let total = 0;
  for (const d of disruptions) {
    total += (Number(d.magnitude_pct ?? 0) * Number(d.duration_days ?? 0)) / 100;
  }
  return total;
}

export function mitigationScore(recovery: RecoveryConfig): number {
  return (recovery.response ?? []).reduce(
    (s, r) => s + (RESPONSE_WEIGHTS[r as RecoveryResponseKey] ?? 0),
    0,
  );
}

export function scoreScenarioKpis(
  recovery: RecoveryConfig,
  disruptions: DisruptionEvent[],
  horizonDays = 90,
  noise = 0,
): ScoredKpis {
  const loss = baseLoss(disruptions);
  const pressure = tanh(loss / 30);
  const mit = mitigationScore(recovery);
  const detection = Math.max(0, recovery.detection_lag_days ?? 0);
  const active = !!recovery.enabled && disruptions.length > 0;
  const effect = active ? Math.max(0, Math.min(1.3, mit - detection * 0.05)) : 0;

  const reliefP = 1 - 0.7 * effect;
  const reliefL = 1 - 0.6 * effect;

  const horizonScale = horizonDays / 90;
  const revenueBase = BASE.revenue * horizonScale;
  const costBase = BASE.cost * horizonScale;
  const costUsed = Math.min(recovery.cost_cap ?? 0, loss * 1000 * mit);

  const classUtil: Record<string, number> = { ...BASE_CLASS_UTIL };
  if (active) {
    for (const r of recovery.response ?? []) {
      const delta = RESPONSE_CLASS_DELTA[r as RecoveryResponseKey] ?? {};
      for (const [k, v] of Object.entries(delta)) {
        classUtil[k] = Math.max(0, Math.min(1, (classUtil[k] ?? 0.7) + v));
      }
    }
  } else if (disruptions.length > 0) {
    // firefighting raises transport + warehouse while production may stall
    classUtil.transport = Math.min(1, classUtil.transport + 0.05 * pressure);
    classUtil.warehouse = Math.min(1, classUtil.warehouse + 0.04 * pressure);
    classUtil.production = Math.max(0, classUtil.production - 0.05 * pressure);
  }

  const fill_rate = clamp01(BASE.fill_rate - 0.06 * pressure * reliefP + noise);
  const otif = clamp01(BASE.otif - 0.07 * pressure * reliefP + noise);
  const lead_time_days = +(BASE.lead_time_days + 2.5 * pressure * reliefL).toFixed(2);
  const utilization = active
    ? clamp01(BASE.utilization + 0.02 + 0.06 * effect)
    : clamp01(BASE.utilization + 0.05 * pressure);
  const backorder_days = +Math.max(0, BASE.backorder_days + 4 * pressure * reliefP).toFixed(1);
  const ttr_days = active
    ? +Math.max(2, 14 - 8 * effect + detection).toFixed(1)
    : +(14 + loss / 4).toFixed(1);
  const resilience_index = active
    ? +Math.min(0.99, 0.82 + 0.15 * effect).toFixed(3)
    : +Math.max(0.4, 0.85 - 0.2 * pressure).toFixed(3);

  const revenue = Math.round(revenueBase * (1 - 0.05 * pressure * reliefP));
  const cost = Math.round(costBase + (active ? costUsed : loss * 800));
  const profit = revenue - cost;

  return {
    fill_rate: +fill_rate.toFixed(4),
    otif: +otif.toFixed(4),
    lead_time_days,
    utilization: +utilization.toFixed(3),
    backorder_days,
    ttr_days,
    resilience_index,
    revenue,
    cost,
    profit,
    utilization_by_class: classUtil,
  };
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
