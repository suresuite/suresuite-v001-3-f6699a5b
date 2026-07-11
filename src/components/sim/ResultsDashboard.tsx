import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiStatTable } from "./KpiStatTable";
import { UtilizationHeatmap } from "./UtilizationHeatmap";
import { ConvergencePlot } from "./ConvergencePlot";
import { RecoveryImpactCard } from "./RecoveryImpactCard";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import type { RecoveryConfig, DisruptionEvent } from "@/lib/sim/recoveryScore";
import { CredibilityBadge } from "./CredibilityBadge";
import type { Credibility } from "@/hooks/useModelValidation";

interface Props {
  run: SimulationRun | null;
  reps: Replication[];
  primaryKpi: string;
  scenario?: { disruption_schedule?: DisruptionEvent[]; horizon_days?: number } | null;
  /** B0b (§9.5): badge from the run's stamped card + engine-fingerprint check. */
  credibility?: Credibility | null;
}

interface RunMeta {
  recovery?: RecoveryConfig;
  disruption_count?: number;
  horizon_days?: number;
  engine?: string;
  scsim_notes?: string[];
}

function extractMeta(run: SimulationRun | null, reps: Replication[]): RunMeta | null {
  const fromRun = (run?.aggregate_kpis as unknown as { _meta?: RunMeta } | null)?._meta;
  if (fromRun) return fromRun;
  const fromRep = (reps[0]?.kpis as unknown as { _meta?: RunMeta } | null)?._meta;
  return fromRep ?? null;
}

export function ResultsDashboard({ run, reps, primaryKpi, scenario, credibility }: Props) {
  if (!run) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Run a simulation to see results.
          </p>
        </CardContent>
      </Card>
    );
  }
  const meta = extractMeta(run, reps);
  const codeVersion = run.code_version ?? "";
  const isStub = codeVersion.startsWith("stub") || !codeVersion;
  const disruptions: DisruptionEvent[] =
    scenario?.disruption_schedule && scenario.disruption_schedule.length > 0
      ? scenario.disruption_schedule
      : meta?.disruption_count
      ? Array.from({ length: meta.disruption_count }).map(() => ({
          magnitude_pct: 40,
          duration_days: 5,
          start_day: 10,
        }))
      : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {isStub ? (
          <Badge variant="outline" className="text-[11px] gap-1 border-yellow-400 text-yellow-700 bg-yellow-50">
            Preliminary estimate — Monte Carlo engine computing…
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] gap-1 border-green-500 text-green-700 bg-green-50">
            Monte Carlo result · {run?.rep_count_done ?? 0} replications
          </Badge>
        )}
        {credibility && <CredibilityBadge credibility={credibility} />}
      </div>

      {meta?.scsim_notes && meta.scsim_notes.length > 0 && (
        <details className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
          <summary className="cursor-pointer select-none">
            Engine conversion notes ({meta.scsim_notes.length})
          </summary>
          <ul className="list-disc pl-4 pt-1 space-y-0.5">
            {meta.scsim_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      {meta?.recovery && (
        <RecoveryImpactCard
          recovery={meta.recovery}
          disruptions={disruptions}
          horizonDays={meta.horizon_days ?? 90}
        />
      )}
      <ConvergencePlot reps={reps} primaryKpi={primaryKpi} warmupAt={run.warmup_detected_at} />
      <KpiStatTable reps={reps} />
      <UtilizationHeatmap reps={reps} />
    </div>
  );
}
