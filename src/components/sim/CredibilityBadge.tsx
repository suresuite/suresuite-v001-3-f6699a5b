// The one credibility badge — Phase B0 / G13 / §9.5
// (design: docs/design/phase-b0-core-loop.md §3.2).
//
// Rendered on the Lab run pane header, RunProgressPanel, the ResultsDashboard
// header and the RVS banner. States are DERIVED (useModelValidation.resolve /
// resolveRun) — this component only displays. The tooltip is the drill-in:
// validated-when / by-whom, warm-up, n, tests, evidence run; the stale
// variant names which component drifted.
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Credibility, DriftComponent, ModelValidationCard } from "@/hooks/useModelValidation";

const STATE = {
  unvalidated: {
    Icon: Shield,
    label: "unvalidated",
    cls: "border-border text-muted-foreground bg-muted/40",
  },
  validated: {
    Icon: ShieldCheck,
    label: "validated",
    cls: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
  },
  stale: {
    Icon: ShieldAlert,
    label: "stale",
    cls: "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10",
  },
} as const;

const DRIFT_PROSE: Record<DriftComponent, string> = {
  policy: "Policy settings changed since validation",
  data: "Network data changed since validation (graph hash drifted)",
  scenario: "Scenario world-model settings changed since validation",
  engine: "Engine version differs from the validation evidence run",
};

function CardDetails({ card }: { card: ModelValidationCard }) {
  const tests = (card.validation_tests ?? []) as Array<{
    kpi?: string;
    ksP?: number;
    ks_p?: number;
    tP?: number;
    t_p?: number;
    pass?: boolean;
  }>;
  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      <div className="font-semibold">
        Model validated · {new Date(card.validated_at).toLocaleDateString()}
        {card.author_email ? ` by ${card.author_email}` : ""}
      </div>
      <div className="text-muted-foreground">
        Policy {card.policy_hash.slice(0, 8)} · network {card.graph_hash.slice(0, 8)} · scenario{" "}
        {card.scenario_hash.slice(0, 8)}
      </div>
      <div>
        Warm-up: <b>{card.adopted_warmup_days} days</b> ({card.warmup_method}) · Replications:{" "}
        <b>n = {card.recommended_replications}</b>
      </div>
      {tests.length > 0 ? (
        <div>
          Tests:{" "}
          {tests
            .slice(0, 4)
            .map(
              (t) =>
                `${t.kpi ?? "kpi"} KS p=${Number(t.ksP ?? t.ks_p ?? NaN).toFixed(2)} ` +
                `t p=${Number(t.tP ?? t.t_p ?? NaN).toFixed(2)} ${t.pass ? "✓" : "✗"}`,
            )
            .join(" · ")}
        </div>
      ) : (
        <div>Tests: none (face validation)</div>
      )}
      <div>
        Basis: <b>{card.basis}</b>
        {card.evidence_run_id && (
          <span className="text-muted-foreground"> · evidence: run #{card.evidence_run_id.slice(0, 8)}…</span>
        )}
      </div>
    </div>
  );
}

export function CredibilityBadge({
  credibility,
  className,
}: {
  credibility: Credibility;
  className?: string;
}) {
  const meta = STATE[credibility.state];
  const Icon = meta.Icon;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("h-5 gap-1 text-[10px] cursor-default", meta.cls, className)}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm">
          {credibility.state === "unvalidated" ? (
            <div className="text-[11px]">
              No model-validation card covers this policy version + network + scenario. Run the
              Run &amp; Validate stage on /policies and click <b>Mark model valid</b> to record one.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <CardDetails card={credibility.card} />
              {credibility.state === "stale" && (
                <div className="border-t pt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  {credibility.drift.map((d) => (
                    <div key={d}>⚠ {DRIFT_PROSE[d]}.</div>
                  ))}
                  <div>Re-validate on /policies to trust results.</div>
                </div>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
