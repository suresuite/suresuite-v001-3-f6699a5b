import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  Credibility,
  DriftComponent,
  ModelValidationCard,
} from "@/hooks/useModelValidation";

// The ONE credibility badge (Phase B0 / G13 / §9.5(6); design §3.2) — rendered
// on the Run & Validate header and run panels now, Lab surfaces next
// increment. Everything in the tooltip is read straight off the card; the
// state itself is derived at read time (deriveCredibility), never stored.

const STATE_META = {
  validated: {
    label: "validated",
    Icon: ShieldCheck,
    cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  stale: {
    label: "stale",
    Icon: ShieldAlert,
    cls: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  unvalidated: {
    label: "unvalidated",
    Icon: Shield,
    cls: "border-border bg-muted/40 text-muted-foreground",
  },
} as const;

const DRIFT_LABEL: Record<DriftComponent, string> = {
  policy: "policy settings changed since validation",
  data: "network data changed since validation (graph hash drifted)",
  scenario: "baseline scenario changed since validation",
  engine: "engine version differs from the validation evidence run",
};

function CardFacts({ card }: { card: ModelValidationCard }) {
  const tests = card.validation_tests ?? [];
  const passed = tests.filter((t) => t.pass).length;
  return (
    <div className="flex flex-col gap-0.5">
      <div>
        {card.verdict === "validated" ? "Model validated" : "Model rejected"} ·{" "}
        {new Date(card.validated_at).toLocaleString()}
        {card.author_email ? ` by ${card.author_email}` : ""}
      </div>
      <div>
        Warm-up: {card.adopted_warmup_days} days ({card.warmup_method}) ·
        Replications: n = {card.recommended_replications}
      </div>
      {tests.length > 0 && (
        <div>
          Tests: {passed}/{tests.length} KPI(s) passed (KS + Welch-t)
        </div>
      )}
      <div>
        Basis: {card.basis}
        {card.basis === "face" && " (no empirical series — user-acknowledged)"}
        {card.evidence_run_id && (
          <> · Evidence: run {card.evidence_run_id.slice(0, 8)}…</>
        )}
      </div>
      <div className="font-mono text-[10px] opacity-70">
        policy {card.policy_hash.slice(0, 8)} · graph {card.graph_hash.slice(0, 8)} ·
        scenario {card.scenario_hash.slice(0, 8)}
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
  const meta = STATE_META[credibility.state];
  const Icon = meta.Icon;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("h-5 gap-1 text-[10px] font-medium", meta.cls, className)}
          >
            <Icon className="h-3 w-3" />
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm text-[11px]">
          {credibility.state === "unvalidated" ? (
            <span>
              No validated model card for this configuration — run the
              verification → validation pipeline in Run &amp; Validate and mark
              the model valid.
            </span>
          ) : (
            <div className="flex flex-col gap-1.5">
              <CardFacts card={credibility.card} />
              {credibility.state === "stale" && (
                <div className="border-t pt-1.5 text-amber-700 dark:text-amber-300">
                  ⚠ {credibility.drift.map((d) => DRIFT_LABEL[d]).join("; ")}.
                  Re-validate to trust results.
                </div>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
