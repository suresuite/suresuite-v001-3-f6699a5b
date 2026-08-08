import { useMemo } from "react";
import { ImpactTable, type ImpactRow } from "./resultTables";
import { kpiDisplay, signedDelta } from "@/lib/sim/kpiDisplay";
import {
  scoreScenarioKpis,
  RESPONSE_LABELS,
  RESPONSE_WEIGHTS,
  type RecoveryConfig,
  type RecoveryResponseKey,
  type DisruptionEvent,
} from "@/lib/sim/recoveryScore";

interface Props {
  recovery: RecoveryConfig | null;
  disruptions: DisruptionEvent[];
  horizonDays: number;
}

/** The subset of the shared KPI vocabulary the playbook moves. */
const METRIC_KEYS: Array<keyof ReturnType<typeof scoreScenarioKpis>> = [
  "fill_rate",
  "otif",
  "lead_time_days",
  "utilization",
  "ttr_days",
  "resilience_index",
];

/** Same paired arithmetic as before — playbook on vs playbook off — rendered
 *  as one Without | With | Δ table instead of a tile grid. */
export function RecoveryImpactCard({ recovery, disruptions, horizonDays }: Props) {
  const { withR, withoutR } = useMemo(() => {
    if (!recovery) return { withR: null, withoutR: null };
    return {
      withR: scoreScenarioKpis(recovery, disruptions, horizonDays),
      withoutR: scoreScenarioKpis({ ...recovery, enabled: false }, disruptions, horizonDays),
    };
  }, [recovery, disruptions, horizonDays]);

  if (!recovery || !withR || !withoutR) return null;

  const responses = (recovery.response ?? []) as RecoveryResponseKey[];

  const kpiRows: ImpactRow[] = METRIC_KEYS.map((key) => {
    const m = kpiDisplay(key as string);
    const a = Number(withoutR[key] ?? 0);
    const b = Number(withR[key] ?? 0);
    const delta = b - a;
    const moved = Math.abs(delta) > 0.0001;
    return {
      label: m.label,
      without: m.format(a),
      with: m.format(b),
      delta: signedDelta(delta, m.format),
      better: moved && m.higherIsBetter !== null ? (m.higherIsBetter ? delta > 0 : delta < 0) : null,
    };
  });

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const utilRows: ImpactRow[] = Object.entries(withR.utilization_by_class).map(([cls, v]) => {
    const a = withoutR.utilization_by_class[cls] ?? v;
    const delta = v - a;
    return {
      label: cls,
      without: pct(a),
      with: pct(v),
      delta: signedDelta(delta, pct),
      better: Math.abs(delta) > 0.0001 ? delta > 0 : null,
    };
  });

  return (
    <section className="overflow-hidden rounded-sm border border-[#e0e0e3] bg-white">
      <div className="flex flex-wrap items-center gap-[9px] border-b border-[#e0e0e3] px-3 py-[9px]">
        <span className="text-[13.5px] font-semibold tracking-[-0.011em] text-[#18181b]">
          Recovery playbook impact
        </span>
        <span className="flex items-center gap-[7px]">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: recovery.enabled ? "#14b8c4" : "#d4d4d8" }}
          />
          <span className="text-[11.5px] text-[#52525b]">
            {recovery.enabled ? "enabled" : "disabled"}
          </span>
        </span>
        <span className="text-[11.5px] tabular-nums text-[#52525b]">
          {disruptions.length} {disruptions.length === 1 ? "event" : "events"} ·{" "}
          {responses.length} {responses.length === 1 ? "lever" : "levers"} ·{" "}
          {recovery.detection_lag_days}d detection lag · cap $
          {recovery.cost_cap?.toLocaleString() ?? 0}
        </span>
      </div>

      {responses.length > 0 ? (
        <div className="flex flex-wrap gap-[6px] border-b border-[#ececee] px-3 py-2">
          {responses.map((r) => (
            <span
              key={r}
              className="whitespace-nowrap rounded-sm bg-[#f0f0f2] px-[7px] py-px text-[11px] tabular-nums text-[#52525b]"
            >
              {RESPONSE_LABELS[r]} · +{RESPONSE_WEIGHTS[r].toFixed(2)}
            </span>
          ))}
        </div>
      ) : null}

      <ImpactTable head="KPI" rows={kpiRows} />
      {utilRows.length > 0 ? <ImpactTable head="Utilization by class" rows={utilRows} /> : null}
    </section>
  );
}
