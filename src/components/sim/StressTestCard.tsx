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
  scenario: StressTestPreset;
};

export const STRESS_TESTS: StressTest[] = [
  {
    id: "single_supplier_outage",
    label: "Single-supplier outage",
    scenario: {
      name: "[Stress] Single-supplier outage",
      description: "Primary supplier offline for 14 days starting on day 30.",
      disruption_schedule: [
        { target: "supplier:primary", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
  {
    id: "plant_shutdown",
    label: "Plant shutdown",
    scenario: {
      name: "[Stress] Plant shutdown",
      description: "Plant production halted for 14 days starting on day 30.",
      disruption_schedule: [
        { target: "node:plant", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
  {
    id: "material_shortage",
    label: "Material shortage",
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
    scenario: {
      name: "[Stress] Nexus-node attack",
      description: "Highest-prominence node offline for 14 days.",
      disruption_schedule: [
        { target: "node:nexus", target_type: "node", start_day: 30, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
];

/** One preset = one line of facts: what is hit, when, for how long, how hard.
 *  The prose blurb is gone — the schedule itself is the description. */
function scheduleLine(preset: StressTestPreset): string {
  return preset.disruption_schedule
    .map((e) => `${e.target} · d${e.start_day}+${e.duration_days}d · ${e.magnitude_pct}%`)
    .join("   ");
}

interface Props {
  onLaunch: (preset: StressTestPreset) => void | Promise<void>;
}

/**
 * The drawer behind ExperimentLibraryBox. The library is a SOURCE of
 * scenarios, not a scenario — separate surface, teal accent, sitting above
 * the scenario list and never looking like a row in it.
 */
export function StressTestDrawer({ onLaunch }: Props) {
  return (
    <div className="mb-3 overflow-hidden rounded-sm border border-[rgba(20,184,196,0.45)] bg-white">
      {STRESS_TESTS.map((t, i) => (
        <button
          key={t.id}
          type="button"
          onClick={() => void onLaunch(t.scenario)}
          title={`Create a scenario pre-configured with: ${scheduleLine(t.scenario)}`}
          className={cn(
            "flex w-full flex-col gap-[3px] border-l-2 border-l-transparent px-[13px] py-[9px] text-left hover:border-l-[#14b8c4] hover:bg-[#fafafa]",
            i > 0 && "border-t border-t-[--sim-divider]",
          )}
        >
          <span className="text-[12.5px] font-medium text-[#18181b]">{t.label}</span>
          <span className="truncate text-[11.5px] tabular-nums text-[--zinc-quiet]">
            {scheduleLine(t.scenario)}
          </span>
        </button>
      ))}
    </div>
  );
}
