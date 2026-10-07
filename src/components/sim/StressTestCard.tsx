import { cn } from "@/lib/utils";
import { stressPresetUnavailableReason } from "@/lib/sim/stressTargets";
import { PLANT_TARGET, effectLabel, eventWindow, targetLabel } from "@/lib/sim/disruptionEvents";

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

// §4 D172 — a stress test may not present the undisrupted baseline as its
// result. Three rules enforced around this literal:
//   · `supplier:primary` is a placeholder the LAUNCH resolves to the project's
//     top-volume supplier (`stressTargets.ts`), or the launch refuses — it
//     never reaches the engine as written.
//   · A preset holding any event the mapper cannot resolve on any project
//     (material/edge/customer targets, `node:nexus`) is DISABLED in the drawer
//     with the reason, not hidden (§4.5's gating rule) and not launchable —
//     a run that silently dropped its event reports nothing happening under a
//     stress-test name.
//   · Start days sit past the default 105-day warm-up, so the engine no longer
//     shifts every preset's event on every default-configured run (the shift
//     is warned, but a preset should test what it says as shipped).
// `chains.mjs::deriveStressPresets` derives each event's `resolves` from this
// literal against pinned anchors in the mapper and the resolver; the drawer
// reads that derivation back from `policy.generated.ts`, so the disabled set
// cannot drift from what the engine actually accepts.
export const STRESS_TESTS: StressTest[] = [
  {
    id: "single_supplier_outage",
    label: "Single-supplier outage",
    scenario: {
      name: "[Stress] Single-supplier outage",
      description: "Top-volume supplier (resolved at launch) offline for 14 days from day 120, past the default warm-up.",
      disruption_schedule: [
        { target: "supplier:primary", target_type: "node", start_day: 120, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
  {
    id: "plant_shutdown",
    label: "Plant shutdown",
    scenario: {
      name: "[Stress] Plant shutdown",
      description: "Plant production halted for 14 days starting on day 120, past the default warm-up.",
      disruption_schedule: [
        { target: "node:plant", target_type: "node", start_day: 120, duration_days: 14, magnitude_pct: 100 },
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
        { target: "material:critical", target_type: "node", start_day: 120, duration_days: 21, magnitude_pct: 50 },
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
        { target: "edge:inbound", target_type: "edge", start_day: 120, duration_days: 28, magnitude_pct: 200 },
      ],
    },
  },
  {
    id: "demand_surge",
    label: "Demand surge",
    scenario: {
      name: "[Stress] Demand surge",
      description: "Aggregate demand +40% for 21 days starting on day 120.",
      disruption_schedule: [
        { target: "customer:all", target_type: "node", start_day: 120, duration_days: 21, magnitude_pct: 40 },
      ],
    },
  },
  {
    id: "multi_hit",
    label: "Multi-hit (compound)",
    scenario: {
      name: "[Stress] Multi-hit compound",
      description: "Supplier outage on day 120, demand surge on day 135.",
      disruption_schedule: [
        { target: "supplier:primary", target_type: "node", start_day: 120, duration_days: 14, magnitude_pct: 100 },
        { target: "customer:all", target_type: "node", start_day: 135, duration_days: 14, magnitude_pct: 30 },
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
        { target: "node:nexus", target_type: "node", start_day: 120, duration_days: 14, magnitude_pct: 100 },
      ],
    },
  },
];

/** The presets' placeholder targets, named as a person reads them. */
const PLACEHOLDER_TARGETS: Record<string, string> = {
  "supplier:primary": "Top-volume supplier",
  "material:critical": "Critical material",
  "edge:inbound": "Inbound lane",
  "customer:all": "All customers",
  "node:nexus": "Highest-prominence node",
};

/** One preset = one line of facts: how hard, what is hit, which simulation weeks
 *  — the same words as every disruption event (`DISRUPTION_TERMS`). The prose
 *  blurb is gone — the schedule itself is the description. A magnitude on a
 *  target the engine cannot disrupt has no engine meaning, so it is shown as is. */
export function scheduleLine(preset: StressTestPreset): string {
  return preset.disruption_schedule
    .map((e) => {
      const engineTarget = e.target === PLANT_TARGET || e.target.startsWith("supplier:");
      const how = engineTarget ? effectLabel(e.magnitude_pct) : `Magnitude ${e.magnitude_pct}%`;
      const what = PLACEHOLDER_TARGETS[e.target] ?? targetLabel(e.target);
      return `${how} · ${what} · ${eventWindow(e.start_day, e.duration_days)}`;
    })
    .join("; then ");
}

interface Props {
  onLaunch: (preset: StressTestPreset) => void | Promise<void>;
}

/**
 * The preset list behind ExperimentLibraryBox. The library is a SOURCE of
 * scenarios, not a scenario — separate surface, teal accent, never looking
 * like a row in the scenario list. Desktop shows it in a sheet on the right
 * (`StressTestSheet`), so the left rail never moves; the phone's Scenarios
 * sheet shows it inline under the card.
 */
export function StressTestDrawer({ onLaunch }: Props) {
  return (
    <div className="mb-3 overflow-hidden rounded-sm border border-[rgba(20,184,196,0.45)] bg-white">
      {STRESS_TESTS.map((t, i) => {
        const reason = stressPresetUnavailableReason(t.id);
        return (
          <button
            key={t.id}
            type="button"
            disabled={reason !== null}
            onClick={() => void onLaunch(t.scenario)}
            title={
              reason ??
              `Create a scenario with this disruption schedule: ${scheduleLine(t.scenario)}`
            }
            className={cn(
              "flex w-full flex-col gap-[3px] border-l-2 border-l-transparent px-[13px] py-[9px] text-left",
              reason === null && "hover:border-l-[#14b8c4] hover:bg-[#fafafa]",
              reason !== null && "cursor-not-allowed opacity-60",
              i > 0 && "border-t border-t-[--sim-divider]",
            )}
          >
            <span className="text-[12.5px] font-medium text-[#18181b]">{t.label}</span>
            <span className="truncate text-[11.5px] tabular-nums text-[--zinc-quiet]">
              {scheduleLine(t.scenario)}
            </span>
            {reason !== null && (
              <span className="text-[11px] leading-snug text-[#b3261e]">{reason}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
