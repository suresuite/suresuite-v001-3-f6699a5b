import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  scoreScenarioKpis,
  RESPONSE_LABELS,
  RESPONSE_WEIGHTS,
  type RecoveryConfig,
  type RecoveryResponseKey,
  type DisruptionEvent,
} from "@/lib/sim/recoveryScore";
import { ShieldCheck, ShieldOff, Clock, DollarSign, Activity } from "lucide-react";

interface Props {
  recovery: RecoveryConfig | null;
  disruptions: DisruptionEvent[];
  horizonDays: number;
}

const METRICS: Array<{
  key: keyof ReturnType<typeof scoreScenarioKpis>;
  label: string;
  fmt: (n: number) => string;
  higherIsBetter: boolean;
}> = [
  { key: "fill_rate", label: "Fill rate", fmt: (n) => `${(n * 100).toFixed(1)}%`, higherIsBetter: true },
  { key: "otif", label: "OTIF", fmt: (n) => `${(n * 100).toFixed(1)}%`, higherIsBetter: true },
  { key: "lead_time_days", label: "Lead time (d)", fmt: (n) => n.toFixed(1), higherIsBetter: false },
  { key: "utilization", label: "Utilization", fmt: (n) => `${(n * 100).toFixed(1)}%`, higherIsBetter: true },
  { key: "ttr_days", label: "TTR (d)", fmt: (n) => n.toFixed(1), higherIsBetter: false },
  { key: "resilience_index", label: "Resilience", fmt: (n) => n.toFixed(2), higherIsBetter: true },
];

export function RecoveryImpactCard({ recovery, disruptions, horizonDays }: Props) {
  const { withR, withoutR } = useMemo(() => {
    if (!recovery) return { withR: null, withoutR: null };
    return {
      withR: scoreScenarioKpis(recovery, disruptions, horizonDays),
      withoutR: scoreScenarioKpis({ ...recovery, enabled: false }, disruptions, horizonDays),
    };
  }, [recovery, disruptions, horizonDays]);

  if (!recovery || !withR || !withoutR) return null;

  const hasDisruption = disruptions.length > 0;
  const responses = (recovery.response ?? []) as RecoveryResponseKey[];
  const utilDeltaByClass = Object.entries(withR.utilization_by_class).map(([k, v]) => ({
    cls: k,
    with: v,
    without: withoutR.utilization_by_class[k] ?? v,
    delta: v - (withoutR.utilization_by_class[k] ?? v),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {recovery.enabled ? (
              <ShieldCheck className="h-4 w-4 text-primary" />
            ) : (
              <ShieldOff className="h-4 w-4 text-muted-foreground" />
            )}
            Recovery playbook impact
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={recovery.enabled ? "default" : "outline"} className="text-[10px]">
              {recovery.enabled ? "Enabled" : "Disabled"}
            </Badge>
            {hasDisruption ? (
              <Badge variant="secondary" className="text-[10px]">
                {disruptions.length} disruption{disruptions.length > 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">No disruption scheduled</Badge>
            )}
            <Badge variant="outline" className="text-[10px] gap-1">
              <Clock className="h-3 w-3" />
              {recovery.detection_lag_days}d lag
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              <DollarSign className="h-3 w-3" />
              cap ${recovery.cost_cap.toLocaleString()}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {responses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No response actions selected. Add response levers in Setup → Recovery to mitigate disruptions.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {responses.map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px] font-mono">
                {RESPONSE_LABELS[r]} · +{RESPONSE_WEIGHTS[r].toFixed(2)}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {METRICS.map((m) => {
            const a = Number(withoutR[m.key] ?? 0);
            const b = Number(withR[m.key] ?? 0);
            const delta = b - a;
            const better = m.higherIsBetter ? delta > 0.0001 : delta < -0.0001;
            const worse = m.higherIsBetter ? delta < -0.0001 : delta > 0.0001;
            return (
              <div
                key={m.key as string}
                className="rounded-sm border border-border/60 bg-muted/20 p-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.label}
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground">without</div>
                    <div className="text-xs font-mono">{m.fmt(a)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground">with</div>
                    <div className="text-xs font-mono">{m.fmt(b)}</div>
                  </div>
                </div>
                <div
                  className={
                    "mt-1 text-[10px] font-mono " +
                    (better
                      ? "text-emerald-500"
                      : worse
                      ? "text-destructive"
                      : "text-muted-foreground")
                  }
                >
                  Δ {delta > 0 ? "+" : ""}{m.fmt(delta).replace(/^-?/, delta < 0 ? "-" : "")}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
            <Activity className="h-3 w-3" /> Utilization Δ by class
          </div>
          <div className="space-y-1">
            {utilDeltaByClass.map((row) => {
              const pct = row.delta * 100;
              const width = Math.min(100, Math.abs(pct) * 4);
              return (
                <div key={row.cls} className="grid grid-cols-[80px_1fr_56px] items-center gap-2">
                  <div className="text-[11px] capitalize text-muted-foreground">{row.cls}</div>
                  <div className="relative h-2 bg-muted/40 rounded-sm overflow-hidden">
                    <div
                      className={
                        "absolute top-0 h-full " +
                        (row.delta >= 0 ? "left-1/2 bg-primary" : "right-1/2 bg-destructive")
                      }
                      style={{ width: `${width / 2}%` }}
                    />
                    <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                  </div>
                  <div className="text-[10px] font-mono text-right">
                    {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
