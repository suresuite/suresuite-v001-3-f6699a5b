import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap,
  PackageX,
  Clock,
  TrendingUp,
  Layers,
  Target,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StressTestPreset = {
  name: string;
  description: string;
  disruption_schedule: Array<{
    target: string;
    target_type: "node" | "edge";
    start_day: number;
    duration_days: number;
    magnitude_pct: number;
  }>;
};

type StressTest = {
  id: string;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  scenario: StressTestPreset;
};

const TESTS: StressTest[] = [
  {
    id: "single_supplier_outage",
    label: "Single-supplier outage",
    blurb: "Primary supplier offline for 14 days from day 30. Tests backup activation and safety stock depth.",
    icon: Zap,
    scenario: {
      name: "[Stress] Single-supplier outage",
      description: "Primary supplier offline for 14 days starting on day 30.",
      disruption_schedule: [
        { target: "supplier:primary", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
  {
    id: "material_shortage",
    label: "Material shortage",
    blurb: "Critical material inbound capacity cut 50% for 21 days. Reveals BoM-driven bottlenecks.",
    icon: PackageX,
    scenario: {
      name: "[Stress] Material shortage",
      description: "Critical material inbound capacity reduced 50% for 21 days.",
      disruption_schedule: [
        { target: "material:critical", target_type: "node", start_day: 30, duration_days: 21, magnitude_pct: 50 },
      ],
    },
  },
  {
    id: "lead_time_shock",
    label: "Lead-time shock",
    blurb: "Inbound lane lead time tripled for 4 weeks. Stresses pipeline + expediting policy.",
    icon: Clock,
    scenario: {
      name: "[Stress] Lead-time shock",
      description: "Inbound lane lead time extended 200% for 28 days.",
      disruption_schedule: [
        { target: "edge:inbound", target_type: "edge", start_day: 30, duration_days: 28, magnitude_pct: 200 },
      ],
    },
  },
  {
    id: "demand_surge",
    label: "Demand surge",
    blurb: "Customer demand spikes 40% for 3 weeks. Tests capacity flex and allocation fairness.",
    icon: TrendingUp,
    scenario: {
      name: "[Stress] Demand surge",
      description: "Aggregate demand +40% for 21 days starting on day 30.",
      disruption_schedule: [
        { target: "customer:all", target_type: "node", start_day: 30, duration_days: 21, magnitude_pct: 40 },
      ],
    },
  },
  {
    id: "multi_hit",
    label: "Multi-hit (compound)",
    blurb: "Supplier outage on day 30, demand surge on day 45. Worst-case compound shock.",
    icon: Layers,
    scenario: {
      name: "[Stress] Multi-hit compound",
      description: "Supplier outage on day 30, demand surge on day 45.",
      disruption_schedule: [
        { target: "supplier:primary", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
        { target: "customer:all", target_type: "node", start_day: 45, duration_days: 14, magnitude_pct: 30 },
      ],
    },
  },
  {
    id: "nexus_attack",
    label: "Nexus-node attack",
    blurb: "Highest-prominence node taken offline for 14 days. Targeted-attack resilience.",
    icon: Target,
    scenario: {
      name: "[Stress] Nexus-node attack",
      description: "Highest-prominence node offline for 14 days.",
      disruption_schedule: [
        { target: "node:nexus", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
];

interface Props {
  onLaunch: (preset: StressTestPreset) => void | Promise<void>;
}

export function StressTestCard({ onLaunch }: Props) {
  return (
    <div className="border border-border bg-card w-64 shrink-0">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Built-in stress tests
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          One-click resilience experiments. Each creates a pre-configured scenario you can review and run.
        </p>
      </div>
      <TooltipProvider delayDuration={250}>
        <div className="flex flex-col">
          {TESTS.map((t) => {
            const Icon = t.icon;
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => void onLaunch(t.scenario)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-left",
                      "hover:bg-muted/50 transition-colors border-l-2 border-l-transparent",
                      "hover:border-l-primary/60",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate">{t.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px] text-xs">
                  {t.blurb}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/80">
        Resilience Index · coming soon
      </div>
    </div>
  );
}
