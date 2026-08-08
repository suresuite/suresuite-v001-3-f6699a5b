// The Simulation Lab pane switcher (UI pass) — replaces the shadcn ToggleGroup.
//
// The five panes are an ordered, gated sequence — not free tabs. The recessed
// band, the kicker and the live gate readout are what say so. Purely
// presentational: every sub-label is a fact derived from state the page
// already holds, never a hint.
import { cn } from "@/lib/utils";
import { LAYER } from "@/components/intelligence/piUi";

export type PaneId = "setup" | "recovery" | "run" | "results" | "compare";

export interface StageDef {
  id: PaneId;
  n: string;
  label: string;
  sub: string;
  /** amber/red/teal dot, or null for none */
  dot?: string | null;
  /** show a teal check instead of the numeral */
  done?: boolean;
}

export interface StageRailProps {
  stages: StageDef[];
  active: PaneId;
  onSelect: (id: PaneId) => void;
  /** gate readout shown on the right of the guardrail band */
  gate: { dot: string; label: string };
}

/**
 * Cards size to their own content (flex-basis 0 + grow), the active card grows
 * 1.5x, and a chevron sits between each pair.
 */
export function StageRail({ stages, active, onSelect, gate }: StageRailProps) {
  return (
    <section className="rounded-md border border-[#d4d4d8] bg-gradient-to-b from-[#f7f7f8] to-[#f1f1f3] px-[10px] pb-[10px] pt-[9px] shadow-[inset_0_1px_0_#ffffff]">
      <div className="flex items-center gap-[9px] px-[3px] pb-2">
        <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
          Scenario run sequence
        </span>
        <span className="h-px flex-1 bg-[#e0e0e3]" />
        <span className="flex shrink-0 items-center gap-[7px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: gate.dot }} />
          <span className="whitespace-nowrap text-[11.5px] text-[#3f3f46]">{gate.label}</span>
        </span>
      </div>

      <div className="flex flex-nowrap items-stretch gap-[2px]">
        {stages.map((s, i) => {
          const on = s.id === active;
          const done = !on && s.done;
          return (
            <div key={s.id} className="contents">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                title={`${s.label} — ${s.sub}`}
                className={cn(
                  "flex basis-0 items-center gap-[10px] rounded-[5px] border px-[13px] py-[9px] text-left",
                  on
                    ? "grow-[1.5] border-foreground bg-foreground text-background"
                    : "grow border-[#e0e0e3] bg-white text-[#18181b] shadow-[0_1px_1px_rgba(24,24,27,0.04)]",
                )}
                style={{ minWidth: on ? 224 : 168 }}
              >
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold",
                    on
                      ? "bg-white text-foreground"
                      : done
                        ? "text-white"
                        : "bg-[#f4f4f5] text-[#71717a]",
                  )}
                  style={done && !on ? { background: LAYER.process } : undefined}
                >
                  {done ? "✓" : s.n}
                </span>

                <span className="flex min-w-0 flex-col gap-[2px]">
                  <span className="whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.011em]">
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      "truncate whitespace-nowrap text-[12px]",
                      on ? "text-background/[0.66]" : "text-[#71717a]",
                    )}
                  >
                    {s.sub}
                  </span>
                </span>

                {!on && s.dot ? (
                  <span
                    className="ml-auto h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: s.dot }}
                  />
                ) : null}
              </button>

              {i < stages.length - 1 ? (
                <span className="flex shrink-0 items-center px-[3px] text-[14px] text-[#c4c4c8]">›</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Build the stage list from the page's real state. Keep this next to the page so
 * the sub-labels stay honest — every one of them is a fact, never a hint.
 */
export function buildStages(args: {
  scenario: { horizon_days: number; replications: number; primary_kpi: string };
  eventCount: number;
  leverCount: number;
  recoveryEnabled: boolean;
  gate: { blocks: number; warns: number; reason: string | null };
  run: { status: string; rep_count_done: number; rep_count_target: number; current: boolean } | null;
  scenariosWithResults: number;
}): { stages: StageDef[]; gate: { dot: string; label: string } } {
  const { scenario, eventCount, leverCount, recoveryEnabled, gate, run, scenariosWithResults } = args;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const blockText = plural(gate.blocks, "blocking finding", "blocking findings");
  const warnText = plural(gate.warns, "warning", "warnings");

  const runSub = run
    ? run.status === "running" || run.status === "queued"
      ? `${run.status} ${run.rep_count_done}/${run.rep_count_target}`
      : `${run.status} · ${plural(run.rep_count_done, "rep", "reps")}`
    : "no run yet";

  const runStageSub = gate.reason
    ? gate.blocks > 0
      ? blockText
      : `${warnText} — ack required`
    : run?.status === "running"
      ? "running"
      : "ready to run";

  const stages: StageDef[] = [
    {
      id: "setup",
      n: "1",
      label: "Setup",
      sub: `${scenario.horizon_days}d · ${plural(scenario.replications, "rep", "reps")} · ${scenario.primary_kpi}`,
      done: !!scenario.primary_kpi,
    },
    {
      id: "recovery",
      n: "2",
      label: "Recovery playbook",
      sub: `${plural(eventCount, "event", "events")} · ${plural(leverCount, "lever", "levers")}`,
      // never tick a stage that has nothing scheduled
      done: eventCount > 0 && recoveryEnabled && leverCount > 0,
    },
    {
      id: "run",
      n: "3",
      label: "Run",
      sub: runStageSub,
      dot: gate.blocks > 0 ? LAYER.brand : gate.warns > 0 ? LAYER.firm : LAYER.process,
      // a completed run with an open gate is not "done"
      done: run?.status === "done" && !gate.reason,
    },
    {
      id: "results",
      n: "4",
      label: "Results",
      sub: runSub,
      dot: run?.status === "done" ? LAYER.process : run?.status === "running" ? LAYER.firm : null,
      done: run?.status === "done" && run.current,
    },
    {
      id: "compare",
      n: "5",
      label: "Compare",
      sub: plural(scenariosWithResults, "scenario with results", "scenarios with results"),
      done: scenariosWithResults >= 2,
    },
  ];

  const gateReadout =
    gate.blocks > 0
      ? { dot: LAYER.brand, label: `${blockText} — run gated` }
      : gate.warns > 0 && gate.reason
        ? { dot: LAYER.firm, label: `${warnText} — acknowledge to run` }
        : { dot: LAYER.process, label: "gate clear — run allowed" };

  return { stages, gate: gateReadout };
}
