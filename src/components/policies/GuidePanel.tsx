import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MessageCircle, RotateCcw, Sparkles } from "lucide-react";
import type { StageKey } from "@/lib/policies/stages";

interface Recommendation {
  stage: StageKey;
  preset: string;
  steps: string[];
  rationale: string;
}

type Concern = "service" | "cost" | "resilience" | "sustainability";
type Weakness = "supplier" | "plant" | "customer";

const RECS: Record<`${Concern}:${Weakness}`, Recommendation> = {
  "service:supplier": {
    stage: "supplier",
    preset: "Resilient",
    steps: ["Open Supplier stage", "Apply Resilient preset", "Add overrides for top suppliers"],
    rationale: "Service breaks usually start upstream. Dual-source critical materials and tighten lead-time variance.",
  },
  "service:plant": {
    stage: "plant",
    preset: "Make to Stock",
    steps: ["Open Focal plant", "Apply Make to Stock preset", "Raise safety stock for A items"],
    rationale: "Buffer FG inventory absorbs upstream noise so customers see steady service.",
  },
  "service:customer": {
    stage: "customer",
    preset: "Service First",
    steps: ["Open Customer stage", "Apply Service First preset", "Set strict delivery windows"],
    rationale: "Allocate to high-tier customers first; cap backorder days to protect SLA.",
  },
  "cost:supplier": {
    stage: "supplier",
    preset: "Cost Optimized",
    steps: ["Open Supplier stage", "Apply Cost Optimized preset", "Consolidate orders weekly"],
    rationale: "Single-source qualified suppliers and consolidate shipments to cut freight per unit.",
  },
  "cost:plant": {
    stage: "plant",
    preset: "Lean JIT",
    steps: ["Open Focal plant", "Apply Lean JIT preset", "Tighten utilization cap"],
    rationale: "Pull-based replenishment drains WIP and holding cost without sacrificing throughput.",
  },
  "cost:customer": {
    stage: "customer",
    preset: "Cost Optimized",
    steps: ["Open Customer stage", "Apply Cost Optimized preset", "Loosen delivery windows for B/C tier"],
    rationale: "Batching orders + relaxed windows on lower tiers cuts outbound cost.",
  },
  "resilience:supplier": {
    stage: "supplier",
    preset: "Resilient",
    steps: ["Open Supplier stage", "Apply Resilient preset", "Configure failover trigger"],
    rationale: "Add backup suppliers with explicit failover so a single disruption doesn't propagate.",
  },
  "resilience:plant": {
    stage: "plant",
    preset: "Resilient",
    steps: ["Open Focal plant", "Apply Resilient preset", "Raise safety stock days"],
    rationale: "Extra cycle stock + capacity flex absorbs upstream and downstream shocks.",
  },
  "resilience:customer": {
    stage: "customer",
    preset: "Service First",
    steps: ["Open Customer stage", "Apply Service First preset", "Tier overrides for strategic accounts"],
    rationale: "Protect key customers explicitly so allocation rules survive a disruption.",
  },
  "sustainability:supplier": {
    stage: "supplier",
    preset: "Sustainable",
    steps: ["Open Supplier stage", "Apply Sustainable preset", "Prefer rail/sea modes"],
    rationale: "Mode shift away from road/air and consolidate loads to cut carbon intensity.",
  },
  "sustainability:plant": {
    stage: "plant",
    preset: "Sustainable",
    steps: ["Open Focal plant", "Apply Sustainable preset", "Reduce setup frequency"],
    rationale: "EPQ-style lots reduce changeovers and per-unit energy.",
  },
  "sustainability:customer": {
    stage: "customer",
    preset: "Sustainable",
    steps: ["Open Customer stage", "Apply Sustainable preset", "Wider batching window"],
    rationale: "Larger order batches mean fewer outbound trips and lower carbon per unit shipped.",
  },
};

const CONCERNS: { key: Concern; label: string; hint: string }[] = [
  { key: "service", label: "Service level", hint: "Hit OTIF and fill rate every period." },
  { key: "cost", label: "Total cost", hint: "Lowest landed + holding + stockout cost." },
  { key: "resilience", label: "Resilience", hint: "Survive disruptions with minimal hit." },
  { key: "sustainability", label: "Sustainability", hint: "Reduce carbon and waste across the chain." },
];

const WEAKNESSES: { key: Weakness; label: string }[] = [
  { key: "supplier", label: "Supplier side feels fragile" },
  { key: "plant", label: "Plant struggles to keep up" },
  { key: "customer", label: "Customer service is slipping" },
];

interface Props {
  onJumpToStage: (stage: StageKey) => void;
}

export function GuidePanel({ onJumpToStage }: Props) {
  const [concern, setConcern] = useState<Concern | null>(null);
  const [weakness, setWeakness] = useState<Weakness | null>(null);

  const rec = concern && weakness ? RECS[`${concern}:${weakness}`] : null;

  return (
    <Card className="p-5 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">Guide me</h2>
        {(concern || weakness) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1"
            onClick={() => {
              setConcern(null);
              setWeakness(null);
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Two questions, then I'll point you to the right stage and a preset that fits your project context.
      </p>

      {/* Q1 */}
      <div className="flex flex-col gap-2 mb-5">
        <div className="text-xs font-medium text-muted-foreground">
          1. What matters most right now?
        </div>
        <div className="flex flex-wrap gap-2">
          {CONCERNS.map((c) => (
            <button
              key={c.key}
              onClick={() => setConcern(c.key)}
              className={`px-3 py-2 rounded border text-left flex flex-col gap-0.5 transition-colors ${
                concern === c.key
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <span className="text-sm font-medium">{c.label}</span>
              <span className="text-[11px] text-muted-foreground">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Q2 */}
      {concern && (
        <div className="flex flex-col gap-2 mb-5">
          <div className="text-xs font-medium text-muted-foreground">
            2. Where do you feel the weakest link is?
          </div>
          <div className="flex flex-col gap-2">
            {WEAKNESSES.map((w) => (
              <button
                key={w.key}
                onClick={() => setWeakness(w.key)}
                className={`px-3 py-2 rounded border text-left transition-colors ${
                  weakness === w.key
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span className="text-sm">{w.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommendation */}
      {rec && (
        <div className="border-t border-border pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Recommendation</span>
            <Badge variant="outline" className="text-[10px]">Stage: {rec.stage}</Badge>
            <Badge variant="secondary" className="text-[10px]">Preset: {rec.preset}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{rec.rationale}</p>
          <ol className="text-sm list-decimal list-inside space-y-1">
            {rec.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <Button onClick={() => onJumpToStage(rec.stage)} size="sm" className="self-start gap-1.5">
            Go to {rec.stage} stage
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Card>
  );
}
