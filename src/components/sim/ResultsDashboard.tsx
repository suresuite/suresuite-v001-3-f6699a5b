import { Badge } from "@/components/ui/badge";
import { KpiStatTable } from "./KpiStatTable";
import { ConvergencePlot } from "./ConvergencePlot";
import { InventoryOverTime } from "./InventoryOverTime";
import { ItemSeriesExplorer } from "./ItemSeriesExplorer";
import { ReplicationSeedExplorer } from "./ReplicationSeedExplorer";
import { RecoveryImpactCard } from "./RecoveryImpactCard";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import type { RecoveryConfig, DisruptionEvent } from "@/lib/sim/recoveryScore";
import { CredibilityBadge } from "./CredibilityBadge";
import { M, MobileChip, MobilePanel, MobileRow } from "@/components/mobile";
import { cn } from "@/lib/utils";
import type { Credibility } from "@/hooks/useModelValidation";

interface Props {
  run: SimulationRun | null;
  reps: Replication[];
  primaryKpi: string;
  scenario?: { disruption_schedule?: DisruptionEvent[]; horizon_days?: number } | null;
  /** B0b (§9.5): badge from the run's stamped card + engine-fingerprint check. */
  credibility?: Credibility | null;
  /**
   * Wear the mobile skin (v2 §4C).
   *
   * This component is mounted by both platforms, so the skin arrives as a
   * prop rather than as an edit: `skin` is false everywhere desktop renders
   * and the desktop tree below is byte-identical to what it has always been.
   * What it changes is this component's OWN chrome — the two badges become
   * chips, the engine notes become a panel — and it opens a container query
   * (`.m-cq`) so the charts and tables it hosts size to the panel they are in
   * rather than to the viewport, which stops being the same thing the moment
   * the wide band goes two-column (v2 §5.5).
   */
  skin?: boolean;
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

export function ResultsDashboard({
  run,
  reps,
  primaryKpi,
  scenario,
  credibility,
  skin = false,
}: Props) {
  if (!run) {
    return (
      <div className="rounded-sm border border-[--hair-rule] bg-white px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
        No run yet
      </div>
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
    <div className={cn('flex flex-col', skin ? 'm-cq gap-2' : 'gap-3')}>
      {skin ? (
        // A state, in the skin's vocabulary: a chip, never a coloured panel
        // (§3). The stub case is amber because it is the firm-level "derived"
        // meaning; a finished run is the process teal.
        <div className="flex flex-wrap items-center gap-1.5">
          <MobileChip fill={isStub ? M.warnFill : undefined} ink={isStub ? M.warnInk : M.body}>
            {isStub
              ? 'Preliminary — engine computing'
              : `Monte Carlo · ${run?.rep_count_done ?? 0} reps`}
          </MobileChip>
          {credibility && <CredibilityBadge credibility={credibility} />}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
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
      )}

      {meta?.scsim_notes && meta.scsim_notes.length > 0 && (
        skin ? (
          // A disclosure triangle is not in the skin's control inventory, and
          // the notes are not optional reading — they are what the engine had
          // to change about the model. So they are a panel, open.
          <MobilePanel
            label="Engine conversion notes"
            counter={`${meta.scsim_notes.length}`}
            accent={M.firm}
          >
            {meta.scsim_notes.map((n, i) => (
              <MobileRow key={i} chevron={false} label={n} />
            ))}
          </MobilePanel>
        ) : (
          <details className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer select-none items-center md:min-h-0 md:list-item">
              Engine conversion notes ({meta.scsim_notes.length})
            </summary>
            <ul className="list-disc pl-4 pt-1 space-y-0.5">
              {meta.scsim_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </details>
        )
      )}

      {meta?.recovery && (
        <RecoveryImpactCard
          recovery={meta.recovery}
          disruptions={disruptions}
          horizonDays={meta.horizon_days ?? 90}
        />
      )}
      {/* Inventory over time (G19 / WP 9.1): materials and finished goods,
          in units or value. Plain weekly scalars, so — unlike the per-item
          panel at the bottom — this renders on every run. */}
      <InventoryOverTime
        reps={reps.filter((r) => r.status === "done")}
        warmupWeeks={run.warmup_detected_at}
      />
      <ConvergencePlot reps={reps} primaryKpi={primaryKpi} warmupAt={run.warmup_detected_at} />
      {/* Per-seed filter over the persisted weekly traces (W1 / G17): default
          is the cross-rep mean ± CI band; selecting a seed overlays or
          isolates that replication and shows its KPI row. */}
      <ReplicationSeedExplorer
        reps={reps.filter((r) => r.status === "done" && r.kpis)}
        warmupWeeks={run.warmup_detected_at}
      />
      <KpiStatTable reps={reps} primaryKpi={primaryKpi} />
      {/* `UtilizationHeatmap` WAS HERE AND IS REMOVED — §4 D113.
          It read a per-node `utilization` series from each replication and NO
          ENGINE WRITES ONE: `extra_series` carries exactly the four
          `ReplicationSeedExplorer` offers. So it rendered "Run a simulation that
          emits per-node utilization to see it here" on every run, forever — a
          sentence that reads as something a different run could fix. A panel that
          can only ever be empty is a placeholder, not a state, and removing it is
          a smaller change than emitting a series no policy needs. The run-level
          measure exists and now renders in the table above, as
          `capacity_utilization`, which the same defect had been hiding. */}
      {/* Per-item weekly series (W3 / G17): inspection runs only. This page
          dispatches no inspection run, so before WP 9.1 the panel was empty
          here on every run and said nothing about why — the dead end §4 D113
          warns about. It now names where an inspection run is started. The
          inventory chart above needs none of this: its series are plain weekly
          scalars present on every run. */}
      <ItemSeriesExplorer
        runId={run.id}
        warmupWeeks={run.warmup_detected_at}
        emptyHint={
          "this run has none. Per-item evidence comes from an inspection run " +
          "(one replication, full trace), started from Run & Validate on the " +
          "Policies page; it then appears here too."
        }
      />
    </div>
  );
}
